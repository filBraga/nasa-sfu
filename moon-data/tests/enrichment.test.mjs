import test from 'node:test';
import assert from 'node:assert/strict';
import { southPolar } from '../scripts/enrich_regions.mjs';
import { buildBundle } from '../export.mjs';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
test('viewer module syntax is valid',async()=>{
  const html=await readFile(new URL('../viewer/index.html',import.meta.url),'utf8');
  const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm,'');
  assert.doesNotThrow(()=>new vm.Script(source));
});
test('projection has correct pole, axes and inverse distance',()=>{
  const [x,y]=southPolar(-90,0);assert.equal(x,0);assert.equal(y,0);
  assert.ok(southPolar(-85,0)[1]>0);assert.ok(Math.abs(southPolar(-85,0)[0])<1e-6);
  assert.ok(southPolar(-85,90)[0]>0);assert.ok(Math.abs(southPolar(-85,90)[1])<1e-6);
  const r=Math.hypot(...southPolar(-85,120));assert.ok(Math.abs(-90+2*Math.atan(r/(2*1737400))*180/Math.PI+85)<1e-9);
});
test('36 representative samples join without altering original source observations',async()=>{
  const b=await buildBundle(),regions=b.records['derived/thermal_regions.json'].points;
  assert.equal(regions.length,36);assert.equal(b.records['moon_scout_points.json'].points.filter(p=>p.kind==='observed thermal bin').length,512);
  for(const r of regions){
    const measurements=r.measurements.filter(m=>m.key!=='sample_median_bolometric_temperature');assert.equal(measurements.length,8);
    assert.ok(measurements.some(m=>m.dim===2&&m.value!==null));assert.ok(r.dims.includes(2));
    const solar=measurements.find(m=>m.key==='average_solar_disc_visibility');assert.ok(solar.value>=0&&solar.value<=1);assert.equal(solar.value,solar.raw_dn*.00004);
    for(const m of measurements)assert.ok(m.source_url&&Number.isInteger(m.pixel.row)&&Number.isInteger(m.pixel.col));
  }
});
