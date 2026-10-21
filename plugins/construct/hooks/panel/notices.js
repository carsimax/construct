// Pure texts for the panel's notifications (S6) and the resume notice (S7). No `$` calls live here;
// register.js decides when to show them.
import { clock } from './layout.js'
import { shortName } from './state.js'

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)

// A main turn shorter than this raises no notice.
export const TURN_NOTICE_MS = 60_000

// `<short name> done in <elapsed>`; without a known start, `<short name> done`.
export function agentDoneNotice(agent, nowMs) {
  if (typeof agent !== 'object' || agent === null) return null
  const name = shortName(agent)
  if (!isNum(agent.startedMs) || agent.startedMs <= 0 || !isNum(nowMs)) return `${name} done`
  return `${name} done in ${clock(nowMs - agent.startedMs)}`
}

// `Turn done in <duration>` for a turn of 60 s or more, else null.
export function turnDoneNotice(startedMs, nowMs) {
  if (!isNum(startedMs) || startedMs <= 0 || !isNum(nowMs)) return null
  const ms = nowMs - startedMs
  return ms >= TURN_NOTICE_MS ? `Turn done in ${clock(ms)}` : null
}

// `Resume <feature>: <task id> <title> (<n> open)` from activeWork(), null with no unfinished task.
export function resumeNotice(work) {
  if (!work || !work.task || !(work.open > 0)) return null
  return `Resume ${work.feature}: ${work.task.id} ${work.task.title} (${work.open} open)`
}
