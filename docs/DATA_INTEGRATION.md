# Adding data layers (Google Earth Engine team + NASA PDS team)

The pipeline already compares terrain from elevation models. Data layers (temperature, albedo,
radar, minerals, ...) plug in through **files**, so each team can work independently.

## 1. The contract

For every layer and every site, deliver one GeoTIFF:

```
data/layers/<layer_id>/<site_id>.tif
```

| Rule | Detail |
|---|---|
| `layer_id` | Must exist in `config/layers.json` (add a new entry for a new layer). |
| `site_id` | Must exist in `config/sites.json` (`haughton`, `jezero`, `shackleton`, ...). |
| Area | At least the box printed by `python scripts/site_bounds.py` (it includes a 10% margin). |
| Bands | Single band, float32, physical units (K, 0-1 albedo, ...), as stated in `layers.json`. |
| Nodata | Set the GeoTIFF nodata value (NaN is fine). Sites need at least 20% coverage. |
| Resolution | Anything. The pipeline resamples onto each site's analysis grid (200 m Mars pair, 80 m Moon pair). |
| CRS | **Must belong to the right body** - see below. |

**CRS by body**

| Body | Use | Notes |
|---|---|---|
| Earth | `EPSG:4326` (or any Earth CRS) | Earth Engine default is fine. |
| Mars | `IAU_2015:49900` (Mars sphere, lon/lat) or a projected Mars CRS | **Never** EPSG:4326: the pipeline rejects it, because it would place the data on an Earth-sized planet. |
| Moon | `IAU_2015:30100` (lon/lat), or for polar sites polar stereographic `+proj=stere +lat_0=-90 +lon_0=0 +R=1737400` | PDS LOLA/Diviner polar products already use polar stereographic. |

Files that break the rules are **skipped with a message**, they never crash the run.

## 2. Run it

```bash
source .venv/Scripts/activate
python scripts/site_bounds.py          # what area to export per site
# ... teams drop their GeoTIFFs into data/layers/<layer_id>/ ...
python scripts/analyze.py              # prints a 'Data layers' inventory + scores per layer
python -m http.server 8000 -d web      # viewer: tick layers under 'Score dimensions'
```

`analyze.py` prints how many site files each layer has and flags files whose name doesn't
match a site id.

To try the whole path without real data: `python scripts/make_demo_layers.py` writes a demo
layer (`demo_tpi`) for all sites in all three CRS types.

## 3. Registering a layer (`config/layers.json`)

```json
{
  "id": "thermal_amplitude",
  "label": "Day-night temperature swing",
  "unit": "K",
  "description": "Mean daily surface temperature amplitude (day minus night).",
  "sources": { "earth": "GEE MODIS/061/MOD11A2", "mars": "PDS THEMIS", "moon": "PDS Diviner" },
  "normalize": "none",
  "scale": 20,
  "weight": 0.15,
  "default_on": true
}
```

How the score works: score = exp(-W / scale), where W is the Wasserstein distance between the
two sites' value distributions.

| `normalize` | Compares | `scale` means | Use when |
|---|---|---|---|
| `none` | raw values | a gap in layer units that gives score 0.37 | units are directly comparable (K, albedo, CPR) |
| `zscore` | shape of the distribution | standard deviations | absolute levels differ by body, patterns matter |
| `minmax` | 2-98 percentile stretched values | fraction of range (0-1) | indices without a common physical scale |

Agree on the **physical quantity** before exporting. Absolute temperature will never match
between Earth and Mars; the day-night swing or thermal inertia can.

## 4. Google Earth Engine team (Earth sites)

| Layer id | Earth Engine dataset | Notes |
|---|---|---|
| `thermal_amplitude` | `MODIS/061/MOD11A2` | `LST_Day_1km - LST_Night_1km`, scale factor 0.02 -> K, Jun-Aug mean |
| `albedo` | `MODIS/061/MCD43A3` | `Albedo_WSA_shortwave` x 0.001, Jun-Aug mean |
| (new) `emissivity` | `NASA/ASTER_GED/AG100_003` | thermal-IR emissivity bands, mineral proxy |
| (new) `ndvi` | `COPERNICUS/S2_SR_HARMONIZED` | best used as a mask, no planetary counterpart |

**Ready-made exporters (already run on 2026-11-14):**

| Script | Layer | Data |
|---|---|---|
| `scripts/gee_export.py` | `thermal_amplitude` (Earth) | MODIS MOD11A2 day - night LST, Jun-Aug |
| `scripts/gee_export.py` | `barren_ground` (Earth) | MODIS MOD13A2 peak NDVI, Jun-Aug |
| `scripts/gee_export.py` | `surface_dust` (Earth) | OpenLandMap topsoil fine fraction on barren ground |
| `scripts/diviner_temperature.py` | `thermal_amplitude` (Moon) | LRO Diviner 240 m south-pole temperatures, max - min over a lunar day |
| `scripts/themis_temperature.py` | `thermal_amplitude` (Mars) | THEMIS projected brightness temperature: afternoon minus pre-dawn, northern summer |
| `scripts/mars_dust.py` | `surface_dust` (Mars) | TES Dust Cover Index (Ruff & Christensen 2002), dust-covered = below 0.94 |

