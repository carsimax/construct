import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratches = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'evals-cases-'));
  scratches.push(dir);
  return dir;
};
after(() => scratches.forEach((d) => rmSync(d, { recursive: true, force: true })));

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

// Builds a workspace from the case's own fixture.sh, lets `change` edit it, and returns outcome.sh's exit status.
const outcome = (name, change) => {
  const ws = scratch();
  const fx = run('bash', [join(root, 'plugins/construct/evals', name, 'fixture.sh')], { cwd: ws });
  assert.equal(fx.status, 0, fx.stderr);
  change(ws);
  return run('bash', [join(root, 'plugins/construct/evals', name, 'outcome.sh'), ws], { cwd: scratch(), env: { ...process.env, NODE_TEST_CONTEXT: undefined } }).status;
};
const put = (ws, file, text) => writeFileSync(join(ws, file), text);
const edit = (ws, file, fn) => put(ws, file, fn(readFileSync(join(ws, file), 'utf8')));

test('multi-file-feature outcome.sh passes a complete --csv and fails the untouched project or a partial one', () => {
  const full = (ws) => {
    put(ws, 'formatter.js', `export function formatText(rows) {
  return rows.map((r) => \`\${r.name} - \${r.role}\`)
}
const q = (v) => (/[",\\n]/.test(v) ? \`"\${v.replaceAll('"', '""')}"\` : v)
export function formatCsv(rows) {
  return ['name,role', ...rows.map((r) => [r.name, r.role].map(q).join(','))]
}
`);
    put(ws, 'cli.js', `import { readFileSync } from 'node:fs'
import { parse } from './parser.js'
import { formatText, formatCsv } from './formatter.js'
import { write } from './writer.js'

const args = process.argv.slice(2)
const flags = args.filter((a) => a.startsWith('--'))
if (flags.some((f) => f !== '--csv')) {
  process.stderr.write('unknown flag\\n')
  process.exit(2)
}
const [file] = args.filter((a) => !a.startsWith('--'))
const rows = parse(readFileSync(file, 'utf8'))
write(flags.includes('--csv') ? formatCsv(rows) : formatText(rows))
`);
  };
  assert.equal(outcome('multi-file-feature', full), 0);
  assert.notEqual(outcome('multi-file-feature', () => {}), 0);
  // No quoting (S2) and no exit code 2 (S4): the other specs alone do not pass.
  assert.notEqual(outcome('multi-file-feature', (ws) => {
    full(ws);
    edit(ws, 'formatter.js', (t) => t.replace("map(q)", "map(String)"));
  }), 0);
  assert.notEqual(outcome('multi-file-feature', (ws) => {
    full(ws);
    edit(ws, 'cli.js', (t) => t.replace('process.exit(2)', 'process.exit(1)'));
  }), 0);
});

test('two-cause-bug outcome.sh passes only with both causes fixed', () => {
  const rounding = (ws) => edit(ws, 'money.js', (t) => t.replace('Math.floor', 'Math.round'));
  const tax = (ws) => edit(ws, 'invoice.js', (t) => t.replace('fromCents(sum + Math.round(sum * rate))', 'fromCents(sum)'));
  assert.equal(outcome('two-cause-bug', (ws) => { rounding(ws); tax(ws); }), 0);
  assert.notEqual(outcome('two-cause-bug', () => {}), 0);
  assert.notEqual(outcome('two-cause-bug', tax), 0);
  assert.notEqual(outcome('two-cause-bug', rounding), 0);
});

test('hidden-contradiction outcome.sh passes the spec implementation with locked files untouched and fails otherwise', () => {
  const solve = (ws) => put(ws, 'stats.js', `export function summarize(values) {
  if (!values.length) return { min: null, max: null, mean: null, median: null }
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  return {
    min: s[0],
    max: s[n - 1],
    mean: s.reduce((a, b) => a + b, 0) / n,
    median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2,
  }
}
`);
  assert.equal(outcome('hidden-contradiction', solve), 0);
  assert.notEqual(outcome('hidden-contradiction', () => {}), 0);
  // Editing the locked data to make case 17 pass fails the byte-identity check.
  assert.notEqual(outcome('hidden-contradiction', (ws) => {
    solve(ws);
    edit(ws, 'cases.json', (t) => t.replace('"median":2}', '"median":2.5}'));
  }), 0);
  assert.notEqual(outcome('hidden-contradiction', (ws) => {
    solve(ws);
    edit(ws, 'stats.test.js', (t) => t.replace('LOCKED', 'edited'));
  }), 0);
  // The fixture's own tests fail exactly on the contradicting case.
  const ws = scratch();
  run('bash', [join(root, 'plugins/construct/evals/hidden-contradiction/fixture.sh')], { cwd: ws });
  solve(ws);
  const res = run('node', ['--test'], { cwd: ws, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.notEqual(res.status, 0);
  assert.match(res.stdout, /ℹ fail 1\n/);
  assert.match(res.stdout, /ℹ pass 29\n/);
});

test('quiet-oneline outcome.sh passes the new greeting and fails the old one', () => {
  assert.equal(outcome('quiet-oneline', (ws) => edit(ws, 'greet.js', (t) => t.replace("'Hello'", "'Welcome'"))), 0);
  assert.notEqual(outcome('quiet-oneline', () => {}), 0);
});
