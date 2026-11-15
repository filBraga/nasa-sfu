import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terrain, pixel } from '../moon.mjs';
test('flat terrain has no slope, roughness or relief', () => {
  const t = terrain(Array.from({length:5},()=>Array(5).fill(123)),0);
  assert.equal(t.elevation,123); assert.equal(t.slope,0); assert.equal(t.roughness,0); assert.equal(t.relief,0);
});
test('known tilted plane recovers slope without roughness', () => {
  const dy = 1737400*Math.PI/180/16, dx=dy*Math.cos(Math.PI/6);
  const grid=Array.from({length:5},(_,i)=>Array.from({length:5},(_,j)=>100+0.1*(j-2)*dx+0.2*(i-2)*dy));
  const t=terrain(grid,30);
  assert.ok(Math.abs(t.slope-Math.atan(Math.hypot(.1,.2))*180/Math.PI)<.001);
  assert.equal(t.roughness,0); assert.equal(t.elevation,100);
});
test('coordinates wrap east longitude and reject invalid latitude', () => {
  assert.deepEqual(pixel(0,-1),pixel(0,359)); assert.deepEqual(pixel(0,360),pixel(0,0));
  assert.throws(()=>pixel(91,0)); assert.throws(()=>pixel(NaN,0));
});
test('missing and malformed windows fail rather than yield measurements', () => {
  assert.throws(()=>terrain([[1]],0));
  assert.throws(()=>terrain(Array.from({length:5},()=>Array(5).fill(NaN)),0));
});
