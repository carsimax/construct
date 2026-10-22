#!/usr/bin/env bash
# Runs the construct behavior evals against a temporary copy of the plugin,
# so results and scaffolding never land in the repository.
#
# Usage: scripts/eval.sh [extra claude plugin eval options]
# Results: <copy>/evals/results/<timestamp>/ (path printed at the end)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
copy_root="$(cd "$(mktemp -d)" && pwd -P)" # physical path: the agent sees /private/var, not /var
plugin_copy="$copy_root/construct"

cp -R "$repo_root/plugins/construct" "$plugin_copy"
rm -rf "$plugin_copy/evals/results"

cd "$plugin_copy"
status=0
# The node rules are pinned to this copy's CLI path, quoted or not, so other node commands that merely mention construct-memory stay denied.
# Read-only ls, cat, head, and tail are allowed so a chained command that includes a memory search is not denied as a whole.
claude plugin eval . \
  --scaffold \
  --trust-plugin \
  --runs 1 \
  --model sonnet \
  --allow-tools Write Edit "Bash(npm test*)" "Bash(node --test*)" "Bash(git status*)" "Bash(git diff*)" "Bash(git log*)" "Bash(ls *)" "Bash(cat *)" "Bash(head *)" "Bash(tail *)" "Bash(construct-memory *)" "Bash(node $plugin_copy/bin/construct-memory *)" "Bash(node \"$plugin_copy/bin/construct-memory\" *)" \
  "$@" || status=$?

echo "Plugin copy and results: $plugin_copy (remove it when done)"
exit "$status"
