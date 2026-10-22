// Delegation admission (S2), driven as the real hooks: PreToolUse(Agent) denies a
// malformed or conflicting writer/verifier launch; SubagentStop clears its record.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir, write } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const SCRIPT = join(PLUGIN, 'hooks/scripts/delegation-admission.mjs')
const WORKER = 'construct:worker'
const FIX = 'construct:jd-fix-agent'
const VERIFY = 'construct:verifier'

const FEATURE = (status = 'pending') =>
  `# Feature\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | Do it | w | none | ${status} | - |\n\n## Log\n`

const env = () => ({ CLAUDE_PLUGIN_DATA: scratchDir('odd-adm-data-') })
const surfaces = (...paths) => `Implement the unit.\n\n## Allowed edit surfaces\n${paths.join('\n')}\n\n## Verification\n- node --test\n`

function run(mode, input, e, raw) {
  const r = spawnSync('node', [SCRIPT, ...(mode ? [mode] : [])], {
    input: raw ?? JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...e },
  })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    // no output
  }
  return { status: r.status, stdout: r.stdout, json }
}

const launch = (repo, e, type, prompt, session = 's1') =>
  run(undefined, { session_id: session, cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: type, prompt, description: 'unit' } }, e)

const denied = (r, ...needles) => {
  assert.equal(r.status, 0)
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
  for (const n of needles) assert.match(r.json.hookSpecificOutput.permissionDecisionReason, n)
}
const allowed = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}

const plain = () => makeRepo({ 'src/a.js': 'a\n' })
const withFeature = (status) => {
  const repo = plain()
  write(repo, 'odd/tasks/feat.md', FEATURE(status))
  return repo
}
const SPEC = 'Spec: odd/tasks/feat.md, T1, S1\n'

