import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBundle } from '../export.mjs';

test('bundle preserves source evidence and indexes all eight layers without inventing missing catalogs', async()=>{
  const b = await buildBundle();
  assert.equal(Object.keys(b.layers).length,8);
  assert.equal(b.ready_for_scoring,false);
  const source = JSON.parse(await readFile(new URL('../moon_data.json',import.meta.url),'utf8'));
  assert.deepEqual(b.records['moon_data.json'],source);
  for (const s of source.sites) {
    const p = b.points.find(p=>p.source==='moon_data.json' && p.record_id===s.id);
    assert.ok(p);
    for(const d of new Set(s.facts.filter(f=>f.value!=null).map(f=>f.dim)))assert.ok(p.d.includes(d));
  }
  assert.ok(b.records['data/samples/1286_5438.json'].elevation_window_m);
  for (const [d,layer] of Object.entries(b.layers)) assert.equal(layer.point_count,b.points.filter(p=>p.d.includes(Number(d))).length);
  for (const name of b.missing_catalogs) assert.equal(b.records[name],undefined);
});
