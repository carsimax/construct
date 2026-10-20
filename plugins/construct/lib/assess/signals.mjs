// Path-derived risk evidence: hot paths, service-token names, shell sources,
// executable-mode changes, and the fallback reasons. Names are weak evidence, so
// documentation, fixtures, and README-shaped files are kept out of name signals.
import { compareBytes, isGeneratedGoldenPath } from './stats.mjs'

// The one JavaScript and TypeScript extension family. Sinks and extension lists
// spread it, so adding an extension here reaches every one of them.
export const JS_TS_EXTENSIONS = Object.freeze(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])

export const SEMANTIC_SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.go', '.h', '.hpp', '.java', ...JS_TS_EXTENSIONS, '.kt', '.kts', '.php', '.py',
  '.rb', '.rs', '.sh', '.bash', '.zsh',
])

// Go path.Ext semantics: the suffix from the last dot of the final element, so
// ".env" has extension ".env" (Node's extname returns "" there).
export function goExt(logicalPath) {
  const base = goBase(logicalPath)
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot) : ''
}

export const goBase = (logicalPath) => logicalPath.slice(logicalPath.lastIndexOf('/') + 1)

export const asciiLower = (value) => value.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))

export const fieldsFunc = (value, isSeparator) => {
  const fields = []
  let current = ''
  for (const char of value) {
    if (isSeparator(char)) {
      if (current !== '') fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current !== '') fields.push(current)
  return fields
}

export function isConfigurationReviewPath(logicalPath) {
  const base = goBase(logicalPath).toLowerCase()
  if (base === '.env' || base.startsWith('.env.')) return true
  if (['go.mod', 'go.sum', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'dockerfile', 'makefile'].includes(base)) {
    return true
  }
  return ['.json', '.yaml', '.yml', '.toml', '.ini', '.env'].includes(goExt(logicalPath).toLowerCase())
}

// isTestRiskPath reports whether the file itself is a test: a test naming
// convention, or a directory that only holds tests or fixtures.
export function isTestRiskPath(logicalPath) {
  const segments = asciiLower(logicalPath).split('/')
  for (const segment of segments.slice(0, -1)) {
    if (segment === '__tests__' || segment === 'testdata') return true
  }
  const name = asciiLower(goBase(logicalPath))
  return (
    name.endsWith('_test.go') || name.includes('.test.') || name.includes('.spec.') ||
    (name.startsWith('test_') && name.endsWith('.py')) || name.endsWith('_test.py')
  )
}

export function hasExcludedRiskSegment(logicalPath) {
  return logicalPath.split('/').some((segment) => ['docs', 'testdata', 'fixture', 'fixtures', '__fixtures__'].includes(asciiLower(segment)))
}

// isInspectableStat rejects entries whose bytes cannot carry authored evidence.
export function isInspectableStat(stat) {
  return stat.additions + stat.deletions !== 0 && !stat.binary && !stat.modeOnly && !stat.generated && !isGeneratedGoldenPath(stat.path)
}

export function isSemanticRiskEligible(stat) {
  if (!isInspectableStat(stat) || hasExcludedRiskSegment(stat.path)) return false
  if (asciiLower(goBase(stat.path)).startsWith('readme')) return false
  if (SEMANTIC_SOURCE_EXTENSIONS.has(asciiLower(goExt(stat.path)))) return true
  return isConfigurationReviewPath(stat.path)
}

// isContentScanEligible gates the signals derived from the frozen BYTES. It is
// more permissive than name eligibility: only content can prove a file executes.
export function isContentScanEligible(stat) {
  if (!isInspectableStat(stat) || hasExcludedRiskSegment(stat.path)) return false
  const extension = asciiLower(goExt(stat.path))
  if (SEMANTIC_SOURCE_EXTENSIONS.has(extension) || extension === '.txt') return true
  return isConfigurationReviewPath(stat.path)
}

function stripSemanticPathExtension(segment) {
  const extension = goExt(segment)
  if (SEMANTIC_SOURCE_EXTENSIONS.has(asciiLower(extension)) || isConfigurationReviewPath(segment)) {
    return segment.slice(0, segment.length - extension.length)
  }
  return segment
}

function hasAdjacentServiceTokenTokens(segment) {
  const tokens = fieldsFunc(asciiLower(segment), (c) => c === '-' || c === '_')
  return tokens.some((token, index) => token === 'service' && tokens[index + 1] === 'token')
}

export const isServiceTokenReviewPath = (logicalPath) =>
  logicalPath.split('/').some((segment) => hasAdjacentServiceTokenTokens(stripSemanticPathExtension(segment)))

export function isShellReviewPath(logicalPath) {
  const extension = asciiLower(goExt(logicalPath))
  if (['.sh', '.bash', '.zsh'].includes(extension)) return true
  if (extension === '.yml' || extension === '.yaml') return logicalPath.startsWith('.github/workflows/')
  return false
}

export function executableModeChanged(oldMode, newMode) {
  if (oldMode === '' || newMode === '') return false
  const oldValue = Number.parseInt(oldMode, 8)
  const newValue = Number.parseInt(newMode, 8)
  if (Number.isNaN(oldValue) || Number.isNaN(newValue)) return false
  return (oldValue & 0o111) !== (newValue & 0o111)
}

const HOT_TOKENS = { auth: 'auth', security: 'security', webhook: 'security', payments: 'payments' }

// hotPathRiskSignals names the sensitive areas a path token points at. Test
// files only exercise those areas, so a token there is not evidence.
export function hotPathRiskSignals(logicalPath) {
  if (isTestRiskPath(logicalPath)) return []
  const tokens = fieldsFunc(logicalPath.toLowerCase(), (c) => '/\\.-_'.includes(c))
  return canonicalRiskSignals(tokens.filter((token) => Object.hasOwn(HOT_TOKENS, token)).map((token) => HOT_TOKENS[token]))
}

export const touchesHotPath = (stats) => stats.some((stat) => !isGeneratedGoldenPath(stat.path) && hotPathRiskSignals(stat.path).length !== 0)

export function canonicalRiskSignals(signals) {
  return [...new Set(signals)].sort(compareBytes)
}

// A reason is { code, signal?, path?, oldMode?, newMode? }.
export function canonicalRiskReasons(reasons) {
  const field = (reason, name) => reason[name] ?? ''
  const sorted = [...reasons].sort(
    (a, b) =>
      compareBytes(a.code, b.code) ||
      compareBytes(field(a, 'signal'), field(b, 'signal')) ||
      compareBytes(field(a, 'path'), field(b, 'path')) ||
      compareBytes(field(a, 'oldMode'), field(b, 'oldMode')) ||
      compareBytes(field(a, 'newMode'), field(b, 'newMode')),
  )
  // One reason per code and signal: the first in canonical order wins.
  const seen = new Set()
  return sorted.filter((reason) => {
    const key = `${reason.code}\0${field(reason, 'signal')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const riskSignalsFromReasons = (reasons) => canonicalRiskSignals(reasons.filter((r) => r.signal).map((r) => r.signal))

const isEmptyContentStat = (stat) => !stat.binary && !stat.modeOnly && stat.additions + stat.deletions === 0

// fallbackRiskReason names why a candidate with no signal is not proven
// passive. isPassiveStat is the passive-candidate predicate; activeContent holds
// the paths whose frozen bytes contradicted their passive extension.
function fallbackRiskReason(stats, activeContent, isPassiveStat) {
  for (const stat of stats) {
    if (isGeneratedGoldenPath(stat.path)) continue
    if (isConfigurationReviewPath(stat.path)) return { code: 'configuration_change', path: stat.path }
    if (activeContent.has(stat.path) || !isPassiveStat(stat)) {
      if (isEmptyContentStat(stat)) return { code: 'empty_content', path: stat.path }
      return { code: 'executable_change', path: stat.path }
    }
  }
  return { code: 'non_executable_only' }
}

// deriveSnapshotRiskReasons names the evidence behind a tier.
export function deriveSnapshotRiskReasons(stats, activeContent, isPassiveStat) {
  const candidates = []
  for (const stat of stats) {
    if (isSemanticRiskEligible(stat)) {
      if (isServiceTokenReviewPath(stat.path) && !isTestRiskPath(stat.path)) {
        candidates.push({ code: 'service_token', signal: 'auth', path: stat.path })
      }
      if (isShellReviewPath(stat.path)) candidates.push({ code: 'shell_source', signal: 'shell_process', path: stat.path })
    }
    if (executableModeChanged(stat.oldMode, stat.newMode)) {
      candidates.push({ code: 'executable_mode', signal: 'permissions', path: stat.path, oldMode: stat.oldMode, newMode: stat.newMode })
    }
    if (!isGeneratedGoldenPath(stat.path)) {
      for (const signal of hotPathRiskSignals(stat.path)) candidates.push({ code: 'hot_path', signal, path: stat.path })
    }
  }
  if (candidates.length === 0) candidates.push(fallbackRiskReason(stats, activeContent, isPassiveStat))
  return canonicalRiskReasons(candidates)
}

export function removeFallbackRiskReasons(reasons) {
  const fallback = ['non_executable_only', 'configuration_change', 'executable_change', 'empty_content']
  return reasons.filter((reason) => !fallback.includes(reason.code))
}
