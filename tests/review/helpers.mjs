// Shared fixtures for the odd-review tests: a runner for the real CLI, a
// repository whose candidate is high risk, and builders for agent results.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { applyFiles, git, makeRepo } from '../assess/helpers.mjs'

export { applyFiles, assessJson, commitAll, git, makeRepo, scratchDir, sh, write } from '../assess/helpers.mjs'

export const REVIEW_BIN = new URL('../../plugins/odd-skills/bin/odd-review', import.meta.url).pathname
export const LENSES = ['review-risk', 'review-resilience', 'review-readability', 'review-reliability']

const parse = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// review runs the real CLI. stdout success JSON is `json`; a refusal prints JSON
// to stderr and is `error`.
export function review(repo, args, { input, env } = {}) {
  const result = spawnSync(REVIEW_BIN, ['--cwd', repo, ...args], {
    encoding: 'utf8',
    input,
    env: { ...process.env, ...env },
  })
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: parse(result.stdout),
    error: parse(result.stderr)?.error ?? null,
  }
}

// highRepo has one shell script and a 20-line markdown file with spaces in its
// name: 21 changed lines, so the correction budget is 11 lines.
export function highRepo(extra = {}) {
  const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
  applyFiles(repo, {
    'scripts/build.sh': 'echo hi\n',
    'docs/the guide.md': Array.from({ length: 20 }, (_, i) => `Guide line ${i}\n`).join(''),
    ...extra,
  })
  return repo
}

export function start(repo, { lenses = 'risk,reliability', args = [] } = {}) {
  const result = review(repo, ['start', '--lenses', lenses, '--lenses-reason', 'touches a shell script', ...args])
  if (result.status !== 0) throw new Error(`start failed: ${result.stdout} ${result.stderr}`)
  return result.json
}

export const lensResult = (subject, manifest, findings = [], evidence = ['inspected every patch']) => ({
  subject_hash: subject,
  inspection: { status: 'completed', paths: [...manifest].reverse() },
  findings,
  evidence,
})

export const finding = (overrides = {}) => ({
  location: 'scripts/build.sh:1',
  severity: 'CRITICAL',
  claim: 'the script runs an unchecked command',
  evidence_class: 'deterministic',
  causal_disposition: 'introduced',
  proof_refs: ['scripts/build.sh:1 added in this change'],
  ...overrides,
})

export function capture(repo, txn, lens, result, extra = []) {
  return review(repo, ['capture', '--lineage', txn.lineage, '--lens', lens, '--input', '-', ...extra], {
    input: JSON.stringify(result),
  })
}

// captureAll captures every selected lens; findingsByLens maps lens to findings.
export function captureAll(repo, txn, findingsByLens = {}) {
  let last
  for (const lens of txn.lenses) {
    last = capture(repo, txn, lens, lensResult(txn.subjects[lens], txn.manifest, findingsByLens[lens] ?? []))
    if (last.status !== 0) throw new Error(`capture ${lens} failed: ${last.stderr}`)
  }
  return last.json
}

export const storeRoot = (repo) => join(resolve(repo, git(repo, 'rev-parse', '--git-common-dir').trim()), 'odd-review')
export const transactionFile = (repo, lineage) => join(storeRoot(repo), 'transactions', `${lineage}.json`)
export const readTransaction = (repo, lineage) => JSON.parse(readFileSync(transactionFile(repo, lineage), 'utf8'))
export const receiptFiles = (repo) =>
  existsSync(join(storeRoot(repo), 'receipts')) ? readdirSync(join(storeRoot(repo), 'receipts')) : []

// repoFingerprint captures everything a command must not change.
export function repoFingerprint(repo) {
  const index = readFileSync(join(repo, '.git', 'index'))
  return {
    head: git(repo, 'rev-parse', 'HEAD').trim(),
    index: createHash('sha256').update(index).digest('hex'),
    status: git(repo, 'status', '--porcelain=v1', '-uall'),
    worktree: git(repo, 'ls-files', '-o', '-m', '--exclude-standard'),
  }
}

export const sha = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`

// refuterSubject is the lineage-bound subject the refuter must copy back.
export const refuterSubject = (repo, txn) => readTransaction(repo, txn.lineage).refutation_subject
