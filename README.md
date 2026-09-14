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
