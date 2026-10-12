import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  exitCode,
  scanRepository,
  summary,
  validatePolicy,
  type Policy,
} from "./scan-package-manager-config.ts";
import {
  discoverRepositories,
  scanOrganization,
  type Command,
} from "./scan-org-package-managers.ts";

const temporary: string[] = [];
const policy: Policy = {
  minimumReleaseAgeDays: 3,
  excludedDirectories: ["vendor", "dist"],
  exceptions: [],
};
const npm = {
  "package.json": JSON.stringify({ packageManager: "npm@11.10.0" }),
  ".npmrc": "min-release-age=3\nignore-scripts=true\n",
  "package-lock.json": "{}",
};
const pnpm = {
  "package.json": JSON.stringify({ packageManager: "pnpm@10.26.0" }),
  "pnpm-workspace.yaml":
    "minimumReleaseAge: 4320\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade\n",
  "pnpm-lock.yaml": "lockfileVersion: '9.0'",
};

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "package-manager-test-"));
  temporary.push(root);
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), contents);
  }
  return root;
}
async function scan(files: Record<string, string>, selectedPolicy = policy) {
  return scanRepository(await fixture(files), "org/repo", selectedPolicy);
}

test.each([npm, pnpm])("accepts a three-day cooldown with default-deny scripts", async (files) => {
  expect((await scan(files)).status).toBe("pass");
});

test.each([
  "",
  "min-release-age=2\n",
  "min-release-age=2.99\n",
  "min-release-age=${AGE}\n",
  "min-release-age=NaN\n",
])("rejects missing or weak npm cooldown: %s", async (age) => {
  const report = await scan({ ...npm, ".npmrc": age + "ignore-scripts=true\n" });
  expect(
    report.findings.some((item) => item.rule === "release-age" && item.severity === "error"),
  ).toBe(true);
  expect(exitCode([report], false)).toBe(0);
  expect(exitCode([report], true)).toBe(1);
});

test("parses npm comments, quoted values, and exclusion arrays", async () => {
  const report = await scan({
    ...npm,
    ".npmrc":
      '# policy\nmin-release-age="3"\nignore-scripts=true ; scripts blocked\nmin-release-age-exclude[]=@internal/*\n',
  });
  expect(report.findings.map((item) => item.rule)).toEqual(["release-age-exclusions"]);
});

test("pnpm uses minutes rather than days", async () => {
  const report = await scan({ ...pnpm, "pnpm-workspace.yaml": "minimumReleaseAge: 3" });
  expect(report.findings.some((item) => item.rule === "release-age")).toBe(true);
});

test("flags an unsupported version even when the setting looks safe", async () => {
  const report = await scan({ ...pnpm, "package.json": '{"packageManager":"pnpm@9.15.0"}' });
  expect(report.findings.some((item) => item.rule === "manager-version")).toBe(true);
  expect(report.findings.some((item) => item.rule === "install-scripts")).toBe(true);
});

test("accepts pnpm 10 legacy npmrc and build allowlists", async () => {
  const report = await scan({
    ...pnpm,
    "package.json":
      '{"packageManager":"pnpm@10.20.0","pnpm":{"onlyBuiltDependencies":["esbuild"]}}',
    "pnpm-workspace.yaml": "packages: []",
    ".npmrc": "minimum-release-age=4320\n",
  });
  expect(report.status).toBe("pass");
});

test("does not credit non-registry npmrc settings on pnpm 11", async () => {
  const report = await scan({
    ...pnpm,
    "package.json": '{"packageManager":"pnpm@11.0.0"}',
    "pnpm-workspace.yaml": "packages: []",
    ".npmrc": "minimum-release-age=4320\n",
  });
  expect(report.findings.some((item) => item.rule === "release-age")).toBe(true);
});

test("does not credit minimumReleaseAge in package.json's pnpm field", async () => {
  const report = await scan({
    ...pnpm,
    "package.json": '{"packageManager":"pnpm@10.26.0","pnpm":{"minimumReleaseAge":4320}}',
    "pnpm-workspace.yaml": "packages: []",
  });
  expect(report.findings.some((item) => item.rule === "release-age")).toBe(true);
});

