# Arcadia pingo-scale experiment

This is a **separate experiment**, not a new score dimension in the website. The current
Arcadia comparison uses 200 m/pixel elevation and ranks the Prairie control above
Tuktoyaktuk. We tested whether looking at landforms at 2 m/pixel reveals information
that the broad comparison misses.

## Data and scope

- **Mars reference:** Luzzi et al. (2025) mapped pingo-like mounds in AP-1 and AP-9,
  adjacent to Arcadia Planitia. Their reported features are 117–440 m across and
  4–10 m high. Those sites (around 40°N, 202–203°E) are **not** the broad Arcadia
  grid point in `config/sites.json` (47.25°N, 196°E). The authors explicitly say
  morphology alone cannot confirm these are pingos. [Paper](https://doi.org/10.1029/2024JE008724),
  [published geomorphic maps](https://doi.org/10.5281/zenodo.13647425).
- **Tuktoyaktuk:** a 4 × 4 km, 2 m/pixel NRCan HRDEM window centered on the
  [official Ibyuk Pingo position](https://geonames.nrcan.gc.ca/search-place-names/unique?id=LAKZW)
  (69.399971°N, 133.0777525°W).
- **Prairie:** an equal-resolution, equal-area HRDEM window at 50.35°N, 105.3°W.
  This is **11 km south of the website's Prairie control point**, which has no
  2 m coverage. It is a nearby control, not a replacement for the website's result.
- **Earth reference check:** the [published Tuktoyaktuk pingo inventory](https://doi.org/10.17632/kgbsjvrj32.1)
  supplies mapped pingo positions and measurements. It was partly created using
  HRDEM, so this check is not independent of the elevation data. Both windows are read
  from [NRCan's public 2 m mosaic](https://nrcan.github.io/CanElevation/stac-dem-mosaics/accessing-stac-with-qgis/).

## Method

The script smooths each DEM over 10 m, subtracts a 200 m smoothed background,
and finds local positive-relief peaks. For each peak it measures the half-height
footprint, equivalent diameter, and planform circularity. Default candidate
criteria are at least 3 m local relief, 60–700 m diameter, circularity at least
0.45, and 150 m between peaks. A separate count checks the Mars paper's
117–440 m diameter and 4–10 m height ranges. These are **geometric candidates**;
the detector cannot identify an ice core.

| 4 × 4 km Earth window | Round mound candidates | In reported Mars size/height ranges |
|---|---:|---:|
| Tuktoyaktuk | 25 | 5 |
| Nearby Prairie | 0 | 0 |

Within the detector's interior search area, the published inventory lists **10
Tuktoyaktuk pingos**, including **2** within the Mars paper's size and height
ranges. The detector finds a peak within 100 m of only **3 of 10** mapped pingos.
One of the two Mars-range mapped pingos is recovered. Thus the positive-vs-control
separation is encouraging, but the detector is **not accurate enough to score sites**.

Sensitivity check: for minimum relief of 3 or 4 m and circularity thresholds
0.35, 0.45, or 0.55, Tuktoyaktuk has 10–34 candidates and the Prairie patch has
zero. The count inside the Mars size/height ranges changes from **1 to 10**, while
mapped-pingo recovery remains 3/10. That instability rules out interpreting the
candidate count as a reliable similarity score.

## Reproduce

```bash
python scripts/arcadia_pingo_experiment.py --fetch
python scripts/arcadia_pingo_experiment.py --analyze
```

`--fetch` reads only the two local windows from the much larger public DEM mosaics
and downloads the published inventory. Inputs are cached in ignored
`data/external/arcadia_pingo/`. The reviewable output is
[arcadia_pingo_experiment.json](arcadia_pingo_experiment.json).

## Decision

Keep the existing website score unchanged. A future pingo-scale dimension needs
validated landform detection on **both** Earth and Mars at comparable resolution,
with better recovery of mapped Earth pingos and independent evidence for ice.
The Mars paper notes that even its pingo interpretation remains unconfirmed
without ground truth or high-resolution subsurface measurements.
