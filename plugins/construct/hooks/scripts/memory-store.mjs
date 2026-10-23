// The per-repository memory store (S1-S4 of odd/tasks/construct-memory.md): one SQLite + FTS5
// database under the git common dir (construct-memory/memory.db), shared by every worktree.
// Imported by the construct-memory CLI and the memory hooks; it prints nothing itself.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { git } from './git-tree.mjs'

// The module loads node:sqlite with its ExperimentalWarning (Node 22) swallowed: a hook or the
// CLI must leave stderr empty. Only that one warning is dropped.
const emit = process.emitWarning
process.emitWarning = (warning, ...rest) => (/SQLite/.test(String(warning?.message ?? warning)) ? undefined : emit.call(process, warning, ...rest))
let DatabaseSync
try {
  ;({ DatabaseSync } = await import('node:sqlite'))
} finally {
  process.emitWarning = emit
}

const SCHEMA_VERSION = 1
const MAX_CONTENT_BYTES = 50000
const TRUNCATED = '... [truncated]'
const MAX_TOPIC_KEY_BYTES = 120
const DEDUP_WINDOW_MS = 15 * 60 * 1000
const SEARCH_DEFAULT = 10
const SEARCH_MAX = 20
const PREVIEW_CHARS = 300
const CONTEXT_MAX_BYTES = 16384
const CONTEXT_MARKER = '\n[truncated]\n'
const BUSY_RETRIES = 5
const PINNED_MAX = 20
const PINNED_BOOST = 0.1
const PASSIVE_WEIGHT = 0.5
const LEARNINGS_MAX = 3
const PASSIVE_SIMILAR = 0.8
const TIMELINE_DEFAULT = 5
const PROMPTS_DEFAULT = 20
const PROMPTS_MAX = 100
const CANDIDATES_MAX = 3
const JUDGE_MANY_MAX = 32
export const RELATIONS = ['related', 'compatible', 'scoped', 'conflicts_with', 'supersedes', 'not_conflict']
// Initial review prompts in months per type, not deadlines; other types have none.
export const REVIEW_MONTHS = { decision: 6, policy: 12, preference: 3, config: 3, discovery: 6, pattern: 6, architecture: 12, bugfix: 12 }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  topic_key TEXT,
  normalized_hash TEXT NOT NULL,
  revision_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  review_after TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  import_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS observations_import ON observations(import_id) WHERE import_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS observations_topic ON observations(topic_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS observations_hash ON observations(normalized_hash) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS observation_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  topic_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS observation_versions_obs ON observation_versions(observation_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS user_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  import_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS prompts_import ON user_prompts(import_id) WHERE import_id IS NOT NULL;
-- Import keys of erased prompts and observations (keys differ by their prompt:/obs: prefix).
-- One row, db_id: this database's random id, used in the export keys of its own rows.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS import_tombstones (
  import_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL
);
-- Judgments between two observations: one row per unordered pair; status pending until an agent judges it.
CREATE TABLE IF NOT EXISTS memory_relations (
  id TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  relation TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  evidence TEXT,
  confidence REAL,
  marked_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS memory_relations_pair ON memory_relations(min(source_id, target_id), max(source_id, target_id));
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  title, content, type, topic_key, content='observations', content_rowid='id', tokenize='trigram'
);
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
  content, content='user_prompts', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations WHEN new.deleted_at IS NULL BEGIN
  INSERT INTO observations_fts(rowid, title, content, type, topic_key) VALUES (new.id, new.title, new.content, new.type, new.topic_key);
END;
CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, content, type, topic_key)
    SELECT 'delete', old.id, old.title, old.content, old.type, old.topic_key WHERE old.deleted_at IS NULL;
  INSERT INTO observations_fts(rowid, title, content, type, topic_key)
    SELECT new.id, new.title, new.content, new.type, new.topic_key WHERE new.deleted_at IS NULL;
END;
CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations WHEN old.deleted_at IS NULL BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, content, type, topic_key) VALUES ('delete', old.id, old.title, old.content, old.type, old.topic_key);
END;
CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON user_prompts BEGIN
  INSERT INTO prompts_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON user_prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
`

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const isBusy = (error) => error?.errcode === 5 || error?.errcode === 6 || /SQLITE_BUSY|database is locked/i.test(error?.message ?? '')

// A closed span is redacted; an unclosed <private> redacts to the end of the text.
const stripPrivate = (text) => String(text ?? '').replace(/<private>(?:[\s\S]*?<\/private>|[\s\S]*$)/gi, '[REDACTED]')

// Injection scan: narrow English patterns for text that tries to steer a later session (instruction override,
// fake role tags, compaction survival). shortcut: English only, upgrade when a miss is reported.
const INJECTION = new RegExp([
  String.raw`\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:(?:the|your|any)\s+)?(?:(?:previous|prior|above|earlier)\s+instructions?|instructions?\s+above)\b`,
  String.raw`<\/?system>|<\|im_(?:start|end)\|>|\[\/?INST\]`,
  String.raw`\bwhen\s+(?:compacting|summari[sz]ing)\s*,\s*(?:retain|keep|preserve)\b`,
].join('|'), 'im')
export const injects = (text) => INJECTION.test(String(text ?? ''))
const filterLines = (text) => String(text).split('\n').map((line) => (injects(line) ? '[FILTERED]' : line)).join('\n')

// cutBytes is the longest prefix of text within maxBytes that ends on a character boundary.
function cutBytes(text, maxBytes) {
  const bytes = Buffer.from(text)
  if (bytes.length <= maxBytes) return text
  let end = maxBytes
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}

const capContent = (text) => (Buffer.byteLength(text) <= MAX_CONTENT_BYTES ? text : cutBytes(text, MAX_CONTENT_BYTES) + TRUNCATED)
const normalizeTopicKey = (key) => cutBytes(String(key ?? '').trim().toLowerCase().split(/\s+/).join('-'), MAX_TOPIC_KEY_BYTES)
const flat = (text, max) => {
  const chars = [...String(text).replace(/\s+/g, ' ').trim()]
  return chars.length > max ? `${chars.slice(0, max).join('')}...` : chars.join('')
}

// normalizedHash is the dedup key: lowercase content with whitespace collapsed.
export const normalizedHash = (content) => createHash('sha256').update(String(content).split(/\s+/).filter(Boolean).join(' ').toLowerCase()).digest('hex')

const addMonths = (date, months) => {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString()
}
// isoTime reads an export timestamp; engram writes RFC 3339, older rows may be 'YYYY-MM-DD HH:MM:SS' (UTC).
const isoTime = (text) => {
  const d = new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text) ? `${text.replace(' ', 'T')}Z` : text)
  if (Number.isNaN(d.getTime())) throw new Error(`invalid timestamp in export: ${JSON.stringify(text)}`)
  return d.toISOString()
}
const EXPORT_VERSIONS = ['0.1.0', '0.2.0']
const projectName = (name) => String(name ?? '').trim().toLowerCase()
const SEARCH_COLUMNS = 'o.id, o.type, o.title, o.topic_key, o.pinned, o.created_at, o.updated_at, o.review_after, substr(o.content, 1, 300) AS preview, length(o.content) > 300 AS truncated'
const queryTerms = (text) => String(text ?? '').trim().split(/\s+/).map((t) => t.replace(/^"+|"+$/g, '')).filter(Boolean)
const hasShortTerm = (terms) => terms.some((t) => [...t].length < 3)
const ftsQuoted = (terms, any) => terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(any ? ' OR ' : ' AND ')
// wordSet is the lowercase words of 3+ letters or digits, the unit of passive near-duplicate checks.
const wordSet = (text) => new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
const likePattern = (term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`

