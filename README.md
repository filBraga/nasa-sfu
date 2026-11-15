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

## Next steps

- Add the less-studied Canadian candidates (Pingualuit, Athabasca Dunes, Spotted Lake, Tuktoyaktuk pingos).
- Add non-terrain dimensions: MODIS land surface temperature vs Diviner / THEMIS, ASTER emissivity vs CRISM,
  RCM compact-pol circular polarisation ratio vs LRO Mini-RF.
- Scan a grid over all of Canada instead of hand-picked sites.
# nasa-sfu
