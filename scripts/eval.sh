#!/usr/bin/env bash
# Runs the construct behavior evals against a temporary copy of the plugin,
# so results and scaffolding never land in the repository.
#
# Usage: scripts/eval.sh [extra claude plugin eval options]
# Results: <copy>/evals/results/<timestamp>/ (path printed at the end)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
copy_root="$(mktemp -d)"
plugin_copy="$copy_root/construct"

cp -R "$repo_root/plugins/construct" "$plugin_copy"
rm -rf "$plugin_copy/evals/results"

cd "$plugin_copy"
status=0
# A * in a Bash rule matches any text, spaces and quotes included (https://code.claude.com/docs/en/permissions#wildcard-patterns), so this covers node "<root>/bin/construct-memory" with or without quotes.
claude plugin eval . \
  --scaffold \
  --trust-plugin \
  --runs 1 \
  --model sonnet \
  --allow-tools Write Edit "Bash(npm test*)" "Bash(node --test*)" "Bash(git status*)" "Bash(git diff*)" "Bash(git log*)" "Bash(construct-memory *)" "Bash(node *construct-memory *)" \
  "$@" || status=$?

echo "Plugin copy and results: $plugin_copy (remove it when done)"
exit "$status"