describe('writer surfaces', () => {
  test('jd-fix-agent is no longer a writer: no section, Spec, or overlap check applies', () => {
    allowed(launch(plain(), env(), FIX, 'Do the thing'))
    allowed(launch(withFeature(), env(), FIX, surfaces('src/a.js')))
  })
  for (const type of [WORKER]) {
    test(`${type} without the section is denied naming the heading`, () => {
      denied(launch(plain(), env(), type, 'Do the thing'), /## Allowed edit surfaces/)
    })
    test(`${type} with an empty section is denied`, () => {
      denied(launch(plain(), env(), type, 'Do it\n\n## Allowed edit surfaces\n\n## Verification\nx'), /no entries/)
    })
    test(`${type} with narrow surfaces is allowed with no output`, () => {
      allowed(launch(plain(), env(), type, surfaces('src/a.js', '- `tests/**/*.mjs`')))
    })
  }
  for (const bad of ['/etc/passwd', 'src/../x.js', '**', '~/x', '**/a.js', 'C:\\x']) {
    test(`entry ${bad} is denied and named`, () => {
      denied(launch(plain(), env(), WORKER, surfaces('src/a.js', bad)), /not a narrow repository-relative path/)
    })
  }
  test('a bare * line is denied (it reads as an empty list item)', () => {
    denied(launch(plain(), env(), WORKER, surfaces('src/a.js', '*')), /Line "\*" is not a valid surface entry/)
  })
  test('prose inside the section is denied', () => {
    denied(launch(plain(), env(), WORKER, surfaces('only the parser please')), /not a valid surface entry/)
  })
  test('repeated sections must agree', () => {
    const p = `${surfaces('a.js')}\n${surfaces('b.js')}`
    denied(launch(plain(), env(), WORKER, p), /different surfaces/)
  })
})

describe('Spec line', () => {
  test('not required without an unfinished feature document', () => {
    allowed(launch(plain(), env(), WORKER, surfaces('src/a.js')))
    allowed(launch(withFeature('done'), env(), WORKER, surfaces('src/a.js')))
  })
  test('required when an unfinished document exists, with the expected form in the reason', () => {
    denied(launch(withFeature(), env(), WORKER, surfaces('src/a.js')), /Spec: odd\/tasks\/<feature>\.md, T<n>/)
  })
  test('a Spec line naming an existing regular file is allowed', () => {
    allowed(launch(withFeature(), env(), WORKER, SPEC + surfaces('src/a.js')))
    allowed(launch(withFeature(), env(), WORKER, `- Spec: \`odd/tasks/feat.md\` (read to Log). Do T1; S1.\n${surfaces('src/a.js')}`))
  })
  test('a Spec line without a task id, or inside prose, is denied', () => {
    denied(launch(withFeature(), env(), WORKER, `Spec: odd/tasks/feat.md\n${surfaces('src/a.js')}`), /Spec:/)
    denied(launch(withFeature(), env(), WORKER, `See Spec: odd/tasks/feat.md, T1\n${surfaces('src/a.js')}`), /Spec:/)
  })
  test('a missing file, a directory, or a path outside odd/tasks is denied', () => {
    const repo = withFeature()
    denied(launch(repo, env(), WORKER, `Spec: odd/tasks/nope.md, T1\n${surfaces('src/a.js')}`), /existing regular file/)
    denied(launch(repo, env(), WORKER, `Spec: odd/tasks/../src/a.md, T1\n${surfaces('src/a.js')}`), /existing regular file/)
  })
  test('a symlinked document is not accepted', () => {
    const repo = withFeature()
    write(repo, 'elsewhere.md', FEATURE())
    symlinkSync(join(repo, 'elsewhere.md'), join(repo, 'odd/tasks/link.md'))
    denied(launch(repo, env(), WORKER, `Spec: odd/tasks/link.md, T1\n${surfaces('src/a.js')}`), /existing regular file/)
  })
})

describe('verifier', () => {
  test('without a Risk: item N line is denied with the expected form', () => {
    denied(launch(plain(), env(), VERIFY, 'Verify it'), /Risk: item N/)
    denied(launch(plain(), env(), VERIFY, 'Risk: none\nVerify'), /Risk: item N/)
    denied(launch(plain(), env(), VERIFY, 'Risk: item 7\nVerify'), /Risk: item N/)
    denied(launch(plain(), env(), VERIFY, 'Risk: items 7\nVerify'), /Risk: item N/)
    denied(launch(plain(), env(), VERIFY, 'Risk: items\nVerify'), /Risk: item N/)
    denied(launch(plain(), env(), VERIFY, 'Risk: items 2, 7\nVerify'), /Risk: item N/)
    denied(launch(plain(), env(), VERIFY, 'Risk: item 2,\nVerify'), /Risk: item N/)
    denied(launch(plain(), env(), VERIFY, 'the Risk: item 3 is here'), /Risk: item N/)
  })
  test('with Risk: item 1-6 is allowed, also as a list item', () => {
    allowed(launch(plain(), env(), VERIFY, 'Verify\nRisk: item 3 (shared parser)'))
    allowed(launch(plain(), env(), VERIFY, '- Risk: items 2, 3 (why)\nVerify'))
    allowed(launch(plain(), env(), VERIFY, 'Risk: items 2, 5 (why)\nVerify'))
    allowed(launch(plain(), env(), VERIFY, 'Risk: items 2, 5 (x)\nVerify'))
  })
  test('admission and the Risk-line gate accept and reject the same samples (none aside)', () => {
    const source = readFileSync(join(PLUGIN, 'hooks/scripts/risk-line.mjs'), 'utf8')
    const gate = new RegExp(source.match(/^const RISK_LINE = \/(.*)\/m$/m)[1].replace('none|', ''), 'm')
    for (const [sample, ok] of [['Risk: item 3', true], ['- Risk: items 2, 5 (why)', true], ['Risk: items 2, 7', false], ['Risk: item 2,', false], ['Risk: item 7', false], ['Risk: item 2, item 3', false], ['Risk: none', false]]) {
      assert.equal(gate.test(sample), ok, sample)
      const r = launch(plain(), env(), VERIFY, sample)
      if (ok) allowed(r)
      else denied(r, /Risk: item N/)
    }
  })
  test('the verifier does not need surfaces or a Spec line', () => {
    allowed(launch(withFeature(), env(), VERIFY, 'Risk: item 1'))
  })
})

describe('other launches are untouched', () => {
  for (const type of ['construct:explorer', 'construct:review-risk', 'general-purpose', undefined]) {
    test(`${type}`, () => allowed(launch(withFeature(), env(), type, 'anything')))
  }
  test('a non-Agent tool call', () => {
    allowed(run(undefined, { session_id: 's', cwd: plain(), tool_name: 'Bash', tool_input: { command: 'ls' } }, env()))
  })
})

describe('overlap with an open writer', () => {
  test('overlapping surfaces are denied naming the pair; disjoint ones are allowed', () => {
    const repo = plain()
    const e = env()
    allowed(launch(repo, e, WORKER, surfaces('src/**', 'docs/a.md')))
    denied(launch(repo, e, WORKER, surfaces('src/x/y.js')), /overlap/, /src\/x\/y\.js/, /src\/\*\*/)
    denied(launch(repo, e, WORKER, surfaces('src')), /overlap/)
    allowed(launch(repo, e, WORKER, surfaces('lib/b.js', 'tests/*.mjs')))
    denied(launch(repo, e, WORKER, surfaces('tests/a.mjs')), /overlap/)
  })
  test('glob pairs: disjoint literals, differing suffixes, differing prefixes', () => {
    const repo = plain()
    const e = env()
    allowed(launch(repo, e, WORKER, surfaces('src/*.js')))
    allowed(launch(repo, e, WORKER, surfaces('src/*.ts')))
    allowed(launch(repo, e, WORKER, surfaces('lib/{a,b}.js')))
    denied(launch(repo, e, WORKER, surfaces('lib/b.js')), /overlap/)
    allowed(launch(repo, e, WORKER, surfaces('lib/c.js')))
    denied(launch(repo, e, WORKER, surfaces('SRC/Z.JS')), /overlap/)
  })
  test('an uninterpretable entry (bracket class, extglob) counts as overlap', () => {
    const repo = plain()
    const e = env()
    allowed(launch(repo, e, WORKER, surfaces('src/[ab].js')))
    denied(launch(repo, e, WORKER, surfaces('src/readme.md')), /overlap/)
  })
  test('a denied launch records nothing', () => {
    const repo = plain()
    const e = env()
    denied(launch(repo, e, WORKER, 'no surfaces'))
    allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
  })
  test('another session or another repository does not conflict', () => {
    const e = env()
    allowed(launch(plain(), e, WORKER, surfaces('src/a.js'), 's1'))
    allowed(launch(plain(), e, WORKER, surfaces('src/a.js'), 's1'))
    const repo = plain()
    allowed(launch(repo, e, WORKER, surfaces('src/a.js'), 's2'))
    allowed(launch(repo, e, WORKER, surfaces('src/a.js'), 's3'))
  })
  test('verifiers and other agents neither record nor conflict', () => {
    const repo = plain()
    const e = env()
    allowed(launch(repo, e, VERIFY, 'Risk: item 1'))
    allowed(launch(repo, e, 'construct:explorer', surfaces('src/a.js')))
    allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
  })
})

describe('SubagentStop clears the record', () => {
  const transcript = (prompt, shape = 'string') => {
    const dir = scratchDir('odd-adm-tr-')
    const file = join(dir, 'agent-a1.jsonl')
    const content = shape === 'string' ? prompt : [{ type: 'text', text: prompt }]
    writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n${JSON.stringify({ type: 'assistant', message: { content: 'x' } })}\n`)
    return file
  }
  const stop = (e, file, session = 's1') => run('stop', { session_id: session, agent_id: 'a1', agent_type: WORKER, hook_event_name: 'SubagentStop', agent_transcript_path: file }, e)

  for (const shape of ['string', 'blocks']) {
    test(`the stopped writer's surfaces are free again (${shape} content)`, () => {
      const repo = plain()
      const e = env()
      const p = surfaces('src/a.js')
      allowed(launch(repo, e, WORKER, p))
      denied(launch(repo, e, WORKER, surfaces('src/a.js')), /overlap/)
      allowed(stop(e, transcript(p, shape)))
      allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
    })
  }
  test('only the writer whose prompt matches is cleared', () => {
    const repo = plain()
    const e = env()
    const a = surfaces('src/a.js')
    allowed(launch(repo, e, WORKER, a))
    allowed(launch(repo, e, WORKER, surfaces('lib/b.js')))
    allowed(stop(e, transcript(a)))
    allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
    denied(launch(repo, e, WORKER, surfaces('lib/b.js')), /overlap/)
  })
  test('an unreadable transcript or bad input changes nothing and fails open', () => {
    const repo = plain()
    const e = env()
    allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
    allowed(stop(e, join(scratchDir('x-'), 'missing.jsonl')))
    allowed(stop(e, undefined))
    allowed(run('stop', null, e, 'not json'))
    denied(launch(repo, e, WORKER, surfaces('src/a.js')), /overlap/)
  })
})

