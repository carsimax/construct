// Command guard (PreToolUse on Bash). Denies commands that bypass a verifier, in the main thread and in
// subagents. It never asks: destructive commands (rm -rf, force push, reset --hard, ...) give no output.
//   - deny: `git commit --no-verify` / `-n`, `--no-verify` on push, merge, rebase, am and
//     cherry-pick, `--no-gpg-sign`, `git -c core.hooksPath=...` on any subcommand, and `git config core.hooksPath <value>`;
//   - deny also: `construct-gate oracle unlock`, except when it is the whole command (one plain `construct-gate oracle unlock <path>`, no
//     separator, redirection, expansion, or wrapper) on an existing regular file with no symlink under the root, in the main thread right
//     after the user answered an AskUserQuestion with `Unlock` for a question naming that path in backticks (recorded in the review store by unlock-approval.mjs; one unlock per answer; see unlockApproved);
//   - deny also: `construct-limits set` from a subagent (hook input has `agent_id`); only the main thread declares session limits;
//   - deny also: a statement that sets `GIT_CONFIG_PARAMETERS` or `GIT_CONFIG_KEY_<n>` to
//     core.hooksPath through `export`, `declare` or `typeset` (any flags), `readonly`, `local`,
//     or a bare assignment, even with no `git` in that statement.
// Commands are found by the shell parser in shell-words.mjs (`sh -c`, `eval`, `env -S`, wrappers,
// `$(...)`, backticks, heredoc bodies and here-strings fed to a shell), so compounds and `git -C dir`
// are covered. Text the parser rejects, or commands nested past MAX_DEPTH, is denied: bash can run the part before a syntax error. Unreadable input or any other error: no output (fail open).
// Long options match as git does: any prefix at least as long as the minimum in `abbr` calls.
// shortcut: git aliases, interpreter one-liners, brace expansion, and variable-built commands are
// not caught. Upgrade if one of them shows up in real use.
// Usage: node command-guard.mjs   (hook JSON on stdin)
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { isLimits } from './limits.mjs'
import { lockPath, takeApproval } from './review-store.mjs'
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
  const { long, short, pos } = parse(args.slice(i + 1), sub === 'commit' ? 'uS' : '')
  if (abbr(long, '--no-gpg-sign', 6)) return hit('deny', `git ${sub} --no-gpg-sign skips signing. Sign the commit or fix the signing setup instead of bypassing it.`)
  // `git config [scope] core.hooksPath <value>` (or `git config set ...`) persists the bypass; reading or unsetting the key stays allowed.
  const key = pos.findIndex((p) => /^core\.hookspath$/i.test(p))
  if (sub === 'config' && key !== -1 && key < pos.length - 1 && ![...long].some((f) => /^--(get|unset)/.test(f))) {
    return hit('deny', 'git config core.hooksPath <value> replaces the repository hooks. Fix the failing hook instead of bypassing it.')
  }
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
  return null
}

// Find primaries that take an argument: that word is data, even when it reads `-delete` or `-exec`.
const FIND_VALUE_PRIMARIES = new Set(['-name', '-iname', '-path', '-ipath', '-regex', '-iregex', '-newer', '-user', '-group', '-type', '-perm', '-size', '-mtime', '-maxdepth', '-mindepth'])
const shQuote = (w) => `'${w.replace(/'/g, "'\\''")}'`

// findNested: each `-exec`/`-execdir` command (up to `;` or `+`) is a command line of
// its own, handed to `nested` so wrappers, absolute paths, and `sh -c` bodies get the top-level checks.
function findNested(args, nested) {
  for (let i = 0; i < args.length; i++) {
    if (FIND_VALUE_PRIMARIES.has(args[i])) i++
    else if (args[i] === '-exec' || args[i] === '-execdir') {
      const end = args.findIndex((a, k) => k > i && (a === ';' || a === '+'))
      nested(args.slice(i + 1, end === -1 ? args.length : end).map(shQuote).join(' '))
      if (end === -1) break
      i = end
    }
  }
}

const UNLOCK_REASON = 'construct-gate oracle unlock releases a locked oracle, and only the user may approve it. Ask them with AskUserQuestion: a question that puts the path in backticks (once) and names the `oracle_conflict` (the spec against the test), with the options `Unlock` and `Keep the test`; on `Unlock` run the command from the main thread, once. A subagent never unlocks: it returns `oracle_conflict`.'

