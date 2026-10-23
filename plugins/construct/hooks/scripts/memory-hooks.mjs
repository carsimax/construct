// Memory hooks over the per-repository store. Every mode fails open: any problem
// produces no output and exit code 0; outside a git repository nothing happens.
// Usage: node memory-hooks.mjs session|compact|prompt|capture|end  (hook JSON on stdin)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir, readInput, safeName } from './hook-io.mjs'

const REMIND_AFTER_MS = 15 * 60 * 1000
const MIN_SESSION_MS = 5 * 60 * 1000
// Harness notices delivered as user prompts: tags, subagent or background-job completion lines, review-binding, todo, and stop-hook notices.
const SKIPPED_PROMPT = /^\s*(<task-notification>|<agent-message|Subagent \S+ \(task |Background job \S+ \(|GENTLE_AI_REVIEW_BINDING |Current todo list:|The todo plan has not been reviewed|Stop hook feedback:)/
const SECTION = /^(key learnings|learnings|aprendizajes( \(clave\)| clave)?)\s*:?$/i
const MIN_CHARS = 20
const MIN_WORDS = 4
const TITLE_MAX = 80

// The plugin bin/ is not on PATH in every environment (for example the eval sandbox), so name the absolute form.
const CLI = join(process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'bin', 'construct-memory')

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

// titleOf is the item's first sentence; past TITLE_MAX characters it is cut at the last word within it, with "...".
export function titleOf(item) {
  const sentence = item.replace(/\s+/g, ' ').split(/(?<=[.!?]) /)[0]
  const chars = [...sentence]
  if (chars.length <= TITLE_MAX) return sentence
  const head = chars.slice(0, TITLE_MAX + 1).join('')
  const cut = head.lastIndexOf(' ')
  return `${(cut > 0 ? head.slice(0, cut) : chars.slice(0, TITLE_MAX).join('')).trimEnd()}...`
}

// reason shortens a store failure to a phrase for the SessionStart line.
function reason(error) {
  const msg = String(error?.message ?? error)
  if (/newer construct/i.test(msg)) return 'newer schema'
  if (/readonly|read-only|unable to open|EACCES|EROFS|EPERM/i.test(msg)) return 'not writable'
  if (/SQLITE_BUSY|database is locked/i.test(msg)) return 'busy, try again'
  if (/sqlite|fts5|trigram|ERR_UNKNOWN_BUILTIN_MODULE/i.test(msg)) return 'node:sqlite or fts5 missing'
  return [...(msg.split('\n')[0] || 'unknown error')].slice(0, 120).join('')
}

async function main() {
  const mode = process.argv[2]
  const input = readInput()
  if (!input || !['session', 'compact', 'prompt', 'capture', 'end'].includes(mode)) return
  // Loaded here, not at the top, so a Node without node:sqlite fails open instead of crashing on import.
  // session and compact say why memory is off; prompt and capture stay silent.
  const visible = mode === 'session' || mode === 'compact'
  let memory
  let normalizedHash
  let injects
  try {
    const store = await import('./memory-store.mjs')
    normalizedHash = store.normalizedHash
    injects = store.injects
    memory = store.openMemory(input.cwd || process.cwd())
  } catch (error) {
    if (visible) emit('SessionStart', `Memory: unavailable (${reason(error)}); run construct-memory doctor`)
    return
  }
  if (!memory) return
  const session = input.session_id || 'unknown'
  try {
    if (mode === 'session' || mode === 'compact') {
      memory.startSession(session)
      const state = readState(session)
      if (!state.started) writeState(session, { ...state, started: new Date().toISOString() })
      let text = `${memory.context()}\nMemory: the construct memory MCP tools (mem_search, mem_save, mem_context, ...) or \`construct-memory\` (session ${session}); \`construct-memory help\` lists commands. If construct-memory is not found, run node "${CLI}" instead.`.trim()
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
    } else if (mode === 'end') {
      memory.closeSession(session)
    } else if (typeof input.last_assistant_message === 'string') {
      for (const item of learnings(input.last_assistant_message)) {
        if (injects(item) || memory.hasHash(normalizedHash(item)) || memory.similarPassive(item)) continue
        memory.save({ title: titleOf(item), content: item, type: 'passive', session_id: session })
      }
    }
  } finally {
    memory.close()
  }
}

main().catch(() => {})
