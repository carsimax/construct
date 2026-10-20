import { effortFor, modelFor, roleFor } from './routing.js'
import { buildBand } from './status/format.js'
import { activeFeature } from './status/tasks.js'
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
  const data = { hasStatusLine: false, style: null, agent: null, home: null, git: null, worktree: null, odd: null, rdd: null }
  let cwd
  try {
    cwd = await $.session.cwd()
  } catch {
    // no directory known
  }
  try {
    const settings = await $.settings.read()
    data.hasStatusLine = Boolean(settings?.statusLine)
    data.style = typeof settings?.outputStyle === 'string' ? settings.outputStyle : null
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
  if (root) {
    data.odd = activeFeature(await readDocs($, root))
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

async function drawBand($, e, next) {
  const data = status.data
  if (e.props?.hasSurvey || !data) return next(e)
  // The replica fills in for a statusLine the user has not set; with one, it would show everything twice.
  const live = data.hasStatusLine ? null : await readLive($)
  const replica = live
    ? { usage: live.usage, dir: live.dir, home: data.home, git: data.git, worktree: data.worktree, model: live.model, effort: status.effort, style: data.style, agent: data.agent }
    : null
  const tree = buildBand({ replica, odd: data.odd, rdd: data.rdd, nowMs: live?.nowMs ?? Date.now(), maxRows: e.props?.maxRows })
  return tree ?? next(e)
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
    return result
  })

  // Apply the role's effort to every request a routed subagent makes
  on('turn.step', async function* ($, e, next) {
    noteEffort(e)
    const effort = effortFor(roleByAgent.get(e.agentId), options)
    return yield* next(effort ? { ...e, effort } : e)
  })

  // Fill the band's cache when the session starts. Detached, so the start is never held up.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    return result
  }).catch(($, e, next) => next(e))

  // Refresh it after each main-thread turn, never during one.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) void refresh($)
    return result
  }).catch(($, e, next) => next(e))

  // Draw the band above the prompt; any failure leaves the engine's own band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => drawBand($, e, next)).catch(($, e, next) => next(e))
}
