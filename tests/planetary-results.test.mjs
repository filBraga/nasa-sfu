import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('every researched location has target metadata, ranked comparisons, and valid 3D terrain', async () => {
  const data = await read('web/data/results.json');
  const targets = Object.values(data.sites).filter(s => s.role === 'target');
  const config = await read('config/sites.json');
  assert.equal(targets.length, config.sites.filter(s => s.role === 'target').length);
  assert.equal(targets.filter(s => s.body === 'moon').length, 125);
  const sources = new Set(data.data_sources.datasets.map(d => d.id));
  for (const target of targets) {
    assert.ok(sources.has(target.dem_source), `${target.id}: DEM source`);
    const path = new URL(`web/data/${target.heightmap.file}`, root);
    assert.equal((await stat(path)).size, target.heightmap.size ** 2 * 4);
    const raw = await readFile(path);
    for (let i = 0; i < raw.length; i += 4) assert.ok(Number.isFinite(raw.readFloatLE(i)));
    const comparisons = data.comparisons.filter(c => c.target === target.id);
    assert.ok(comparisons.length > 0, `${target.id}: no comparisons`);
    for (const c of comparisons) {
      assert.ok(Number.isFinite(c.overall) && c.overall >= 0 && c.overall <= 1);
      assert.ok(Object.values(c.scores).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
      assert.equal(c.earth_features.res_m, c.target_features.res_m);
      if (target.tags?.includes('planetary_import')) {
        for (const k of ['slope', 'roughness', 'hypsometry', 'flat_fraction']) assert.ok(k in c.scores);
        assert.ok(!('profile' in c.scores));
        const earth = data.sites[c.earth];
        if (earth.role !== 'control' && earth.compare_bodies) assert.ok(earth.compare_bodies.includes(target.body));
        if (target.body === 'mars') assert.ok('surface_dust' in c.scores, `${target.id}: dust missing`);
      }
    }
  }
});

test('the actual comparison picker exposes all Moon and Mars targets', async () => {
  const data = await read('web/data/results.json');
  const code = await readFile(new URL('web/main.js', root), 'utf8');
  const start = code.indexOf('function fillSelects() {');
  const end = code.indexOf('/** Best comparison', start);
  assert.ok(start >= 0 && end > start);
  const elements = { 'sel-earth': {}, 'sel-target': {} };
  runInNewContext(`${code.slice(start, end)}\nfillSelects();`, {
    state: { data, earthId: 'haughton', targetId: 'gale' },
    $: id => elements[id], esc: s => String(s),
    isTeam: s => s.tags?.includes('team'), BODY: { moon: { name: 'Moon' }, mars: { name: 'Mars' } },
  });
  const html = elements['sel-target'].innerHTML;
  assert.equal((html.match(/<option /g) || []).length, Object.values(data.sites).filter(s => s.role === 'target').length);
  for (const site of Object.values(data.sites).filter(s => s.role === 'target')) {
    assert.ok(html.includes(`value="${site.id}"`), `${site.id} missing from picker`);
  }
  assert.ok(html.includes('Moon comparison locations'));
  assert.ok(html.includes('Mars comparison locations'));
  assert.equal(elements['sel-target'].value, 'gale');
});
