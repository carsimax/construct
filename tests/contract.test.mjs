import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pluginRoot = new URL('../plugins/construct/', import.meta.url).pathname
const script = join(pluginRoot, 'hooks/scripts/contract.mjs')

function run(kind, input, extraEnv = {}) {
  const base = { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot }
  // The auto-index option must default off, whatever the developer's shell exports
  delete base.CLAUDE_PLUGIN_OPTION_CODEGRAPH_AUTO_INDEX
  const res = spawnSync(process.execPath, [script, kind], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...base, ...extraEnv },
  })
  return { code: res.status, stdout: res.stdout, stderr: res.stderr }
}

function context(kind, input, extraEnv) {
  const { code, stdout } = run(kind, input, extraEnv)
  assert.equal(code, 0)
  const out = JSON.parse(stdout)
  return out.hookSpecificOutput
}

const SESSION = { hook_event_name: 'SessionStart', source: 'startup' }

test('SessionStart emits the session contract as additionalContext within 8000 characters', () => {
  const out = context('session', SESSION)
  assert.equal(out.hookEventName, 'SessionStart')
  assert.ok(out.additionalContext.length > 2000)
  assert.ok(out.additionalContext.length <= 8000, `length ${out.additionalContext.length}`)
})

test('the session contract emits the same text after compaction and on malformed input', () => {
  const startup = context('session', SESSION).additionalContext
  assert.equal(context('session', { ...SESSION, source: 'compact' }).additionalContext, startup)
  assert.equal(context('session', 'not json').additionalContext, startup)
  assert.equal(context('session', '').additionalContext, startup)
})

test('the session contract carries the ODD protocol, task size, risk line, and delegation anchors', () => {
  const text = context('session', SESSION).additionalContext
  for (const anchor of [
    'Organic Driven Development',
    'odd/tasks/<feature>.md',
    'Risk: item',
    'Risk: none',
    'migrations',
    'auth',
    'public API',
    'concurrency',
    'installers',
    'no test would catch',
    'construct:odd-explorer',
    'construct:odd-worker',
    'construct:odd-verify',
    'construct:odd-general',
    'construct:odd-workflow',
    'construct:odd-delegation',
    'construct:task-size-risk',
    'construct:lossless-prompts',
    'construct:rdd-review',
    'odd-review mode',
  ]) {
    assert.ok(text.toLowerCase().includes(anchor.toLowerCase()), `missing ${anchor}`)
  }
})

test('the session contract scales autonomy to the verifier and closes with checks and the Risk line', () => {
  const text = context('session', SESSION).additionalContext
  const flat = text.replace(/\s+/g, ' ')
  assert.match(flat, /autonomy matches the (strength of the )?verifier, not confidence/i)
  assert.match(flat, /strong verifier[^.]*loop until it passes/i)
  assert.match(flat, /weak verifier[^.]*one small step[^.]*stop/i)
  assert.match(flat, /docs-only[^.]*reviewed diff is the verifier/i)
  const close = text.match(/^7\. Close\..*$/m)?.[0]
  assert.ok(close, 'step 7 Close line not found')
  assert.match(close, /skipped|unverified/i)
  assert.match(close, /Risk line/)
  assert.ok(text.includes('Risk: item N (reason)') && text.includes('Risk: none'))
})

test('code writes go to the worker while reads and answers stay with the parent', () => {
  const text = context('session', SESSION).additionalContext
  assert.ok(text.includes('Every write to repository code, tests, or docs goes to `construct:odd-worker`'))
  assert.ok(!text.includes('works inline by default'))
  const delegation = readFileSync(join(pluginRoot, 'skills/odd-delegation/SKILL.md'), 'utf8')
  assert.ok(delegation.includes('Every write to repository code, tests, or docs goes to `construct:odd-worker`'))
  assert.ok(!delegation.includes('When in doubt, work inline.'))
  const sizing = readFileSync(join(pluginRoot, 'skills/task-size-risk/SKILL.md'), 'utf8')
  assert.ok(!sizing.includes('No feature document, worker, or verifier'))
  const grader = readFileSync(join(pluginRoot, 'evals/small-delegated/graders/worker-delegated.md'), 'utf8')
  assert.match(grader, /tool: Agent\nmin: 1/)
})

