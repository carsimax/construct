// Deterministic risk tier from one immutable tree boundary. Evidence alone picks
// the tier; change volume, file count, model, and effort are never inputs.
import { processBoundaryRiskReasons } from './content.mjs'
import { pathRiskItemReasons } from './items.mjs'
import { activePassiveContentPaths, isPassiveContentCandidateStat } from './passive.mjs'
import {
  canonicalRiskReasons, deriveSnapshotRiskReasons, isConfigurationReviewPath, removeFallbackRiskReasons,
  riskSignalsFromReasons, touchesHotPath,
} from './signals.mjs'
import { collectDiffStats, countChangedLines, isGeneratedGoldenPath } from './stats.mjs'

const VALID_SIGNALS = ['auth', 'update', 'security', 'payments', 'data_exposure', 'data_loss', 'permissions', 'shell_process', 'dangerous_sink', 'delivery', 'verifier_weakening']

// classifyRisk: high on any signal or hot path, low when every path is proven
// passive and none is configuration, otherwise medium. Counting still runs so
// malformed or duplicated stats are rejected before a tier is published.
export function classifyRisk({ stats, signals, onlyPassiveContentChanges, touchesConfiguration }) {
  countChangedLines(stats)
  for (const signal of signals) {
    if (!VALID_SIGNALS.includes(signal)) throw new Error(`unknown risk signal ${JSON.stringify(signal)}`)
  }
  if (signals.length > 0 || touchesHotPath(stats)) return 'high'
  if (onlyPassiveContentChanges && !touchesConfiguration) return 'low'
  return 'medium'
}

// riskLevelFromReasons mirrors the tier a consumer derives from published
// reasons alone; both derivations must agree.
function riskLevelFromReasons(reasons) {
  if (reasons.some((reason) => reason.signal)) return 'high'
  if (reasons.length === 1 && reasons[0].code === 'non_executable_only') return 'low'
  return 'medium'
}

// assessSnapshotRisk derives the tier, authored size, and canonical reasons.
// Tier names are the internal ones (low, medium, high); output.mjs renames low to
// passive.
export function assessSnapshotRisk({ root, baseTree, candidateTree, isolation }) {
  const stats = collectDiffStats(root, baseTree, candidateTree, isolation)
  const changedLines = countChangedLines(stats)
  const activeContent = activePassiveContentPaths(root, baseTree, candidateTree, stats)
  let reasons = deriveSnapshotRiskReasons(stats, activeContent, isPassiveContentCandidateStat)
  const processReasons = processBoundaryRiskReasons(root, baseTree, candidateTree, stats)
  // Items 1, 2, and 5: migrations, keys and credentials, dependencies, git hooks.
  const itemReasons = stats.flatMap((stat) => pathRiskItemReasons(stat.path))
  if (processReasons.length > 0 || itemReasons.length > 0) {
    reasons = canonicalRiskReasons([...removeFallbackRiskReasons(reasons), ...processReasons, ...itemReasons])
  }
  let onlyPassiveContentChanges = true
  let touchesConfiguration = false
  for (const stat of stats) {
    if (isGeneratedGoldenPath(stat.path)) continue
    onlyPassiveContentChanges = onlyPassiveContentChanges && !activeContent.has(stat.path) && isPassiveContentCandidateStat(stat)
    touchesConfiguration = touchesConfiguration || isConfigurationReviewPath(stat.path)
  }
  const level = classifyRisk({ stats, signals: riskSignalsFromReasons(reasons), onlyPassiveContentChanges, touchesConfiguration })
  // Fail closed on an unexplained tier: reasons that imply another tier could not
  // be shown honestly to the person who has to act on them.
  const explained = riskLevelFromReasons(reasons)
  if (explained !== level) throw new Error(`risk tier ${level} is not explained by its reasons (${explained})`)
  return { level, changedLines, changedPaths: stats.length, reasons, manifest: stats.map((stat) => stat.path) }
}
