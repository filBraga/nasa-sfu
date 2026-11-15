import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {divinerPixel} from '../scripts/sample_diviner.mjs';
import {buildBundle} from '../export.mjs';
import {windowStatistics} from '../scripts/sample_terrain64.mjs';
test('Diviner IMG grid starts at 0 E, unlike its GeoTIFF sibling',()=>{
  assert.equal(divinerPixel(0,0).col,0);assert.equal(divinerPixel(0,180).col,23040);
  assert.deepEqual(divinerPixel(26,-50),divinerPixel(26,310));
  assert.equal(divinerPixel(70,0),null);assert.equal(divinerPixel(-80,0),null);
});
test('Diviner samples retain raw bytes and explicit missing values',async()=>{
  const b=await buildBundle(),d=b.records['data/enrichment/diviner.json'];
  const ms=Object.values(d.points).flatMap(p=>p.measurements);
  assert.equal(ms.filter(m=>m.key==='midnight_bolometric_temperature'&&m.value!==null).length,456);
  assert.equal(ms.filter(m=>m.key==='rock_abundance_slope_adjusted_midnight'&&m.value!==null).length,453);
  assert.equal(ms.filter(m=>m.value===null).length,3);
  for(const m of ms){const raw=Buffer.from(m.raw_hex,'hex').readFloatLE();if(m.value!==null)assert.equal(raw,m.value);assert.ok(m.source_url.endsWith('.xml'));}
  assert.ok(b.points.some(p=>p.lo>90&&p.lo<270&&p.measurements.some(m=>m.key==='midnight_bolometric_temperature')));
});
test('global DEM has 64 ppd sampling; saved lower-resolution PDS cross-checks pass',async()=>{
  const b=await buildBundle(),r=b.records['data/enrichment/sampling_validation.json'];
  assert.equal(r.passed,true);assert.equal(r.checks.length,8);
  assert.ok(r.checks.every(c=>Math.abs(c.difference_m)<1));
  const p=b.points.find(p=>p.n==='Aristarchus Plateau'),m=p.measurements.find(m=>m.key==='elevation');
  assert.ok(m.source_url.endsWith('ldem_64_float.lbl'));assert.ok(m.pixel_spacing_m[1]>470&&m.pixel_spacing_m[1]<480);
});
test('native 64 ppd plane statistics preserve slope and window scale',()=>{
  const dy=1737400*Math.PI/180/64,lat=30,dx=dy*Math.cos(lat*Math.PI/180);
  const z=Array.from({length:5},(_,i)=>Array.from({length:5},(_,j)=>100+0.1*(j-2)*dx+0.2*(i-2)*dy));
  const t=windowStatistics(z,lat);assert.ok(Math.abs(t.values.slope-Math.atan(Math.hypot(.1,.2))*180/Math.PI)<1e-10);assert.ok(t.values.roughness<1e-10);assert.equal(t.values.elevation,100);
});
