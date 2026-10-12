import { readFile, readdir, lstat, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse as parseIni } from "ini";
import { gte, valid } from "semver";
import { parseDocument } from "yaml";

export const rules = [
  "release-age",
  "release-age-exclusions",
  "install-scripts",
  "registry",
  "manager-version",
  "manager-conflict",
  "lockfile",
  "ci-install",
  "ci-override",
  "unsupported-manager",
  "configuration",
  "pnpm-hardening",
] as const;
export type Rule = (typeof rules)[number];
type Data = Record<string, unknown>;
export type Finding = {
  project: string;
  file: string;
  rule: Rule | "scan-error";
  severity: "error" | "warning";
  message: string;
  fix: string;
  exception?: { reason: string; expires: string };
};
export type Policy = {
  minimumReleaseAgeDays: number;
  excludedDirectories: string[];
  exceptions: {
    repository: string;
    project: string;
    rule: Rule;
    reason: string;
    expires: string;
  }[];
};
export type Report = {
  repository: string;
  status: "pass" | "findings" | "not-applicable" | "not-assessed" | "scan-error" | "empty";
  projects: { path: string; manager: string; version?: string }[];
  findings: Finding[];
};
const policyPath = new URL("../.github/package-manager-policy.json", import.meta.url);
const configNames = new Set(["package.json", ".npmrc", "pnpm-workspace.yaml"]);
const lockManagers: Record<string, string> = {
  "pnpm-lock.yaml": "pnpm",
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
};
const object = (value: unknown): value is Data =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const bool = (value: unknown) => value === true || value === "true";
const disabled = (value: unknown) => value === false || value === "false";
const number = (value: unknown): number | undefined =>
  (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))) &&
  Number.isFinite(Number(value))
    ? Number(value)
    : undefined;

export function validatePolicy(
  value: unknown,
  today = new Date().toISOString().slice(0, 10),
): Policy {
  if (
    !object(value) ||
    typeof value.minimumReleaseAgeDays !== "number" ||
    !Number.isFinite(value.minimumReleaseAgeDays) ||
    value.minimumReleaseAgeDays <= 0 ||
    !strings(value.excludedDirectories) ||
    value.excludedDirectories.some(
      (name) => !name || name.includes("/") || name === "." || name === "..",
    ) ||
    !Array.isArray(value.exceptions)
  )
    throw new Error("Invalid central policy");
  for (const item of value.exceptions) {
    if (
      !object(item) ||
      typeof item.repository !== "string" ||
      !/^[\w.-]+\/[\w.-]+$/.test(item.repository) ||
      typeof item.project !== "string" ||
      !item.project ||
      item.project.startsWith("/") ||
      item.project.split("/").includes("..") ||
      !rules.includes(item.rule as Rule) ||
      typeof item.reason !== "string" ||
      !item.reason.trim() ||
      typeof item.expires !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.expires) ||
      !Number.isFinite(Date.parse(item.expires)) ||
      new Date(item.expires).toISOString().slice(0, 10) !== item.expires ||
      item.expires < today
    )
      throw new Error("Invalid or expired central policy exception");
  }
  return value as Policy;
}

export async function loadPolicy(path: string | URL = policyPath): Promise<Policy> {
  return validatePolicy(JSON.parse(await readFile(path, "utf8")));
}

function yaml(text: string): Data {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error("Invalid YAML");
  const value: unknown = document.toJS({ maxAliasCount: 50 });
  if (value === null) return {};
  if (!object(value)) throw new Error("Expected a configuration object");
  return value;
}

function normalize(config: Data): Data {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}

function workspacePatterns(manifest: Data, workspace?: Data): string[] {
  const patterns = workspace
    ? (workspace.packages ?? [])
    : object(manifest.workspaces)
      ? manifest.workspaces.packages
      : (manifest.workspaces ?? []);
  if (!strings(patterns)) throw new Error("Invalid workspace patterns");
  return patterns;
}

