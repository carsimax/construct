// Invariants: frozen evidence, capture validation, locking, atomic writes, and a
// worktree that no command ever touches.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, utimesSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  REVIEW_BIN, applyFiles, capture, captureAll, finding, git, highRepo, lensResult, readTransaction, repoFingerprint, review,
  scratchDir, start, storeRoot, transactionFile, write,
} from './helpers.mjs'

const hashOf = (txn, lens = 'review-risk') => txn.subjects[lens]

describe('context', () => {
  const contextOf = (repo, txn, lens = 'review-risk', extra = []) =>
    review(repo, ['context', '--lineage', txn.lineage, '--lens', lens, ...extra])

  test('prints the binding and a block with discovery and every path in manifest order', () => {
    const repo = highRepo()
    const txn = start(repo)
    const { status, stdout } = contextOf(repo, txn)
    assert.equal(status, 0)
    const lines = stdout.split('\n')
    assert.match(lines[0], /^ODD_REVIEW_BINDING \{/)
    const binding = JSON.parse(lines[0].slice('ODD_REVIEW_BINDING '.length))
    assert.equal(binding.subject_hash, hashOf(txn))
    assert.equal(binding.artifact_subject.subject_hash, hashOf(txn))
    assert.equal(binding.artifact_subject.base_tree, txn.base_tree)
    assert.equal(binding.artifact_subject.candidate_tree, txn.candidate_tree)
    assert.deepEqual(binding.artifact_subject.changed_path_manifest, txn.manifest)

    assert.ok(lines.includes('ODD_REVIEW_CONTEXT'))
    assert.ok(lines.includes('ODD_REVIEW_CONTEXT_END'))
    assert.ok(stdout.indexOf('ODD_REVIEW_CONTEXT\n') > stdout.indexOf('ODD_REVIEW_BINDING'))
    assert.ok(stdout.includes('name-status:\nA\tdocs/the guide.md\nA\tscripts/build.sh\n'))
    assert.match(stdout, /numstat:\n20\t0\tdocs\/the guide\.md\n1\t0\tscripts\/build\.sh\n/)

    const entries = [...stdout.matchAll(/^ODD_REVIEW_PATH (\{.*\})$/gm)].map((m) => JSON.parse(m[1]))
    assert.deepEqual(entries, txn.manifest.map((path, index) => ({ index, path })))
  })

  test('each path entry carries the verbatim patch of the frozen trees', () => {
    const repo = highRepo()
    const txn = start(repo)
    const { stdout } = contextOf(repo, txn)
    const patch = git(repo, 'diff', txn.base_tree, txn.candidate_tree, '--', 'scripts/build.sh')
    assert.ok(patch.includes('+echo hi'))
    assert.ok(stdout.includes(patch))
    assert.match(stdout, /ODD_REVIEW_PATH_END 1\n/)
  })

  test('the evidence comes from the frozen trees, not the live worktree', () => {
    const repo = highRepo()
    const txn = start(repo)
    const before = contextOf(repo, txn).stdout
    applyFiles(repo, { 'scripts/build.sh': 'echo changed after start\n' })
    assert.equal(contextOf(repo, txn).stdout, before)
  })

  test('user git config and attributes cannot alter the patches', () => {
    const repo = highRepo({ '.gitattributes': '*.sh diff=none -diff\n' })
    git(repo, 'config', 'diff.noprefix', 'true')
    const txn = start(repo)
    const { stdout } = contextOf(repo, txn)
    assert.match(stdout, /diff --git a\/scripts\/build\.sh b\/scripts\/build\.sh/)
    assert.ok(stdout.includes('+echo hi'))
  })

  test('a context above the byte budget is refused with the smaller-slice remedy', () => {
    const repo = highRepo()
    const txn = start(repo)
    const refused = contextOf(repo, txn, 'review-risk', ['--max-bytes', '200'])
    assert.equal(refused.status, 1)
    assert.equal(refused.error.code, 'context_budget_exceeded')
    assert.match(refused.error.message, /smaller/)
    assert.equal(refused.stdout, '')
  })

  test('the default budget allows a normal change', () => {
    const repo = highRepo()
    assert.equal(contextOf(repo, start(repo)).status, 0)
  })

  test('a lens that was not selected has no context', () => {
    const repo = highRepo()
    const txn = start(repo)
    assert.equal(contextOf(repo, txn, 'review-resilience').error.code, 'lens_not_selected')
  })

  test('refuter and validator contexts are only served in their states', () => {
    const repo = highRepo()
    const txn = start(repo)
    assert.equal(contextOf(repo, txn, 'review-refuter').error.code, 'wrong_state')
    assert.equal(contextOf(repo, txn, 'review-validator').error.code, 'wrong_state')
  })
})

describe('capture validation', () => {
  const setup = () => {
    const repo = highRepo()
    const txn = start(repo)
    return { repo, txn, ok: lensResult(hashOf(txn), txn.manifest) }
  }
  const refuse = (repo, txn, result, code = 'invalid_result', lens = 'review-risk') => {
    const before = readTransaction(repo, txn.lineage)
    const r = capture(repo, txn, lens, result)
    assert.equal(r.status, 1, r.stdout)
    assert.equal(r.error.code, code)
    const after = readTransaction(repo, txn.lineage)
    assert.deepEqual(after.results, before.results)
    assert.deepEqual(after.findings, before.findings)
    assert.equal(after.state, before.state)
    return r
  }

  test('a valid result is stored', () => {
    const { repo, txn, ok } = setup()
    assert.equal(capture(repo, txn, 'review-risk', ok).status, 0)
    assert.ok(readTransaction(repo, txn.lineage).results['review-risk'])
  })

  test('a wrong subject_hash is rejected', () => {
    const { repo, txn, ok } = setup()
    refuse(repo, txn, { ...ok, subject_hash: hashOf(txn, 'review-reliability') })
    refuse(repo, txn, { ...ok, subject_hash: 'sha256:0' })
  })

  test('unknown fields are rejected at every level', () => {
    const { repo, txn, ok } = setup()
    refuse(repo, txn, { ...ok, extra: 1 })
    refuse(repo, txn, { ...ok, inspection: { ...ok.inspection, note: 'x' } })
    refuse(repo, txn, { ...ok, findings: [{ ...finding(), id: 'F1' }] })
  })

  test('missing fields are rejected at every level', () => {
    const { repo, txn, ok } = setup()
    for (const key of ['subject_hash', 'inspection', 'findings', 'evidence']) {
      const { [key]: _omitted, ...rest } = ok
      refuse(repo, txn, rest)
    }
    refuse(repo, txn, { ...ok, inspection: { status: 'completed' } })
    const { claim: _claim, ...partial } = finding()
    refuse(repo, txn, { ...ok, findings: [partial] })
  })

  test('completed with a path set different from the manifest is rejected', () => {
    const { repo, txn, ok } = setup()
    refuse(repo, txn, { ...ok, inspection: { status: 'completed', paths: ['scripts/build.sh'] } })
    refuse(repo, txn, { ...ok, inspection: { status: 'completed', paths: [...txn.manifest, 'extra.txt'] } })
    refuse(repo, txn, { ...ok, inspection: { status: 'completed', paths: [...txn.manifest, txn.manifest[0]] } })
  })

  test('an incomplete inspection is refused and the slot stays open', () => {
    const { repo, txn, ok } = setup()
    const r = refuse(repo, txn, { ...ok, inspection: { status: 'incomplete', paths: [] }, evidence: ['patch missing'] }, 'incomplete_inspection')
    assert.match(r.error.message, /relaunch|again/)
    assert.equal(capture(repo, txn, 'review-risk', ok).status, 0)
  })

  test('enumerations and shapes are checked', () => {
    const { repo, txn, ok } = setup()
    for (const bad of [
      finding({ severity: 'HUGE' }),
      finding({ evidence_class: 'guess' }),
      finding({ causal_disposition: 'maybe' }),
      finding({ location: 'no-line' }),
      finding({ claim: '  ' }),
      finding({ proof_refs: [] }),
      finding({ proof_refs: [1] }),
    ]) {
      refuse(repo, txn, { ...ok, findings: [bad] })
    }
    refuse(repo, txn, { ...ok, evidence: [] })
    refuse(repo, txn, [])
  })

  test('input that is not JSON is rejected', () => {
    const { repo, txn } = setup()
    const r = review(repo, ['capture', '--lineage', txn.lineage, '--lens', 'risk', '--input', '-'], { input: 'not json' })
    assert.equal(r.error.code, 'malformed_result')
  })

  test('a lens that was not selected in start is rejected', () => {
    const { repo, txn, ok } = setup()
    refuse(repo, txn, ok, 'lens_not_selected', 'review-resilience')
  })

  test('a second capture for the same lens is rejected and keeps the first', () => {
    const { repo, txn, ok } = setup()
    assert.equal(capture(repo, txn, 'review-risk', ok).status, 0)
    const again = capture(repo, txn, 'review-risk', { ...ok, findings: [finding()] })
    assert.equal(again.status, 1)
    assert.equal(again.error.code, 'lens_already_captured')
    assert.deepEqual(readTransaction(repo, txn.lineage).results['review-risk'].findings, [])
  })

  test('capture reads a file as well as stdin', () => {
    const { repo, txn, ok } = setup()
    const file = join(repo, '..', `lens-${txn.lineage}.json`)
    writeFileSync(file, JSON.stringify(ok))
    assert.equal(review(repo, ['capture', '--lineage', txn.lineage, '--lens', 'risk', '--input', file]).status, 0)
  })

  test('capture is refused once the transaction left collecting', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    const r = capture(repo, txn, 'review-risk', lensResult(hashOf(txn), txn.manifest))
    assert.equal(r.status, 1)
    assert.ok(['wrong_state', 'lens_already_captured'].includes(r.error.code))
  })
})