test("does not credit pnpm 10 package.json approvals after migration to pnpm 11", async () => {
  const report = await scan({
    ...pnpm,
    "package.json": '{"packageManager":"pnpm@11.3.0","pnpm":{"onlyBuiltDependencies":["*"]}}',
    "pnpm-workspace.yaml":
      pnpm["pnpm-workspace.yaml"] + "minimumReleaseAgeIgnoreMissingTime: false\n",
  });
  expect(report.findings.some((item) => item.rule === "install-scripts")).toBe(false);
});

test("dynamic all-script permissions cannot establish compliance", async () => {
  const report = await scan({
    ...pnpm,
    "pnpm-workspace.yaml":
      pnpm["pnpm-workspace.yaml"] + "dangerouslyAllowAllBuilds: '${ALLOW_BUILDS}'",
  });
  expect(report.findings.some((item) => item.rule === "install-scripts")).toBe(true);
});

test("reports a CI manager version that differs from the project pin", async () => {
  const report = await scan({
    ...pnpm,
    ".github/workflows/build.yml":
      "jobs:\n  build:\n    steps:\n      - uses: pnpm/action-setup@v4\n        with:\n          version: '9.15.0'\n",
  });
  expect(report.findings.some((item) => item.rule === "manager-version")).toBe(true);
});

test("pnpm 11 requires strict timestamp and lockfile enforcement", async () => {
  const files = {
    ...pnpm,
    "package.json": '{"packageManager":"pnpm@11.3.0"}',
    "pnpm-workspace.yaml":
      pnpm["pnpm-workspace.yaml"] +
      "minimumReleaseAgeIgnoreMissingTime: false\nminimumReleaseAgeStrict: true\ntrustLockfile: false\n",
  };
  expect((await scan(files)).status).toBe("pass");
  const report = await scan({
    ...files,
    "pnpm-workspace.yaml": files["pnpm-workspace.yaml"].replace(
      "trustLockfile: false",
      "trustLockfile: true",
    ),
  });
  expect(report.findings.some((item) => item.rule === "release-age")).toBe(true);
});

test("npm 12 blocks scripts by default", async () => {
  expect(
    (
      await scan({
        ...npm,
        "package.json": '{"packageManager":"npm@12.0.2"}',
        ".npmrc": "min-release-age=3",
      })
    ).status,
  ).toBe("pass");
});

test.each(["dangerouslyAllowAllBuilds: true", "neverBuiltDependencies: [fsevents]"])(
  "rejects pnpm all-builds permission: %s",
  async (config) => {
    expect(
      (
        await scan({ ...pnpm, "pnpm-workspace.yaml": pnpm["pnpm-workspace.yaml"] + config })
      ).findings.some((item) => item.rule === "install-scripts"),
    ).toBe(true);
  },
);

test("rejects wildcard build approvals", async () => {
  expect(
    (
      await scan({
        ...pnpm,
        "pnpm-workspace.yaml": pnpm["pnpm-workspace.yaml"] + "allowBuilds:\n  '*': true",
      })
    ).findings.some((item) => item.rule === "install-scripts"),
  ).toBe(true);
});

test("rejects wildcard npmrc script approvals", async () => {
  const report = await scan({
    ...npm,
    "package.json": '{"packageManager":"npm@12.0.2"}',
    ".npmrc": "min-release-age=3\nallow-scripts=*",
  });
  expect(report.findings.some((item) => item.rule === "install-scripts")).toBe(true);
});

test("an unsupported allowBuilds option cannot make an older denylist safe", async () => {
  const report = await scan({
    ...pnpm,
    "package.json": '{"packageManager":"pnpm@10.20.0"}',
    "pnpm-workspace.yaml":
      "minimumReleaseAge: 4320\nneverBuiltDependencies: [fsevents]\nallowBuilds: {}",
  });
  expect(report.findings.some((item) => item.rule === "install-scripts")).toBe(true);
});

