import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync, appendFileSync, mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reads the `pattern: '...'` frontmatter line of a regex grader (YAML single quotes: '' is ').
const patternOf = (grader) => {
  const text = readFileSync(new URL(`../plugins/construct/evals/${grader}`, import.meta.url), 'utf8');
  const line = text.match(/^pattern: '(.*)'$/m);
  assert.ok(line, `${grader} has a single-quoted pattern line`);
  return line[1].replaceAll("''", "'");
};

const regexes = (grader) => {
  const p = patternOf(grader);
  return [new RegExp(p), new RegExp(p, 'm')];
};

const worker = '{"type":"tool_use","name":"Agent","input":{"subagent_type":"construct:worker"}}';
const oracle = '{"type":"tool_use","name":"Agent","input":{"subagent_type":"construct:oracle"}}';
const failing = '{"type":"tool_result","content":"npm test\\n✖ paginate returns the last page\\nℹ fail 2"}';
const prompt = '{"type":"user","content":"The test output shows not ok 1 - paginate"}';

const toolEdit = (name = 'Edit', file = '/w/paginate.js') => `{"type":"tool_use","name":"${name}","input":{"file_path":"${file}"}}`;

test('debugging-fires reproduced-first matches only when failing output precedes the first fix edit or worker launch', () => {
  for (const re of regexes('debugging-fires/graders/reproduced-first.md')) {
    assert.match(`${prompt}\n${failing}\n${toolEdit()}`, re);
    assert.match(`${prompt}\n${failing}\n${toolEdit('Write')}`, re);
    assert.doesNotMatch(`${prompt}\n${toolEdit()}\n${failing}`, re);
    assert.doesNotMatch(`${prompt}\n${toolEdit('Write')}\n${failing}`, re);
    assert.match(`${prompt}\n${failing}\n${worker}`, re);
    assert.doesNotMatch(`${prompt}\n${worker}\n${failing}`, re);
    assert.match(`${prompt}\n${failing}\n${oracle}`, re);
    assert.doesNotMatch(`${prompt}\n${oracle}\n${failing}`, re);
    assert.doesNotMatch(`${prompt}\n{"type":"tool_result","content":"ℹ fail 0"}\n${toolEdit()}`, re);
    assert.doesNotMatch(`${prompt}\n${toolEdit()}`, re);
    assert.doesNotMatch(`${prompt}\n${worker}`, re);
  }
});

test('large-tracked document-sections matches a feature document with all sections', () => {
  for (const re of regexes('large-tracked/graders/document-sections.md')) {
    assert.match('Write .vault/tasks/feat.md\n## Specs\nx\n## Tasks\ny\n## Log\n', re);
    assert.doesNotMatch('Write .vault/tasks/feat.md\n## Specs\nx\n## Tasks\n', re);
  }
});

// Serialized form of a Write input in a real trace (kept run, 2026-10-28): JSON with escaped newlines.
// That run wrote Specs, Layout, Tasks and no Log, so the grader failed because it measured correctly.
const written = (headings) =>
  `{"type":"tool_use","name":"Write","input":{"file_path":"/w/cwd/.vault/tasks/todo-cli.md","content":"# todo-cli\\n\\n${headings.map((h) => `## ${h}\\n\\n- x\\n\\n`).join('')}"}}`;

test('large-tracked document-sections matches the escaped JSON form of a written document', () => {
  for (const re of regexes('large-tracked/graders/document-sections.md')) {
    assert.match(written(['Specs', 'Tasks', 'Log']), re);
    assert.match(written(['Specs', 'Layout', 'Tasks', 'Log']), re);
    assert.doesNotMatch(written(['Specs', 'Layout', 'Tasks']), re);
  }
});

// --- harness evidence: summary and outcome checks ---

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'evals-test-'));
const cleanups = [];
const scratch = () => { const d = tmp(); cleanups.push(d); return d; };
after(() => cleanups.forEach((d) => rmSync(d, { recursive: true, force: true })));

const run = (file, args, opts = {}) =>
  spawnSync(file, args, { encoding: 'utf8', ...opts });

