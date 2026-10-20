// Content-derived risk evidence: interpreter directives in the candidate tree and
// process-spawn, permission-decision, or dangerous-sink constructs on added lines. Every read is
// bounded; an over-budget scan fails closed into a process_scan_limit reason.
import { GitOutputLimitError, batchLiteralPathspecs, git, grepInterpreterDirective, prefixLengthOf, stripLiteral, treeBlobSizes } from './git.mjs'
import { SCAN_BYTE_LIMIT } from './passive.mjs'
import { PRIVATE_KEY_HEADER, contentRiskItemReason, hasDestructiveSql, hasTokenLine, isItemEvidencePath, isRiskItemContentPath, isSqlPath, isTokenDotfilePath } from './items.mjs'
import { dangerousSinkLine, isCommentOnlySourceLine } from './sinks.mjs'
import { JS_TS_EXTENSIONS, SEMANTIC_SOURCE_EXTENSIONS, asciiLower, canonicalRiskReasons, goExt, isContentScanEligible, isInspectableStat, hasExcludedRiskSegment, isTestRiskPath } from './signals.mjs'

// A bare spawn word (`subprocess`, `child_process`, `execute_process`, `exec`)
// counts only when it is not a member of another value: `db.Exec(`, `stmt.Exec(`
// and `/re/.exec(` are database statements and regular expressions. Spawn calls
// that only exist in member form are named explicitly.
export const PROCESS_SPAWN_LINE = new RegExp(
  '((^|[^A-Za-z0-9_.])(subprocess|child_process|execute_process|exec)([^A-Za-z0-9_]|$))' +
    '|(execSync\\(|getRuntime\\(\\)\\.exec\\(|ProcessBuilder|os\\.system\\(|os\\.exec[lv]p?e?\\(|posix_spawn|proc_open\\(|shell_exec\\(|passthru\\(|popen\\(|Process\\.Start\\()',
  'i',
)

// A Claude Code hook decides whether a tool call runs by setting
// `permissionDecision`. Only source files count: prose that explains the field is
// not a decision.
export const PERMISSION_DECISION_LINE = /(^|[^A-Za-z0-9_$])permissionDecision([^A-Za-z0-9_$]|$)/

// Verifier weakening: an added suppression comment in a source or test file, or an added
// skip/focus marker in a test file. A suppression is a comment, so it is matched where a comment opens (start of line
// or after whitespace/punctuation, never inside a quote). shortcut: a marker spelled across two
// lines or built from a string is not seen, upgrade with a per-language tokenizer.
const OPENER = '(?<=^|[\\s;{}),])'
const JS_SUPPRESSION = new RegExp(`${OPENER}(?:\\/\\/|\\/\\*+)[\\s*]*(?:@ts-(?:ignore|expect-error|nocheck)\\b|eslint-disable\\b)`, 'g')
const PY_SUPPRESSION = new RegExp(`${OPENER}#[\\s]*(?:noqa\\b|type:\\s*ignore\\b)`, 'g')
const GO_SUPPRESSION = new RegExp(`${OPENER}\\/\\/[\\s]*nolint\\b`, 'g')

