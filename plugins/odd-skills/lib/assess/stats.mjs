// Diff statistics between two frozen trees and the canonical changed-line count.
import { git } from './git.mjs'

const MODE = /^[0-7]{6}$/

export function normalizeLogicalPath(value) {
  if (value === '' || value.includes('\0') || value.includes('\\') || value.startsWith('/')) {
    throw new Error(`invalid logical path ${JSON.stringify(value)}`)
  }
  if (value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`logical path is not canonical: ${JSON.stringify(value)}`)
  }
  return value
}

export function isGeneratedGoldenPath(logicalPath) {
  const normalized = `/${logicalPath.replace(/^\.\//, '')}`
  return normalized.includes('/testdata/golden/') && normalized.endsWith('.golden')
}

function splitN(value, separator, count) {
  const parts = []
  let rest = value
  while (parts.length < count - 1) {
    const index = rest.indexOf(separator)
    if (index < 0) break
    parts.push(rest.slice(0, index))
    rest = rest.slice(index + separator.length)
  }
  parts.push(rest)
  return parts
}

function parseNumstat(payload) {
  const byPath = new Map()
  for (const record of payload.toString('utf8').split('\0')) {
    if (record === '') continue
    const fields = splitN(record, '\t', 3)
    if (fields.length !== 3) throw new Error(`unexpected immutable diff stat ${JSON.stringify(record)}`)
    const path = normalizeLogicalPath(fields[2])
    if (byPath.has(path)) throw new Error(`duplicate immutable diff stat path ${JSON.stringify(path)}`)
    const stat = { path, additions: 0, deletions: 0, binary: false }
    if (fields[0] === '-' && fields[1] === '-') {
      stat.binary = true
    } else {
      if (!/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) throw new Error(`parse line counts for ${JSON.stringify(path)}`)
      stat.additions = Number(fields[0])
      stat.deletions = Number(fields[1])
    }
    byPath.set(path, stat)
  }
  return byPath
}

function parseRaw(payload) {
  const records = payload.toString('utf8').split('\0')
  const byPath = new Map()
  for (let index = 0; index < records.length; index++) {
    const header = records[index]
    if (header === '') continue
    const fields = header.split(/\s+/).filter(Boolean)
    if (fields.length !== 5 || fields[0].length !== 7 || fields[0][0] !== ':' || !records[index + 1]) {
      throw new Error(`unexpected immutable raw diff record ${JSON.stringify(header)}`)
    }
    if (!/^[ADMT]$/.test(fields[4])) throw new Error(`unexpected immutable raw diff status ${JSON.stringify(fields[4])}`)
    const oldMode = fields[0].slice(1)
    const newMode = fields[1]
    if (!MODE.test(oldMode) || !MODE.test(newMode)) throw new Error(`unexpected immutable raw diff modes ${oldMode} and ${newMode}`)
    index++
    const path = normalizeLogicalPath(records[index])
    if (byPath.has(path)) throw new Error(`duplicate immutable raw diff path ${JSON.stringify(path)}`)
    byPath.set(path, { oldMode, newMode, oldObject: fields[2], newObject: fields[3] })
  }
  return byPath
}

export const compareBytes = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))

// collectDiffStats returns one entry per changed path, ordered by path bytes.
// isolation is the value from createIsolation (frozen bytes only).
export function collectDiffStats(root, baseTree, candidateTree, isolation) {
  const common = ['--no-ext-diff', '--no-textconv', '--no-renames', '--ignore-submodules=none', baseTree, candidateTree, '--']
  const numstat = parseNumstat(git(root, ['diff', '--numstat', '-z', ...common], { env: isolation.env }))
  const raw = parseRaw(git(root, ['diff', '--raw', '-z', ...common], { env: isolation.env }))
  if (numstat.size !== raw.size) throw new Error('immutable tree diff stats disagree with the raw tree diff')
  const stats = []
  for (const path of [...raw.keys()].sort(compareBytes)) {
    const stat = numstat.get(path)
    if (!stat) throw new Error(`immutable snapshot path ${JSON.stringify(path)} is missing from tree diff stats`)
    const modes = raw.get(path)
    stats.push({
      ...stat,
      generated: isGeneratedGoldenPath(path),
      oldMode: modes.oldMode,
      newMode: modes.newMode,
      modeOnly: modes.oldObject === modes.newObject && modes.oldMode !== modes.newMode,
    })
  }
  return stats
}

// countChangedLines is the canonical counting rule: authored text additions and
// deletions count once; generated goldens, binary, and mode-only entries count
// zero. Malformed or duplicated stats are rejected.
export function countChangedLines(stats) {
  let total = 0
  const seen = new Set()
  for (const stat of stats) {
    const path = normalizeLogicalPath(stat.path)
    if (seen.has(path)) throw new Error(`duplicate diff stat path ${JSON.stringify(path)}`)
    seen.add(path)
    if (stat.additions < 0 || stat.deletions < 0) throw new Error(`negative diff stat for ${JSON.stringify(path)}`)
    if (isGeneratedGoldenPath(path) || stat.binary || stat.modeOnly) continue
    total += stat.additions + stat.deletions
  }
  return total
}
