#!/usr/bin/env node
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildBundle} from '../export.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const BASE='https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/float_img/ldem_64_float';
const W=23040,H=11520,R=1737400;
async function save(path,value){
  const text=JSON.stringify(value,null,2)+'\n';
  for(let i=0;i<5;i++)try{await writeFile(path+'.tmp',text);await rename(path+'.tmp',path);return;}catch(e){if(i===4)throw e;await new Promise(r=>setTimeout(r,500));}
}
export function windowStatistics(z,lat) {
  const dy=R*Math.PI/180/64,dx=dy*Math.cos(lat*Math.PI/180),n=z.length,h=(n-1)/2,a=z.flat();
  if(a.some(v=>!Number.isFinite(v)||Math.abs(v)>15000))throw Error('Invalid DEM sample');
  const out={elevation:z[h][h]};if(n===1)return {values:out,spacing:[dx,dy]};
  const mean=a.reduce((s,v)=>s+v,0)/a.length;let xx=0,yy=0,xz=0,yz=0;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){const x=(j-h)*dx,y=(i-h)*dy;xx+=x*x;yy+=y*y;xz+=x*(z[i][j]-mean);yz+=y*(z[i][j]-mean);}
  const sx=xz/xx,sy=yz/yy;let residual=0;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)residual+=(z[i][j]-mean-sx*(j-h)*dx-sy*(i-h)*dy)**2;
  Object.assign(out,{slope:Math.atan(Math.hypot(sx,sy))*180/Math.PI,roughness:Math.sqrt(residual/a.length),relief:Math.max(...a)-Math.min(...a)});
  return {values:out,spacing:[dx,dy]};
}
async function request(url,options={}) {
  for(let i=0;i<3;i++){try{const r=await fetch(url,{...options,signal:AbortSignal.timeout(60000)});if(r.ok)return r;await r.body?.cancel();if(i===2)throw Error(`HTTP ${r.status}`);}catch(e){if(i===2)throw e;}await new Promise(r=>setTimeout(r,500*(i+1)));}
}
export async function main(args){
  const dir=resolve(ROOT,'data/terrain64');await mkdir(dir,{recursive:true});
  let label;try{if(args.includes('--refresh'))throw Error();label=await readFile(resolve(dir,'label.lbl'),'utf8');}catch{label=await(await request(BASE+'.lbl')).text();await writeFile(resolve(dir,'label.lbl'),label);}
  for(const p of [/LINES\s*=\s*11520/,/LINE_SAMPLES\s*=\s*23040/,/MAP_RESOLUTION\s*=\s*64/,/SAMPLE_TYPE\s*=\s*PC_REAL/,/UNIT\s*=\s*KILOMETER/,/SCALING_FACTOR\s*=\s*1/,/POSITIVE_LONGITUDE_DIRECTION\s*=\s*"?EAST/])if(!p.test(label))throw Error('LOLA label layout changed');
  const sha=createHash('sha256').update(label).digest('hex'),cachePath=resolve(dir,'windows.json');let cache={};
  try{const c=JSON.parse(await readFile(cachePath,'utf8'));if(!args.includes('--refresh')&&c.label_sha256===sha)cache=c.windows;}catch(e){if(e.code!=='ENOENT')throw e;}
  const b=await buildBundle(),coords=[...new Map(b.points.map(p=>[`${p.la.toFixed(6)},${p.lo.toFixed(6)}`,p])).entries()];
  const points={};
  async function range(row,col,n){const start=(row*W+col)*4,end=start+n*4-1,r=await request(BASE+'.img',{headers:{Range:`bytes=${start}-${end}`}});if(r.status!==206||r.headers.get('content-range')!==`bytes ${start}-${end}/${W*H*4}`){await r.body?.cancel();throw Error('LOLA range not honored');}const raw=Buffer.from(await r.arrayBuffer());if(raw.length!==n*4)throw Error('Truncated DEM range');return Array.from({length:n},(_,i)=>raw.readFloatLE(i*4)*1000);}
  for(let batch=0;batch<coords.length;batch+=4){
    await Promise.all(coords.slice(batch,batch+4).map(async([key,p])=>{
      const row=Math.min(H-1,Math.floor((90-p.la)*64)),col=Math.floor(p.lo*64)%W,half=Math.abs(p.la)>85||row<2||row+2>=H?0:2;
      const k=`${row},${col},${half}`;
      if(!cache[k]){
        const z=await Promise.all(Array.from({length:half*2+1},async(_,i)=>{
          const c=(col-half+W)%W,n=half*2+1,rr=row+i-half;
          if(c+n<=W)return range(rr,c,n);
          return [...await range(rr,c,W-c),...await range(rr,0,n-(W-c))];
        }));cache[k]={window_m:z,retrieved_at:new Date().toISOString()};
      }
      const z=cache[k].window_m,sampledLat=90-(row+.5)/64,stat=windowStatistics(z,sampledLat);
      points[key]={lat:p.la,lon_e:p.lo,pixel:{row,col},sampled:{lat:sampledLat,lon_e:(col+.5)/64},elevation_window_m:z,
        measurements:Object.entries(stat.values).map(([key,value])=>({dim:2,key,value:Number(value.toFixed(3)),unit:key==='slope'?'degree':'m',status:'extracted_global_baseline',source_url:BASE+'.lbl',
          pixel:{row,col},pixel_spacing_m:stat.spacing,window_m:stat.spacing.map(v=>v*z.length),retrieved_at:cache[k].retrieved_at,
          method:key==='elevation'?'Nearest native LDEM_64_FLOAT pixel; DN × 1000 m, relative to 1737.4 km sphere.':'5 × 5 native LOLA pixels; plane-fit slope/RMS residual and max-minus-min relief with local spherical spacing.',
          note:'64 ppd (~474 m north-south grid); regional terrain, not landing hazards. Derivatives omitted above 85 degrees. Pixel spacing is not effective resolution; no uncertainty estimate supplied.'}))};
    }));
    if(batch%16===0||batch+4>=coords.length)await save(cachePath,{label_sha256:sha,windows:cache});
  }
  const doc={schema_version:'1.0',source_url:BASE+'.img',label,label_sha256:sha,retrieved_at:new Date().toISOString(),source_contract:'Label-validated PDS global LOLA 64 ppd float image, 0–360 east; heights relative to 1737.4 km sphere. Range reads preserve raw native windows; no full-raster download.',points};
  await save(resolve(ROOT,'data/enrichment/global_terrain.json'),doc);console.log(`64 ppd terrain: ${Object.keys(points).length} coordinates`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