function member(path: string, patterns: string[]): boolean {
  const matches = (pattern: string) =>
    new Bun.Glob(pattern.replace(/^\.\//, "").replace(/\/$/, "")).match(path);
  return (
    patterns.some((pattern) => !pattern.startsWith("!") && matches(pattern)) &&
    !patterns.some((pattern) => pattern.startsWith("!") && matches(pattern.slice(1)))
  );
}

export async function scanRepository(
  rootPath: string,
  repository: string,
  policy: Policy,
): Promise<Report> {
  const root = resolve(rootPath);
  const files = new Set<string>();
  const findings: Finding[] = [];
  const projects: Report["projects"] = [];
  const excludedDirectories = new Set([".git", "node_modules", ...policy.excludedDirectories]);
  const add = (
    project: string,
    file: string,
    rule: Finding["rule"],
    severity: Finding["severity"],
    message: string,
    fix: string,
  ) => findings.push({ project, file, rule, severity, message, fix });
  const scanError = (file: string) =>
    add(
      dirname(file),
      file,
      "scan-error",
      "error",
      "Could not safely read or parse this file.",
      "Fix the file or rerun the scan if access failed.",
    );
  async function walk(directory = "") {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (configNames.has(entry.name) || entry.name in lockManagers) scanError(path);
        continue;
      }
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) await walk(path);
      } else if (entry.isFile()) files.add(path);
    }
  }
  try {
    await walk();
  } catch {
    scanError(".");
  }
  const text = async (path: string) => {
    const stat = await lstat(join(root, path));
    if (!stat.isFile() || stat.size > 2_000_000)
      throw new Error("Unsafe or oversized configuration");
    return readFile(join(root, path), "utf8");
  };
  const readObject = async (file: string): Promise<Data | undefined> => {
    try {
      const contents = await text(file);
      const value: unknown = file.endsWith(".json")
        ? JSON.parse(contents)
        : file.endsWith(".npmrc")
          ? parseIni(contents)
          : yaml(contents);
      if (!object(value)) throw new Error("Expected object");
      return value;
    } catch {
      scanError(file);
      return undefined;
    }
  };
  const manifests = new Map<string, Data>();
  const workspaces = new Map<string, Data>();
  const npmrcs = new Map<string, Data>();
  for (const file of [...files].sort()) {
    if (!configNames.has(file.split("/").at(-1)!)) continue;
    const value = await readObject(file);
    if (!value) continue;
    const dir = dirname(file);
    if (file.endsWith("package.json")) manifests.set(dir, value);
    else if (file.endsWith("pnpm-workspace.yaml")) workspaces.set(dir, value);
    else npmrcs.set(dir, value);
  }
  for (const dir of workspaces.keys()) {
    if (!manifests.has(dir)) manifests.set(dir, {});
  }
  const owners = new Map<string, string>();
  for (const dir of [...manifests.keys()].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  )) {
    const ancestors = [...manifests.keys()]
      .filter(
        (parent) =>
          parent !== dir &&
          !owners.has(parent) &&
          !relative(parent, dir).startsWith("..") &&
          (workspaces.has(parent) || manifests.get(parent)!.workspaces),
      )
      .sort((a, b) => b.length - a.length);
    for (const parent of ancestors) {
      try {
        if (
          member(
            relative(parent, dir),
            workspacePatterns(manifests.get(parent)!, workspaces.get(parent)),
          )
        ) {
          owners.set(dir, parent);
          break;
        }
      } catch {
        scanError(join(parent, workspaces.has(parent) ? "pnpm-workspace.yaml" : "package.json"));
      }
    }
  }
  // Audit registry settings even in workspace member .npmrc files.
  const checkRegistry = (project: string, file: string, data: Data) => {
    for (const [key, value] of Object.entries(data)) {
      if (/^(strict-ssl|strictSsl)$/.test(key) && value !== undefined && !bool(value))
        add(
          project,
          file,
          "registry",
          "error",
          "Certificate verification is disabled or cannot be verified.",
          "Set strict-ssl=true.",
        );
      if (
        key === "registry" ||
        key.endsWith(":registry") ||
        key === "registries" ||
        key === "namedRegistries"
      ) {
        const urls: unknown[] = object(value)
          ? Object.entries(value).flatMap(([name, url]) =>
              name.startsWith("http") ? [name] : [url],
            )
          : [value];
        if (
          urls.some(
            (url) => typeof url !== "string" || !url.startsWith("https://") || url.includes("${"),
          )
        )
          add(
            project,
            file,
            "registry",
            "error",
            "Registry HTTPS configuration cannot be verified.",
            "Use a fixed HTTPS registry URL in committed configuration.",
          );
      }
    }
  };
  for (const [dir, config] of npmrcs)
    checkRegistry(owners.get(dir) ?? dir, join(dir, ".npmrc"), config);
  for (const [dir, config] of workspaces)
    checkRegistry(dir, join(dir, "pnpm-workspace.yaml"), config);

  for (const [dir, manifest] of manifests) {
    if (owners.has(dir)) continue;
    const manifestFile = join(dir, "package.json");
    const locks = Object.entries(lockManagers).filter(([lock]) => files.has(join(dir, lock)));
    const declared = typeof manifest.packageManager === "string" ? manifest.packageManager : "";
    const declaration = /^(npm|pnpm|yarn|bun)@([^+]+)(?:\+sha\d+\..+)?$/.exec(declared);
    const manager = declaration?.[1] ?? (workspaces.has(dir) ? "pnpm" : (locks[0]?.[1] ?? "npm"));
    const version =
      declaration && valid(declaration[2]) && !declaration[2].includes("-")
        ? declaration[2]
        : undefined;
    projects.push({ path: dir, manager, version });
    const npmrc = npmrcs.get(dir) ?? {};
    const workspace = workspaces.get(dir) ?? {};
    try {
      workspacePatterns(manifest, workspaces.get(dir));
    } catch {
      scanError(manifestFile);
    }
    if ((declared && !declaration) || !version)
      add(
        dir,
        manifestFile,
        "manager-version",
        "warning",
        "No supported exact package manager version is declared.",
        `Pin packageManager to ${manager}@x.y.z; the scanner does not infer npm's version from Node.js.`,
      );
    if (
      new Set(locks.map(([, name]) => name)).size > 1 ||
      locks.some(([, name]) => name !== manager) ||
      (manager !== "pnpm" && workspaces.has(dir))
    )
      add(
        dir,
        manifestFile,
        "manager-conflict",
        "error",
        "Package manager declarations and lockfiles conflict.",
        "Use one package manager and its lockfile for this project.",
      );
    for (const [child, owner] of owners) {
      if (
        owner === dir &&
        manifests.get(child)!.packageManager &&
        manifests.get(child)!.packageManager !== manifest.packageManager
      )
        add(
          dir,
          join(child, "package.json"),
          "manager-conflict",
          "error",
          "Workspace member declares a different package manager.",
          "Use the workspace root's package manager declaration.",
        );
    }
    if (!locks.some(([, name]) => name === manager))
      add(
        dir,
        manifestFile,
        "lockfile",
        "warning",
        "No lockfile was found for this project.",
        "Commit the package manager's lockfile.",
      );
    if (manager !== "npm" && manager !== "pnpm") {
      add(
        dir,
        manifestFile,
        "unsupported-manager",
        "warning",
        `${manager} is identified but its security settings are not assessed.`,
        "Add a policy adapter for this manager before treating the project as compliant.",
      );
      continue;
    }
    const major = version ? Number(version.split(".")[0]) : undefined;
    const supported =
      version && major! <= 12 && gte(version, manager === "pnpm" ? "10.16.0" : "11.10.0");
    if (version && !supported)
      add(
        dir,
        manifestFile,
        "manager-version",
        "warning",
        "This version is outside the scanner's supported range.",
        "Use pnpm 10.16 through 12.x or npm 11.10 through 12.x, or update the scanner's version rules.",
      );
    // package.json's pnpm field supports build approvals, not arbitrary workspace settings.
    const legacyBuildKeys = [
      "onlyBuiltDependencies",
      "onlyBuiltDependenciesFile",
      "neverBuiltDependencies",
      "ignoredBuiltDependencies",
      "allowBuilds",
      "dangerouslyAllowAllBuilds",
    ];
    const legacyBuilds =
      object(manifest.pnpm) && major === 10
        ? Object.fromEntries(
            Object.entries(manifest.pnpm).filter(([key]) => legacyBuildKeys.includes(key)),
          )
        : {};
    const settings =
      manager === "npm"
        ? normalize(npmrc)
        : { ...(major && major >= 11 ? {} : normalize(npmrc)), ...legacyBuilds, ...workspace };
    if (manager === "pnpm" && settings.sharedWorkspaceLockfile === false)
      add(
        dir,
        join(dir, "pnpm-workspace.yaml"),
        "lockfile",
        "warning",
        "Workspace uses separate member lockfiles which are not assessed individually.",
        "Review each member's lockfile or use a shared workspace lockfile.",
      );
    const configFile =
      manager === "npm"
        ? join(dir, ".npmrc")
        : workspaces.has(dir)
          ? join(dir, "pnpm-workspace.yaml")
          : manifestFile;
    const age = number(settings[manager === "pnpm" ? "minimumReleaseAge" : "minReleaseAge"]);
    const minimum = policy.minimumReleaseAgeDays * (manager === "pnpm" ? 1440 : 1);
    if (age === undefined || age < minimum)
      add(
        dir,
        configFile,
        "release-age",
        "error",
        `Release cooldown is missing, invalid, or below ${policy.minimumReleaseAgeDays} days.`,
        manager === "pnpm"
          ? `Set minimumReleaseAge: ${minimum} in pnpm-workspace.yaml.`
          : `Set min-release-age=${minimum} in .npmrc.`,
      );
    if (
      manager === "pnpm" &&
      major &&
      major >= 11 &&
      ((settings.minimumReleaseAgeStrict !== undefined &&
        !bool(settings.minimumReleaseAgeStrict)) ||
        (settings.trustLockfile !== undefined && !disabled(settings.trustLockfile)) ||
        settings.minimumReleaseAgeIgnoreMissingTime !== false)
    )
      add(
        dir,
        configFile,
        "release-age",
        "error",
        "Release-age enforcement can be bypassed by fallback, trusted lockfiles, or missing timestamps.",
        "Set minimumReleaseAgeStrict: true, trustLockfile: false and minimumReleaseAgeIgnoreMissingTime: false.",
      );
    const exclusions =
      settings[manager === "pnpm" ? "minimumReleaseAgeExclude" : "minReleaseAgeExclude"];
    if (exclusions !== undefined && (!strings(exclusions) || exclusions.length))
      add(
        dir,
        configFile,
        "release-age-exclusions",
        "error",
        "Release-age exclusions need central review.",
        "Remove exclusions or record a central exception with a reason and expiry.",
      );
    if (manager === "npm" && settings.before !== undefined)
      add(
        dir,
        configFile,
        "release-age",
        "error",
        "The before setting overrides the relative release cooldown.",
        "Remove before and use min-release-age.",
      );
    if (manager === "pnpm" && major && major >= 11) {
      const ignored = Object.keys(normalize(npmrc)).filter((key) =>
        ["minimumReleaseAge", "ignoreScripts", "dangerouslyAllowAllBuilds"].includes(key),
      );
      if (ignored.length)
        add(
          dir,
          join(dir, ".npmrc"),
          "configuration",
          "warning",
          "pnpm 11+ ignores these non-registry .npmrc settings.",
          "Move pnpm settings into pnpm-workspace.yaml.",
        );
    }
    const scriptsDisabled = bool(settings.ignoreScripts);
    const allScripts =
      settings[manager === "pnpm" ? "dangerouslyAllowAllBuilds" : "dangerouslyAllowAllScripts"];
    const dangerous = allScripts !== undefined && !disabled(allScripts);
    const pnpmDefaultDeny =
      manager === "pnpm" &&
      supported &&
      !dangerous &&
      (settings.neverBuiltDependencies === undefined ||
        settings.onlyBuiltDependencies !== undefined ||
        (gte(version!, "10.26.0") && settings.allowBuilds !== undefined)) &&
      settings.onlyBuiltDependenciesFile === undefined;
    const npmDefaultDeny = manager === "npm" && supported && major === 12 && !dangerous;
    if (dangerous || (!scriptsDisabled && !pnpmDefaultDeny && !npmDefaultDeny))
      add(
        dir,
        configFile,
        "install-scripts",
        "error",
        "Dependency install scripts are not verified as blocked by default.",
        manager === "npm"
          ? "Set ignore-scripts=true, or use npm 12's allowScripts policy without the all-scripts bypass."
          : "Use a supported pnpm version with default-deny builds; remove all-builds bypasses and standalone deny lists.",
      );
    const approvals =
      manager === "pnpm"
        ? (settings.allowBuilds ?? settings.onlyBuiltDependencies)
        : typeof settings.allowScripts === "string"
          ? settings.allowScripts.split(",").map((name) => name.trim())
          : (settings.allowScripts ?? manifest.allowScripts);
    if (
      approvals !== undefined &&
      !(
        strings(approvals) ||
        (object(approvals) && Object.values(approvals).every((value) => typeof value === "boolean"))
      )
    )
      add(
        dir,
        configFile,
        "configuration",
        "error",
        "Build approvals have an unrecognized shape.",
        "Use the documented array or Boolean map for this package manager version.",
      );
    if (
      (object(approvals) &&
        Object.entries(approvals).some(([name, value]) => name.includes("*") && bool(value))) ||
      (strings(approvals) && approvals.some((name) => name.includes("*")))
    )
      add(
        dir,
        configFile,
        "install-scripts",
        "error",
        "Build approvals contain wildcard package names.",
        "Approve individual reviewed packages.",
      );
    if (
      manager === "pnpm" &&
      supported &&
      gte(version!, "10.26.0") &&
      (disabled(settings.blockExoticSubdeps) ||
        (major === 10 && !bool(settings.blockExoticSubdeps)))
    )
      add(
        dir,
        configFile,
        "pnpm-hardening",
        "warning",
        "Exotic transitive dependency sources are not blocked.",
        "Set blockExoticSubdeps: true.",
      );
    if (
      manager === "pnpm" &&
      supported &&
      gte(version!, "10.21.0") &&
      settings.trustPolicy !== "no-downgrade"
    )
      add(
        dir,
        configFile,
        "pnpm-hardening",
        "warning",
        "Package publishing trust downgrades are not checked.",
        "Consider trustPolicy: no-downgrade and review any exclusions.",
      );
    for (const [child, owner] of owners) {
      if (owner !== dir) continue;
      const childConfig = normalize(npmrcs.get(child) ?? {});
      if (
        Object.keys(childConfig).some((key) =>
          [
            "minimumReleaseAge",
            "minReleaseAge",
            "ignoreScripts",
            "dangerouslyAllowAllBuilds",
            "dangerouslyAllowAllScripts",
          ].includes(key),
        )
      )
        add(
          dir,
          join(child, ".npmrc"),
          "configuration",
          "warning",
          "Workspace member has security settings whose precedence depends on the invocation.",
          "Keep security settings at the workspace root and review member overrides.",
        );
    }
  }

  // Shell checks are deliberately advisory: this is not a shell interpreter.
  for (const file of [...files].filter(
    (path) =>
      /^\.github\/workflows\/.*\.ya?ml$/.test(path) ||
      /(^|\/)Dockerfile(?:\.[^/]+)?$/.test(path) ||
      /\.(?:sh|bash)$/.test(path),
  )) {
    if (!projects.length) break;
    try {
      const contents = await text(file);
      if (/\.ya?ml$/.test(file)) inspectWorkflow(yaml(contents), file, projects, add);
      inspectCommands(contents, file, projects, policy, add);
    } catch {
      scanError(file);
    }
  }
  for (const [dir, manifest] of manifests) {
    if (object(manifest.scripts))
      inspectCommands(
        Object.values(manifest.scripts)
          .filter((value): value is string => typeof value === "string")
          .join("\n"),
        join(dir, "package.json"),
        projects.filter((project) => project.path === (owners.get(dir) ?? dir)),
        policy,
        add,
      );
  }
  for (const finding of findings) {
    const exception = policy.exceptions.find(
      (item) =>
        item.repository === repository &&
        item.project === finding.project &&
        item.rule === finding.rule,
    );
    if (exception) finding.exception = { reason: exception.reason, expires: exception.expires };
  }
  return {
    repository,
    projects,
    findings,
    status: findings.some((item) => item.rule === "scan-error")
      ? "scan-error"
      : !projects.length && !findings.length
        ? "not-applicable"
        : projects.every((item) => item.manager !== "npm" && item.manager !== "pnpm")
          ? "not-assessed"
          : findings.some((item) => !item.exception)
            ? "findings"
            : "pass",
  };
}

