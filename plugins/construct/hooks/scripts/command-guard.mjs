// Command guard (PreToolUse on Bash). Denies commands that bypass a verifier and asks before
// destructive ones, in the main thread and in subagents:
//   - deny: `git commit --no-verify` / `-n`, `--no-verify` on push, merge, rebase, am and
//     cherry-pick, `--no-gpg-sign`, and `git -c core.hooksPath=...` on any subcommand;
//   - ask: `rm` with recursive and force flags, `git push` with `--force`, `-f`, or a `+refspec`
//     and no `--force-with-lease`, `git reset --hard`, `git clean -f`, `git checkout -- .`,
//     `git checkout .`, and `git restore .` (unless it only touches the index).
// Commands are found through shell-words.mjs (`sh -c`, `eval`, `env -S`, wrappers, `$(...)`,
// backticks, heredoc bodies fed to a shell), so compounds and `git -C dir` are covered. When a
// deny and an ask both match, deny is reported. Unreadable input or any error: no output (fail open).
// shortcut: a heuristic parser; git aliases, interpreter one-liners, xargs, and variable-built
// commands are not caught. Upgrade if one of them shows up in real use.
// Usage: node command-guard.mjs   (hook JSON on stdin)
import { readInput } from './hook-io.mjs'
import { extractHeredocs, GIT_VALUE_FLAGS, nestedLines, SHELLS, splitCommands, substitutionBodies } from './shell-words.mjs'

const MAX_DEPTH = 4
// Flags whose value is a word of its own (or the rest of a short cluster): their text is not a flag.
const VALUE_FLAGS = new Set(['-m', '-F', '-C', '-c', '-t', '-o', '--message', '--file', '--author', '--date', '--reuse-message', '--reedit-message', '--template', '--cleanup', '--repo', '--push-option', '--receive-pack', '--exec'])
const SHORT_VALUE_LETTERS = 'mFCcto'
const NO_VERIFY = new Set(['commit', 'push', 'merge', 'rebase', 'am', 'cherry-pick'])

// parse returns the flags of a subcommand's arguments (long flags whole, short flags as
// single letters) and its positionals, skipping the text of value flags and anything after `--`.
function parse(args) {
  const long = new Set()
  const short = new Set()
  const pos = []
  let after = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') {
      after = args.slice(i + 1)
      break
    }
    if (a.startsWith('--')) {
      long.add(a.split('=')[0])
      if (VALUE_FLAGS.has(a)) i++
    } else if (a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        short.add(a[k])
        if (SHORT_VALUE_LETTERS.includes(a[k])) {
          if (k === a.length - 1) i++
          break
        }
      }
    } else pos.push(a)
  }
  return { long, short, pos, after }
}

const hit = (decision, reason) => ({ decision, reason: `command-guard: ${reason}` })

function gitHit(args) {
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
  const { long, short, pos, after } = parse(args.slice(i + 1))
  if (long.has('--no-gpg-sign')) return hit('deny', `git ${sub} --no-gpg-sign skips signing. Sign the commit or fix the signing setup instead of bypassing it.`)
  if (NO_VERIFY.has(sub) && (long.has('--no-verify') || (sub === 'commit' && short.has('n')))) {
    return hit('deny', `git ${sub} --no-verify skips the hooks. Fix the failing hook instead of bypassing it.`)
  }
  if (sub === 'push' && !long.has('--force-with-lease') && (long.has('--force') || short.has('f') || pos.some((p) => p.startsWith('+')))) {
    return hit('ask', 'git push with --force, -f, or a +refspec can overwrite remote work. Use --force-with-lease instead.')
  }
  if (sub === 'reset' && long.has('--hard')) return hit('ask', 'git reset --hard discards uncommitted work. Confirm, or use git stash or git reset --soft instead.')
  if (sub === 'clean' && (long.has('--force') || short.has('f')) && !long.has('--dry-run') && !short.has('n')) return hit('ask', 'git clean -f deletes untracked files for good. Run git clean -n first to list them.')
  if (sub === 'checkout' && (after.includes('.') || (pos.length === 1 && pos[0] === '.' && after.length === 0))) return hit('ask', 'git checkout . discards uncommitted changes. Confirm, or name the files to restore.')
  if (sub === 'restore' && [...pos, ...after].includes('.') && (!long.has('--staged') || long.has('--worktree') || short.has('W'))) return hit('ask', 'git restore . discards uncommitted changes. Confirm, or name the files to restore.')
  return null
}

function rmHit(args) {
  const { long, short } = parse(args)
  if ((long.has('--recursive') || short.has('r') || short.has('R')) && (long.has('--force') || short.has('f'))) {
    return hit('ask', 'rm with recursive and force flags deletes without a way back. Confirm, or delete the named paths without -f.')
  }
  return null
}

// hitsIn returns every hit of a command line; nested lines and substitutions are walked.
function hitsIn(command, depth = 0) {
  if (depth > MAX_DEPTH) return []
  const found = []
  const nested = (line) => found.push(...hitsIn(line, depth + 1))
  const { text, bodies } = extractHeredocs(command)
  for (const tokens of splitCommands(text)) {
    const words = tokens.filter((w) => !w.r).map((w) => w.t)
    // Raw source, not the unquoted text: a backtick or `$(` inside single quotes is literal.
    for (const w of tokens) if (!w.r) for (const body of substitutionBodies(w.s)) nested(body)
    const { name, args, lines } = nestedLines(words)
    for (const line of lines) nested(line)
    // `bash <<< 'git commit -n'`: the here-string reaches the tokenizer as a plain word.
    if (SHELLS.has(name)) for (const arg of args) if (!arg.startsWith('-')) nested(arg)
    const h = name === 'git' ? gitHit(args) : name === 'rm' ? rmHit(args) : null
    if (h) found.push(h)
  }
  // A heredoc body is data unless its command line runs a shell.
  for (const { header, body } of bodies) {
    if (splitCommands(header).some((words) => SHELLS.has(nestedLines(words.filter((w) => !w.r).map((w) => w.t)).name))) nested(body)
  }
  return found
}

try {
  const input = readInput()
  const command = input?.tool_input?.command
  if (input?.tool_name === 'Bash' && typeof command === 'string' && command !== '') {
    const found = hitsIn(command)
    const chosen = found.find((h) => h.decision === 'deny') ?? found[0]
    if (chosen) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: chosen.decision, permissionDecisionReason: chosen.reason } })}\n`)
  }
} catch {
  // Fail open.
}
process.exitCode = 0
