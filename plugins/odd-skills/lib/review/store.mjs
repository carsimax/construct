// The review store lives under the repository's common git directory, so nothing
// is written into the worktree and linked worktrees share it:
//   <git-common-dir>/odd-review/transactions/<lineage>.json   (+ .lock while written)
//   <git-common-dir>/odd-review/receipts/<target hex>.json
// Every write is a temporary file plus rename in the same directory.
import { randomBytes } from 'node:crypto'
import {
  closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync,
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

const processAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

// withLock runs fn while holding the transaction's lock file. A second writer is
// refused; a lock whose process is gone is reclaimed.
export function withLock(root, lineage, fn) {
  const lock = transactionPath(root, lineage).replace(/\.json$/, '.lock')
  mkdirSync(join(lock, '..'), { recursive: true })
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(lock, 'wx')
      writeFileSync(fd, `${process.pid}\n`)
      closeSync(fd)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const holder = Number.parseInt(readFileSync(lock, 'utf8'), 10)
      if (attempt === 0 && Number.isInteger(holder) && !processAlive(holder)) {
        rmSync(lock, { force: true })
        continue
      }
      throw new Refusal('transaction_locked', `transaction ${lineage} is being written by another process; try again`)
    }
  }
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
