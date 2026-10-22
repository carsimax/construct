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

// Run through `node -e`: prints `ok` when node:sqlite loads and has the FTS5 trigram tokenizer. Node 22.13-22.15 and
// 23.x load it without fts5, so a version check alone is not enough. install.sh carries the same probe.
export const MEMORY_PROBE =
  "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').exec(\"CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram')\"); console.log('ok')"

// `out` is the stdout of `node -e MEMORY_PROBE`, or null when it failed or timed out.
export function checkMemory(out) {
  return {
    ok: String(out ?? '').trim() === 'ok',
    label: 'Memory (node:sqlite with FTS5 trigram)',
    hint: `use Node 22.16+; node:sqlite with the FTS5 trigram tokenizer must load`,
  }
}

// `out` is the stdout of `construct-memory doctor --json` ([{ check, ok, detail }]), or null when the command
// could not run. Anything that is not a non-empty list of checks is one failed row, never a throw.
export function memoryDoctorRows(out) {
  let list = null
  try {
    list = JSON.parse(String(out ?? ''))
  } catch {}
  if (!Array.isArray(list) || list.length === 0 || !list.every((c) => c && typeof c.check === 'string')) {
    return [{ ok: false, label: 'memory doctor', hint: 'could not run' }]
  }
  return list.map((c) => ({ ok: c.ok === true, label: `memory: ${c.check}`, hint: String(c.detail ?? '') }))
}

export function formatReport(rows) {
  return ['Construct doctor', ...rows.map((r) => (r.ok ? `✓ ${r.label}` : `✗ ${r.label} — ${r.hint}`))].join('\n')
}