describe('stale records', () => {
  test('a record older than one hour is ignored; a fresh one is not', () => {
    const repo = plain()
    const e = env()
    allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
    const dir = join(e.CLAUDE_PLUGIN_DATA, 'delegation-admission', 's1')
    const files = readdirSync(dir)
    assert.equal(files.length, 1)
    denied(launch(repo, e, WORKER, surfaces('src/a.js', 'x/y.js')), /overlap/)
    const old = new Date(Date.now() - 3601 * 1000)
    utimesSync(join(dir, files[0]), old, old)
    allowed(launch(repo, e, WORKER, surfaces('src/b.js')))
  })
})

describe('failure mode', () => {
  test('unreadable or non-object input exits 0 silently', () => {
    for (const raw of ['', 'not json', 'null', '[]', '{"tool_name":"Agent"}']) {
      const r = run(undefined, null, env(), raw)
      allowed(r)
    }
  })
  test('an unusable data directory fails open', () => {
    const r = run(undefined, { session_id: 's', cwd: plain(), tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt: surfaces('a.js') } }, { CLAUDE_PLUGIN_DATA: '/dev/null/x' })
    allowed(r)
  })
})

describe('registration', () => {
  const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
  const script = '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/delegation-admission.mjs'
  test('PreToolUse on Agent next to review-context, in exec form', () => {
    const group = hooks.PreToolUse.find((g) => g.matcher === 'Agent')
    const entry = group.hooks.find((h) => h.args?.[0] === script)
    assert.deepEqual(entry, { type: 'command', command: 'node', args: [script], timeout: 10 })
    assert.ok(group.hooks.some((h) => h.args?.[0].endsWith('review-context.mjs')))
  })
  test('SubagentStop for all agents with the stop mode; the counter and review capture stay', () => {
    const group = hooks.SubagentStop.find((g) => g.hooks.some((h) => h.args?.[0] === script))
    assert.equal(group.matcher, undefined)
    assert.deepEqual(group.hooks.find((h) => h.args?.[0] === script), { type: 'command', command: 'node', args: [script, 'stop'], timeout: 10 })
    assert.ok(hooks.SubagentStop.some((g) => g.hooks.some((h) => h.args?.[0].endsWith('subagent-count.mjs'))))
    assert.ok(hooks.SubagentStop.some((g) => g.matcher === '^construct:review-'))
  })
})

