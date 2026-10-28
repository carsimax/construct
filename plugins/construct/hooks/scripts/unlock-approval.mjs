// Unlock approval recorder (PostToolUse on AskUserQuestion). The user's answer is the only thing that may unlock an oracle, and the
// transcript is a file an agent can write, so the answer is recorded here, in the review store that review-store-guard protects;
// command-guard reads it from there (S2 of .vault/tasks/oracle-autonomy.md).
// Input relied on: the documented PostToolUse fields `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `cwd`. The shape of an
// AskUserQuestion `tool_response` is not documented; it is read as the transcript's `toolUseResult`: `{ questions, answers: { <question text>: <label> } }`.
// The record carries the session id: command-guard accepts it only in that session, within 15 minutes.
// Nothing is recorded when `tool_input` already carries `answers` (a call that pre-fills its answers, or a hook that supplied them,
// was not answered by the user), when `tool_response.answers` is not an object, or on any error: no record means no unlock (fail closed).
// Usage: node unlock-approval.mjs   (hook JSON on stdin)
import { repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { writeApproval } from './review-store.mjs'

try {
  const input = readInput()
  const answers = input?.tool_response?.answers
  if (input?.tool_name === 'AskUserQuestion' && input.tool_input?.answers === undefined && typeof input.tool_use_id === 'string' && typeof input.session_id === 'string' && input.session_id !== '' && typeof input.cwd === 'string' && answers && typeof answers === 'object' && !Array.isArray(answers)) {
    writeApproval(repositoryRoot(input.cwd), { tool_use_id: input.tool_use_id, session_id: input.session_id, answers, at: Date.now() })
  }
} catch {
  // No record: the unlock stays denied.
}
process.exitCode = 0