test("discovers a pnpm workspace without a root manifest", async () => {
  const report = await scan({
    "pnpm-workspace.yaml": pnpm["pnpm-workspace.yaml"] + "packages: ['packages/*']",
    "pnpm-lock.yaml": "",
    "packages/a/package.json": "{}",
  });
  expect(report.projects.map((project) => project.path)).toEqual(["."]);
  expect(report.projects[0].manager).toBe("pnpm");
  expect(report.findings.some((item) => item.rule === "release-age")).toBe(false);
});

test("ignores a target repository's own policy file", async () => {
  const report = await scan({
    ...npm,
    ".npmrc": "ignore-scripts=true",
    ".github/package-manager-policy.json": '{"minimumReleaseAgeDays":0}',
  });
  expect(report.findings.some((item) => item.rule === "release-age")).toBe(true);
});

test("groups workspace members but scans an independent nested project", async () => {
  const report = await scan({
    ...pnpm,
    "pnpm-workspace.yaml":
      pnpm["pnpm-workspace.yaml"] + "packages: ['packages/*', '!packages/independent']\n",
    "packages/a/package.json": "{}",
    "packages/independent/package.json": npm["package.json"],
    "packages/independent/.npmrc": npm[".npmrc"],
    "packages/independent/package-lock.json": "{}",
  });
  expect(report.projects.map((project) => project.path)).toEqual([".", "packages/independent"]);
  expect(report.status).toBe("pass");
});

test("groups npm workspaces and rejects member manager conflicts", async () => {
  const report = await scan({
    ...npm,
    "package.json": '{"packageManager":"npm@11.10.0","workspaces":["packages/*"]}',
    "packages/a/package.json": '{"packageManager":"pnpm@10.26.0"}',
  });
  expect(report.projects.length).toBe(1);
  expect(report.findings.some((item) => item.rule === "manager-conflict")).toBe(true);
});

test("reports mixed lockfiles", async () => {
  expect(
    (await scan({ ...npm, "pnpm-lock.yaml": "" })).findings.some(
      (item) => item.rule === "manager-conflict",
    ),
  ).toBe(true);
});

test("does not mistake generated dependencies for projects", async () => {
  expect(
    (await scan({ ...npm, "node_modules/pkg/package.json": "bad json", "dist/package.json": "{}" }))
      .status,
  ).toBe("pass");
});

test("distinguishes unsupported and non-applicable repositories", async () => {
  expect((await scan({ "README.md": "hello" })).status).toBe("not-applicable");
  expect(
    (await scan({ "package.json": '{"packageManager":"bun@1.4.2"}', "bun.lock": "{}" })).status,
  ).toBe("not-assessed");
});

test.each(["{bad json", "[]"])("malformed manifests are scan errors", async (manifest) => {
  const report = await scan({ ...npm, "package.json": manifest });
  expect(report.status).toBe("scan-error");
  expect(exitCode([report], false)).toBe(2);
});

test("duplicate YAML settings are scan errors", async () => {
  expect(
    (
      await scan({
        ...pnpm,
        "pnpm-workspace.yaml": "minimumReleaseAge: 4320\nminimumReleaseAge: 0",
      })
    ).status,
  ).toBe("scan-error");
});

test("never follows a symlinked configuration", async () => {
  const root = await fixture({ ...npm, ".npmrc": "" });
  await rm(join(root, ".npmrc"));
  await symlink("/etc/passwd", join(root, ".npmrc"));
  expect((await scanRepository(root, "org/repo", policy)).status).toBe("scan-error");
});

test("checks TLS and registry URLs without echoing secrets", async () => {
  const report = await scan({
    ...npm,
    ".npmrc":
      npm[".npmrc"] +
      "strict-ssl=false\nregistry=http://user:secret@registry.local/\n//registry.local/:_authToken=secret\n",
  });
  expect(report.findings.filter((item) => item.rule === "registry").length).toBe(2);
  expect(JSON.stringify(report)).not.toContain("secret");
});

test("finds visible CI bypasses and non-frozen installs", async () => {
  const report = await scan({
    ...pnpm,
    ".github/workflows/build.yml":
      "jobs:\n  build:\n    steps:\n      - run: pnpm install --no-frozen-lockfile --minimum-release-age=0\n",
  });
  expect(report.findings.some((item) => item.rule === "ci-override")).toBe(true);
  expect(report.findings.some((item) => item.rule === "ci-install")).toBe(true);
});

