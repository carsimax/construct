import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const failing = '{"type":"tool_result","content":"npm test\\n✖ paginate returns the last page\\nℹ fail 2"}';
const prompt = '{"type":"user","content":"The test output shows not ok 1 - paginate"}';

test('debugging-fires reproduced-first matches only when failing output precedes the worker launch', () => {
  for (const re of regexes('debugging-fires/graders/reproduced-first.md')) {
    assert.match(`${prompt}\n${failing}\n${worker}`, re);
    assert.doesNotMatch(`${prompt}\n${worker}\n${failing}`, re);
    assert.doesNotMatch(`${prompt}\n{"type":"tool_result","content":"ℹ fail 0"}\n${worker}`, re);
    assert.doesNotMatch(`${prompt}\n${worker}`, re);
  }
});

test('large-tracked document-sections matches a feature document with all sections', () => {
  for (const re of regexes('large-tracked/graders/document-sections.md')) {
    assert.match('Write odd/tasks/feat.md\n## Specs\nx\n## Tasks\ny\n## Log\n', re);
    assert.doesNotMatch('Write odd/tasks/feat.md\n## Specs\nx\n## Tasks\n', re);
  }
});
