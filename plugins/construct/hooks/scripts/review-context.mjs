// PreToolUse hook on Agent: a construct:review-* lens whose prompt names a
// lineage (review-<16 hex>) gets the full `odd-review context` output as its
// prompt, so the orchestrator never pastes or transcribes the evidence. It also
// records the lineage for review-capture.mjs. A review agent without a lineage,
// or one odd-review refuses, is denied with the reason; other agents and
// prompts that start with a valid binding line pass through. A malformed binding
// line, or one whose lineage differs from another in the prompt, is denied. A prompt naming two
// distinct lineages is denied. A new spawn overwrites the lens's pending record.
// Errors fail open.
// Usage: node review-context.mjs   (hook JSON on stdin)
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { atomicWrite } from '../../lib/review/store.mjs'
import { pendingFile, readInput } from './hook-io.mjs'

const ODD_REVIEW = new URL('../../bin/odd-review', import.meta.url).pathname
const REVIEW_AGENT = /^construct:(review-(?:risk|resilience|readability|reliability|refuter|validator))$/
const LINEAGE = /\breview-[0-9a-f]{16}\b/g
const BINDING = 'ODD_REVIEW_BINDING '

const decide = (permissionDecision, extra) =>
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, ...extra } })}\n`)

// bindingOf reads a leading binding line: null when the prompt has none,
// { error } when the line is malformed, { lineage } otherwise.
function bindingOf(prompt) {
  const first = prompt.split('\n', 1)[0]
  if (!first.startsWith(BINDING)) return null
  let lineage
  try {
    lineage = JSON.parse(first.slice(BINDING.length))?.lineage
  } catch {
    return { error: 'the binding line is not valid JSON' }
  }
  if (typeof lineage !== 'string' || !/^review-[0-9a-f]{16}$/.test(lineage)) {
    return { error: 'its lineage is not a string of the form review-<16 hex>' }
  }
  return { lineage }
}

function main() {
  const input = readInput()
  const toolInput = input?.tool_input
  if (input?.tool_name !== 'Agent' || typeof toolInput?.prompt !== 'string' || typeof input.cwd !== 'string') return
  const match = REVIEW_AGENT.exec(toolInput.subagent_type ?? '')
  if (!match) return
  const [agent, lens] = match
  const pending = pendingFile(input.session_id, agent)

  // The orchestrator pasted the context itself (it starts with the binding
  // line): record its lineage, change nothing.
  const pasted = bindingOf(toolInput.prompt)
  if (pasted) {
    const others = [...new Set(toolInput.prompt.match(LINEAGE) ?? [])].filter((id) => id !== pasted.lineage)
    const problem = pasted.error ?? (others.length > 0 ? `its lineage ${pasted.lineage} differs from ${others.join(', ')} named in the prompt` : null)
    if (problem) {
      decide('deny', {
        permissionDecisionReason: `${agent} has a malformed ODD_REVIEW_BINDING line: ${problem}. Paste the \`odd-review context\` output unchanged, or name one lineage (review-<16 hex>) and let this hook inject it.`,
      })
      return
    }
    atomicWrite(pending, `${JSON.stringify({ lineage: pasted.lineage, lens, cwd: input.cwd, attempts: 0 })}\n`)
    return
  }

  const lineages = [...new Set(toolInput.prompt.match(LINEAGE) ?? [])]
  if (lineages.length > 1) {
    decide('deny', {
      permissionDecisionReason: `${agent} was given ${lineages.length} lineages (${lineages.join(', ')}): name exactly one lineage (review-<16 hex>) in the prompt.`,
    })
    return
  }
  const lineage = lineages[0]
  if (!lineage) {
    decide('deny', {
      permissionDecisionReason: `${agent} needs a review lineage: put its id (review-<16 hex>) from \`odd-review start\` in the prompt, and this hook injects the evidence.`,
    })
    return
  }

  const result = spawnSync('node', [ODD_REVIEW, '--cwd', input.cwd, 'context', '--lineage', lineage, '--lens', lens], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 25_000,
  })
  if (result.status !== 0) {
    rmSync(pending, { force: true })
    decide('deny', { permissionDecisionReason: `odd-review context refused ${lens} for ${lineage}: ${(result.stderr || result.error?.message || '').trim()}` })
    return
  }
  atomicWrite(pending, `${JSON.stringify({ lineage, lens, cwd: input.cwd, attempts: 0 })}\n`)
  decide('allow', {
    permissionDecisionReason: `construct: injected the odd-review context for ${lens} (${lineage})`,
    updatedInput: { ...toolInput, prompt: result.stdout },
  })
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
