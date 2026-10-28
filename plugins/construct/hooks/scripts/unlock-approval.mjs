// Unlock approval recorder (PreToolUse and PostToolUse on AskUserQuestion). The user's answer is the only thing that may unlock an oracle, and the
// transcript is a file an agent can write, so the answer is recorded here, in the review store that review-store-guard protects;
// command-guard reads it from there (S2 of .vault/tasks/oracle-autonomy.md).
// Real Claude Code inputs: PreToolUse `tool_input` has only `questions`; PostToolUse `tool_input` and `tool_response` both carry
// `questions`, `answers` ({ <question text>: <label> }) and `annotations` (the harness merges the user's choice into `tool_input`), same `tool_use_id`.
// PreToolUse: a call whose `tool_input` already has `answers` is denied (an agent must not pre-fill answers); otherwise its `tool_use_id`
// is recorded as a clean ask. PostToolUse: the approval is recorded from `tool_response.answers` only when a clean ask exists for that
// `tool_use_id` and session (it is consumed). The record carries the session id: command-guard accepts it only in that session, within 15 minutes.
// Nothing is recorded without a clean ask, when `tool_response.answers` is not an object, or on any error: no record means no unlock (fail closed).
// Usage: node unlock-approval.mjs   (hook JSON on stdin; dispatches on hook_event_name)
import { repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { takeCleanAsk, writeApproval, writeCleanAsk } from './review-store.mjs'

try {
  const input = readInput()
  const ok = input?.tool_name === 'AskUserQuestion' && typeof input.tool_use_id === 'string' && typeof input.session_id === 'string' && input.session_id !== '' && typeof input.cwd === 'string'
  if (ok && input.hook_event_name === 'PreToolUse') {
    if (input.tool_input?.answers !== undefined) {
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'AskUserQuestion must not carry `answers`: the user answers it, an agent never pre-fills them. Ask again with `questions` only.' } })}\n`)
    } else {
      writeCleanAsk(repositoryRoot(input.cwd), { tool_use_id: input.tool_use_id, session_id: input.session_id, at: Date.now() })
    }
  } else if (ok && input.hook_event_name === 'PostToolUse') {
    const answers = input.tool_response?.answers
    const root = repositoryRoot(input.cwd)
    if (answers && typeof answers === 'object' && !Array.isArray(answers) && takeCleanAsk(root, input.tool_use_id, input.session_id)) {
      writeApproval(root, { tool_use_id: input.tool_use_id, session_id: input.session_id, answers, at: Date.now() })
    }
  }
} catch {
  // No record: the unlock stays denied.
}
process.exitCode = 0
