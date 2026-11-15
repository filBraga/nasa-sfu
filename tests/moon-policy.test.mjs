import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { aggregateSimilarity } from '../web/similarity.js';
import { runInNewContext } from 'node:vm';
import { renderLunarDust } from '../web/lunar-dust.js';

const root = new URL('../', import.meta.url);
const read = async p => JSON.parse(await readFile(new URL(p, root), 'utf8'));

test('calculation update retains all main-branch Mars target/comparison pairs', async () => {
  const data = await read('web/data/results.json');
  const baseline = await read('tests/fixtures/mars-main-baseline.json');
  for (const id of baseline.targets) assert.equal(data.sites[id].body, 'mars');
  const comparisons = data.comparisons.filter(c => baseline.targets.includes(c.target));
  assert.ok(comparisons.length >= baseline.comparisons);
  assert.equal(new Set(comparisons.map(c => `${c.earth}|${c.target}`)).size, comparisons.length);
});

test('dust checkbox never affects a Moon score, while it still affects a Mars score', async () => {
  const data = await read('web/data/results.json');
  const code = await readFile(new URL('web/main.js', root), 'utf8');
  const start = code.indexOf('function scoreOf(c) {');
  const end = code.indexOf('// ------------------------------------------------------------------ source filter', start);
  const state = { data, dims: new Set(['slope', 'surface_dust']) };
  const context = { state, blockedBy: () => [], verdictOf: () => 'test', aggregateSimilarity };
  runInNewContext(code.slice(start, end), context);
  const c = { target: 'shackleton', scores: { slope: .8, surface_dust: 0 } };
  assert.equal(context.scoreOf(c).overall, .8);
  assert.ok(context.scoreOf(c).filterOnly.includes('surface_dust'));
  state.dims.delete('surface_dust');
  assert.equal(context.scoreOf(c).overall, .8);
  state.dims.add('surface_dust');
  c.target = 'jezero';
  assert.ok(context.scoreOf(c).overall < .001);
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
    const expected = aggregateSimilarity(c.scores, data.dimensions,
      Object.entries(data.dimensions).filter(([, d]) => d.default_on).map(([k]) => k),
      { body: 'moon', notApplicable: c.not_applicable, config: data.scoring,
        dimensionWeights: data.site_types[c.target_type].dimension_weights });
    if (expected.score == null) assert.equal(c.overall, null);
    else assert.ok(Math.abs(c.overall - expected.score) < 1e-12, `${c.target}: score policy mismatch`);
    assert.ok(Math.abs(c.coverage - expected.coverage) < 1e-12);
  }
});
