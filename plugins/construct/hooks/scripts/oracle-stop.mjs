// The oracle decides when a worker stops (S4, S5, S6 of .vault/tasks/oracle-limits.md). Modes:
//   stop (SubagentStop on construct:worker): for a worker whose Spec task has an oracle envelope (envelope.mjs, stored by
//     oracle-record.mjs) and a task state (delegation-admission.mjs start):
//       - a spent budget (attempts or minutes, spentBudget) allows the stop with a message naming it, so the reply reports the failure;
//       - the diff since the task start (the state's baseTree against a fresh snapshot of the working tree, whatever tool wrote it,
//         docs and .vault/ excluded) must stay inside the envelope surfaces and its changed-line budget, else the stop is blocked
//         naming the paths and counts, and one attempt is spent;
//       - the envelope command, when it has one, runs at the repository root (timeout: the remaining minutes, at most 300 s):
//         exit 0 allows the stop; a failure blocks with the tail of its output and what remains of the budget. A failed run
//         spends one attempt unless its passing-test count rose above the best so far (S5: progress, not command text).
//     A run that spends the last attempt, or the last minute, allows the stop instead of blocking.
//   bash (PostToolUseFailure on Bash): a failed run of the envelope command by a worker spends one attempt, by the same rule.
// Block = {"decision":"block","reason":...} on stdout, as review-capture.mjs does. Any internal error allows (fail open).
// shortcut: the diff is of the whole working tree since the task start, so a concurrent worker or the main thread writing code
// in that time counts against this worker; upgrade with per-agent snapshots if it blocks wrongly in real use.
// Usage: node oracle-stop.mjs stop|bash   (hook JSON on stdin)
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { firstUserPrompt, specOf, surfaceContains, writerRecord } from './delegation-admission.mjs'
import { isFree, spentBudget } from './envelope.mjs'
import { freezeWorkingTree, git, repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { qualified } from './roles.mjs'
import { readEnvelope, readTaskState, writeTaskState } from './review-store.mjs'

const MAX_RUN_MS = 300_000
const PASS = [/ℹ pass (\d+)/, /^# pass (\d+)/m, /(\d+) passed/, /(\d+) passing/]

// passCount: the passing-test count of a test run's output, or null when no common pattern is present.
export function passCount(output) {
  for (const pattern of PASS) {
    const match = pattern.exec(output)
    if (match) return Number(match[1])
  }
  return null
}

const tail = (text) => text.split('\n').slice(-40).join('\n').slice(-4000)
const say = (key, value) => process.stdout.write(`${JSON.stringify({ [key]: value })}\n`)
const left = (state, envelope, now) =>
  `${envelope.attempts - state.attempts} attempt${envelope.attempts - state.attempts === 1 ? '' : 's'} and ${Math.max(0, Math.round((envelope.minutes * 60_000 - (now - state.startedAt)) / 60_000))} minutes left`

// failedRun spends one attempt unless the passing count rose above the best so far (then it raises the best); returns the new state.
function failedRun(state, output) {
  const pass = passCount(output)
  return pass !== null && pass > (state.bestPass ?? 0) ? { ...state, bestPass: pass } : { ...state, attempts: state.attempts + 1 }
}

// outsideDiff: why the diff between two trees breaks the envelope, or null. Docs and .vault/ are not counted.
function diffProblem(root, baseTree, tree, envelope) {
  const fields = git(root, ['diff', '--numstat', '--no-renames', '-z', baseTree, tree]).toString('utf8').split('\0').filter(Boolean)
  let lines = 0
  const outside = []
  for (const field of fields) {
    const [added, deleted, ...path] = field.split('\t')
    const name = path.join('\t')
    if (isFree(name)) continue
    lines += (Number(added) || 0) + (Number(deleted) || 0)
    if (!envelope.surfaces.some((surface) => surfaceContains(surface, name))) outside.push(name)
  }
  const problems = []
  if (outside.length) problems.push(`changed paths outside the envelope surfaces (${envelope.surfaces.join(', ')}): ${outside.slice(0, 10).join(', ')}`)
  if (lines > envelope.lines) problems.push(`${lines} changed lines (added plus deleted), the envelope allows ${envelope.lines}`)
  return problems.length ? problems.join('; ') : null
}

function stop(input) {
  const prompt = typeof input.agent_transcript_path === 'string' ? firstUserPrompt(input.agent_transcript_path) : undefined
  const spec = prompt && specOf(prompt)
  if (!spec) return
  const root = repositoryRoot(input.cwd)
  const envelope = readEnvelope(root, spec.feature, spec.task)
  if (!envelope) return
  const now = Date.now()
  let state = readTaskState(root, spec.feature, spec.task) ?? { attempts: 0, bestPass: null, startedAt: now, baseTree: null, budget: { attempts: envelope.attempts, minutes: envelope.minutes } }
  const save = (next) => {
    state = next
    writeTaskState(root, spec.feature, spec.task, state)
  }
  const spent = () => spentBudget(state, envelope)
  // refuse records the run, then blocks the stop with the reason and what remains, unless that run spent the budget.
  const refuse = (reason, next) => {
    save(next)
    if (spent()) say('systemMessage', `oracle-stop: ${spent()}; the stop is allowed. Report what is still failing. ${reason}`)
    else process.stdout.write(`${JSON.stringify({ decision: 'block', reason: `${reason}\n(${left(state, envelope, Date.now())})` })}\n`)
  }
  if (spent()) return say('systemMessage', `oracle-stop: ${spent()}; the stop is allowed. Report what is still failing.`)
  if (state.baseTree) {
    const problem = diffProblem(root, state.baseTree, freezeWorkingTree(root).candidateTree, envelope)
    if (problem) return refuse(`Your diff breaks the oracle envelope: ${problem}. Revert it, or return needs_interaction.`, { ...state, attempts: state.attempts + 1 })
  }
  if (envelope.command === null) return
  const remaining = envelope.minutes * 60_000 - (now - state.startedAt)
  const run = spawnSync('sh', ['-c', envelope.command], { cwd: root, encoding: 'utf8', timeout: Math.min(remaining, MAX_RUN_MS), maxBuffer: 10 << 20 })
  if (run.status === 0) return
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}`
  const reason = `The oracle command \`${envelope.command}\` is red; keep working until it passes.\n${tail(output)}`
  refuse(reason, failedRun(state, output))
}

function bash(input) {
  if (typeof input.agent_id !== 'string' || input.agent_id === '' || typeof input.tool_input?.command !== 'string') return
  const spec = writerRecord(input.session_id, input.agent_id)?.spec
  if (!spec) return
  const root = repositoryRoot(input.cwd)
  const envelope = readEnvelope(root, spec.feature, spec.task)
  if (!envelope?.command || input.tool_input.command.trim() !== envelope.command) return
  const state = readTaskState(root, spec.feature, spec.task) ?? { attempts: 0, bestPass: null, startedAt: Date.now(), baseTree: null, budget: { attempts: envelope.attempts, minutes: envelope.minutes } }
  writeTaskState(root, spec.feature, spec.task, failedRun(state, typeof input.error === 'string' ? input.error : ''))
}

function main() {
  const input = readInput()
  if (!input || typeof input.cwd !== 'string') return
  if (process.argv[2] === 'bash') bash(input)
  else if (input.agent_type === qualified('worker')) stop(input)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    main()
  } catch {
    // Fail open: no output, exit 0.
  }
  process.exitCode = 0
}
