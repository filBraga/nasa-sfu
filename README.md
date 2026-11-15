# Analog Explorer: Canadian terrain analogs for the Moon and Mars

Starter project for the NASA Space Apps 2026 challenge
*Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*.

It downloads elevation data for Earth, Moon and Mars sites, puts every site on the same kind of
local metric grid, scores how similar their terrain is **dimension by dimension**, and shows the
result in a three.js viewer (planet globes + side-by-side 3D terrain).

## Quick start (Windows, Git Bash)

```bash
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt

python scripts/fetch_dems.py       # ~2 min, reads only the needed windows of each global DEM
python scripts/fetch_textures.py   # ~3 min, planet textures for the globes
python scripts/analyze.py          # scores + exports web/data/
python -m http.server 8000 -d web  # then open http://localhost:8000
```

Deep links: `http://localhost:8000/#compare/mistastin/shackleton`

No accounts are needed for the current datasets.

## Calibration step (where we are now)

Known analogs are paired with targets, and **control** sites (prairie, mountains, Canadian Shield)
must rank lower. If they don't, the method is wrong.

| Target | 1st | 2nd | best control |
|---|---|---|---|
| Jezero (Mars), 200 m | Haughton 0.68 | Mistastin 0.66 | Shield 0.41 |
| Shackleton (Moon), 80 m | Mistastin 0.41 | Haughton 0.38 | Mountains 0.34 |

Shackleton scores are low for everyone: it is ~37x deeper relative to its width than Mistastin
(depth/diameter 0.19 vs 0.005). That is a real finding: low gravity + no erosion keeps lunar
craters deep and sharp, something no Earth site reproduces.

## Site types (not only craters)

Craters were only the calibration case. Every site has a **type** (`config/site_types.json`), and an
Earth site is only compared with targets of a type it shares; controls are compared with everything.

| Type | Targets now | Earth candidates now | Metrics |
|---|---|---|---|
| Impact crater | Jezero, Shackleton | Haughton, Mistastin, Pingualuit | slope, roughness, hypsometry, crater profile, depth/diameter |
| Base site (ridge / plateau) | Malapert Massif, Mons Mouton Plateau (Artemis III regions) | HMP base-camp plateau, Expedition Fiord uplands | slope, roughness, hypsometry, flat ground, sunlight at low sun |
| Ice-rich plains | Arcadia Planitia | Tuktoyaktuk pingos, Haughton | slope, roughness, hypsometry, flat ground, texture |
| Dunes, volcanic, evaporite | none yet | Athabasca Dunes, Spotted Lake | slope, roughness, hypsometry, texture |

New metrics:

- **Flat ground:** share of area under 5 deg slope (landing, construction).
- **Sunlight at low sun:** for each pixel, the share of 16 sun directions it is lit from at the target's
  sun elevation (1.5 deg at the lunar south pole), with horizons out to 20 km and the body's curvature.
  Check: Shackleton's floor comes out lit from 0% of directions (it is permanently shadowed) and its rim ~45%.
- **Texture:** shape of the terrain's power spectrum, 100 m - 20 km wavelengths.

What the first run shows (terrain only, default dimensions):

- **Mons Mouton Plateau:** Expedition Fiord uplands 0.42 > HMP plateau 0.32 > all controls. Works as intended.
- **Malapert Massif:** the Coast Mountains control ranks first (0.45). Malapert is a 5 km massif, so a 30 km
  window is mostly steep flanks, and terrain says "mountain". The base site itself is a small summit area;
  a smaller window or summit-only analysis is the next refinement.
- **Arcadia Planitia:** the Prairie control ranks first (0.63), Tuktoyaktuk second (0.51). Smooth plains
  look alike in elevation data whatever they are made of. Telling ice-rich ground from farmland needs the
  thermal / radar / ice layers, which is exactly what the data teams are adding.

## Data

