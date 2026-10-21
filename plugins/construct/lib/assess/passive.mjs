// The passive (documentation-only) gate. An extension only nominates a candidate;
// mode and the frozen bytes decide the tier. Operational markdown, agent-facing
// material, and configuration are never passive.
import { batchBlobContents, catFileRecordBytes, treeBlobSizes } from './git.mjs'
import { asciiLower, fieldsFunc, goBase, goExt, isConfigurationReviewPath } from './signals.mjs'
import { isGeneratedGoldenPath } from './stats.mjs'
import { PRIVATE_KEY_HEADER, isItemEvidencePath } from './items.mjs'
import { goTrimSpace } from './text.mjs'

// Caps every content readback this classifier performs (8 MiB).
export const SCAN_BYTE_LIMIT = 8 << 20

const isRegularNonExecutableGitMode = (mode) => ['', '000000', '100644'].includes(mode)
const isAlphaNum = (c) => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')

function isOperationalMarkdownPath(logicalPath) {
  const lower = asciiLower(logicalPath)
  const segments = lower.split('/')
  const base = goBase(lower)
  if (['agents.md', 'claude.md', 'gemini.md', 'kimi.md', 'skill.md', 'copilot-instructions.md'].includes(base)) return true
  for (const [index, segment] of segments.entries()) {
    if (['.agent', '.agents', '.claude', '.codex', '.cursor', '.opencode', 'openspec', 'runtime'].includes(segment)) return true
    if (index === 1 && segments[0] === 'internal' && ['runtime', 'assets', 'templates'].includes(segment)) return true
    const name = segment.slice(0, segment.length - goExt(segment).length)
    const tokens = fieldsFunc(name, (c) => !isAlphaNum(c))
    const operational = ['agent', 'agents', 'skill', 'skills', 'prompt', 'prompts', 'instruction', 'instructions', 'orchestrator', 'orchestrators', 'workflow', 'workflows']
    if (tokens.some((token) => operational.includes(token))) return true
  }
  return false
}

export function isPassiveDocumentExtension(logicalPath) {
  if (isOperationalMarkdownPath(logicalPath)) return false
  const extension = goExt(logicalPath).toLowerCase()
  return ['.md', '.mdx', '.rst', '.adoc', '.png', '.jpg', '.jpeg', '.gif'].includes(extension)
}

// isPassiveContentCandidatePath nominates a path for the passive tier.
export function isPassiveContentCandidatePath(logicalPath) {
  if (!isPassiveDocumentExtension(logicalPath) || isConfigurationReviewPath(logicalPath)) return false
  const base = goBase(logicalPath).toLowerCase()
  if (['agents.md', 'claude.md', 'gemini.md', 'kimi.md', 'soul.md', 'tools.md', 'skill.md', 'copilot-instructions.md'].includes(base)) return false
  const stem = base.slice(0, base.length - goExt(base).toLowerCase().length)
  const stemTokens = fieldsFunc(stem, (c) => '-_. '.includes(c))
  const tokenDenylist = ['agent', 'agents', 'command', 'commands', 'prompt', 'prompts', 'rule', 'rules', 'runtime', 'runtimes', 'skill', 'skills', 'workflow', 'workflows']
  if (stemTokens.some((token) => tokenDenylist.includes(token))) return false
  const segmentDenylist = ['.github', '.claude', '.codex', '.cursor', '.gemini', '.kiro', '.kilo', '.opencode', '.windsurf', ...tokenDenylist]
  return !logicalPath.toLowerCase().split('/').some((segment) => segmentDenylist.includes(segment))
}

const isPassiveImageExtension = (logicalPath) => ['.png', '.jpg', '.jpeg', '.gif'].includes(goExt(logicalPath).toLowerCase())

function hasPassiveImageSignature(content) {
  const magics = [Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('GIF87a'), Buffer.from('GIF89a')]
  return magics.some((magic) => content.length >= magic.length && content.subarray(0, magic.length).equals(magic))
}

// isPassiveContentCandidateStat adds the mode half of the nomination: a symlink,
// a gitlink, a mode-only entry, or an executable bit cannot be reviewed as prose,
// and a binary blob only qualifies under a passive image extension.
export function isPassiveContentCandidateStat(stat) {
  if (stat.binary && !isPassiveImageExtension(stat.path)) return false
  if (stat.modeOnly || !isPassiveContentCandidatePath(stat.path)) return false
  return isRegularNonExecutableGitMode(stat.oldMode) && isRegularNonExecutableGitMode(stat.newMode)
}

const startsWithKeyword = (value, keyword) => {
  if (!value.startsWith(keyword)) return false
  if (value.length === keyword.length) return true
  return !/[A-Za-z0-9_$]/.test(value[keyword.length])
}

const escapedBacktick = (value, index) => {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i--) backslashes++
  return backslashes % 2 === 1
}

function exactBacktickRunIndex(value, marker) {
  for (let offset = 0; offset < value.length; ) {
    const found = value.indexOf(marker, offset)
    if (found < 0) return -1
    const before = found > 0 && value[found - 1] === '`'
    const after = found + marker.length < value.length && value[found + marker.length] === '`'
    if (!before && !after && !escapedBacktick(value, found)) return found
    offset = found + 1
  }
  return -1
}

