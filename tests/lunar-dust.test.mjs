import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseLdex } from '../moon-data/scripts/sample_dust.mjs';
import { profileRows } from '../web/lunar-dust.js';

const label = await readFile(new URL('../moon-data/data/dust/ldex_ltden_pds_derived.xml', import.meta.url), 'utf8');
const raw = await readFile(new URL('../moon-data/data/dust/ldex_ltden_pds_derived.tab', import.meta.url));

test('native LDEX table retains altitude, local-time bins, densities, and errors', () => {
  const data = parseLdex(label, raw);
  assert.equal(data.profiles.length, 26);
  assert.equal(data.local_times.length, 11);
  assert.equal(data.local_times[0], '00:00');
  assert.equal(data.local_times[10], '22:30');
  assert.equal(data.profiles[0].altitude_km, 5);
  assert.equal(data.profiles.at(-1).altitude_km, 255);
  assert.equal(data.profiles[0].measurements[2][0], 3.16e-3);
  assert.equal(data.profiles[0].measurements[2][1], 4.34e-4);
  assert.ok(data.profiles.every(p => p.measurements.length === 11));
  assert.equal(profileRows(data, 10)[0].density, data.profiles[0].measurements[10][0]);
  assert.equal(profileRows(data, 10)[0].error, data.profiles[0].measurements[10][1]);
});

test('PDS missing constants stay missing; truncated or changed products are rejected', () => {
  const modified = Buffer.from(raw);
  modified.write(' -9.99E+00', 46, 'ascii');
  assert.equal(parseLdex(label, modified).profiles[0].measurements[2][0], null);
  assert.throws(() => parseLdex(label, raw.subarray(0, -1)), /size changed/);
  assert.throws(() => parseLdex(label.replace('<version_id>2.0</version_id>', '<version_id>3.0</version_id>'), raw), /version/);
});

test('Moon export never turns orbital dust or rock cover into surface dust scores', async () => {
  const doc = JSON.parse(await readFile(new URL('../web/data/lunar_dust.json', import.meta.url)));
  assert.equal(doc.ldex.scored, false);
  assert.equal(doc.ldex.unit, 'm^-3');
  assert.equal(doc.surface_dust.value, null);
  const config = JSON.parse(await readFile(new URL('../config/sites.json', import.meta.url)));
  assert.equal(Object.keys(doc.sites).length, config.sites.filter(s => s.body === 'moon').length);
  assert.ok(Object.values(doc.sites).filter(s => s.rock_abundance?.value != null).length >= 8);
  for (const site of Object.values(doc.sites)) assert.equal(site.surface_dust_fraction, null);
  for (const id of ['shackleton', 'malapert', 'mons_mouton_plateau']) {
    assert.equal(doc.sites[id].rock_abundance, null);
    assert.match(doc.sites[id].rock_status, /Outside/);
  }
  const results = JSON.parse(await readFile(new URL('../web/data/results.json', import.meta.url)));
  for (const c of results.comparisons.filter(c => results.sites[c.target].body === 'moon')) {
    assert.ok(!('surface_dust' in c.scores));
  }
});
