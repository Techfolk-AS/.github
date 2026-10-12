# Techfolk `.github`

Central security scanning and organization automation for Techfolk.

## What's included

### PR-level scanning (gates merges)

Every pull request is scanned before it can be merged. Individual repos call reusable workflows defined here.

| Check | Tool | Reusable workflow | Description |
|-------|------|-------------------|-------------|
| Secret scanning | [Gitleaks](https://github.com/gitleaks/gitleaks) | `reusable-gitleaks.yml` | Detects hardcoded secrets in the PR diff and full history |
| Vulnerability scanning | [Grype](https://github.com/anchore/grype) | `reusable-grype.yml` | Finds CRITICAL/HIGH CVEs in dependencies |

### Scheduled org-wide scanning (catch-up)

Centrally-run scans that cover all repos on a schedule — catches new CVE disclosures against already-merged code and secrets from before PR scanning was enabled.

| Check | Tool | Schedule | Description |
|-------|------|----------|-------------|
| Secret scanning | [Gitleaks](https://github.com/gitleaks/gitleaks) | Daily 08:00 UTC | Scans full git history across all org repos |
| Vulnerability scanning | [Grype](https://github.com/anchore/grype) | Daily 06:00 UTC | Scans dependency files across all org repos |
| Package manager configuration | TypeScript scanner with Bun | Weekdays 07:43 UTC | Reports npm/pnpm policy gaps across all non-archived repos |

### Package manager policy

The package manager scan runs in **reporting mode**. Findings do not block merges or
fail the scheduled workflow. Incomplete discovery, checkout failures, and malformed
configuration fail the run so missing coverage is visible. The workflow publishes an
Actions summary and a JSON artifact retained for 14 days. It sends no chat alerts.

The central policy is `.github/package-manager-policy.json`. Its baseline requires
a three-day release cooldown, dependency scripts blocked by default or explicitly
approved, and HTTPS registries with certificate verification. Manager version
ambiguity, missing lockfiles, visible CI bypasses, and non-frozen install commands
are advisory findings during this rollout. pnpm's exotic dependency and trust-policy
controls are also reported as recommendations.

The scanner supports **npm 11.10 through 12.x** and **pnpm 10.16 through 12.x**.
It identifies Yarn and Bun projects as **not assessed**; repositories without
projects are **not applicable**. A missing version is an advisory finding and
cannot establish version-dependent defaults. Version declarations and conflicting
lockfiles are checked together.

For npm, commit `.npmrc`:

```ini
min-release-age=3
ignore-scripts=true
```

npm 12's default-deny `allowScripts` policy can replace `ignore-scripts=true` when
reviewed dependency builds are needed. Do not enable `dangerously-allow-all-scripts`.

For pnpm, commit `pnpm-workspace.yaml`:

```yaml
minimumReleaseAge: 4320 # minutes, three days
blockExoticSubdeps: true # pnpm 10.26+
trustPolicy: no-downgrade # pnpm 10.21+
```

pnpm 10+ blocks unapproved dependency builds by default. Use `allowBuilds` on
10.26+ to approve individual packages. For pnpm 11+, set
`minimumReleaseAgeIgnoreMissingTime: false` to reject packages without publish
timestamps. Explicitly configuring `minimumReleaseAge` makes
`minimumReleaseAgeStrict` default to `true`; writing it explicitly is optional:

```yaml
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
```

Leave `trustLockfile` disabled on versions that support it (11.3+). pnpm 11+ reads
non-registry settings from the workspace file rather than `.npmrc`.

Pin an exact supported version in `package.json`, such as
`"packageManager": "pnpm@10.26.0"`, and use the same version in CI.

#### Run locally

Install Bun 1.4.2 and the scanner's locked dependencies:

```sh
bun install --frozen-lockfile --ignore-scripts
bun test
bun run typecheck
bun run scripts/scan-package-manager-config.ts --root /path/to/repo --repository Techfolk-AS/example
```

Run from this central checkout. Target repositories are read as data; their
dependencies, scripts, hooks, and Bun configuration are not loaded. Symlinked
configuration and oversized configuration files produce scan errors. Generated
directories listed in the central policy are excluded. Workspace members inherit
their workspace's policy; independent nested projects are checked separately.

The command writes `reports/package-manager-report.json` and
`reports/package-manager-summary.md`. Add `--enforce` to exit 1 on unexcepted error
findings; reporting mode exits 0 on findings. Both modes exit 2 on scan errors.
Advisory findings, including unsupported managers, remain visible in either mode.
Do not use enforcement as an organization-wide compliance gate until those
coverage gaps have been reviewed.

To scan the organization locally, authenticate `gh` with repository read access:

```sh
bun run scripts/scan-org-package-managers.ts --org Techfolk-AS --concurrency 4
```

Discovery uses all API pages and includes private repos visible to the credential.
The runner scans default branches, records empty repos, continues after individual
failures, and does not use GitHub's matrix size limit. Full organization coverage
requires a token that can read **every** organization repository; a restricted
token cannot discover repositories hidden from it.

#### Exceptions and limits

Release-age exclusions require central review. Add an exact repository, project
directory, and rule to `exceptions`, with a reason and expiry date:

```json
{
  "repository": "Techfolk-AS/example",
  "project": ".",
  "rule": "release-age-exclusions",
  "reason": "Allow the reviewed internal package during migration",
  "expires": "2026-11-01"
}
```

Excepted findings stay in the report. Expired or malformed exceptions fail scanner
setup. Target repos cannot supply policy exceptions to the scheduled scanner.

CI command inspection is advisory and cannot evaluate arbitrary shell code,
external reusable workflows, global configuration, or developer machines.
The scan checks configuration, not dependency release timestamps or malware.
In particular, pnpm 10's release-age setting does not establish that a previously
generated lockfile was checked. Grype remains the vulnerability scanner.

After reviewing the baseline, a separate rollout can add a reusable PR workflow
and required `Package manager policy` status check. This change does not update
caller workflows or organization rulesets.

## How it works

### PR scanning

Each repo has a lightweight caller workflow (`.github/workflows/security.yml`) that invokes the reusable workflows on pull requests:

```yaml
name: Security
on:
  pull_request:
    branches: [main, master]
jobs:
  gitleaks:
    uses: Techfolk-AS/.github/.github/workflows/reusable-gitleaks.yml@main
  grype:
    uses: Techfolk-AS/.github/.github/workflows/reusable-grype.yml@main
```

An **org-level ruleset** requires the `Secret scan` and `Vulnerability scan` status checks to pass before merging, enforcing scanning across all repos.

### Scheduled scanning

The scheduled workflows run centrally from this repo:

1. **Discover** all non-archived repos in the Techfolk-AS org
2. **Scan** each repo in parallel using a matrix strategy

All workflows can also be triggered manually from **Actions > [Workflow Name] > Run workflow**.

## Adding the caller workflow to a repo

**New repos:** Use an org template repo that includes `.github/workflows/security.yml`, or add it from the starter workflow in the Actions tab.

**Existing repos:** Run the bootstrap script to add the caller workflow to all repos at once:

```bash
./scripts/bootstrap-security-workflow.sh
```

The script clones each repo, adds the caller workflow, and pushes a branch. Review and merge the branches.

## Setup

### All team membership

`sync-all-team.yml` adds missing Techfolk-AS organization members (including owners) to
the [`all` team](https://github.com/orgs/Techfolk-AS/teams/all) hourly at minute 17 UTC.
It paginates both member lists, preserves existing team roles, and never removes members.
New invitees are included after accepting the organization invitation. Manually removing
someone from the team will cause the next run to add them again.

1. Create a fine-grained PAT with **Techfolk-AS** as its resource owner and organization
   **Members: Read and write** permission, using an org owner or `all` team maintainer's
   account. Obtain organization approval if required.
2. Save it as the repository Actions secret **`TEAM_SYNC_TOKEN`** (or an organization
   secret accessible to this repository). The built-in `GITHUB_TOKEN` is insufficient.
3. Merge the workflow into the default branch, then select **Actions > Sync all team >
   Run workflow** for the initial bulk assignment. Subsequent runs are scheduled;
   GitHub can delay them, and disables public-repository schedules after 60 days of
   repository inactivity. Renew the token before it expires.

The team must not be managed by identity-provider synchronization. API failures fail
the run; rerunning safely picks up remaining members.

Run the local check without credentials or API writes: `python3 scripts/test_sync_all_team.py`.

### Scheduled scans

The scheduled workflows require the following secrets:

| Secret | Purpose |
|--------|---------|
| `ORG_PAT` | GitHub Personal Access Token with `repo` scope for the Techfolk-AS org |
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-...`) from your Slack app (needs `chat:write` scope) |
| `SLACK_CHANNEL_ID` | Channel ID for the alerts channel (e.g. `C0123456789`) |

Add them at the org level: **Settings > Secrets and variables > Actions > New organization secret**.

The Slack app bot must be invited to the alerts channel (`/invite @botname`). When any scheduled scan fails, a notification is sent to the channel.

### PR scans

No additional secrets needed — each repo's `GITHUB_TOKEN` is sufficient since the caller workflow checks out its own code.

### Org ruleset (manual step)

Create an org-level ruleset to enforce the checks:

1. **Organization Settings > Repositories > Rulesets > New ruleset**
2. Target: **All repositories**
3. Target branches: **Default branch**
4. Rule: **Require status checks to pass before merging**
   - Add required checks: `Secret scan` and `Vulnerability scan`
5. Enforcement: **Active**
