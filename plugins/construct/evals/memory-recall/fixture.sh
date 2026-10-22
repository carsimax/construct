#!/usr/bin/env bash
set -euo pipefail
git init -q
cat > dates.js <<'JS'
export function today(now = new Date()) {
  return now.toISOString().slice(0, 10)
}
JS
cat > dates.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { today } from './dates.js'

test('today returns the UTC calendar day', () => {
  assert.equal(today(new Date('2026-01-02T23:30:00Z')), '2026-01-02')
})
JS
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
printf 'script-shell=/bin/sh\n' > .npmrc
git add -A
git -c user.email=eval@example.com -c user.name=eval commit -qm "chore: initial dates module"

# Seed one decision with the plugin's own CLI. The plugin root is CLAUDE_PLUGIN_ROOT, else the PATH, else this
# script's plugin copy.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/bin/construct-memory" ]; then
  cli="$CLAUDE_PLUGIN_ROOT/bin/construct-memory"
elif command -v construct-memory >/dev/null 2>&1; then
  cli="$(command -v construct-memory)"
else
  cli="$here/../../bin/construct-memory"
fi
printf '%s' '{"title":"Dates are ISO 8601 UTC","content":"The project formats every date and time as ISO 8601 in UTC (toISOString), and never with the local timezone: no toLocaleString, toLocaleDateString, or getHours.","type":"decision","topic_key":"convention/dates"}' | node "$cli" save
