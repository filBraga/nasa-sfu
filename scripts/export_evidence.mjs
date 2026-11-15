/** Offline, compact evidence export. No raw rasters or product labels are shipped. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const east = lon => ((lon % 360) + 360) % 360;
const pointKey = (lat, lon) => `${lat.toFixed(6)},${east(lon).toFixed(6)}`;
const fields = ['key', 'value', 'unit', 'status', 'note', 'verified', 'method',
  'pixel_spacing_m', 'pixel_spacing_deg', 'window_m', 'observation_period',
  'local_time_basis', 'spatial_note', 'retrieved_at', 'sampled'];
export function compactFact(f, dimensions = {}) {
  const fact = Object.fromEntries(fields.filter(k => f[k] !== undefined).map(k => [k, f[k]]));
  fact.category = f.category || dimensions[f.dim] || 'Other';
  fact.source = f.src || f.source_url || null;
  fact.scored = false;
  return fact;
}

export async function exportEvidence() {
  const records = [];
  for (const body of ['moon', 'mars']) {
    const data = await read(`${body}-data/${body}_data.json`);
    for (const s of data.sites) records.push({
      id: `${body}-${s.id}`, source_id: s.id, body, name: s.name,
      lat: s.lat, lon: east(s.lon_e), scope: 'Published site or regional context',
      coordinate_note: data.meta.note,
      source_file: `${body}-data/${body}_data.json`,
      facts: s.facts.map(f => compactFact(f, data.dimensions)),
    });
  }
  // Keep configured sampling coordinates separate from regional literature records.
  const configured = await read('moon-data/data/sites.json');
  for (const s of configured.sites) records.push({
    id: `moon-sample-${s.id}`, source_id: s.id, body: 'moon', name: `${s.name} (sample location)`,
    lat: s.lat, lon: east(s.lon_e), scope: 'Measurements at saved sampling coordinates',
    coordinate_note: s.note || s.location_status,
    source_file: 'moon-data/data/sites.json', facts: s.facts.map(f => compactFact(f)),
  });
  const enrichments = await Promise.all(['diviner', 'materials', 'global_terrain']
    .map(name => read(`moon-data/data/enrichment/${name}.json`)));
  for (const record of records.filter(s => s.body === 'moon')) {
    for (const data of enrichments) {
      const p = data.points[pointKey(record.lat, record.lon)];
      if (p) record.facts.push(...p.measurements.map(f => compactFact(f)));
    }
  }
  const results = await read('web/data/results.json');
  const aliases = { shackleton: 'shackleton_crater' };
  const out = resolve(root, 'web/data/evidence');
  await mkdir(out, { recursive: true });
  const summaries = [];
  for (const record of records) {
    const file = `${record.id}.json`;
    await writeFile(resolve(out, file), JSON.stringify(record));
    const { facts, ...summary } = record;
    summaries.push({ ...summary, file, fact_count: facts.length });
  }
  const targets = {};
  for (const s of Object.values(results.sites).filter(s => s.body !== 'earth')) {
    targets[s.id] = records.filter(r => r.body === s.body &&
      [s.id, aliases[s.id]].includes(r.source_id)).map(r => ({
        id: r.id,
        exact_location: Math.abs(r.lat - s.lat) < 1e-5 &&
          Math.abs(((r.lon - east(s.lon) + 540) % 360) - 180) < 1e-5,
      }));
  }
  const index = { version: 1, policy: 'Evidence is contextual and does not enter comparison scores. Missing values remain null. Source presence is not independent verification.',
    records: summaries, targets };
  try {
    const dust = await read('moon-data/data/enrichment/dust.json');
    await writeFile(resolve(root, 'web/data/lunar_dust.json'), JSON.stringify(dust));
    index.lunar_dust = '../lunar_dust.json';
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(resolve(out, 'index.json'), JSON.stringify(index));
  console.log(`Exported ${records.length} records / ${records.reduce((n, r) => n + r.facts.length, 0)} facts; no raster downloads.`);
  return index;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await exportEvidence();