describe('store, locking and atomicity', () => {
  test('state lives under the common git directory, never in the worktree', () => {
    const repo = highRepo()
    const txn = start(repo)
    const file = transactionFile(repo, txn.lineage)
    assert.ok(file.startsWith(storeRoot(repo)))
    assert.ok(existsSync(file))
    assert.equal(git(repo, 'status', '--porcelain', '-uall').includes('odd-review'), false)
  })

  test('linked worktrees share the store of the main repository', () => {
    const repo = highRepo()
    commitSome(repo)
    applyFiles(repo, { 'scripts/next.sh': 'echo next\n' })
    const linked = join(scratchDir('odd-review-linked-'), 'wt')
    git(repo, 'worktree', 'add', '-q', linked, '-b', 'linked')
    const txn = start(repo)
    const seen = review(linked, ['status', '--lineage', txn.lineage])
    assert.equal(seen.status, 0)
    assert.equal(seen.json.state, 'collecting')
  })

  test('a held lock refuses a second writer cleanly and changes nothing', () => {
    const repo = highRepo()
    const txn = start(repo)
    const lock = `${transactionFile(repo, txn.lineage).replace(/\.json$/, '')}.lock`
    writeFileSync(lock, `${process.pid}\n`)
    const before = readFileSync(transactionFile(repo, txn.lineage), 'utf8')
    const r = capture(repo, txn, 'review-risk', lensResult(hashOf(txn), txn.manifest))
    assert.equal(r.status, 1)
    assert.equal(r.error.code, 'transaction_locked')
    assert.equal(readFileSync(transactionFile(repo, txn.lineage), 'utf8'), before)
    assert.ok(existsSync(lock), 'the foreign lock is left alone')
  })

  test('a lock left by a dead process is reclaimed', async () => {
    const repo = highRepo()
    const txn = start(repo)
    const child = spawn(process.execPath, ['-e', '0'])
    await new Promise((resolve) => child.on('exit', resolve))
    const lock = `${transactionFile(repo, txn.lineage).replace(/\.json$/, '')}.lock`
    writeFileSync(lock, `${child.pid}\n`)
    const r = capture(repo, txn, 'review-risk', lensResult(hashOf(txn), txn.manifest))
    assert.equal(r.status, 0)
    assert.ok(!existsSync(lock))
  })

  test('an empty lock is reclaimed only once it is older than 10 seconds', () => {
    const repo = highRepo()
    const txn = start(repo)
    const lock = `${transactionFile(repo, txn.lineage).replace(/\.json$/, '')}.lock`
    const ok = () => capture(repo, txn, 'review-risk', lensResult(hashOf(txn), txn.manifest))
    writeFileSync(lock, '')
    const fresh = ok()
    assert.equal(fresh.status, 1)
    assert.equal(fresh.error.code, 'transaction_locked')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lock, old, old)
    assert.equal(ok().status, 0)
    assert.ok(!existsSync(lock))
  })

  test('a lock released between the open and the read is retried, not an internal error', () => {
    const repo = highRepo()
    const txn = start(repo)
    const lock = `${transactionFile(repo, txn.lineage).replace(/\.json$/, '')}.lock`
    writeFileSync(lock, `${process.pid}\n`)
    const r = review(repo, ['capture', '--lineage', txn.lineage, '--lens', 'risk', '--input', '-'], {
      input: JSON.stringify(lensResult(hashOf(txn), txn.manifest)),
      env: { ODD_REVIEW_TEST_FAULT: 'release-after-exists' },
    })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!existsSync(lock))
  })

  test('the fault seam does nothing unless the test variable is set', () => {
    const repo = highRepo()
    const txn = start(repo)
    const lock = `${transactionFile(repo, txn.lineage).replace(/\.json$/, '')}.lock`
    writeFileSync(lock, `${process.pid}\n`)
    const r = capture(repo, txn, 'review-risk', lensResult(hashOf(txn), txn.manifest))
    assert.equal(r.error.code, 'transaction_locked')
    assert.ok(existsSync(lock))
  })

  test('stale reclaim leaves no tombstone behind', async () => {
    const repo = highRepo()
    const txn = start(repo)
    const child = spawn(process.execPath, ['-e', '0'])
    await new Promise((resolve) => child.on('exit', resolve))
    writeFileSync(`${transactionFile(repo, txn.lineage).replace(/\.json$/, '')}.lock`, `${child.pid}\n`)
    assert.equal(capture(repo, txn, 'review-risk', lensResult(hashOf(txn), txn.manifest)).status, 0)
    assert.deepEqual(readdirSync(join(storeRoot(repo), 'transactions')).filter((n) => n.includes('stale')), [])
  })

  test('reclaim never removes a live lock a winner created after the inspection', async () => {
    const repo = highRepo()
    const txn = start(repo)
    const dead = spawn(process.execPath, ['-e', '0'])
    await new Promise((resolve) => dead.on('exit', resolve))
    const lock = `${transactionFile(repo, txn.lineage).replace(/\.json$/, '')}.lock`
    writeFileSync(lock, `${dead.pid}\n`)
    const r = review(repo, ['capture', '--lineage', txn.lineage, '--lens', 'risk', '--input', '-'], {
      input: JSON.stringify(lensResult(hashOf(txn), txn.manifest)),
      // The seam swaps the stale lock for a live one (this process) right after the inspection.
      env: { ODD_REVIEW_TEST_FAULT: 'reclaim-interleave', ODD_REVIEW_TEST_LIVE_PID: String(process.pid) },
    })
    assert.equal(r.status, 1, r.stdout)
    assert.equal(r.error.code, 'transaction_locked')
    assert.equal(readFileSync(lock, 'utf8'), `${process.pid}\n`, 'the live lock is untouched')
    assert.deepEqual(readTransaction(repo, txn.lineage).results, {})
    assert.ok(!existsSync(`${lock}.reclaim`), 'the reclaim lock is released')
  })

  test('parallel captures over a dead-pid lock never lose or duplicate a capture', async () => {
    const repo = highRepo()
    const dead = spawn(process.execPath, ['-e', '0'])
    await new Promise((resolve) => dead.on('exit', resolve))
    const run = (txn, lens) =>
      new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          [REVIEW_BIN, '--cwd', repo, 'capture', '--lineage', txn.lineage, '--lens', lens, '--input', '-'],
          { stdio: ['pipe', 'pipe', 'pipe'] },
        )
        let err = ''
        child.stderr.on('data', (chunk) => (err += chunk))
        child.on('close', (status) => resolve({ lens, status, code: err ? JSON.parse(err).error.code : null }))
        child.stdin.end(JSON.stringify(lensResult(txn.subjects[lens], txn.manifest)))
      })
    for (let trial = 0; trial < 50; trial++) {
      const txn = start(repo)
      writeFileSync(`${transactionFile(repo, txn.lineage).replace(/\.json$/, '')}.lock`, `${dead.pid}\n`)
      const lenses = ['review-risk', 'review-reliability']
      const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => run(txn, lenses[i % 2])))
      const stored = Object.keys(readTransaction(repo, txn.lineage).results).sort()
      const won = outcomes.filter((o) => o.status === 0).map((o) => o.lens)
      assert.deepEqual([...won].sort(), stored, `trial ${trial}: acknowledged captures must be persisted exactly once`)
      assert.equal(new Set(won).size, won.length, `trial ${trial}: a lens was captured twice`)
      for (const o of outcomes.filter((x) => x.status !== 0)) {
        assert.ok(['transaction_locked', 'wrong_state', 'lens_already_captured'].includes(o.code), `trial ${trial}: ${o.code}`)
      }
    }
  })

  test('the lock is released after every command, including refusals', () => {
    const repo = highRepo()
    const txn = start(repo)
    capture(repo, txn, 'review-resilience', lensResult(hashOf(txn), txn.manifest))
    review(repo, ['acknowledge', '--lineage', txn.lineage])
    const dir = join(storeRoot(repo), 'transactions')
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.lock')), [])
  })

  test('writes are atomic: no temporary file is left behind', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    review(repo, ['acknowledge', '--lineage', txn.lineage])
    for (const dir of ['transactions', 'receipts']) {
      const names = readdirSync(join(storeRoot(repo), dir))
      assert.ok(names.every((n) => n.endsWith('.json')), names.join(','))
    }
  })

  test('a lineage is validated before it reaches the file system', () => {
    const repo = highRepo()
    mkdirSync(join(storeRoot(repo), 'transactions'), { recursive: true })
    for (const lineage of ['../receipts/x', 'review-short', '']) {
      const r = review(repo, ['status', '--lineage', lineage])
      assert.ok(r.status === 1 || r.status === 2, `${lineage}: ${r.status}`)
    }
    const unknown = review(repo, ['status', '--lineage', 'review-0123456789abcdef'])
    assert.equal(unknown.status, 1)
    assert.equal(unknown.error.code, 'unknown_lineage')
  })
})

