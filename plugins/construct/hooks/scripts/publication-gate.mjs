// Publication gate (PreToolUse on Bash). Before `git push`, `gh pr create`, or
// `gh release create` it judges every ref being published, from the feature documents the ref changed:
//   - the refs are the push sources (`feat`, `feat:main` -> feat, `HEAD:x` -> HEAD; no refspec -> HEAD;
//     `--all`, `--branches`, `--mirror`, `--tags`, the matching refspec `:` -> every local branch), `gh pr create --head` and
//     `gh release create --target` (the default branch when none: that is what gh tags), HEAD when
//     none is named for the others; a ref that does not resolve denies; the default branch itself
//     with no remote-tracking default to compare with denies;
//   - the default branch and its merge-base with the ref come from git (origin/HEAD, origin or local
//     main/master; a `gh pr create --base` branch is tried first); when none resolves, deny;
//   - the `odd/tasks/*.md` files changed in merge-base..ref are read at the ref and at the merge-base
//     (lowering a Risk in the branch does not hide it), and every integer 1-6
//     in each Risk cell of their Tasks table (the `## Tasks` heading may carry a suffix) names a Risk
//     item, a range `a-b`, `a–b`, `a—b`, `a to b` naming every item between (`none` names none; a cell
//     that is neither, a reversed or out-of-range range, or a missing Risk column, denies);
//   - requiredLenses(items) (review-lenses.mjs) says which lenses must have approved the subject, the
//     hash of the merge-base tree and the ref tree (review-store.mjs). A rejected subject stays
//     rejected. A required lens without approval: deny, naming the lenses, the `Review subject:` line, and the construct:review skill;
//   - a locked oracle (oracle-record.mjs) must be unchanged at the ref unless its feature document is finished on the default
//     branch: a changed or missing one denies; no oracle is ever required;
//   - an error while deciding denies with its reason, including one thrown after the command was
//     found to be a publication. Only unreadable hook input, a command that is no publication, and a
//     directory that is no git repository pass. The hook entry sets onFailure: "block" as well.
// Commands are found through the unwrapping shell-words.mjs does (`sh -c [--]`, `env -S`, `eval`,
// `$(...)`, backticks, wrappers such as sudo or env, heredoc and here-string bodies fed to a shell),
// `git -C DIR`, and a preceding `cd DIR`. A directory with a variable or substitution other than ~
// or $HOME cannot be checked: it is denied. A dry run and a branch deletion publish no work, so they
// are not gated. `gh pr new` and `gh release new` are aliases of `create`.
// shortcut: a heuristic parser; git aliases, interpreter one-liners, xargs, variable-built commands,
// --git-dir/GIT_DIR, a spoofed origin/HEAD, deleted or moved feature documents, and store paths
// built indirectly are not caught. Upgrade if one of them shows up in real use.
// Usage: node publication-gate.mjs   (hook JSON on stdin)
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultBranch } from './delivery-signals.mjs'
import { unfinishedRows } from './feature-state.mjs'
import { git, repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { requiredLenses } from './review-lenses.mjs'
import { pruneStore, readOracles, readVerdicts, subjectHash } from './review-store.mjs'
import { GIT_VALUE_FLAGS, heredocScripts, nestedLines, parsesAsShell, SHELLS, ShellParseError, splitCommands } from './shell-words.mjs'

const MAX_DEPTH = 4
const PUSH_VALUE_FLAGS = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec'])
const GH_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname'])

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
  // `:` alone pushes every matching branch; `:dst` deletes a remote ref and publishes no work.
  const matching = all.some((spec) => spec.replace(/^\+/, '') === ':')
  const refspecs = all.filter((spec) => !spec.replace(/^\+/, '').startsWith(':'))
  if (all.length > 0 && refspecs.length === 0 && !matching) return null
  // The source side of each refspec is what leaves the machine.
  const sources = refspecs.map((spec) => spec.replace(/^\+/, '').split(':')[0])
  const refs = matching || rest.some((a) => ['--all', '--branches', '--mirror', '--tags'].includes(a)) ? 'all' : sources.length > 0 ? sources : ['HEAD']
  return { gate: 'pre-push', dir, remote, refs }
}