describe('feature-state still works after the export', () => {
  test('feature-state.mjs run directly re-injects an unfinished document', () => {
    const repo = withFeature()
    const r = spawnSync('node', [join(PLUGIN, 'hooks/scripts/feature-state.mjs')], { input: JSON.stringify({ cwd: repo }), encoding: 'utf8' })
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /odd\/tasks\/feat\.md/)
  })
})

describe('concurrent admission (L7 gap)', () => {
  test('parallel launches with overlapping surfaces admit exactly one', async () => {
    const { spawn } = await import('node:child_process')
    const launchAsync = (repo, e, prompt) =>
      new Promise((done) => {
        const child = spawn('node', [SCRIPT], { env: { ...process.env, ...e } })
        let out = ''
        child.stdout.on('data', (d) => (out += d))
        child.on('close', () => done(out))
        child.stdin.end(
          JSON.stringify({ session_id: 'par', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt, description: 'u' } }),
        )
      })
    for (let round = 0; round < 3; round++) {
      const repo = plain()
      const e = env()
      const outs = await Promise.all(Array.from({ length: 8 }, (_, i) => launchAsync(repo, e, `${surfaces('src/a.js')}\nunit ${i}`)))
      assert.equal(outs.filter((o) => o === '').length, 1, `round ${round}: ${outs.map((o) => (o ? 'deny' : 'admit')).join(',')}`)
      assert.equal(readdirSync(join(e.CLAUDE_PLUGIN_DATA, 'delegation-admission', 'par')).filter((n) => !n.startsWith('.')).length, 1)
    }
  })
  test('a stale lock is broken and the launch is admitted', () => {
    const repo = plain()
    const e = env()
    const lock = join(e.CLAUDE_PLUGIN_DATA, 'delegation-admission', 's1.lock')
    mkdirSync(lock, { recursive: true })
    const old = new Date(Date.now() - 60_000)
    utimesSync(lock, old, old)
    allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
    assert.equal(readdirSync(join(e.CLAUDE_PLUGIN_DATA, 'delegation-admission', 's1')).length, 1)
  })
  test('no lock directory is left behind', () => {
    const e = env()
    allowed(launch(plain(), e, WORKER, surfaces('src/a.js')))
    assert.deepEqual(readdirSync(join(e.CLAUDE_PLUGIN_DATA, 'delegation-admission')), ['s1'])
  })
})