test('SubagentStart gives worker agents the subagent contract', () => {
  for (const agent of ['construct:odd-worker', 'construct:odd-explorer', 'general-purpose']) {
    const out = context('subagent', { hook_event_name: 'SubagentStart', agent_type: agent })
    assert.equal(out.hookEventName, 'SubagentStart')
    assert.ok(out.additionalContext.includes('## Key Learnings'), agent)
    assert.ok(out.additionalContext.includes('English'), agent)
    assert.ok(out.additionalContext.length <= 3000)
  }
})

test('SubagentStart carries the S2 engineering rules for writers', () => {
  const text = context('subagent', { hook_event_name: 'SubagentStart', agent_type: 'construct:odd-worker' }).additionalContext
  assert.match(text, /never weaken a verifier/i)
  assert.match(text, /suppress an error, widen a type, skip a test, or delete an assertion/)
  assert.match(text, /root cause/i)
  assert.match(text, /reproduce a bug before/i)
  assert.match(text, /not needed.*already in the codebase.*standard library or platform.*installed dependency.*minimum new code/s)
  assert.match(text, /no dependency for a few lines/i)
  assert.match(text, /match the surrounding code/i)
  assert.ok(text.includes('`shortcut: <the limit>, <when to upgrade>`'))
  assert.match(text, /review your own diff as if someone else wrote it/i)
  assert.match(text, /missing test is a finding/i)
  assert.match(text, /finish every caller, test, and fixture/i)
  assert.match(text, /short means quick to read/i)
  assert.match(text, /equal.size options.*correct on edge cases/i)
  assert.match(text, /never ship code .*explain.*line by line/i)
  assert.ok(text.length <= 3000, `length ${text.length}`)
})

test('SubagentStart injects nothing into agents that must return a single JSON object', () => {
  for (const agent of ['construct:review-risk', 'construct:review-refuter', 'construct:review-validator', 'construct:jd-judge-a', 'construct:jd-judge-b', 'review-risk', 'jd-judge-b']) {
    const { code, stdout } = run('subagent', { hook_event_name: 'SubagentStart', agent_type: agent })
    assert.equal(code, 0, agent)
    assert.equal(stdout, '', agent)
  }
})

test('an unknown contract kind exits 0 without output', () => {
  const { code, stdout } = run('bogus', SESSION)
  assert.equal(code, 0)
  assert.equal(stdout, '')
})

