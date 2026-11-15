import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compactFact, exportEvidence } from '../scripts/export_evidence.mjs';

test('compact facts retain missing values and quality while excluding raw arrays', () => {
  const fact = compactFact({ key: 'temperature', value: null, status: 'unverified',
    src: 'https://example.com', raw_hex: '1234', verified: { verdict: 'NOT CHECKED' } });
  assert.equal(fact.value, null);
  assert.equal(fact.scored, false);
  assert.equal(fact.status, 'unverified');
  assert.equal(fact.verified.verdict, 'NOT CHECKED');
  assert.equal(fact.raw_hex, undefined);
});

test('export preserves separate locations and exact sampled coordinates', async () => {
  const index = await exportEvidence();
  assert.equal(index.records.length, 19);
  assert.equal(index.targets.jezero[0].exact_location, false);
  assert.equal(index.targets.arcadia[0].exact_location, false);
  assert.ok(index.targets.shackleton.some(s => s.id === 'moon-sample-shackleton' && s.exact_location));
  assert.ok(index.targets.shackleton.some(s => s.id === 'moon-shackleton_crater' && !s.exact_location));
  for (const summary of index.records) {
    const data = JSON.parse(await readFile(new URL(`../web/data/evidence/${summary.file}`, import.meta.url)));
    assert.equal(data.facts.length, summary.fact_count);
    assert.ok(data.facts.every(f => f.scored === false));
    assert.ok(!JSON.stringify(data).includes('elevation_window_m'));
  }
  const copernicus = JSON.parse(await readFile(new URL('../web/data/evidence/moon-copernicus.json', import.meta.url)));
  assert.ok(copernicus.facts.some(f => f.key === 'midnight_bolometric_temperature' && f.unit === 'K'));
  assert.ok(copernicus.facts.some(f => f.pixel_spacing_m));
});
