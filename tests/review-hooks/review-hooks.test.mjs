// The review hooks, driven as real hooks: review-context.mjs (PreToolUse on Agent)
// and review-capture.mjs (SubagentStop), with the hook JSON on stdin and a
// scratch CLAUDE_PLUGIN_DATA. They run against a real odd-review lineage.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { finding, highRepo, lensResult, readTransaction, scratchDir, start } from '../review/helpers.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const CONTEXT_HOOK = join(PLUGIN, 'hooks/scripts/review-context.mjs')
const CAPTURE_HOOK = join(PLUGIN, 'hooks/scripts/review-capture.mjs')

function hook(script, input, data) {
  const result = spawnSync('node', [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: data, XDG_CONFIG_HOME: scratchDir('odd-hooks-xdg-') },
  })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // No output.
  }
  return { status: result.status, stdout: result.stdout, json }
}

const spawnInput = (repo, prompt, agent = 'construct:review-risk') => ({
  session_id: 's1',
  cwd: repo,
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_input: { description: 'RDD risk lens', prompt, subagent_type: agent },
})

const stopInput = (repo, message, agent = 'construct:review-risk', extra = {}) => ({
  session_id: 's1',
  cwd: repo,
  hook_event_name: 'SubagentStop',
  agent_type: agent,
  agent_id: 'a1',
  last_assistant_message: message,
  stop_hook_active: false,
  ...extra,
})

function lineage() {
  const repo = highRepo()
  const txn = start(repo, { lenses: 'risk,reliability' })
  return { repo, txn, data: scratchDir('odd-hooks-data-') }
}

// The pending record is keyed by lens and lineage: PreToolUse cannot know the child's agent_id.
const pendingOf = (data, txn, agent = 'construct_review-risk') => join(data, 'review-hooks', 's1', `${agent}.${txn.lineage}.json`)

const fenced = (value) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``

describe('registration', () => {
  test('hooks.json wires the context hook on Agent and the capture hook on review agents', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const pre = hooks.PreToolUse.find((entry) => entry.matcher === 'Agent')
    assert.deepEqual(pre.hooks[0], {
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/review-context.mjs'],
      timeout: 30,
    })
    const stop = hooks.SubagentStop.find((entry) => entry.matcher === '^construct:review-')
    assert.deepEqual(stop.hooks[0], {
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/review-capture.mjs'],
      timeout: 30,
    })
  })
})

describe('context hook', () => {
  test('a lineage in the prompt becomes the full odd-review context for that lens', () => {
    const { repo, txn, data } = lineage()
    const r = hook(CONTEXT_HOOK, spawnInput(repo, `Review lineage ${txn.lineage}`), data)
    assert.equal(r.status, 0)
    const out = r.json.hookSpecificOutput
    assert.equal(out.hookEventName, 'PreToolUse')
    assert.equal(out.permissionDecision, 'allow')
    assert.equal(out.updatedInput.subagent_type, 'construct:review-risk')
    assert.equal(out.updatedInput.description, 'RDD risk lens')
    const [binding] = out.updatedInput.prompt.split('\n')
    assert.match(binding, /^ODD_REVIEW_BINDING /)
    assert.equal(JSON.parse(binding.slice('ODD_REVIEW_BINDING '.length)).lens, 'review-risk')
    assert.match(out.updatedInput.prompt, /ODD_REVIEW_CONTEXT_END\n?$/)
  })

  test('other agents pass through untouched', () => {
    const { repo, txn, data } = lineage()
    const r = hook(CONTEXT_HOOK, spawnInput(repo, `Review lineage ${txn.lineage}`, 'construct:odd-worker'), data)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  })

  test('a prompt that starts with the binding line passes through and is recorded for capture', () => {
    const { repo, txn, data } = lineage()
    const pasted = `ODD_REVIEW_BINDING ${JSON.stringify({ lineage: txn.lineage, lens: 'review-risk' })}\nODD_REVIEW_CONTEXT\n...`
    const r = hook(CONTEXT_HOOK, spawnInput(repo, pasted), data)
    assert.equal(r.stdout, '')
    assert.ok(existsSync(pendingOf(data, txn)))
  })

  test('a prompt that only mentions ODD_REVIEW_CONTEXT still gets the context for its lineage', () => {
    const { repo, txn, data } = lineage()
    const r = hook(CONTEXT_HOOK, spawnInput(repo, `use ODD_REVIEW_CONTEXT for ${txn.lineage}`), data)
    assert.match(r.json.hookSpecificOutput.updatedInput.prompt, /^ODD_REVIEW_BINDING /)
  })

  test('a review agent without a lineage is denied with the fix', () => {
    const { repo, data } = lineage()
    const r = hook(CONTEXT_HOOK, spawnInput(repo, 'please review my change'), data)
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /review-<16 hex>/)
  })

  test('a lens the lineage did not select is denied with the odd-review error', () => {
    const { repo, txn, data } = lineage()
    const r = hook(CONTEXT_HOOK, spawnInput(repo, `lineage ${txn.lineage}`, 'construct:review-readability'), data)
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /lens_not_selected/)
  })
})