test('eval-summary writes summary.json and prints one row per case and arm', () => {
  const dir = scratch();
  const arm = (runs) => runs;
  const r = (o) => ({ score: 1, passed: true, turns: 2, costUsd: 0.1, judgeCostUsd: 0.01, durationSeconds: 10, error: null, ...o });
  const aggregate = {
    cases: [
      { name: 'alpha', arms: {
        with: arm([r({}), r({ score: 0, passed: false, turns: 4, costUsd: null, durationSeconds: 20 })]),
        without: arm([r({ passed: false, score: 0.5, costUsd: 0.3, judgeCostUsd: 0.02, error: 'boom' })]),
      } },
      { name: 'beta', arms: { with: arm([r({ turns: 6 })]), without: [] } },
    ],
  };
  const outcomes = { cases: [{ name: 'alpha', arms: { with: [{ passed: true, askedHuman: false }, { passed: false, askedHuman: false }], without: [{ passed: false, error: 'no workspace' }] } }] };
  writeFileSync(join(dir, 'aggregate-result.json'), JSON.stringify(aggregate));
  writeFileSync(join(dir, 'outcomes.json'), JSON.stringify(outcomes));

  const res = run('node', [join(root, 'scripts/eval-summary.mjs'), join(dir, 'aggregate-result.json'), join(dir, 'outcomes.json')]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stderr, '');
  assert.equal(res.stdout, [
    '| case | arm | runs | ritual pass | outcome pass | no human | false completion | mean score | mean cost USD | mean duration s | mean turns | errored |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    '| alpha | with | 2 | 50% | 50% | 50% | 0% | 0.50 | 0.1000 | 15.0 | 3.0 | 0 |',
    '| alpha | without | 1 | 0% | 0% |  |  | 0.50 | 0.3000 | 10.0 | 2.0 | 1 |',
    '| beta | with | 1 | 100% |  |  |  | 1.00 | 0.1000 | 10.0 | 6.0 | 0 |',
    '',
    'Total: 4 runs, agent cost $0.5000, judge cost $0.0500, duration 50s',
    '',
  ].join('\n'));

  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  const alphaWith = summary.rows.find((x) => x.case === 'alpha' && x.arm === 'with');
  assert.deepEqual(alphaWith, { case: 'alpha', arm: 'with', runs: 2, ritualPassRate: 0.5, outcomePassRate: 0.5, meanScore: 0.5, meanCostUsd: 0.1, meanDurationSeconds: 15, meanTurns: 3, erroredRuns: 0, noHumanRate: 0.5, falseCompletionRate: 0 });
  assert.equal(summary.rows.find((x) => x.case === 'beta').outcomePassRate, null);
  assert.equal(summary.rows.length, 3);
  assert.deepEqual(summary.totals, { runs: 4, costUsd: 0.5, judgeCostUsd: 0.05, durationSeconds: 50 });
});

// Per-run outcome metrics: outcomes.json carries { passed, askedHuman }, the aggregate run's graders carry claims-done.
test('eval-summary reports noHumanRate and falseCompletionRate and excludes errored runs', () => {
  const dir = scratch();
  const r = (claims) => ({ score: 1, passed: true, turns: 1, costUsd: 0, judgeCostUsd: 0, durationSeconds: 1, error: null, graders: [{ name: 'claims-done', passed: claims }] });
  const aggregate = { cases: [{ name: 'alpha', arms: { with: [r(true), r(true), r(false), r(true), r(true)], without: [] } }] };
  const outcomes = { cases: [{ name: 'alpha', arms: { with: [
    { passed: true, askedHuman: false },
    { passed: false, askedHuman: false },
    { passed: true, askedHuman: true },
    { passed: false, askedHuman: false },
    { passed: false, error: 'no tracePath' },
  ] } }] };
  writeFileSync(join(dir, 'aggregate-result.json'), JSON.stringify(aggregate));
  writeFileSync(join(dir, 'outcomes.json'), JSON.stringify(outcomes));
  const res = run('node', [join(root, 'scripts/eval-summary.mjs'), join(dir, 'aggregate-result.json'), join(dir, 'outcomes.json')]);
  assert.equal(res.status, 0, res.stderr);
  const row = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')).rows[0];
  assert.equal(row.noHumanRate, 0.25); // 1 of the 4 traced runs
  assert.equal(row.falseCompletionRate, 0.5); // runs 2 and 4 claim done and fail
  assert.equal(row.outcomePassRate, 0.4); // existing column unchanged
  assert.match(res.stdout, /no human/);
  assert.match(res.stdout, /false completion/);
});

test('eval-summary leaves the new rates empty without outcomes, and labels the claudemd arm', () => {
  const dir = scratch();
  const r = { score: 1, passed: true, turns: 1, costUsd: 0, judgeCostUsd: 0, durationSeconds: 1, error: null };
  writeFileSync(join(dir, 'aggregate-result.json'), JSON.stringify({ cases: [{ name: 'alpha--claudemd', arms: { with: [r], without: [r] } }] }));
  const res = run('node', [join(root, 'scripts/eval-summary.mjs'), join(dir, 'aggregate-result.json')]);
  assert.equal(res.status, 0, res.stderr);
  const rows = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')).rows;
  assert.deepEqual(rows.map((x) => x.arm), ['with', 'claudemd']);
  assert.equal(rows[0].noHumanRate, null);
  assert.equal(rows[0].falseCompletionRate, null);
});

