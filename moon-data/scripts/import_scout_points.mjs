#!/usr/bin/env node
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const BASE='https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_pcp/seasonal/slon/pols/pcp_avg_tbol_pols_ls030_slon01_240';
const COORDS='https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html';
const HASH=b=>createHash('sha256').update(b).digest('hex');
const TOTAL=3176166,LENGTH=68,OFFSET=68,SIZE=(TOTAL+1)*LENGTH;
export function parseTemperature(row,index) {
  if(row.length!==LENGTH || !row.endsWith('\r\n'))throw Error('Invalid Diviner fixed-width record');
  const fields=[[0,9],[11,9],[22,11],[35,10],[47,7],[56,10]].map(([a,n])=>Number(row.slice(a,a+n).trim()||'NaN'));
  if(fields.some(v=>!Number.isFinite(v)))throw Error('Non-numeric Diviner field');
  if(fields.some(v=>v===-9998||v===-9999))return null;
  const [x,y,lon,lat,time,t]=fields;
  if(Math.abs(lon)>180||lat< -90||lat> -79||time<0||time>=24||t<=0||t>400)throw Error('Diviner value outside expected bounds');
  return {id:`diviner_pcp_${index}`,name:`Diviner south-polar bin ${index}`,kind:'observed thermal bin',lat,lon_e:(lon+360)%360,dims:[3],
    source_url:BASE+'.xml',scout:'datascout_v2/diviner_dataset_card.md',source_row_index:index,source_row:row,
    original_longitude_deg:lon,polar_xy_normalized:[x,y],local_time_h:time,
    measurements:[{dim:3,key:'bolometric_brightness_temperature',value:t,unit:'K',status:'extracted',source_url:BASE+'.xml',
      spatial_bin_m:240,local_time_h:time,observation_period:['2009-07-05','2020-03-15'],ls_range_deg:[0,60],subsolar_longitude_range_deg:[0,15],
      method:'Average of nadir observations in the source seasonal/local-time bin; not instantaneous surface temperature.'}],
    note:'A sampled grid-bin location, not a named site. Sparse table subset; missing bins are not interpolated. No hazard or accessibility assessment.'};
}
export async function main(args) {
  if(args.some(a=>a!=='--refresh'))throw Error('Use --refresh to fetch sources, or no arguments for offline rebuild');
  const dir=resolve(ROOT,'data/scout_points');await mkdir(dir,{recursive:true});
  let manifest;
  if(args.includes('--refresh')) {
    manifest={retrieved_at:new Date().toISOString(),sources:[],sampling:'16 evenly spaced table blocks, 32 consecutive records per block. Sparse sample, not full coverage.'};
    const get=async(url)=>{const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`HTTP ${r.status}: ${url}`);return Buffer.from(await r.arrayBuffer());};
    for(const [name,url] of [['temperature.xml',BASE+'.xml'],['apollo_coordinates.html',COORDS]]) {
      const b=await get(url);await writeFile(resolve(dir,name),b);manifest.sources.push({file:name,url,sha256:HASH(b)});
    }
    const label=await readFile(resolve(dir,'temperature.xml'),'utf8');
    if(!label.includes('<records>3176166</records>')||!label.includes('<record_length unit="byte">68</record_length>'))throw Error('Diviner label layout changed');
    // Exact aligned reads avoid downloading the ~216 MB table or parsing truncated rows.
    for(let block=0;block<16;block++) {
      const index=Math.floor(block*(TOTAL-32)/15),start=OFFSET+index*LENGTH,end=start+32*LENGTH-1;
      const response=await fetch(BASE+'.tab',{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(60000)});
      if(response.status!==206||response.headers.get('content-range')!==`bytes ${start}-${end}/${SIZE}`){await response.body?.cancel();throw Error('Server did not honor exact table range');}
      const b=Buffer.from(await response.arrayBuffer());if(b.length!==32*LENGTH)throw Error('Truncated table block');
      const file=`temperature_${block}.txt`;await writeFile(resolve(dir,file),b);
      manifest.sources.push({file,url:BASE+'.tab',sha256:HASH(b),first_row_index:index,byte_range:[start,end]});
    }
    await writeFile(resolve(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  } else manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
  const points=[];
  for(const source of manifest.sources) {
    const b=await readFile(resolve(dir,source.file));if(HASH(b)!==source.sha256)throw Error('Snapshot checksum mismatch');
    if(source.first_row_index!==undefined)for(let i=0;i<32;i++) {
      const p=parseTemperature(b.subarray(i*LENGTH,(i+1)*LENGTH).toString('ascii'),source.first_row_index+i);if(p)points.push(p);
    }
  }
  const html=await readFile(resolve(dir,'apollo_coordinates.html'),'utf8');
  const clean=s=>s.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  let mission;
  for(const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>clean(x[1]));
    const heading=cells.join(' ').match(/Apollo\s+(\d+)/i);if(heading)mission=Number(heading[1]);
    if(cells[0]!=='ALSEP'||![15,17].includes(mission))continue;
    const lat=Number(cells[1]),lon=Number(cells[2]);if(!Number.isFinite(lat)||!Number.isFinite(lon))throw Error('Invalid ALSEP location');
    const is15=mission===15;
    points.push({id:`apollo${mission}_scout_alsep`,name:`Apollo ${mission} ALSEP — ${is15?'CCIG exosphere':'LEAM dust'}`,kind:'surface experiment context',lat,lon_e:(lon+360)%360,dims:[is15?3:5],
      source_url:COORDS,coordinate_frame:'DE421 Mean Earth/Polar Axis, planetocentric',location_status:'ALSEP central station reference; individual instrument offset not resolved',
      scout:`datascout_v3/apollo${mission}_${is15?'ccig':'leam'}.md`,
      dataset_url:`https://pds-geosciences.wustl.edu/lunar/urn-nasa-pds-a${mission}${is15?'side_ccig':'leam'}_raw_arcsav/`,
      measurements:[{dim:is15?3:5,key:is15?'exosphere_observations':'dust_detector_records',value:null,status:is15?'quarantined_source_errors':'not_extracted'}],
      note:is15?'Scout flags erroneous CCIG columns awaiting correction. No pressure value is inferred.':'Raw detector records are available; no calibrated surface dust flux was extracted.'});
  }
  if(points.filter(p=>p.kind==='surface experiment context').length!==2)throw Error('Expected two ALSEP references');
  const registry={schema_version:'1.0',body:'Moon',retrieved_at:manifest.retrieved_at,sampling:manifest.sampling,
    note:'Location-bearing observations and experiment context only. Raster coverage does not create additional measured points until pixels are extracted.',
    deferred:[{id:'apollo15_soil_mechanics',reason:'Six tests at Station 8; exact station/test coordinates not verified. No tests plotted at the lander or ALSEP.'},
      {id:'v2_lola_illumination',reason:'Raster coverage candidates; no additional pixels extracted.'},
      {id:'v3_lamp_hapke_rock_abundance',reason:'Raster coverage candidates; no additional pixels extracted.'},
      {id:'ladee_ldex_nms',reason:'Orbital positions are not fixed surface experiment sites; no trajectory points extracted.'}],points};
  await writeFile(resolve(ROOT,'moon_scout_points.json'),JSON.stringify(registry,null,2)+'\n');
  console.log(`Saved ${points.length} scout points (${points.filter(p=>p.kind==='observed thermal bin').length} temperature bins and 2 ALSEP references)`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
