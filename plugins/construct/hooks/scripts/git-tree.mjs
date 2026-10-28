// Git and file helpers shared by the risk-line hook: bounded git calls,
// a frozen working tree, the HEAD commit, and an atomic file write.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_OUTPUT_LIMIT = 64 << 20

class GitError extends Error {
  constructor(message, { status = null, stderr = '' } = {}) {
    super(message)
    this.name = 'GitError'
    this.status = status
    this.stderr = stderr
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
export function git(root, args, { env, input, maxBuffer = DEFAULT_OUTPUT_LIMIT, okStatuses = [0] } = {}) {
  const argv = ['--no-replace-objects', ...(root ? ['-C', root] : []), ...args]
  const result = spawnSync('git', argv, {
    env: cleanEnvironment(env),
    input: input === undefined ? undefined : Buffer.from(input),
    maxBuffer,
    encoding: 'buffer',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const stderr = result.stderr ? result.stderr.toString('utf8').trim() : ''
  if (result.error) {
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
// the empty tree on an unborn branch. The temporary index starts from HEAD, with no
// stat cache, so `add -A` hashes every file: the real index's cache is not trusted,
// since a same-size rewrite with its mtime restored would match it. Above hashBudget
// index entries, hashing every file can outlast the hook timeout, so the temporary
// index starts as a copy of the real one (unless an entry is assume-unchanged or
// skip-worktree, whose changes `add -A` would skip) and `fast` tells the caller.
export const FREEZE_HASH_BUDGET = 20_000

export function freezeWorkingTree(root, { hashBudget = FREEZE_HASH_BUDGET } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'construct-index-'))
  try {
    const env = { GIT_INDEX_FILE: join(dir, 'index') }
    const head = headTree(root)
    const index = resolve(root, text(git(root, ['rev-parse', '--git-path', 'index'])))
    let fast = false
    // `ls-files -v` tags assume-unchanged entries with a lowercase letter and skip-worktree ones with S
    if (indexEntries(index) > hashBudget && !/^([a-z]|S) /m.test(text(git(root, ['ls-files', '-v'])))) {
      copyFileSync(index, env.GIT_INDEX_FILE)
      // Keep the index mtime (floored, never later) so git still rehashes racily clean entries.
      const second = Math.floor(statSync(index).mtimeMs / 1000)
      utimesSync(env.GIT_INDEX_FILE, second, second)
      fast = true
    } else if (head !== null) git(root, ['read-tree', 'HEAD'], { env })
    git(root, ['add', '-A'], { env })
    const candidateTree = text(git(root, ['write-tree'], { env }))
    return { baseTree: head ?? emptyTree(root), candidateTree, fast }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// indexEntries reads the entry count from the index header (`DIRC`, version, count); 0 when there is none.
function indexEntries(index) {
  let fd
  try {
    fd = openSync(index, 'r')
    const header = Buffer.alloc(12)
    if (readSync(fd, header, 0, 12, 0) < 12 || header.toString('latin1', 0, 4) !== 'DIRC') return 0
    return header.readUInt32BE(8)
  } catch {
    return 0
  } finally {
    if (fd !== undefined) closeSync(fd)
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