// matchesOutsideStrings is true when a match of the global pattern starts outside every closed
// same-line string literal (single, double, or backtick quotes; a backslash escapes the next char).
// An unterminated quote is not a literal, so an apostrophe in a comment hides nothing.
// shortcut: per line only; a template literal that spans lines or a regex literal holding a quote is not modeled, upgrade with a per-language tokenizer.
function matchesOutsideStrings(pattern, line) {
  const spans = []
  for (let i = 0; i < line.length; i++) {
    const quote = line[i]
    if (quote !== "'" && quote !== '"' && quote !== '`') continue
    let j = i + 1
    while (j < line.length && line[j] !== quote) j += line[j] === '\\' ? 2 : 1
    if (j >= line.length) continue
    spans.push([i, j])
    i = j
  }
  pattern.lastIndex = 0
  for (const match of line.matchAll(pattern)) {
    if (!spans.some(([start, end]) => match.index > start && match.index < end)) return true
  }
  return false
}
// Markers are keyed on the file's language: `#` never opens a JS comment and `//nolint` is Go only.
export function suppressionLine(path, line) {
  const extension = asciiLower(goExt(path))
  if (JS_TS_EXTENSIONS.includes(extension)) return matchesOutsideStrings(JS_SUPPRESSION, line)
  if (extension === '.py') return matchesOutsideStrings(PY_SUPPRESSION, line)
  if (extension === '.go') return matchesOutsideStrings(GO_SUPPRESSION, line)
  return false
}
// An option object skips only with a literal: `{ skip: true }` or `{ skip: 'reason' }`.
// `{ skip: 10 }` (a Prisma offset) and `{ skip: offset }` are data, not a skipped test.
export const TEST_SKIP_LINE = new RegExp(
  '(?<![\\w.$])(?:(?:test|it|describe|context|suite)(?:\\.\\w+)*\\.(?:skip|only|todo)(?:\\s*\\(|\\.)|x(?:it|describe|test)\\s*\\()' +
    '|\\{\\s*(?:skip|todo)\\s*:\\s*(?:true\\b|[\'"`])|@pytest\\.mark\\.skip\\b|\\bt\\.Skip(?:f|Now)?\\s*\\(',
  'g',
)
export const testSkipLine = (line) => matchesOutsideStrings(TEST_SKIP_LINE, line)
const isSemanticSourcePath = (path) => SEMANTIC_SOURCE_EXTENSIONS.has(asciiLower(goExt(path)))

const reason = (code, signal, path) => ({ code, signal, path })
const scanLimit = (path) => reason('process_scan_limit', 'shell_process', path)

// Files whose added lines carry risk-item evidence (a PEM header can sit in any
// text file; SQL and token dotfiles are scanned for their own rules).
const isRiskItemScanEligible = (stat) =>
  isContentScanEligible(stat) ||
  (isInspectableStat(stat) && !hasExcludedRiskSegment(stat.path) && isRiskItemContentPath(stat.path))

