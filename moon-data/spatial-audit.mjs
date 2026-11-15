export const eastLongitude=lon=>((lon%360)+360)%360;
export function spatialAudit(points) {
  const cells=Array.from({length:24},(_,i)=>({id:i,latitude_band:Math.floor(i/8),longitude_sector:i%8,members:[]}));
  for(const p of points){
    const band=Math.min(2,Math.floor((Math.sin(p.la*Math.PI/180)+1)*1.5));
    cells[band*8+Math.floor(eastLongitude(p.lo)/45)].members.push(p);
  }
  const selected=[];
  const report=cells.map(cell=>{
    const lat=Math.asin(-1+(cell.latitude_band+.5)*2/3)*180/Math.PI,lon=(cell.longitude_sector+.5)*45;
    // Prefer spatially central candidates; deterministic ties favor richer evidence.
    const distance=p=>Math.acos(Math.max(-1,Math.min(1,Math.sin(lat*Math.PI/180)*Math.sin(p.la*Math.PI/180)+Math.cos(lat*Math.PI/180)*Math.cos(p.la*Math.PI/180)*Math.cos((lon-p.lo)*Math.PI/180))));
    const sorted=[...cell.members].sort((a,b)=>distance(a)-distance(b)||b.d.length-a.d.length||a.n.localeCompare(b.n));
    if(sorted.length)selected.push(sorted[0]);
    return {id:cell.id,latitude_band:cell.latitude_band,longitude_sector:cell.longitude_sector,count:cell.members.length,selected:sorted[0]?`${sorted[0].source}|${sorted[0].record_id}`:null};
  });
  const hemisphere=p=>{const lon=eastLongitude(p.lo);return lon<=90||lon>=270?'near':'far';};
  const counts=list=>({near:list.filter(p=>hemisphere(p)==='near').length,far:list.filter(p=>hemisphere(p)==='far').length,north:list.filter(p=>p.la>=0).length,south:list.filter(p=>p.la<0).length});
  return {policy:'One existing record nearest each occupied cell center, 3 equal-area latitude bands x 8 longitude sectors. Empty cells stay empty; this is a display subset, not new measurements or an unbiased scientific sample.',all:counts(points),comparison:counts(selected),cells:report,selected_keys:selected.map(p=>`${p.source}|${p.record_id}`),empty_cells:report.filter(c=>!c.count).map(c=>c.id)};
}