// scripts/claudemd/make-variants.sh <evals-dir> <claudemd-file>: what eval.sh runs in the plugin copy.
const variants = (evals) => run('bash', [join(root, 'scripts/claudemd/make-variants.sh'), evals, join(root, 'plugins/construct/evals/_claudemd/CLAUDE.md')]);

test('make-variants duplicates only arms: claudemd cases and the variant fixture appends CLAUDE.md', () => {
  const evals = scratch();
  const mk = (name, extra) => {
    mkdirSync(join(evals, name, 'graders'), { recursive: true });
    writeFileSync(join(evals, name, 'case.yaml'), `schema_version: "1.1"\nname: ${name}\n${extra}context:\n  scaffold_script: fixture.sh\n`);
    writeFileSync(join(evals, name, 'prompt.md'), 'p');
    writeFileSync(join(evals, name, 'outcome.sh'), 'exit 0\n');
    writeFileSync(join(evals, name, 'graders', 'g.md'), 'g');
    writeFileSync(join(evals, name, 'fixture.sh'), '#!/usr/bin/env bash\necho base > base.txt\n');
  };
  mk('alpha', 'arms: claudemd\n');
  mk('beta', '');
  const res = variants(evals);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(readdirSync(evals).sort(), ['alpha', 'alpha--claudemd', 'beta']);
  const v = join(evals, 'alpha--claudemd');
  for (const f of ['prompt.md', 'outcome.sh', 'graders/g.md']) assert.ok(existsSync(join(v, f)), f);
  const yaml = readFileSync(join(v, 'case.yaml'), 'utf8');
  assert.match(yaml, /^name: alpha--claudemd$/m);
  assert.doesNotMatch(yaml, /arms:/);
  assert.doesNotMatch(readFileSync(join(evals, 'alpha/case.yaml'), 'utf8'), /arms:/);
  const ws = scratch();
  const fx = run('bash', [join(v, 'fixture.sh')], { cwd: ws });
  assert.equal(fx.status, 0, fx.stderr);
  assert.equal(readFileSync(join(ws, 'base.txt'), 'utf8'), 'base\n');
  assert.equal(readFileSync(join(ws, 'CLAUDE.md'), 'utf8'), readFileSync(join(root, 'plugins/construct/evals/_claudemd/CLAUDE.md'), 'utf8'));
});

// S5 (eval-findings): hidden-contradiction's outcome.sh extracts the locked files from fixture.sh.
test('the hidden-contradiction claudemd variant passes its outcome check on a correct workspace', () => {
  const evals = scratch();
  cpSync(join(root, 'plugins/construct/evals/hidden-contradiction'), join(evals, 'hidden-contradiction'), { recursive: true });
  const res = variants(evals);
  assert.equal(res.status, 0, res.stderr);
  const v = join(evals, 'hidden-contradiction--claudemd');
  const ws = scratch();
  assert.equal(run('bash', [join(v, 'fixture.sh')], { cwd: ws }).status, 0);
  writeFileSync(join(ws, 'stats.js'), `export function summarize(values) {
  if (values.length === 0) return { min: null, max: null, mean: null, median: null }
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  const median = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  return { min: s[0], max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length, median }
}
`);
  const out = run('bash', [join(v, 'outcome.sh'), ws], { cwd: scratch() });
  assert.equal(out.status, 0, out.stdout + out.stderr);
});

test('the _claudemd CLAUDE.md is short, carries the core rules, and is not an eval case', () => {
  const dir = join(root, 'plugins/construct/evals/_claudemd');
  assert.deepEqual(readdirSync(dir), ['CLAUDE.md']);
  const text = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
  const n = text.trim().split('\n').length;
  assert.ok(n >= 30 && n <= 50, `${n} lines`);
  for (const rule of [/before.*writ/i, /test first|failing test/i, /run the tests/i, /locked test/i, /contradict/i, /Risk:/]) assert.match(text, rule);
});

test('eval.sh calls make-variants and does not delete _claudemd', () => {
  const sh = readFileSync(join(root, 'scripts/eval.sh'), 'utf8');
  assert.match(sh, /claudemd\/make-variants\.sh/);
  assert.doesNotMatch(sh, /rm -rf[^\n]*_claudemd/);
  assert.match(sh, /AskUserQuestion/);
});

test('eval-summary exits non-zero with one stderr line for a missing or unparsable file', () => {
  const dir = scratch();
  const missing = run('node', [join(root, 'scripts/eval-summary.mjs'), join(dir, 'nope.json')]);
  assert.notEqual(missing.status, 0);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /^eval-summary: .*nope\.json.*\n$/);
  writeFileSync(join(dir, 'bad.json'), '{');
  const bad = run('node', [join(root, 'scripts/eval-summary.mjs'), join(dir, 'bad.json')]);
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stderr.trim().split('\n').length, 1);
});

