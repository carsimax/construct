// Publication gate (PreToolUse on Bash). Before `git push`, `gh pr create`, or
// `gh release create` it decides from the feature documents the branch changed:
//   - the default branch and its merge-base with HEAD come from git (origin/HEAD, origin or local
//     main/master; a `gh pr create --base` branch is tried first); when none resolves, deny;
//   - the `odd/tasks/*.md` files changed in merge-base..HEAD are read at HEAD, and the integers
//     1-6 at the start of each Risk cell of their Tasks table name the Risk items;
//   - requiredLenses(items) (review-lenses.mjs) says which lenses must have approved the subject,
//     the hash of the merge-base tree and the HEAD tree (review-store.mjs). None required: allow;
//     a required lens without a verdict, or with an unapproved one: deny, naming the lenses, the
//     `Review subject: <merge-base sha>` line, and the construct:rdd-review skill;
//   - any error while deciding (git failure, unreadable document) denies with its reason. Outside a
//     git repository there is nothing to publish, so the call passes.
// The decision is about HEAD whatever the pushed refspec is: new commits change the subject, so
// the review must run again. The hook entry sets onFailure: "block", so a crash denies as well.
// Commands are found through the unwrapping shell-words.mjs does (`sh -c [--]`, `env -S`, `eval`,
// `$(...)`, backticks, wrappers such as sudo or env), `git -C DIR`, and a preceding `cd DIR`. A
// directory with a variable or substitution other than ~ or $HOME cannot be checked: it is denied. A dry run and a branch deletion publish no
// work, so they are not gated.
// Usage: node publication-gate.mjs   (hook JSON on stdin)
import { resolve } from 'node:path'
import { git, repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { requiredLenses } from './review-lenses.mjs'
import { readVerdicts, subjectHash } from './review-store.mjs'
import { extractHeredocs, GIT_VALUE_FLAGS, nestedLines, splitCommands, substitutionBodies } from './shell-words.mjs'

const MAX_DEPTH = 4
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
function closingParen(text, from) {
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (c === "'") {
      i = text.indexOf("'", i + 1)
      if (i < 0) return -1
    } else if (c === '"') {
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

// stripComments removes `#` comments (a `#` that starts a word, outside quotes, to the end of the
// line): the tokenizer does not know them, so a quote inside a comment would open a quote run.
function stripComments(text) {
  let out = ''
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\' && quote !== "'") out += text[i++]
    else if (c === "'" && quote !== '"') quote = quote === "'" ? null : "'"
    else if (c === '"' && quote !== "'") quote = quote === '"' ? null : '"'
    else if (c === '#' && quote === null && (i === 0 || /[\s;&|(`]/.test(text[i - 1]))) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++
      continue
    }
    out += text[i] ?? ''
  }
  return out
}

// Heredoc bodies are data, not commands. Each command is read in three views: as written, with
// substitutions quoted into single words, and with comments removed as well, so a scanner mistake
// in one view cannot hide a push another sees.
const views = (command) => {
  const text = extractHeredocs(command).text
  return [text, quoteSubstitutions(text), quoteSubstitutions(stripComments(text))]
}

// resolveDir returns the directory a `-C`/`cd` argument names, or null when it cannot be known:
// `~`, `$HOME`, and `${HOME}` expand from HOME; any other `$` or backtick, or a relative path
// from an unknown base, is unresolvable.
function resolveDir(base, arg) {
  const home = process.env.HOME
  const expanded = home ? arg.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home) : arg
  if (/[$`]/.test(expanded) || /^~/.test(expanded)) return null
  return base === null && !expanded.startsWith('/') ? null : resolve(base ?? '/', expanded)
}

// changeDir: the directory after `cd`/`pushd`/`popd`. `cd` with no target, `cd -`, `pushd` with
// no target, and `popd` go somewhere the gate cannot know (null, the unresolvable-directory deny).
function changeDir(where, name, args) {
  const rest = args.filter((a) => a === '-' || !/^-[A-Za-z@]+$/.test(a))
  const target = rest[0] === '--' ? rest[1] : rest[0]
  if (name === 'popd' || target === undefined || target === '-') return null
  return resolveDir(where, target)
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
  const seen = new Map()
  for (const text of views(command)) {
    for (const pub of publicationsIn(text, cwd, depth)) seen.set(JSON.stringify(pub), pub)
  }
  return [...seen.values()]
}

function publicationsIn(text, cwd, depth) {
  if (depth > MAX_DEPTH) return []
  const found = []
  const nested = (line, at) => found.push(...findPublications(line, at, depth + 1))
  let where = cwd
  for (const tokens of splitCommands(text)) {
    // A redirection target is not a word.
    const words = tokens.filter((w) => !w.r).map((w) => w.t)
    for (const word of words) for (const body of substitutionBodies(word)) nested(body, where)
    const { name, args, lines } = nestedLines(words)
    for (const line of lines) nested(line, where)
    if (name === 'cd' || name === 'pushd' || name === 'popd') where = changeDir(where, name, args)
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

const out = (root, args) => git(root, args).toString('utf8').trim()
const ok = (root, ref) => git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`], { okStatuses: [0, 1] }).toString('utf8').trim() !== ''

// defaultBranch returns the first resolvable candidate: a `gh pr create --base` branch, origin's HEAD,
// then origin or local main and master; null when none exists.
function defaultBranch(root, base) {
  const head = git(root, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { okStatuses: [0, 1] }).toString('utf8').trim()
  const named = base && !base.startsWith('-') ? [`refs/remotes/origin/${base.replace(/^refs\/heads\//, '')}`, `refs/heads/${base.replace(/^refs\/heads\//, '')}`] : []
  const candidates = [...named, head, ...['main', 'master'].flatMap((b) => [`refs/remotes/origin/${b}`, `refs/heads/${b}`])]
  return candidates.find((ref) => ref && ok(root, ref)) ?? null
}

// riskItems reads the Risk column of the Tasks table: the integers 1-6 at the start of each cell, or in a comma list.
function riskItems(markdown) {
  const items = new Set()
  let inTasks = false
  let column = -1
  for (const line of markdown.split('\n')) {
    if (/^##\s/.test(line)) {
      inTasks = /^##\s+Tasks\s*$/.test(line)
      column = -1
    } else if (inTasks && line.trim().startsWith('|')) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      if (column < 0) column = cells.findIndex((c) => c.toLowerCase() === 'risk')
      else if (cells[column] !== undefined) {
        for (const n of /^\d+(?:\s*,\s*\d+)*/.exec(cells[column])?.[0].split(',') ?? []) if (Number(n) >= 1 && Number(n) <= 6) items.add(Number(n))
      }
    }
  }
  return items
}

function verdict(pub) {
  let root
  try {
    root = repositoryRoot(pub.dir)
  } catch {
    return null
  }
  try {
    const base = defaultBranch(root, pub.base)
    if (!base) return 'publication-gate: the default branch cannot be resolved (no origin/HEAD, origin or local main or master), so the review state cannot be checked. Create or fetch it, then publish again.'
    const mergeBase = out(root, ['merge-base', base, 'HEAD'])
    const names = out(root, ['diff', '--name-only', '-z', '--diff-filter=d', mergeBase, 'HEAD', '--']).split('\0')
    const items = new Set()
    for (const path of names.filter((p) => /^odd\/tasks\/[^/]+\.md$/.test(p))) {
      for (const item of riskItems(out(root, ['show', `HEAD:${path}`]))) items.add(item)
    }
    const required = requiredLenses(items)
    if (required.length === 0) return null
    const subject = subjectHash(out(root, ['rev-parse', `${mergeBase}^{tree}`]), out(root, ['rev-parse', 'HEAD^{tree}']))
    const verdicts = readVerdicts(root, subject)
    const missing = required.filter((lens) => verdicts[lens] === undefined)
    const rejected = required.filter((lens) => verdicts[lens] !== undefined && verdicts[lens].approved !== true)
    if (missing.length === 0 && rejected.length === 0) return null
    const parts = [missing.length > 0 && `no verdict from ${missing.join(', ')}`, rejected.length > 0 && `not approved by ${rejected.join(', ')}`].filter(Boolean)
    return `publication-gate: ${pub.gate} is denied because the branch's feature documents name Risk items ${[...items].sort().join(', ')} and HEAD is not reviewed: ${parts.join('; ')}. Run the construct:rdd-review skill with the subject line \`Review subject: ${mergeBase}\`, fix what a lens rejects, and publish again; new commits change the subject, so review after the last commit.`
  } catch (error) {
    return `publication-gate: the review state could not be checked (${error.message}), so this publication is denied.`
  }
}

const unresolvable = (command) => `publication-gate: this publishes work from a directory the gate cannot resolve (${command}). Write the repository path literally (no variable or substitution besides ~ and $HOME), so the gate can check its review state.`

function main() {
  const input = readInput()
  if (!input || input.tool_name !== 'Bash' || typeof input.cwd !== 'string' || input.cwd === '') return
  const command = input.tool_input?.command
  if (typeof command !== 'string' || command === '') return
  // An unresolvable directory is reported first: its reason says what to fix.
  const pubs = findPublications(command, input.cwd).sort((a, b) => (b.dir === null) - (a.dir === null))
  for (const pub of pubs) {
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
