#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {fromArrayBuffer} from 'geotiff';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sample} from './sample_global_terrain.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const BASE='https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/float_img/ldem_16_float';
export async function main(){
  const bytes=await readFile(resolve(ROOT,'data/rasters/ldem_16.tif')),t=await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),im=await t.getImage(),grid=(await im.readRasters({samples:[0]}))[0];
  const response=await fetch(BASE+'.lbl');if(!response.ok)throw Error('Reference label unavailable');const label=await response.text();
  for(const p of [/LINES\s*=\s*2880/,/LINE_SAMPLES\s*=\s*5760/,/SAMPLE_TYPE\s*=\s*PC_REAL/,/SAMPLE_BITS\s*=\s*32/])if(!p.test(label))throw Error('Reference layout changed');
  const checks=[];
  for(const [lat,lon] of [[9.62,339.92],[26,310],[0,0],[0,180],[-43.31,348.83],[35,140],[-35,220],[-85,45]]){
    const row=Math.floor((90-lat)*16),col=Math.floor(((lon%360)+360)%360*16),offset=(row*5760+col)*4;
    const r=await fetch(BASE+'.img',{headers:{Range:`bytes=${offset}-${offset+3}`}});
    if(r.status!==206||r.headers.get('content-range')!==`bytes ${offset}-${offset+3}/${5760*2880*4}`){await r.body?.cancel();throw Error('Reference range not honored');}
    const b=Buffer.from(await r.arrayBuffer()),reference=b.readFloatLE()*1000,actual=sample(grid,5760,2880,lat,lon).values.elevation,difference=actual-reference;
    checks.push({lat,lon_e:lon,actual_m:actual,reference_m:reference,difference_m:difference,passed:Math.abs(difference)<1});
  }
  const report={checked_at:new Date().toISOString(),purpose:'Cross-check orientation, hemisphere, scaling and pixel indexing against PDS global LOLA float image. Not independent instrument accuracy or hazard validation.',reference_url:BASE+'.img',label,tolerance_m:1,checks,passed:checks.every(c=>c.passed)};
  await writeFile(resolve(ROOT,'data/enrichment/sampling_validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(checks,null,2));if(!report.passed)throw Error('Coordinate/scaling cross-check failed');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
