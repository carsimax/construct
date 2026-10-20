// The review store lives under the repository's common git directory, so nothing
// is written into the worktree and linked worktrees share it:
//   <git-common-dir>/odd-review/transactions/<lineage>.json   (+ .lock while written)
//   <git-common-dir>/odd-review/receipts/<target hex>.json
// Every write is a temporary file plus rename in the same directory.
import { randomBytes } from 'node:crypto'
import {
  closeSync, existsSync, statSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { git } from '../assess/git.mjs'
import { Refusal } from './errors.mjs'
import { assertLineage } from './identity.mjs'

export const storeDir = (root) => join(resolve(root, git(root, ['rev-parse', '--git-common-dir']).toString().trim()), 'odd-review')

export const transactionPath = (root, lineage) => join(storeDir(root), 'transactions', `${assertLineage(lineage)}.json`)

// receiptPath names the receipt by the hex digest of its target ("sha256:" is
// dropped so the file name is portable).
export const receiptPath = (root, target) => join(storeDir(root), 'receipts', `${target.replace(/^sha256:/, '')}.json`)

export const receiptExists = (root, target) => existsSync(receiptPath(root, target))

function temporaryName(file) {
  const slash = file.lastIndexOf('/')
  return `${file.slice(0, slash + 1)}.${file.slice(slash + 1)}.${randomBytes(6).toString('hex')}.tmp`
}

// atomicWrite replaces file in one rename.
export function atomicWrite(file, text) {
  mkdirSync(join(file, '..'), { recursive: true })
  const temporary = temporaryName(file)
  try {
    writeFileSync(temporary, text, { flag: 'wx' })
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

// atomicCreate publishes file only if it does not exist yet (hard link, which
// fails with EEXIST instead of replacing). Returns false when it already exists.
export function atomicCreate(file, text) {
  mkdirSync(join(file, '..'), { recursive: true })
  const temporary = temporaryName(file)
  try {
    writeFileSync(temporary, text, { flag: 'wx' })
    linkSync(temporary, file)
    return true
  } catch (error) {
    if (error.code === 'EEXIST') return false
    throw error
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function readTransaction(root, lineage) {
  const file = transactionPath(root, lineage)
  if (!existsSync(file)) throw new Refusal('unknown_lineage', `no review transaction ${lineage} in this repository`)
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function writeTransaction(root, transaction) {
  transaction.updated_at = new Date().toISOString()
  atomicWrite(transactionPath(root, transaction.lineage), `${JSON.stringify(transaction, null, 2)}\n`)
}

const EMPTY_LOCK_STALE_MS = 10_000

const processAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

const LOCK_ATTEMPTS = 5

// inspectLock reads the lock and its identity (device, inode, content, mtime), or
// returns null when the holder released it meanwhile (ENOENT).
function inspectLock(lock) {
  // Test-only fault seam: behave as if the holder released between the failed
  // open and the read. It does nothing unless the variable is set.
  if (process.env.ODD_REVIEW_TEST_FAULT === 'release-after-exists') rmSync(lock, { force: true })
  try {
    const stat = statSync(lock)
    const text = readFileSync(lock, 'utf8')
    const holder = Number.parseInt(text, 10)
    return { holder: Number.isInteger(holder) ? holder : null, text, ino: stat.ino, dev: stat.dev, mtimeMs: stat.mtimeMs, ageMs: Date.now() - stat.mtimeMs }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

// reclaimStale removes the lock that was inspected as stale, but only while
// holding the separate <lock>.reclaim lock, which serializes reclaimers, and only
// if the lock still is the very file that was inspected (same device, inode,
// content, and mtime). A live lock created by a winner after the inspection is a
// different file, so it is never removed. It never waits: contention is
// `locked`.
function reclaimStale(lock, seen, locked) {
  const guard = `${lock}.reclaim`
  for (let attempt = 0; ; attempt++) {
    try {
      closeSync(openSync(guard, 'wx'))
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let age
      try {
        age = Date.now() - statSync(guard).mtimeMs
      } catch (statError) {
        if (statError.code === 'ENOENT') continue
        throw statError
      }
      // A reclaim lock left by a crashed reclaimer is removed once, after 10 seconds.
      if (attempt === 0 && age > EMPTY_LOCK_STALE_MS) {
        rmSync(guard, { force: true })
        continue
      }
      throw locked()
    }
  }
  try {
    // Test-only fault seam: a winner replaces the stale lock with a live one
    // after the inspection. It does nothing unless the variable is set.
    if (process.env.ODD_REVIEW_TEST_FAULT === 'reclaim-interleave') {
      rmSync(lock, { force: true })
      writeFileSync(lock, `${process.env.ODD_REVIEW_TEST_LIVE_PID}\n`, { flag: 'wx' })
    }
    const now = inspectLock(lock)
    if (now === null) return // released meanwhile: the next attempt acquires it
    if (now.ino !== seen.ino || now.dev !== seen.dev || now.text !== seen.text || now.mtimeMs !== seen.mtimeMs) throw locked()
    unlinkSync(lock)
  } finally {
    rmSync(guard, { force: true })
  }
}

// withLock runs fn while holding the transaction's lock file. Acquisition is
// open(wx) plus the pid. A second writer is refused. A lock whose process is gone
// (or an empty one older than EMPTY_LOCK_STALE_MS) is reclaimed through
// reclaimStale, which verifies the file's identity under a reclaim lock, so a
// live lock is never removed. A lock released while being inspected is acquired
// on the next of a bounded number of attempts.
export function withLock(root, lineage, fn) {
  const lock = transactionPath(root, lineage).replace(/\.json$/, '.lock')
  const locked = () => new Refusal('transaction_locked', `transaction ${lineage} is being written by another process; try again`)
  mkdirSync(join(lock, '..'), { recursive: true })
  let acquired = false
  for (let attempt = 0; attempt < LOCK_ATTEMPTS && !acquired; attempt++) {
    try {
      const fd = openSync(lock, 'wx')
      writeFileSync(fd, `${process.pid}\n`)
      closeSync(fd)
      acquired = true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const seen = inspectLock(lock)
      if (seen === null) continue
      const stale = seen.holder === null ? seen.ageMs > EMPTY_LOCK_STALE_MS : !processAlive(seen.holder)
      if (!stale) throw locked()
      reclaimStale(lock, seen, locked)
    }
  }
  if (!acquired) throw locked()
  try {
    return fn()
  } finally {
    try {
      unlinkSync(lock)
    } catch {
      // Already gone.
    }
  }
}
