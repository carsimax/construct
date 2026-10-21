// Publication gate (PreToolUse on Bash). Before `git push`, `gh pr create`, or
// `gh release create` it runs `odd-review validate --gate pre-push|pre-pr|release` and denies
// the call when the gate reports review_required. It fails open: any other result (no
// repository, an odd-review error, a timeout, unreadable input) means no output and exit 0.
// Commands are found through `sh -c`, `eval`, `$(...)`, backticks, wrappers such as sudo or
// env, `git -C DIR`, and a preceding `cd DIR`. A dry run and a branch deletion publish no
// work, so they are not gated.
// Usage: node publication-gate.mjs   (hook JSON on stdin)
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readInput } from './hook-io.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '../../bin/odd-review')
const TIMEOUT_MS = 25000
const MAX_DEPTH = 4
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
// Wrappers keep command position for the next word; the set holds the flags that take a value.
// shortcut: flags are skipped by shape (a leading `-`) plus these value flags; upgrade to
// per-wrapper grammars if a wrapper hides a publication behind an unlisted value flag.
const WRAPPERS = {
  sudo: new Set(['-u', '-g', '-C', '-h', '-p', '-r', '-t', '-U', '-D']),
  command: new Set(),
  builtin: new Set(),
  env: new Set(['-u', '-C', '-S']),
  nohup: new Set(),
  time: new Set(),
  exec: new Set(['-a']),
  xargs: new Set(['-n', '-I', '-L', '-P', '-s', '-d', '-E', '-a', '-l', '-i']),
  nice: new Set(['-n']),
  ionice: new Set(['-c', '-n', '-p']),
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  '!': new Set(),
  '{': new Set(),
  if: new Set(),
  then: new Set(),
  else: new Set(),
  do: new Set(),
  while: new Set(),
}
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])
const PUSH_VALUE_FLAGS = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec', '--force-with-lease-value'])
const GH_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname'])
const RELEASE_VALUE_FLAGS = new Set(['-t', '--title', '-n', '--notes', '-F', '--notes-file', '--target', '--notes-start-tag', '--discussion-category', '-R', '--repo'])

// splitCommands is a small shell-word splitter: quotes and a backslash group a word, and an
// unquoted ; | & ( ) ` or newline ends a command. A redirection target is not a word.
// shortcut: this is a reduced copy of secret-guard's splitter, which is not importable (it
// runs on import); upgrade to an import when it is exported.
function splitCommands(input) {
  const commands = []
  let words = []
  let cur = ''
  let has = false
  let redir = false
  const endWord = () => {
    if (has && !redir) words.push(cur)
    if (has) redir = false
    cur = ''
    has = false
  }
  const endCommand = () => {
    endWord()
    redir = false
    if (words.length) commands.push(words)
    words = []
  }
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (c === "'") {
      const end = input.indexOf("'", i + 1)
      const stop = end === -1 ? input.length : end
      cur += input.slice(i + 1, stop)
      has = true
      i = stop
    } else if (c === '"') {
      has = true
      for (i++; i < input.length && input[i] !== '"'; i++) {
        if (input[i] === '\\' && i + 1 < input.length && '$`"\\\n'.includes(input[i + 1])) i++
        cur += input[i]
      }
    } else if (c === '\\' && i + 1 < input.length) {
      cur += input[++i]
      has = true
    } else if (/\s/.test(c) && c !== '\n') {
      endWord()
    } else if (';|&()`\n'.includes(c)) {
      endCommand()
    } else if (c === '<' || c === '>') {
      endWord()
      const op = /^(<<<|<<-?|>>|>\||>&[0-9-]*|<&[0-9-]*|[<>])/.exec(input.slice(i))[0]
      i += op.length - 1
      redir = !/&[0-9-]*$/.test(op) && op !== '<<<'
    } else {
      cur += c
      has = true
    }
  }
  endCommand()
  return commands
}

const HEREDOC_RE = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=\n|$)/g
const stripHeredocs = (command) => command.replace(HEREDOC_RE, (raw) => raw.slice(0, raw.indexOf('\n')))