describe('context hook binding validation', () => {
  const recorded = (data) => (existsSync(join(data, 'review-hooks', 's1')) ? readdirSync(join(data, 'review-hooks', 's1')) : [])
  const binding = (value) => `ODD_REVIEW_BINDING ${typeof value === 'string' ? value : JSON.stringify(value)}`
  const cases = {
    'a lineage that is not a string': (txn) => `${binding({ lineage: 42, lens: 'review-risk' })}\nbody ${txn.lineage}`,
    'a lineage that is not an id': () => `${binding({ lineage: 'nope', lens: 'review-risk' })}\nbody`,
    'a binding that is not JSON': (txn) => `${binding('{oops')}\nbody ${txn.lineage}`,
    'a lineage different from the one in the body': (txn) =>
      `${binding({ lineage: txn.lineage, lens: 'review-risk' })}\nbody review-0123456789abcdef`,
  }
  for (const [name, make] of Object.entries(cases)) {
    test(`${name} is denied and not recorded`, () => {
      const { repo, txn, data } = lineage()
      const r = hook(CONTEXT_HOOK, spawnInput(repo, make(txn)), data)
      assert.equal(r.status, 0)
      assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
      assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /ODD_REVIEW_BINDING/)
      assert.deepEqual(recorded(data), [])
    })
  }

  test('a binding whose lineage matches the body still passes through', () => {
    const { repo, txn, data } = lineage()
    const prompt = `${binding({ lineage: txn.lineage, lens: 'review-risk' })}\nbody ${txn.lineage}`
    const r = hook(CONTEXT_HOOK, spawnInput(repo, prompt), data)
    assert.equal(r.stdout, '')
    assert.ok(existsSync(pendingOf(data, txn)))
  })
})

describe('context hook pasted context with patch text', () => {
  test('a real pasted context whose patch text mentions another lineage id is allowed and recorded', () => {
    const { repo, txn, data } = lineage()
    const out = spawnSync('node', [join(PLUGIN, 'bin/odd-review'), '--cwd', repo, 'context', '--lineage', txn.lineage, '--lens', 'risk'], { encoding: 'utf8' })
    assert.equal(out.status, 0, out.stderr)
    const pasted = out.stdout.replace('ODD_REVIEW_PATH_END 0', '+logged review-0123456789abcdef earlier\nODD_REVIEW_PATH_END 0')
    assert.notEqual(pasted, out.stdout)
    const r = hook(CONTEXT_HOOK, spawnInput(repo, pasted), data)
    assert.equal(r.stdout, '')
    assert.ok(existsSync(pendingOf(data, txn)))
  })
})

