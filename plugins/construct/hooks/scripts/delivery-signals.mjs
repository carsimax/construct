// PostToolBatch hook: the context backstop (S7, gentle-parity). Port of gentle-shell lib/context-backstop.ts.
// Notices only: the hook never blocks, fails open (no output, exit 0), and writes nothing but a one-line
// marker per session. Also exports git and defaultBranch for the publication gate and skill-context.mjs.
// adapted from gentle-shell (https://github.com/Gentleman-Programming/gentle-shell), MIT, Copyright (c) 2025 Mario Zechner, see LICENSE-gentle-shell
// Context backstop: when the latest transcript usage reaches 150k tokens (the window is unknown to a hook,
// so the absolute cap stands, as upstream), one notice to delegate (PostToolBatch, once per batch of tool
// calls). Main thread only (no agent_id). It re-arms when usage falls below the threshold again
// (compaction), as upstream does.
// Usage: node delivery-signals.mjs batch   (hook JSON on stdin)
import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir, readInput, safeName } from './hook-io.mjs'

const GIT_TIMEOUT_MS = 2000

const BACKSTOP_TOKENS = 150_000
// Only the tail of the transcript is read; a usage row larger than this is not found.
const TAIL_BYTES = 256 * 1024

// git returns trimmed stdout, or undefined on any failure (a failed diff is not an empty one).
export function git(cwd, args) {
  // GIT_OPTIONAL_LOCKS=0: a read never takes index.lock from a concurrent commit.
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
  return run.error || run.status !== 0 ? undefined : run.stdout.trim()
}

// defaultBranch returns the first resolvable candidate as a full ref: a `gh pr create --base` branch, origin's HEAD,
// then origin or local main and master; undefined when none exists. The publication gate and skill-context.mjs share it.
export function defaultBranch(cwd, base) {
  const name = base && !base.startsWith('-') ? base.replace(/^refs\/heads\//, '') : null
  const named = name ? [`refs/remotes/origin/${name}`, `refs/heads/${name}`] : []
  const head = git(cwd, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'])
  const candidates = [...named, head, ...['main', 'master'].flatMap((b) => [`refs/remotes/origin/${b}`, `refs/heads/${b}`])]
  return candidates.find((ref) => ref && git(cwd, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]) !== undefined)
}

// latestUsage reads the last assistant usage row from the tail of the transcript (never the whole
// file): context tokens = input + cache reads + cache writes + output of that reply.
function latestUsage(path) {
  const fd = openSync(path, 'r')
  try {
    const size = statSync(path).size
    const start = Math.max(0, size - TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const rows = buffer.toString('utf8').split('\n')
    // The first row of a tail that does not begin the file is cut mid-line.
    if (start > 0) rows.shift()
    for (let i = rows.length - 1; i >= 0; i--) {
      if (!rows[i].includes('"usage"')) continue
      let message
      try {
        message = JSON.parse(rows[i]).message
      } catch {
        continue
      }
      const usage = message?.usage
      if (!usage || typeof message.model !== 'string' || message.model.startsWith('<')) continue
      const tokens = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'].reduce((sum, key) => sum + (Number.isFinite(usage[key]) ? usage[key] : 0), 0)
      if (tokens > 0) return { tokens }
    }
    return null
  } finally {
    closeSync(fd)
  }
}

const count = (value) => Math.round(value).toLocaleString('en-US')

function backstopNotice(tokens) {
  return `Context backstop: the parent context measures ${count(tokens)} tokens, at or past the ${count(BACKSTOP_TOKENS)}-token backstop: delegate the next bounded unit that needs several steps (its reads, edits, and checks) to construct:worker with a short handoff, while single small edits and state checks stay inline.`
}

function backstopSignal(input) {
  if (input.agent_id || typeof input.transcript_path !== 'string' || !input.transcript_path) return null
  const usage = latestUsage(input.transcript_path)
  if (!usage) return null
  const marker = join(dataDir(), 'delivery-signals', `${safeName(input.session_id)}.backstop`)
  if (usage.tokens < BACKSTOP_TOKENS) {
    rmSync(marker, { force: true })
    return null
  }
  try {
    // 'wx' fails when the marker exists: one notice per crossing.
    mkdirSync(join(marker, '..'), { recursive: true })
    writeFileSync(marker, `${Date.now()}\n`, { flag: 'wx' })
  } catch {
    return null
  }
  return backstopNotice(usage.tokens)
}

// `batch` runs the backstop once per batch of tool calls.
const MODES = { batch: ['PostToolBatch', backstopSignal] }

function main() {
  const mode = MODES[process.argv[2]]
  const input = readInput()
  if (!mode || !input || typeof input !== 'object' || Array.isArray(input) || input.hook_event_name !== mode[0]) return
  const [event, signal] = mode
  const notice = signal(input)
  if (notice) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: notice } })}\n`)
}

// The hook runs only when this file is executed directly, so skill-context.mjs can import it.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) && Object.hasOwn(MODES, process.argv[2])) {
  try {
    main()
  } catch {
    // Fail open: no output, exit 0.
  }
}
process.exitCode = 0
