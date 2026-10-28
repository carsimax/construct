import { atom, read, update } from 'claude-code'
import { effortFor, modelFor, roleFor } from './routing.js'
import { buildBand } from './band/layout.js'
import {
  SCHEMA_VERSION,
  filePathOf,
  initialState,
  isBlockingTool,
  merge,
  onAgentSpawn,
  onBlocked,
  onToolCall,
  onToolCheck,
  onToolSettle,
  onTurnComplete,
  onTurnStart,
  onUnblocked,
} from './band/state.js'
import { checkClaude, checkNode, formatReport } from './status/doctor.js'
import { activeWork } from './status/tasks.js'
import { parseRevParse } from './status/data.js'

// Role of each subagent this session spawned, keyed by agent id, so
// turn.step can apply the role's effort to that subagent's requests
const roleByAgent = new Map()
const MAX_ROLES = 256

// ---- band data --------------------------------------------------------------
// What the band shows from outside the session (the project root and the feature documents)
// is read only on session.start and turn.complete and kept here, so a redraw never runs a
// command. A mod's `$` calls must be written in this file.

const GIT_MS = 3000
const status = { data: null, running: false, again: false }

// ---- band state -------------------------------------------------------------
// The band's state lives in one atom. A `ui.render` hook that reads it is drawn
// again whenever it is written, so the band redraws on event boundaries only
// (spawn, tool call and check, turn start and complete), never per token. `merge`
// resets a stale or mismatched value. Feeding it is observe-only: a failure here is
// swallowed and never reaches the event.

const BAND = atom({ plugin: 'construct', key: 'band' }, initialState(), { shape: `construct.band.v${SCHEMA_VERSION}` })

async function feed($, change) {
  try {
    await update($, BAND, (stored) => change(merge(stored)))
  } catch {
    // never break the event
  }
}

async function nowMs($) {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

// The project root the inline-write detector compares paths with.
async function projectRoot($) {
  if (status.data?.root) return status.data.root
  try {
    return await $.session.cwd()
  } catch {
    return undefined
  }
}

// Runs a command by argv; stdout on exit 0, else undefined. Never throws.
async function runText($, argv, cwd, timeoutMs) {
  try {
    const result = await $.process.run(argv, { cwd, timeoutMs })
    return result.exitCode === 0 ? result.stdout : undefined
  } catch {
    return undefined
  }
}

async function readDocs($, root) {
  const docs = []
  try {
    const dir = `${root}/odd/tasks`
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
      try {
        docs.push({ name: entry.name, mtimeMs: entry.mtimeMs, text: await $.fs.read(`${dir}/${entry.name}`) })
      } catch {
        // unreadable document: skip it
      }
    }
  } catch {
    // no odd/tasks directory
  }
  return docs
}

// Gathers everything the band caches. Each source fails on its own: a gap leaves its segment out.
async function collect($) {
  const data = { root: null, odd: null }
  let cwd
  try {
    cwd = await $.session.cwd()
  } catch {
    // no directory known
  }
  const rev = parseRevParse(await runText($, ['git', 'rev-parse', '--show-toplevel'], cwd, GIT_MS))
  const root = rev?.root ?? cwd
  data.root = root ?? null
  if (root) {
    data.odd = activeWork(await readDocs($, root))
  }
  return data
}

// Refreshes the cache and asks for a redraw. Runs detached from the hook that
// starts it, so it never delays a turn; an event that lands meanwhile reruns it once.
async function refresh($) {
  if (status.running) {
    status.again = true
    return
  }
  status.running = true
  try {
    do {
      status.again = false
      const next = await collect($)
      status.data = next
      try {
        await $.ui.invalidate('ui.render')
      } catch {
        // no surface to redraw
      }
    } while (status.again)
  } catch {
    // keep the last good data
  } finally {
    status.running = false
  }
}

// The band above the prompt. Other mods share it: what they draw stays below ours.
async function drawBand($, e, next) {
  const theirs = await next(e)
  const ours = buildBand({
    state: merge(await read($, BAND)),
    odd: status.data?.odd ?? null,
    nowMs: await nowMs($),
    columns: e.props?.bodyColumns,
    maxRows: e.props?.maxRows,
  })
  if (!ours) return theirs
  return theirs ? { type: 'Box', props: { flexDirection: 'column' }, children: [ours, theirs] } : ours
}

// Settles with the promise, or with null after `ms`; the timer is cleared once the promise settles.
async function withTimeout(promise, ms) {
  let timer
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(resolve, ms, null) })])
  } finally {
    clearTimeout(timer)
  }
}

// Runs one doctor probe; a failure or a timeout is null, never a throw.
async function probe(read) {
  try {
    return (await withTimeout(read(), GIT_MS)) ?? null
  } catch {
    return null
  }
}

