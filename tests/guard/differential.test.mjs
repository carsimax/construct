// Differential test: wherever the guard at main 548b47d denied a command, the candidate
// must deny it too, except the named shapes in INTENDED_ALLOWS (T8: a heredoc body that
// only mentions a protected path, fed to a data sink). Main's verdicts are recorded
// statically in differential-corpus.mjs; nothing shells out to git. Protected names are
// built at runtime from placeholders.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { scratchDir } from '../assess/helpers.mjs'
import { corpus } from './differential-corpus.mjs'

const SCRIPT = new URL('../../plugins/construct/hooks/scripts/secret-guard.mjs', import.meta.url).pathname
const home = scratchDir('guard-diff-home-')

const subst = (s) =>
  s.replaceAll('@E@', '.' + 'env').replaceAll('@S@', '~/.' + 'ssh').replaceAll('@K@', 'server.' + 'key').replaceAll('@R@', 'rm' + ' -rf')

function verdict(command) {
  const p = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: home }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  })
  assert.equal(p.status, 0, p.stderr)
  return p.stdout.includes('"deny"') ? 'DENY' : 'allow'
}

// Intended T8 shapes: the body is data written by cat/tee/git commit|tag -F - and only
// mentions a protected path (or a destructive command) as text.
const INTENDED_ALLOWS = new Set([
  'allow-1', 'allow-2', 'allow-3', 'allow-4', 'allow-5', 'allow-6', 'allow-7', 'allow-8', 'allow-9',
  'x-tee-a', // cat <<EOF | tee -a notes.md
  'rm-8', // cat > clean.sh <<'EOF' with a destructive command as text
])

test('every command main denied is still denied, except the named T8 allows', () => {
  const byId = new Map(corpus.map(([id, raw, main]) => [id, { raw, main }]))
  for (const id of INTENDED_ALLOWS) assert.ok(byId.has(id), `allowlist names unknown case ${id}`)
  const regressions = []
  for (const [id, raw, main] of corpus) {
    if (main !== 'DENY' || INTENDED_ALLOWS.has(id)) continue
    if (verdict(subst(raw)) !== 'DENY') regressions.push(id)
  }
  assert.deepEqual(regressions, [])
})

test('the named T8 shapes stay allowed', () => {
  for (const id of INTENDED_ALLOWS) {
    const [, raw, main] = corpus.find((r) => r[0] === id)
    assert.equal(main, 'DENY', `${id} is an allowlist entry, so main denied it`)
    assert.equal(verdict(subst(raw)), 'allow', id)
  }
})

test('commands that never involve a heredoc or a protected name stay allowed', () => {
  for (const id of ['allow-10', 'plain-12', 'plain-13', 'plain-19', 'plain-20', 'plain-23', 'plain-28', 'plain-29', 'rm-5']) {
    const [, raw, main] = corpus.find((r) => r[0] === id)
    assert.equal(main, 'allow', id)
    assert.equal(verdict(subst(raw)), 'allow', id)
  }
})

test('L26 blockers deny', () => {
  const body = 'cat @E@'
  const cases = [
    `cat <<'EOF' | (bash)\n${body}\nEOF`,
    `cat <<'EOF' | ( bash )\n${body}\nEOF`,
    `cat <<'EOF' |(bash)\n${body}\nEOF`,
    `cat <<'EOF' | (cd /tmp && sh)\n${body}\nEOF`,
    `cat <<'EOF' | tee /dev/tty | (bash)\n${body}\nEOF`,
    `cat <<'EOF' |\n${body}\nEOF\nbash`,
    `cat <<'EOF' | # run it\n${body}\nEOF\nbash`,
    `cat <<'EOF' &&\n${body}\nEOF\ncat @E@`,
    `cat <<'EOF' ||\n${body}\nEOF\nbash`,
    `exec > >(bash)\ncat <<'EOF'\n${body}\nEOF`,
    `exec 3>&1\ncat <<'EOF'\n${body}\nEOF`,
    `alias cat=bash\ncat <<'EOF'\n${body}\nEOF`,
    `cat() { bash; }\ncat <<'EOF'\n${body}\nEOF`,
    `function cat { bash; }\ncat <<'EOF'\n${body}\nEOF`,
    `eval "$X"\ncat <<'EOF'\n${body}\nEOF`,
    `source ./x\ncat <<'EOF'\n${body}\nEOF`,
    `. ./x\ncat <<'EOF'\n${body}\nEOF`,
    `coproc bash\ncat <<'EOF'\n${body}\nEOF`,
    `cat <<'EOF' $(echo >&3)\n${body}\nEOF`,
    `cat <<'EOF' \`bash\`\n${body}\nEOF`,
  ]
  for (const c of cases) assert.equal(verdict(subst(c)), 'DENY', c)
})

test('a heredoc body written to a file that a later command runs is denied', () => {
  const body = 'cat @E@'
  for (const c of [
    `cat <<'EOF' > f; bash f\n${body}\nEOF`,
    `cat <<'EOF' > f && sh f\n${body}\nEOF`,
    `cat <<'EOF' > s.py; python3 s.py\n${body}\nEOF`,
    `cat <<'EOF' > s.py; python3.12 s.py\n${body}\nEOF`,
    `cat <<'EOF' > run.sh; chmod +x run.sh; ./run.sh\n${body}\nEOF`,
    `cat <<'EOF' > run.sh; chmod 755 run.sh\n${body}\nEOF`,
    `cat <<'EOF' > run.sh; chmod u+x run.sh\n${body}\nEOF`,
    `tee x.sh <<'EOF'\n${body}\nEOF\nbash x.sh`,
    `cat > x.sh <<'EOF'\n${body}\nEOF\n/tmp/x.sh`,
    `cat > x.sh <<'EOF'\n${body}\nEOF\n~/x.sh`,
    `cat > x.sh <<'EOF'\n${body}\nEOF\nsudo sh x.sh`,
    `cat > x.js <<'EOF'\n${body}\nEOF\nnode x.js`,
    `cat > Makefile <<'EOF'\n${body}\nEOF\nmake`,
  ]) assert.equal(verdict(subst(c)), 'DENY', c)
})

test('non-runners alongside a data heredoc stay allowed', () => {
  for (const c of [
    `cat > .gitignore <<'EOF'\nsee @E@\nEOF\ngit add .gitignore`,
    `cd /tmp && mkdir -p d && cat > d/n.md <<'EOF'\nsee @E@\nEOF\nls d; echo done; printf x; true`,
    `git add -A && git commit -F - <<'EOF'\nfix: mention @E@\nEOF`,
    `cat > a.sh <<'EOF'\nsee @E@\nEOF\nchmod 644 a.sh`,
  ]) assert.equal(verdict(subst(c)), 'allow', c)
})

test('a plain data heredoc with no hazards stays allowed', () => {
  for (const c of [
    `cat > notes.md <<'EOF'\nsee @E@\nEOF`,
    `git commit -F - <<'EOF'\nfix: mention @E@\nEOF`,
    `cat <<'EOF' | tee a.txt\nsee @E@\nEOF`,
  ]) assert.equal(verdict(subst(c)), 'allow', c)
})
