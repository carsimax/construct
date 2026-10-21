// Destructive command rules for secret-guard.mjs (S1, gentle-parity). Port of gentle-shell
// lib/destructive-command-guard.ts and the hard-deny and confirm tiers of extensions/gentle-ai.ts.
// Pure: no I/O. secret-guard passes in its own shell-word splitter, so there is one tokenizer.
//   tier "deny": never allowed.   tier "ask": the user confirms; inside a subagent it is a deny.
import { basename } from 'node:path'

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3'])
const DATA_COMMANDS = new Set(['echo', 'printf'])
const MAX_DEPTH = 4
// Words that keep command position for the next word, and the flags of each that take a value.
// shortcut: wrapper flags are skipped by shape (a leading `-`, plus the listed value flags);
// upgrade to per-wrapper grammars if a wrapper hides a command behind an unlisted value flag.
const WRAPPERS = {
  sudo: new Set(['-u', '-g', '-C', '-h', '-p', '-r', '-t', '-U', '-D']),
  command: new Set(),
  builtin: new Set(),
  env: new Set(['-u', '-C', '-S']),
  nohup: new Set(),
  time: new Set(),
  exec: new Set(['-a']),
  xargs: new Set(['-n', '-I', '-L', '-P', '-s', '-d', '-E', '-a', '-l', '-i']),
  nice: new Set(['-n']),
  ionice: new Set(['-c', '-n', '-p']),
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  '!': new Set(),
  '{': new Set(),
  if: new Set(),
  then: new Set(),
  else: new Set(),
  elif: new Set(),
  do: new Set(),
  while: new Set(),
  until: new Set(),
}
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

// headIndex is the index of the word that names the command: past assignments, wrappers,
// and their flags (and the duration `timeout` takes).
function headIndex(texts) {
  let i = 0
  while (i < texts.length) {
    const w = basename(texts[i])
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(texts[i])) i++
    else if (Object.hasOwn(WRAPPERS, w)) {
      const values = WRAPPERS[w]
      i++
      let first = true
      while (i < texts.length) {
        if (texts[i] === '--') { i++; break }
        if (texts[i].startsWith('-') && texts[i].length > 1) i += values.has(texts[i]) ? 2 : 1
        else if (w === 'timeout' && first) i++
        else if (w === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(texts[i])) i++
        else break
        first = false
      }
    } else break
  }
  return i
}

const hasFlag = (args, short, long) => args.some((a) => (long && (a === long || a.startsWith(`${long}=`))) || (/^-[^-]/.test(a) && a.slice(1).includes(short)))

// sqlDestroys: DROP, TRUNCATE, or DELETE FROM without a real WHERE, after comments and
// string literals are removed (a table named "where" is not a predicate).
function sqlDestroys(sql) {
  const code = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:\]\]|[^\]])*\]/g, (raw) => (/^["`[]/.test(raw) ? 'identifier' : ' '))
  return code.split(';').some((statement) => {
    if (/^\s*(?:DROP\s+(?:TABLE|DATABASE|SCHEMA|INDEX|VIEW)\b|TRUNCATE\s+(?:TABLE\s+)?\S)/i.test(statement)) return true
    if (!/^\s*DELETE\s+FROM\s+\S/i.test(statement)) return false
    return !/\bWHERE\b/i.test(statement) || /\bWHERE\s+(?:1\s*=\s*1|TRUE)\s*$/i.test(statement.trim())
  })
}

const HEREDOC_RE = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=\n|$)/g

// extractHeredocs removes heredoc bodies from the command (they are data) and returns them
// with the header line they belong to, so a body fed to a shell or SQL client is checked.
function extractHeredocs(command) {
  const bodies = []
  const text = command.replace(HEREDOC_RE, (raw, _q, _tag, offset) => {
    const nl = raw.indexOf('\n')
    const lineStart = command.lastIndexOf('\n', offset - 1) + 1
    const header = command.slice(lineStart, offset) + raw.slice(0, nl)
    bodies.push({ header, body: raw.slice(nl + 1, raw.lastIndexOf('\n')) })
    return raw.slice(0, nl)
  })
  return { text, bodies }
}

