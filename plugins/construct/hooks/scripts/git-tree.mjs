// Git and file helpers shared by the risk-line hook: bounded git calls,
// a frozen working tree, the HEAD commit, and an atomic file write.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_OUTPUT_LIMIT = 64 << 20
// The full HEAD-seeded hash gets this long before the snapshot degrades to the index-seeded one. The
// environment variable exists so tests can exhaust it without building a huge repository.
export const SNAPSHOT_BUDGET_MS = Number(process.env.CONSTRUCT_SNAPSHOT_BUDGET_MS) || 5000

class GitError extends Error {
  constructor(message, { status = null, stderr = '' } = {}) {
    super(message)
    this.name = 'GitError'
    this.status = status
    this.stderr = stderr
    this.timedOut = false
  }
}

function cleanEnvironment(extra) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value
  }
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  return { ...env, ...extra }
}

// git runs one git command (argument array, never a shell) and returns stdout as a Buffer.
// okStatuses lists the exit codes that are not failures.
export function git(root, args, { env, input, maxBuffer = DEFAULT_OUTPUT_LIMIT, okStatuses = [0], timeout } = {}) {
  const argv = ['--no-replace-objects', ...(root ? ['-C', root] : []), ...args]
  const result = spawnSync('git', argv, {
    env: cleanEnvironment(env),
    input: input === undefined ? undefined : Buffer.from(input),
    maxBuffer,
    encoding: 'buffer',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const stderr = result.stderr ? result.stderr.toString('utf8').trim() : ''
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      const error = new GitError(`git ${args[0]} exceeded ${timeout} ms`, { stderr })
      error.timedOut = true
      throw error
    }
    if (result.error.code === 'ENOBUFS') {
      throw new GitError(`git ${args[0]} output exceeded ${maxBuffer} bytes`, { stderr })
    }
    throw new GitError(`git ${args[0]} could not run: ${result.error.message}`, { stderr })
  }
  if (!okStatuses.includes(result.status)) {
    throw new GitError(`git ${args.slice(0, 2).join(' ')} failed (exit ${result.status}): ${stderr}`, {
      status: result.status,
      stderr,
    })
  }
  return result.stdout
}

const text = (buffer) => buffer.toString('utf8').trim()

export function repositoryRoot(cwd) {
  return text(git(cwd, ['rev-parse', '--show-toplevel']))
}

export function headCommit(root) {
  const out = text(git(root, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { okStatuses: [0, 1] }))
  return out === '' ? null : out
}

function headTree(root) {
  const out = git(root, ['rev-parse', '--verify', '-q', 'HEAD^{tree}'], { okStatuses: [0, 1] })
  const tree = text(out)
  return tree === '' ? null : tree
}

function emptyTree(root) {
  return text(git(root, ['hash-object', '-t', 'tree', '--stdin'], { input: '' }))
}

// freezeWorkingTree builds an immutable tree of the current working state
// (tracked plus untracked, not ignored) through a temporary index, so the user's
// real index is never read for writing or changed. The base is the HEAD tree, or
// the empty tree on an unborn branch. The temporary index starts from HEAD, so `add -A` rehashes every
// file and a same-size rewrite with a restored mtime is seen. That full hash gets budgetMs; when it runs out
// (or indexSeeded asks to skip it) the snapshot starts as a copy of the real index instead, whose stat cache
// lets `add -A` skip unchanged files, unless an entry is assume-unchanged or skip-worktree: `add -A` would
// skip its changes. That snapshot is `degraded: true` in the result, because it trusts the stat cache.
export function freezeWorkingTree(root, { budgetMs = SNAPSHOT_BUDGET_MS, indexSeeded = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'construct-index-'))
  try {
    const env = { GIT_INDEX_FILE: join(dir, 'index') }
    const head = headTree(root)
    const result = (candidateTree, degraded) => ({ baseTree: head ?? emptyTree(root), candidateTree, degraded })
    const fromHead = (timeout) => {
      if (head !== null) git(root, ['read-tree', 'HEAD'], { env })
      git(root, ['add', '-A'], { env, timeout })
      return text(git(root, ['write-tree'], { env }))
    }
    if (!indexSeeded) {
      try {
        return result(fromHead(budgetMs), false)
      } catch (error) {
        if (!error.timedOut) throw error
        rmSync(env.GIT_INDEX_FILE, { force: true })
      }
    }
    let seeded = false
    // `ls-files -v` tags assume-unchanged entries with a lowercase letter and skip-worktree ones with S
    if (!/^([a-z]|S) /m.test(text(git(root, ['ls-files', '-v'])))) try {
      const index = resolve(root, text(git(root, ['rev-parse', '--git-path', 'index'])))
      copyFileSync(index, env.GIT_INDEX_FILE)
      // Keep the index mtime (floored, never later) so git still rehashes racily clean entries.
      const second = Math.floor(statSync(index).mtimeMs / 1000)
      utimesSync(env.GIT_INDEX_FILE, second, second)
      seeded = true
    } catch {
      // no real index yet (fresh repository): seed from HEAD below
    }
    if (!seeded && head !== null) git(root, ['read-tree', 'HEAD'], { env })
    // A cached file system monitor or untracked cache would make `add -A` skip changes the stat cache hides.
    git(root, ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'add', '-A'], { env })
    return result(text(git(root, ['write-tree'], { env })), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function temporaryName(file) {
  const slash = file.lastIndexOf('/')
  return `${file.slice(0, slash + 1)}.${file.slice(slash + 1)}.${randomBytes(6).toString('hex')}.tmp`
}

// atomicWrite replaces file in one rename.
export function atomicWrite(file, text) {
  mkdirSync(join(file, '..'), { recursive: true })
  const temporary = temporaryName(file)
  try {
    writeFileSync(temporary, text, { flag: 'wx' })
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
