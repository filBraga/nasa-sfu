#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildBundle} from '../export.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const URL='https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/WAC_HAPKEPARAMMAP/WAC_HAPKEPARAMMAP_643NM.IMG';
export function decodeHapke(bytes,lat,lon) {
  if(lat<=-70||lat>=70)return [];
  const row=Math.floor(70-lat),col=Math.floor(((lon%360)+360)%360),out=[];
  for(const [band,key] of [[0,'single_scattering_albedo_643nm'],[1,'phase_function_b_643nm'],[2,'phase_function_c_643nm'],[5,'shadow_hiding_amplitude_643nm'],[6,'shadow_hiding_width_643nm']]) {
    const offset=5760+((band*140+row)*360+col)*4,bits=bytes.readUInt32LE(offset),value=bytes.readFloatLE(offset);
    const valid=bits<0xff7ffffb&&Number.isFinite(value)&&(band!==0||(value>=0&&value<=1));
    out.push({dim:1,key,value:valid?value:null,unit:'dimensionless',status:valid?'extracted_photometric_model':'nodata_or_invalid',
      source_url:URL,pixel:{row,col},pixel_spacing_deg:[1,1],wavelength_nm:643,
      method:'Nearest native 1-degree tile from the PDS band-sequential float32 science image. Excludes fixed parameter bands BC0, HC, THETA and PHI.',
      note:'Hapke model parameter; not mineral identification, dust depth, illumination or soil strength. Coverage 70 S to 70 N. Effective resolution not inferred.'});
  }
  return out;
}
export async function main(args) {
  const path=resolve(ROOT,'data/rasters/hapke_643nm.img');
  if(args.includes('--refresh')){const r=await fetch(URL);if(!r.ok)throw Error(`HTTP ${r.status}`);await writeFile(path,Buffer.from(await r.arrayBuffer()));}
  const bytes=await readFile(path),label=bytes.subarray(0,5760).toString('ascii');
  for(const pattern of [/RECORD_BYTES\s*=\s*1440/,/\^IMAGE\s*=\s*5/,/BANDS\s*=\s*9/,/LINES\s*=\s*140/,/LINE_SAMPLES\s*=\s*360/,/SAMPLE_TYPE\s*=\s*PC_REAL/,/BAND_STORAGE_TYPE\s*=\s*BAND_SEQUENTIAL/,/WESTERNMOST_LONGITUDE\s*=\s*0\.0/,/SAMPLE_PROJECTION_OFFSET\s*=\s*-0\.5/])if(!pattern.test(label))throw Error('Hapke label changed; review layout');
  if(bytes.length!==5760+9*140*360*4)throw Error('Unexpected Hapke file size');
  const b=await buildBundle(),points={};
  for(const p of b.points){const key=`${p.la.toFixed(6)},${p.lo.toFixed(6)}`;if(points[key])continue;points[key]={lat:p.la,lon_e:p.lo,measurements:decodeHapke(bytes,p.la,p.lo),status:Math.abs(p.la)>=70?'outside_coverage':'sampled'};}
  const doc={schema_version:'1.0',source_url:URL,source_page:'https://data.lroc.im-ldi.com/lroc/view_rdr_product/WAC_HAPKEPARAMMAP_643NM',scout:'datascout_v3/lroc_hapke.md',retrieved_at:new Date().toISOString(),sha256:createHash('sha256').update(bytes).digest('hex'),label,points};
  await writeFile(resolve(ROOT,'data/enrichment/materials.json'),JSON.stringify(doc,null,2)+'\n');
  console.log(`Materials: ${Object.values(points).filter(p=>p.measurements.some(m=>m.value!==null)).length} sampled coordinates`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
