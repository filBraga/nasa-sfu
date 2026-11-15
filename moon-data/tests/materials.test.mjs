import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodeHapke} from '../scripts/sample_materials.mjs';
import {buildBundle} from '../export.mjs';
test('Hapke science pixels preserve band ordering, seam and excluded coverage',async()=>{
  const bytes=await readFile(new URL('../data/rasters/hapke_643nm.img',import.meta.url));
  assert.deepEqual(decodeHapke(bytes,0,-20),decodeHapke(bytes,0,340));assert.deepEqual(decodeHapke(bytes,-80,0),[]);
  const a=decodeHapke(bytes,26,310);assert.equal(a.length,5);assert.equal(a[0].key,'single_scattering_albedo_643nm');assert.ok(a[0].value>=0&&a[0].value<=1);
  const offset=5760+((70-26)*360+310)*4;const invalid=Buffer.from(bytes);invalid.writeUInt32LE(0xff7ffffb,offset);assert.equal(decodeHapke(invalid,26,310)[0].value,null);
});
test('materials attach to nonpolar coordinates on both hemispheres',async()=>{
  const b=await buildBundle(),points=b.points.filter(p=>p.measurements?.some(m=>m.dim===1&&m.value!==null));
  assert.ok(points.length>200);assert.ok(points.some(p=>p.lo>90&&p.lo<270));assert.ok(points.some(p=>p.lo<90||p.lo>270));
  assert.ok(!points.some(p=>Math.abs(p.la)>=70));
});