| Body | Dataset | Resolution | Access |
|---|---|---|---|
| Earth | Copernicus DEM GLO-30 | 30 m | AWS Open Data COGs (`copernicus-dem-30m`) |
| Mars | HRSC-MOLA Blended DEM v2 | 200 m | USGS Astrogeology, HTTP range reads |
| Moon | LRO LOLA `LDEM_80S_80M` | 80 m | NASA PDS Geosciences, HTTP range reads |
| Globes | Blue Marble NG, LROC colour, MOLA 463 m | - | NASA / USGS |

## Similarity metrics (`analog/compare.py`)

| Metric | Weight | Method |
|---|---|---|
| Slope distribution | 0.20 | Wasserstein distance between slope samples |
| Surface roughness | 0.15 | Wasserstein distance of log10 Terrain Ruggedness Index |
| Hypsometry | 0.15 | Gap between normalised elevation-area curves |
| Crater profile shape | 0.30 | Correlation of 8 compass-sector radial profiles with the target profile |
| Depth / diameter | 0.20 | Log-ratio, 0.5 at a 2x difference |
| Flat ground (< 5 deg) | 0.20 | Difference in flat-area share, scale 0.15 |
| Sunlight at low sun | 0.30 | Wasserstein distance of per-pixel lit fraction (16 azimuths, curvature-corrected horizons) |
| Terrain texture | 0.20 | Gap between normalised log power spectra |

Each target type uses a subset (see Site types). Each score is 0-1; >= 0.7 strong, 0.4-0.7 partial, < 0.4 weak.

## Layout

```
config/sites.json      sites, roles (analog / target / control), types, calibration pairs
config/site_types.json site types and the terrain metrics each one uses
config/layers.json     data layers (temperature, albedo, radar, ...)
analog/sources.py      DEM download + reprojection to a local azimuthal-equidistant grid
analog/terrain.py      slope, roughness, radial profiles, hypsometry
analog/compare.py      per-dimension similarity scores
scripts/               fetch_dems.py, fetch_textures.py, analyze.py
web/                   three.js viewer (index.html, main.js, style.css, data/, textures/)
```

## Adding a site

Add an entry to `config/sites.json` (Earth: any lat/lon; Mars: anywhere; Moon: south of 80 S
for now), then `python scripts/fetch_dems.py <id>` and `python scripts/analyze.py`.

## Data layers

Temperature, albedo, radar and other layers plug in as GeoTIFFs in `data/layers/<layer_id>/<site_id>.tif`,
registered in `config/layers.json`. In the viewer, the **Score dimensions** card lets you pick which
terrain metrics and layers the score uses. See [docs/DATA_INTEGRATION.md](docs/DATA_INTEGRATION.md).

## Added Moon and Mars comparison locations

All researched locations from `moon-data/moon_data.json` and
`mars-data/mars_data.json` are selectable targets in the main comparison dropdown
and globe. The catalog expansion below adds more named features and landing sites. Research-location targets
use regional slope, roughness, hypsometry and flat-ground comparisons; they do not
use whole-crater profile or depth assumptions. Each is compared against Earth sites
whose body preferences allow that target.

The eight new Moon locations use local windows from the cached global LOLA TIFF
at 2 km/pixel. These are coarse regional comparisons, not pit, boulder or landing
hazard assessments. The four new Mars locations use 200 m HRSC-MOLA DEM windows.
Saved literature, Diviner and reflectance evidence remains available in the
on-demand evidence library; unlike quantities are not substituted for scored layers.
Mars dust comparisons use the cached TES Dust Cover Index where available.

To reproduce the import and export:

```powershell
python scripts/import_planetary_sites.py
python scripts/fetch_dems.py
python scripts/mars_dust.py
python scripts/analyze.py
```

The importer preserves existing target coordinates. New Mars DEM reads use Node
with system CA trust and the existing `moon-data` GeoTIFF dependency; only small
native windows are cached in `data/external/mars/terrain_windows/`. No source rasters
are sent to the browser. `analyze.py` writes compact JSON and small binary terrain
files, and refreshes the evidence export. Serve `web/` as before.

