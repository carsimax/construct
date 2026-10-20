import { atom, read, update } from 'claude-code'
import { effortFor, modelFor, roleFor } from './routing.js'
import { PANEL_COLUMNS, buildPanel } from './panel/layout.js'
import {
  SCHEMA_VERSION,
  filePathOf,
  initialState,
  merge,
  noteOddTask,
  noteRddState,
  onAgentSpawn,
  onCompact,
  onMainStep,
  onPermissionMode,
  onToolCall,
  onToolCheck,
  onToolSettle,
  onTurnComplete,
  onTurnStart,
  onTurnStep,
} from './panel/state.js'
import { activeWork } from './status/tasks.js'
import { parseAssess, parseBoundary, parseGitStatus, parseMode, parseRevParse, reviewState } from './status/data.js'

// Role of each subagent this session spawned, keyed by agent id, so
// turn.step can apply the role's effort to that subagent's requests
const roleByAgent = new Map()

// ---- panel data -------------------------------------------------------------
// What the panel shows from outside the session (git, the plugin CLIs, the feature
// documents) is read only on session.start and turn.complete and kept here, so a
// redraw never runs a command. A mod's `$` calls must be written in this file.

const GIT_MS = 3000
const CLI_MS = 8000
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

async function costUsd($) {
  try {
    const usd = (await $.session.usage())?.cost?.usd
    return typeof usd === 'number' ? usd : undefined
  } catch {
    return undefined
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

// The RDD switch and, when it is on, whether the committed range or the uncommitted changes are due.
async function readRdd($, root) {
  const pluginRoot = $.plugin.root
  const cli = (name) => `${pluginRoot}/bin/${name}`
  const mode = parseMode(await runText($, ['node', cli('odd-review'), '--cwd', root, 'mode', 'status'], root, CLI_MS))
  if (mode !== 'on') return mode ? { mode, state: null } : null
  const boundary = parseBoundary(await runText($, ['node', cli('odd-review'), '--cwd', root, 'boundary'], root, CLI_MS))
  const committed = boundary && (boundary.source === 'receipt' || boundary.source === 'merge-base')
  const [dirty, range] = await Promise.all([
    runText($, ['node', cli('odd-assess'), '--cwd', root, '--json'], root, CLI_MS),
    committed
      ? runText($, ['node', cli('odd-assess'), '--cwd', root, '--base-ref', boundary.commit, '--committed-only', '--json'], root, CLI_MS)
      : undefined,
  ])
  return { mode, state: reviewState([parseAssess(dirty), parseAssess(range)]) }
}

// Gathers everything the panel caches. Each source fails on its own: a gap leaves its segment out.
async function collect($) {
  // The plugin forces its output style, which overrides settings.outputStyle
  const data = { git: null, root: null, odd: null, rdd: null }
  let cwd
  try {
    cwd = await $.session.cwd()
  } catch {
    // no directory known
  }
  const [gitText, revText] = await Promise.all([
    runText($, ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], cwd, GIT_MS),
    runText($, ['git', 'rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir'], cwd, GIT_MS),
  ])
  data.git = parseGitStatus(gitText)
  const rev = parseRevParse(revText)
  const root = rev?.root ?? cwd
  data.root = root ?? null
  if (root) {
    data.odd = activeWork(await readDocs($, root))
    data.rdd = rev ? await readRdd($, root) : null
  }
  return data
}

// One log row per ODD task or RDD state change between two refreshes. The first load has no
// previous value, so it logs nothing. Observe only.
async function noteChanges($, prev, next) {
  if (!prev) return
  try {
    const at = await nowMs($)
    const rddWord = (d) => (d?.rdd ? (d.rdd.state ?? d.rdd.mode ?? null) : null)
    await feed($, (s) => noteRddState(noteOddTask(s, prev.odd?.task ?? null, next.odd?.task ?? null, at), rddWord(prev), rddWord(next), at))
  } catch {
    // observe only
  }
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
      const prev = status.data
      status.data = next
      await noteChanges($, prev, next)
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
  const live = { usage: null, model: null, dir: null, nowMs: Date.now() }
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
    live.dir = await $.session.cwd()
  } catch {
    // no directory known
  }
  try {
    live.nowMs = await $.clock.now()
  } catch {
    // keep the local clock
  }
  return live
}

