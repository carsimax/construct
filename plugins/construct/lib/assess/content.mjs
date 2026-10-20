// Content-derived risk evidence: interpreter directives in the candidate tree and
// process-spawn, permission-decision, or dangerous-sink constructs on added lines. Every read is
// bounded; an over-budget scan fails closed into a process_scan_limit reason.
import { GitOutputLimitError, batchLiteralPathspecs, git, grepInterpreterDirective, prefixLengthOf, stripLiteral, treeBlobSizes } from './git.mjs'
import { SCAN_BYTE_LIMIT } from './passive.mjs'
import { PRIVATE_KEY_HEADER, contentRiskItemReason, hasDestructiveSql, hasTokenLine, isRiskItemContentPath, isSqlPath, isTokenDotfilePath } from './items.mjs'
import { dangerousSinkLine, isCommentOnlySourceLine } from './sinks.mjs'
import { SEMANTIC_SOURCE_EXTENSIONS, asciiLower, canonicalRiskReasons, goExt, isContentScanEligible, isInspectableStat, hasExcludedRiskSegment, isTestRiskPath } from './signals.mjs'

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
const isSemanticSourcePath = (path) => SEMANTIC_SOURCE_EXTENSIONS.has(asciiLower(goExt(path)))

const reason = (code, signal, path) => ({ code, signal, path })
const scanLimit = (path) => reason('process_scan_limit', 'shell_process', path)

// Files whose added lines carry risk-item evidence (a PEM header can sit in any
// text file; SQL and token dotfiles are scanned for their own rules).
const isRiskItemScanEligible = (stat) =>
  isContentScanEligible(stat) ||
  (isInspectableStat(stat) && !hasExcludedRiskSegment(stat.path) && isRiskItemContentPath(stat.path))

// processBoundaryRiskReasons scans eligible non-test files: an interpreter
// directive anywhere in a candidate file, and added lines that spawn a process,
// set a hook permission decision, or call a dangerous sink. Both trees count toward the byte budget.
export function processBoundaryRiskReasons(root, baseTree, candidateTree, stats) {
  const paths = stats.filter((stat) => isRiskItemScanEligible(stat) && !isTestRiskPath(stat.path)).map((stat) => stat.path)
  if (paths.length === 0) return []
  const reasons = []
  let scanned = 0
  for (const tree of [baseTree, candidateTree]) {
    const blobs = treeBlobSizes(root, tree, paths)
    const treePaths = []
    for (const blob of blobs) {
      scanned += blob.size
      if (scanned > SCAN_BYTE_LIMIT) return [scanLimit(blob.path)]
      treePaths.push(blob.path)
    }
    // An interpreter directive is whole-file evidence only in the candidate: a
    // shebang that exists solely on the base side no longer executes.
    if (tree !== candidateTree || treePaths.length === 0) continue
    for (const match of grepInterpreterDirective(root, tree, treePaths)) {
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
    let sqlLines = []
    const flushSql = () => {
      if (currentPath !== '' && isSqlPath(currentPath) && hasDestructiveSql(sqlLines)) {
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
        inHunk = processSeen = permissionSeen = sinkSeen = keySeen = tokenSeen = false
        if (!batchPaths.has(currentPath)) return ambiguous
      } else if (line.startsWith('@@')) {
        inHunk = true
      } else if (inHunk && line.length > 0 && line[0] === '+') {
        const added = line.slice(1)
        const code = !isCommentOnlySourceLine(currentPath, added)
        if (!keySeen && PRIVATE_KEY_HEADER.test(added)) {
          reasons.push(contentRiskItemReason('private_key_content', currentPath))
          keySeen = true
        }
        if (!tokenSeen && isTokenDotfilePath(currentPath) && code && hasTokenLine(added)) {
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
