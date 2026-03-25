#!/usr/bin/env bash
#
# Bootstrap or update the security caller workflow in all non-archived org repos.
# Skips repos where the workflow is already up to date.
#
# Usage: ./scripts/bootstrap-security-workflow.sh [--dry-run]
#
# Options:
#   --dry-run  Show what would be done without making any changes
#
# Requires: gh CLI authenticated with org access

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "=== DRY RUN — no changes will be made ==="
  echo
fi

ORG="Techfolk-AS"
WORKFLOW_PATH=".github/workflows/security.yml"
BRANCH="chore/replace-trivy-with-grype"
COMMIT_MSG="Replace Trivy with Grype for PR security scanning

Calls reusable gitleaks and grype workflows from the central .github repo
to enforce secret and vulnerability scanning on all pull requests."

WORKFLOW_CONTENT='name: Security
on:
  pull_request:
    branches: [main, master]
jobs:
  gitleaks:
    uses: Techfolk-AS/.github/.github/workflows/reusable-gitleaks.yml@main
  grype:
    uses: Techfolk-AS/.github/.github/workflows/reusable-grype.yml@main
'

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

repos=$(gh repo list "$ORG" --no-archived --json name --jq '.[].name' --limit 200)

for repo in $repos; do
  echo "--- $ORG/$repo ---"

  exists=false
  if gh api "repos/$ORG/$repo/contents/$WORKFLOW_PATH" --silent 2>/dev/null; then
    exists=true
  fi

  if $DRY_RUN; then
    if $exists; then
      echo "  Would update $WORKFLOW_PATH and push branch $BRANCH"
    else
      echo "  Would add $WORKFLOW_PATH and push branch $BRANCH"
    fi
    continue
  fi

  repo_dir="$TMPDIR/$repo"
  gh repo clone "$ORG/$repo" "$repo_dir" -- --depth 1 --quiet

  mkdir -p "$repo_dir/.github/workflows"
  echo "$WORKFLOW_CONTENT" > "$repo_dir/$WORKFLOW_PATH"

  # Skip if content is already up to date
  if git -C "$repo_dir" diff --quiet -- "$WORKFLOW_PATH" 2>/dev/null; then
    echo "  Already up to date"
    rm -rf "$repo_dir"
    continue
  fi

  git -C "$repo_dir" checkout -b "$BRANCH"
  git -C "$repo_dir" add "$WORKFLOW_PATH"
  git -C "$repo_dir" commit -m "$COMMIT_MSG" --quiet
  git -C "$repo_dir" push origin "$BRANCH" --quiet

  echo "  Pushed branch $BRANCH"

  rm -rf "$repo_dir"
done

echo "Done. Review and merge the branches in each repo."
