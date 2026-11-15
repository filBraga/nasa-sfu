#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildBundle} from '../export.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const BASE='https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_ghrm/img/';
const SIZE=17920*46080*4;
const digest=s=>createHash('sha256').update(s).digest('hex');
export function divinerPixel(lat,lon) {
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90)throw Error('Invalid coordinate');
  if(lat<=-70||lat>=70)return null;
  const row=Math.floor((70-lat)*128),col=Math.floor(((lon%360)+360)%360*128);
  return {row,col,offset:(row*46080+col)*4,lat:70-(row+.5)/128,lon_e:(col+.5)/128};
}
async function request(url,options={}) {
  for(let i=0;i<3;i++) {
    try {const r=await fetch(url,{...options,signal:AbortSignal.timeout(60000)});if(r.ok)return r;await r.body?.cancel();if(i===2)throw Error(`HTTP ${r.status}: ${url}`);}
    catch(e){if(i===2)throw e;}
    await new Promise(r=>setTimeout(r,500*(i+1)));
  }
}
export async function main(args) {
  const dir=resolve(ROOT,'data/diviner');await mkdir(dir,{recursive:true});
  const bundle=await buildBundle(),coords=[...new Map(bundle.points.map(p=>[`${p.la.toFixed(6)},${p.lo.toFixed(6)}`,p])).entries()];
  const doc={schema_version:'1.0',products:{},points:{},note:'Native samples at selected coordinates; 128 pixels/degree is grid spacing, not effective resolution. Midnight thermal products are not thermal inertia or daytime extremes.'};
  for(const [id,dim,key,unit,bounds] of [['tbol_m',3,'midnight_bolometric_temperature','K',[0,400]],['ra_sam',1,'rock_abundance_slope_adjusted_midnight','fraction',[0,1]]]) {
    const name=`dghrm_${id}_70s70n_img`,url=BASE+name+'.img',labelUrl=BASE+name+'.xml';
    const labelPath=resolve(dir,name+'.xml');let label;
    try{if(args.includes('--refresh'))throw Error();label=await readFile(labelPath,'utf8');}catch{label=await(await request(labelUrl)).text();await writeFile(labelPath,label);}
    for(const pattern of [/<data_type>IEEE754LSBSingle<\/data_type>/,/<offset unit="byte">0<\/offset>/,/<elements>17920<\/elements>/,/<elements>46080<\/elements>/,/<cart:west_bounding_coordinate unit="deg">0<\//,/<cart:east_bounding_coordinate unit="deg">360<\//,/<cart:longitude_of_central_meridian unit="deg">180<\//,/<cart:north_bounding_coordinate unit="deg">70<\//,/<cart:pixel_scale_x unit="pixel\/deg">128<\//,/<cart:longitude_direction>Positive East<\//,/<missing_constant>NaN<\//])if(!pattern.test(label))throw Error('Diviner label layout changed');
    const cachePath=resolve(dir,name+'_samples.json');let cache={};
    try{const saved=JSON.parse(await readFile(cachePath,'utf8'));if(!args.includes('--refresh')&&saved.label_sha256===digest(label))cache=saved.samples;}catch(e){if(e.code!=='ENOENT')throw e;}
    for(let batch=0;batch<coords.length;batch+=6) {
      await Promise.all(coords.slice(batch,batch+6).map(async([coord,p])=>{
        const pix=divinerPixel(p.la,p.lo);if(!pix)return;
        const pixelKey=`${pix.row},${pix.col}`;
        if(!cache[pixelKey]) {
          const r=await request(url,{headers:{Range:`bytes=${pix.offset}-${pix.offset+3}`}});
          if(r.status!==206||r.headers.get('content-range')!==`bytes ${pix.offset}-${pix.offset+3}/${SIZE}`){await r.body?.cancel();throw Error('Source did not honor exact pixel range');}
          const b=Buffer.from(await r.arrayBuffer());if(b.length!==4)throw Error('Truncated pixel');
          cache[pixelKey]={hex:b.toString('hex'),retrieved_at:new Date().toISOString(),content_range:r.headers.get('content-range')};
        }
        const cached=cache[pixelKey],b=Buffer.from(cached.hex,'hex');if(b.length!==4)throw Error('Corrupt cached sample');
        const value=b.readFloatLE(),valid=Number.isFinite(value)&&value>=bounds[0]&&value<=bounds[1];
        doc.points[coord]??={lat:p.la,lon_e:p.lo,measurements:[]};
        doc.points[coord].measurements.push({dim,key,value:valid?value:null,unit,status:valid?'extracted_diviner_model':'nodata_or_invalid',source_url:labelUrl,
          raw_hex:cached.hex,retrieved_at:cached.retrieved_at,pixel:{row:pix.row,col:pix.col},sampled:{lat:pix.lat,lon_e:pix.lon_e},pixel_spacing_deg:[1/128,1/128],
          local_time_basis:id==='tbol_m'?'midnight':'slope-adjusted midnight',observation_period:['2009-07-05','2022-08-01'],
          method:'Nearest native float32 little-endian pixel from label-validated PDS IMG, no scaling or interpolation.',
          note:id==='tbol_m'?'Derived nighttime mosaic; not instantaneous temperature, seasonal minimum or thermal inertia.':'Modeled areal rock fraction; not direct boulder count, dust thickness, chemistry or soil bearing strength. Units follow Powell et al. 2023 model; PDS label omits an explicit unit.',
          method_reference:'https://doi.org/10.1029/2022JE007532',spatial_note:'236.9 m projected grid spacing; longitude ground spacing decreases with latitude. Effective resolution differs from grid spacing.'});
      }));
      await writeFile(cachePath,JSON.stringify({label_sha256:digest(label),samples:cache},null,2)+'\n');
    }
    doc.products[id]={label,label_url:labelUrl,label_sha256:digest(label),url,unit,method_reference:'https://doi.org/10.1029/2022JE007532',scout:'datascout_v3/diviner_rock_abundance.md'};
    console.log(`${key}: ${Object.values(doc.points).filter(p=>p.measurements.some(m=>m.key===key&&m.value!==null)).length} valid coordinates`);
  }
  await writeFile(resolve(ROOT,'data/enrichment/diviner.json'),JSON.stringify(doc,null,2)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
