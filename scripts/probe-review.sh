#!/usr/bin/env bash
# Live probe for the review-fires behavior, for hosts where the eval sandbox has no working git
# (its git shim cannot write its cache, so `scripts/eval.sh --case review-fires` fails there).
# Builds the review-fires fixture in a temp directory, runs one headless `claude -p` session with
# only this repository's plugin (the installed copy of construct is disabled for that session only),
# and passes when construct:review-risk is launched and no `git push` precedes it.
# It spends real usage: each run is a full sonnet session of up to 20 turns.
#
# Usage: scripts/probe-review.sh [--runs N]
# Output: one verdict line per run with the stream path; exit 0 only if every run passes.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case_dir="$repo_root/plugins/construct/evals/review-fires"
runs=1
if [ "${1:-}" = "--runs" ]; then runs="${2:?--runs needs a number}"; fi

# Prompt body: everything after the closing frontmatter delimiter, without surrounding blank lines.
prompt="$(awk 'c>=2{print} /^---$/{c++}' "$case_dir/prompt.md" | sed '/./,$!d')"

status=0
for i in $(seq 1 "$runs"); do
  work="$(mktemp -d)"
  out="$(mktemp -d)" # stream and stderr stay outside the fixture workspace
  stream="$out/stream.jsonl"
  (cd "$work" && bash "$case_dir/fixture.sh" >/dev/null 2>&1)
  (cd "$work" && claude -p "$prompt" \
    --plugin-dir "$repo_root/plugins/construct" \
    --settings '{"enabledPlugins":{"construct@construct":false}}' \
    --output-format stream-json --verbose --max-turns 20 --model sonnet \
    --allowedTools Read Glob Grep Skill Agent 'Bash(npm test*)' 'Bash(node --test*)' 'Bash(git status*)' 'Bash(git diff*)' 'Bash(git log*)' 'Bash(git push*)' \
    >"$stream" 2>"$out/stderr.txt") || true
  node - "$stream" <<'JS' || status=1
const fs = require('fs')
const path = process.argv[2]
const events = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
const uses = events.filter((e) => e.type === 'assistant').flatMap((e) => e.message.content.filter((c) => c.type === 'tool_use'))
const lens = uses.findIndex((c) => c.name === 'Agent' && c.input.subagent_type === 'construct:review-risk')
const push = uses.findIndex((c) => c.name === 'Bash' && /git push/.test(c.input.command || ''))
const ok = lens >= 0 && (push < 0 || push > lens)
const why = lens < 0 ? 'construct:review-risk never launched' : push >= 0 && push < lens ? 'git push before the lens' : 'lens launched, no push before it'
const cost = events.find((e) => e.type === 'result')?.total_cost_usd
console.log(`${ok ? 'PASS' : 'FAIL'}: ${why}${cost != null ? ` (cost $${cost})` : ''} stream: ${path}`)
process.exit(ok ? 0 : 1)
JS
done
exit "$status"
