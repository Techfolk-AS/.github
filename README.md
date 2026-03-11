# Techfolk `.github`

Org-wide reusable workflows, security checks, and templates for all Techfolk repos.

## What's included

| Check | Tool | Description |
|-------|------|-------------|
| Secret scanning | [Gitleaks](https://github.com/gitleaks/gitleaks) | Detects hardcoded secrets (API keys, tokens, passwords) |
| Dependency review | [dependency-review-action](https://github.com/actions/dependency-review-action) | Flags vulnerable or problematic dependencies on PRs |
| SAST | [CodeQL](https://codeql.github.com/) | Static analysis to find security vulnerabilities in code |

## Quick start

### Option 1: Use the workflow template (recommended)

1. Go to your repo on GitHub
2. Click **Actions** > **New workflow**
3. Under "By Techfolk-AS", select **Techfolk Security Checks**
4. Adjust the `languages` array for CodeQL to match your repo
5. Commit the workflow

### Option 2: Call reusable workflows directly

Add to `.github/workflows/security.yml` in your repo:

```yaml
name: Security Checks

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read
  security-events: write

jobs:
  gitleaks:
    uses: Techfolk-AS/.github/.github/workflows/reusable-gitleaks.yml@main
    secrets: inherit

  dependency-review:
    if: github.event_name == 'pull_request'
    uses: Techfolk-AS/.github/.github/workflows/reusable-dependency-review.yml@main
    with:
      fail-on-severity: "high"

  codeql:
    uses: Techfolk-AS/.github/.github/workflows/reusable-codeql.yml@main
    with:
      languages: '["javascript-typescript"]'
    permissions:
      security-events: write
      actions: read
      contents: read
```

### Dependabot

Copy [`dependabot-template.yml`](./dependabot-template.yml) to `.github/dependabot.yml` in your repo and uncomment the ecosystems you need.

## Supported CodeQL languages

`javascript-typescript`, `python`, `java-kotlin`, `csharp`, `go`, `ruby`, `swift`, `c-cpp`

## Gitleaks license

The Gitleaks GitHub Action requires a license key for organization use. Add the `GITLEAKS_LICENSE` secret at the org level in **Settings > Secrets and variables > Actions**.

If you don't have a license, the action will still run in a limited mode.
