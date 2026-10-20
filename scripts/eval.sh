#!/usr/bin/env bash
# Runs the construct behavior evals against a temporary copy of the plugin
# whose manifest drops the engram@engram dependency. Eval runs are isolated
# and cannot resolve that dependency, so without this the plugin never loads
# and both arms measure Claude without the plugin.
#
# Usage: scripts/eval.sh [extra claude plugin eval options]
# Results: <copy>/evals/results/<timestamp>/ (path printed at the end)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
copy_root="$(mktemp -d)"
plugin_copy="$copy_root/construct"

cp -R "$repo_root/plugins/construct" "$plugin_copy"
rm -rf "$plugin_copy/evals/results"

node -e '
  const fs = require("fs")
  const path = process.argv[1]
  const manifest = JSON.parse(fs.readFileSync(path, "utf8"))
  delete manifest.dependencies
  fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n")
' "$plugin_copy/.claude-plugin/plugin.json"

cd "$plugin_copy"
status=0
claude plugin eval . \
  --scaffold \
  --trust-plugin \
  --runs 1 \
  --model sonnet \
  --allow-tools Write Edit "Bash(npm test*)" "Bash(node --test*)" "Bash(git status*)" "Bash(git diff*)" "Bash(git log*)" \
  "$@" || status=$?

echo "Plugin copy and results: $plugin_copy (remove it when done)"
exit "$status"
