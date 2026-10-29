// Shared git helpers: git and defaultBranch, used by the publication gate and skill-context.mjs. (The file once held the
// context-backstop PostToolBatch hook; it was removed with the fixed autonomy limits, S3 of .vault/tasks/oracle-limits.md.)
// adapted from gentle-shell (https://github.com/Gentleman-Programming/gentle-shell), MIT, Copyright (c) 2025 Mario Zechner, see LICENSE-gentle-shell
import { spawnSync } from 'node:child_process'

const GIT_TIMEOUT_MS = 2000

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