function ghPublication(args, cwd) {
  let i = 0
  while (args[i]?.startsWith('-')) i += GH_VALUE_FLAGS.has(args[i]) ? 2 : 1
  const rest = args.slice(i + 2)
  const create = args[i + 1] === 'create' || args[i + 1] === 'new'
  if (args[i] === 'pr' && create) {
    // `--head owner:branch` names a fork's branch.
    const head = optionValue(rest, '--head', '-H')?.replace(/^.*:/, '')
    return { gate: 'pre-pr', dir: cwd, base: optionValue(rest, '--base', '-B'), refs: [head || 'HEAD'] }
  }
  if (args[i] === 'release' && create) return { gate: 'release', dir: cwd, refs: [optionValue(rest, '--target') || null] }
  return null
}

// findPublications walks a command line and returns every publication it contains. splitCommands
// finds the commands nested in substitutions, `case`, and heredoc expansions; the lines a command
// runs as a string (`sh -c`, `eval`, `env -S`, a here-string or heredoc fed to a shell) are read again.
// Throws ShellParseError for text that is not valid shell.
function findPublications(command, cwd, depth = 0) {
  if (depth > MAX_DEPTH) return []
  const found = []
  const nested = (line, at) => found.push(...findPublications(line, at, depth + 1))
  const commands = splitCommands(command)
  const scripts = heredocScripts(commands)
  let where = cwd
  const saved = [] // the directory before each open subshell: a `cd` inside `( ... )` ends with it
  for (const tokens of commands) {
    for (const p of tokens.parens) {
      if (p === '(') saved.push(where)
      else if (saved.length > 0) where = saved.pop()
    }
    // A redirection target is not a word.
    const words = tokens.filter((w) => !w.r).map((w) => w.t)
    const { name, args, lines } = nestedLines(words)
    for (const line of lines) nested(line, where)
    if (SHELLS.has(name)) for (const w of tokens) if (w.h) nested(w.t, where)
    for (const { text, strict } of scripts.get(tokens) ?? []) if (strict || parsesAsShell(text)) nested(text, where)
    if (name === 'cd' || name === 'pushd' || name === 'popd') where = changeDir(where, name, args)
    else if (name === 'git') {
      const push = gitPublication(args, where)
      if (push) found.push(push)
    } else if (name === 'gh') {
      const pub = ghPublication(args, where)
      if (pub) found.push(pub)
    }
  }
  return [...new Map(found.map((pub) => [JSON.stringify(pub), pub])).values()]
}

const out = (root, args) => git(root, args).toString('utf8').trim()
const ok = (root, ref) => git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`], { okStatuses: [0, 1] }).toString('utf8').trim() !== ''

// riskItems reads the Risk column of the Tasks table (a heading of level 2-6): `none` names no item, any other cell must hold
// an integer 1-6. An unreadable cell or a missing column throws, so the gate denies.
function riskItems(markdown, path) {
  const items = new Set()
  let inTasks = false
  let level = 0
  let column = -1
  let seenHeader = false
  for (const line of markdown.split('\n')) {
    const heading = /^(#{2,6})\s/.exec(line)
    // A Tasks heading of any level 2-6 opens the section; the next heading of the same or a higher level closes it.
    if (heading && (!inTasks || heading[1].length <= level)) {
      inTasks = /^#{2,6}\s+Tasks\b/i.test(line)
      level = heading[1].length
      column = -1
      seenHeader = false
    } else if (inTasks && line.trim().startsWith('|') && !/^[\s|:-]+$/.test(line)) {
      // A cell holds `\|` for a literal pipe (same rule as feature-state.mjs splitRow).
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
      if (!seenHeader) {
        seenHeader = true
        column = cells.findIndex((c) => c.toLowerCase() === 'risk')
        if (column < 0) throw new Error(`${path} has a Tasks table without a Risk column`)
      } else {
        const cell = cells[column] ?? ''
        if (cell.replace(/[*`]/g, '').trim().toLowerCase().startsWith('none')) continue
        // A range a-b (also an en or em dash, or "to") names every item between its ends; a reversed
        // or out-of-range one is as unreadable as a bad cell.
        const spaced = cell.replace(/(?<!\d)(\d+)\s*(?:[-–—]|\bto\b)\s*(\d+)(?!\d)/gi, (_, a, b) => {
          if (!(a >= 1 && a <= b && b <= 6)) throw new Error(`${path} has a Risk cell with an invalid range: ${JSON.stringify(cell)} (a Risk cell names items 1-6)`)
          return Array.from({ length: b - a + 1 }, (__, i) => Number(a) + i).join(' ')
        })
        const numbers = spaced.match(/(?<!\d)[1-6](?!\d)/g)
        if (!numbers) throw new Error(`${path} has a Risk cell that is neither "none" nor names an item 1-6: ${JSON.stringify(cell)}`)
        for (const n of numbers) items.add(Number(n))
      }
    }
  }
  return items
}

