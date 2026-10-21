// Publication gate (PreToolUse on Bash). Before `git push`, `gh pr create`, or
// `gh release create` it runs `odd-review validate --gate pre-push|pre-pr|release` and denies
// the call when the gate reports review_required. Outcomes of the CLI:
//   exit 1 review_required   deny;
//   exit 1 bad_ref           the hook passed a ref the CLI cannot read: the gate runs again
//                            for HEAD (the checked-out branch) and that verdict decides, so
//                            an unreadable ref never allows what HEAD would deny;
//   anything else            allow (no repository, usage or internal errors, a timeout,
//                            unreadable input): the hook fails open, as the other gates do.
// A push source containing `$` or a backtick (an unexpanded substitution or variable), or
// one that does not resolve to a commit, is judged as HEAD.
// Commands are found through the unwrapping command-guard uses (`sh -c [--]`, `env -S`, `eval`,
// `$(...)`, backticks, wrappers such as sudo or env), `git -C DIR`, and a preceding `cd DIR`. A
// directory with a variable or substitution other than ~ or $HOME cannot be checked: it is denied. A dry run and a branch deletion publish no
// work, so they are not gated.
// Usage: node publication-gate.mjs   (hook JSON on stdin)
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractHeredocs, nestedLines, substitutionBodies } from './command-guard.mjs'
import { readInput } from './hook-io.mjs'
import { splitCommands } from './shell-words.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '../../bin/odd-review')
const TIMEOUT_MS = 25000
const MAX_DEPTH = 4
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])
const PUSH_VALUE_FLAGS = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec', '--force-with-lease-value'])
const GH_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname'])
const RELEASE_VALUE_FLAGS = new Set(['-t', '--title', '-n', '--notes', '-F', '--notes-file', '--target', '--notes-start-tag', '--discussion-category', '-R', '--repo'])

// closingBacktick returns the index of the backtick that closes the span opened before `from`, or -1.
function closingBacktick(text, from) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '`') return i
  }
  return -1
}

// closingParen returns the index of the `)` that closes a `$(` whose body starts at `from`, or -1.
// The body is scanned with quote state: a `)` inside single or double quotes, after a backslash,
// or inside a nested `$(...)` or backtick span does not close it.
function closingParen(text, from, inDouble = false) {
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (c === "'" && !inDouble) {
      i = text.indexOf("'", i + 1)
      if (i < 0) return -1
    } else if (c === '"') {
      if (inDouble) return -1
      i = closingDouble(text, i + 1)
      if (i < 0) return -1
    } else if (c === '`') {
      i = closingBacktick(text, i + 1)
      if (i < 0) return -1
    } else if (c === '$' && text[i + 1] === '(') {
      i = closingParen(text, i + 2)
      if (i < 0) return -1
    } else if (c === ')') return i
  }
  return -1
}

// closingDouble returns the index of the `"` that closes a double-quoted string whose body starts
// at `from`, or -1. Substitutions inside it are skipped whole.
function closingDouble(text, from) {
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (c === '"') return i
    else if (c === '`') {
      i = closingBacktick(text, i + 1)
      if (i < 0) return -1
    } else if (c === '$' && text[i + 1] === '(') {
      i = closingParen(text, i + 2)
      if (i < 0) return -1
    }
  }
  return -1
}

// quoteSubstitutions wraps each unquoted `$(...)` or backtick span in double quotes, because the
// tokenizer would split such a span into commands of its own and `git -C $(pwd)` would lose its
// directory; quoted, it stays one word and is seen as unresolvable. Span ends come from the
// quote-aware scanners above. A span that never closes is left as written, so the tokenizer
// still sees whatever follows it.
function quoteSubstitutions(text) {
  let out = ''
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    let end = -1
    if (quote === null && c === '$' && text[i + 1] === '(') end = closingParen(text, i + 2)
    else if (quote === null && c === '`') end = closingBacktick(text, i + 1)
    if (end > i) {
      out += `"${text.slice(i, end + 1)}"`
      i = end
      continue
    }
    if (c === '\\' && quote !== "'") out += text[i++]
    else if (c === "'" && quote !== '"') quote = quote === "'" ? null : "'"
    else if (c === '"' && quote !== "'") quote = quote === '"' ? null : '"'
    out += text[i] ?? ''
  }
  return out
}

// Heredoc bodies are data, not commands; substitutions are quoted into single words.
const stripHeredocs = (command) => quoteSubstitutions(extractHeredocs(command).text)

// resolveDir returns the directory a `-C`/`cd` argument names, or null when it cannot be known:
// `~`, `$HOME`, and `${HOME}` expand from HOME; any other `$` or backtick, or a relative path
// from an unknown base, is unresolvable.
function resolveDir(base, arg) {
  const home = process.env.HOME
  const expanded = home ? arg.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home) : arg
  if (/[$`]/.test(expanded) || /^~/.test(expanded)) return null
  return base === null && !expanded.startsWith('/') ? null : resolve(base ?? '/', expanded)
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
    if (args[i] === '-C' && args[i + 1] !== undefined) dir = resolveDir(dir, args[i + 1])
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
  for (const tokens of splitCommands(stripHeredocs(command))) {
    // A redirection target is not a word.
    const words = tokens.filter((w) => !w.r).map((w) => w.t)
    for (const word of words) for (const body of substitutionBodies(word)) nested(body, where)
    const { name, args, lines } = nestedLines(words)
    for (const line of lines) nested(line, where)
    if (name === 'cd' && args[0] && !args[0].startsWith('-')) where = resolveDir(where, args[0])
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
    if (src && src !== 'HEAD' && !/[$`]/.test(src) && resolves(pub.dir, src)) args.push('--head-ref', src)
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

// gateError runs the gate CLI and returns its refusal ({code, message}); null for exit 0, a
// timeout, or output that is not a refusal.
function gateError(dir, args) {
  const run = spawnSync(BIN, ['--cwd', dir, 'validate', ...args], { encoding: 'utf8', timeout: TIMEOUT_MS })
  if (run.status !== 1) return null
  try {
    const error = JSON.parse(run.stderr).error
    return typeof error?.code === 'string' && typeof error.message === 'string' ? error : null
  } catch {
    return null
  }
}

function verdict(pub) {
  const refspecs = pub.gate === 'pre-push' && pub.refspecs.length > 1 ? pub.refspecs : [pub.refspecs?.[0]]
  for (const spec of refspecs) {
    const single = pub.gate === 'pre-push' ? { ...pub, refspecs: spec === undefined ? [] : [spec] } : pub
    let error = gateError(pub.dir, gateArgs(single))
    if (error?.code === 'bad_ref') error = gateError(pub.dir, ['--gate', pub.gate])
    if (error?.code === 'review_required') return `publication-gate: ${error.message}`
  }
  return null
}

const unresolvable = (command) => `publication-gate: this publishes work from a directory the gate cannot resolve (${command}). Write the repository path literally (no variable or substitution besides ~ and $HOME), so the gate can check its review state.`

function main() {
  const input = readInput()
  if (!input || input.tool_name !== 'Bash' || typeof input.cwd !== 'string' || input.cwd === '') return
  const command = input.tool_input?.command
  if (typeof command !== 'string' || command === '') return
  for (const pub of findPublications(command, input.cwd)) {
    const reason = pub.dir === null ? unresolvable(pub.gate === 'pre-push' ? 'git push' : pub.gate === 'pre-pr' ? 'gh pr create' : 'gh release create') : verdict(pub)
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
