// Pure checks behind `/construct doctor` (S8). Each takes the raw output of one probe (a string, or null when
// the probe failed or timed out) and returns a row `{ ok, label, hint }`. No `$` calls here: register.js runs
// the probes.

export const MIN_CLAUDE = '2.1.304'
export const MIN_NODE = '22.16'

// The first x.y.z in the text as numbers, or null.
function triple(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function atLeast(have, want) {
  for (let i = 0; i < 3; i++) if (have[i] !== want[i]) return have[i] > want[i]
  return true
}

// `version` is $.session.version().version (or `claude --version` output): it holds the first x.y.z.
export function checkClaude(version) {
  const have = triple(version)
  const label = `Claude Code ${have ? have.join('.') : 'version unknown'} (needs >= ${MIN_CLAUDE})`
  const ok = have !== null && atLeast(have, triple(MIN_CLAUDE))
  return { ok, label, hint: `update Claude Code to ${MIN_CLAUDE} or later (claude update)` }
}

// `node --version` output, for example `v22.16.0`.
export function checkNode(text) {
  const have = triple(text)
  const label = `Node ${have ? have.join('.') : 'version unknown'} (needs >= ${MIN_NODE})`
  return { ok: have !== null && atLeast(have, triple(`${MIN_NODE}.0`)), label, hint: `install Node ${MIN_NODE} or later; the hooks need it` }
}

export function formatReport(rows) {
  return ['Construct doctor', ...rows.map((r) => (r.ok ? `✓ ${r.label}` : `✗ ${r.label} — ${r.hint}`))].join('\n')
}
