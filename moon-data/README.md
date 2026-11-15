# Moon data CLI and globe

Lunar evidence for Earth-analog comparison. Missing measurements remain null.

## Run

From the repository root:

```powershell
npm.cmd install --prefix moon-cli
npm.cmd --prefix moon-cli run build
npm.cmd --prefix moon-cli run viewer
npm.cmd --prefix moon-cli test
```

Open http://127.0.0.1:8766/ and reload after building. The default geographic
subset has 24 existing records, 12 on each side; select All saved records for
all 521 markers. Layer counts and search follow the selected view. Geographic
balance does not mean equally complete measurements.

Share `dist/moon_bundle.json`. `viewer/data.js` is the generated globe input.
Optional JS/MJS bundles can be generated with `export.mjs --out PATH.js|PATH.mjs`;
only JSON is retained by default.

## New screening improvements

Global terrain now uses **64 pixels/degree** (about **474 m north-south pixels**,
2.4 km north-south 5x5 windows), replacing the old 4 ppd baseline. The global
sampler validates the native PDS label and exact byte ranges, retains native
windows, wraps the longitude seam, and omits poorly conditioned polar derivatives.
The separate eight lower-resolution cross-checks saved in
`data/enrichment/sampling_validation.json` compare the former 16 ppd SVS input
with PDS 16 ppd heights and agree within 0.46 m. Those checks confirm that path's
indexing/scaling; they are not 64 ppd instrument-accuracy validation. Analytic
plane tests verify native 64 ppd derivative math. The 2.4 km statistics are not
interchangeable with Mars's ~5.1 km window without matching scales.

Scout v3's Diviner GHRM family adds **midnight bolometric temperature at 456
coordinates** and **modeled rock abundance at 453 coordinates**. Three missing
rock samples stay null. Both maps span 70 S to 70 N at 128 pixels/degree; effective
resolution differs from grid spacing. Rock abundance uses the model's areal
fraction convention from Powell et al. (2023), DOI 10.1029/2022JE007532; the product
label does not explicitly specify a unit. It is not a count of boulders or soil
strength. Temperatures are derived nighttime mosaics, not thermal inertia,
seasonal extrema or instantaneous temperatures.

```powershell
npm.cmd --prefix moon-cli run sample:diviner
npm.cmd --prefix moon-cli run sample:terrain
npm.cmd --prefix moon-cli run validate:sampling
npm.cmd --prefix moon-cli run build
```

The Diviner sampler validates labels, reads only four bytes per native science
pixel, validates exact HTTP ranges and retains raw hex values plus timestamps.
Cached samples allow offline regeneration; `--refresh` refreshes labels and pixels.
The IMG maps start at 0 E, while the GeoTIFF siblings start at -180 degrees: the
sampler explicitly validates and tests that difference. No full 3.3 GB map is
downloaded. The collection XML labels, byte samples and source hashes remain
under `data/diviner/`. The old scout cards document discovery-time limitations;
new extraction records document which checks have since been completed.

## Extracted evidence

| Source | Data | Limit |
|---|---|---|
| Global LOLA / PDS | Terrain baseline at all 505 distinct marker coordinates | 0.015625-degree pixels; ~2.4 km N-S window; only elevation above 85 degrees |
| LROC Hapke 643 nm, scout v3 | Five reflectance-model parameters at 456 coordinates, both hemispheres | 1-degree grid, 70 S to 70 N; not minerals, dust depth or soil strength; fixed bands excluded |
| Polar LOLA, scout v2 | Elevation, slope, roughness, error, resolution and count fields at 36 representatives | Native point samples, not regional averages |
| Polar illumination, scout v2 | Solar-disc visibility at 36 representatives | Long-term model, 120 m pixels; not seasonal temperature time support |
| Diviner, scout v2 | 512 temperature bins summarized as 36 map groups | Sparse subset of one seasonal product; raw bins preserved |
| Diviner GHRM, scout v3 | Midnight temperature at 456 coordinates; rock abundance at 453 | 70 S to 70 N, 128 ppd; derived model products |
| LROC Pits Atlas | 278 pit candidates | Accessible caves not established |
| NASA spacecraft table | 96 lander/impactor/hardware records, 18 unlocated | Provider updated August 2025 |
| Apollo CCIG / LEAM, scout v3 | Two experiment reference markers | ALSEP coordinates, not instrument offsets; no extracted values; CCIG errors flagged |

