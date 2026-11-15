import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { renderLunarDust } from '../web/lunar-dust.js';

const root = new URL('../', import.meta.url);
const read = async p => JSON.parse(await readFile(new URL(p, root), 'utf8'));

test('main-branch Mars targets and comparison records survive the Moon rebuild', async () => {
  const data = await read('web/data/results.json');
  const baseline = await read('tests/fixtures/mars-main-baseline.json');
  for (const id of baseline.targets) assert.equal(data.sites[id].body, 'mars');
  const comparisons = data.comparisons.filter(c => baseline.targets.includes(c.target));
  assert.equal(comparisons.length, baseline.comparisons);
  assert.equal(createHash('sha256').update(JSON.stringify(comparisons)).digest('hex'), baseline.sha256);
});

test('dust checkbox never affects a Moon score, while it still affects a Mars score', async () => {
  const data = await read('web/data/results.json');
  const code = await readFile(new URL('web/main.js', root), 'utf8');
  const start = code.indexOf('function scoreOf(c) {');
  const end = code.indexOf('// ------------------------------------------------------------------ source filter', start);
  const state = { data, dims: new Set(['slope', 'surface_dust']) };
  const context = { state, blockedBy: () => [], verdictOf: () => 'test' };
  runInNewContext(code.slice(start, end), context);
  const c = { target: 'shackleton', scores: { slope: .8, surface_dust: 0 } };
  assert.equal(context.scoreOf(c).overall, .8);
  assert.ok(context.scoreOf(c).filterOnly.includes('surface_dust'));
  state.dims.delete('surface_dust');
  assert.equal(context.scoreOf(c).overall, .8);
  state.dims.add('surface_dust');
  c.target = 'jezero';
  assert.equal(context.scoreOf(c).overall, .4);
  assert.equal(context.scoreOf(c).filterOnly.length, 0);
});

test('unchecked dust filter hides Moon evidence; Mars never shows the lunar card', () => {
  let removed = 0;
  const host = { querySelector: () => ({ remove: () => removed++ }) };
  renderLunarDust(host, { body: 'moon' }, { enabled: false });
  renderLunarDust(host, { body: 'mars' });
  assert.equal(removed, 2);
});

test('backend lunar totals follow default dimensions with dust explicitly excluded', async () => {
  const data = await read('web/data/results.json');
  const active = Object.entries(data.dimensions).filter(([, d]) => d.default_on && !d.score_excluded_bodies?.includes('moon'));
  for (const c of data.comparisons.filter(c => data.sites[c.target].body === 'moon')) {
    assert.ok(c.score_excluded.includes('surface_dust'));
    const available = active.filter(([k]) => c.scores[k] != null);
    const expected = available.reduce((s, [k, d]) => s + c.scores[k] * d.weight, 0) / available.reduce((s, [, d]) => s + d.weight, 0);
    // JSON metric scores are rounded independently to three decimal places.
    assert.ok(Math.abs(c.overall - expected) <= .0011, `${c.target}: score policy mismatch`);
  }
});
