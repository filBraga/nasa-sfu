#!/usr/bin/env node
import { fromUrl } from 'geotiff';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { thermalRegions } from '../thermal-regions.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function southPolar(lat,lon) {
  if(lat>0||lat< -90||!Number.isFinite(lat)||!Number.isFinite(lon))throw Error('Invalid south-polar coordinate');
  const rho=2*1737400*Math.tan((90+lat)*Math.PI/360),l=lon*Math.PI/180;
  return [rho*Math.sin(l),rho*Math.cos(l)];
}
const products=[
  ['elevation','LDEM_80S_80MPP_ADJ.TIF','m',[-15000,15000]],
  ['slope','LDSM_80S_80MPP_ADJ.TIF','degree',[0,90]],
  ['roughness','LDRM_80S_1000MPP_ADJ_ROUGH_100M.TIF','m',[0,10000]],
  ['height_error','LDEM_80S_80MPP_ADJ_ERR.TIF','m',[0,10000]],
  ['slope_error','LDSM_80S_80MPP_ADJ_ERR.TIF','degree',[0,90]],
  ['effective_resolution','LDEM_80S_80MPP_ADJ_EFFRES.TIF','m',[0,100000]],
  ['observation_count','LDEC_80S_80MPP_ADJ.TIF','count',[0,1e9]]
];
export async function main() {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    for(let attempt=0;attempt<3;attempt++){
      const response=await originalFetch(url,{...options,signal:options.signal??AbortSignal.timeout(60000)});
      if(response.ok||attempt===2)return response;
      console.log(`Retry HTTP ${response.status}: ${url}`);await response.body?.cancel();
      await new Promise(r=>setTimeout(r,3000*(attempt+1)));
    }
  };
  const scout=JSON.parse(await readFile(resolve(ROOT,'moon_scout_points.json'),'utf8'));
  const regions=thermalRegions(scout.points),points=Object.fromEntries(regions.map(r=>[r.id,{lat:r.lat,lon_e:r.lon_e,representative_id:r.representative_id,measurements:[]}]));
  const dir=resolve(ROOT,'data/enrichment');await mkdir(dir,{recursive:true});
  const checkpoint=resolve(dir,'regions.tmp');
  let doc={schema_version:'1.0',retrieved_at:new Date().toISOString(),scope:'Nearest native pixel at each representative coordinate only; not regional averages. No resampling of temperatures.',products:{},points};
  try {const previous=JSON.parse(await readFile(checkpoint,'utf8'));if(regions.every(r=>previous.points[r.id]?.representative_id===r.representative_id)) {doc=previous;Object.assign(points,doc.points);}}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const [key,file,unit,bounds] of products) {
    if(doc.products[key]&&regions.every(r=>points[r.id].measurements.some(m=>m.key===key))){console.log(`Using saved ${key}`);continue;}
    const url='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/'+file;
    const tiff=await fromUrl(url,{allowFullFile:false});
    try {
      const im=await tiff.getImage(),g=im.getGeoKeys(),origin=im.getOrigin(),spacing=im.getResolution(),nodata=im.getGDALNoData();
      if(g.ProjNatOriginLatGeoKey!==-90||g.ProjStraightVertPoleLongGeoKey!==0||g.GeogSemiMajorAxisGeoKey!==1737400||g.ProjScaleAtNatOriginGeoKey!==1||g.ProjLinearUnitsGeoKey!==9001||g.GTRasterTypeGeoKey!==1)throw Error('Unexpected terrain CRS');
      const meta=(await im.getGDALMetadata(0))??{};if(Object.keys(meta).some(k=>/scale|offset/i.test(k)))throw Error('Review unexpected scale/offset metadata');
      doc.products[key]={url,source_page:'https://pgda.gsfc.nasa.gov/products/90',width:im.getWidth(),height:im.getHeight(),origin,spacing,nodata,geokeys:g,metadata:meta,unit,frame:'MOON_ME / DE421',height_reference:key==='elevation'?'1737.4 km reference sphere':undefined};
      for(let batch=0;batch<regions.length;batch+=2) await Promise.all(regions.slice(batch,batch+2).map(async r=>{
        const [x,y]=southPolar(r.lat,r.lon_e),col=Math.floor((x-origin[0])/spacing[0]),row=Math.floor((y-origin[1])/spacing[1]);
        let value=null,status='outside_coverage';
        if(col>=0&&row>=0&&col<im.getWidth()&&row<im.getHeight()) {
          const ras=await im.readRasters({window:[col,row,col+1,row+1],samples:[0]});
          const v=ras[0][0];status='nodata_or_invalid';
          if(Number.isFinite(v)&&v!==nodata&&v>=bounds[0]&&v<=bounds[1]){value=v;status='extracted';}
        }
        points[r.id].measurements.push({dim:2,key,value,unit,status,source_url:url,pixel:{row,col},pixel_spacing_m:spacing.slice(0,2).map(Math.abs),
          sampled_xy_m:[origin[0]+(col+.5)*spacing[0],origin[1]+(row+.5)*spacing[1]],
          method:'Nearest native pixel, no interpolation. Representative point only.',note:key==='roughness'?'100 m plane-fit baseline; 1000 m grid spacing.':key.endsWith('error')?'Provider error companion; not a propagated uncertainty of region statistics.':'Pixel spacing is not effective resolution.'});
      }));
      console.log(`Sampled ${key}: ${regions.length} representatives`);
      await writeFile(checkpoint,JSON.stringify(doc,null,2));
    } finally {await tiff.close();}
  }
  const base='https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/AVGVISIB_75S_120M_201608';
  const response=await fetch(base+'.LBL');if(!response.ok)throw Error('Illumination label unavailable');const label=await response.text();
  for(const pattern of [/LINE_SAMPLES\s*=\s*7624/,/LINES\s*=\s*7624/,/SCALING_FACTOR\s*=\s*0\.00004/,/SAMPLE_TYPE\s*=\s*LSB_INTEGER/,/MAP_SCALE\s*=\s*120/,/LINE_PROJECTION_OFFSET\s*=\s*3811\.5/,/SAMPLE_PROJECTION_OFFSET\s*=\s*3811\.5/,/CENTER_LATITUDE\s*=\s*-90/,/CENTER_LONGITUDE\s*=\s*0/])if(!pattern.test(label))throw Error('Illumination layout changed');
  doc.products.illumination={url:base+'.IMG',label_url:base+'.LBL',label,source_page:'https://pgda.gsfc.nasa.gov/products/69',unit:'fraction',pixel_spacing_m:120,
    temporal_basis:'Long-term modeled solar-disc visibility (~18.6-year hourly averaging per product page); not contemporaneous with seasonal temperature bins.'};
  for(const r of regions) {
    const [x,y]=southPolar(r.lat,r.lon_e),col=Math.round(3811.5+x/120),row=Math.round(3811.5-y/120);
    const start=(row*7624+col)*2,end=start+1;
    const res=await fetch(base+'.IMG',{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(60000)});
    if(res.status!==206||res.headers.get('content-range')!==`bytes ${start}-${end}/${7624*7624*2}`){await res.body?.cancel();throw Error('Illumination range not honored');}
    const b=Buffer.from(await res.arrayBuffer());if(b.length!==2)throw Error('Truncated illumination sample');const dn=b.readInt16LE();
    points[r.id].measurements.push({dim:3,key:'average_solar_disc_visibility',value:dn>=0&&dn<=25000?dn*.00004:null,unit:'fraction',status:dn>=0&&dn<=25000?'extracted_model':'nodata_or_invalid',raw_dn:dn,source_url:base+'.LBL',pixel:{row,col},pixel_spacing_m:[120,120],method:'Nearest native IMG pixel; DN × 0.00004. Fraction of model timesteps with any part of solar disc visible.',note:'Long-term modeled value, not instantaneous sunlight, power, or a seasonal temperature average.'});
  }
  for(const p of Object.values(points)) {
    const count=p.measurements.find(m=>m.key==='observation_count');
    p.quality_notes=['Samples describe the representative coordinate, not all source bins in its thermal region.','Native product grids differ; no common-resolution resampling or uncertainty propagation is claimed.'];
    if(count?.value===0)p.quality_notes.push('No LOLA spots in this count-map pixel; terrain may rely on interpolation.');
  }
  globalThis.fetch=originalFetch;
  await mkdir(resolve(ROOT,'data/enrichment'),{recursive:true});
  await writeFile(resolve(ROOT,'data/enrichment/regions.json'),JSON.stringify(doc,null,2)+'\n');
  console.log(`Saved enrichment for ${regions.length} regions`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
