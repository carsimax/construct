import { atom, read, update } from 'claude-code'
import { effortFor, modelFor, roleFor } from './routing.js'
import { buildPanel, buildSummary } from './panel/layout.js'
import {
  SCHEMA_VERSION,
  filePathOf,
  initialState,
  merge,
  onAgentSpawn,
  onCompact,
  onToolCall,
  onToolCheck,
  onTurnComplete,
  onTurnStart,
  onTurnStep,
} from './panel/state.js'
import { activeWork } from './status/tasks.js'
import { parseAssess, parseBoundary, parseGitStatus, parseMode, parseRevParse, reviewState } from './status/data.js'

// Role of each subagent this session spawned, keyed by agent id, so
// turn.step can apply the role's effort to that subagent's requests
const roleByAgent = new Map()

// ---- status band ------------------------------------------------------------
// What the band shows from outside the session (git, the plugin CLIs, the feature
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

// Gathers everything the band caches. Each source fails on its own: a gap leaves its segment out.
async function collect($) {
  // The plugin forces its output style, which overrides settings.outputStyle
  const data = { hasStatusLine: false, style: 'construct:Neutral', agent: null, home: null, git: null, worktree: null, root: null, odd: null, rdd: null }
  let cwd
  try {
    cwd = await $.session.cwd()
  } catch {
    // no directory known
  }
  try {
    const settings = await $.settings.read()
    data.hasStatusLine = Boolean(settings?.statusLine)
    data.agent = typeof settings?.agent === 'string' ? settings.agent : null
  } catch {
    // settings unreadable: treated as no statusLine
  }
  try {
    data.home = (await $.env.get('HOME')) ?? null
  } catch {
    // no home known
  }
  const [gitText, revText] = await Promise.all([
    runText($, ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], cwd, GIT_MS),
    runText($, ['git', 'rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir'], cwd, GIT_MS),
  ])
  data.git = parseGitStatus(gitText)
  const rev = parseRevParse(revText)
  data.worktree = rev?.worktree ?? null
  const root = rev?.root ?? cwd
  data.root = root ?? null
  if (root) {
    data.odd = activeWork(await readDocs($, root))
    data.rdd = rev ? await readRdd($, root) : null
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
      status.data = await collect($)
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

// The one-line summary above the prompt; the panel holds the rest.
async function drawBand($, e, next) {
  const data = status.data
  if (e.props?.hasSurvey || !data) return next(e)
  const live = await readLive($)
  const panel = merge(await read($, PANEL))
  // The context figure belongs to the replica: with a statusLine it would show twice.
  const tree = buildSummary({ panel, usage: data.hasStatusLine ? null : live.usage, odd: data.odd, rdd: data.rdd, nowMs: live.nowMs })
  return tree ?? next(e)
}

// The docked panel body, drawn only for this plugin's pane (its requestId is the pane id).
async function drawPane($, e, next) {
  const data = status.data
  if (e.requestId !== PANEL_ID) return next(e)
  const live = await readLive($)
  const panel = merge(await read($, PANEL))
  // The replica fills in for a statusLine the user has not set; with one, it would show everything twice.
  const replica =
    data && !data.hasStatusLine
      ? { usage: live.usage, dir: live.dir, home: data.home, git: data.git, worktree: data.worktree, model: live.model, effort: status.effort, style: data.style, agent: data.agent }
      : null
  const tree = buildPanel({
    panel,
    replica,
    odd: data?.odd ?? null,
    rdd: data?.rdd ?? null,
    nowMs: live.nowMs,
    columns: e.props?.bodyColumns,
    rows: e.props?.scroll?.bodyRows,
  })
  return tree ?? next(e)
}

async function openPane($) {
  return $.ui.open({ id: PANEL_ID, title: 'Construct' })
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
    return result
  })

  // Apply the role's effort to every request a routed subagent makes
  on('turn.step', async function* ($, e, next) {
    noteEffort(e)
    const effort = effortFor(roleByAgent.get(e.agentId), options)
    const result = yield* next(effort ? { ...e, effort } : e)
    if (e.agentId !== undefined) await feed($, (s) => onTurnStep(s, { agentId: e.agentId, usage: result?.usage }))
    return result
  })

  // Fill the band's cache when the session starts. Detached, so the start is never held up.
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
      await feed($, (s) => onToolCall(s, { tool: e.tool, path: filePathOf(e), cwd, agentId: e.agentId, isError: result?.isError === true }))
    } catch {
      // observe only
    }
    return result
  }).catch(($, e, next) => next(e))

  // The permission verdict, whoever decided it.
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    await feed($, (s) => onToolCheck(s, { tool: e.tool, input: e.input, agentId: e.agentId, decision: result?.decision, isQuery: typeof e.tool_use_id !== 'string' || e.tool_use_id === '' }))
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

  // Draw the summary line above the prompt; any failure leaves the engine's own band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => drawBand($, e, next)).catch(($, e, next) => next(e))
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
