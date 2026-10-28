// Command guard (PreToolUse on Bash). Denies commands that bypass a verifier and, only when the
// `command_guard_asks` option is on, asks before destructive ones, in the main thread and in
// subagents. With the option off (the default) an ask match gives no output; denies always apply:
//   - deny: `git commit --no-verify` / `-n`, `--no-verify` on push, merge, rebase, am and
//     cherry-pick, `--no-gpg-sign`, and `git -c core.hooksPath=...` on any subcommand;
//   - ask (opt-in): `rm` with recursive and force flags, `git push` with `--force`, `-f`, or a `+refspec`
//     and no `--force-with-lease`, `git reset --hard`, `git clean -f`, `git checkout -- .`,
//     `git checkout .`, and `git restore .`, `./`, or `:/` (unless it only touches the index),
//     `find ... -exec rm` / `-execdir rm` with those flags, `find ... -delete`, and
//     `xargs [flags] rm` with those flags.
//   - deny also: `construct-gate oracle unlock` (the user releases a locked oracle with `!`, which skips this hook);
//   - deny also: a statement that sets `GIT_CONFIG_PARAMETERS` or `GIT_CONFIG_KEY_<n>` to
//     core.hooksPath through `export`, `declare` or `typeset` (any flags), `readonly`, `local`,
//     or a bare assignment, even with no `git` in that statement.
// Commands are found by the shell parser in shell-words.mjs (`sh -c`, `eval`, `env -S`, wrappers,
// `$(...)`, backticks, heredoc bodies and here-strings fed to a shell), so compounds and `git -C dir`
// are covered. Text the parser rejects is denied: bash can run the part before a syntax error. When a
// deny and an ask both match, deny is reported. Unreadable input or any other error: no output (fail open).
// Long options match as git does: any prefix at least as long as the minimum in `abbr` calls.
// shortcut: git aliases, interpreter one-liners, brace expansion, and variable-built commands are
// not caught. Upgrade if one of them shows up in real use.
// Usage: node command-guard.mjs   (hook JSON on stdin)
import { readInput } from './hook-io.mjs'
import { GIT_VALUE_FLAGS, heredocScripts, nestedLines, parsesAsShell, SHELLS, ShellParseError, splitCommands } from './shell-words.mjs'

const MAX_DEPTH = 4
// Flags whose value is a word of its own (or the rest of a short cluster): their text is not a flag.
const VALUE_FLAGS = new Set(['-m', '-F', '-C', '-c', '-t', '-o', '--message', '--file', '--author', '--date', '--reuse-message', '--reedit-message', '--template', '--cleanup', '--repo', '--push-option', '--receive-pack', '--exec'])
const SHORT_VALUE_LETTERS = 'mFCcto'
const NO_VERIFY = new Set(['commit', 'push', 'merge', 'rebase', 'am', 'cherry-pick'])

// parse returns the flags of a subcommand's arguments (long flags whole, short flags as
// single letters) and its positionals, skipping the text of value flags and anything after `--`.
// `stop` names short letters whose value is attached (`commit -uno`, `-S<keyid>`): the cluster ends there.
function parse(args, stop = '') {
  const long = new Set()
  const short = new Set()
  const pos = []
  const order = []
  let after = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') {
      after = args.slice(i + 1)
      break
    }
    if (a.startsWith('--')) {
      long.add(a.split('=')[0])
      order.push(a.split('=')[0])
      if (VALUE_FLAGS.has(a)) i++
    } else if (a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        short.add(a[k])
        if (stop.includes(a[k])) break
        if (SHORT_VALUE_LETTERS.includes(a[k])) {
          if (k === a.length - 1) i++
          break
        }
      }
    } else pos.push(a)
  }
  return { long, short, pos, after, order }
}

// abbr: some argument is a prefix of `full` that is at least `min` long (the shortest unambiguous
// form among that subcommand's real options; keep the table of calls small).
const abbr = (flags, full, min) => [...flags].some((a) => a.length >= min && full.startsWith(a))
const ROOTS = ['.', './', ':/']
const LEASE = '--force-with-lease'

// The docs do not say how a boolean option is serialized, so only `true` or `1` turns asks on.
const asksOn = () => ['true', '1'].includes((process.env.CLAUDE_PLUGIN_OPTION_COMMAND_GUARD_ASKS ?? '').trim().toLowerCase())

const hit = (decision, reason) => ({ decision, reason: `command-guard: ${reason}` })

