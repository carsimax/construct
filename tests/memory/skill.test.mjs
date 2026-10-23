// S11 (P8, P17): the memory skill names the store's types, relations, commands, and flags, and nothing the code lacks.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'construct')
const skill = readFileSync(join(plugin, 'skills', 'memory', 'SKILL.md'), 'utf8')
const { REVIEW_MONTHS, RELATIONS } = await import(join(plugin, 'hooks', 'scripts', 'memory-store.mjs'))
const help = execFileSync('node', [join(plugin, 'bin', 'construct-memory'), 'help'], { encoding: 'utf8' })

// ticks lists the backticked words on the skill line that starts with `label`.
const ticks = (label) => {
  const line = skill.split('\n').find((l) => l.startsWith(label))
  assert.ok(line, `skill has a "${label}" line`)
  return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1])
}

test('the skill lists the store review types, plus the two written only by the CLI and a hook', () => {
  assert.deepEqual(ticks('Types:').sort(), Object.keys(REVIEW_MONTHS).sort())
  assert.deepEqual(ticks('Not for save:').sort(), ['manual', 'passive'])
  assert.match(readFileSync(join(plugin, 'hooks', 'scripts', 'memory-hooks.mjs'), 'utf8'), /type: 'passive'/)
  assert.match(readFileSync(join(plugin, 'hooks', 'scripts', 'memory-store.mjs'), 'utf8'), /type = 'manual'/)
})

test('the skill relation list equals the store and CLI lists', () => {
  assert.deepEqual(ticks('Relations:'), RELATIONS)
  assert.ok(help.includes(`relations: ${RELATIONS.join(', ')}`))
})

test('every construct-memory command and flag the skill names is in the help output', () => {
  const commands = [...skill.matchAll(/`construct-memory ([a-z-]+)(?: (list|stale|done|delete))?/g)]
  assert.ok(commands.length > 10, 'the skill names the commands')
  for (const [, command, sub] of commands) assert.ok(help.includes(`${command}${sub ? ` ${sub}` : ''}`), `${command} ${sub ?? ''}`)
  for (const flag of new Set(skill.match(/--[a-z][a-z-]*/g))) assert.ok(help.includes(flag), flag)
})

test('the skill review months equal the store values', () => {
  const line = skill.match(/in months: ([^.]+)\./)?.[1]
  assert.ok(line, 'the skill lists the months')
  const listed = Object.fromEntries(line.split(', ').map((e) => e.split(' ')).map(([t, m]) => [t, Number(m)]))
  assert.deepEqual(listed, REVIEW_MONTHS)
})

// S3 of odd/tasks/memory-mcp-first.md: the intro maps each tool-backed command to its tool, tool first.
test('the skill intro maps every MCP tool to its CLI command and says to call the tool first', () => {
  const intro = skill.split('\n').find((l) => l.startsWith('One SQLite store'))
  const pairs = [['mem_save', 'save'], ['mem_search', 'search'], ['mem_context', 'context'], ['mem_get_observation', 'get'], ['mem_update', 'update'], ['mem_timeline', 'timeline'], ['mem_session_summary', 'summary'], ['mem_judge', 'judge'], ['mem_suggest_topic_key', 'suggest-topic-key'], ['mem_relations_pending', 'relations pending']]
  for (const [tool, command] of pairs) assert.ok(intro.includes(`\`${tool}\` (\`${command}\`)`), `${tool} (${command})`)
  assert.match(intro, /Call the tool; run the CLI only when the tool is missing or the command is CLI-only/)
})