function inspectWorkflow(
  workflow: Data,
  file: string,
  projects: Report["projects"],
  add: (
    project: string,
    file: string,
    rule: Finding["rule"],
    severity: Finding["severity"],
    message: string,
    fix: string,
  ) => void,
) {
  if (!object(workflow.jobs)) return;
  for (const job of Object.values(workflow.jobs)) {
    if (!object(job) || !Array.isArray(job.steps)) continue;
    for (const step of job.steps) {
      if (
        !object(step) ||
        typeof step.uses !== "string" ||
        !step.uses.startsWith("pnpm/action-setup@") ||
        !object(step.with) ||
        step.with.version === undefined
      )
        continue;
      for (const project of projects.filter((item) => item.manager === "pnpm")) {
        if (step.with.version !== project.version)
          add(
            project.path,
            file,
            "manager-version",
            "warning",
            "CI selects a pnpm version that differs from the exact project declaration.",
            "Use the packageManager declaration or set the same exact version in CI.",
          );
      }
    }
  }
}

function booleanOptions(line: string, name: string): boolean[] {
  const pattern = new RegExp(
    `(?:^|[\\s"'])--(no-)?${name}(?:[=\\s]+["']?(true|false)["']?)?(?=$|[\\s;&|"'])`,
    "g",
  );
  return [...line.matchAll(pattern)].map((match) => !match[1] && match[2] !== "false");
}