Researched sites and the Copernicus sample retain provenance. Multiple records
can overlap. Higher-resolution measurements take precedence over matching global
baseline quantities in the detail panel. Nearby counts are context, not values
at the selected coordinate. All eight dimensions show missing evidence explicitly.

## Refresh sources

```powershell
node --use-system-ca moon-cli/scripts/import_catalogs.mjs --refresh
node --use-system-ca moon-cli/scripts/import_scout_points.mjs --refresh
node --use-system-ca moon-cli/scripts/sample_global_terrain.mjs --refresh
node --use-system-ca moon-cli/scripts/sample_materials.mjs --refresh
node --use-system-ca moon-cli/scripts/enrich_regions.mjs
npm.cmd --prefix moon-cli run build
```

Omit --refresh for offline rebuilding of catalog, scout, global terrain and Hapke
outputs once all coordinate samples are cached. The global terrain sampler reads
only native windows from the ~1 GB map, not the whole raster. Its source label and
window cache live in data/terrain64/. Polar enrichment uses remote byte ranges and checkpoints completed
products to data/enrichment/regions.tmp; remove that temporary file after success.
The final regions.json retains measurements. Viewer/export builds remain offline.
Only extraction/testing needs the GeoTIFF dependency. Global LOLA uses km relative
to a 1737.4 km sphere; the 1737.4 km label OFFSET converts height to radius and is
not added to elevation. Hapke uses the attached PDS science label, float32 band-sequential
pixels and special-value masks. Native grids, units and temporal context remain
separate; no common-resolution resampling or propagated uncertainty is claimed.

## Files and contract

- moon_*.json: original catalogs and researched/scout observations.
- data/enrichment/: extracted measurements and provider metadata.
- data/rasters/: small science rasters for reproducibility.
- data/catalogs/, data/scout_points/: snapshots, source rows and checksums.
- datascout_v2/, datascout_v3/: source research and archived evidence.
- config/, data/dimensions.json: product configuration, taxonomy and constraints.
- scripts/, tests/: retrieval, sampling and validation.
- dist/moon_bundle.json: standalone export; viewer/: globe and generated data.

The export has points (n=name, k=kind, la=latitude, lo=east longitude, d=dimensions,
i=context, source/record_id=provenance, measurements=baseline/material values),
records (original local JSON), layers, dims, cites, unlocated, missing_catalogs
and spatial_audit. Thermal summary records preserve all source member IDs.
Longitudes are normalized to 0-360 east only in the map index.

moon.py retains the legacy query/time CLI and delegates viewer building to Node.
moon.mjs retains prototype queries and LOLA extraction. The optional Python ODE
retrieval/place scripts remain useful; both require a working Python installation.

## Remaining work

LAMP, LADEE and Station 8 soil tests remain candidate sources.
Hydrogen/ice, global mineralogy, calibrated dust, biosignature maps and operational
suitability have not been extracted. moon_candidates.json is missing. Earth cannot
reproduce lunar gravity, vacuum or radiation. No combined analog score is produced.

Sources: [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/),
[LROC Hapke](https://data.lroc.im-ldi.com/lroc/view_rdr_product/WAC_HAPKEPARAMMAP_643NM),
[LOLA terrain](https://pgda.gsfc.nasa.gov/products/90),
[Illumination](https://pgda.gsfc.nasa.gov/products/69),
[LROC pits](https://lroc.im-ldi.com/atlases/pits/list),
[NASA spacecraft](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html).
