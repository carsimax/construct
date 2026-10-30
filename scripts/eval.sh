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
# review-fires cannot run in the eval sandbox (its git shim cannot write its cache and the review
# skill's `!` line is denied), so it stays out of the suite; scripts/probe-review.sh reuses its fixture and prompt.
rm -rf "$plugin_copy/evals/review-fires"
# A case with `arms: claudemd` also runs as <case>--claudemd, its fixture writing evals/_claudemd/CLAUDE.md.
# _claudemd holds no case.yaml or prompt.md, so the harness does not treat it as a case.
bash "$repo_root/scripts/claudemd/make-variants.sh" "$plugin_copy/evals" "$plugin_copy/evals/_claudemd/CLAUDE.md"

cd "$plugin_copy"
status=0
claude plugin eval . \
  --scaffold \
  --trust-plugin \
  --keep-temp \
  --runs 1 \
  --model sonnet \
  --allow-tools Write Edit "Bash(npm test*)" "Bash(node --test*)" "Bash(git status*)" "Bash(git diff*)" "Bash(git log*)" "Bash(ls *)" "Bash(cat *)" "Bash(head *)" "Bash(tail *)" \
  "$@" || status=$?

# Outcome checks: a case's outcome.sh runs in a fresh temp dir against each kept run workspace (both arms).
aggregate="$(ls -td "$plugin_copy"/evals/results/*/ 2>/dev/null | head -1 || true)aggregate-result.json"
if [ -f "$aggregate" ]; then
  node - "$aggregate" "$plugin_copy/evals" <<'JS' || echo "outcome checks failed to run" >&2
const { readFileSync, writeFileSync, existsSync, chmodSync, mkdtempSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { dirname, join } = require('node:path');
const { tmpdir } = require('node:os');
const [aggregateFile, evalsDir] = process.argv.slice(2);
const checkRun = (script, tracePath) => {
  if (!tracePath || !existsSync(tracePath)) return { passed: false, error: 'no trace' };
  const kept = dirname(dirname(tracePath));
  const workspace = join(kept, 'sealed/home/cwd');
  try { chmodSync(kept, 0o700); chmodSync(join(kept, 'sealed'), 0o700); } catch {}
  if (!existsSync(workspace)) return { passed: false, error: `no workspace at ${workspace}` };
  const cwd = mkdtempSync(join(tmpdir(), 'outcome-'));
  const res = spawnSync('bash', [script, workspace], { cwd, encoding: 'utf8' });
  rmSync(cwd, { recursive: true, force: true });
  // The trace is JSONL; a run that used AskUserQuestion needed a human.
  const askedHuman = /"name":\s*"AskUserQuestion"/.test(readFileSync(tracePath, 'utf8'));
  return { passed: res.status === 0, askedHuman };
};
const cases = [];
for (const c of JSON.parse(readFileSync(aggregateFile, 'utf8')).cases) {
  const script = join(evalsDir, c.name, 'outcome.sh');
  if (!existsSync(script)) continue;
  const arms = {};
  for (const arm of ['with', 'without']) arms[arm] = (c.arms?.[arm] ?? []).map((r) => checkRun(script, r.tracePath));
  cases.push({ name: c.name, arms });
}
writeFileSync(join(dirname(aggregateFile), 'outcomes.json'), JSON.stringify({ cases }, null, 2));
JS
  node "$repo_root/scripts/eval-summary.mjs" "$aggregate" "$(dirname "$aggregate")/outcomes.json" || true
fi

echo "Kept run dirs (remove when done): /private/tmp/e-*"
echo "Plugin copy and results: $plugin_copy (remove it when done)"
exit "$status"