// /construct doctor (S8): every probe runs in parallel with a 3 s timeout (GIT_MS), so the report comes back
// well inside the hook budget. The checks themselves are pure, in status/doctor.js.
async function runDoctor($) {
  const cwd = await probe(() => $.session.cwd())
  const [version, node] = await Promise.all([
    probe(async () => (await $.session.version()).version),
    probe(() => runText($, ['node', '--version'], cwd ?? undefined, GIT_MS)),
  ])
  return formatReport([checkClaude(version), checkNode(node)])
}

export function register(on, options) {
  // Send each construct agent on the model its role is configured for, unless the call names one.
  // If this hook fails, the agent keeps its frontmatter model.
  on('agent.spawn', async ($, e, next) => {
    const role = roleFor(e.subagentType)
    // a resumed agent keeps its model (a hook can only refuse its run); a fork always inherits
    const model = e.model || e.resume || e.fork ? null : modelFor(role, options, e.subagentType)
    const result = await next(model ? { ...e, model } : e)
    if (role && result?.agentId) {
      roleByAgent.set(result.agentId, { role, type: e.subagentType })
      // Never deleted on turn.complete (a resumed subagent needs its role); the oldest go past the cap.
      if (roleByAgent.size > MAX_ROLES) roleByAgent.delete(roleByAgent.keys().next().value)
    }
    await noteSpawn($, e, result)
    return result
  })

  // Apply the role's effort to every request a routed subagent makes
  on('turn.step', async function* ($, e, next) {
    const routed = roleByAgent.get(e.agentId)
    const effort = effortFor(routed?.role, options, routed?.type)
    return yield* next(effort ? { ...e, effort } : e)
  })

  // Fill the band's cache when the session starts. Detached, so the start is never held up.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    void registerCommand($)
    return result
  }).catch(($, e, next) => next(e))

  // Refresh it after each main-thread turn, never during one.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) void refresh($)
    try {
      const at = await nowMs($)
      await feed($, (s) => onTurnComplete(onUnblocked(s), { agentId: e.agentId, turnId: e.turnId, nowMs: at }))
    } catch {
      // observe only
    }
    return result
  }).catch(($, e, next) => next(e))

  // A turn began: a main turn marks the band busy, a subagent's runs again.
  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    try {
      const at = await nowMs($)
      await feed($, (s) => onTurnStart(onUnblocked(s), { agentId: e.agentId, turnId: e.turnId, nowMs: at }))
    } catch {
      // observe only
    }
    return result
  }).catch(($, e, next) => next(e))

  // A tool call: counts main-thread writes outside odd/tasks. The call stays open while a question or
  // a plan waits on the human (S8b), so AskUserQuestion and ExitPlanMode block the band until it
  // returns; any settled call clears a block.
  on('tool.call', async ($, e, next) => {
    if (isBlockingTool(e.tool)) await feed($, onBlocked)
    let result
    try {
      result = await next(e)
      return result
    } finally {
      // also when next throws, so an ask never stays pending
      try {
        const cwd = await projectRoot($)
        const didRun = result !== undefined && result.deny === undefined
        await feed($, (s) => {
          const settled = onToolSettle(onUnblocked(s), { tool: e.tool, didRun, callId: e.tool_use_id })
          return didRun && !result.isError ? onToolCall(settled, { tool: e.tool, path: filePathOf(e), cwd, agentId: e.agentId }) : settled
        })
      } catch {
        // observe only
      }
    }
  }).catch(($, e, next) => next(e))

  // The permission verdict, whoever decided it. An ask on a real call is the permission prompt (S8b).
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    const isQuery = typeof e.tool_use_id !== 'string' || e.tool_use_id === ''
    await feed($, (s) => {
      const checked = onToolCheck(s, { tool: e.tool, callId: e.tool_use_id, agentId: e.agentId, decision: result?.decision, isQuery })
      // An ask on a real call goes to the person (or the mode's decider): blocked until the call settles.
      return !isQuery && result?.decision === 'ask' ? onBlocked(checked) : checked
    })
    return result
  }).catch(($, e, next) => next(e))

  // /construct doctor reports the setup.
  on('command.run', { command: 'construct' }, async ($) => ({ text: await runDoctor($) })).catch(($, e, next) => next(e))

  // The band above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => drawBand($, e, next)).catch(($, e, next) => next(e))
}

// A subagent started: add it to the band. Observe only; the routing above has already run.
async function noteSpawn($, e, result) {
  try {
    const at = await nowMs($)
    await feed($, (s) => onAgentSpawn(s, { agentId: result?.agentId, subagentType: e.subagentType, model: result?.model, nowMs: at }))
  } catch {
    // observe only
  }
}

// Registers /construct. Detached from session.start.
async function registerCommand($) {
  try {
    await $.command.register({ name: 'construct', description: 'Check the Construct setup (Claude Code and Node versions)', argumentHint: '[doctor]' })
  } catch {
    // the command stays unavailable
  }
}
