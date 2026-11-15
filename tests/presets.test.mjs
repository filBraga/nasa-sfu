import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { OPERATION_PRESETS, findPreset, presetDimensions } from '../web/presets.js';
import { aggregateSimilarity } from '../web/similarity.js';

const data = JSON.parse(await readFile(new URL('../web/data/results.json', import.meta.url), 'utf8'));
const main = await readFile(new URL('../web/main.js', import.meta.url), 'utf8');

test('all researched operations select existing physical metrics and retain missing evidence', () => {
  assert.equal(new Set(OPERATION_PRESETS.map(p => p.id)).size, 7);
  for (const preset of OPERATION_PRESETS) {
    const selected = presetDimensions(preset.id, data.dimensions);
    assert.equal(selected.size, preset.metrics.length);
    assert.ok(preset.unmeasured.length > 60);
    assert.ok(preset.sources.every(s => new URL(s.url).hostname.endsWith('nasa.gov')));
    assert.ok(!selected.has('demo_tpi'));
    const absent = aggregateSimilarity({}, data.dimensions, selected, { config: data.scoring, body: 'mars' });
    assert.equal(absent.score, null);
    assert.equal(absent.coverage, 0);
  }
  assert.throws(() => presetDimensions('unknown', data.dimensions));
  assert.throws(() => presetDimensions('rover', {}), /unknown dimension/);
  assert.equal(findPreset('unknown'), null);
  assert.ok(!presetDimensions('radar', data.dimensions).has('radar_cpr'));
});

test('preset selection preserves Moon dust exclusion, target applicability and missing-data coverage', () => {
  const selected = presetDimensions('solar', data.dimensions);
  const scores = Object.fromEntries([...selected].map(k => [k, .8]));
  const options = { body: 'moon', config: data.scoring, notApplicable: ['illumination'] };
  const complete = aggregateSimilarity(scores, data.dimensions, selected, options);
  const changed = aggregateSimilarity({ ...scores, surface_dust: 0, illumination: 0 }, data.dimensions, selected, options);
  assert.deepEqual(changed, complete);
  assert.equal(complete.coverage, 1);
  delete scores.cold;
  delete scores.thermal_amplitude;
  const missing = aggregateSimilarity(scores, data.dimensions, selected, options);
  assert.ok(missing.coverage < 1);
  assert.equal(missing.score, null);
  assert.ok(Math.abs(missing.observed_score - .8) < 1e-12);
});

test('actual viewer applies preset layers, recomputes rankings and clears preset on manual edits', () => {
  const storage = new Map();
  let changes = 0;
  const state = { data, dims: new Set(['slope']) };
  const context = vm.createContext({ state, findPreset, presetDimensions, URLSearchParams,
    location: { search: '?preset=radar' },
    localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    saveDims() {}, renderPreset() {}, renderDims() {}, renderScoring() {}, renderPanel() { changes++; },
    renderTopMatches() { changes++; }, buildPairLines() { changes++; },
  });
  const init = main.slice(main.indexOf('function initPreset()'), main.indexOf('function renderPreset()'));
  const changed = main.slice(main.indexOf('function dimsChanged('), main.indexOf('/** Re-score everything after a weight/algorithm change'));
  vm.runInContext(`const PRESET_KEY = 'operation'; ${init} ${changed} initPreset(); dimsChanged(true);`, context);
  assert.equal(state.preset, 'radar');
  assert.deepEqual([...state.dims], [...presetDimensions('radar', data.dimensions)]);
  assert.equal(storage.get('operation'), 'radar');
  assert.equal(changes, 3);
  vm.runInContext('dimsChanged();', context);
  assert.equal(state.preset, null);
  assert.equal(storage.has('operation'), false);
  assert.equal(changes, 6);
  storage.set('operation', 'rover');
  context.location.search = '?dims=slope';
  vm.runInContext('initPreset();', context);
  assert.equal(state.preset, null);
});
