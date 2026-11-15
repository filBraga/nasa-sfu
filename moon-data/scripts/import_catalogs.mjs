#!/usr/bin/env node
// Rebuild from saved source HTML by default; --refresh retrieves both official tables.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = {pits:'https://lroc.im-ldi.com/atlases/pits/list', landers:'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html'};
function text(html) {
  return html.replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]*>/g,'').replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&(nbsp|amp|lt|gt|quot|apos|deg);/g,(_,n)=>({nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",deg:'°'}[n])).replace(/\s+/g,' ').trim();
}
function rows(html) {
  const table = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0];
  if (!table) throw Error('Source table missing');
  return [...table.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)].map(m=>({attributes:m[1],cells:[...m[2].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>c[1])}));
}
const numeric = s => /^-?\d+(?:\.\d*)?$/.test(s) ? Number(s) : null;
export function parsePits(html) {
  const result=[];
  for (const {cells} of rows(html)) {
    if (!cells[1]?.includes('/atlases/pits/')) continue;
    const c=cells.map(text), path=cells[1].match(/href="([^"]+)"/i)?.[1];
    if (c.length!==13 || numeric(c[2])===null || numeric(c[3])===null) throw Error('Unexpected pit row');
    result.push({id:`lroc_pit_${path.split('/').at(-1)}`, name:c[1], host_feature:c[0], type:'pit/skylight candidate',
      lat:Number(c[2]), lon_e:Number(c[3]), funnel_max_diameter_m:numeric(c[4]), funnel_min_diameter_m:numeric(c[5]),
      inner_max_diameter_m:numeric(c[6]), inner_min_diameter_m:numeric(c[8]), azimuth_deg:numeric(c[10]), depth_m:numeric(c[11]), depth_text:c[11],
      status:'catalog_candidate', priority:null, comment:'LROC pit catalog entry; accessible cave or lava tube not established by this listing.',
      source_url:new URL(path,SOURCES.pits).href, source_cells:c});
  }
  if (result.length<100) throw Error('Pit table incomplete or changed');
  return result;
}
export function parseLanders(html) {
  const result=[];
  for (const {attributes,cells} of rows(html)) {
    if (cells.length!==9 || !cells[0].includes('<a ')) continue;
    const c=cells.map(text), pair=c[4].match(/^(-?\d+(?:\.\d*)?)\s*,\s*(-?\d+(?:\.\d*)?)$/);
    const unknown=/unknown/i.test(c[4]);
    if (!unknown && !pair) throw Error(`Unrecognized coordinates: ${c[0]}: ${c[4]}`);
    const link=cells[0].match(/href="([^"]+)"/i)?.[1];
    const noteLinks=[...cells[5].matchAll(/href="([^"]+)"/gi)].map(m=>new URL(m[1],SOURCES.landers).href);
    result.push({id:`nasa_${result.length+1}`,name:c[0],date:c[2],outcome:c[1],type:c[1],
      lat:pair?Number(pair[1]):null,lon_e:pair?Number(pair[2]):null,
      location_status:unknown?'unknown':/5EFE31/i.test(attributes)?'imaged_by_LRO':'approximately_known',
      coordinates_text:c[4], source_url:SOURCES.landers,mission_url:link?new URL(link,SOURCES.landers).href:null,
      note_references:noteLinks,note:'Landing type is copied from NASA; impacts and hardware are included, not only landers.',source_cells:c});
  }
  if (result.length<50) throw Error('Spacecraft table incomplete or changed');
  return result;
}
export async function main(args) {
  if (args.some(a=>a!=='--refresh')) throw Error('Usage: node --use-system-ca moon-cli/scripts/import_catalogs.mjs [--refresh]');
  const dir=resolve(ROOT,'data/catalogs'); await mkdir(dir,{recursive:true});
  let provenance;
  if (args.includes('--refresh')) {
    provenance={};
    for (const [key,url] of Object.entries(SOURCES)) {
      const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
      if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
      const html=await response.text();
      // Validate before replacing the snapshot.
      (key==='pits'?parsePits:parseLanders)(html);
      await writeFile(resolve(dir,`${key}.html`),html,'utf8');
      provenance[key]={url,retrieved_at:new Date().toISOString(),sha256:createHash('sha256').update(html).digest('hex')};
    }
    await writeFile(resolve(dir,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
  } else provenance=JSON.parse(await readFile(resolve(dir,'provenance.json'),'utf8'));
  for (const [key,url] of Object.entries(SOURCES)) {
    const html=await readFile(resolve(dir,`${key}.html`),'utf8');
    if (createHash('sha256').update(html).digest('hex')!==provenance[key].sha256) throw Error(`Snapshot checksum mismatch: ${key}`);
    const parsed=(key==='pits'?parsePits:parseLanders)(html);
    const arrayKey=key==='pits'?'caves':'landers';
    const doc={schema_version:'1.0',body:'Moon',source:url,...provenance[key],
      source_last_updated:key==='landers'?(html.match(/Last Updated:\s*([^<]+)/i)?.[1]?.trim() ?? null):null,
      scope:key==='pits'?'All rows in the retrieved LROC Pits Atlas list; pit candidates are not confirmed accessible caves.':'All rows in the retrieved NASA table, including impacts and hardware. This historical table is not a complete current list of lunar landing attempts.',
      coordinate_convention:'Planetocentric latitude, east-positive longitude in degrees, as provided by source; uncertainty and source precision retained.',
      note:'Raw source cells retain qualifiers such as > and Unknown. Numeric fields are null when the source is qualified or unavailable. Source note references resolve to the archived HTML snapshot as well as the live page.',
      snapshot:`data/catalogs/${key}.html`,[arrayKey]:parsed};
    if (key==='landers') doc.source_notes_text=text(html.slice(html.toLowerCase().indexOf('</table>')+8));
    await writeFile(resolve(ROOT,`moon_${arrayKey}.json`),JSON.stringify(doc,null,2)+'\n');
    console.log(`Saved moon_${arrayKey}.json: ${parsed.length} rows`);
  }
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