// The engine reads a Client's `module` off this file's source, as a string literal relative to it, so the
// Client elements are made here (`els.Client`) from the placeholders layout.js leaves ({ type: 'Client',
// props.module './rail.tsx' | './elapsed.tsx' }). A Client may not sit inside a Text, so a row that holds
// one becomes a row Box. Only reached when the surface has Client.
function realize(node, els) {
  if (!node || typeof node === 'string') return node
  if (node.type === 'Client') {
    const { module, ...rest } = node.props ?? {}
    if (module === './rail.tsx') return els.Client({ ...rest, module: './panel/rail.tsx' })
    if (module === './elapsed.tsx') return els.Client({ ...rest, module: './panel/elapsed.tsx' })
    return node
  }
  if (!Array.isArray(node.children)) return node
  const children = node.children.map((k) => realize(k, els))
  const hasClient = node.type === 'Text' && node.children.some((k) => k?.type === 'Client')
  return hasClient ? { type: 'Box', props: { flexDirection: 'row' }, children } : { ...node, children }
}

// The docked panel body, drawn only for this plugin's pane (its requestId is the pane id).
async function drawPane($, e, next) {
  const data = status.data
  if (e.requestId !== PANEL_ID) return next(e)
  const live = await readLive($)
  let els = null
  try {
    const table = $.ui.resolve(e)
    if ('Client' in table) els = table
  } catch {
    // no element table: draw static
  }
  const panel = merge(await read($, PANEL))
  const tree = buildPanel({
    panel,
    usage: live.usage,
    model: live.model,
    effort: status.effort,
    odd: data?.odd ?? null,
    rdd: data?.rdd ?? null,
    nowMs: live.nowMs,
    client: els !== null,
    columns: e.props?.bodyColumns,
    rows: e.props?.scroll?.bodyRows,
  })
  return tree ? (els ? realize(tree, els) : tree) : next(e)
}

async function openPane($) {
  return $.ui.open({ id: PANEL_ID, title: 'Construct', columns: PANEL_COLUMNS })
}

// /construct opens the pane, /construct close closes it.
async function runCommand($, e) {
  const arg = String(e.args ?? '').trim().toLowerCase()
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
  // Send each construct agent on the model its role is configured for.
  // If this hook fails, the agent keeps its frontmatter model.
  on('agent.spawn', async ($, e, next) => {
    const role = roleFor(e.subagentType)
    const model = modelFor(role, options)
    const result = await next(model ? { ...e, model } : e)
    if (role && result?.agentId) roleByAgent.set(result.agentId, role)
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
      const cost = e.agentId === undefined ? await costUsd($) : undefined
      await feed($, (s) => onTurnComplete(s, { agentId: e.agentId, turnId: e.turnId, nowMs: at, cost }))
    } catch {
      // observe only
    }
    return result
  }).catch(($, e, next) => next(e))

  // A turn began: a main turn opens the receipt, a subagent's runs again.
  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    try {
      const at = await nowMs($)
      const cost = e.agentId === undefined ? await costUsd($) : undefined
      await feed($, (s) => onTurnStart(s, { agentId: e.agentId, turnId: e.turnId, nowMs: at, cost }))
    } catch {
      // observe only
    }
    return result
  }).catch(($, e, next) => next(e))

  // A finished tool call: counts edits and errors, and main-thread writes outside odd/tasks.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    try {
      const cwd = await projectRoot($)
      const at = await nowMs($)
      const didRun = result?.deny === undefined
      await feed($, (s) =>
        onToolCall(onToolSettle(s, { tool: e.tool, didRun }), { tool: e.tool, path: filePathOf(e), cwd, agentId: e.agentId, isError: result?.isError === true, nowMs: at }),
      )
    } catch {
      // observe only
    }
    return result
  }).catch(($, e, next) => next(e))

  // The permission verdict, whoever decided it.
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    const at = await nowMs($)
    await feed($, (s) => onToolCheck(s, { tool: e.tool, input: e.input, agentId: e.agentId, decision: result?.decision, nowMs: at, isQuery: typeof e.tool_use_id !== 'string' || e.tool_use_id === '' }))
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
    await $.command.register({ name: 'construct', description: 'Open the Construct panel (close: /construct close)', argumentHint: '[close]' })
  } catch {
    // the command stays unavailable
  }
  try {
    if (options?.panel_open_on_start === true) await openPane($)
  } catch {
    // no surface to draw on
  }
}