// processBoundaryRiskReasons scans eligible files. Non-test files get every rule: an interpreter
// directive anywhere in a candidate file, and added lines that spawn a process, set a hook
// permission decision, or call a dangerous sink; both trees of those count toward the byte budget.
// Test files are read only through their added lines (suppressions and skip/focus markers), so
// their whole-file sizes are not budgeted; their diff stays bounded by the same output limit.
export function processBoundaryRiskReasons(root, baseTree, candidateTree, stats) {
  // Test files join the scan only for verifier weakening; every other rule skips them below.
  const paths = stats.filter((stat) => isRiskItemScanEligible(stat)).map((stat) => stat.path)
  if (paths.length === 0) return []
  const nonTest = new Set(paths.filter((path) => !isTestRiskPath(path)))
  const reasons = []
  let scanned = 0
  for (const tree of [baseTree, candidateTree]) {
    const blobs = nonTest.size === 0 ? [] : treeBlobSizes(root, tree, [...nonTest])
    const treePaths = []
    for (const blob of blobs) {
      scanned += blob.size
      if (scanned > SCAN_BYTE_LIMIT) return [scanLimit(blob.path)]
      treePaths.push(blob.path)
    }
    // An interpreter directive is whole-file evidence only in the candidate: a
    // shebang that exists solely on the base side no longer executes.
    const directivePaths = treePaths.filter((path) => nonTest.has(path))
    if (tree !== candidateTree || directivePaths.length === 0) continue
    for (const match of grepInterpreterDirective(root, tree, directivePaths)) {
      reasons.push(reason('process_boundary', 'shell_process', match))
    }
  }

  // Presentation is pinned so user config cannot break path attribution, a
  // textconv driver cannot replace the frozen bytes, and a binary attribute
  // cannot collapse the patch into "Binary files differ".
  const fixed = [
    '-c', 'core.quotePath=false', 'diff', '--text', '--no-color', '--no-ext-diff', '--no-textconv',
    '--src-prefix=a/', '--dst-prefix=b/', '--unified=0', baseTree, candidateTree, '--',
  ]
  for (const batch of batchLiteralPathspecs(paths, prefixLengthOf(root, fixed))) {
    let output
    try {
      output = git(root, [...fixed, ...batch], { maxBuffer: SCAN_BYTE_LIMIT })
    } catch (error) {
      if (error instanceof GitOutputLimitError) return [scanLimit(stripLiteral(batch[0]))]
      throw error
    }
    const batchPaths = new Set(batch.map(stripLiteral))
    // When attribution cannot be trusted the result names the first path of the
    // batch, so the reason still points somewhere inspectable.
    const ambiguous = [scanLimit(stripLiteral(batch[0]))]
    let currentPath = ''
    let inHunk = false
    let processSeen = false
    let permissionSeen = false
    let sinkSeen = false
    let keySeen = false
    let tokenSeen = false
    let weakSeen = false
    let sqlLines = []
    const flushSql = () => {
      if (currentPath !== '' && isSqlPath(currentPath) && isItemEvidencePath(currentPath) && hasDestructiveSql(sqlLines)) {
        reasons.push(contentRiskItemReason('destructive_sql', currentPath))
      }
      sqlLines = []
    }
    for (const line of output.toString('utf8').split('\n')) {
      if (line.startsWith('diff --git ')) {
        flushSql()
        const separator = line.lastIndexOf(' b/')
        if (separator < 0) return ambiguous
        currentPath = line.slice(separator + 3)
        inHunk = processSeen = permissionSeen = sinkSeen = keySeen = tokenSeen = weakSeen = false
        if (!batchPaths.has(currentPath)) return ambiguous
      } else if (line.startsWith('@@')) {
        inHunk = true
      } else if (inHunk && line.length > 0 && line[0] === '+') {
        const added = line.slice(1)
        const code = !isCommentOnlySourceLine(currentPath, added)
        const isTest = !nonTest.has(currentPath)
        if (!weakSeen && isSemanticSourcePath(currentPath)) {
          // Suppressions are comments, so they ignore the comment-only skip; skips are code.
          if (suppressionLine(currentPath, added) || (isTest && code && testSkipLine(added))) {
            reasons.push(reason('verifier_weakening', 'verifier_weakening', currentPath))
            weakSeen = true
          }
        }
        if (isTest) continue
        if (!keySeen && PRIVATE_KEY_HEADER.test(added) && isItemEvidencePath(currentPath)) {
          reasons.push(contentRiskItemReason('private_key_content', currentPath))
          keySeen = true
        }
        if (!tokenSeen && isTokenDotfilePath(currentPath) && isItemEvidencePath(currentPath) && code && hasTokenLine(added)) {
          reasons.push(contentRiskItemReason('credential_file', currentPath))
          tokenSeen = true
        }
        if (isSqlPath(currentPath)) sqlLines.push(added)
        if (!processSeen && !isSqlPath(currentPath) && code && PROCESS_SPAWN_LINE.test(added)) {
          reasons.push(reason('process_boundary', 'shell_process', currentPath))
          processSeen = true
        }
        if (!permissionSeen && code && isSemanticSourcePath(currentPath) && PERMISSION_DECISION_LINE.test(added)) {
          reasons.push(reason('permission_decision', 'permissions', currentPath))
          permissionSeen = true
        }
        if (!sinkSeen && dangerousSinkLine(currentPath, added)) {
          reasons.push(reason('dangerous_sink', 'dangerous_sink', currentPath))
          sinkSeen = true
        }
      }
    }
    flushSql()
  }
  return canonicalRiskReasons(reasons)
}