const hooksEnv = (w) => /^GIT_CONFIG_KEY_\d+=core\.hookspath$/i.test(w) || (/^GIT_CONFIG_PARAMETERS=/.test(w) && /core\.hookspath/i.test(w))
const HOOKS_ENV_REASON = 'GIT_CONFIG_KEY_n / GIT_CONFIG_PARAMETERS with core.hooksPath replaces the repository hooks. Fix the failing hook instead of bypassing it.'

function gitHit(args, words = []) {
  if (words.some(hooksEnv)) return hit('deny', HOOKS_ENV_REASON)
  let i = 0
  while (args[i]?.startsWith('-')) {
    const value = args[i + 1] ?? ''
    if (args[i] === '-c' && /^core\.hookspath=/i.test(value)) return hit('deny', 'git -c core.hooksPath=... replaces the repository hooks. Fix the failing hook instead of bypassing it.')
    if (args[i] === '--config-env' && /^core\.hookspath=/i.test(value)) return hit('deny', 'git --config-env=core.hooksPath=... replaces the repository hooks. Fix the failing hook instead of bypassing it.')
    if (/^--config-env=core\.hookspath=/i.test(args[i])) return hit('deny', 'git --config-env=core.hooksPath=... replaces the repository hooks. Fix the failing hook instead of bypassing it.')
    i += GIT_VALUE_FLAGS.has(args[i]) ? 2 : 1
  }
  const sub = args[i]
  if (sub === undefined) return null
  const { long, short, pos, after, order } = parse(args.slice(i + 1), sub === 'commit' ? 'uS' : '')
  if (abbr(long, '--no-gpg-sign', 6)) return hit('deny', `git ${sub} --no-gpg-sign skips signing. Sign the commit or fix the signing setup instead of bypassing it.`)
  if (NO_VERIFY.has(sub) && (abbr(long, '--no-verify', 7) || (sub === 'commit' && short.has('n')))) {
    return hit('deny', `git ${sub} --no-verify skips the hooks. Fix the failing hook instead of bypassing it.`)
  }
  // The publication gate trusts refs/remotes/origin/{HEAD,main,master} as the release ref: only a fetch from the remote should move it. This deny is a discipline layer (config, ref files, and other commands can still move it); the gate verifies the ref against the remote recorded in the lock.
  const remote = (r) => r.startsWith('refs/remotes/')
  const writesRemote =
    (sub === 'update-ref' && pos.some(remote)) ||
    (sub === 'symbolic-ref' && remote(pos[0] ?? '') && (pos.length > 1 || short.has('d') || long.has('--delete'))) ||
    (sub === 'remote' && pos[0] === 'set-head') ||
    (sub === 'fetch' && pos.some((p) => p.includes(':') && remote(p.slice(p.lastIndexOf(':') + 1))))
  if (writesRemote) return hit('deny', `git ${sub} writes a remote-tracking ref, and the publication gate reads it as the release ref. Release refs should only move by fetching from the remote (git fetch, git pull); the gate also verifies them against the remote.`)
  // The last of --force-with-lease / --no-force-with-lease wins; a lease prefix is the lease, not --force.
  let lease = false
  for (const a of order) {
    if (a.length >= 9 && LEASE.startsWith(a)) lease = true
    else if (a.length >= 12 && `--no-${LEASE.slice(2)}`.startsWith(a)) lease = false
  }
  if (sub === 'push' && !lease && (order.some((a) => a.length >= 6 && '--force'.startsWith(a)) || short.has('f') || pos.some((p) => p.startsWith('+')))) {
    return hit('ask', 'git push with --force, -f, or a +refspec can overwrite remote work. Use --force-with-lease instead.')
  }
  if (sub === 'reset' && abbr(long, '--hard', 5)) return hit('ask', 'git reset --hard discards uncommitted work. Confirm, or use git stash or git reset --soft instead.')
  if (sub === 'clean' && (abbr(long, '--force', 4) || short.has('f')) && !long.has('--dry-run') && !short.has('n')) return hit('ask', 'git clean -f deletes untracked files for good. Run git clean -n first to list them.')
  if (sub === 'checkout' && (after.some((p) => ROOTS.includes(p)) || (pos.length === 1 && ROOTS.includes(pos[0]) && after.length === 0))) return hit('ask', 'git checkout . discards uncommitted changes. Confirm, or name the files to restore.')
  if (sub === 'restore' && [...pos, ...after].some((p) => ROOTS.includes(p)) && (!(long.has('--staged') || short.has('S')) || long.has('--worktree') || short.has('W'))) return hit('ask', 'git restore at the root discards uncommitted changes. Confirm, or name the files to restore.')
  return null
}