// The risk floor (P5): paths in the published diff add Risk items, whatever the feature documents declare. A glob with no
// slash matches the basename at any depth (CODEOWNERS-like); `**` crosses directories, `*` and `?` stay inside one.
const FLOOR = [
  ['**/migrations/**', 1], ['*.sql', 1],
  ['**/auth/**', 2], ['**/*secret*', 2], ['.env*', 2],
  ...['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'poetry.lock', 'uv.lock', 'go.sum', 'Gemfile.lock', '.github/workflows/**', 'Dockerfile', 'install.sh'].map((g) => [g, 5]),
]

function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/'
      re += slash ? '(?:.*/)?' : '.*'
      i += slash ? 2 : 1
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[\\^$.|+()[\]{}]/g, '\\$&')
  }
  // Case-insensitive (a floor errs toward firing), and `s` so `.` also crosses a newline inside a path name.
  return new RegExp(`^${glob.includes('/') ? '' : '(?:.*/)?'}${re}$`, 'is')
}

// projectFloor reads `<glob> <items>` lines (items 1-6 joined by commas; `#` comments, blank lines) of odd/risk-paths at
// one commit, called with the merge base and the default branch tip, never the ref, so a change cannot lower its own
// floor and a rule added after it branched still applies. An unreadable line throws.
function projectFloor(root, commit) {
  if (out(root, ['ls-tree', '--name-only', commit, '--', 'odd/risk-paths']) === '') return []
  return out(root, ['show', `${commit}:odd/risk-paths`]).split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#')).flatMap((line) => {
    const m = /^(\S+)\s+([1-6](?:\s*,\s*[1-6])*)$/.exec(line)
    if (!m) throw new Error(`odd/risk-paths has an unreadable line: ${JSON.stringify(line)} (expected "<glob> <items 1-6, comma separated>")`)
    return m[2].split(',').map((n) => [m[1], Number(n)])
  })
}

// objectExists: `git cat-file -e` exits 0 (exists) or 1 (absent); any other status (an invalid name is 128) rethrows.
function objectExists(root, id) {
  try {
    git(root, ['cat-file', '-e', id])
    return true
  } catch (error) {
    if (error.status === 1) return false
    throw error
  }
}

