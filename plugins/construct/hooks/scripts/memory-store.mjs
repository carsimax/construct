// The per-repository memory store (S1-S4 of odd/tasks/construct-memory.md): one SQLite + FTS5
// database under the git common dir (construct-memory/memory.db), shared by every worktree.
// Imported by the construct-memory CLI and the memory hooks; it prints nothing itself.
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
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
// Initial review prompts in months per type, not deadlines; other types have none.
const REVIEW_MONTHS = { decision: 6, policy: 12, preference: 3, config: 3, discovery: 6, pattern: 6, architecture: 12, bugfix: 12 }

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
  import_id TEXT
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
CREATE TABLE IF NOT EXISTS prompt_tombstones (
  import_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL
);
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

const stripPrivate = (text) => String(text ?? '').replace(/<private>[\s\S]*?<\/private>/gi, '[REDACTED]')

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
const reviewAfter = (type, from) => (type in REVIEW_MONTHS ? addMonths(from, REVIEW_MONTHS[type]) : null)

// openMemory returns the store of the repository containing cwd, or null outside one.
// `now` is the clock (tests move it). A database written by a newer schema throws.
export function openMemory(cwd, { now = () => new Date() } = {}) {
  let dir
  try {
    const common = git(cwd, ['rev-parse', '--git-common-dir']).toString('utf8').trim()
    dir = join(isAbsolute(common) ? common : join(cwd, common), 'construct-memory')
  } catch {
    return null
  }
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'memory.db')
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 5000')
  const store = makeStore(db, path, now)
  try {
    store.init()
  } catch (error) {
    db.close()
    throw error
  }
  return store
}