// The approval comes from the review store, where unlock-approval.mjs (PostToolUse on AskUserQuestion) recorded what the user answered;
// the transcript is a file an agent can write, so it is never read. The question text is agent-written: it must put the path in
// backticks, exactly once, and that path, normalized by lockPath like the CLI does, must equal the one being unlocked.
const quoted = (q) => /^[^`]*`([^`]+)`[^`]*$/.exec(q)?.[1] ?? null

// plainFile: the typed path names a regular file now, and no component under the repository root is a symlink (lstat), so an
// approval of a link never unlocks its target and the CLI cannot follow a link to another lock. `..` is refused: the shell resolves it
// through links, the guard would not.
// The typed path is walked as written (lockPath resolves links): the components above the repository root may be aliases (/var -> /private/var).
function plainFile(root, typed) {
  if (typed.split(/[\\/]/).includes('..')) return false
  const abs = resolve(root, typed)
  const chain = [] // abs and its ancestors, down to the repository root
  for (let d = abs; ; d = dirname(d)) {
    if (realpathSync(d) === root) break
    if (d === dirname(d)) return false
    chain.push(d)
  }
  return chain.length > 0 && !chain.some((d) => lstatSync(d).isSymbolicLink()) && lstatSync(abs).isFile()
}

// unlockApproved: main thread only, the latest recorded AskUserQuestion answer chose `Unlock` for a question naming the path,
// and that answer was not used before (takeApproval claims it with an exclusive create). Fails closed.
function unlockApproved(input, paths) {
  try {
    if (input.agent_id || paths.length !== 1 || paths[0] == null || typeof input.cwd !== 'string' || typeof input.session_id !== 'string' || input.session_id === '') return false
    const root = repositoryRoot(input.cwd)
    const path = lockPath(root, paths[0])
    if (!path || !plainFile(root, paths[0])) return false
    return takeApproval(root, (a) => a.session_id === input.session_id && Object.entries(a.answers).some(([q, v]) => quoted(q) !== null && lockPath(root, quoted(q)) === path && plainFile(root, quoted(q)) && [v].flat().some((l) => typeof l === 'string' && /^unlock(\s+\(recommended\))?$/i.test(l.trim())))) !== null
  } catch {
    return false
  }
}

// The only unlock that may be approved is the whole command: one plain `construct-gate oracle unlock <path>` (optionally run by `node`),
// words made of literal characters only. Anything else (a separator, redirection, subshell, expansion, assignment, wrapper, quote) is denied.
const LONE_UNLOCK = /^(?:node )?(?:[\w.@%+=:,/-]*\/)?construct-gate oracle unlock ([\w.@%+:,/][\w.@%+=:,/-]*)$/
const lonePath = (command) => LONE_UNLOCK.exec(command.trim().replace(/ +/g, ' '))?.[1] ?? null

const isGate = (word) => /(^|\/)construct-gate$/.test(word ?? '')
const LIMITS_REASON = 'only the main thread declares session limits: a subagent cannot run construct-limits set. `construct-limits show` is allowed; ask the orchestrator to change a limit.'
let subagent = false

// hitsIn returns every hit of a command line; splitCommands finds the commands nested in
// substitutions and heredoc expansions, and the lines a command runs as a string are read again.
// Throws ShellParseError for text that is not valid shell.
function hitsIn(command, depth = 0) {
  if (depth > MAX_DEPTH) throw new ShellParseError(`commands nest more than ${MAX_DEPTH} levels deep`)
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
    if (name === 'find') findNested(args, nested)
    const h = name === 'git' ? gitHit(args, words) : null
    // Any word with basename construct-gate counts, so node flags, env, command, xargs and npx wrappers are caught; `node -e` importing review-store cannot be seen in text (discipline layer).
    const at = words.findIndex((w, i) => isGate(w) && words[i + 1] === 'oracle' && words[i + 2] === 'unlock')
    if (at !== -1) found.push({ ...hit('deny', UNLOCK_REASON), unlock: true })
    if (subagent && words.some((w, i) => isLimits(w) && words[i + 1] === 'set')) found.push(hit('deny', LIMITS_REASON))
    if (h) found.push(h)
  }
  return found
}

try {
  const input = readInput()
  const command = input?.tool_input?.command
  if (input?.tool_name === 'Bash' && typeof command === 'string' && command !== '') {
    subagent = Boolean(input.agent_id)
    let found = hitsIn(command)
    const unlocks = found.filter((h) => 'unlock' in h)
    if (unlocks.length === 1 && lonePath(command) !== null && unlockApproved(input, [lonePath(command)])) found = found.filter((h) => !('unlock' in h))
    const chosen = found[0]
    if (chosen) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: chosen.decision, permissionDecisionReason: chosen.reason } })}\n`)
  }
} catch (error) {
  // Fail open, except on text that is not valid shell: bash can run the part before a syntax error.
  if (error instanceof ShellParseError) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `command-guard: the command could not be parsed (${error.message}), so it is denied: text the guard cannot read may hide a verifier bypass. Rewrite it as plain shell.` } })}\n`)
}
process.exitCode = 0