Scout v3 lunar dust measurements are shown in **Lunar dust & regolith** below the
comparison metrics. LDEX supplies 26 orbital-altitude profiles at 11 local times,
with densities and reported errors. Diviner rock cover is shown separately at the
eight target coordinates inside its coverage. These are contextual measurements,
not a surface dust-coverage score. Rebuild the small dust export with
`npm.cmd --prefix moon-data run sample:dust`, then `node scripts/export_evidence.mjs`.

## Moon catalog expansion and dust policy

`python scripts/add_moon_targets.py` adds named lunar features and recorded landing
locations, deduplicating entries within 10 km or with the same normalized name.
The current configuration has 125 Moon targets. Known 20–200 km craters use crater
metrics; other catalog locations use landing-zone metrics. Existing high-resolution
polar targets are preserved; new catalog targets use the cached global LOLA DEM at
2 km/pixel. This is regional screening and cannot resolve small hazards.

```powershell
python scripts/add_moon_targets.py
python scripts/fetch_dems.py --body=moon
node --use-system-ca moon-data/scripts/sample_dust.mjs
python scripts/analyze.py --body moon
```

The body-specific analysis rebuilds Moon comparisons and keeps the existing Mars
comparison records, so downloading the Mars rasters again is unnecessary. Full
analysis remains available without `--body` when all DEM caches are present.

`surface_dust.score_excluded_bodies` explicitly excludes Moon dust from the backend
total and the browser's live scoring. In Moon comparisons its existing Filters
checkbox shows or hides lunar dust evidence; it never changes the ranking. For
Mars, that checkbox continues to control whether dust contributes to the score.
LDEX orbital profiles and Diviner rock cover remain contextual, with no invented
surface dust percentages. Missing temperature measurements remain missing.

## Connecting every Earth map place

All 50 entries in `web/data/places_all.json` are linked to comparison sites using
`site_id`. Together with the original 11 Earth sites this gives 61 candidates.
Each map place is compared with the Moon/Mars bodies listed in its `targets`.
Existing sites and weights are preserved; heuristic map percentages never become
physical measurements. Unnamed places are identified using their saved coordinates.

```powershell
python scripts/import_team_places.py --connect-all
node --use-system-ca scripts/cache_earth_windows.mjs
python scripts/fetch_dems.py --body=earth
python scripts/analyze.py --calculations-only
```

The source-window script uses small verified HTTPS byte ranges from Copernicus
GLO-30 and caches them outside the web folder. Missing DEM cells remain nodata;
they are never filled with artificial zero-height land. The new 27 places have
measured terrain; temperature/vegetation/soil layers remain missing until exported
from an authenticated Earth Engine account using `scripts/gee_export.py`.
Their evidence coverage and partial scores reflect those gaps.

## Suitability aggregation

Run `python scripts/aggregate_suitability.py` to recalculate the saved suitability
files from their existing normalized metric scores. This does not regenerate raw
environmental measurements. The implementation is in `analog/scoring.py`.

Earth and relative scores give slope, temperature, dust, and plants equal weight;
cold and swing split temperature's weight. Missing cold data therefore reduces
temperature coverage to 50%. Moon absolute scores retain their own four categories:
slope, midnight temperature, regolith, and materials.

Aggregation uses a weighted geometric mean with an exact zero veto. Missing or
invalid metrics reduce coverage, and an overall score is published only at 80%
coverage or higher. `observed_score` remains available for diagnostics. Scores
measure the configured environmental criteria; they are not a safety certification.
Run `python -m unittest discover -s tests` to check aggregation behavior.

## Next steps

- Add the less-studied Canadian candidates (Pingualuit, Athabasca Dunes, Spotted Lake, Tuktoyaktuk pingos).
- Add non-terrain dimensions: MODIS land surface temperature vs Diviner / THEMIS, ASTER emissivity vs CRISM,
  RCM compact-pol circular polarisation ratio vs LRO Mini-RF.
- Scan a grid over all of Canada instead of hand-picked sites.
# nasa-sfu
