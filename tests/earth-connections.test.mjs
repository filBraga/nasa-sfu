import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { compareEvidenceScores, scoreText, scoreDescription } from '../web/similarity.js';

test('Earth map comparison links show missing totals as partial evidence, not zero percent', async () => {
  const html = await readFile(new URL('../web/earth.html', import.meta.url), 'utf8');
  const start = html.indexOf('function terrainTable(p) {');
  const end = html.indexOf('function resize()', start);
  const context = { compareEvidenceScores, scoreText, scoreDescription, esc: s => String(s),
    results: { sites: { target: { name: 'Test target', body: 'moon' } }, comparisons: [
      { earth: 'new', target: 'target', overall: null, observed_score: .9, coverage: .5, verdict: 'insufficient_evidence' },
    ] } };
  runInNewContext(html.slice(start, end), context);
  const table = context.terrainTable({ site_id: 'new' });
  assert.ok(table.includes('0.90*'));
  assert.ok(table.includes('50% evidence'));
  assert.ok(table.includes('index.html#compare/new/target'));
  assert.ok(!table.includes('>0%</td>'));
});

test('all 50 Earth map places have terrain and comparisons for their requested bodies', async () => {
  const data = JSON.parse(await readFile(new URL('../web/data/results.json', import.meta.url)));
  const places = JSON.parse(await readFile(new URL('../web/data/places_all.json', import.meta.url)));
  assert.equal(Object.values(data.sites).filter(s => s.body === 'earth').length, 61);
  for (const place of places) {
    const site = data.sites[place.site_id];
    assert.ok(site, `${place.id}: missing site`);
    assert.equal(site.body, 'earth');
    assert.ok(site.heightmap?.file, `${place.id}: missing terrain`);
    const comparisons = data.comparisons.filter(c => c.earth === site.id);
    for (const body of site.compare_bodies) {
      assert.ok(comparisons.some(c => data.sites[c.target].body === body), `${place.id}: no ${body} comparisons`);
    }
    assert.ok(comparisons.every(c => site.compare_bodies.includes(data.sites[c.target].body)));
    if (site.tags.includes('map_connected') && !site.facts.temperature) {
      assert.ok(comparisons.every(c => c.scores.cold == null));
      assert.ok(comparisons.every(c => c.coverage < 1));
      assert.ok(comparisons.every(c => c.scores.depth == null && c.scores.profile == null));
    }
  }
});