// releaseRef is the remote-tracking default branch (origin/HEAD, then origin/main or origin/master) or '' when there is none:
// the publisher chooses `--base` and local branches, so only the remote-tracking default may release a lock.
function releaseRef(root) {
  const head = git(root, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { okStatuses: [0, 1] }).toString('utf8').trim()
  return [head, 'refs/remotes/origin/main', 'refs/remotes/origin/master'].find((ref) => ref && git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`], { okStatuses: [0, 1] }).length > 0) ?? ''
}

// oracleDenial (S3, protect only): a locked oracle (oracle-record.mjs) must be unchanged at the ref. A lock applies to a ref
// that carries the oracle (the path exists there, or its history ever had the locked blob at that path). It is released
// only when its feature document exists at the remote-tracking default branch (never a `--base` or a local branch; none means no release) with no unfinished task; the document at the ref is
// never read, so one push cannot edit an oracle and finish or delete its document. A table the hook cannot read keeps the lock.
// Returns the denial text, or null.
function oracleDenial(root, sha) {
  const release = releaseRef(root)
  const changed = []
  for (const lock of readOracles(root)) {
    const now = git(root, ['rev-parse', '--verify', '-q', `${sha}:${lock.path}`], { okStatuses: [0, 1] }).toString('utf8').trim()
    if (now === lock.blob) continue
    // A blob that does not exist (status 1) cannot be in any history; any other git failure throws and denies.
    if (now === '' && (!objectExists(root, lock.blob) || git(root, ['log', '-1', '--format=%H', `--find-object=${lock.blob}`, sha, '--', lock.path]).toString('utf8').trim() === '')) continue
    if (release && out(root, ['ls-tree', '--name-only', release, '--', lock.feature]) !== '') {
      const tasks = unfinishedRows(out(root, ['show', `${release}:${lock.feature}`]).split('\n'))
      if (tasks && tasks.rows.length === 0) continue
    }
    changed.push(`${lock.path} (${now === '' ? 'missing' : 'changed'} at the ref, locked for ${lock.feature})`)
  }
  return changed.length === 0 ? null : changed.join('; ')
}

// reviewState reads, without writing, the Risk items the feature documents changed between the merge base of base
// and sha name, the lenses they require, and each lens's verdict for that subject ('ok', 'rejected', or 'missing').
// The risk floor adds items from the diff paths (floor: item -> matched paths). A malformed Risk cell or odd/risk-paths line throws. refVerdict and skill-context.mjs share it.
export function reviewState(root, base, sha) {
  const mergeBase = out(root, ['merge-base', base, sha])
  // -M pairs a rename: its new path is read at the ref and its old path at the merge-base (a rename plus a lowered Risk
  // stays visible). A plain delete is ignored (L15: reading deleted documents would demand reviews for old merged work).
  const tokens = out(root, ['diff', '--name-status', '-M', '-z', mergeBase, sha, '--']).split('\0')
  const reads = [] // [commit, path]
  const paths = new Set() // every path the diff names: deleted ones and both sides of a rename too
  for (let k = 0; k < tokens.length - 1; ) {
    const status = tokens[k][0]
    if (status === 'R' || status === 'C') {
      paths.add(tokens[k + 1]).add(tokens[k + 2])
      reads.push([sha, tokens[k + 2]])
      if (status === 'R') reads.push([mergeBase, tokens[k + 1]])
      k += 3
    } else {
      paths.add(tokens[k + 1])
      if (status !== 'D') reads.push([sha, tokens[k + 1]], [mergeBase, tokens[k + 1]])
      k += 2
    }
  }
  const items = new Set()
  for (const [commit, path] of reads) {
    if (!/^odd\/tasks\/[^/]+\.md$/.test(path)) continue
    if (out(root, ['ls-tree', '--name-only', commit, '--', path]) === '') continue
    for (const item of riskItems(out(root, ['show', `${commit}:${path}`]), path)) items.add(item)
  }
  const floor = new Map()
  for (const [glob, item] of [...FLOOR, ...projectFloor(root, mergeBase), ...projectFloor(root, base)]) {
    const re = globToRegExp(glob)
    const hit = [...paths].filter((path) => re.test(path))
    if (hit.length > 0) floor.set(item, [...new Set([...(floor.get(item) ?? []), ...hit])])
  }
  for (const item of floor.keys()) items.add(item)
  const required = requiredLenses(items)
  if (required.length === 0) return { mergeBase, items, required, floor, state: () => 'missing' }
  const baseTree = out(root, ['rev-parse', `${mergeBase}^{tree}`])
  const headTree = out(root, ['rev-parse', `${sha}^{tree}`])
  const direct = readVerdicts(root, subjectHash(baseTree, headTree))
  const state = (lens) => (direct[lens] ? (direct[lens].approved === true ? 'ok' : 'rejected') : 'missing')
  return { mergeBase, items, required, floor, state }
}

// refVerdict judges one published ref: null when it may go, else the denial reason.
function refVerdict(root, pub, base, ref) {
  const short = ref.replace(/^refs\/heads\//, '')
  if (ref === '' || ref.startsWith('-') || !ok(root, ref)) {
    return `publication-gate: ${pub.gate} is denied because the ref ${JSON.stringify(ref)} does not resolve to a commit in this repository, so its review state cannot be checked.`
  }
  if (base.startsWith('refs/heads/') && out(root, ['rev-parse', '--symbolic-full-name', ref]) === base) {
    return `publication-gate: ${pub.gate} is denied because ${short} is the default branch and no remote-tracking default branch exists to compare it with (fetch origin, or publish a branch), so its review state cannot be checked.`
  }
  const sha = out(root, ['rev-parse', '--verify', `${ref}^{commit}`])
  const locked = oracleDenial(root, sha)
  if (locked) return `publication-gate: ${pub.gate} is denied because ${short} changes an oracle that is locked by content hash: ${locked}. The oracle is locked while its feature has unfinished tasks: restore the file, or return \`oracle_conflict\` to the user (the spec and the test disagree) or ask them to unlock it.`
  const { mergeBase, items, required, floor, state } = reviewState(root, base, sha)
  if (required.length === 0) return null
  const missing = required.filter((lens) => state(lens) === 'missing')
  const rejected = required.filter((lens) => state(lens) === 'rejected')
  if (missing.length === 0 && rejected.length === 0) return null
  const parts = [missing.length > 0 && `no verdict from ${missing.join(', ')}`, rejected.length > 0 && `not approved by ${rejected.join(', ')}`].filter(Boolean)
  const checkout = out(root, ['rev-parse', 'HEAD']) === sha ? '' : ` (the head is HEAD: check out ${short} first)`
  const floored = floor.size === 0 ? '' : ` (the diff paths set a floor: ${[...floor].map(([item, hit]) => `item ${item} from ${hit.slice(0, 5).join(', ')}${hit.length > 5 ? ', ...' : ''}`).join('; ')})`
  return `publication-gate: ${pub.gate} is denied because the feature documents and diff paths of ${short} name Risk items ${[...items].sort().join(', ')}${floored} and it is not reviewed: ${parts.join('; ')}. Run the construct:review skill with the subject line \`Review subject: ${mergeBase}\`${checkout}, fix what a lens rejects, and publish again; new commits change the subject, so review after the last commit.`
}

// verdict judges a publication (see findPublications for its shape): null when it may go, else the denial reason. pre-push.mjs reuses it.
export function verdict(pub) {
  let root
  try {
    root = repositoryRoot(pub.dir)
  } catch {
    return null
  }
  try {
    pruneStore(root)
    const base = defaultBranch(root, pub.base)
    if (!base) return 'publication-gate: the default branch cannot be resolved (no origin/HEAD, origin or local main or master), so the review state cannot be checked. Create or fetch it, then publish again.'
    const refs = pub.refs === 'all' ? out(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/']).split('\n').filter(Boolean) : pub.refs.map((ref) => ref ?? base)
    for (const ref of refs) {
      const reason = refVerdict(root, pub, base, ref)
      if (reason) return reason
    }
    return null
  } catch (error) {
    return `publication-gate: the review state could not be checked (${error.message}), so this publication is denied.`
  }
}

const unresolvable = (command) => `publication-gate: this publishes work from a directory the gate cannot resolve (${command}). Write the repository path literally (no variable or substitution besides ~ and $HOME), so the gate can check its review state.`

const deny = (reason) => process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`)
let publishing = false

function main() {
  const input = readInput()
  if (!input || input.tool_name !== 'Bash' || typeof input.cwd !== 'string' || input.cwd === '') return
  const command = input.tool_input?.command
  if (typeof command !== 'string' || command === '') return
  // A parser crash on text that mentions a publication cannot be told from a hidden one.
  publishing = /\bpush\b|\b(?:pr|release)\s+(?:create|new)\b/.test(command)
  // An unresolvable directory is reported first: its reason says what to fix.
  const pubs = findPublications(command, input.cwd).sort((a, b) => (b.dir === null) - (a.dir === null))
  publishing = publishing || pubs.length > 0
  for (const pub of pubs) {
    const reason = pub.dir === null ? unresolvable(pub.gate === 'pre-push' ? 'git push' : pub.gate === 'pre-pr' ? 'gh pr create' : 'gh release create') : verdict(pub)
    if (reason) {
      deny(reason)
      return
    }
  }
}

// The hook runs only when this file is executed directly, so pre-push.mjs can import verdict.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main()
  } catch (error) {
    // Bash can run the part of a command before a syntax error, so unparseable text is denied outright.
    if (error instanceof ShellParseError) deny(`publication-gate: the command could not be parsed (${error.message}), so it is denied: text the gate cannot read may hide a publication. Rewrite it as plain shell.`)
    else if (publishing) deny(`publication-gate: the publication could not be checked (${error.message}), so it is denied.`)
  }
  process.exitCode = 0
}
