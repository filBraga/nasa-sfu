import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { aggregateSimilarity, compareEvidenceScores, scoreText, scoreDescription } from '../web/similarity.js';

const read = async p => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const config = await read('../config/similarity.json');
const dims = { a: { weight: 1, category: 'terrain' }, b: { weight: 1, category: 'terrain' }, c: { weight: 1, category: 'plants' } };

test('partial results remain visible and ranked without becoming complete scores', () => {
  const partial = { overall: null, observed_score: .99, coverage: .5 };
  const complete = { overall: .3, observed_score: .3, coverage: 1 };
  assert.equal(scoreText(partial), '0.99*');
  assert.match(scoreDescription(partial), /50% evidence coverage/);
  assert.match(scoreDescription(partial), /withheld/);
  assert.ok(compareEvidenceScores(complete, partial) < 0);
  assert.ok(compareEvidenceScores(partial, { ...partial, observed_score: .8 }) < 0);
  assert.equal(partial.overall, null);
});

test('closed-form category budgets, missing evidence and explicit selection', () => {
  const result = aggregateSimilarity({ a: .25, b: .25, c: 1 }, dims, ['a', 'b', 'c'], { config });
  assert.ok(Math.abs(result.score - .5) < 1e-12);
  const missing = aggregateSimilarity({ a: 1, b: 1 }, dims, ['a', 'b', 'c'], { config });
  assert.equal(missing.score, null);
  assert.equal(missing.observed_score, 1);
  assert.equal(missing.coverage, .5);
  assert.equal(aggregateSimilarity({ a: 1 }, dims, ['a'], { config }).score, 1);
  assert.equal(aggregateSimilarity({}, dims, [], { config }).score, null);
});

test('all exported browser totals agree with Python, including coverage and site-type weights', async () => {
  const data = await read('../web/data/results.json');
  const selected = Object.entries(data.dimensions).filter(([, d]) => d.default_on).map(([k]) => k);
  for (const c of data.comparisons) {
    const r = aggregateSimilarity(c.scores, data.dimensions, selected, {
      body: data.sites[c.target].body, notApplicable: c.not_applicable, config: data.scoring,
      dimensionWeights: data.site_types[c.target_type].dimension_weights,
    });
    assert.ok(Math.abs(c.observed_score - r.observed_score) < 1e-12, `${c.target}: observed mismatch`);
    assert.ok(Math.abs(c.coverage - r.coverage) < 1e-12);
    if (r.score == null) assert.equal(c.overall, null);
    else assert.ok(Math.abs(c.overall - r.score) < 1e-12);
  }
});

test('known impact analog versus prairie control is evaluated on measured crater geometry', async () => {
  const data = await read('../web/data/results.json');
  const analog = data.comparisons.find(c => c.earth === 'haughton' && c.target === 'jezero');
  const control = data.comparisons.find(c => c.earth === 'control_prairie' && c.target === 'jezero');
  assert.ok(analog && control);
  const geometry = c => Math.sqrt(c.scores.profile * c.scores.depth);
  assert.ok(geometry(analog) > geometry(control), 'Known crater analog should reproduce this crater geometry better than prairie terrain');
  const report = await read('../web/data/calculation_validation.json');
  assert.equal(report.pairs.length, data.pairs.length);
  for (const pair of report.pairs) assert.ok(pair.controls.length > 0);
});
