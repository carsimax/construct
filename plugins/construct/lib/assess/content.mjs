// Content-derived risk evidence: interpreter directives in the candidate tree and
// process-spawn or dangerous-sink constructs on added lines. Every read is
// bounded; an over-budget scan fails closed into a process_scan_limit reason.
import { GitOutputLimitError, batchLiteralPathspecs, git, grepInterpreterDirective, prefixLengthOf, stripLiteral, treeBlobSizes } from './git.mjs'
import { SCAN_BYTE_LIMIT } from './passive.mjs'
import { dangerousSinkLine, isCommentOnlySourceLine } from './sinks.mjs'
import { canonicalRiskReasons, isContentScanEligible, isTestRiskPath } from './signals.mjs'

// A bare spawn word (`subprocess`, `child_process`, `execute_process`, `exec`)
// counts only when it is not a member of another value: `db.Exec(`, `stmt.Exec(`
// and `/re/.exec(` are database statements and regular expressions. Spawn calls
// that only exist in member form are named explicitly.
export const PROCESS_SPAWN_LINE = new RegExp(
  '((^|[^A-Za-z0-9_.])(subprocess|child_process|execute_process|exec)([^A-Za-z0-9_]|$))' +
    '|(execSync\\(|getRuntime\\(\\)\\.exec\\(|ProcessBuilder|os\\.system\\(|os\\.exec[lv]p?e?\\(|posix_spawn|proc_open\\(|shell_exec\\(|passthru\\(|popen\\(|Process\\.Start\\()',
  'i',
)

const reason = (code, signal, path) => ({ code, signal, path })
const scanLimit = (path) => reason('process_scan_limit', 'shell_process', path)

// processBoundaryRiskReasons scans eligible non-test files: an interpreter
// directive anywhere in a candidate file, and added lines that spawn a process or
// call a dangerous sink. Both trees count toward the byte budget.
export function processBoundaryRiskReasons(root, baseTree, candidateTree, stats) {
  const paths = stats.filter((stat) => isContentScanEligible(stat) && !isTestRiskPath(stat.path)).map((stat) => stat.path)
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
    let sinkSeen = false
    for (const line of output.toString('utf8').split('\n')) {
      if (line.startsWith('diff --git ')) {
        const separator = line.lastIndexOf(' b/')
        if (separator < 0) return ambiguous
        currentPath = line.slice(separator + 3)
        inHunk = processSeen = sinkSeen = false
        if (!batchPaths.has(currentPath)) return ambiguous
      } else if (line.startsWith('@@')) {
        inHunk = true
      } else if (inHunk && line.length > 0 && line[0] === '+') {
        const added = line.slice(1)
        if (!processSeen && !isCommentOnlySourceLine(currentPath, added) && PROCESS_SPAWN_LINE.test(added)) {
          reasons.push(reason('process_boundary', 'shell_process', currentPath))
          processSeen = true
        }
        if (!sinkSeen && dangerousSinkLine(currentPath, added)) {
          reasons.push(reason('dangerous_sink', 'dangerous_sink', currentPath))
          sinkSeen = true
        }
      }
    }
  }
  return canonicalRiskReasons(reasons)
}
