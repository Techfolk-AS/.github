#!/usr/bin/env bash
#
# Bootstrap the security caller workflow into all non-archived org repos.
# Skips repos that already have .github/workflows/security.yml.
#
# Usage: ./scripts/bootstrap-security-workflow.sh
#
# Requires: gh CLI authenticated with org access

set -euo pipefail

ORG="Techfolk-AS"
WORKFLOW_PATH=".github/workflows/security.yml"
BRANCH="chore/add-security-workflow"
COMMIT_MSG="Add PR security scanning workflow

Calls reusable gitleaks and trivy workflows from the central .github repo
to enforce secret and vulnerability scanning on all pull requests."

WORKFLOW_CONTENT='name: Security
on:
  pull_request:
    branches: [main, master]
jobs:
  gitleaks:
    uses: Techfolk-AS/.github/.github/workflows/reusable-gitleaks.yml@main
  trivy:
    uses: Techfolk-AS/.github/.github/workflows/reusable-trivy.yml@main
'

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

repos=$(gh repo list "$ORG" --no-archived --json name --jq '.[].name' --limit 200)

for repo in $repos; do
  echo "--- $ORG/$repo ---"

  # Check if the workflow file already exists on the default branch
  if gh api "repos/$ORG/$repo/contents/$WORKFLOW_PATH" --silent 2>/dev/null; then
    echo "  Skipping: $WORKFLOW_PATH already exists"
    continue
  fi

  repo_dir="$TMPDIR/$repo"
  gh repo clone "$ORG/$repo" "$repo_dir" -- --depth 1 --quiet

  mkdir -p "$repo_dir/.github/workflows"
  echo "$WORKFLOW_CONTENT" > "$repo_dir/$WORKFLOW_PATH"

  git -C "$repo_dir" checkout -b "$BRANCH"
  git -C "$repo_dir" add "$WORKFLOW_PATH"
  git -C "$repo_dir" commit -m "$COMMIT_MSG" --quiet
  git -C "$repo_dir" push origin "$BRANCH" --quiet

  echo "  Pushed branch $BRANCH"

  rm -rf "$repo_dir"
done

echo "Done. Review and merge the branches in each repo."
