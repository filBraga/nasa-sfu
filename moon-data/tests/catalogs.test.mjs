import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parsePits,parseLanders } from '../scripts/import_catalogs.mjs';
import { buildBundle } from '../export.mjs';
const read = path=>readFile(new URL(path,import.meta.url),'utf8');
test('saved pit and NASA tables parse without dropping rows or uncertainty',async()=>{
  const pits=parsePits(await read('../data/catalogs/pits.html'));
  const landers=parseLanders(await read('../data/catalogs/landers.html'));
  assert.equal(pits.length,278); assert.equal(landers.length,96);
  assert.equal(new Set(pits.map(p=>p.id)).size,pits.length);
  const qualified=pits.find(p=>p.depth_text.startsWith('>'));
  assert.ok(qualified); assert.equal(qualified.depth_m,null);
  const unknown=landers.find(p=>p.name==='Surveyor 4');
  assert.equal(unknown.lat,null); assert.match(unknown.coordinates_text,/Unknown/);
  const ranger=landers.find(p=>p.name==='Ranger 4');
  assert.equal(ranger.lat,-15.5); assert.equal(ranger.lon_e,229.3);
  const bundle=await buildBundle();
  assert.ok(!bundle.missing_catalogs.includes('moon_caves.json'));
  assert.ok(!bundle.missing_catalogs.includes('moon_landers.json'));
  for (const [source,rs,dim] of [['moon_caves.json',pits,7],['moon_landers.json',landers,8]]) {
    assert.equal(bundle.points.filter(p=>p.source===source).length+bundle.unlocated.filter(p=>p.source===source).length,rs.length);
    assert.ok(bundle.points.filter(p=>p.source===source).every(p=>p.d.includes(dim)));
  }
  assert.ok(bundle.points.some(p=>p.k==='spacecraft / Impact'));
});