describe('A5: the construct: prefix is optional', () => {
  for (const [type, prefixed] of [['worker', WORKER]]) {
    test(`${type} without the prefix is admitted like ${prefixed}`, () => {
      allowed(launch(plain(), env(), type, surfaces('src/a.js')))
    })
    test(`${type} without the prefix is denied with no section`, () => {
      denied(launch(plain(), env(), type, 'Do the thing'), /## Allowed edit surfaces/)
    })
    test(`${type} without the prefix is denied on a bad entry`, () => {
      denied(launch(plain(), env(), type, surfaces('src/a.js', '/etc/passwd')), /not a narrow repository-relative path/)
    })
    test(`${type} without the prefix needs the Spec line when a feature is open`, () => {
      denied(launch(withFeature('pending'), env(), type, surfaces('src/a.js')), /Spec:/)
    })
    test(`${type} without the prefix is tracked for overlap`, () => {
      const repo = plain()
      const e = env()
      allowed(launch(repo, e, type, surfaces('src/a.js'), 'ov'))
      denied(launch(repo, e, prefixed, surfaces('src/a.js'), 'ov'), /overlap/i)
    })
  }
  test('verifier without the prefix needs a Risk line', () => {
    denied(launch(plain(), env(), 'verifier', 'Verify it'), /Risk: item/)
    allowed(launch(plain(), env(), 'verifier', 'Verify it\nRisk: item 2\n'))
  })
  test('other agents are untouched', () => {
    allowed(launch(plain(), env(), 'odd-explore', 'look'))
  })
})

describe('start mode (F10)', () => {
  const start = (e, type = WORKER) => run('start', { session_id: 's1', agent_id: 'a1', agent_type: type, hook_event_name: 'SubagentStart' }, e)
  const age = (e, minutes) => {
    const dir = join(e.CLAUDE_PLUGIN_DATA, 'delegation-admission', 's1')
    for (const name of readdirSync(dir)) {
      const file = join(dir, name)
      const entry = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ ...entry, at: new Date(Date.now() - minutes * 60_000).toISOString() }))
    }
  }
  test('an unstarted record older than the grace no longer blocks an overlapping writer', () => {
    const repo = plain()
    const e = env()
    allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
    age(e, 5)
    allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
  })
  test('a started record still blocks after the grace', () => {
    const repo = plain()
    const e = env()
    allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
    allowed(start(e))
    age(e, 5)
    denied(launch(repo, e, WORKER, surfaces('src/a.js')), /overlap/)
  })
  test('start skips a record past the grace and marks the launch that is inside it', () => {
    const repo = plain()
    const e = env()
    const file = join(scratchDir('odd-adm-b2-'), 'agent-b.jsonl')
    const promptB = `${surfaces('src/a.js')}\nunit B`
    writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content: promptB } })}\n`)
    allowed(launch(repo, e, WORKER, `${surfaces('src/a.js')}\nunit A`)) // declined by the host: never starts
    age(e, 3)
    allowed(launch(repo, e, WORKER, promptB))
    allowed(start(e))
    allowed(run('stop', { session_id: 's1', agent_id: 'b', agent_type: WORKER, hook_event_name: 'SubagentStop', agent_transcript_path: file }, e))
    allowed(launch(repo, e, WORKER, `${surfaces('src/a.js')}\nunit D`))
  })
  test('a start for another agent type leaves the record unstarted', () => {
    const repo = plain()
    const e = env()
    allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
    allowed(start(e, 'construct:explorer'))
    age(e, 5)
    allowed(launch(repo, e, WORKER, surfaces('src/a.js')))
  })
  test('hooks.json registers start on SubagentStart in exec form', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const script = '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/delegation-admission.mjs'
    const entry = hooks.SubagentStart.flatMap((g) => g.hooks).find((h) => h.args?.[0] === script)
    assert.deepEqual(entry, { type: 'command', command: 'node', args: [script, 'start'], timeout: 10 })
  })
})
