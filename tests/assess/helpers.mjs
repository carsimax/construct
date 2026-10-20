// Shared fixtures for the odd-assess tests: throwaway git repositories built in
// temporary directories, and a runner for the real CLI.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const BIN = new URL('../../plugins/odd-skills/bin/odd-assess', import.meta.url).pathname

const created = []
process.on('exit', () => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

export function sh(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', ...options })
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}: ${result.stderr}`)
  }
  return result
}

export function git(cwd, ...args) {
  return sh(cwd, 'git', args).stdout
}

// write creates a file (string or Buffer content) with an optional executable bit.
export function write(repo, path, content, { executable = false } = {}) {
  const file = join(repo, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  chmodSync(file, executable ? 0o755 : 0o644)
}

// makeRepo creates a repository with one unchanged base commit holding `base`
// (path -> content or {content, executable}).
// A temporary directory removed when the test process exits
export function scratchDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

export function makeRepo(base = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'odd-assess-test-'))
  created.push(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'commit.gpgsign', 'false')
  git(repo, 'config', 'core.fileMode', 'true')
  write(repo, '.base-anchor', 'anchor\n')
  applyFiles(repo, base)
  commitAll(repo, 'base')
  return repo
}

export function applyFiles(repo, files) {
  for (const [path, spec] of Object.entries(files)) {
    if (spec === null) {
      rmSync(join(repo, path), { force: true })
    } else if (typeof spec === 'object' && !Buffer.isBuffer(spec)) {
      write(repo, path, spec.content, { executable: spec.executable })
    } else {
      write(repo, path, spec)
    }
  }
}

export function commitAll(repo, message) {
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', message)
}

// assess runs the real CLI and returns {status, stdout, stderr, json}.
export function assess(repo, args = []) {
  const result = spawnSync(BIN, ['--cwd', repo, ...args], { encoding: 'utf8' })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // Human output or a usage error: no JSON.
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json }
}

export const assessJson = (repo, args = []) => assess(repo, [...args, '--json'])

// reasonKeys flattens reasons to sorted "code:path" strings (no path: just code).
export const reasonKeys = (reasons) => reasons.map((r) => (r.path ? `${r.code}:${r.path}` : r.code)).sort()
