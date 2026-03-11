# Techfolk `.github`

Central security scanning for all Techfolk repos.

## What's included

| Check | Tool | Description |
|-------|------|-------------|
| Secret scanning | [Gitleaks](https://github.com/gitleaks/gitleaks) | Detects hardcoded secrets (API keys, tokens, passwords) across all org repos |

## How it works

The gitleaks workflow runs centrally from this repo — no setup needed in individual repos.

- **Schedule**: Weekly on Monday at 08:00 UTC
- **Manual**: Can be triggered from **Actions > Gitleaks Org Scan > Run workflow**

It automatically discovers all non-archived repos in the org and scans each one in parallel.

## Setup

The workflow requires an `ORG_PAT` secret — a GitHub Personal Access Token (or Fine-grained PAT) with `repo` scope for the Techfolk-AS org.

Add it at the org level: **Settings > Secrets and variables > Actions > New organization secret**.