test('hooks.json registers both contracts in exec form and keeps the mod module', () => {
  const hooks = JSON.parse(readFileSync(join(pluginRoot, 'hooks/hooks.json'), 'utf8'))
  assert.deepEqual(hooks.modules, ['./register.js'])
  const session = hooks.hooks.SessionStart
  const contract = session.find((e) => e.hooks[0].args?.[0]?.endsWith('contract.mjs'))
  assert.equal(contract.matcher, 'startup|resume|clear|compact')
  assert.equal(contract.hooks[0].command, 'node')
  assert.deepEqual(contract.hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/contract.mjs', 'session'])
  const sub = hooks.hooks.SubagentStart
  assert.deepEqual(sub[0].hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/contract.mjs', 'subagent'])
})

test('every construct component a contract names exists in the plugin', () => {
  const agents = new Set(readdirSync(join(pluginRoot, 'agents')).map((f) => f.replace(/\.md$/, '')))
  for (const kind of ['session', 'subagent']) {
    const text = readFileSync(join(pluginRoot, `hooks/contract/${kind}.md`), 'utf8')
    for (const [, name] of text.matchAll(/construct:([a-z0-9-]+)/g)) {
      const exists = agents.has(name) || existsSync(join(pluginRoot, 'skills', name, 'SKILL.md'))
      assert.ok(exists, `${kind} contract names missing construct:${name}`)
    }
    assert.doesNotMatch(text, /gentle[-_ ]?ai/i)
  }
})

function project(...marks) {
  const dir = mkdtempSync(join(tmpdir(), 'construct-contract-'))
  for (const mark of marks) mkdirSync(join(dir, mark))
  return dir
}

test('SessionStart notes a missing CodeGraph index for a git root, identically across sources', () => {
  const dir = project('.git')
  try {
    const base = context('session', { ...SESSION, cwd: dir }).additionalContext
    const plain = context('session', { ...SESSION, cwd: project() }).additionalContext
    assert.ok(base.includes('CodeGraph:'))
    assert.ok(base.includes(`\`${dir}\` has no \`.codegraph/\` index`))
    assert.ok(base.includes(`! codegraph init ${dir}`))
    assert.ok(base.startsWith(plain.trim().split('\n\nCodeGraph:')[0]))
    assert.ok(base.length <= 8000, `length ${base.length}`)
    for (const source of ['resume', 'clear', 'compact']) {
      assert.equal(context('session', { ...SESSION, source, cwd: dir }).additionalContext, base)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SessionStart treats a .git file as a git root', () => {
  const dir = project()
  try {
    writeFileSync(join(dir, '.git'), 'gitdir: elsewhere\n')
    assert.ok(context('session', { ...SESSION, cwd: dir }).additionalContext.includes('CodeGraph:'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SessionStart adds no CodeGraph line when the index exists or the directory is not a git root', () => {
  const indexed = project('.git', '.codegraph')
  const bare = project()
  try {
    assert.ok(!context('session', { ...SESSION, cwd: indexed }).additionalContext.includes('CodeGraph'))
    assert.ok(!context('session', { ...SESSION, cwd: bare }).additionalContext.includes('CodeGraph'))
  } finally {
    rmSync(indexed, { recursive: true, force: true })
    rmSync(bare, { recursive: true, force: true })
  }
})

test('SubagentStart never carries the index notice and names the CodeGraph rule', () => {
  const dir = project('.git')
  try {
    const out = context('subagent', { hook_event_name: 'SubagentStart', agent_type: 'construct:odd-worker', cwd: dir })
    assert.ok(!out.additionalContext.includes('has no `.codegraph/` index'))
    assert.ok(out.additionalContext.includes('mcp__codegraph__codegraph_explore'))
    assert.ok(out.additionalContext.includes('codegraph explore'))
    assert.ok(out.additionalContext.includes('.codegraph/'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// S5: opt-in background indexing through a fake `codegraph` CLI that records its argv
function fakeCli() {
  const bin = mkdtempSync(join(tmpdir(), 'construct-fakebin-'))
  const marker = join(bin, 'marker.txt')
  const exe = join(bin, 'codegraph')
  writeFileSync(exe, `#!/bin/sh\nprintf '%s|%s' "$*" "$(pwd -P)" > "${marker}"\n`, { mode: 0o755 })
  return { bin, marker }
}

function waitFor(path, ms = 2000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (existsSync(path)) return true
    spawnSync('sleep', ['0.05'])
  }
  return existsSync(path)
}

function autoEnv(bin, value = 'true') {
  return { CLAUDE_PLUGIN_OPTION_CODEGRAPH_AUTO_INDEX: value, PATH: `${bin}:${process.env.PATH}` }
}

test('auto-index on: a git root without an index launches codegraph init --yes detached and says so', () => {
  const dir = project('.git')
  const { bin, marker } = fakeCli()
  try {
    const t0 = Date.now()
    const text = context('session', { ...SESSION, cwd: dir }, autoEnv(bin)).additionalContext
    assert.ok(Date.now() - t0 < 5000)
    assert.ok(text.includes('was requested and may still fail'))
    assert.ok(text.includes('file tools'))
    assert.ok(!text.includes('! codegraph init'))
    assert.ok(waitFor(marker), 'fake codegraph never ran')
    const [argv, cwd] = readFileSync(marker, 'utf8').split('|')
    assert.equal(argv, `init --yes ${dir}`)
    assert.equal(cwd, realpathSync(dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
})

test('auto-index off or unset: the S2 notice is unchanged and nothing is spawned', () => {
  const dir = project('.git')
  const { bin, marker } = fakeCli()
  try {
    const baseline = context('session', { ...SESSION, cwd: dir }).additionalContext
    for (const value of ['false', '', undefined]) {
      const env = autoEnv(bin, value)
      if (value === undefined) delete env.CLAUDE_PLUGIN_OPTION_CODEGRAPH_AUTO_INDEX
      assert.equal(context('session', { ...SESSION, cwd: dir }, env).additionalContext, baseline)
    }
    assert.ok(baseline.includes(`! codegraph init ${dir}`))
    spawnSync('sleep', ['0.5'])
    assert.ok(!existsSync(marker))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
})

test('auto-index on never spawns with an existing index, outside a git root, or for subagents', () => {
  const indexed = project('.git', '.codegraph')
  const bare = project()
  const git = project('.git')
  const { bin, marker } = fakeCli()
  try {
    const env = autoEnv(bin)
    assert.ok(!context('session', { ...SESSION, cwd: indexed }, env).additionalContext.includes('CodeGraph:'))
    assert.ok(!context('session', { ...SESSION, cwd: bare }, env).additionalContext.includes('CodeGraph:'))
    context('subagent', { hook_event_name: 'SubagentStart', agent_type: 'construct:odd-worker', cwd: git }, env)
    spawnSync('sleep', ['0.5'])
    assert.ok(!existsSync(marker))
  } finally {
    for (const d of [indexed, bare, git, bin]) rmSync(d, { recursive: true, force: true })
  }
})

test('auto-index on with the CLI missing keeps the fallback guidance and names the PATH problem', () => {
  const dir = project('.git')
  const empty = mkdtempSync(join(tmpdir(), 'construct-emptybin-'))
  try {
    const res = run('session', { ...SESSION, cwd: dir }, { CLAUDE_PLUGIN_OPTION_CODEGRAPH_AUTO_INDEX: 'true', PATH: empty })
    assert.equal(res.code, 0)
    const text = JSON.parse(res.stdout).hookSpecificOutput.additionalContext
    assert.ok(text.includes('`codegraph` CLI is not on the PATH'))
    assert.ok(text.includes('file tools'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(empty, { recursive: true, force: true })
  }
})

test('plugin.json declares codegraph_auto_index as a boolean defaulting to false', () => {
  const cfg = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin/plugin.json'), 'utf8')).userConfig
  assert.equal(cfg.codegraph_auto_index?.type, 'boolean')
  assert.equal(cfg.codegraph_auto_index?.default, false)
  assert.ok(cfg.codegraph_auto_index.title && cfg.codegraph_auto_index.description)
})

test('stdin that parses to a non-object (null, array, number, string) is treated as {}', () => {
  for (const kind of ['session', 'subagent']) {
    const expected = context(kind, {}).additionalContext
    for (const raw of ['null', '[]', '[1]', '42', '"x"', 'true']) {
      const res = run(kind, raw)
      assert.equal(res.code, 0, `${kind} ${raw}: ${res.stderr}`)
      assert.equal(JSON.parse(res.stdout).hookSpecificOutput.additionalContext.startsWith(expected.slice(0, 200)), true)
      if (kind === 'subagent') assert.equal(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, expected)
    }
  }
})

test('auto-index never waits on a slow codegraph: the hook closes within 2 s and the child started', async () => {
  const dir = project('.git')
  const bin = mkdtempSync(join(tmpdir(), 'construct-slowbin-'))
  const marker = join(bin, 'marker.txt')
  writeFileSync(join(bin, 'codegraph'), `#!/bin/sh\nprintf started > "${marker}"\nsleep 5\n`, { mode: 0o755 })
  try {
    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, ...autoEnv(bin) }
    const t0 = Date.now()
    const out = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, 'session'], { env, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.on('error', reject)
      child.on('close', (code) => resolve({ code, stdout }))
      child.stdin.end(JSON.stringify({ ...SESSION, cwd: dir }))
    })
    assert.ok(Date.now() - t0 < 2000, `hook took ${Date.now() - t0} ms`)
    assert.equal(out.code, 0)
    assert.ok(JSON.parse(out.stdout).hookSpecificOutput.additionalContext.includes('was requested and may still fail'))
    assert.ok(waitFor(marker), 'slow fake codegraph never started')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
})

test('every CodeGraph notice variant keeps the session contract under 8,000 characters', () => {
  const dir = project('.git')
  const { bin } = fakeCli()
  const empty = mkdtempSync(join(tmpdir(), 'construct-emptybin-'))
  try {
    const variants = [
      context('session', { ...SESSION, cwd: dir }).additionalContext,
      context('session', { ...SESSION, cwd: dir }, autoEnv(bin)).additionalContext,
      context('session', { ...SESSION, cwd: dir }, { CLAUDE_PLUGIN_OPTION_CODEGRAPH_AUTO_INDEX: 'true', PATH: empty }).additionalContext,
    ]
    const longest = variants.reduce((a, b) => (b.length > a.length ? b : a))
    assert.ok(longest.includes('not on the PATH'), 'CLI-missing variant should be the longest')
    for (const v of variants) assert.ok(v.length <= 8000, `${v.length} chars`)
  } finally {
    for (const d of [dir, bin, empty]) rmSync(d, { recursive: true, force: true })
  }
})

test('the indexing-started notice points at codegraph status, not at .codegraph/ appearing', () => {
  const dir = project('.git')
  const { bin } = fakeCli()
  try {
    const text = context('session', { ...SESSION, cwd: dir }, autoEnv(bin)).additionalContext
    assert.ok(text.includes('codegraph status'))
    assert.ok(!/until `\.codegraph\/`/.test(text))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
})

test('auto-index launches only on startup (or a missing source); resume, clear, and compact get the manual notice with a failure clause', async () => {
  const dir = project('.git')
  const { bin, marker } = fakeCli()
  try {
    for (const source of ['resume', 'clear', 'compact']) {
      const text = context('session', { ...SESSION, source, cwd: dir }, autoEnv(bin)).additionalContext
      assert.ok(text.includes('! codegraph init'), source)
      assert.ok(text.includes('earlier automatic init may have failed'), source)
      assert.ok(!text.includes('was requested and may still fail'), source)
    }
    await new Promise((r) => setTimeout(r, 400))
    assert.ok(!existsSync(marker), 'fake codegraph must not run outside startup')
    const { source, ...noSource } = SESSION
    const text = context('session', { ...noSource, cwd: dir }, autoEnv(bin)).additionalContext
    assert.ok(text.includes('was requested and may still fail'))
    assert.ok(waitFor(marker), 'missing source should launch')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
})

test('every notice variant stays under 8,000 characters for long project paths, including resume with auto-index', () => {
  const { bin } = fakeCli()
  const empty = mkdtempSync(join(tmpdir(), 'construct-emptybin-'))
  const roots = []
  try {
    for (const target of [150, 200]) {
      const base = project()
      roots.push(base)
      const dir = join(base, 'p'.repeat(target - base.length - 1))
      mkdirSync(join(dir, '.git'), { recursive: true })
      assert.equal(dir.length, target)
      for (const source of ['startup', 'resume', 'clear', 'compact']) {
        const variants = [
          context('session', { ...SESSION, source, cwd: dir }).additionalContext,
          context('session', { ...SESSION, source, cwd: dir }, autoEnv(bin)).additionalContext,
          context('session', { ...SESSION, source, cwd: dir }, { CLAUDE_PLUGIN_OPTION_CODEGRAPH_AUTO_INDEX: 'true', PATH: empty }).additionalContext,
        ]
        for (const v of variants) assert.ok(v.length <= 8000, `${source} ${target}: ${v.length} chars`)
      }
    }
  } finally {
    for (const d of [bin, empty, ...roots]) rmSync(d, { recursive: true, force: true })
  }
})
