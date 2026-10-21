// Git and file helpers shared by the risk-line and mirror-drift hooks: bounded git calls,
// a frozen working tree, the HEAD commit, and an atomic file write.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
// the empty tree on an unborn branch.
export function freezeWorkingTree(root) {
  const dir = mkdtempSync(join(tmpdir(), 'construct-index-'))
  try {
    const env = { GIT_INDEX_FILE: join(dir, 'index') }
    const head = headTree(root)
    if (head !== null) git(root, ['read-tree', 'HEAD'], { env })
    git(root, ['add', '-A'], { env })
    const candidateTree = text(git(root, ['write-tree'], { env }))
    return { baseTree: head ?? emptyTree(root), candidateTree }
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
