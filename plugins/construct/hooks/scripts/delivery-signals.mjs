// PostToolUse hook: delivery signals (S7, gentle-parity). Port of gentle-shell
// lib/commit-slice-signal.ts and lib/context-backstop.ts. Notices only: the hook never blocks,
// fails open (no output, exit 0), and writes nothing but a one-line marker per session.
//   (a) Commit slice: after a successful `git commit` (main thread or subagent) on a branch
//       other than the default branch, the branch's authored changed lines against the default
//       branch (merge base to HEAD, lock files, minified and generated files excluded) and, past
//       400, a notice to apply the delivery strategy.
//   (b) Context backstop: when the latest transcript usage reaches 150k tokens (the window is
//       unknown to a hook, so the absolute cap stands, as upstream), one notice to delegate. Main thread only (no agent_id). It re-arms when usage
//       falls below the threshold again (compaction), as upstream does.
// Usage: node delivery-signals.mjs post   (hook JSON on stdin)
import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dataDir, readInput, safeName } from './hook-io.mjs'

const SLICE_LINES = 400
const isGeneratedGoldenPath = (logicalPath) => {
  const normalized = `/${logicalPath.replace(/^\.\//, '')}`
  return normalized.includes('/testdata/golden/') && normalized.endsWith('.golden')
}
// Lock files and minified bundles are not authored lines.
const GENERATED = [/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|composer\.lock|Gemfile\.lock)$/, /\.min\.(js|css)$/]
// `git [-C dir | -c key=value]... commit` at the start of a segment, after any variable assignments.
const COMMIT = /^\s*(\w+=\S*\s+)*git(\s+-[Cc]\s+\S+)*\s+commit(\s|$)/
const SEGMENT_SEPARATOR = /;|&&|\|\||\n/
const GIT_TIMEOUT_MS = 2000

const BACKSTOP_TOKENS = 150_000
// Only the tail of the transcript is read; a usage row larger than this is not found.
const TAIL_BYTES = 256 * 1024

const isGitCommitCommand = (command) => command.split(/[;&|(\n]/).some((segment) => COMMIT.test(segment))

const unquote = (value) => value.replace(/^["']|["']$/g, '')

// commitTargetDirectory: `git -C <dir>` under every `cd <dir>` segment before the commit, else the cwd.
function commitTargetDirectory(command, cwd) {
  const gitDir = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)\s+(?:-[Cc]\s+\S+\s+)*commit\b/.exec(command)?.[1]
  let base = cwd
  for (const segment of command.split(SEGMENT_SEPARATOR)) {
    if (COMMIT.test(segment)) break
    const cd = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*$/.exec(segment)?.[1]
    if (cd) base = resolve(base, unquote(cd))
  }
  return gitDir ? resolve(base, unquote(gitDir)) : base
}

// git returns trimmed stdout, or undefined on any failure (a failed diff is not an empty one).
function git(cwd, args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] })
  return run.error || run.status !== 0 ? undefined : run.stdout.trim()
}

function defaultBranch(cwd) {
  const remote = git(cwd, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'])
  if (remote) return remote
  return ['main', 'master'].find((name) => git(cwd, ['rev-parse', '--verify', '-q', `refs/heads/${name}`]) !== undefined)
}

const isGenerated = (path) => GENERATED.some((pattern) => pattern.test(path)) || isGeneratedGoldenPath(path)

// authoredLines sums added and deleted lines of `numstat -z -M` output, skipping binary and generated paths.
function authoredLines(numstat) {
  let lines = 0
  const fields = numstat.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const [added, deleted, inline] = fields[i].split('\t')
    // A rename leaves the inline path empty and is followed by its old and new paths.
    const path = inline === '' ? fields[(i += 2)] : inline
    if (!path || added === '-' || isGenerated(path)) continue
    lines += Number(added) + Number(deleted)
  }
  return lines
}

// commitSliceReport: one line after a commit on a feature branch, or null when there is no slice to report.
function commitSliceReport(cwd) {
  const branch = git(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'])
  const target = branch === undefined ? undefined : defaultBranch(cwd)
  if (!branch || !target || branch === target || `origin/${branch}` === target) return null
  const base = git(cwd, ['merge-base', 'HEAD', target])
  const commits = base ? Number(git(cwd, ['rev-list', '--count', `${base}..HEAD`])) : 0
  if (!base || !(commits > 0)) return null
  // `-M` counts a move by what it changed; `-z` keeps paths unquoted for the generated-file filter.
  const numstat = git(cwd, ['diff', '--numstat', '-z', '-M', base, 'HEAD'])
  if (numstat === undefined) return null
  const lines = authoredLines(numstat)
  const head = `Commit slice: ${lines} authored changed lines in ${commits} commit${commits === 1 ? '' : 's'} on ${branch} since ${target} (lock files excluded).`
  return lines > SLICE_LINES
    ? `${head} Past the ~${SLICE_LINES}-line slice: apply the feature's delivery strategy before the next commit (record the slice boundary in the feature document).`
    : `${head} ${SLICE_LINES - lines} lines left before the ~${SLICE_LINES}-line slice.`
}

// A Bash result that is not a finished success carries no commit: an error flag, an interruption,
// a non-zero exit code, or a background job (its commit does not exist yet).
function succeeded(response) {
  if (!response || typeof response !== 'object') return true
  if (response.is_error === true || response.interrupted === true || response.backgroundTaskId) return false
  const code = response.exit_code ?? response.exitCode
  return code === undefined || code === 0
}

function commitSignal(input) {
  const command = input.tool_input?.command
  if (input.tool_name !== 'Bash' || typeof command !== 'string' || !succeeded(input.tool_response) || !isGitCommitCommand(command)) return null
  return commitSliceReport(commitTargetDirectory(command, input.cwd))
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

function main() {
  const input = readInput()
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.hook_event_name !== 'PostToolUse') return
  const notices = []
  for (const signal of [commitSignal, backstopSignal]) {
    try {
      const notice = signal(input)
      if (notice) notices.push(notice)
    } catch {
      // Fail open per signal.
    }
  }
  if (notices.length > 0) {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notices.join('\n') } })}\n`)
  }
}

if (process.argv[2] === 'post') {
  try {
    main()
  } catch {
    // Fail open: no output, exit 0.
  }
}
process.exitCode = 0
