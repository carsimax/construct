// Memory hooks over the per-repository store. Every mode fails open: any problem
// produces no output and exit code 0; outside a git repository nothing happens.
// Usage: node memory-hooks.mjs session|compact|prompt|capture  (hook JSON on stdin)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, readInput, safeName } from './hook-io.mjs'
import { normalizedHash, openMemory } from './memory-store.mjs'

const REMIND_AFTER_MS = 15 * 60 * 1000
const MIN_SESSION_MS = 5 * 60 * 1000
const SKIPPED_PROMPT = /^\s*(<task-notification>|<agent-message)/
const SECTION = /^(key learnings|learnings|aprendizajes( \(clave\)| clave)?)\s*:?$/i
const MIN_CHARS = 20
const MIN_WORDS = 4

const emit = (event, additionalContext) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }))

const stateFile = (session) => join(dataDir(), 'memory-hooks', `${safeName(session)}.json`)
const readState = (session) => {
  try {
    return JSON.parse(readFileSync(stateFile(session), 'utf8'))
  } catch {
    return {}
  }
}
const writeState = (session, state) => {
  mkdirSync(join(dataDir(), 'memory-hooks'), { recursive: true })
  writeFileSync(stateFile(session), JSON.stringify(state))
}

// learnings returns the items of the last Key Learnings section that has any: numbered items,
// else bullets, markdown emphasis stripped, short items dropped.
export function learnings(text) {
  const sections = []
  for (const line of String(text).split('\n')) {
    const heading = /^#{2,3}\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) sections.push({ title: heading[1].replace(/[*`]/g, '').trim(), lines: [] })
    else if (/^#{1,6}\s/.test(line)) sections.push({ title: '', lines: [] })
    else sections.at(-1)?.lines.push(line)
  }
  for (const { title, lines } of sections.reverse()) {
    if (!SECTION.test(title)) continue
    const pick = (re) => lines.map((l) => re.exec(l)?.[1]).filter((x) => x !== undefined)
    const items = pick(/^\s*\d+[.)]\s+(.*)$/)
    const found = (items.length ? items : pick(/^\s*[-*]\s+(.*)$/)).map((i) => i.replace(/[*`]/g, '').trim()).filter((i) => [...i].length >= MIN_CHARS && i.split(/\s+/).length >= MIN_WORDS)
    if (found.length) return found
  }
  return []
}

async function main() {
  const mode = process.argv[2]
  const input = readInput()
  if (!input || !['session', 'compact', 'prompt', 'capture'].includes(mode)) return
  const memory = openMemory(input.cwd || process.cwd())
  if (!memory) return
  const session = input.session_id || 'unknown'
  try {
    if (mode === 'session' || mode === 'compact') {
      memory.startSession(session)
      const state = readState(session)
      if (!state.started) writeState(session, { ...state, started: new Date().toISOString() })
      let text = `${memory.context()}\nMemory: construct-memory (session ${session}); \`construct-memory help\` lists commands.`.trim()
      if (mode === 'compact') text += `\n\nContext was compacted. Before anything else, save the compacted summary above with \`construct-memory summary --session ${session}\`, then continue with the task.`
      emit('SessionStart', text)
    } else if (mode === 'prompt') {
      const prompt = String(input.prompt ?? '')
      if (prompt.trim() !== '' && !SKIPPED_PROMPT.test(prompt)) memory.addPrompt(session, prompt)
      const now = Date.now()
      const state = readState(session)
      if (!state.started) return writeState(session, { ...state, started: new Date(now).toISOString() })
      const lastSave = Date.parse(memory.lastSaveAt() ?? '') || 0
      if (now - Date.parse(state.started) < MIN_SESSION_MS || now - lastSave < REMIND_AFTER_MS || now - (Date.parse(state.reminded) || 0) < REMIND_AFTER_MS) return
      writeState(session, { ...state, reminded: new Date(now).toISOString() })
      emit('UserPromptSubmit', 'Memory: nothing saved in the last 15 minutes; if you decided, fixed, or learned something worth keeping, save it with `construct-memory save`.')
    } else if (typeof input.last_assistant_message === 'string') {
      for (const item of learnings(input.last_assistant_message)) {
        if (memory.hasHash(normalizedHash(item))) continue
        const chars = [...item.replace(/\s+/g, ' ')]
        memory.save({ title: chars.length > 60 ? `${chars.slice(0, 60).join('')}...` : chars.join(''), content: item, type: 'passive', session_id: session })
      }
    }
  } finally {
    memory.close()
  }
}

main().catch(() => {})
