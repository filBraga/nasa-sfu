#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function sample(grid,w,h,lat,lon) {
  const row=Math.min(h-1,Math.max(0,Math.floor((90-lat)/180*h))),col=Math.floor((((lon+180)%360)+360)%360/360*w);
  const value=grid[row*w+col]*1000;
  if(!Number.isFinite(value)||Math.abs(value)>15000)throw Error('Invalid global DEM height');
  const dy=1737400*Math.PI/h,dx=dy*Math.cos((90-(row+.5)*180/h)*Math.PI/180);
  const out={elevation:value};
  if(row<2||row+2>=h||Math.abs(lat)>85)return {values:out,row,col,spacing:[dx,dy],window:null};
  const z=Array.from({length:5},(_,i)=>Array.from({length:5},(_,j)=>grid[(row+i-2)*w+(col+j-2+w)%w]*1000));
  if(z.flat().some(v=>!Number.isFinite(v)||Math.abs(v)>15000))return {values:out,row,col,spacing:[dx,dy],window:null};
  const a=z.flat(),mean=a.reduce((s,v)=>s+v,0)/25;
  let xz=0,yz=0,xx=0,yy=0;
  for(let i=0;i<5;i++)for(let j=0;j<5;j++){const x=(j-2)*dx,y=(i-2)*dy;xz+=x*(z[i][j]-mean);yz+=y*(z[i][j]-mean);xx+=x*x;yy+=y*y;}
  const sx=xz/xx,sy=yz/yy;
  let residual=0;for(let i=0;i<5;i++)for(let j=0;j<5;j++)residual+=(z[i][j]-mean-sx*(j-2)*dx-sy*(i-2)*dy)**2;
  Object.assign(out,{slope:Math.atan(Math.hypot(sx,sy))*180/Math.PI,roughness:Math.sqrt(residual/25),relief:Math.max(...a)-Math.min(...a)});
  return {values:out,row,col,spacing:[dx,dy],window:z};
}
export async function main(args) {
  const { main: sample64 } = await import('./sample_terrain64.mjs');
  return sample64(args);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