// suggestTopicKey ports engram's SuggestTopicKey: a family from the type (or, for an untyped note, from
// keywords in the text) plus a slug of the title (else the first 8 words of the content), as `family/slug`.
const TOPIC_FAMILIES = [
  ['architecture', ['architecture', 'design', 'adr', 'refactor']],
  ['bug', ['bug', 'bugfix', 'fix', 'incident', 'hotfix']],
  ['decision', ['decision']],
  ['pattern', ['pattern', 'convention', 'guideline']],
  ['config', ['config', 'setup', 'infra', 'infrastructure', 'ci']],
  ['discovery', ['discovery', 'investigation', 'root_cause', 'root-cause']],
  ['learning', ['learning', 'learn']],
  ['session', ['session_summary']],
]
const FAMILY_KEYWORDS = [
  ['bug', ['bug', 'fix', 'panic', 'error', 'crash', 'regression', 'incident', 'hotfix']],
  ['architecture', ['architecture', 'design', 'adr', 'boundary', 'hexagonal', 'refactor']],
  ['decision', ['decision', 'tradeoff', 'chose', 'choose', 'decide']],
  ['pattern', ['pattern', 'convention', 'naming', 'guideline']],
  ['config', ['config', 'setup', 'environment', 'env', 'docker', 'pipeline']],
  ['discovery', ['discovery', 'investigate', 'investigation', 'found', 'root cause']],
  ['learning', ['learned', 'learning']],
]
const topicSegment = (text) => cutBytes(String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).join('-'), 100)

export function suggestTopicKey({ type = '', title = '', content = '' } = {}) {
  const t = String(type).trim().toLowerCase()
  const text = `${title} ${content}`.toLowerCase()
  let family = TOPIC_FAMILIES.find(([, types]) => types.includes(t))?.[0]
  family ??= FAMILY_KEYWORDS.find(([, words]) => words.some((w) => text.includes(w)))?.[0]
  family ??= t !== '' && t !== 'manual' ? topicSegment(t) : 'topic'
  let source = stripPrivate(title)
  let segment = topicSegment(source)
  if (segment === '') {
    source = stripPrivate(content).split(/\s+/).filter(Boolean).slice(0, 8).join(' ')
    segment = topicSegment(source)
  }
  if (segment.startsWith(`${family}-`)) segment = segment.slice(family.length + 1)
  if (segment === '' || segment === family) segment = 'general'
  // A non-ASCII source loses characters in the slug, so a hash suffix keeps different sources apart.
  if (/[^\x00-\x7f]/.test(source)) {
    const suffix = `-u-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`
    segment = cutBytes(segment, Math.min(100, 120 - family.length - 1) - suffix.length) + suffix
  }
  return `${family}/${segment}`
}
const relationId = () => `rel-${randomBytes(8).toString('hex')}`
function checkVerdict(relation, confidence) {
  if (!RELATIONS.includes(relation)) throw new Error(`relation must be one of ${RELATIONS.join(', ')}`)
  if (confidence === undefined || confidence === null) return null
  const c = typeof confidence === 'string' && confidence.trim() === '' ? NaN : Number(confidence)
  if (!(c >= 0 && c <= 1)) throw new Error('confidence must be a number between 0 and 1')
  return c
}
const text = (v) => (v === undefined || v === null ? null : stripPrivate(v))
const reviewAfter = (type, from) => (type in REVIEW_MONTHS ? addMonths(from, REVIEW_MONTHS[type]) : null)

