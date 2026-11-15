import test from 'node:test';
import assert from 'node:assert/strict';
import { eastLongitude,spatialAudit } from '../spatial-audit.mjs';
import { buildBundle } from '../export.mjs';
test('signed and wrapped longitude retain the same position',()=>{
  assert.equal(eastLongitude(-20),340);assert.equal(eastLongitude(360),0);assert.equal(eastLongitude(180),180);
  const p={n:'test',la:0,lo:-20,d:[2],source:'test',record_id:'test'};
  assert.deepEqual(spatialAudit([p]),spatialAudit([{...p,lo:340}]));
});
test('comparison subset retains real source records in distinct equal-area cells',async()=>{
  const b=await buildBundle(),a=b.spatial_audit;
  assert.equal(a.selected_keys.length,24);assert.equal(new Set(a.selected_keys).size,24);
  assert.equal(a.comparison.near,12);assert.equal(a.comparison.far,12);
  assert.equal(a.all.near+a.all.far,b.points.length);
  assert.ok(b.points.every(p=>p.lo>=0&&p.lo<360));
  for(const cell of a.cells)assert.ok(b.points.some(p=>cell.selected===`${p.source}|${p.record_id}`));
  const sparse=spatialAudit([b.points[0]]);assert.equal(sparse.empty_cells.length,23);assert.equal(sparse.selected_keys.length,1);
});