describe('context hook ambiguity', () => {
  const recorded = (data) => (existsSync(join(data, 'review-hooks', 's1')) ? readdirSync(join(data, 'review-hooks', 's1')) : [])

  test('a prompt naming two distinct lineages is denied with a message to name one', () => {
    const { repo, txn, data } = lineage()
    const r = hook(CONTEXT_HOOK, spawnInput(repo, `Review ${txn.lineage} and review-0123456789abcdef`), data)
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /exactly one lineage/)
    assert.deepEqual(recorded(data), [])
  })

  test('the same lineage named twice is allowed and gets the context', () => {
    const { repo, txn, data } = lineage()
    const r = hook(CONTEXT_HOOK, spawnInput(repo, `Review ${txn.lineage} (again: ${txn.lineage})`), data)
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'allow')
    assert.match(r.json.hookSpecificOutput.updatedInput.prompt, /^ODD_REVIEW_BINDING /)
  })

  test('a lens spawn after an empty-reply stop is allowed and gets the context again', () => {
    const { repo, txn, data } = lineage()
    const prompt = `Review lineage ${txn.lineage}`
    assert.equal(hook(CONTEXT_HOOK, spawnInput(repo, prompt), data).json.hookSpecificOutput.permissionDecision, 'allow')
    hook(CAPTURE_HOOK, stopInput(repo, ''), data)
    const again = hook(CONTEXT_HOOK, spawnInput(repo, prompt), data)
    assert.equal(again.json.hookSpecificOutput.permissionDecision, 'allow')
    assert.match(again.json.hookSpecificOutput.updatedInput.prompt, /^ODD_REVIEW_BINDING /)
  })
})

