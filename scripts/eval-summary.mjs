#!/usr/bin/env node
// Usage: eval-summary.mjs <aggregate-result.json> [outcomes.json]
// Writes summary.json next to the aggregate file and prints a Markdown table.
// outcomes.json has the aggregate's shape: { cases: [{ name, arms: { with: [{ passed, error? }], without: [...] } }] }.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const fail = (message) => {
  process.stderr.write(`eval-summary: ${message}\n`);
  process.exit(1);
};
const load = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`cannot read ${file}: ${error.message.split('\n')[0]}`);
  }
};

const [aggregateFile, outcomesFile] = process.argv.slice(2);
if (!aggregateFile) fail('usage: eval-summary.mjs <aggregate-result.json> [outcomes.json]');
const aggregate = load(aggregateFile);
if (!Array.isArray(aggregate.cases)) fail(`${aggregateFile} has no cases array`);
const outcomes = outcomesFile ? load(outcomesFile) : { cases: [] };

const nums = (runs, key) => runs.map((r) => r[key]).filter((v) => typeof v === 'number');
const sum = (values) => values.reduce((a, b) => a + b, 0);
const mean = (values) => (values.length ? sum(values) / values.length : null);
const rate = (runs) => (runs.length ? runs.filter((r) => r.passed === true).length / runs.length : null);

const rows = [];
const totals = { runs: 0, costUsd: 0, judgeCostUsd: 0, durationSeconds: 0 };
for (const c of aggregate.cases) {
  for (const arm of ['with', 'without']) {
    const runs = c.arms?.[arm] ?? [];
    if (!runs.length) continue;
    // An unknown result format would otherwise read as every run failing.
    if (runs.some((r) => r.error == null && typeof r.passed !== 'boolean')) fail(`case ${c.name} (${arm}) has a run without a boolean passed`);
    const checked = outcomes.cases?.find((o) => o.name === c.name)?.arms?.[arm] ?? [];
    rows.push({
      case: c.name,
      arm,
      runs: runs.length,
      ritualPassRate: rate(runs),
      outcomePassRate: rate(checked),
      meanScore: mean(nums(runs, 'score')),
      meanCostUsd: mean(nums(runs, 'costUsd')),
      meanDurationSeconds: mean(nums(runs, 'durationSeconds')),
      meanTurns: mean(nums(runs, 'turns')),
      erroredRuns: runs.filter((r) => r.error != null).length,
    });
    totals.runs += runs.length;
    totals.costUsd += sum(nums(runs, 'costUsd'));
    totals.judgeCostUsd += sum(nums(runs, 'judgeCostUsd'));
    totals.durationSeconds += sum(nums(runs, 'durationSeconds'));
  }
}

writeFileSync(join(dirname(aggregateFile), 'summary.json'), `${JSON.stringify({ rows, totals }, null, 2)}\n`);

const cell = (value, format) => (value === null ? '' : format(value));
const pct = (v) => `${Math.round(v * 100)}%`;
const lines = [
  '| case | arm | runs | ritual pass | outcome pass | mean score | mean cost USD | mean duration s | mean turns | errored |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${[
    r.case, r.arm, r.runs,
    cell(r.ritualPassRate, pct), cell(r.outcomePassRate, pct),
    cell(r.meanScore, (v) => v.toFixed(2)), cell(r.meanCostUsd, (v) => v.toFixed(4)),
    cell(r.meanDurationSeconds, (v) => v.toFixed(1)), cell(r.meanTurns, (v) => v.toFixed(1)),
    r.erroredRuns,
  ].join(' | ')} |`),
  '',
  `Total: ${totals.runs} runs, agent cost $${totals.costUsd.toFixed(4)}, judge cost $${totals.judgeCostUsd.toFixed(4)}, duration ${totals.durationSeconds}s`,
];
process.stdout.write(`${lines.join('\n')}\n`);
