import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const BASE = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/float_img/ldem_16_float';
const W = 5760, H = 2880, PPD = 16, R = 1737400;
const rad = x => x * Math.PI / 180;
const round = x => Math.round(x * 1000) / 1000;
const json = x => JSON.stringify(x, null, 2) + '\n';
const dims = JSON.parse(await readFile(resolve(ROOT, 'data/dimensions.json'), 'utf8'));
const sitesFile = resolve(ROOT, 'data/sites.json');
const samplesDir = resolve(ROOT, 'data/samples');

export function pixel(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90) throw Error('Use finite coordinates; latitude must be -90..90. Longitude is east-positive.');
  return { row: Math.min(H - 1, Math.floor((90 - lat) * PPD)), col: Math.floor(((lon % 360 + 360) % 360) * PPD) };
}

export function validateLabel(label) {
  const expect = { PRODUCT_ID: '"LDEM_16_FLOAT"', LINES: '2880', LINE_SAMPLES: '5760', SAMPLE_TYPE: 'PC_REAL', SAMPLE_BITS: '32', UNIT: 'KILOMETER', SCALING_FACTOR: '1', OFFSET: '1737.4', MAP_RESOLUTION: '16', WESTERNMOST_LONGITUDE: '0', MAXIMUM_LATITUDE: '90' };
  for (const [key, value] of Object.entries(expect)) {
    const actual = label.match(new RegExp('^\\s*' + key + '\\s*=\\s*([^\\r\\n]+)', 'm'))?.[1].trim().split(/\s+</)[0];
    if (actual !== value) throw Error(`Unsupported label ${key}: ${actual}`);
  }
}

