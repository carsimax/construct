// Subagent lifecycle hook for the Stop gates: `start` (SubagentStart) records an
// open agent for the session and `stop` (SubagentStop) removes it, so
// review-gate.mjs and risk-line.mjs stay silent while writers may still be
// running. One file per agent under subagentDir keeps parallel agents from
// racing on a shared record; each file is written to a temp name and renamed.
// Never blocks, never prints: any error means exit 0 (the gates then run as today).
// Usage: node subagent-count.mjs start|stop   (hook JSON on stdin: session_id, agent_id)
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { readInput, safeName, subagentDir } from './hook-io.mjs'

const ANON = 'anon-'

function main() {
  const mode = process.argv[2]
  const input = readInput()
  if (!input || (mode !== 'start' && mode !== 'stop')) return
  const dir = subagentDir(input.session_id)
  // The hook input's agent_id keys the entry. Without one, a start is anonymous
  // and a stop closes the oldest entry of any name (shortcut: entries may close
  // out of order, upgrade if the host stops sending agent_id).
  const id = typeof input.agent_id === 'string' && input.agent_id !== '' ? safeName(input.agent_id) : null

  if (mode === 'start') {
    mkdirSync(dir, { recursive: true })
    const name = id ?? `${ANON}${Date.now()}-${randomBytes(4).toString('hex')}`
    const temporary = join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`)
    try {
      writeFileSync(temporary, `${JSON.stringify({ at: new Date().toISOString() })}\n`)
      renameSync(temporary, join(dir, name))
    } catch (error) {
      rmSync(temporary, { force: true })
      throw error
    }
    return
  }

  // A stop whose id has a file closes it. A stop with no id closes the oldest
  // entry of any name; a stop with an unknown id (a duplicate stop, or a start
  // that carried no id) closes only the oldest anonymous entry, so it never
  // closes another live agent.
  if (id && existsSync(join(dir, id))) {
    rmSync(join(dir, id), { force: true })
    return
  }
  const oldest = readdirSync(dir)
    .filter((name) => !name.startsWith('.') && (!id || name.startsWith(ANON)))
    .flatMap((name) => {
      try {
        return [{ name, at: statSync(join(dir, name)).mtimeMs }]
      } catch {
        return [] // removed by a concurrent stop
      }
    })
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))[0]
  if (oldest) rmSync(join(dir, oldest.name), { force: true })
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
