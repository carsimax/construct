// Git access for odd-assess. Every call passes an argument array to git (never a
// shell), strips inherited GIT_* variables, and bounds the captured output.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_OUTPUT_LIMIT = 64 << 20
// Windows caps a command line near 32767 characters; the budget keeps every
// batched pathspec invocation well under it (same figure as the original).
const PATHSPEC_ARGV_BUDGET = 26000

export class GitError extends Error {
  constructor(message, { status = null, stderr = '' } = {}) {
    super(message)
    this.name = 'GitError'
    this.status = status
    this.stderr = stderr
  }
}

export class GitOutputLimitError extends GitError {}

function cleanEnvironment(extra) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value
  }
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  return { ...env, ...extra }
}

// git runs one git command and returns stdout as a Buffer. okStatuses lists the
// exit codes that are not failures (for example git grep exits 1 on no match).
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
      throw new GitOutputLimitError(`git ${args[0]} output exceeded ${maxBuffer} bytes`, { stderr })
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

// resolveTree names one revision. A range or an option-shaped value is rejected
// before git sees it.
export function resolveTree(root, revision) {
  const ref = revision.trim()
  if (ref === '' || ref.includes('..') || ref.startsWith('-')) {
    throw new GitError(`base ref ${JSON.stringify(revision)} must be one revision, not a range or an option`)
  }
  return text(git(root, ['rev-parse', '--verify', `${ref}^{tree}`]))
}

function headTree(root) {
  const out = git(root, ['rev-parse', '--verify', '-q', 'HEAD^{tree}'], { okStatuses: [0, 1] })
  const tree = text(out)
  return tree === '' ? null : tree
}

function emptyTree(root) {
  return text(git(root, ['hash-object', '-t', 'tree', '--stdin'], { input: '' }))
}

export function hasDirtyTrackedChanges(root) {
  return git(root, ['diff', '--name-only', '-z', 'HEAD', '--']).length !== 0
}

