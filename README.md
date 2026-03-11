# Techfolk `.github`

Central security scanning for all Techfolk repos.

## What's included

| Check | Tool | Schedule | Description |
|-------|------|----------|-------------|
| Secret scanning | [Gitleaks](https://github.com/gitleaks/gitleaks) | Weekly Mon 08:00 UTC | Detects hardcoded secrets (API keys, tokens, passwords) across all org repos |
| Vulnerability scanning | [Trivy](https://github.com/aquasecurity/trivy) | Daily 06:00 UTC | Finds known vulnerabilities in dependencies (npm, NuGet, Go, Python, etc.) |
| Static analysis | [CodeQL](https://codeql.github.com/) | Daily 04:00 UTC | Semantic code analysis for security issues (JS/TS, Java/Kotlin, C#, Python, Go, etc.) |

## How it works

All workflows run centrally from this repo — no setup needed in individual repos. Each workflow:

1. **Discovers** all non-archived repos in the Techfolk-AS org
2. **Scans** each repo in parallel using a matrix strategy

### Gitleaks (secret scanning)
- Scans full git history for hardcoded secrets
- Runs weekly on Monday at 08:00 UTC

### Trivy (vulnerability scanning)
- Scans dependency files for known CVEs (CRITICAL and HIGH severity, unfixed excluded)
- Runs daily at 06:00 UTC

### CodeQL (static analysis)
- Auto-detects supported languages per repo and runs semantic analysis
- Results are uploaded to this repo's **Security** tab (SARIF)
- Runs daily at 04:00 UTC

All workflows can also be triggered manually from **Actions > [Workflow Name] > Run workflow**.

## Setup

The workflows require an `ORG_PAT` secret — a GitHub Personal Access Token (or Fine-grained PAT) with `repo` scope for the Techfolk-AS org.

Add it at the org level: **Settings > Secrets and variables > Actions > New organization secret**.
