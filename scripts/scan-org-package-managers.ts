import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import {
  exitCode,
  loadPolicy,
  scanRepository,
  summary,
  writeReports,
  type Policy,
  type Report,
} from "./scan-package-manager-config.ts";

export type Repository = { full_name: string; archived: boolean; default_branch: string | null };
export type Command = (args: string[]) => Promise<string>;

const command: Command = async (args) => {
  const process = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const [output, , code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  // Never forward subprocess output which might contain credentials or repo content.
  if (code !== 0) throw new Error(`Command failed with exit code ${code}`);
  return output;
};

export async function discoverRepositories(
  org: string,
  run: Command = command,
): Promise<Repository[]> {
  if (!/^[\w-]+$/.test(org)) throw new Error("Invalid organization name");
  const pages: unknown = JSON.parse(
    await run(["gh", "api", "--paginate", "--slurp", `orgs/${org}/repos?per_page=100&type=all`]),
  );
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
    throw new Error("Invalid repository discovery response");
  const repositories = pages.flat() as Repository[];
  for (const repo of repositories) {
    if (
      !repo ||
      typeof repo.full_name !== "string" ||
      !new RegExp(`^${org}/[\\w.-]+$`, "i").test(repo.full_name) ||
      typeof repo.archived !== "boolean" ||
      !(typeof repo.default_branch === "string" || repo.default_branch === null)
    )
      throw new Error("Invalid repository metadata");
  }
  return repositories
    .filter((repo) => !repo.archived)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function scanOrganization(
  repositories: Repository[],
  policy: Policy,
  concurrency: number,
  run: Command = command,
): Promise<Report[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error("Concurrency must be between 1 and 8");
  const reports: Report[] = new Array(repositories.length);
  let cursor = 0;
  async function worker() {
    while (cursor < repositories.length) {
      const index = cursor++;
      const repo = repositories[index];
      const temporary = await mkdtemp(join(tmpdir(), "package-manager-scan-"));
      try {
        if (!repo.default_branch) {
          reports[index] = {
            repository: repo.full_name,
            status: "empty",
            projects: [],
            findings: [],
          };
          continue;
        }
        const refs: unknown = JSON.parse(
          await run([
            "gh",
            "api",
            `repos/${repo.full_name}/git/matching-refs/heads/`,
            "--paginate",
            "--slurp",
          ]),
        );
        if (!Array.isArray(refs) || refs.some((page) => !Array.isArray(page)))
          throw new Error("Invalid branch response");
        if (refs.flat().length === 0) {
          reports[index] = {
            repository: repo.full_name,
            status: "empty",
            projects: [],
            findings: [],
          };
          continue;
        }
        const checkout = join(temporary, "repository");
        await run([
          "gh",
          "repo",
          "clone",
          repo.full_name,
          checkout,
          "--",
          "--depth=1",
          "--single-branch",
          "--no-tags",
          "--branch",
          repo.default_branch,
        ]);
        reports[index] = await scanRepository(checkout, repo.full_name, policy);
      } catch {
        reports[index] = {
          repository: repo.full_name,
          status: "scan-error",
          projects: [],
          findings: [
            {
              project: ".",
              file: ".",
              rule: "scan-error",
              severity: "error",
              message: "Repository discovery, checkout, or scanning did not complete.",
              fix: "Check repository access and rerun the workflow.",
            },
          ],
        };
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
      console.log(`${repo.full_name}: ${reports[index].status}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, repositories.length) }, worker));
  return reports;
}

if (import.meta.main) {
  let reports: Report[] = [];
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      org: { type: "string", default: "Techfolk-AS" },
      output: { type: "string", default: "reports" },
      concurrency: { type: "string", default: "4" },
      enforce: { type: "boolean", default: false },
    },
  });
  try {
    const policy = await loadPolicy();
    reports = await scanOrganization(
      await discoverRepositories(values.org!),
      policy,
      Number(values.concurrency),
    );
    process.exitCode = exitCode(reports, values.enforce!);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Organization scan failed");
    reports.push({
      repository: values.org!,
      status: "scan-error",
      projects: [],
      findings: [
        {
          project: ".",
          file: ".",
          rule: "scan-error",
          severity: "error",
          message: "Organization discovery or scanner setup failed; coverage is incomplete.",
          fix: "Check token access, central policy, and workflow logs, then rerun.",
        },
      ],
    });
    process.exitCode = 2;
  }
  await writeReports(reports, values.output!);
  console.log(summary(reports));
}