const commitSome = (repo) => {
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'wip')
}

describe('the repository is never changed', () => {
  test('no command changes the index, HEAD, or the working tree', () => {
    const repo = highRepo()
    git(repo, 'add', 'scripts/build.sh')
    write(repo, 'untracked.txt', 'u\n')
    const before = repoFingerprint(repo)
    const steps = []
    const txn = start(repo)
    steps.push(review(repo, ['context', '--lineage', txn.lineage, '--lens', 'risk']))
    steps.push(review(repo, ['status', '--lineage', txn.lineage]))
    captureAll(repo, txn)
    steps.push(review(repo, ['acknowledge', '--lineage', txn.lineage]))
    steps.push(review(repo, ['start', '--lenses', 'risk', '--lenses-reason', 'again']))
    assert.ok(steps.every((s) => s.status === 0 || s.status === 1))
    assert.deepEqual(repoFingerprint(repo), before)
  })

  test('correct leaves the repository untouched as well', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn, { 'review-risk': [finding()] })
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    const before = repoFingerprint(repo)
    assert.equal(review(repo, ['correct', '--lineage', txn.lineage]).status, 0)
    assert.deepEqual(repoFingerprint(repo), before)
  })
})

describe('usage', () => {
  test('start requires lenses and a reason', () => {
    const repo = highRepo()
    assert.equal(review(repo, ['start', '--lenses-reason', 'x']).status, 2)
    assert.equal(review(repo, ['start', '--lenses', 'risk']).status, 2)
    assert.equal(review(repo, ['start', '--lenses', 'risk', '--lenses-reason', '  ']).status, 2)
  })

  test('unknown lenses, commands, and options are usage errors', () => {
    const repo = highRepo()
    assert.equal(review(repo, ['start', '--lenses', 'speed', '--lenses-reason', 'x']).status, 2)
    assert.equal(review(repo, ['frobnicate']).status, 2)
    assert.equal(review(repo, ['status', '--bogus']).status, 2)
    assert.equal(review(repo, []).status, 2)
  })

  test('--committed-only without --base-ref is a usage error', () => {
    const r = review(highRepo(), ['start', '--lenses', 'risk', '--lenses-reason', 'x', '--committed-only'])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /--base-ref/)
  })

  test('--base-ref with dirty tracked changes needs --committed-only', () => {
    const repo = highRepo()
    commitSome(repo)
    applyFiles(repo, { 'scripts/build.sh': 'echo dirty\n' })
    const refused = review(repo, ['start', '--lenses', 'risk', '--lenses-reason', 'x', '--base-ref', 'HEAD~1'])
    assert.equal(refused.status, 1)
    assert.equal(refused.error.code, 'start_refused')
    const ok = review(repo, ['start', '--lenses', 'risk', '--lenses-reason', 'x', '--base-ref', 'HEAD~1', '--committed-only'])
    assert.equal(ok.status, 0)
  })

  test('a clean working tree has nothing to review', () => {
    const repo = highRepo()
    commitSome(repo)
    const r = review(repo, ['start', '--lenses', 'risk', '--lenses-reason', 'x'])
    assert.equal(r.status, 1)
    assert.equal(r.error.code, 'start_refused')
  })

  test('help exits 0', () => {
    assert.equal(review(highRepo(), ['--help']).status, 0)
  })
})
