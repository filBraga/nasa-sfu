#!/usr/bin/env node
import { buildBundle } from './export.mjs';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname,resolve,extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=dirname(fileURLToPath(import.meta.url)), DIR=resolve(ROOT,'viewer');
export async function buildViewerData() {
  const b=await buildBundle();
  const points=b.points.map(p=>({...p,lab:p.k==='researched site'||p.k==='sampled site'||p.k==='surface experiment context'||Boolean(b.records['moon_features.json']?.features.find(f=>f.name===p.n)?.is_key_feature)?1:0}));
  const doc={...b,points,texLon0:-180,datasets:b.datasets.map(x=>({n:x.name,d:x.dims,cov:x.coverage??'',res:x.resolution??'',u:x.url}))};
  await mkdir(DIR,{recursive:true});
  await writeFile(resolve(DIR,'data.js'),'window.MOON='+JSON.stringify(doc)+';\n');
  return doc;
}
export async function main(args) {
  let port=8766,buildOnly=false;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--build-only')buildOnly=true;
    else if(args[i]==='--no-open')continue;
    else if(args[i]==='--port')port=Number(args[++i]);
    else throw Error('Usage: node moon-cli/viewer.mjs [--build-only] [--port 8766]');
  }
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
  const doc=await buildViewerData(); console.log(`Built viewer/data.js: ${doc.points.length} records, 8 layers.`);
  if(buildOnly)return;
  const server=createServer(async(req,res)=>{
    try {
      const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file=resolve(DIR,'.'+(path==='/'?'/index.html':path));
      if(!file.startsWith(DIR+'\\')&&!file.startsWith(DIR+'/')){res.writeHead(403);res.end();return;}
      const content=await readFile(file);
      res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg'}[extname(file)]??'application/octet-stream')});res.end(content);
    } catch {res.writeHead(404);res.end('Not found');}
  });
  server.on('error',e=>{console.error(e.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Moon viewer: http://127.0.0.1:${port}/ (Ctrl+C to stop)`));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
