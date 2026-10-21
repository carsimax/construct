import { expect, test } from 'claude-code/testing'
import { agentDoneNotice, resumeNotice, turnDoneNotice } from '../hooks/panel/notices.js'

// Pure notice texts (S6, S7).

test('agentDoneNotice names the agent by its short name and its elapsed time', () => {
  const agent = { role: 'odd_worker', type: 'construct:odd-worker', startedMs: 1000 }
  expect(agentDoneNotice(agent, 1000 + 75_000)).toBe('worker done in 1:15')
  expect(agentDoneNotice({ type: 'Explore', startedMs: 0 + 5 }, 5 + 9000)).toBe('Explore done in 0:09')
})

test('agentDoneNotice drops the elapsed time when the start is unknown', () => {
  expect(agentDoneNotice({ role: 'verify', startedMs: 0 }, 9000)).toBe('verify done')
  expect(agentDoneNotice({ role: 'verify' }, 9000)).toBe('verify done')
  expect(agentDoneNotice(null, 9000)).toBe(null)
})

test('turnDoneNotice speaks only from 60 seconds', () => {
  expect(turnDoneNotice(1000, 1000 + 59_999)).toBe(null)
  expect(turnDoneNotice(1000, 1000 + 59_000)).toBe(null)
  expect(turnDoneNotice(1000, 1000 + 60_000)).toBe('Turn done in 1:00')
  expect(turnDoneNotice(0 + 1, 1 + 3_725_000)).toBe('Turn done in 1h02')
})

test('turnDoneNotice is null without a usable start', () => {
  expect(turnDoneNotice(null, 90_000)).toBe(null)
  expect(turnDoneNotice(undefined, 90_000)).toBe(null)
  expect(turnDoneNotice(0, 90_000)).toBe(null)
  expect(turnDoneNotice(1000, undefined)).toBe(null)
})

test('resumeNotice names the feature, the first open task and the open count', () => {
  const work = { feature: 'harness-extras', open: 2, task: { id: 'T3', title: 'Notifications' }, tasks: [] }
  expect(resumeNotice(work)).toBe('Resume harness-extras: T3 Notifications (2 open)')
})

test('resumeNotice is null with no unfinished task', () => {
  expect(resumeNotice(null)).toBe(null)
  expect(resumeNotice(undefined)).toBe(null)
  expect(resumeNotice({ feature: 'x', open: 0, task: null, tasks: [] })).toBe(null)
})