// substitutions lists the bodies of $(...) and backticks, which a quoted word can still hold.
function substitutions(word) {
  const out = []
  for (const m of word.matchAll(/\$\(([^()]*)\)/g)) out.push(m[1])
  for (const m of word.matchAll(/`([^`]*)`/g)) out.push(m[1])
  return out
}

function headIndex(words) {
  let i = 0
  while (i < words.length) {
    const name = basename(words[i])
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++
    else if (Object.hasOwn(WRAPPERS, name)) {
      const values = WRAPPERS[name]
      i++
      let first = true
      while (i < words.length) {
        if (words[i] === '--') { i++; break }
        if (words[i].startsWith('-') && words[i].length > 1) i += values.has(words[i]) ? 2 : 1
        else if (name === 'timeout' && first) i++
        else if (name === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++
        else break
        first = false
      }
    } else break
  }
  return i
}

// option reads `--name value`, `--name=value`, or a short `-N value`; null when absent.
function optionValue(args, ...names) {
  for (let i = 0; i < args.length; i++) {
    for (const name of names) {
      if (args[i] === name) return args[i + 1] ?? null
      if (name.startsWith('--') && args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1)
    }
  }
  return null
}

// positionals drops flags (and the values of the listed value flags).
function positionals(args, valueFlags) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') return [...out, ...args.slice(i + 1)]
    if (a.startsWith('-') && a.length > 1) {
      if (valueFlags.has(a)) i++
    } else out.push(a)
  }
  return out
}

// gitPublication returns the push described by the arguments after `git`, or null.
function gitPublication(args, cwd) {
  let dir = cwd
  let i = 0
  while (args[i]?.startsWith('-')) {
    if (args[i] === '-C' && args[i + 1] !== undefined) dir = resolve(dir, args[i + 1])
    i += GIT_VALUE_FLAGS.has(args[i]) ? 2 : 1
  }
  if (args[i] !== 'push') return null
  const rest = args.slice(i + 1)
  if (rest.some((a) => a === '--dry-run' || (/^-[^-]/.test(a) && a.slice(1).includes('n')) || a === '--delete' || (/^-[^-]/.test(a) && a.slice(1).includes('d')))) return null
  const [remote, ...all] = positionals(rest, PUSH_VALUE_FLAGS)
  // `:dst` deletes a remote ref and publishes no work.
  const refspecs = all.filter((spec) => !spec.replace(/^\+/, '').startsWith(':'))
  if (all.length > 0 && refspecs.length === 0) return null
  return { gate: 'pre-push', dir, remote, refspecs }
}

function ghPublication(args, cwd) {
  let i = 0
  while (args[i]?.startsWith('-')) i += GH_VALUE_FLAGS.has(args[i]) ? 2 : 1
  const rest = args.slice(i + 2)
  if (args[i] === 'pr' && args[i + 1] === 'create') return { gate: 'pre-pr', dir: cwd, base: optionValue(rest, '--base', '-B') }
  if (args[i] === 'release' && args[i + 1] === 'create') {
    return { gate: 'release', dir: cwd, tag: positionals(rest, RELEASE_VALUE_FLAGS)[0], target: optionValue(rest, '--target') }
  }
  return null
}

// findPublications walks a command line and returns every publication it contains.
function findPublications(command, cwd, depth = 0) {
  if (depth > MAX_DEPTH) return []
  const found = []
  const nested = (line, at) => found.push(...findPublications(line, at, depth + 1))
  let where = cwd
  for (const words of splitCommands(stripHeredocs(command))) {
    for (const word of words) for (const body of substitutions(word)) nested(body, where)
    const at = headIndex(words)
    const name = basename(words[at] ?? '')
    const args = words.slice(at + 1)
    if (SHELLS.has(name)) {
      const flag = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a))
      if (flag >= 0 && args[flag + 1] !== undefined) nested(args[flag + 1], where)
    } else if (name === 'eval') nested((args[0] === '--' ? args.slice(1) : args).join(' '), where)
    else if (name === 'cd' && args[0] && !args[0].startsWith('-')) where = resolve(where, args[0])
    else if (name === 'git') {
      const push = gitPublication(args, where)
      if (push) found.push(push)
    } else if (name === 'gh') {
      const pub = ghPublication(args, where)
      if (pub) found.push(pub)
    }
  }
  return found
}

function resolves(dir, ref) {
  if (!ref || ref.startsWith('-')) return false
  return spawnSync('git', ['-C', dir, 'rev-parse', '--verify', '-q', `${ref}^{commit}`], { stdio: 'ignore' }).status === 0
}

const branchOf = (ref) => ref.replace(/^refs\/heads\//, '')

// gateArgs maps a publication to `odd-review validate` arguments: a pushed source is the head,
// a known remote-tracking branch is the base, a PR base branch is the base, and a release
// target is the head. Anything that does not resolve locally is left to the CLI's defaults.
function gateArgs(pub) {
  const args = ['--gate', pub.gate]
  if (pub.gate === 'pre-push') {
    const spec = (pub.refspecs[0] ?? '').replace(/^\+/, '')
    const [src, dst] = spec.split(':')
    if (src && src !== 'HEAD') args.push('--head-ref', src)
    const branch = branchOf(dst || src || '')
    if (pub.remote && branch && branch !== 'HEAD' && resolves(pub.dir, `refs/remotes/${pub.remote}/${branch}`)) args.push('--base-ref', `refs/remotes/${pub.remote}/${branch}`)
  } else if (pub.gate === 'pre-pr') {
    const base = pub.base && branchOf(pub.base)
    if (base) {
      const ref = [`refs/remotes/origin/${base}`, `refs/heads/${base}`].find((candidate) => resolves(pub.dir, candidate))
      if (ref) args.push('--base-ref', ref)
    }
  } else {
    if (pub.tag) args.push('--tag', pub.tag)
    if (pub.target && resolves(pub.dir, pub.target)) args.push('--head-ref', pub.target)
  }
  return args
}

function verdict(pub) {
  const refspecs = pub.gate === 'pre-push' && pub.refspecs.length > 1 ? pub.refspecs : [pub.refspecs?.[0]]
  for (const spec of refspecs) {
    const single = pub.gate === 'pre-push' ? { ...pub, refspecs: spec === undefined ? [] : [spec] } : pub
    const run = spawnSync(BIN, ['--cwd', pub.dir, 'validate', ...gateArgs(single)], { encoding: 'utf8', timeout: TIMEOUT_MS })
    if (run.status !== 1) continue
    let error
    try {
      error = JSON.parse(run.stderr).error
    } catch {
      continue
    }
    if (error?.code === 'review_required' && typeof error.message === 'string') return `publication-gate: ${error.message}`
  }
  return null
}

function main() {
  const input = readInput()
  if (!input || input.tool_name !== 'Bash' || typeof input.cwd !== 'string' || input.cwd === '') return
  const command = input.tool_input?.command
  if (typeof command !== 'string' || command === '') return
  for (const pub of findPublications(command, input.cwd)) {
    const reason = verdict(pub)
    if (reason) {
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`)
      return
    }
  }
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
