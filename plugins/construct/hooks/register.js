import { atom, read, update } from 'claude-code'
import { effortFor, modelFor, roleFor } from './routing.js'
import { PANEL_COLUMNS, buildPanel } from './panel/layout.js'
import {
  SCHEMA_VERSION,
  filePathOf,
  initialState,
  isBlockingTool,
  merge,
  onAgentSpawn,
  onBlocked,
  onCompact,
  onMainStep,
  onPermissionMode,
  onToolCall,
  onToolCheck,
  onToolSettle,
  onTurnComplete,
  onTurnStart,
  onTurnStep,
  onUnblocked,
} from './panel/state.js'
import { checkClaude, checkCodegraph, checkMemory, checkNode, formatReport, MEMORY_PROBE } from './status/doctor.js'
import { activeWork } from './status/tasks.js'
import { parseGitStatus, parseNumstat, parseRevParse } from './status/data.js'

// Role of each subagent this session spawned, keyed by agent id, so
// turn.step can apply the role's effort to that subagent's requests
const roleByAgent = new Map()
const MAX_ROLES = 256

// ---- panel data -------------------------------------------------------------
// What the panel shows from outside the session (git, the plugin CLIs, the feature
// documents) is read only on session.start and turn.complete and kept here, so a
// redraw never runs a command. A mod's `$` calls must be written in this file.

const GIT_MS = 3000
const MAX_UNTRACKED = 20
const status = { data: null, effort: null, running: false, again: false }

// ---- panel state ------------------------------------------------------------
// The panel's state lives in one atom. A `ui.render` hook that reads it is drawn
// again whenever it is written, so the panel redraws on event boundaries only
// (spawn, step end, tool call and check, turn start and complete, compact), never
// per token. `merge` resets a stale or mismatched value. Feeding it is observe-only:
// a failure here is swallowed and never reaches the event.

const PANEL_ID = 'construct'
const PANEL = atom({ plugin: 'construct', key: 'panel' }, initialState(), { shape: `construct.panel.v${SCHEMA_VERSION}` })

