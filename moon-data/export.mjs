#!/usr/bin/env node
/** Offline Moon bundle, following mars.py's layer-tagged aggregation contract. */
import { readFile, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { thermalRegions } from './thermal-regions.mjs';
import { eastLongitude,spatialAudit } from './spatial-audit.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

export async function buildBundle(root = ROOT) {
  const records = {};
  async function readJson(path) {
    const bytes = await readFile(resolve(root,path));
    const encoding = bytes[0]===0xff && bytes[1]===0xfe ? 'utf16le' : 'utf8';
    try { return JSON.parse(bytes.toString(encoding).replace(/^\uFEFF/,'')); }
    catch (error) { throw Error(`${path}: ${error.message}`); }
  }
  async function collect(dir) {
    for (const entry of (await readdir(resolve(root, dir), { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile() && entry.name.endsWith('.json')) records[path] = await readJson(path);
    }
  }
  for (const entry of await readdir(root)) {
    if (/^moon_.*\.json$/.test(entry)) records[entry] = await readJson(entry);
  }
  await collect('data');
  await collect('config');
  const main = records['moon_data.json'];
  const taxonomy = records['data/dimensions.json'];
  if (!main || !taxonomy || taxonomy.scoring_dimensions.length !== 8) throw Error('Moon data and all eight scoring dimensions are required');
  for (let d=1; d<=8; d++) if (!main.dimensions[d]) throw Error(`Missing dimension ${d}`);
  const points = [], unlocated = [];
  function add(record, source, kind, dims, info = []) {
    const p = { n:record.name ?? record.id, k:kind, la:record.lat, lo:record.lon_e, d:[...new Set(dims)].sort(), i:info, source, record_id:record.id ?? record.name };
    if (!Number.isFinite(p.la) || !Number.isFinite(p.lo)) { unlocated.push({source,record}); return; }
    if (Math.abs(p.la)>90 || p.lo < -180 || p.lo > 360) throw Error(`Invalid coordinates: ${p.n}`);
    p.lo=eastLongitude(p.lo);
    if (p.d.some(d=>!Number.isInteger(d)||d<1||d>8)) throw Error(`Invalid dimension: ${p.n}`);
    points.push(p);
  }
  for (const s of main.sites) add(s,'moon_data.json','researched site',s.facts.filter(f=>f.value!=null).map(f=>f.dim),s.facts.map(f=>`D${f.dim} ${f.key}: ${f.value ?? 'unknown'} ${f.unit ?? ''} [${f.status}]`));
  for (const f of records['moon_features.json']?.features ?? []) {
    const geology = /mare|oceanus|lacus|palus|sinus/i.test(f.type);
    add(f,'moon_features.json','named feature',[geology?1:2],[f.type, f.origin ?? '']);
  }
  const missing = [];
  for (const [name,key,dim,kind] of [['moon_caves.json','caves',7,'cave candidate'],['moon_landers.json','landers',8,'lander / rover'],['moon_candidates.json','candidates',8,'candidate / exploration zone']]) {
    if (!records[name]) { missing.push(name); continue; }
    if (!Array.isArray(records[name][key])) throw Error(`Missing ${key} array in ${name}`);
    for (const r of records[name][key]) {
      const actualKind = key==='caves' ? (r.type ?? kind) : key==='landers' ? `spacecraft / ${r.type ?? r.outcome ?? 'unknown'}` : kind;
      const info = key==='caves' ? [r.host_feature ?? '', `depth (m): ${r.depth_text ?? 'unknown'}`, r.comment ?? ''] : [r.date ?? '',r.outcome ?? '',r.location_status ?? '',r.note ?? ''];
      add(r,name,actualKind,[dim],info);
    }
  }
  for (const s of records['data/sites.json']?.sites ?? []) {
    const ds = taxonomy.scoring_dimensions.flatMap((g,i)=>Object.values(s.dimensions?.[g.id]?.subdimensions ?? {}).some(m=>m.value!=null)?[i+1]:[]);
    add(s,'data/sites.json','sampled site',ds);
  }
  const scoutPoints=records['moon_scout_points.json']?.points ?? [];
  const regions=thermalRegions(scoutPoints);
  const enrichment=records['data/enrichment/regions.json'];
  for(const region of regions) {
    const saved=enrichment?.points?.[region.id];
    if(!saved)continue;
    if(saved.lat!==region.lat||saved.lon_e!==region.lon_e||saved.representative_id!==region.representative_id)throw Error('Region enrichment is stale; rerun scripts/enrich_regions.mjs');
    region.measurements.push(...saved.measurements);
    region.quality_notes=saved.quality_notes??['Native samples at the representative coordinate only; not regional averages.'];
    if(saved.measurements.some(m=>m.key==='observation_count'&&m.value===0))region.quality_notes.push('No LOLA spots in this count-map pixel; terrain may rely on interpolation.');
    region.dims=[...new Set(region.measurements.filter(m=>m.value!==null).map(m=>m.dim))].sort();
    region.enrichment_targets=region.enrichment_targets.map(t=>({...t,status:t.quantities.every(q=>saved.measurements.some(m=>m.key===(q==='solar_illumination'?'average_solar_disc_visibility':q)&&m.value!==null))?'extracted_at_representative':t.status}));
  }
  records['derived/thermal_regions.json']={points:regions,policy:'Compact map summaries. All original bins remain in moon_scout_points.json.'};
  for (const p of scoutPoints.filter(p=>p.kind!=='observed thermal bin')) {
    add(p,'moon_scout_points.json',p.kind,p.dims,[p.note,p.location_status,...(p.measurements??[]).map(m=>`D${m.dim} ${m.key}: ${m.value??'unknown'} ${m.unit??''} [${m.status}]`)].filter(Boolean));
  }
  for(const p of regions)add(p,'derived/thermal_regions.json',p.kind,p.dims,[p.note,`Temperature: ${p.temperature_K.min.toFixed(1)}–${p.temperature_K.max.toFixed(1)} K; median ${p.temperature_K.median.toFixed(1)} K`]);
  for(const p of points){
    const baseline=records['data/enrichment/global_terrain.json']?.points?.[`${p.la.toFixed(6)},${p.lo.toFixed(6)}`];
    if(baseline){p.measurements=baseline.measurements;if(!p.d.includes(2))p.d.push(2);p.d.sort();}
    const materials=records['data/enrichment/materials.json']?.points?.[`${p.la.toFixed(6)},${p.lo.toFixed(6)}`];
    if(materials?.measurements.length){p.measurements=[...(p.measurements??[]),...materials.measurements];if(materials.measurements.some(m=>m.value!==null)&&!p.d.includes(1))p.d.push(1);p.d.sort();}
    const diviner=records['data/enrichment/diviner.json']?.points?.[`${p.la.toFixed(6)},${p.lo.toFixed(6)}`];
    if(diviner){p.measurements=[...(p.measurements??[]),...diviner.measurements];p.d=[...new Set([...p.d,...diviner.measurements.filter(m=>m.value!==null).map(m=>m.dim)])].sort();}
  }
  const layers = Object.fromEntries(taxonomy.scoring_dimensions.map((g,i)=>[i+1,{...g,point_count:points.filter(p=>p.d.includes(i+1)).length}]));
  const extractedDatasets=[
    {id:'extracted_lola64',name:'LOLA 64 ppd terrain baseline',dims:[2],coverage:'global, derivative guard above 85 degrees',resolution:'~474 m north-south pixels; 5x5 plane-fit window ~2.4 km',url:records['data/enrichment/global_terrain.json']?.source_url},
    {id:'extracted_hapke',name:'LROC 643 nm Hapke reflectance model',dims:[1],coverage:'70 S–70 N, native valid pixels',resolution:'1 degree',url:records['data/enrichment/materials.json']?.source_page},
    {id:'extracted_diviner_ghrm',name:'Diviner midnight temperature and rock abundance',dims:[1,3],coverage:'70 S–70 N; unavailable rock pixels stay null',resolution:'128 ppd; grid spacing is not effective resolution',url:'https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_ghrm/'}
  ].filter(d=>d.url);
  return {
    schema_version:'1.0', body:'Moon', built:new Date().toISOString(),
    scope:'All locally saved Moon JSON data and configuration; not a complete lunar archive or fresh retrieval.',
    dims:main.dimensions, layers, points, unlocated,spatial_audit:spatialAudit(points),
    datasets:[...main.datasets,...extractedDatasets], cites:records['moon_citations.json']?.dims ?? {},
    hard_constraints:taxonomy.hard_constraints, already_done_examples:taxonomy.already_done_examples,
    ready_for_scoring:false, missing_catalogs:missing,
    notes:['Layer assignment of named features is a project interpretation, not a NASA classification.', 'Source statuses and citations are preserved as supplied; bundling does not verify scientific claims.', 'Null means missing evidence, never a zero score. Overlapping researched and sampled sites retain separate provenance.'],
    records
  };
}

export async function main(args) {
  if (args.includes('--help')) { console.log('node moon-cli/export.mjs [--out FILE.json|FILE.js|FILE.mjs]\nDefault: moon-cli/dist/moon_bundle.json. Offline; no viewer.'); return; }
  if (args.length && (args.length!==2 || args[0]!=='--out')) throw Error('Use --out FILE.json|FILE.js|FILE.mjs');
  const out = resolve(args[1] ?? resolve(ROOT,'dist/moon_bundle.json'));
  if (!/\.(json|m?js)$/.test(out)) throw Error('Output must end in .json, .js or .mjs');
  const rel = relative(ROOT,out).replaceAll('\\','/');
  if (/^(data|config)\//.test(rel) || /^moon_.*\.json$/.test(rel) || out===fileURLToPath(import.meta.url) || out===resolve(ROOT,'moon.mjs')) throw Error('Output must not overwrite source data or CLI');
  const bundle = await buildBundle();
  const json = JSON.stringify(bundle,null,2);
  const content = out.endsWith('.json') ? json+'\n' : out.endsWith('.mjs') ? `const moon = ${json};\nexport default moon;\n` : `globalThis.MOON = ${json};\n`;
  await mkdir(dirname(out),{recursive:true});
  await writeFile(out+'.tmp',content,'utf8');
  await rename(out+'.tmp',out);
  console.log(`Saved ${out}: ${bundle.points.length} points, 8 layers, ${Object.keys(bundle.records).length} source documents. Missing catalogs: ${bundle.missing_catalogs.join(', ') || 'none'}`);
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