test("keeps centrally excepted findings visible", async () => {
  const selectedPolicy = validatePolicy({
    ...policy,
    exceptions: [
      {
        repository: "org/repo",
        project: ".",
        rule: "release-age",
        reason: "Migration",
        expires: "2099-12-31",
      },
    ],
  });
  const report = await scan({ ...npm, ".npmrc": "ignore-scripts=true" }, selectedPolicy);
  expect(report.status).toBe("pass");
  expect(report.findings[0].exception?.reason).toBe("Migration");
  expect(summary([report])).toContain("excepted");
});

test.each(["2020-01-01", "2099-02-31"])("rejects expired or invalid exceptions: %s", (expires) => {
  expect(() =>
    validatePolicy({
      ...policy,
      exceptions: [
        { repository: "org/repo", project: ".", rule: "release-age", reason: "Migration", expires },
      ],
    }),
  ).toThrow();
});

test("escapes untrusted Markdown in reports", async () => {
  const report = await scan({ "package.json": '{"packageManager":"bun@1.4.2"}' });
  report.repository = "org/<script>|repo";
  expect(summary([report])).not.toContain("<script>");
});

test("discovery covers more than 200 repos and filters only archived repos", async () => {
  let argumentsUsed: string[] = [];
  const run: Command = async (args) => {
    argumentsUsed = args;
    return JSON.stringify([
      Array.from({ length: 205 }, (_, index) => ({
        full_name: `org/repo-${index}`,
        archived: index === 0,
        default_branch: "main",
      })),
    ]);
  };
  expect((await discoverRepositories("org", run)).length).toBe(204);
  expect(argumentsUsed).toContain("--paginate");
  expect(argumentsUsed).toContain("--slurp");
});

test("discovery rejects partial or invalid results", async () => {
  expect(
    discoverRepositories("org", async () => {
      throw new Error("API failed");
    }),
  ).rejects.toThrow();
  expect(discoverRepositories("org", async () => "{}")).rejects.toThrow();
});

test("continues after checkout failure and records empty repos", async () => {
  const repos = ["bad", "good", "empty"].map((name) => ({
    full_name: `org/${name}`,
    archived: false,
    default_branch: name === "empty" ? null : "main",
  }));
  const run: Command = async (args) => {
    if (args[1] === "api") return '[[{"ref":"refs/heads/main"}]]';
    if (args.includes("org/bad")) throw new Error("Checkout failed");
    const directory = args[4];
    await mkdir(directory);
    await writeFile(join(directory, "package.json"), npm["package.json"]);
    await writeFile(join(directory, ".npmrc"), npm[".npmrc"]);
    await writeFile(join(directory, "package-lock.json"), "{}");
    return "";
  };
  const reports = await scanOrganization(repos, policy, 2, run);
  expect(reports.map((report) => report.status)).toEqual(["scan-error", "pass", "empty"]);
  expect(exitCode(reports, false)).toBe(2);
});

test("treats zero branch refs as empty and never clones it", async () => {
  const reports = await scanOrganization(
    [{ full_name: "org/empty", archived: false, default_branch: "main" }],
    policy,
    1,
    async (args) => {
      expect(args[1]).toBe("api");
      return "[[]]";
    },
  );
  expect(reports[0].status).toBe("empty");
});

test("CLI writes reports and returns distinct reporting and enforcement results", async () => {
  const root = await fixture({ ...npm, ".npmrc": "ignore-scripts=true" });
  const output = await fixture({});
  const script = new URL("./scan-package-manager-config.ts", import.meta.url).pathname;
  for (const [flags, expected] of [
    [[], 0],
    [["--enforce"], 1],
  ] as const) {
    const process = Bun.spawn(
      ["bun", "run", script, "--root", root, "--output", output, ...flags],
      { stdout: "pipe", stderr: "pipe" },
    );
    await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text()]);
    expect(await process.exited).toBe(expected);
    const report = JSON.parse(await readFile(join(output, "package-manager-report.json"), "utf8"));
    expect(report.schemaVersion).toBe(1);
    expect(report.repositories[0].status).toBe("findings");
  }
});