Still missing (PDS team): Moon `surface_dust` (e.g. Diviner rock abundance / regolith fines).

`scripts/gee_export.py` usage:

```bash
source .venv/Scripts/activate
earthengine authenticate                                   # once, opens a browser
python scripts/gee_export.py --project YOUR_GCP_PROJECT    # add --year 2022, --layers, --sites, --force
python scripts/analyze.py
```

To add another Earth Engine dataset, add a function and an entry to `LAYERS` in that script, a layer in
`config/layers.json` and a dataset in `config/data_sources.json`.

Writing your own export per site (Python):

```python
import ee, json, subprocess, requests
ee.Initialize(project="YOUR_GCP_PROJECT")
sites = json.loads(subprocess.check_output(["python", "scripts/site_bounds.py", "--json", "--body", "earth"]))
for s in sites:
    w, so, e, n = s["lonlat_bounds"]
    region = ee.Geometry.Rectangle([w, so, e, n])
    lst = ee.ImageCollection("MODIS/061/MOD11A2").filterDate("2023-06-01", "2023-09-01")
    img = lst.map(lambda i: i.select("LST_Day_1km").subtract(i.select("LST_Night_1km")).multiply(0.02)).mean()
    url = img.getDownloadURL({"region": region, "scale": 1000, "crs": "EPSG:4326", "format": "GEO_TIFF"})
    open(f"data/layers/thermal_amplitude/{s['id']}.tif", "wb").write(requests.get(url).content)
```

`getDownloadURL` is limited to small requests (about 32 MB). Use `Export.image.toDrive` for big areas or fine resolutions.

## 5. NASA PDS team (Moon and Mars targets)

| Layer id | Product | Where |
|---|---|---|
| `thermal_amplitude` (Moon) | LRO Diviner global or polar temperature products | PDS Geosciences / Diviner node |
| `thermal_amplitude` (Mars) | Mars Odyssey THEMIS day + night IR, or thermal inertia mosaics | PDS, USGS Astrogeology |
| `albedo` | LOLA normal albedo (Moon), TES albedo (Mars) | PDS Geosciences |
| `radar_cpr` | LRO Mini-RF CPR mosaics (Moon) | PDS Geosciences |
| (new) minerals | CRISM MTRDR summary parameters (Mars) | PDS Geosciences |

Tips:

- Use the **Orbital Data Explorer** (`ode.rsl.wustl.edu`, REST API at `oderest.rsl.wustl.edu`) to find products by footprint.
- GDAL opens PDS3 `.lbl`, PDS4 `.xml` and ISIS3 `.cub` directly. Keep the CRS from the label, then write the GeoTIFF with `rasterio`/`gdal_translate`, cropping to `site_bounds.py`.
- Large global mosaics can be read remotely, window only, with `/vsicurl/` the same way `analog/sources.py` reads the Mars DEM.

## 6. Data that unlocks more site types

Some Canadian candidates are waiting for a Moon/Mars target of their type. These are the
highest-value requests for the PDS team:

| Type | Waiting Earth site | What would unlock it |
|---|---|---|
| Dunes | Athabasca Sand Dunes | A Mars dune field DEM at < 20 m (CTX or HiRISE DEM, e.g. Nili Patera or Gale's Bagnold dunes). 200 m data can't see dunes. |
| Evaporite | Spotted Lake | A Mars sulfate/chloride target plus CRISM mineral layers (e.g. a sulfate index) on both sides. |
| Ice-rich plains | Tuktoyaktuk pingos | Already has Arcadia, but terrain alone can't tell ice-rich plains from farmland: thermal inertia (THEMIS) and SHARAD/SWIM ice layers are needed. |
| Base site | HMP plateau, Expedition Fiord | Diviner illumination/temperature products for the Artemis regions would let us compare measured sunlight, not only terrain shadowing. |

To add a target: add it to `config/sites.json` with `"role": "target"` and a `"type"`, add its DEM
source (or a GeoTIFF DEM) and run `scripts/fetch_dems.py <id>` and `scripts/analyze.py`.

## 7. In the viewer

- **Score dimensions** card: tick any terrain metric or data layer. The overall score, ranking, top matches and globe arcs recompute instantly.
- Layers without data show "no data yet" and are left out of the score, not counted as 0.
- Each selected layer gets its own histogram (Earth site vs target).
- Share a selection with `?dims=slope,profile,thermal_amplitude` in the URL.