function rmHit(args) {
  const { long, short } = parse(args)
  if ((long.has('--recursive') || short.has('r') || short.has('R')) && (long.has('--force') || short.has('f'))) {
    return hit('ask', 'rm with recursive and force flags deletes without a way back. Confirm, or delete the named paths without -f.')
  }
  return null
}

// Find primaries that take an argument: that word is data, even when it reads `-delete` or `-exec`.
const FIND_VALUE_PRIMARIES = new Set(['-name', '-iname', '-path', '-ipath', '-regex', '-iregex', '-newer', '-user', '-group', '-type', '-perm', '-size', '-mtime', '-maxdepth', '-mindepth'])
const shQuote = (w) => `'${w.replace(/'/g, "'\\''")}'`

// findHit: `-delete` asks; each `-exec`/`-execdir` command (up to `;` or `+`) is a command line of
// its own, handed to `nested` so wrappers, absolute paths, and `sh -c` bodies get the top-level checks.
function findHit(args, nested) {
  let found = null
  for (let i = 0; i < args.length; i++) {
    if (FIND_VALUE_PRIMARIES.has(args[i])) i++
    else if (args[i] === '-delete') found ??= hit('ask', 'find -delete removes every match without a way back. Run the find without -delete first to list them.')
    else if (args[i] === '-exec' || args[i] === '-execdir') {
      const end = args.findIndex((a, k) => k > i && (a === ';' || a === '+'))
      nested(args.slice(i + 1, end === -1 ? args.length : end).map(shQuote).join(' '))
      if (end === -1) break
      i = end
    }
  }
  return found
}

const isGate = (word) => /(^|\/)construct-gate$/.test(word ?? '')

// hitsIn returns every hit of a command line; splitCommands finds the commands nested in
// substitutions and heredoc expansions, and the lines a command runs as a string are read again.
// Throws ShellParseError for text that is not valid shell.
function hitsIn(command, depth = 0) {
  if (depth > MAX_DEPTH) return []
  const found = []
  const nested = (line) => found.push(...hitsIn(line, depth + 1))
  const commands = splitCommands(command)
  const scripts = heredocScripts(commands)
  for (const tokens of commands) {
    const words = tokens.filter((w) => !w.r).map((w) => w.t)
    const { name, args, lines } = nestedLines(words)
    for (const line of lines) nested(line)
    if (SHELLS.has(name)) for (const w of tokens) if (w.h) nested(w.t)
    for (const { text, strict } of scripts.get(tokens) ?? []) if (strict || parsesAsShell(text)) nested(text)
    // `export X=...; git ...`: the assignment is its own statement, so it is checked without a `git`.
    if (/^(export|declare|typeset|readonly|local|[A-Za-z_]\w*=)/.test(words[0] ?? '') && words.some(hooksEnv)) found.push(hit('deny', HOOKS_ENV_REASON))
    const h = name === 'git' ? gitHit(args, words) : name === 'rm' ? rmHit(args) : name === 'find' ? findHit(args, nested) : null
    // Any word with basename construct-gate counts, so node flags, env, command, xargs and npx wrappers are caught; `node -e` importing review-store cannot be seen in text (discipline layer).
    if (words.some((w, i) => isGate(w) && words[i + 1] === 'oracle' && words[i + 2] === 'unlock')) found.push(hit('deny', 'construct-gate oracle unlock releases a locked oracle, and only the user may: ask them to run it with ! (for example `!construct-gate oracle unlock <path>`), or return `oracle_conflict` to them.'))
    if (h) found.push(h)
  }
  return found
}

try {
  const input = readInput()
  const command = input?.tool_input?.command
  if (input?.tool_name === 'Bash' && typeof command === 'string' && command !== '') {
    const found = hitsIn(command)
    const chosen = found.find((h) => h.decision === 'deny') ?? found[0]
    if (chosen && (chosen.decision === 'deny' || asksOn())) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: chosen.decision, permissionDecisionReason: chosen.reason } })}\n`)
  }
} catch (error) {
  // Fail open, except on text that is not valid shell: bash can run the part before a syntax error.
  if (error instanceof ShellParseError) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `command-guard: the command could not be parsed (${error.message}), so it is denied: text the guard cannot read may hide a verifier bypass. Rewrite it as plain shell.` } })}\n`)
}
process.exitCode = 0
