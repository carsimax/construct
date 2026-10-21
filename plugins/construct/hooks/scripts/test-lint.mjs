// Delivered-test lint for secret-guard.mjs (S7c, gentle-parity). Port of gentle-shell
// lib/delivered-test-lint.ts: a test must pass in any clone, so a Write, Edit, or MultiEdit
// to a test path is denied when the new text reads git history at a literal commit id or
// points TMPDIR inside the working directory. Deliberately narrow: git in a throwaway
// repository (`git init`, `git stash`, `HEAD:`) stays allowed. Text written through Bash is
// not seen. Pure module: secret-guard.mjs imports `testLintVerdict` and owns the output.
import { isAbsolute, relative } from 'node:path'

const TEST_PATH_PATTERNS = [
  /(^|[\\/])(tests?|__tests__|spec)[\\/]/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /_test\.go$/,
  /(^|[\\/])test_[^\\/]*\.py$/,
]

const HISTORY_COMMAND = /\bgit\b[^\n]{0,40}?\b(show|checkout|diff|cat-file|archive)\b([^\n]{0,80})/g
const COMMIT_ID = /\b[0-9a-f]{7,40}\b/g
// `=` but not `==`/`===`: a comparison with the working directory is not an assignment.
const TMPDIR_ASSIGNMENT = /\bTMPDIR["']?\]?\s*(?::|=(?!=))\s*([^\n;,}]*)/g
// Upstream lists `\$\{PWD\}`, which can never match: the assignment capture stops at `}`. `\$\{PWD` does.
const WORKING_DIRECTORY = /\$PWD|\$\{PWD|\$\(pwd\)|process\.cwd\(\)|__dirname|import\.meta\.dirname|os\.getcwd\(\)/
// A relative path resolves against the working directory too: `.tmp`, `./x`, `../x` or `tmp/x`, quoted or not.
// Absolute, `~`, `$` or `%` based values and a bare word (`scratch`, `os.tmpdir()`, a fixture value) stay allowed.
const RELATIVE_PATH = /^\s*["'`]?(?:\.{1,2}[/\\\w-]|[\w.-]+[/\\])/

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])

const isTestFilePath = (path) => TEST_PATH_PATTERNS.some((pattern) => pattern.test(path))

// A literal commit id mixes digits and letters; all-letter or all-digit words are not treated as one.
const isCommitId = (token) => /[0-9]/.test(token) && /[a-f]/.test(token)

// deliveredTestViolation: why this test content cannot be delivered, or null when it can.
function deliveredTestViolation(content) {
  for (const match of content.matchAll(HISTORY_COMMAND)) {
    const commit = [...match[2].matchAll(COMMIT_ID)].map((m) => m[0]).find(isCommitId)
    if (commit) return `reads git history at a fixed commit (\`git ${match[1]} ${commit}\`), which fails in another clone`
  }
  for (const match of content.matchAll(TMPDIR_ASSIGNMENT)) {
    if (WORKING_DIRECTORY.test(match[1]) || RELATIVE_PATH.test(match[1])) {
      return `points TMPDIR inside the working directory (\`TMPDIR${match[0].slice(6).trim()}\`), so test scratch enters the diff`
    }
  }
  return null
}

// writtenText is the new text of the call: content, new_string, or every edit's new_string.
function writtenText(toolName, input) {
  if (toolName === 'Write') return typeof input.content === 'string' ? input.content : null
  const parts = []
  if (typeof input.new_string === 'string') parts.push(input.new_string)
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) if (edit && typeof edit.new_string === 'string') parts.push(edit.new_string)
  }
  return parts.length > 0 ? parts.join('\n') : null
}

// judgedPath: an absolute path inside the session cwd is judged by its repository-relative part.
function judgedPath(path, cwd) {
  if (!cwd || !isAbsolute(path)) return path
  const inside = relative(cwd, path)
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? inside : path
}

// testLintVerdict returns a deny verdict for secret-guard, or null.
export function testLintVerdict(event) {
  const toolName = event.tool_name
  const input = event.tool_input
  if (!WRITE_TOOLS.has(toolName) || !input || typeof input !== 'object') return null
  const path = input.file_path
  if (typeof path !== 'string' || !path) return null
  const cwd = typeof event.cwd === 'string' ? event.cwd : undefined
  if (!isTestFilePath(judgedPath(path, cwd))) return null
  const text = writtenText(toolName, input)
  const violation = text === null ? null : deliveredTestViolation(text)
  if (!violation) return null
  return {
    decision: 'deny',
    reason: `test-lint blocked this test write: ${path} ${violation}. Delivered tests must pass in any clone: build the previous behavior from a fixture instead of git history, and create scratch with mktemp outside the repository. Run differential checks against a scratch copy of the base and do not commit them as tests.`,
  }
}