// whereTokens lists the path-like tokens of every `Where:` line in a memory's content.
const whereTokens = (content) => (content.match(/^[ \t]*Where:(.*)$/gm) ?? []).flatMap((line) => line.replace(/^[ \t]*Where:/, '').split(/[\s,;]+/)).map((t) => t.replace(/^[`'"(]+|[`'")]+$|\.+$/g, '')).filter(Boolean)

// openMemory returns the store of the repository containing cwd, or null outside one.
// `now` is the clock (tests move it). A database written by a newer schema throws.
export function openMemory(cwd, { now = () => new Date() } = {}) {
  let dir
  let repoName
  try {
    const common = git(cwd, ['rev-parse', '--git-common-dir']).toString('utf8').trim()
    const commonDir = resolve(cwd, common)
    repoName = basename(dirname(commonDir))
    dir = join(commonDir, 'construct-memory')
  } catch {
    return null
  }
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'memory.db')
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA secure_delete = ON')
  const store = makeStore(db, path, now, repoName)
  try {
    store.init()
  } catch (error) {
    db.close()
    throw error
  }
  return store
}

function makeStore(db, path, now, repoName) {
  const stamp = () => now().toISOString()

  // retry runs fn, retrying up to BUSY_RETRIES times with 10-200 ms backoff while SQLite reports busy.
  function retry(fn) {
    for (let attempt = 0; ; attempt++) {
      try {
        return fn()
      } catch (error) {
        if (!isBusy(error) || attempt >= BUSY_RETRIES) throw error
        sleep(Math.min(200, 10 * 2 ** attempt) + Math.random() * 10)
      }
    }
  }

  // scrub runs after an erase has committed: merges the FTS index so no deleted text stays in a segment,
  // and truncates the WAL. Best effort: a busy database never fails the delete.
  function scrub(fts) {
    try {
      retry(() => db.exec(`INSERT INTO ${fts}(${fts}) VALUES ('optimize')`))
      retry(() => db.exec('PRAGMA wal_checkpoint(TRUNCATE)'))
    } catch {
      // shortcut: a checkpoint that stays busy leaves erased text in the WAL until the next one, upgrade if that matters
    }
  }

  // write runs fn in a BEGIN IMMEDIATE transaction, so concurrent writers queue instead of failing late.
  function write(fn) {
    return retry(() => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (error) {
        try {
          db.exec('ROLLBACK')
        } catch {
          // The transaction is already gone.
        }
        throw error
      }
    })
  }

  const one = (sql, ...args) => db.prepare(sql).get(...args)
  const all = (sql, ...args) => db.prepare(sql).all(...args)
  const run = (sql, ...args) => db.prepare(sql).run(...args)

  const present = (row) => (row ? { ...row, needs_review: row.review_after !== null && row.review_after <= stamp() } : null)

  function snapshot(row) {
    run('INSERT INTO observation_versions (observation_id, type, title, content, topic_key, created_at) VALUES (?, ?, ?, ?, ?, ?)', row.id, row.type, row.title, row.content, row.topic_key, stamp())
  }

  function clean(value, name) {
    const text = stripPrivate(value)
    if (text.trim() === '') throw new Error(`${name} is required`)
    if (injects(text)) throw new Error(`${name} looks like prompt injection (instruction override, role tag, or compaction directive) and was not stored`)
    return text
  }

  // candidatesFor records up to 3 live observations that share title terms with the saved one as pending
  // relations and returns them; pairs that already have a relation are skipped. Runs inside save's transaction.
  // shortcut: terms under 3 characters are dropped (the trigram index cannot match them), a title of only short words gets no candidates.
  function candidatesFor(id, title, at) {
    const terms = queryTerms(title).filter((t) => [...t].length >= 3)
    if (terms.length === 0) return []
    const rows = all(`SELECT o.id, o.title FROM observations_fts f JOIN observations o ON o.id = f.rowid WHERE observations_fts MATCH ? AND o.deleted_at IS NULL AND o.id != ?
      AND NOT EXISTS (SELECT 1 FROM memory_relations r WHERE min(r.source_id, r.target_id) = min(o.id, ?) AND max(r.source_id, r.target_id) = max(o.id, ?))
      ORDER BY bm25(observations_fts, 5.0, 1.0, 0.0, 3.0), o.id LIMIT ?`, ftsQuoted(terms, true), id, id, id, CANDIDATES_MAX)
    return rows.map((r) => {
      const judgment_id = relationId()
      run("INSERT INTO memory_relations (id, source_id, target_id, marked_by, created_at, updated_at) VALUES (?, ?, ?, 'save', ?, ?)", judgment_id, id, r.id, at, at)
      return { id: r.id, title: r.title, judgment_id }
    })
  }

  function applyJudgment(judgmentId, relation, { reason, evidence, confidence } = {}) {
    const c = checkVerdict(relation, confidence)
    const at = stamp()
    const { changes } = run("UPDATE memory_relations SET relation = ?, status = 'judged', reason = ?, evidence = ?, confidence = ?, marked_by = 'agent', updated_at = ? WHERE id = ?", relation, text(reason), text(evidence), c, at, String(judgmentId))
    if (changes === 0) throw new Error(`judgment ${judgmentId} not found`)
  }

  // marksFor maps observation id to the judged marks of a live row: conflicts_with and supersedes between two live rows,
  // plus supersedes from the row to a soft-deleted target (marked "(deleted)", the trace consolidate leaves).
  function marksFor(ids) {
    const marks = new Map(ids.map((id) => [id, []]))
    if (ids.length === 0) return marks
    const list = ids.map(() => '?').join(',')
    const rows = all(`SELECT r.source_id, r.target_id, r.relation, (SELECT deleted_at IS NOT NULL FROM observations WHERE id = r.source_id) AS source_gone, (SELECT deleted_at IS NOT NULL FROM observations WHERE id = r.target_id) AS target_gone
      FROM memory_relations r WHERE r.status = 'judged' AND r.relation IN ('conflicts_with', 'supersedes') AND (r.source_id IN (${list}) OR r.target_id IN (${list})) ORDER BY r.relation, r.source_id, r.target_id`, ...ids, ...ids)
    for (const r of rows) {
      if (r.source_gone) continue
      if (r.target_gone) {
        if (r.relation === 'supersedes' && marks.has(r.source_id)) marks.get(r.source_id).push(`supersedes #${r.target_id} (deleted)`)
        continue
      }
      if (marks.has(r.source_id)) marks.get(r.source_id).push(r.relation === 'supersedes' ? `supersedes #${r.target_id}` : `conflicts with #${r.target_id}`)
      if (marks.has(r.target_id)) marks.get(r.target_id).push(r.relation === 'supersedes' ? `superseded by #${r.source_id}` : `conflicts with #${r.source_id}`)
    }
    return marks
  }

  const api = {
    path,
    dbId: null,

    init() {
      retry(() => db.exec('PRAGMA journal_mode = WAL'))
      write(() => {
        const version = one('PRAGMA user_version').user_version
        if (version > SCHEMA_VERSION) {
          throw new Error(`memory database is from a newer construct (schema ${version}, this one knows ${SCHEMA_VERSION}); update the plugin`)
        }
        if (version < SCHEMA_VERSION) {
          db.exec(SCHEMA)
          db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
        }
        run("INSERT OR IGNORE INTO meta (key, value) VALUES ('db_id', ?)", randomUUID().replaceAll('-', ''))
        api.dbId = one("SELECT value FROM meta WHERE key = 'db_id'").value
      })
    },

    // save inserts, upserts (candidates: true, for agent saves, also records pending relations) by topic_key (versioning the old state), or counts a duplicate.
    save({ title, content, type = 'manual', topic_key = null, session_id = null }, { candidates = false } = {}) {
      const cleanTitle = clean(title, 'title')
      const body = capContent(clean(content, 'content'))
      const key = normalizeTopicKey(topic_key) || null
      const hash = normalizedHash(body)
      return write(() => {
        const at = stamp()
        const live = key ? one('SELECT * FROM observations WHERE topic_key = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1', key) : undefined
        if (live) {
          snapshot(live)
          run('UPDATE observations SET type = ?, title = ?, content = ?, normalized_hash = ?, revision_count = revision_count + 1, last_seen_at = ?, review_after = ?, updated_at = ? WHERE id = ?', type, cleanTitle, body, hash, at, reviewAfter(type, at), at, live.id)
          return { id: live.id, action: 'upserted', ...(candidates && { candidates: candidatesFor(live.id, cleanTitle, at) }) }
        }
        const since = new Date(now().getTime() - DEDUP_WINDOW_MS).toISOString()
        const dup = one('SELECT id FROM observations WHERE normalized_hash = ? AND type = ? AND title = ? AND deleted_at IS NULL AND last_seen_at >= ? ORDER BY id DESC LIMIT 1', hash, type, cleanTitle, since)
        if (dup) {
          run('UPDATE observations SET duplicate_count = duplicate_count + 1, last_seen_at = ?, updated_at = ? WHERE id = ?', at, at, dup.id)
          return { id: dup.id, action: 'deduplicated' }
        }
        const { lastInsertRowid } = run('INSERT INTO observations (session_id, type, title, content, topic_key, normalized_hash, last_seen_at, review_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', session_id, type, cleanTitle, body, key, hash, at, reviewAfter(type, at), at, at)
        const id = Number(lastInsertRowid)
        return { id, action: 'inserted', ...(candidates && { candidates: candidatesFor(id, cleanTitle, at) }) }
      })
    },

    // update patches title, content, type, or topic_key, or replaces `find` with `replace` in the
    // content (all occurrences); the old state is versioned when title or content change.
    // Returns null for an unknown or deleted id.
    update(id, { title, content, type, topic_key, find, replace } = {}) {
      const hasFind = find !== undefined || replace !== undefined
      if (hasFind && (find === undefined || replace === undefined)) throw new Error('find and replace go together')
      if (hasFind && content !== undefined) throw new Error('give content or find/replace, not both')
      return write(() => {
        const row = one('SELECT * FROM observations WHERE id = ? AND deleted_at IS NULL', id)
        if (!row) return null
        let nextContent = row.content
        if (content !== undefined) nextContent = capContent(clean(content, 'content'))
        if (hasFind && find !== '') nextContent = capContent(clean(nextContent.split(find).join(replace), 'content'))
        const next = {
          title: title === undefined ? row.title : clean(title, 'title'),
          content: nextContent,
          type: type ?? row.type,
          topic_key: topic_key === undefined ? row.topic_key : normalizeTopicKey(topic_key) || null,
        }
        if (Object.keys(next).every((k) => next[k] === row[k])) return { id, action: 'unchanged' }
        if (next.title !== row.title || next.content !== row.content) snapshot(row)
        const at = stamp()
        run('UPDATE observations SET type = ?, title = ?, content = ?, topic_key = ?, normalized_hash = ?, revision_count = revision_count + 1, review_after = ?, updated_at = ? WHERE id = ?', next.type, next.title, next.content, next.topic_key, normalizedHash(next.content), next.type === row.type ? row.review_after : reviewAfter(next.type, at), at, id)
        return { id, action: 'updated' }
      })
    },

    // remove soft-deletes; true when a live row was deleted. With hard it erases the row and its versions
    // (the observations_ad trigger drops a live row's FTS entry and skips a soft-deleted one, which has none);
    // an imported row leaves a tombstone of its import key. True for any existing row, false for an unknown id.
    remove(id, { hard = false } = {}) {
      if (hard) {
        const erased = write(() => {
          const row = one('SELECT import_id FROM observations WHERE id = ?', id)
          if (!row) return false
          if (row.import_id) run('INSERT OR IGNORE INTO import_tombstones (import_id, deleted_at) VALUES (?, ?)', row.import_id, stamp())
          run('DELETE FROM observation_versions WHERE observation_id = ?', id)
          run('DELETE FROM memory_relations WHERE source_id = ? OR target_id = ?', id, id)
          run('DELETE FROM observations WHERE id = ?', id)
          return true
        })
        if (erased) scrub('observations_fts')
        return erased
      }
      return write(() => run('UPDATE observations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', stamp(), id).changes > 0)
    },

    get(id, { history = false } = {}) {
      const row = present(one('SELECT * FROM observations WHERE id = ? AND deleted_at IS NULL', id))
      if (row) row.marks = marksFor([id]).get(id)
      if (row && history) row.versions = all('SELECT * FROM observation_versions WHERE observation_id = ? ORDER BY id', id)
      return row
    },

    // search: exact topic_key first for a query with "/", then trigram FTS (terms quoted, ANDed or,
    // with any, ORed); a term under 3 characters switches to an escaped LIKE scan.
    // shortcut: LIKE scan is unranked (newest first) and reads the table, fine for one repository's notes, add an index if it grows past tens of thousands of rows.
    search(query, { type, limit = SEARCH_DEFAULT, any = false } = {}) {
      const max = Math.min(SEARCH_MAX, Math.max(1, Math.trunc(Number(limit)) || SEARCH_DEFAULT))
      const text = String(query ?? '').trim()
      const terms = queryTerms(text)
      const typeSql = type ? ' AND o.type = ?' : ''
      const typeArgs = type ? [type] : []
      const columns = SEARCH_COLUMNS
      let rows = []
      if (text.includes('/')) {
        rows = all(`SELECT ${columns} FROM observations o WHERE o.deleted_at IS NULL AND o.topic_key IN (?, ?)${typeSql} ORDER BY o.id DESC`, text, normalizeTopicKey(text), ...typeArgs)
      }
      if (terms.length > 0 && rows.length < max) {
        const seen = new Set(rows.map((r) => r.id))
        let found
        if (hasShortTerm(terms)) {
          const group = "(o.title LIKE ? ESCAPE '\\' OR o.content LIKE ? ESCAPE '\\' OR o.type LIKE ? ESCAPE '\\' OR o.topic_key LIKE ? ESCAPE '\\')"
          const patterns = terms.flatMap((t) => Array(4).fill(likePattern(t)))
          found = all(`SELECT ${columns} FROM observations o WHERE o.deleted_at IS NULL AND (${terms.map(() => group).join(any ? ' OR ' : ' AND ')})${typeSql} ORDER BY o.type = 'passive', o.updated_at DESC, o.id DESC LIMIT ?`, ...patterns, ...typeArgs, SEARCH_MAX)
        } else {
          const match = ftsQuoted(terms, any)
          // bm25 is negative (lower ranks first), so the passive weight below 1 pushes passive rows down.
          const rank = `bm25(observations_fts, 5.0, 1.0, 0.0, 3.0) * (CASE o.type WHEN 'passive' THEN ${PASSIVE_WEIGHT} ELSE 1.0 END) * (1.0 + ${PINNED_BOOST} * o.pinned + 0.06 * (1.0 / (1.0 + MAX(0.0, julianday(?) - julianday(o.last_seen_at)) / 30.0)) + 0.04 * ((o.revision_count + o.duplicate_count) / (o.revision_count + o.duplicate_count + 4.0)))`
          found = all(`SELECT ${columns} FROM observations_fts f JOIN observations o ON o.id = f.rowid WHERE observations_fts MATCH ? AND o.deleted_at IS NULL${typeSql} ORDER BY ${rank} ASC, o.id ASC LIMIT ?`, match, ...typeArgs, stamp(), SEARCH_MAX)
        }
        rows = rows.concat(found.filter((r) => !seen.has(r.id)))
      }
      const shown = rows.slice(0, max)
      const marks = marksFor(shown.map((r) => r.id))
      return shown.map(({ review_after, truncated, pinned, ...rest }) => present({ ...rest, pinned: Boolean(pinned), truncated: Boolean(truncated), review_after, marks: marks.get(rest.id) }))
    },

    // judge sets the verdict of one pending (or earlier judged) relation by its judgment id; re-judging overwrites.
    judge: (judgmentId, relation, opts) => write(() => applyJudgment(judgmentId, relation, opts)),

    // judgeMany applies 1-32 { judgment_id, relation, reason?, evidence?, confidence? } verdicts all or nothing.
    judgeMany(items) {
      if (!Array.isArray(items) || items.length < 1 || items.length > JUDGE_MANY_MAX) throw new Error(`judge-many needs a JSON array of 1 to ${JUDGE_MANY_MAX} items`)
      return write(() => {
        items.forEach((item, i) => {
          try {
            if (item === null || typeof item !== 'object' || typeof item.judgment_id !== 'string' || item.judgment_id === '') throw new Error('judgment_id is required')
            applyJudgment(item.judgment_id, item.relation, item)
          } catch (error) {
            throw new Error(`item ${i + 1}: ${error.message}`)
          }
        })
        return items.length
      })
    },

    // compare records an agent verdict for any pair of existing observations, creating or updating the pair's relation (a supersedes b).
    compare(a, b, relation, { confidence, reasoning } = {}) {
      if (confidence === undefined || confidence === null) throw new Error('confidence is required')
      const c = checkVerdict(relation, confidence)
      if (a === b) throw new Error('compare needs two different observations')
      return write(() => {
        for (const id of [a, b]) if (!one('SELECT 1 AS found FROM observations WHERE id = ?', id)) throw new Error(`observation #${id} not found`)
        const at = stamp()
        const pair = one('SELECT id FROM memory_relations WHERE min(source_id, target_id) = ? AND max(source_id, target_id) = ?', Math.min(a, b), Math.max(a, b))
        if (pair) run("UPDATE memory_relations SET source_id = ?, target_id = ?, relation = ?, status = 'judged', reason = ?, evidence = NULL, confidence = ?, marked_by = 'agent', updated_at = ? WHERE id = ?", a, b, relation, text(reasoning), c, at, pair.id)
        else run("INSERT INTO memory_relations (id, source_id, target_id, relation, status, reason, confidence, marked_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'judged', ?, ?, 'agent', ?, ?)", relationId(), a, b, relation, text(reasoning), c, at, at)
        return { source_id: a, target_id: b, relation }
      })
    },

    // consolidate merges live observations into one. Without confirm it only previews: the sources and a fingerprint
    // (sha256 over the sorted sources' id, updated_at, and content, plus the new title, content, type, and topic key). With confirm equal
    // to that fingerprint, one transaction inserts the merged row (no upsert, dedup, or candidates), soft-deletes the
    // sources, and records a judged supersedes relation from the new row to each source.
    consolidate(ids, { title, content, type = 'manual', topic_key = null, confirm } = {}) {
      if (!Array.isArray(ids) || ids.length < 2) throw new Error('consolidate needs at least 2 observation ids')
      for (const id of ids) if (ids.indexOf(id) !== ids.lastIndexOf(id)) throw new Error(`duplicate id #${id}`)
      const cleanTitle = clean(title, 'title')
      const body = capContent(clean(content, 'content'))
      const key = normalizeTopicKey(topic_key) || null
      const sorted = [...ids].sort((x, y) => x - y)
      const sources = () => sorted.map((id) => {
        const row = one('SELECT id, type, title, content, updated_at FROM observations WHERE id = ? AND deleted_at IS NULL', id)
        if (!row) throw new Error(`observation #${id} not found`)
        return row
      })
      const fingerprint = (rows) => createHash('sha256').update(JSON.stringify([rows.map((r) => [r.id, r.updated_at, r.content]), cleanTitle, body, type, key])).digest('hex')
      if (confirm === undefined) {
        const rows = sources()
        return { sources: rows.map(({ id, type: t, title: ti }) => ({ id, type: t, title: ti })), title: cleanTitle, fingerprint: fingerprint(rows) }
      }
      return write(() => {
        if (fingerprint(sources()) !== confirm) throw new Error('the fingerprint no longer matches: a source changed or was deleted, or the title or content differ; run the preview again')
        const at = stamp()
        const { lastInsertRowid } = run('INSERT INTO observations (session_id, type, title, content, topic_key, normalized_hash, last_seen_at, review_after, created_at, updated_at) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)', type, cleanTitle, body, key, normalizedHash(body), at, reviewAfter(type, at), at, at)
        const id = Number(lastInsertRowid)
        for (const s of sorted) {
          run('UPDATE observations SET deleted_at = ? WHERE id = ?', at, s)
          run("INSERT INTO memory_relations (id, source_id, target_id, relation, status, reason, marked_by, created_at, updated_at) VALUES (?, ?, ?, 'supersedes', 'judged', 'consolidated', 'agent', ?, ?)", relationId(), id, s, at, at)
        }
        return { id, sources: sorted }
      })
    },

    // observationsWhere: live bugfix and decision observations whose `Where:` line names a path equal to
    // one of `paths` or a directory holding one; injection-looking rows are dropped, newest first.
    // shortcut: scans every live bugfix/decision row instead of an FTS pre-filter, fine for one repository's notes, add the trigram pre-filter if it grows large.
    observationsWhere(paths) {
      const hit = (named) => paths.some((p) => p === named || p.startsWith(`${named.replace(/\/+$/, '')}/`))
      return all("SELECT id, type, title, content FROM observations WHERE deleted_at IS NULL AND type IN ('bugfix', 'decision') AND content LIKE '%Where:%' ORDER BY updated_at DESC, id DESC")
        .filter((o) => !injects(o.title) && !injects(o.content) && whereTokens(o.content).some(hit))
    },

    // staleWhere lists live observations (any type) whose `Where:` line names a repository-relative path
    // missing from the work tree of cwd, with the missing paths; read-only, oldest id first.
    // shortcut: a token counts as a path only with a `/` or a file extension, so a bare root file such as `Makefile` is not checked.
    staleWhere(cwd) {
      const root = git(cwd, ['rev-parse', '--show-toplevel']).toString('utf8').trim()
      const missingOf = (content) => [...new Set(whereTokens(content).map((t) => t.replace(/:\d+(-\d+)?$/, '')).filter((t) => /[/]|\.\w+$/.test(t) && !/^[/~]|[*?[\]{}]|(^|\/)\.\.(\/|$)/.test(t)))].filter((t) => !existsSync(join(root, t)))
      return all("SELECT id, type, title, content FROM observations WHERE deleted_at IS NULL AND content LIKE '%Where:%' ORDER BY id")
        .map((o) => ({ id: o.id, type: o.type, title: o.title, missing: missingOf(o.content) }))
        .filter((o) => o.missing.length)
    },

    // context renders the session-start text: recent sessions, prompts, and observations.
    context() {
      const sessions = all('SELECT s.id, s.started_at, s.summary, (SELECT count(*) FROM observations o WHERE o.session_id = s.id AND o.deleted_at IS NULL) AS n FROM sessions s WHERE s.summary IS NOT NULL OR EXISTS (SELECT 1 FROM observations o WHERE o.session_id = s.id AND o.deleted_at IS NULL) ORDER BY s.started_at DESC, s.rowid DESC LIMIT 5').map((s) => (injects(s.summary) ? { ...s, summary: null } : s))
      const prompts = all('SELECT content, created_at FROM user_prompts ORDER BY id DESC LIMIT 10').filter((p) => !injects(p.content))
      const pinned = all('SELECT type, title, content FROM observations WHERE deleted_at IS NULL AND pinned = 1 ORDER BY created_at DESC, id DESC LIMIT ?', PINNED_MAX).filter((o) => !injects(o.title) && !injects(o.content))
      // Passive rows are capped apart so agent saves are not crowded out (S1 of odd/tasks/memory-engram-parity.md).
      const recent = (passive, n) => all(`SELECT type, title, content FROM observations WHERE deleted_at IS NULL AND pinned = 0 AND type ${passive ? '=' : '!='} 'passive' ORDER BY updated_at DESC, id DESC LIMIT ?`, n).filter((o) => !injects(o.title) && !injects(o.content))
      const observations = recent(false, 20)
      const learnings = recent(true, LEARNINGS_MAX)
      if (sessions.length + prompts.length + pinned.length + observations.length + learnings.length === 0) return ''
      let out = '## Memory from Previous Sessions\n\n'
      if (sessions.length) {
        out += '### Recent Sessions\n'
        for (const s of sessions) out += `- **${s.id}** (${s.started_at})${s.summary ? `: ${flat(s.summary, 200)}` : ''} [${s.n} observations]\n`
        out += '\n'
      }
      if (prompts.length) {
        out += '### Recent User Prompts\n'
        for (const p of prompts) out += `- ${p.created_at}: ${flat(p.content, 200)}\n`
        out += '\n'
      }
      if (pinned.length) {
        out += '### Pinned\n'
        for (const o of pinned) out += `- [${o.type}] **${flat(o.title, Infinity)}**\n`
        out += '\n'
      }
      if (observations.length) {
        out += '### Recent Observations\n'
        for (const o of observations) out += `- [${o.type}] **${flat(o.title, Infinity)}**\n`
        out += '\n'
      }
      if (learnings.length) {
        out += '### Recent Learnings\n'
        for (const o of learnings) out += `- [${o.type}] **${flat(o.title, Infinity)}**\n`
        out += '\n'
      }
      const pending = one(`SELECT count(*) AS n FROM memory_relations r JOIN observations s ON s.id = r.source_id AND s.deleted_at IS NULL JOIN observations t ON t.id = r.target_id AND t.deleted_at IS NULL WHERE r.status = 'pending'`).n
      if (pending > 0) out += `Relations: ${pending} pending judgment; list them with construct-memory relations pending.\n`
      if (Buffer.byteLength(out) <= CONTEXT_MAX_BYTES) return out
      return cutBytes(out, CONTEXT_MAX_BYTES - Buffer.byteLength(CONTEXT_MARKER)) + CONTEXT_MARKER
    },

    startSession(id) {
      write(() => run('INSERT OR IGNORE INTO sessions (id, started_at) VALUES (?, ?)', id, stamp()))
    },

    endSession(id, summary) {
      write(() => {
        const at = stamp()
        run('INSERT OR IGNORE INTO sessions (id, started_at) VALUES (?, ?)', id, at)
        run('UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ?', at, summary == null ? null : filterLines(stripPrivate(summary)), id)
      })
    },

    // closeSession sets ended_at once and leaves the summary alone (the SessionEnd hook).
    closeSession(id) {
      write(() => {
        const at = stamp()
        run('INSERT OR IGNORE INTO sessions (id, started_at) VALUES (?, ?)', id, at)
        run('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL', at, id)
      })
    },

    addPrompt(sessionId, content) {
      write(() => run('INSERT INTO user_prompts (session_id, content, created_at) VALUES (?, ?, ?)', sessionId, filterLines(stripPrivate(content)), stamp()))
    },

    // pendingRelations lists pending relations whose two observations are live, newest first (limit default 20, max 100).
    pendingRelations({ limit } = {}) {
      const n = Math.min(PROMPTS_MAX, Math.max(1, Math.floor(Number(limit)) || PROMPTS_DEFAULT))
      return all(`SELECT r.id AS judgment_id, s.id AS sid, s.type AS stype, s.title AS stitle, t.id AS tid, t.type AS ttype, t.title AS ttitle, r.created_at FROM memory_relations r JOIN observations s ON s.id = r.source_id AND s.deleted_at IS NULL JOIN observations t ON t.id = r.target_id AND t.deleted_at IS NULL WHERE r.status = 'pending' ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?`, n).map((r) => ({ judgment_id: r.judgment_id, source: { id: r.sid, type: r.stype, title: r.stitle }, target: { id: r.tid, type: r.ttype, title: r.ttitle }, created_at: r.created_at }))
    },

    // prompts lists stored prompts, newest first (limit default 20, max 100).
    // With search, only prompts matching every term: trigram FTS (terms quoted), or an escaped LIKE scan when a term is under 3 characters.
    prompts({ limit, search } = {}) {
      const n = Math.min(PROMPTS_MAX, Math.max(1, Math.floor(Number(limit)) || PROMPTS_DEFAULT))
      const terms = queryTerms(search)
      if (search !== undefined && terms.length === 0) throw new Error('a search query is required')
      if (terms.length === 0) return all('SELECT id, session_id, created_at, content FROM user_prompts ORDER BY id DESC LIMIT ?', n)
      if (hasShortTerm(terms)) return all(`SELECT id, session_id, created_at, content FROM user_prompts WHERE ${terms.map(() => "content LIKE ? ESCAPE '\\'").join(' AND ')} ORDER BY id DESC LIMIT ?`, ...terms.map(likePattern), n)
      return all('SELECT p.id, p.session_id, p.created_at, p.content FROM prompts_fts f JOIN user_prompts p ON p.id = f.rowid WHERE prompts_fts MATCH ? ORDER BY bm25(prompts_fts), p.id DESC LIMIT ?', ftsQuoted(terms, false), n)
    },

    // deletePrompt hard-deletes one prompt (the trigger drops its FTS entry); an imported one leaves a
    // tombstone of its import key so a re-import does not bring it back. False for an unknown id.
    deletePrompt(id) {
      const erased = write(() => {
        const row = one('SELECT import_id FROM user_prompts WHERE id = ?', id)
        if (!row) return false
        if (row.import_id) run('INSERT OR IGNORE INTO import_tombstones (import_id, deleted_at) VALUES (?, ?)', row.import_id, stamp())
        run('DELETE FROM user_prompts WHERE id = ?', id)
        return true
      })
      if (erased) scrub('prompts_fts')
      return erased
    },

    suggestTopicKey,

    // pin and unpin set the pinned flag of a live observation; false for an unknown or deleted id.
    pin: (id, pinned = true) => write(() => run('UPDATE observations SET pinned = ? WHERE id = ? AND deleted_at IS NULL', pinned ? 1 : 0, id).changes > 0),

    // timeline returns the live observation `id` with up to `before` older and `after` newer live
    // observations of its session (both oldest first), or null for an unknown or deleted id. Observations
    // saved without a session count as one session of their own, as engram's manual saves do.
    timeline(id, { before, after } = {}) {
      const side = (n) => (Math.trunc(Number(n)) > 0 ? Math.trunc(Number(n)) : TIMELINE_DEFAULT)
      const focus = one(`SELECT ${SEARCH_COLUMNS}, o.session_id FROM observations o WHERE o.id = ? AND o.deleted_at IS NULL`, id)
      if (!focus) return null
      const neighbours = (cmp, order, n) => all(`SELECT ${SEARCH_COLUMNS} FROM observations o WHERE o.session_id IS ? AND o.id ${cmp} ? AND o.deleted_at IS NULL ORDER BY o.id ${order} LIMIT ?`, focus.session_id, id, n)
      const shape = ({ review_after, truncated, pinned, ...rest }) => present({ ...rest, pinned: Boolean(pinned), truncated: Boolean(truncated), review_after })
      return {
        session_id: focus.session_id,
        total: one('SELECT count(*) AS n FROM observations WHERE session_id IS ? AND deleted_at IS NULL', focus.session_id).n,
        before: neighbours('<', 'DESC', side(before)).reverse().map(shape),
        focus: shape(focus),
        after: neighbours('>', 'ASC', side(after)).map(shape),
      }
    },

    // stats counts what the store holds; size is the database's pages in bytes.
    stats({ session } = {}) {
      const n = (sql, ...args) => one(sql, ...args).n
      return {
        ...(session === undefined ? {} : { session_saves: n('SELECT count(*) AS n FROM observations WHERE deleted_at IS NULL AND session_id = ?', String(session)) }),
        pending_relations: n("SELECT count(*) AS n FROM memory_relations WHERE status = 'pending'"),
        last_save_at: one('SELECT max(updated_at) AS t FROM observations WHERE deleted_at IS NULL').t ?? null,
        observations: n('SELECT count(*) AS n FROM observations WHERE deleted_at IS NULL'),
        deleted: n('SELECT count(*) AS n FROM observations WHERE deleted_at IS NOT NULL'),
        needing_review: n('SELECT count(*) AS n FROM observations WHERE deleted_at IS NULL AND review_after IS NOT NULL AND review_after <= ?', stamp()),
        pinned: n('SELECT count(*) AS n FROM observations WHERE deleted_at IS NULL AND pinned = 1'),
        sessions: n('SELECT count(*) AS n FROM sessions'),
        prompts: n('SELECT count(*) AS n FROM user_prompts'),
        bytes: n('SELECT page_count * page_size AS n FROM pragma_page_count, pragma_page_size'),
      }
    },

    // doctor runs read-only health checks and returns [{ check, ok, detail }]; it repairs nothing.
    doctor() {
      const list = []
      const check = (name, fn) => {
        try {
          const detail = fn()
          list.push({ check: name, ok: detail === true || detail === undefined, detail: detail === true || detail === undefined ? 'ok' : detail })
        } catch (error) {
          list.push({ check: name, ok: false, detail: String(error.message).replace(/\s+/g, ' ') })
        }
      }
      // The FTS5 integrity-check command (rank 1: index against the content table) only reads; the transaction is rolled back anyway.
      const fts = (table) => () => {
        db.exec('BEGIN')
        try {
          db.exec(`INSERT INTO ${table}(${table}, rank) VALUES('integrity-check', 1)`)
        } catch (error) {
          return `${error.message}; the index no longer matches the data, rebuild it (INSERT INTO ${table}(${table}) VALUES('rebuild')) or restore from an export`
        } finally {
          db.exec('ROLLBACK')
        }
      }
      check('schema', () => {
        const v = one('PRAGMA user_version').user_version
        if (v !== SCHEMA_VERSION) return `schema ${v}, this construct knows ${SCHEMA_VERSION}; update the plugin`
      })
      check('integrity', () => {
        const rows = all('PRAGMA integrity_check').map((r) => r.integrity_check)
        if (rows.join() !== 'ok') return `${rows.slice(0, 3).join('; ')}; export what you can and start a new database`
      })
      check('fts observations', fts('observations_fts'))
      check('fts prompts', fts('prompts_fts'))
      check('orphaned versions', () => {
        const n = one('SELECT count(*) AS n FROM observation_versions WHERE observation_id NOT IN (SELECT id FROM observations)').n
        if (n) return `${n} versions have no observation; delete them from observation_versions`
      })
      check('orphaned relations', () => {
        const n = one('SELECT count(*) AS n FROM memory_relations WHERE source_id NOT IN (SELECT id FROM observations) OR target_id NOT IN (SELECT id FROM observations)').n
        if (n) return `${n} relations point at an erased observation; delete them from memory_relations`
      })
      check('wal', () => {
        const mode = one('PRAGMA journal_mode').journal_mode
        if (mode !== 'wal') return `journal mode is ${mode}, expected wal; run PRAGMA journal_mode = WAL`
      })
      check('db id', () => {
        if (!one("SELECT value FROM meta WHERE key = 'db_id'")) return 'the meta table has no db_id; exports would get unstable keys'
      })
      check('writable', () => {
        for (const target of [path, dirname(path)]) {
          try {
            accessSync(target, constants.W_OK)
          } catch {
            return `${target} is not writable; fix its permissions`
          }
        }
      })
      return list
    },

    // needingReview lists live observations whose review_after has passed, oldest first.
    needingReview() {
      return all('SELECT * FROM observations WHERE deleted_at IS NULL AND review_after IS NOT NULL AND review_after <= ? ORDER BY review_after, id', stamp()).map(present)
    },

    // markReviewed pushes review_after out by the type's period; true when a live row exists.
    markReviewed(id) {
      return write(() => {
        const row = one('SELECT type FROM observations WHERE id = ? AND deleted_at IS NULL', id)
        if (!row) return false
        run('UPDATE observations SET review_after = ? WHERE id = ?', reviewAfter(row.type, stamp()), id)
        return true
      })
    },

    // lastSaveAt is the time of the newest save or update, or null.
    lastSaveAt: () => one('SELECT max(updated_at) AS t FROM observations').t,

    // similarPassive is true when a live passive observation shares at least PASSIVE_SIMILAR of the words
    // (Jaccard) of text (S4 of odd/tasks/memory-engram-parity.md). Candidates come from FTS, the best 50.
    similarPassive(text) {
      const words = wordSet(text)
      if (words.size === 0) return false
      const rows = all(`SELECT o.content FROM observations_fts f JOIN observations o ON o.id = f.rowid WHERE observations_fts MATCH ? AND o.deleted_at IS NULL AND o.type = 'passive'
        ORDER BY bm25(observations_fts) LIMIT 50`, ftsQuoted([...words], true))
      return rows.some(({ content }) => {
        const other = wordSet(content)
        const shared = [...words].filter((w) => other.has(w)).length
        return shared / (words.size + other.size - shared) >= PASSIVE_SIMILAR
      })
    },

    // hasHash is true when a live (not soft-deleted) observation has this normalized_hash.
    hasHash: (hash) => Boolean(one('SELECT 1 AS found FROM observations WHERE normalized_hash = ? AND deleted_at IS NULL', hash)),

    // importExport loads one project of an engram export (versions 0.1.0 and 0.2.0) as history, in
    // one transaction: original timestamps kept, no dedup or topic_key upsert, redaction and the cap
    // still applied. Each row's sync_id (or id) is stored, so a re-run skips what is already in.
    importExport(data, { project } = {}) {
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an engram export')
      if (!EXPORT_VERSIONS.includes(data.version)) throw new Error(`unsupported export version ${JSON.stringify(data.version)} (accepted: ${EXPORT_VERSIONS.join(', ')})`)
      const list = (key) => {
        if (data[key] === undefined) return []
        if (!Array.isArray(data[key])) throw new Error(`not an engram export: ${key} is not a list`)
        return data[key]
      }
      const sessions = list('sessions')
      const observations = list('observations')
      const prompts = list('prompts')
      const projectOfSession = new Map(sessions.map((s) => [s.id, projectName(s.project)]))
      const projectOf = (row) => projectName(row.project) || projectOfSession.get(row.session_id) || ''
      const projects = [...new Set([...sessions.map((s) => projectName(s.project)), ...observations.map(projectOf), ...prompts.map(projectOf)])].filter(Boolean).sort()
      let chosen = projectName(project)
      if (chosen === '' && projects.length > 1) throw new Error(`the export holds ${projects.length} projects; pick one with --project: ${projects.join(', ')}`)
      if (chosen === '') chosen = projects[0] ?? ''
      else if (!projects.includes(chosen)) throw new Error(`project ${JSON.stringify(chosen)} is not in the export; it holds: ${projects.join(', ') || 'nothing'}`)
      const idOf = (kind, row) => (row.sync_id ? String(row.sync_id) : `${kind}:${chosen}:${row.id}`)
      const counts = { observations: 0, sessions: 0, prompts: 0, skipped: 0, deleted: 0 }
      const relations = list('relations')
      if (relations.length) counts.relations = 0 // only an export that carries relations reports them
      const ownPrefix = `cm-${api.dbId}-` // rows exported from this database already live here
      return write(() => {
        for (const s of sessions.filter((r) => projectName(r.project) === chosen)) {
          const { changes } = run('INSERT OR IGNORE INTO sessions (id, started_at, ended_at, summary) VALUES (?, ?, ?, ?)', s.id, s.started_at, s.ended_at ?? null, s.summary ? filterLines(stripPrivate(s.summary)) : null)
          if (changes) counts.sessions++
          else counts.skipped++
        }
        for (const o of observations.filter((r) => projectOf(r) === chosen)) {
          if (o.deleted_at) {
            counts.deleted++
            continue
          }
          const importId = idOf('obs', o)
          if (importId.startsWith(ownPrefix)) {
            counts.skipped++
            continue
          }
          if (one('SELECT 1 AS found FROM observations WHERE import_id = ? UNION SELECT 1 FROM import_tombstones WHERE import_id = ?', importId, importId)) {
            counts.skipped++
            continue
          }
          if (injects(stripPrivate(o.title)) || injects(stripPrivate(o.content))) {
            counts.skipped++
            continue
          }
          const title = clean(o.title, 'title')
          const body = capContent(clean(o.content, 'content'))
          const type = o.type || 'manual'
          run('INSERT INTO observations (session_id, type, title, content, topic_key, normalized_hash, revision_count, duplicate_count, last_seen_at, review_after, created_at, updated_at, import_id, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            o.session_id || null, type, title, body, normalizeTopicKey(o.topic_key) || null, normalizedHash(body), o.revision_count ?? 0, o.duplicate_count ?? 0, o.last_seen_at || o.updated_at || o.created_at, reviewAfter(type, isoTime(o.created_at)), o.created_at, o.updated_at || o.created_at, importId, o.pinned === true || o.pinned === 1 ? 1 : 0)
          counts.observations++
        }
        for (const p of prompts.filter((r) => projectOf(r) === chosen)) {
          const importId = idOf('prompt', p)
          if (importId.startsWith(ownPrefix)) {
            counts.skipped++
            continue
          }
          if (one('SELECT 1 AS found FROM user_prompts WHERE import_id = ? UNION SELECT 1 FROM import_tombstones WHERE import_id = ?', importId, importId)) {
            counts.skipped++
            continue
          }
          if (stripPrivate(p.content).trim() === '') clean(p.content, 'content') // throws: content is required
          run('INSERT INTO user_prompts (session_id, content, created_at, import_id) VALUES (?, ?, ?, ?)', p.session_id, filterLines(stripPrivate(p.content)), p.created_at, importId)
          counts.prompts++
        }
        // A relation's ends are export keys: an imported row's import_id, or this database's own cm-<dbid>-obs-<id>.
        const own = `${ownPrefix}obs-`
        const local = (key) => (String(key).startsWith(own) ? one('SELECT id FROM observations WHERE id = ? AND deleted_at IS NULL', Number(String(key).slice(own.length))) : one('SELECT id FROM observations WHERE import_id = ? AND deleted_at IS NULL', String(key)))?.id
        for (const r of relations) {
          const source = local(r.source)
          const target = local(r.target)
          if (source === undefined || target === undefined || source === target || !RELATIONS.includes(r.relation === 'pending' ? 'related' : r.relation)) continue
          const at = stamp()
          const { changes } = run('INSERT OR IGNORE INTO memory_relations (id, source_id, target_id, relation, status, reason, evidence, confidence, marked_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            relationId(), source, target, r.relation, r.status === 'judged' ? 'judged' : 'pending', text(r.reason), text(r.evidence), Number.isFinite(r.confidence) && r.confidence >= 0 && r.confidence <= 1 ? r.confidence : null, r.marked_by === 'agent' ? 'agent' : 'save', r.created_at || at, r.updated_at || at)
          counts.relations += changes
        }
        return counts
      })
    },

    // exportData returns every live observation, session, and prompt in the shape importExport reads,
    // under one project named after the repository directory. A row that came from an import keeps its
    // import key as sync_id; the others get cm-<dbid>-obs-<id> / cm-<dbid>-prompt-<id>.
    exportData() {
      const project = repoName
      return {
        version: '0.2.0',
        exported_at: stamp(),
        sessions: all('SELECT id, started_at, ended_at, summary FROM sessions ORDER BY id').map((s) => ({ ...s, project })),
        observations: all('SELECT id, import_id, session_id, type, title, content, topic_key, revision_count, duplicate_count, last_seen_at, created_at, updated_at, pinned FROM observations WHERE deleted_at IS NULL ORDER BY id').map(({ import_id, pinned, ...o }) => ({ ...o, pinned: pinned === 1, sync_id: import_id ?? `cm-${api.dbId}-obs-${o.id}`, project, scope: 'project' })),
        prompts: all('SELECT id, import_id, session_id, content, created_at FROM user_prompts ORDER BY id').map(({ import_id, ...p }) => ({ ...p, sync_id: import_id ?? `cm-${api.dbId}-prompt-${p.id}`, project })),
        // Relations whose two ends are both live (so both exported), keyed like the observations' sync_id.
        relations: all(`SELECT s.import_id AS si, r.source_id, t.import_id AS ti, r.target_id, r.relation, r.status, r.reason, r.evidence, r.confidence, r.marked_by, r.created_at, r.updated_at
          FROM memory_relations r JOIN observations s ON s.id = r.source_id AND s.deleted_at IS NULL JOIN observations t ON t.id = r.target_id AND t.deleted_at IS NULL ORDER BY r.rowid`)
          .map(({ si, source_id, ti, target_id, ...r }) => ({ source: si ?? `cm-${api.dbId}-obs-${source_id}`, target: ti ?? `cm-${api.dbId}-obs-${target_id}`, ...r })),
      }
    },

    close: () => db.close(),
  }
  return api
}