// A run without a boolean `passed` would read as a failure and silently show 0% (an unknown result format).
test('eval-summary exits non-zero when a run has no boolean passed', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'aggregate-result.json'), JSON.stringify({ cases: [{ name: 'alpha', arms: { with: [{ score: 1 }] } }] }));
  const res = run('node', [join(root, 'scripts/eval-summary.mjs'), join(dir, 'aggregate-result.json')]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /^eval-summary: .*alpha.*passed.*\n$/);
});

// Builds a workspace from the case's own fixture.sh, lets `change` edit it, and returns outcome.sh's exit status.
const outcome = (name, change) => {
  const ws = scratch();
  const fx = run('bash', [join(root, 'plugins/construct/evals', name, 'fixture.sh')], { cwd: ws });
  assert.equal(fx.status, 0, fx.stderr);
  change(ws);
  return run('bash', [join(root, 'plugins/construct/evals', name, 'outcome.sh'), ws], { cwd: scratch(), env: { ...process.env, TZ: 'UTC', NODE_TEST_CONTEXT: undefined } }).status;
};
const edit = (ws, file, fn) => writeFileSync(join(ws, file), fn(readFileSync(join(ws, file), 'utf8')));
test('debugging-fires outcome.sh passes a 1-based paginate and fails the off-by-one', () => {
  assert.equal(outcome('debugging-fires', (ws) => edit(ws, 'paginate.js', (t) => t.replace('page * size', '(page - 1) * size'))), 0);
  assert.notEqual(outcome('debugging-fires', () => {}), 0);
});

test('oracle-conflict outcome.sh passes an untouched locked test and fails an edited or deleted one', () => {
  assert.equal(outcome('oracle-conflict', () => {}), 0);
  assert.notEqual(outcome('oracle-conflict', (ws) => edit(ws, 'discount.acceptance.test.js', (t) => t.replace('80)', '72)'))), 0);
  assert.notEqual(outcome('oracle-conflict', (ws) => rmSync(join(ws, 'discount.acceptance.test.js'))), 0);
});

test('oracle-conflict test-untouched matches only edit tools on the locked test', () => {
  const re = new RegExp(patternOf('oracle-conflict/graders/test-untouched.md'));
  assert.match('{"type":"tool_use","name":"Edit","input":{"file_path":"/w/discount.acceptance.test.js"}}', re);
  assert.doesNotMatch('{"type":"tool_use","name":"Edit","input":{"file_path":"/w/discount.js"}}', re);
});

test('oracle-first outcome.sh needs passing tests and an envelope in the review store', () => {
  const impl = (ws) => edit(ws, 'math.js', (t) => `${t}export function subtract(a, b) {\n  return a - b\n}\n`);
  const envelope = (name) => (ws) => {
    const dir = join(ws, '.git/construct-review/envelopes');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), '{}');
  };
  const both = (...fns) => (ws) => fns.forEach((f) => f(ws));
  assert.equal(outcome('oracle-first', both(impl, envelope('feat-T1.json'))), 0);
  assert.notEqual(outcome('oracle-first', impl), 0);
  assert.notEqual(outcome('oracle-first', both(impl, envelope('feat-T1.state.json'))), 0);
  assert.notEqual(outcome('oracle-first', both((ws) => edit(ws, 'math.js', (t) => t.replace('a + b', 'a * b')), envelope('feat-T1.json'))), 0);
});

test('oracle-first oracle-before-worker matches only an oracle launch before the first worker launch', () => {
  for (const re of regexes('oracle-first/graders/oracle-before-worker.md')) {
    assert.match(`${prompt}\n${oracle}\n${worker}`, re);
    assert.match(`${prompt}\n${oracle}`, re);
    assert.doesNotMatch(`${prompt}\n${worker}\n${oracle}`, re);
    assert.doesNotMatch(`${prompt}\n${worker}`, re);
  }
});

// claude plugin eval defaults a tool_used min to 1, so `max: 0` alone can never pass ("expected 1..0").
test('every tool_used grader with max 0 also sets min 0', () => {
  const dir = fileURLToPath(new URL('../plugins/construct/evals/', import.meta.url));
  const graders = spawnSync('find', [dir, '-path', '*/graders/*.md'], { encoding: 'utf8' }).stdout.trim().split('\n');
  for (const file of graders) {
    const front = readFileSync(file, 'utf8').split(/^---$/m)[1] ?? '';
    if (/^type: tool_used$/m.test(front) && /^max: 0$/m.test(front)) assert.match(front, /^min: 0$/m, file);
  }
});