function inspectCommands(
  contents: string,
  file: string,
  projects: Report["projects"],
  policy: Policy,
  add: (
    project: string,
    file: string,
    rule: Finding["rule"],
    severity: Finding["severity"],
    message: string,
    fix: string,
  ) => void,
) {
  const lines = contents.split("\n").filter((line) => !/^\s*#/.test(line));
  for (const project of projects.filter(
    (item) => item.manager === "npm" || item.manager === "pnpm",
  )) {
    for (const line of lines) {
      const frozenLockfile = booleanOptions(line, "frozen-lockfile");
      const releaseAgeStrict = booleanOptions(line, "minimum-release-age-strict");
      const trustLockfile = booleanOptions(line, "trust-lockfile");
      const prefix =
        project.manager === "pnpm"
          ? "(?:PNPM_CONFIG_MINIMUM_RELEASE_AGE|NPM_CONFIG_MINIMUM_RELEASE_AGE|minimumReleaseAge|--minimum-release-age)"
          : "(?:NPM_CONFIG_MIN_RELEASE_AGE|min-release-age|--min-release-age)";
      const match = new RegExp(`${prefix}[\\s:=]+["']?([\\d.]+)`, "i").exec(line);
      if (
        (match &&
          Number(match[1]) <
            policy.minimumReleaseAgeDays * (project.manager === "pnpm" ? 1440 : 1)) ||
        /(?:dangerously[-_]allow[-_]all[-_](?:builds|scripts)|dangerouslyAllowAllBuilds)[\s:=]+["']?true|--dangerously-allow-all-(?:builds|scripts)(?:\s|$)/i.test(
          line,
        ) ||
        /(?:strict[-_]ssl|strictSsl)[\s:=]+["']?false|NODE_TLS_REJECT_UNAUTHORIZED[\s:=]+["']?0/i.test(
          line,
        ) ||
        /(?:NPM|PNPM)_CONFIG_IGNORE_SCRIPTS[\s:=]+["']?false/i.test(line) ||
        frozenLockfile.includes(false) ||
        releaseAgeStrict.includes(false) ||
        trustLockfile.includes(true) ||
        /(?:trustLockfile|trust_lockfile)[\s:=]+["']?true/i.test(line)
      )
        add(
          project.path,
          file,
          "ci-override",
          "warning",
          "A visible command or environment setting may bypass the package manager policy.",
          "Remove the bypass or review the command's project and configuration explicitly.",
        );
      const selectedVersion = new RegExp(`\\b${project.manager}@(\\d+\\.\\d+\\.\\d+)`).exec(line);
      if (selectedVersion && selectedVersion[1] !== project.version)
        add(
          project.path,
          file,
          "manager-version",
          "warning",
          "A command selects a package manager version different from the project declaration.",
          "Use the project's exact packageManager version in install and Corepack commands.",
        );
      if (new RegExp(`\\b${project.manager}\\s+(?:install|i|ci)\\b`).test(line)) {
        if (
          (project.manager === "npm" && !/\bnpm\s+ci\b/.test(line)) ||
          (project.manager === "pnpm" &&
            (!frozenLockfile.includes(true) || frozenLockfile.includes(false)))
        )
          add(
            project.path,
            file,
            "ci-install",
            "warning",
            "An install command does not explicitly enforce the committed lockfile.",
            project.manager === "npm"
              ? "Use npm ci in CI."
              : "Use pnpm install --frozen-lockfile in CI.",
          );
        if (/--ignore-scripts[=\s]+false|--no-ignore-scripts/.test(line))
          add(
            project.path,
            file,
            "ci-override",
            "warning",
            "An install command overrides ignore-scripts.",
            "Review script approvals and remove the override.",
          );
      }
    }
  }
}

const escapeMarkdown = (value: string) =>
  value.replace(/[\r\n]/g, " ").replace(/[&<>|`]/g, (character) => `&#${character.charCodeAt(0)};`);
export function summary(reports: Report[]): string {
  const counts = Object.fromEntries(
    ["pass", "findings", "not-applicable", "not-assessed", "scan-error", "empty"].map((status) => [
      status,
      reports.filter((report) => report.status === status).length,
    ]),
  );
  let output = `# Package manager policy scan\n\n${reports.length} repositories. ${Object.entries(
    counts,
  )
    .map(([status, count]) => `${count} ${status}`)
    .join(", ")}.\n\n| Repository | Status | Projects |\n|---|---|---|\n`;
  for (const report of reports)
    output += `| ${escapeMarkdown(report.repository)} | ${report.status} | ${report.projects.length} |\n`;
  const all = reports.flatMap((report) =>
    report.findings.map((finding) => ({ repository: report.repository, ...finding })),
  );
  if (all.length)
    output +=
      "\n| Repository / project | Rule | Severity | File | Finding and fix |\n|---|---|---|---|---|\n";
  for (const item of all.slice(0, 500))
    output += `| ${escapeMarkdown(`${item.repository} / ${item.project}`)} | ${item.rule} | ${item.exception ? "excepted" : item.severity} | ${escapeMarkdown(item.file)} | ${escapeMarkdown(`${item.message} ${item.fix}${item.exception ? ` Exception: ${item.exception.reason}, expires ${item.exception.expires}.` : ""}`)} |\n`;
  if (all.length > 500)
    output += "\nShowing the first 500 findings. Download the JSON artifact for all findings.\n";
  return output;
}

export function exitCode(reports: Report[], enforce: boolean): number {
  if (reports.some((report) => report.status === "scan-error")) return 2;
  return enforce &&
    reports.some((report) =>
      report.findings.some((finding) => finding.severity === "error" && !finding.exception),
    )
    ? 1
    : 0;
}

export async function writeReports(reports: Report[], directory: string) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package-manager-report.json"),
    JSON.stringify(
      { schemaVersion: 1, generatedAt: new Date().toISOString(), repositories: reports },
      null,
      2,
    ) + "\n",
  );
  await writeFile(join(directory, "package-manager-summary.md"), summary(reports));
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        root: { type: "string" },
        repository: { type: "string", default: "local/repository" },
        policy: { type: "string" },
        output: { type: "string", default: "reports" },
        enforce: { type: "boolean", default: false },
      },
    });
    if (!values.root)
      throw new Error(
        "Usage: bun run scripts/scan-package-manager-config.ts --root /path/to/repo [--enforce]",
      );
    const report = await scanRepository(
      values.root,
      values.repository!,
      await loadPolicy(values.policy),
    );
    await writeReports([report], values.output!);
    console.log(summary([report]));
    process.exitCode = exitCode([report], values.enforce!);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Scanner failed");
    process.exitCode = 2;
  }
}
