// Review store write guard (PreToolUse on Write, Edit, MultiEdit, NotebookEdit, Bash). The review
// store (<git-common-dir>/construct-review/) is written only by the review hooks. A file tool
// aimed inside it is denied; that rule needs a git repository and fails open outside one. A Bash
// command is denied in any directory (the hook scripts are the plugin's own) when a segment runs
// `review-capture.mjs`, `review-context.mjs`, `unlock-approval.mjs`, or `oracle-record.mjs` (directly or as the script of node, bun, deno, or a
// shell) or names `construct-review`, once quotes, backslashes, and brackets are removed. Commands
// that only name the hook files as data (grep, git diff, cat, a commit message) pass. A heuristic
// guard: it fails open on unreadable input, and denies a command the shell parser rejects or that nests
// shell layers more than 4 deep.
// shortcut: a name built indirectly (variables, concatenation, base64), a glob spelling
// (`construct-revie?`, `con*-review`), or a run through an interpreter's own code (`node -e`) is
// not seen; upgrade if that shows up in real use.
// Usage: node review-store-guard.mjs   (hook JSON on stdin)
import { realpathSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { git } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { storeAt } from './review-store.mjs'
import { heredocScripts, nestedLines, parsesAsShell, SHELLS, ShellParseError, splitCommands } from './shell-words.mjs'

const INTERPRETERS = new Set(['node', 'nodejs', 'bun', 'deno', 'sh', 'bash', 'zsh', 'dash', 'ksh'])
const HOOK_FILE = /^(review-(capture|context)|unlock-approval|oracle-record)\.mjs$/
const plain = (text) => text.replace(/["'\\\[\]]/g, '').toLowerCase()

// runsReviewHook is true when a command segment executes a review hook file: the file as the
// command, or as an argument of an interpreter. splitCommands finds the commands nested in
// substitutions; nested command lines (sh -c, eval, here-strings and heredocs fed to a shell) are
// read again. Throws ShellParseError for text that is not valid shell.
function runsReviewHook(command, depth = 0) {
  if (depth > 4) throw new ShellParseError('commands nest more than 4 levels deep')
  const commands = splitCommands(command)
  const scripts = heredocScripts(commands)
  return commands.some((tokens) => {
    const words = tokens.filter((w) => !w.r).map((w) => w.t)
    const { name, args, lines } = nestedLines(words)
    if (lines.some((line) => runsReviewHook(line, depth + 1))) return true
    if (SHELLS.has(name) && tokens.some((w) => w.h && runsReviewHook(w.t, depth + 1))) return true
    if ((scripts.get(tokens) ?? []).some(({ text, strict }) => (strict || parsesAsShell(text)) && runsReviewHook(text, depth + 1))) return true
    return HOOK_FILE.test(basename(plain(name))) || (INTERPRETERS.has(name.toLowerCase()) && args.some((a) => HOOK_FILE.test(basename(plain(a)))))
  })
}

const REASON = 'review-store-guard: the review store (construct-review/ under the git directory) is written only by the review hooks, which only the harness runs. Run the construct:review skill to record a review; do not write verdicts or pending records yourself.'

// real resolves symlinks in the deepest existing ancestor and appends the rest.
function real(path) {
  try {
    return realpathSync(path)
  } catch {
    return join(real(dirname(path)), path.slice(dirname(path).length))
  }
}

function insideStore(input, store) {
  const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path
  if (typeof path !== 'string' || path === '') return false
  // macOS volumes are case-insensitive, so `.git/CONSTRUCT-REVIEW` is the store.
  const rel = relative(real(store).toLowerCase(), real(resolve(input.cwd, path)).toLowerCase())
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))
}

function main() {
  const input = readInput()
  if (!input || typeof input.cwd !== 'string' || input.cwd === '' || typeof input.tool_name !== 'string') return
  const command = input.tool_input?.command
  let denied
  if (input.tool_name === 'Bash') denied = typeof command === 'string' && (plain(command).includes('construct-review') || runsReviewHook(command))
  else if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(input.tool_name)) {
    // One git call; a relative common dir is relative to cwd.
    const common = git(input.cwd, ['rev-parse', '--git-common-dir']).toString('utf8').trim()
    denied = insideStore(input, storeAt(common, input.cwd))
  } else return
  if (denied) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON } })}\n`)
}

try {
  main()
} catch (error) {
  // Fail open, except on text that is not valid shell: bash can run the part before a syntax error.
  if (error instanceof ShellParseError) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `review-store-guard: the command could not be parsed (${error.message}), so it is denied: text the guard cannot read may run a review hook. Rewrite it as plain shell.` } })}\n`)
}
process.exitCode = 0
