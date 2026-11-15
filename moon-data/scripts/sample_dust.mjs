/** Scout v3 LDEX extraction. Orbital dust stays separate from surface coverage. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = 'https://atmos.nmsu.edu/PDS/data/PDS4/LADEE/ldex_bundle/data_derived/';
const name = 'ldex_ltden_pds_derived';
const sha = value => createHash('sha256').update(value).digest('hex');
const tag = (xml, key) => new RegExp(`<${key}(?: [^>]*)?>([\\s\\S]*?)<\\/${key}>`).exec(xml)?.[1].trim();

export function parseLdex(label, raw) {
  if (tag(label, 'version_id') !== '2.0' ||
      tag(label, 'logical_identifier') !== 'urn:nasa:pds:ladee_ldex:data_derived:derived_ldex_ltden_pds_derived_tab') {
    throw Error('Unexpected LDEX product/version');
  }
  const area = /<File_Area_Observational>([\s\S]*?)<\/File_Area_Observational>/.exec(label)?.[1];
  const recordLength = Number(tag(area, 'record_length'));
  const count = Number(tag(area, 'records'));
  if (recordLength !== 228 || count !== 26 || raw.length !== recordLength * count ||
      Number(tag(area, 'file_size')) !== raw.length) throw Error('LDEX record layout or file size changed');
  const fields = [...area.matchAll(/<Field_Character>([\s\S]*?)<\/Field_Character>/g)].map(([, xml]) => ({
    name: tag(xml, 'name'), offset: Number(tag(xml, 'field_location')) - 1,
    length: Number(tag(xml, 'field_length')), unit: tag(xml, 'unit'),
    missing: tag(xml, 'missing_constant') == null ? null : Number(tag(xml, 'missing_constant')),
  }));
  if (fields.length !== 23 || fields[0].name !== 'ALTITUDE' || fields[0].unit !== 'Km' ||
      fields.slice(1).some(f => f.unit !== 'M**-3' || f.missing !== -9.99)) throw Error('Unexpected dust fields/units');
  const times = fields.filter(f => f.name.startsWith('DENSITY_')).map(f => f.name.slice(8, 12));
  if (times.length !== 11 || new Set(times).size !== 11) throw Error('Unexpected local-time bins');
  const profiles = [];
  for (let row = 0; row < count; row++) {
    const record = raw.subarray(row * recordLength, (row + 1) * recordLength);
    if (record.subarray(-2).toString() !== '\r\n') throw Error('Unexpected record delimiter');
    const values = Object.fromEntries(fields.map((f, i) => {
      // The archive label's 9-byte science fields start on the separator.
      // The next declared start defines a 10-byte slot holding the COMPLETE
      // number. Reading only field_length silently drops the exponent's last digit.
      const end = fields[i + 1]?.offset ?? recordLength - 2;
      if (end - f.offset !== (i === 0 ? 6 : 10)) throw Error('Unexpected numeric slot width');
      const text = record.subarray(f.offset, end).toString('ascii').trim();
      if (!(i === 0 ? /^\d+\.\d+$/ : /^[+-]?\d+\.\d+E[+-]\d{2}$/).test(text)) throw Error(`Invalid numeric format: ${f.name}`);
      const value = text ? Number(text) : NaN;
      if (!Number.isFinite(value)) throw Error(`Invalid numeric field: ${f.name}`);
      return [f.name, value === f.missing ? null : value];
    }));
    if (values.ALTITUDE == null || values.ALTITUDE < 0) throw Error('Invalid altitude');
    const measurements = times.map(time => {
      const density = values[`DENSITY_${time}_LT`], error = values[`ERROR_${time}_LT`];
      if ((density != null && density < 0) || (error != null && error < 0)) throw Error('Negative dust measurement');
      return [density, error];
    });
    profiles.push({ altitude_km: values.ALTITUDE, measurements });
  }
  return { local_times: times.map(t => `${t.slice(0, 2)}:${t.slice(2)}`), profiles,
    period: [tag(label, 'start_date_time'), tag(label, 'stop_date_time')] };
}

async function cached(path, url, refresh) {
  if (!refresh) { try { return await readFile(path); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100000) throw Error('Unexpectedly large LDEX file');
  await writeFile(path, bytes);
  return bytes;
}

export async function main(args = []) {
  const dir = resolve(root, 'data/dust'); await mkdir(dir, { recursive: true });
  const label = await cached(resolve(dir, `${name}.xml`), `${base}${name}.xml`, args.includes('--refresh'));
  const raw = await cached(resolve(dir, `${name}.tab`), `${base}${name}.tab`, args.includes('--refresh'));
  const parsed = parseLdex(label.toString('utf8'), raw);
  const diviner = JSON.parse(await readFile(resolve(root, 'data/enrichment/diviner.json'), 'utf8'));
  const config = JSON.parse(await readFile(resolve(root, '../config/sites.json'), 'utf8'));
  const sites = {};
  for (const s of config.sites.filter(s => s.body === 'moon')) {
    const key = `${s.lat.toFixed(6)},${(((s.lon % 360) + 360) % 360).toFixed(6)}`;
    const measurement = diviner.points[key]?.measurements.find(m => m.key === 'rock_abundance_slope_adjusted_midnight');
    sites[s.id] = { surface_dust_fraction: null,
      surface_dust_status: 'No comparable site-level surface dust map in Scout v3',
      rock_abundance: measurement || null,
      rock_status: measurement ? measurement.status : Math.abs(s.lat) >= 70 ? 'Outside selected Diviner coverage (70 S–70 N)' : 'No extracted sample at these target coordinates' };
  }
  const doc = { schema_version: 1, body: 'moon', scout: 'datascout_v3/ladee_ldex.md',
    surface_dust: { value: null, status: 'No comparable site-level surface coverage map extracted',
      context: 'Fine dust is part of lunar regolith. Missing map data does not mean dust is absent.',
      source: 'https://science.nasa.gov/moon/composition/' },
    ldex: { ...parsed, unit: 'm^-3', error_unit: 'm^-3', grain_radius_min_micrometers: 0.3,
      scope: 'Orbital lunar exosphere profiles by altitude and local time; no site latitude/longitude mapping',
      parsing_note: 'The label declares 9-byte density/error fields beginning on separator spaces. The actual table uses 10-byte slots. Complete numeric tokens are read up to the next declared start and validated, preserving both exponent digits.',
      scored: false, source: `${base}${name}.tab`, label_url: `${base}${name}.xml`, version: '2.0',
      label_sha256: sha(label), data_sha256: sha(raw),
      retrieved_at: (await stat(resolve(dir, `${name}.tab`))).mtime.toISOString(),
      limitation: 'Not surface dust coverage, thickness, adhesion, or a rover dust-hazard map. Do not extrapolate orbital profiles to the surface or assign them to individual sites.' },
    processed_at: new Date().toISOString(),
    leam: { status: 'Metadata only; raw uncalibrated local instrument records', scope: 'Apollo 17 station only',
      source: 'https://pds-geosciences.wustl.edu/lunar/urn-nasa-pds-a17leam_raw_arcsav/readme.txt',
      limitation: 'Raw detector counts are not calibrated surface dust concentration or a global map.' }, sites };
  await writeFile(resolve(root, 'data/enrichment/dust.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log(`LDEX: ${parsed.profiles.length} altitude bins × ${parsed.local_times.length} local times; units/errors and missing values preserved.`);
  console.log(`Diviner rock-cover evidence: ${Object.values(sites).filter(s => s.rock_abundance?.value != null).length}/${Object.keys(sites).length} target coordinates; surface dust remains unmeasured.`);
  return doc;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
}