export function stripMarkdownCodeSpans(input) {
  let value = input
  let visible = ''
  while (value.length > 0) {
    const start = value.indexOf('`')
    if (start < 0) {
      visible += value
      break
    }
    if (escapedBacktick(value, start)) {
      visible += value.slice(0, start + 1)
      value = value.slice(start + 1)
      continue
    }
    visible += value.slice(0, start)
    let run = 1
    while (start + run < value.length && value[start + run] === '`') run++
    const marker = value.slice(start, start + run)
    const remainder = value.slice(start + run)
    const end = exactBacktickRunIndex(remainder, marker)
    if (end < 0) {
      visible += value.slice(start)
      break
    }
    value = remainder.slice(end + run)
  }
  return goTrimSpace(visible)
}

function trimLeadingJavaScriptBlockComments(input) {
  let value = input
  while (value.startsWith('/*')) {
    const end = value.indexOf('*/', 2)
    if (end < 0) break
    value = goTrimSpace(value.slice(end + 2))
  }
  return value
}

// isStaticMDXDocument rejects runtime syntax (import/export, braces, tags)
// outside fenced and inline code examples.
export function isStaticMDXDocument(content) {
  const lines = content.toString('utf8').split('\n')
  if (lines.at(-1) === '') lines.pop()
  let fence = ''
  for (const rawLine of lines) {
    if (Buffer.byteLength(rawLine) > 1024 * 1024) return false
    const trimmed = goTrimSpace(rawLine.replace(/\r$/, '').replace(/^﻿/, ''))
    if (fence !== '') {
      if (trimmed.startsWith(fence)) fence = ''
      continue
    }
    if (trimmed.startsWith('```')) {
      fence = '```'
      continue
    }
    if (trimmed.startsWith('~~~')) {
      fence = '~~~'
      continue
    }
    const prose = trimLeadingJavaScriptBlockComments(stripMarkdownCodeSpans(trimmed))
    if (startsWithKeyword(prose, 'import') || startsWithKeyword(prose, 'export') || /[{}<]/.test(prose)) return false
  }
  return true
}

const hasInterpreterDirective = (content) => {
  const body = content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf ? content.subarray(3) : content
  return body.length >= 2 && body[0] === 0x23 && body[1] === 0x21
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const isValidUtf8 = (content) => {
  try {
    strictUtf8.decode(content)
    return true
  } catch {
    return false
  }
}

// isPassiveDocumentContent proves a document inert from its own bytes.
export function isPassiveDocumentContent(logicalPath, content) {
  if (isPassiveImageExtension(logicalPath)) return hasPassiveImageSignature(content)
  if (content.includes(0) || !isValidUtf8(content)) return false
  if (hasInterpreterDirective(content)) return false
  if (isItemEvidencePath(logicalPath) && PRIVATE_KEY_HEADER.test(content.toString('utf8'))) return false
  if (goExt(logicalPath).toLowerCase() === '.mdx') return isStaticMDXDocument(content)
  return true
}

// activePassiveContentPaths reads the frozen bytes behind every passive
// candidate and returns the paths whose content contradicts the passive shape
// their extension advertises. Sizes are probed first so the readback stays
// bounded; an over-budget set is never proven passive.
export function activePassiveContentPaths(root, baseTree, candidateTree, stats) {
  const candidates = stats.filter((stat) => !isGeneratedGoldenPath(stat.path) && isPassiveContentCandidateStat(stat))
  const paths = candidates.map((stat) => stat.path)
  const active = new Set()
  if (candidates.length === 0) return active
  const markAll = () => {
    for (const path of paths) active.add(path)
    return active
  }
  let scanned = 0
  const blobsByTree = new Map()
  for (const tree of [baseTree, candidateTree]) {
    const blobs = treeBlobSizes(root, tree, paths)
    scanned += blobs.reduce((sum, blob) => sum + blob.size, 0)
    blobsByTree.set(tree, new Map(blobs.map((blob) => [blob.path, blob])))
  }
  if (scanned > SCAN_BYTE_LIMIT) return markAll()
  const versionsOf = (stat) => [
    { tree: baseTree, mode: stat.oldMode },
    { tree: candidateTree, mode: stat.newMode },
  ].filter((version) => version.mode !== '' && version.mode !== '000000')
  const oids = []
  let batchBytes = 0
  for (const stat of candidates) {
    for (const version of versionsOf(stat)) {
      const blob = blobsByTree.get(version.tree).get(stat.path)
      if (!blob) throw new Error(`read immutable passive candidate ${JSON.stringify(stat.path)}: blob is absent from tree inventory`)
      const record = catFileRecordBytes(blob.oid, blob.size)
      if (record >= SCAN_BYTE_LIMIT - batchBytes) return markAll()
      batchBytes += record
      oids.push(blob.oid)
    }
  }
  const contents = batchBlobContents(root, oids, batchBytes)
  for (const stat of candidates) {
    for (const version of versionsOf(stat)) {
      const blob = blobsByTree.get(version.tree).get(stat.path)
      if (!isPassiveDocumentContent(stat.path, contents.get(blob.oid))) {
        active.add(stat.path)
        break
      }
    }
  }
  return active
}
