// Compact map index; original observations remain unchanged in records.
export function thermalRegions(points) {
  const groups=new Map();
  for(const p of points.filter(p=>p.kind==='observed thermal bin')) {
    const m=p.measurements[0];
    // Retain season, local-time class, geography and thermal class separately.
    const key=[Math.floor((p.lat+90)/2),Math.floor(p.lon_e/30),Math.floor(m.value/50),Math.floor(p.local_time_h/4),m.ls_range_deg.join('_'),m.subsolar_longitude_range_deg.join('_')].join('-');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);
  }
  return [...groups].map(([key,members],i)=>{
    const sorted=members.map(p=>p.measurements[0].value).sort((a,b)=>a-b),n=sorted.length;
    const median=n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2;
    // Use an actual observed coordinate rather than inventing a measured centroid.
    const representative=members.reduce((a,b)=>Math.abs(a.measurements[0].value-median)<=Math.abs(b.measurements[0].value-median)?a:b);
    const bounds={minlat:Math.min(...members.map(p=>p.lat)),maxlat:Math.max(...members.map(p=>p.lat)),westernlon:Math.min(...members.map(p=>p.lon_e)),easternlon:Math.max(...members.map(p=>p.lon_e))};
    return {id:`thermal_region_${key}`,name:`Polar thermal region ${i+1}`,kind:'thermal region summary',lat:representative.lat,lon_e:representative.lon_e,dims:[3],bounds,
      sample_count:n,member_ids:members.map(p=>p.id),representative_id:representative.id,source_url:representative.source_url,
      temperature_K:{min:sorted[0],median,max:sorted.at(-1)},local_time_range_h:[Math.min(...members.map(p=>p.local_time_h)),Math.max(...members.map(p=>p.local_time_h))],
      measurements:[{dim:3,key:'sample_median_bolometric_temperature',value:median,unit:'K',status:'derived_sample_summary',method:'Median of sampled bins in a 2-degree latitude / 30-degree longitude / 50 K / 4-hour class; seasonal bins kept separate. Not an area-weighted regional average.'}],
      note:`${n} sampled temperature bins; marker is an actual member coordinate. Bounds describe sampled bins, not continuous coverage or a confirmed analog site.`,
      enrichment_targets:[{dim:2,quantities:['elevation','slope','roughness','height_error'],status:'pending_extraction',source:'https://pgda.gsfc.nasa.gov/products/90'},
        {dim:3,quantities:['solar_illumination'],status:'pending_extraction',source:'https://pgda.gsfc.nasa.gov/products/69'},
        {dim:4,quantities:['hydrogen_proxy'],status:'pending_product_selection',note:'Keep native footprint; not confirmed ice.'}]};
  });
}
