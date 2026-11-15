import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTemperature } from '../scripts/import_scout_points.mjs';
import { buildBundle } from '../export.mjs';
test('scout points retain real table coordinates, observations and explicit missing values',async()=>{
  const b=await buildBundle(),catalog=b.records['moon_scout_points.json'];
  assert.equal(catalog.points.length,514);
  assert.equal(b.points.filter(p=>p.source==='moon_scout_points.json').length,2);
  const regions=b.records['derived/thermal_regions.json'].points;
  assert.ok(regions.length<100);
  assert.equal(regions.reduce((n,p)=>n+p.sample_count,0),512);
  assert.equal(new Set(regions.flatMap(p=>p.member_ids)).size,512);
  for(const r of regions){assert.ok(catalog.points.some(p=>p.id===r.representative_id&&p.lat===r.lat&&p.lon_e===r.lon_e));assert.ok(r.temperature_K.min<=r.temperature_K.median&&r.temperature_K.median<=r.temperature_K.max);}
  const temps=catalog.points.filter(p=>p.kind==='observed thermal bin');
  assert.equal(temps.length,512);assert.equal(new Set(temps.map(p=>p.id)).size,512);
  assert.ok(Math.max(...temps.map(p=>p.lat))-Math.min(...temps.map(p=>p.lat))>5);
  for(const p of temps){const r=parseTemperature(p.source_row,p.source_row_index);assert.deepEqual(r,p);assert.ok(p.measurements[0].value>0);assert.deepEqual(p.dims,[3]);}
  const row=temps[0].source_row;
  assert.equal(parseTemperature(row.slice(0,56)+'     -9999'+row.slice(66),0),null);
  assert.throws(()=>parseTemperature(row.slice(1),0));
  const refs=catalog.points.filter(p=>p.kind==='surface experiment context');
  assert.ok(refs.every(p=>p.measurements[0].value===null));
  assert.equal(refs.find(p=>p.id==='apollo15_scout_alsep').measurements[0].status,'quarantined_source_errors');
});
