import test from 'node:test';
import assert from 'node:assert/strict';
import { sample } from '../scripts/sample_global_terrain.mjs';
import { buildBundle } from '../export.mjs';
test('global DEM uses correct signed-longitude seam and limits polar derivatives',()=>{
  const w=1440,h=720,z=new Float32Array(w*h).fill(1);
  const a=sample(z,w,h,0,-20),b=sample(z,w,h,0,340);
  assert.deepEqual(a,b);assert.equal(a.values.elevation,1000);assert.equal(a.values.slope,0);assert.equal(a.values.roughness,0);
  assert.deepEqual(Object.keys(sample(z,w,h,89,0).values),['elevation']);
});
test('every Moon marker has terrain baseline, including the image example',async()=>{
  const b=await buildBundle();assert.ok(b.points.every(p=>p.measurements?.some(m=>m.key==='elevation'&&Number.isFinite(m.value))));
  const p=b.points.find(p=>p.n==='Aristarchus Plateau');assert.ok(p.measurements.some(m=>m.key==='slope'));assert.ok(p.measurements.some(m=>m.key==='roughness'));assert.ok(p.measurements.some(m=>m.key==='relief'));
  assert.equal(b.layers[2].point_count,b.points.length);
});