describe('capture hook', () => {
  const spawned = (repo, txn, data, agent = 'construct:review-risk') =>
    hook(CONTEXT_HOOK, spawnInput(repo, `Review lineage ${txn.lineage}`, agent), data)

  test('a fenced reply is captured for the lens and the stop is allowed', () => {
    const { repo, txn, data } = lineage()
    spawned(repo, txn, data)
    const reply = fenced(lensResult(txn.subjects['review-risk'], txn.manifest))
    const r = hook(CAPTURE_HOOK, stopInput(repo, reply), data)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
    assert.ok(readTransaction(repo, txn.lineage).results['review-risk'])
  })

  // A background lens hands its report back through the SubagentHandback tool,
  // so its final message has no text: the hook reads the agent's transcript.
  const transcript = (entries) => {
    const file = join(scratchDir('odd-hooks-transcript-'), 'agent.jsonl')
    writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    return file
  }
  const handback = (message) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message } }] } })

  test('a transcript part of type text without text is skipped and the reply is still captured', () => {
    const { repo, txn, data } = lineage()
    spawned(repo, txn, data)
    const report = fenced(lensResult(txn.subjects['review-risk'], txn.manifest))
    const path = transcript([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text' }, { type: 'text', text: report }, { type: 'text', text: null }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text' }] } },
    ])
    const r = hook(CAPTURE_HOOK, stopInput(repo, undefined, 'construct:review-risk', { agent_transcript_path: path }), data)
    assert.equal(r.stdout, '')
    assert.ok(readTransaction(repo, txn.lineage).results['review-risk'])
  })

  test('a background lens reply delivered through SubagentHandback is captured from the transcript', () => {
    const { repo, txn, data } = lineage()
    spawned(repo, txn, data)
    const report = JSON.stringify(lensResult(txn.subjects['review-risk'], txn.manifest))
    const path = transcript([{ type: 'user', message: { role: 'user', content: 'ODD_REVIEW_BINDING ...' } }, handback(report)])
    const r = hook(CAPTURE_HOOK, stopInput(repo, '', 'construct:review-risk', { agent_transcript_path: path }), data)
    assert.equal(r.stdout, '')
    assert.ok(readTransaction(repo, txn.lineage).results['review-risk'])
  })

  test('without a handback, the last assistant text in the transcript is captured', () => {
    const { repo, txn, data } = lineage()
    spawned(repo, txn, data)
    const report = fenced(lensResult(txn.subjects['review-risk'], txn.manifest))
    const path = transcript([{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: report }] } }])
    const r = hook(CAPTURE_HOOK, stopInput(repo, undefined, 'construct:review-risk', { agent_transcript_path: path }), data)
    assert.equal(r.stdout, '')
    assert.ok(readTransaction(repo, txn.lineage).results['review-risk'])
  })

  test('the last lens reduces the lineage', () => {
    const { repo, txn, data } = lineage()
    for (const lens of ['review-risk', 'review-reliability']) {
      spawned(repo, txn, data, `construct:${lens}`)
      hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(lensResult(txn.subjects[lens], txn.manifest)), `construct:${lens}`), data)
    }
    assert.equal(readTransaction(repo, txn.lineage).state, 'approved')
  })

  test('an invalid reply blocks with the validator message, at most twice', () => {
    const { repo, txn, data } = lineage()
    spawned(repo, txn, data)
    const bad = JSON.stringify(lensResult(txn.subjects['review-risk'], txn.manifest, [finding({ evidence_class: 'static-analysis' })]))
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = hook(CAPTURE_HOOK, stopInput(repo, bad, 'construct:review-risk', { stop_hook_active: attempt > 0 }), data)
      assert.equal(r.json.decision, 'block')
      assert.match(r.json.reason, /invalid_result/)
      assert.match(r.json.reason, /evidence_class/)
    }
    const third = hook(CAPTURE_HOOK, stopInput(repo, bad, 'construct:review-risk', { stop_hook_active: true }), data)
    assert.equal(third.stdout, '')
    assert.equal(readTransaction(repo, txn.lineage).results['review-risk'], undefined)
  })

  test('a corrected reply after a block is captured', () => {
    const { repo, txn, data } = lineage()
    spawned(repo, txn, data)
    hook(CAPTURE_HOOK, stopInput(repo, 'not json'), data)
    const r = hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(lensResult(txn.subjects['review-risk'], txn.manifest)), 'construct:review-risk', { stop_hook_active: true }), data)
    assert.equal(r.stdout, '')
    assert.ok(readTransaction(repo, txn.lineage).results['review-risk'])
  })

  test('an agent the context hook did not prepare is left alone', () => {
    const { repo, txn, data } = lineage()
    const r = hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(lensResult(txn.subjects['review-risk'], txn.manifest))), data)
    assert.equal(r.stdout, '')
    assert.equal(readTransaction(repo, txn.lineage).results['review-risk'], undefined)
  })

  test('two concurrent reviews of the same lens each capture into their own lineage, in any stop order', () => {
    const one = lineage()
    const two = lineage()
    const data = one.data
    spawned(one.repo, one.txn, data)
    spawned(two.repo, two.txn, data)
    const reply = (txn) => JSON.stringify(lensResult(txn.subjects['review-risk'], txn.manifest))
    assert.equal(hook(CAPTURE_HOOK, stopInput(two.repo, reply(two.txn), 'construct:review-risk', { agent_id: 'b2' }), data).stdout, '')
    assert.equal(hook(CAPTURE_HOOK, stopInput(one.repo, reply(one.txn), 'construct:review-risk', { agent_id: 'a1' }), data).stdout, '')
    assert.ok(readTransaction(one.repo, one.txn.lineage).results['review-risk'])
    assert.ok(readTransaction(two.repo, two.txn.lineage).results['review-risk'])
    assert.deepEqual(readdirSync(join(data, 'review-hooks', 's1')), [])
  })

  test('a lens that is already captured counts as done and the pending record is cleared', () => {
    const { repo, txn, data } = lineage()
    spawned(repo, txn, data)
    const reply = JSON.stringify(lensResult(txn.subjects['review-risk'], txn.manifest))
    hook(CAPTURE_HOOK, stopInput(repo, reply), data)
    spawned(repo, txn, data)
    const again = hook(CAPTURE_HOOK, stopInput(repo, reply), data)
    assert.equal(again.stdout, '')
    assert.equal(existsSync(pendingOf(data, txn)), false)
  })
})