async function feed($, change) {
  try {
    await update($, PANEL, (stored) => change(merge(stored)))
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

// Line count of one untracked file: `git diff --no-index --numstat /dev/null <file>`. It exits 1 when the
// file differs from /dev/null, which is its normal answer, so 0 and 1 both count. A binary file gives
// `-` (no count); a failure gives null and the panel shows `new`.
async function untrackedFile($, cwd, path) {
  try {
    const r = await $.process.run(['git', '--no-optional-locks', 'diff', '--no-index', '--numstat', '--', '/dev/null', path], { cwd, timeoutMs: GIT_MS })
    if (r.exitCode !== 0 && r.exitCode !== 1) return { path, added: null, removed: null, untracked: true }
    const row = parseNumstat(r.stdout)[0]
    return { path, added: row?.added ?? null, removed: null, binary: row?.binary === true, untracked: true }
  } catch {
    return { path, added: null, removed: null, untracked: true }
  }
}

// The files changed against HEAD (staged and unstaged, numstat) and the untracked ones from status.
// Only the first MAX_UNTRACKED untracked files are counted (one short git call each, in parallel);
// the rest, and any directory entry (`dir/`), show as `new` without a count, so a tree of untracked
// files never costs more than a bounded number of processes.
async function collectChanges($, cwd, git, numstatText) {
  const tracked = parseNumstat(numstatText).map((f) => ({ ...f, untracked: false }))
  const paths = git?.untracked ?? []
  const counted = await Promise.all(
    paths.map((path, i) => (i < MAX_UNTRACKED && !path.endsWith('/') ? untrackedFile($, cwd, path) : { path, added: null, removed: null, untracked: true })),
  )
  return [...tracked, ...counted]
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

// Gathers everything the panel caches. Each source fails on its own: a gap leaves its segment out.
async function collect($) {
  // The plugin forces its output style, which overrides settings.outputStyle
  const data = { git: null, changes: [], root: null, odd: null }
  let cwd
  try {
    cwd = await $.session.cwd()
  } catch {
    // no directory known
  }
  const [gitText, revText, numstatText] = await Promise.all([
    runText($, ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z'], cwd, GIT_MS),
    runText($, ['git', 'rev-parse', '--show-toplevel'], cwd, GIT_MS),
    runText($, ['git', '--no-optional-locks', 'diff', '--numstat', '--no-renames', 'HEAD'], cwd, GIT_MS),
  ])
  data.git = parseGitStatus(gitText)
  data.changes = data.git ? await collectChanges($, cwd, data.git, numstatText) : []
  const rev = parseRevParse(revText)
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

// The figures read live on each redraw: they are free, and they move during a turn.
async function readLive($) {
  const live = { usage: null, model: null, nowMs: Date.now() }
  try {
    live.usage = await $.session.usage()
  } catch {
    // no usage yet
  }
  try {
    live.model = (await $.session.model()) || null
  } catch {
    // no model known
  }
  try {
    live.nowMs = await $.clock.now()
  } catch {
    // keep the local clock
  }
  return live
}

// The docked panel body, drawn only for this plugin's pane (its requestId is the pane id).
async function drawPane($, e, next) {
  const data = status.data
  if (e.requestId !== PANEL_ID) return next(e)
  const live = await readLive($)
  const panel = merge(await read($, PANEL))
  const tree = buildPanel({
    panel,
    usage: live.usage,
    model: live.model,
    effort: status.effort,
    git: data?.git ?? null,
    changes: data?.changes ?? [],
    odd: data?.odd ?? null,
    nowMs: live.nowMs,
    columns: e.props?.bodyColumns,
    rows: e.props?.scroll?.bodyRows,
  })
  return tree ?? next(e)
}

async function openPane($) {
  return $.ui.open({ id: PANEL_ID, title: 'Construct', columns: PANEL_COLUMNS })
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
  const rev = parseRevParse(await probe(() => runText($, ['git', 'rev-parse', '--show-toplevel'], cwd ?? undefined, GIT_MS)))
  const root = rev?.root ?? cwd
  const [version, node, memory, codegraph] = await Promise.all([
    probe(async () => (await $.session.version()).version),
    probe(() => runText($, ['node', '--version'], cwd ?? undefined, GIT_MS)),
    probe(() => runText($, ['node', '-e', MEMORY_PROBE], cwd ?? undefined, GIT_MS)),
    probe(() => (root ? $.fs.exists(`${root}/.codegraph`) : null)),
  ])
  return formatReport([checkClaude(version), checkNode(node), checkMemory(memory), checkCodegraph(codegraph)])
}

// /construct opens the pane, /construct close closes it, /construct doctor reports the setup.
async function runCommand($, e) {
  const arg = String(e.args ?? '').trim().toLowerCase()
  if (arg === 'doctor') return { text: await runDoctor($) }
  if (arg === 'close') {
    await $.ui.close({ id: PANEL_ID })
    return { text: 'Construct panel closed.' }
  }
  const opened = await openPane($)
  return { text: opened?.isPlaced === false ? `Construct panel waiting: ${opened.reason ?? 'no room yet'}` : 'Construct panel opened.' }
}

// Remembers the effort of the main thread's requests, which the replica shows beside the model.
function noteEffort(e) {
  try {
    if (e.agentId === undefined && e.effort !== undefined) status.effort = String(e.effort)
  } catch {
    // never block a step
  }
}

export function register(on, options) {
  // Send each construct agent on the model its role is configured for, unless the call names one.
  // If this hook fails, the agent keeps its frontmatter model.
  on('agent.spawn', async ($, e, next) => {
    const role = roleFor(e.subagentType)
    const model = e.model ? null : modelFor(role, options)
    const result = await next(model ? { ...e, model } : e)
    if (role && result?.agentId) {
      roleByAgent.set(result.agentId, role)
      // Never deleted on turn.complete (a resumed subagent needs its role); the oldest go past the cap.
      if (roleByAgent.size > MAX_ROLES) roleByAgent.delete(roleByAgent.keys().next().value)
    }
    await noteSpawn($, e, result, role, options)
    if (!e.parentAgentId && e.permissionMode) await feed($, (s) => onPermissionMode(s, { mode: e.permissionMode }))
    return result
  })

  // Apply the role's effort to every request a routed subagent makes
  on('turn.step', async function* ($, e, next) {
    noteEffort(e)
    const effort = effortFor(roleByAgent.get(e.agentId), options)
    const result = yield* next(effort ? { ...e, effort } : e)
    if (e.agentId === undefined) await feed($, (s) => onMainStep(s, { agentId: e.agentId, model: e.model, effort: e.effort }))
    if (e.agentId !== undefined) await feed($, (s) => onTurnStep(s, { agentId: e.agentId, usage: result?.usage }))
    return result
  })

  // Fill the panel's cache when the session starts. Detached, so the start is never held up.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    void setUpPanel($, options)
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

  // A turn began: a main turn marks the panel busy, a subagent's runs again.
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

  // A tool call: counts edits and errors, and main-thread writes outside odd/tasks. The call stays open
  // while a question or a plan waits on the human (S8b), so AskUserQuestion and ExitPlanMode block the
  // panel until it returns; any settled call clears a block.
  on('tool.call', async ($, e, next) => {
    if (isBlockingTool(e.tool)) await feed($, onBlocked)
    const result = await next(e)
    try {
      const cwd = await projectRoot($)
      const at = await nowMs($)
      const didRun = result?.deny === undefined
      await feed($, (s) =>
        onToolCall(onToolSettle(onUnblocked(s), { tool: e.tool, didRun, callId: e.tool_use_id }), { tool: e.tool, path: filePathOf(e), cwd, agentId: e.agentId, isError: result?.isError === true, nowMs: at }),
      )
    } catch {
      // observe only
    }
    return result
  }).catch(($, e, next) => next(e))

  // The permission verdict, whoever decided it. An ask on a real call is the permission prompt (S8b).
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    const at = await nowMs($)
    const isQuery = typeof e.tool_use_id !== 'string' || e.tool_use_id === ''
    await feed($, (s) => {
      const checked = onToolCheck(s, { tool: e.tool, callId: e.tool_use_id, input: e.input, agentId: e.agentId, decision: result?.decision, nowMs: at, isQuery })
      // An ask on a real call goes to the person (or the mode's decider): blocked until the call settles.
      return !isQuery && result?.decision === 'ask' ? onBlocked(checked) : checked
    })
    return result
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.trigger !== 'precompute' && result && result.skip === undefined) await feed($, (s) => onCompact(s))
    return result
  }).catch(($, e, next) => next(e))

  // /construct opens the pane, /construct close closes it.
  on('command.run', { command: 'construct' }, async ($, e) => runCommand($, e)).catch(($, e, next) => next(e))

  // The docked panel.
  on('ui.render', { component: 'Pane' }, async ($, e, next) => drawPane($, e, next)).catch(($, e, next) => next(e))
}

// A subagent started: add its card. Observe only; the routing above has already run.
async function noteSpawn($, e, result, role, options) {
  try {
    const at = await nowMs($)
    const effort = effortFor(role, options)
    await feed($, (s) =>
      onAgentSpawn(s, { agentId: result?.agentId, subagentType: e.subagentType, description: e.description, model: result?.model, effort, nowMs: at }),
    )
  } catch {
    // observe only
  }
}

// Registers /construct and, when the user asked for it, opens the pane. Detached from session.start.
async function setUpPanel($, options) {
  try {
    await $.command.register({ name: 'construct', description: 'Open the Construct panel (close: /construct close, setup check: /construct doctor)', argumentHint: '[close|doctor]' })
  } catch {
    // the command stays unavailable
  }
  try {
    if (options?.panel_open_on_start === true) await openPane($)
  } catch {
    // no surface to draw on
  }
}