async function get(url, range) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000), headers: range ? { Range: `bytes=${range[0]}-${range[1]}` } : {} });
  if (!range) { if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`); return response.text(); }
  const expected = `bytes ${range[0]}-${range[1]}/${W * H * 4}`;
  if (response.status !== 206 || response.headers.get('content-range') !== expected) {
    await response.body?.cancel();
    throw Error('Archive did not honor the exact byte range; full image download refused.');
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length !== range[1] - range[0] + 1) throw Error('Truncated image range');
  return buf;
}

export function terrain(grid, lat) {
  const n = grid.length, half = (n - 1) / 2;
  if (n < 3 || n % 2 !== 1 || grid.some(row => row.length !== n || row.some(v => !Number.isFinite(v) || v < -12000 || v > 12000))) throw Error('Invalid or missing elevation pixels');
  const dy = R * rad(1 / PPD), dx = dy * Math.cos(rad(lat));
  if (dx < 100) throw Error('Polar sampling requires a projected polar DEM');
  let sxz = 0, syz = 0, sxx = 0, syy = 0;
  const values = grid.flat(), mean = values.reduce((a,b) => a+b,0) / values.length;
  grid.forEach((row,i) => row.forEach((z,j) => {
    const x = (j-half)*dx, y = (i-half)*dy;
    sxz += x*(z-mean); syz += y*(z-mean); sxx += x*x; syy += y*y;
  }));
  const a = sxz/sxx, b = syz/syy;
  let residual = 0;
  grid.forEach((row,i) => row.forEach((z,j) => { residual += (z-mean-a*(j-half)*dx-b*(i-half)*dy)**2; }));
  return { elevation: round(grid[half][half]), slope: round(Math.atan(Math.hypot(a,b))*180/Math.PI), roughness: round(Math.sqrt(residual/values.length)), relief: round(Math.max(...values)-Math.min(...values)), spacing_m: { east_west: round(dx), north_south: round(dy) }, neighborhood_m: { east_west: round(n*dx), north_south: round(n*dy) } };
}

async function save(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + '.tmp', json(obj)); await rename(path + '.tmp', path);
}

async function extract(lat, lon) {
  const { row, col } = pixel(lat, lon), half = 2;
  if (row < half || row + half >= H || Math.abs(lat) > 85) throw Error('This cylindrical prototype supports latitude -85..85; use polar DEMs for polar sites.');
  const label = await get(BASE + '.lbl'); validateLabel(label);
  const grid = [];
  // Read complete rows to support windows crossing the 0/360 seam.
  for (let r = row-half; r <= row+half; r++) {
    const buf = await get(BASE + '.img', [r*W*4, (r+1)*W*4-1]);
    grid.push(Array.from({length:5}, (_,j) => buf.readFloatLE(((col+j-half+W)%W)*4)*1000));
  }
  const sampledLat = 90-(row+0.5)/PPD, sampledLon = (col+0.5)/PPD;
  const t = terrain(grid, sampledLat), measurements = {};
  for (const [category, keys] of Object.entries(dims)) for (const key of keys) measurements[key] = { category, value: null, status: 'not_implemented' };
  for (const key of ['elevation','slope','roughness','relief']) measurements[key] = {
    category: 'terrain', value: t[key], unit: key === 'slope' ? 'degree' : 'm',
    status: 'extracted', source_product_ids: ['LDEM_16_FLOAT'],
    statistic: { elevation: 'nearest pixel', slope: 'least-squares plane slope', roughness: 'RMS residual from fitted plane', relief: 'maximum minus minimum' }[key],
    method: key === 'elevation' ? 'Float32 little-endian DN times 1000; height relative to 1737.4 km reference sphere' : '5 by 5 pixel window; local spherical spacing at sampled latitude',
    resolution_m: t.spacing_m, neighborhood_m: t.neighborhood_m,
    quality_notes: ['Coarse regional terrain only; not landing or rover hazard certification.', 'LOLA gridded product includes interpolation; pixel validity checked by finite values and conservative height bounds.', 'Slope and roughness depend on spatial scale; local tangent-plane approximation.']
  };
  measurements.wind.status = 'not_applicable';
  return { schema_version: '1.0', body: 'Moon', requested: {lat, lon_e: lon}, sampled: {lat: sampledLat, lon_e: sampledLon, row, col}, retrieved_at: new Date().toISOString(), source: { product_id: 'LDEM_16_FLOAT', label_url: BASE+'.lbl', image_url: BASE+'.img', label }, elevation_window_m: grid, measurements, ready_for_scoring: false };
}

export async function main(args) {
  const [cmd, ...rest] = args;
  if (cmd === 'dimensions') return console.log(json(dims));
  if (cmd === 'datasets') return console.log(json({ body:'Moon', datasets:[{ id:'LDEM_16_FLOAT', instrument:'LOLA', quantities:['elevation','slope','roughness','relief'], label_url:BASE+'.lbl', nominal_equatorial_resolution_m:1895.21 }], source_candidates:JSON.parse(await readFile(resolve(ROOT,'../moon-data/config/probes.json'),'utf8')) }));
  if (cmd === 'sites' || cmd === 'site') {
    const data = JSON.parse(await readFile(sitesFile,'utf8'));
    const result = cmd === 'sites' ? {body:data.body,sites:data.sites.map(s=>({id:s.id,name:s.name,lat:s.lat,lon_e:s.lon_e,dimensions:Object.keys(s.dimensions||{}).length}))} : data.sites.find(s => s.id === rest[0]?.toLowerCase());
    if (!result) throw Error('Unknown site ID; run sites');
    return console.log(json(result));
  }
  if (cmd === 'measurements') {
    const siteId=rest[0]?.toLowerCase(); if(!siteId) throw Error('measurements requires a site ID');
    const data=JSON.parse(await readFile(sitesFile,'utf8')), site=data.sites.find(s=>s.id===siteId);
    if(!site) throw Error(`Unknown site ${siteId}; run sites`);
    return console.log(json({site:site.id,name:site.name,dimensions:site.dimensions,hard_constraints:dims.hard_constraints,analog_context:dims.earth_analog_sources}));
  }
  if (cmd === 'analogs') return console.log(json({sources:dims.earth_analog_sources,already_done_examples:dims.already_done_examples,gap:dims.analog_gap,hard_constraints:dims.hard_constraints}));
  if (cmd === 'sample') {
    if (rest.length !== 2 || rest.some(v => !v.trim())) throw Error('sample requires LAT LON_E');
    const result = await extract(Number(rest[0]), Number(rest[1]));
    const path = resolve(ROOT,'data/samples', `${result.sampled.row}_${result.sampled.col}.json`);
    await save(path,result);
    const data=JSON.parse(await readFile(sitesFile,'utf8'));
    const siteId=rest[2]?.toLowerCase() || `sample_${result.sampled.row}_${result.sampled.col}`;
    const site={id:siteId,name:siteId.startsWith('sample_')?'Saved coordinate sample':siteId.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()),lat:result.sampled.lat,lon_e:result.sampled.lon_e,location_status:'sample_coordinate',source_sample:`data/samples/${result.sampled.row}_${result.sampled.col}.json`,dimensions:{}};
    const byId=new Map(dims.scoring_dimensions.map(d=>[d.id,d]));
    for(const group of dims.scoring_dimensions){site.dimensions[group.id]={name:group.name,subdimensions:{}};for(const sub of group.subdimensions){const measurement=result.measurements[sub.id];site.dimensions[group.id].subdimensions[sub.id]=measurement||{value:null,status:sub.status,meaning:sub.status==='candidate_sources_only'?'Archive product candidates exist; no value extracted at this site.':'No site measurement or assessment saved.'};}}
    site.facts=[{category:'terrain',key:'feature_class',value:'Crater',status:'catalog_metadata',src:'https://oderest.rsl.wustl.edu/live2/?query=featuredata&odemetadb=moon&featurename=Copernicus&output=JSON'}];
    site.dimensions.terrain.subdimensions.craters={value:null,status:'candidate_sources_only',meaning:'No crater count or local detection has been calculated.'};
    const old=data.sites.findIndex(s=>s.id===siteId);if(old>=0)data.sites[old]=site;else data.sites.push(site);
    await save(sitesFile,data); console.log(json(result)); console.error(`Saved measurement and site ${siteId}`); return;
  }
  console.log('Moon local data CLI\n  node moon-cli/moon.mjs dimensions\n  node moon-cli/moon.mjs datasets\n  node moon-cli/moon.mjs sites\n  node moon-cli/moon.mjs site copernicus\n  node moon-cli/moon.mjs measurements copernicus\n  node moon-cli/moon.mjs analogs\n  node moon-cli/moon.mjs sample LAT LON_E [SITE_ID]');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode=1; });