function makeStore(db, path, now) {
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
    return text
  }

  const api = {
    path,

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
      })
    },

    // save inserts, upserts by topic_key (versioning the old state), or counts a duplicate.
    save({ title, content, type = 'manual', topic_key = null, session_id = null }) {
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
          return { id: live.id, action: 'upserted' }
        }
        const since = new Date(now().getTime() - DEDUP_WINDOW_MS).toISOString()
        const dup = one('SELECT id FROM observations WHERE normalized_hash = ? AND type = ? AND title = ? AND deleted_at IS NULL AND last_seen_at >= ? ORDER BY id DESC LIMIT 1', hash, type, cleanTitle, since)
        if (dup) {
          run('UPDATE observations SET duplicate_count = duplicate_count + 1, last_seen_at = ?, updated_at = ? WHERE id = ?', at, at, dup.id)
          return { id: dup.id, action: 'deduplicated' }
        }
        const { lastInsertRowid } = run('INSERT INTO observations (session_id, type, title, content, topic_key, normalized_hash, last_seen_at, review_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', session_id, type, cleanTitle, body, key, hash, at, reviewAfter(type, at), at, at)
        return { id: Number(lastInsertRowid), action: 'inserted' }
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

    // remove soft-deletes; true when a live row was deleted.
    remove(id) {
      return write(() => run('UPDATE observations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', stamp(), id).changes > 0)
    },

    get(id, { history = false } = {}) {
      const row = present(one('SELECT * FROM observations WHERE id = ? AND deleted_at IS NULL', id))
      if (row && history) row.versions = all('SELECT * FROM observation_versions WHERE observation_id = ? ORDER BY id', id)
      return row
    },

    // search: exact topic_key first for a query with "/", then trigram FTS (terms quoted, ANDed or,
    // with any, ORed); a term under 3 characters switches to an escaped LIKE scan.
    // shortcut: LIKE scan is unranked (newest first) and reads the table, fine for one repository's notes, add an index if it grows past tens of thousands of rows.
    search(query, { type, limit = SEARCH_DEFAULT, any = false } = {}) {
      const max = Math.min(SEARCH_MAX, Math.max(1, Math.trunc(Number(limit)) || SEARCH_DEFAULT))
      const text = String(query ?? '').trim()
      const terms = text.split(/\s+/).map((t) => t.replace(/^"+|"+$/g, '')).filter(Boolean)
      const typeSql = type ? ' AND o.type = ?' : ''
      const typeArgs = type ? [type] : []
      const columns = "o.id, o.type, o.title, o.topic_key, o.created_at, o.updated_at, o.review_after, substr(o.content, 1, 300) AS preview, length(o.content) > 300 AS truncated"
      let rows = []
      if (text.includes('/')) {
        rows = all(`SELECT ${columns} FROM observations o WHERE o.deleted_at IS NULL AND o.topic_key IN (?, ?)${typeSql} ORDER BY o.id DESC`, text, normalizeTopicKey(text), ...typeArgs)
      }
      if (terms.length > 0 && rows.length < max) {
        const seen = new Set(rows.map((r) => r.id))
        let found
        if (terms.some((t) => [...t].length < 3)) {
          const group = "(o.title LIKE ? ESCAPE '\\' OR o.content LIKE ? ESCAPE '\\' OR o.type LIKE ? ESCAPE '\\' OR o.topic_key LIKE ? ESCAPE '\\')"
          const patterns = terms.flatMap((t) => Array(4).fill(`%${t.replace(/[\\%_]/g, '\\$&')}%`))
          found = all(`SELECT ${columns} FROM observations o WHERE o.deleted_at IS NULL AND (${terms.map(() => group).join(any ? ' OR ' : ' AND ')})${typeSql} ORDER BY o.updated_at DESC, o.id DESC LIMIT ?`, ...patterns, ...typeArgs, SEARCH_MAX)
        } else {
          const match = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(any ? ' OR ' : ' AND ')
          const rank = `bm25(observations_fts, 5.0, 1.0, 0.0, 3.0) * (1.0 + 0.06 * (1.0 / (1.0 + MAX(0.0, julianday(?) - julianday(o.last_seen_at)) / 30.0)) + 0.04 * ((o.revision_count + o.duplicate_count) / (o.revision_count + o.duplicate_count + 4.0)))`
          found = all(`SELECT ${columns} FROM observations_fts f JOIN observations o ON o.id = f.rowid WHERE observations_fts MATCH ? AND o.deleted_at IS NULL${typeSql} ORDER BY ${rank} ASC, o.id ASC LIMIT ?`, match, ...typeArgs, stamp(), SEARCH_MAX)
        }
        rows = rows.concat(found.filter((r) => !seen.has(r.id)))
      }
      return rows.slice(0, max).map(({ review_after, truncated, ...rest }) => present({ ...rest, truncated: Boolean(truncated), review_after }))
    },

    // context renders the session-start text: recent sessions, prompts, and observations.
    context() {
      const sessions = all('SELECT s.id, s.started_at, s.summary, (SELECT count(*) FROM observations o WHERE o.session_id = s.id AND o.deleted_at IS NULL) AS n FROM sessions s ORDER BY s.started_at DESC, s.rowid DESC LIMIT 5')
      const prompts = all('SELECT content, created_at FROM user_prompts ORDER BY id DESC LIMIT 10')
      const observations = all('SELECT type, title FROM observations WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 20')
      if (sessions.length + prompts.length + observations.length === 0) return ''
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
      if (observations.length) {
        out += '### Recent Observations\n'
        for (const o of observations) out += `- [${o.type}] **${flat(o.title, Infinity)}**\n`
        out += '\n'
      }
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
        run('UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ?', at, summary == null ? null : stripPrivate(summary), id)
      })
    },

    addPrompt(sessionId, content) {
      write(() => run('INSERT INTO user_prompts (session_id, content, created_at) VALUES (?, ?, ?)', sessionId, stripPrivate(content), stamp()))
    },

    // prompts lists stored prompts, newest first (limit default 20, max 100).
    prompts({ limit } = {}) {
      const n = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 20))
      return all('SELECT id, session_id, created_at, content FROM user_prompts ORDER BY id DESC LIMIT ?', n)
    },

    // deletePrompt hard-deletes one prompt (the trigger drops its FTS entry); an imported one leaves a
    // tombstone of its import key so a re-import does not bring it back. False for an unknown id.
    deletePrompt(id) {
      return write(() => {
        const row = one('SELECT import_id FROM user_prompts WHERE id = ?', id)
        if (!row) return false
        if (row.import_id) run('INSERT OR IGNORE INTO prompt_tombstones (import_id, deleted_at) VALUES (?, ?)', row.import_id, stamp())
        run('DELETE FROM user_prompts WHERE id = ?', id)
        return true
      })
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
      return write(() => {
        for (const s of sessions.filter((r) => projectName(r.project) === chosen)) {
          const { changes } = run('INSERT OR IGNORE INTO sessions (id, started_at, ended_at, summary) VALUES (?, ?, ?, ?)', s.id, s.started_at, s.ended_at ?? null, s.summary ? stripPrivate(s.summary) : null)
          if (changes) counts.sessions++
          else counts.skipped++
        }
        for (const o of observations.filter((r) => projectOf(r) === chosen)) {
          if (o.deleted_at) {
            counts.deleted++
            continue
          }
          const importId = idOf('obs', o)
          if (one('SELECT 1 AS found FROM observations WHERE import_id = ?', importId)) {
            counts.skipped++
            continue
          }
          const title = clean(o.title, 'title')
          const body = capContent(clean(o.content, 'content'))
          const type = o.type || 'manual'
          run('INSERT INTO observations (session_id, type, title, content, topic_key, normalized_hash, revision_count, duplicate_count, last_seen_at, review_after, created_at, updated_at, import_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            o.session_id || null, type, title, body, normalizeTopicKey(o.topic_key) || null, normalizedHash(body), o.revision_count ?? 0, o.duplicate_count ?? 0, o.last_seen_at || o.updated_at || o.created_at, reviewAfter(type, isoTime(o.created_at)), o.created_at, o.updated_at || o.created_at, importId)
          counts.observations++
        }
        for (const p of prompts.filter((r) => projectOf(r) === chosen)) {
          const importId = idOf('prompt', p)
          if (one('SELECT 1 AS found FROM user_prompts WHERE import_id = ? UNION SELECT 1 FROM prompt_tombstones WHERE import_id = ?', importId, importId)) {
            counts.skipped++
            continue
          }
          run('INSERT INTO user_prompts (session_id, content, created_at, import_id) VALUES (?, ?, ?, ?)', p.session_id, clean(p.content, 'content'), p.created_at, importId)
          counts.prompts++
        }
        return counts
      })
    },

    close: () => db.close(),
  }
  return api
}