// freezeWorkingTree builds an immutable tree of the current working state
// (tracked plus untracked, not ignored) through a temporary index, so the user's
// real index is never read for writing or changed. The base is the HEAD tree, or
// the empty tree on an unborn branch.
export function freezeWorkingTree(root) {
  const dir = mkdtempSync(join(tmpdir(), 'odd-assess-index-'))
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

// createIsolation returns an environment that reads the repository's objects
// through an empty bare git directory: no repository, global, or system config,
// and no .gitattributes, so diff and numstat depend only on the frozen bytes.
export function createIsolation(root) {
  const commonDir = resolve(root, text(git(root, ['rev-parse', '--git-common-dir'])))
  const objectFormat = text(git(root, ['rev-parse', '--show-object-format'], { okStatuses: [0, 129] })) || 'sha1'
  const dir = mkdtempSync(join(tmpdir(), 'odd-assess-git-'))
  mkdirSync(join(dir, 'objects'))
  mkdirSync(join(dir, 'refs'))
  writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/frozen-context\n')
  const sha256 = objectFormat === 'sha256'
  writeFileSync(
    join(dir, 'config'),
    `[core]\n\trepositoryFormatVersion = ${sha256 ? 1 : 0}\n\tbare = true\n${sha256 ? '[extensions]\n\tobjectFormat = sha256\n' : ''}`,
  )
  const empty = ['system', 'global'].map((name) => {
    const file = join(dir, `empty-${name}`)
    writeFileSync(file, '')
    return file
  })
  return {
    env: {
      GIT_DIR: dir,
      GIT_OBJECT_DIRECTORY: join(commonDir, 'objects'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: empty[0],
      GIT_CONFIG_GLOBAL: empty[1],
      GIT_CONFIG_COUNT: '0',
      GIT_ATTR_NOSYSTEM: '1',
      LANG: 'C',
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const literalPathspec = (path) => `:(literal)${path}`

// batchLiteralPathspecs splits paths into ordered batches whose combined
// pathspec length stays under the argv budget. Every path lands in exactly one
// batch, so a large change set never silently drops a path from a risk scan.
export function batchLiteralPathspecs(paths, prefixLength = 0) {
  if (paths.length === 0) return []
  const budget = Math.max(PATHSPEC_ARGV_BUDGET - prefixLength, 1)
  const batches = []
  let current = []
  let length = 0
  for (const path of paths) {
    const spec = literalPathspec(path)
    if (current.length > 0 && length + spec.length + 1 > budget) {
      batches.push(current)
      current = []
      length = 0
    }
    current.push(spec)
    length += spec.length + 1
  }
  batches.push(current)
  return batches
}

export const stripLiteral = (spec) => spec.replace(/^:\(literal\)/, '')

const prefixLengthOf = (root, fixed) => 30 + root.length + fixed.reduce((sum, arg) => sum + arg.length + 1, 0)

// treeBlobSizes lists the blob sizes of paths inside one tree so a caller can
// refuse an oversized scan before reading it.
export function treeBlobSizes(root, tree, paths, options = {}) {
  const fixed = ['ls-tree', '-r', '-l', '-z', tree, '--']
  const blobs = []
  for (const batch of batchLiteralPathspecs(paths, prefixLengthOf(root, fixed))) {
    const out = git(root, [...fixed, ...batch], options)
    for (const entry of out.toString('utf8').split('\0')) {
      const tab = entry.indexOf('\t')
      if (tab < 0) continue
      const fields = entry.slice(0, tab).split(/\s+/).filter(Boolean)
      if (fields.length !== 4) continue
      if (!/^\d+$/.test(fields[3])) throw new GitError(`parse source blob size for ${entry.slice(tab + 1)}: ${fields[3]}`)
      blobs.push({ path: entry.slice(tab + 1), oid: fields[2], size: Number(fields[3]) })
    }
  }
  return blobs
}

// catFileRecordBytes is Git's exact --batch framing: "<oid> blob <size>\n<content>\n".
export const catFileRecordBytes = (oid, size) => oid.length + ' blob '.length + String(size).length + 2 + size

// batchBlobContents reads exact object ids, keeping path bytes out of cat-file's
// line-delimited protocol.
export function batchBlobContents(root, oids, outputLimit) {
  const contents = new Map()
  if (oids.length === 0) return contents
  let rest = git(root, ['cat-file', '--batch'], {
    input: oids.map((oid) => `${oid}\n`).join(''),
    maxBuffer: outputLimit + 1024,
  })
  for (const oid of oids) {
    const newline = rest.indexOf(0x0a)
    if (newline < 0) throw new GitError(`read blob ${oid}: truncated cat-file batch header`)
    const fields = rest.subarray(0, newline).toString('utf8').split(/\s+/).filter(Boolean)
    rest = rest.subarray(newline + 1)
    if (fields.length !== 3 || fields[0] !== oid || fields[1] !== 'blob') {
      throw new GitError(`read blob ${oid}: unexpected cat-file header ${JSON.stringify(fields)}`)
    }
    const size = Number(fields[2])
    if (!Number.isInteger(size) || size < 0 || size >= rest.length || rest[size] !== 0x0a) {
      throw new GitError(`read blob ${oid}: invalid cat-file content`)
    }
    contents.set(oid, rest.subarray(0, size))
    rest = rest.subarray(size + 1)
  }
  if (rest.length !== 0) throw new GitError('unexpected trailing cat-file batch output')
  return contents
}

// grepInterpreterDirective returns the candidate-tree paths that contain a line
// starting with "#!" (git grep skips binary files, exactly as the original).
export function grepInterpreterDirective(root, tree, paths) {
  const fixed = ['grep', '-I', '-l', '-z', '-i', '-E', '^#!', tree, '--']
  const matches = []
  for (const batch of batchLiteralPathspecs(paths, prefixLengthOf(root, fixed))) {
    const out = git(root, [...fixed, ...batch], { okStatuses: [0, 1] })
    for (const match of out.toString('utf8').split('\0')) {
      const path = match.startsWith(`${tree}:`) ? match.slice(tree.length + 1) : match
      if (path !== '') matches.push(path)
    }
  }
  return matches
}

export { prefixLengthOf }