// substitutionBodies lists the bodies of $(...), <(...), >(...), and backticks outside
// single quotes. A body is a command line of its own.
function substitutionBodies(command) {
  const out = []
  let quote = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote === "'") {
      if (c === "'") quote = null
    } else if (c === '\\') i++
    else if (c === "'" && quote === null) quote = "'"
    else if (c === '"') quote = quote === '"' ? null : '"'
    else if ((c === '$' || c === '<' || c === '>') && command[i + 1] === '(' && (c === '$' || quote === null)) {
      let depth = 1
      let j = i + 2
      for (; j < command.length && depth > 0; j++) {
        if (command[j] === '(') depth++
        else if (command[j] === ')') depth--
      }
      out.push(command.slice(i + 2, depth === 0 ? j - 1 : j))
    } else if (c === '`') {
      let j = i + 1
      while (j < command.length && command[j] !== '`') j += command[j] === '\\' ? 2 : 1
      out.push(command.slice(i + 1, j).replace(/\\([\\$`])/g, '$1'))
      i = j
    }
  }
  return out
}

// shortcut: `~/sub` and `$HOME/sub` are an ask (rm -r), not a deny as upstream has them; S1 lists only
// the roots themselves. Upgrade if a deny for home subtrees is wanted.
const ROOTISH = /^(?:\/(?:\*+)?|\.{1,2}\/?|~\/?|\$\{?HOME\}?\/?)$/

// gitMatches: rules for one `git` invocation (args are the words after `git`).
function gitMatches(args, add) {
  let i = 0
  while (args[i]?.startsWith('-')) i += GIT_VALUE_FLAGS.has(args[i]) ? 2 : 1
  const action = args[i]
  const flags = args.slice(i + 1)
  const force = flags.some((a) => /^--force/.test(a) || /^-[^-]*f/.test(a))
  if (action === 'reset' && flags.includes('--hard')) add('deny', 'git reset --hard')
  else if (action === 'clean' && force && (flags.includes('--directories') || flags.some((a) => /^-[^-]*d/.test(a)))) add('deny', 'git clean -fd')
  else if (action === 'clean' && force) add('ask', 'git clean -f')
  else if (action === 'push' && force) add('deny', 'force push')
  else if (action === 'push') add('ask', 'git push')
  else if (action === 'rebase') add('ask', 'git rebase')
  else if (action === 'restore') add('ask', 'git restore')
  else if (action === 'checkout' && flags.includes('--')) add('ask', 'git checkout -- <path>')
  else if (action === 'checkout' && force) add('ask', 'git checkout -f')
  else if (action === 'stash' && (flags[0] === 'drop' || flags[0] === 'clear')) add('ask', `git stash ${flags[0]}`)
  else if (action === 'branch' && (flags.some((a) => /^-[^-]*D/.test(a)) || (force && (flags.includes('--delete') || flags.some((a) => /^-[^-]*d/.test(a)))))) add('ask', 'git branch -D')
}

// findMatches returns [{ tier, rule }] for a command line, unwrapping nested shells.
function findMatches(command, deps, depth = 0) {
  if (depth > MAX_DEPTH) return []
  const { split, expand } = deps
  const matches = []
  const add = (tier, rule) => matches.push({ tier, rule })
  const { text, bodies } = extractHeredocs(command)
  const nested = (line) => matches.push(...findMatches(line, deps, depth + 1))

  for (const body of substitutionBodies(text)) nested(body)

  let previous = []
  for (const words of split(text)) {
    const live = words.filter((w) => !w.r).map((w) => w.t)
    const at = headIndex(live)
    const name = basename(live[at] ?? '')
    const args = live.slice(at + 1)
    if (!words.piped) previous = []
    if (SHELLS.has(name)) {
      const flag = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a))
      if (flag >= 0 && args[flag + 1] !== undefined) nested(args[flag + 1])
    } else if (name === 'eval') nested((args[0] === '--' ? args.slice(1) : args).join(' '))
    else if (SQL_CLIENTS.has(name)) {
      const payloads = args.map((a) => a.replace(/^(?:--command|--execute)=/, ''))
      if (previous.length) payloads.push(previous.join(' ').replace(/^%s\s*/, ''))
      if (payloads.some(sqlDestroys)) add('ask', 'SQL DROP/TRUNCATE/DELETE without WHERE')
    } else if (name === 'rm' && (hasFlag(args, 'r', '--recursive') || hasFlag(args, 'R'))) {
      const targets = args.filter((a) => !a.startsWith('-') || a === '-')
      if (targets.some((t) => ROOTISH.test(t) || ROOTISH.test(expand(t))) || args.includes('--no-preserve-root')) add('deny', 'rm -rf of /, ~, $HOME, ., or ..')
      else add('ask', 'rm -r')
    } else if (name === 'find') {
      if (args.includes('-delete')) add('ask', 'find -delete')
      for (let i = 0; i < args.length; i++) {
        if (args[i] !== '-exec' && args[i] !== '-execdir') continue
        let end = i + 1
        while (end < args.length && args[end] !== ';' && args[end] !== '+') end++
        nested(args.slice(i + 1, end).join(' '))
        i = end
      }
    } else if (name === 'git') gitMatches(args, add)
    else if (name === 'chmod' && hasFlag(args, 'R', '--recursive') && args.some((a) => /^0?777$/.test(a))) add('deny', 'chmod -R 777')
    else if (name === 'chown' && hasFlag(args, 'R', '--recursive')) add('deny', 'chown -R')
    else if (name === 'npm' && args.find((a) => !a.startsWith('-')) === 'publish') add('deny', 'npm publish')
    if (DATA_COMMANDS.has(name)) previous = args
  }

  // Heredoc bodies are data, except when the command they feed is a shell or a SQL client.
  for (const { header, body } of bodies) {
    const segments = split(header.replace(/<<-?\s*['"]?\w+['"]?/, ' '))
    for (const words of segments) {
      const texts = words.filter((w) => !w.r).map((w) => w.t)
      const name = basename(texts[headIndex(texts)] ?? '')
      if (SHELLS.has(name) && !texts.includes('-c')) nested(body)
      else if (SQL_CLIENTS.has(name) && sqlDestroys(body)) add('ask', 'SQL DROP/TRUNCATE/DELETE without WHERE')
    }
  }
  return matches
}

// commandVerdict returns null, or { rule, decision: 'deny' | 'ask', reason }. A deny beats an
// ask. Inside a subagent nothing can answer a confirmation, so an ask becomes a deny.
export function commandVerdict(command, { split, expand, subagent = false }) {
  const matches = findMatches(command, { split, expand })
  const hit = matches.find((m) => m.tier === 'deny') ?? matches[0]
  if (!hit) return null
  if (hit.tier === 'deny') {
    return { rule: hit.rule, decision: 'deny', reason: `command-guard blocked this command: rule "${hit.rule}". Ask the user for a safer plan, or let them run it manually.` }
  }
  if (subagent) {
    return { rule: hit.rule, decision: 'deny', reason: `command-guard blocked this command: rule "${hit.rule}" needs the user's confirmation, and a subagent cannot ask. Report it to the parent, which can run it after the user agrees.` }
  }
  return { rule: hit.rule, decision: 'ask', reason: `command-guard: rule "${hit.rule}" changes or discards data. Confirm to run it.` }
}
