# Matched-scale AP-1 pingo study

This extends the [first Earth-only experiment](ARCADIA_PINGO_EXPERIMENT.md). It compares
actual Mars and Earth elevation windows at **2 m pixels over 2 × 2 km**. It remains a
validation experiment; it is not included in the website score.

## Data

- **AP-1:** a 1 m/post stereo DEM from the [UCLA/PDS Mars DEM archive](https://doi.org/10.17189/ervc-mr85),
  made from HiRISE `ESP_052490_2200` and `ESP_052424_2200`, resampled to 2 m.
  This is the same stereo image pair used in [Luzzi et al. (2025)](https://doi.org/10.1029/2024JE008724),
  but a separate DEM reduction. The 2 km window is centered at 39.916°N, 202.105°E,
  around mapped pingo-like polygons. Those coordinates are distinct from the
  website's broad Arcadia site.
- **AP-8 local comparison:** another UCLA/PDS stereo DEM, from `ESP_042930_2210`
  and `ESP_043220_2210`, resampled to 2 m. Its 2 km center window at 40.744°N,
  201.2786°E contains no pingo-like polygon in the [published geomorphic map](https://doi.org/10.5281/zenodo.13647425).
- **Earth:** 2 m [NRCan HRDEM mosaic](https://nrcan.github.io/CanElevation/stac-dem-mosaics/accessing-stac-with-qgis/)
  windows centered on Ibyuk Pingo and on a nearby Prairie control. The Prairie
  point is 11 km south of the website's control point because that point has no
  2 m coverage. Both 2 km windows are central crops of the previous 4 km caches.
- **Reference labels:** AP-1 pingo-like polygons from the published Mars geomorphic
  map and Earth pingos from the [Tuktoyaktuk inventory](https://doi.org/10.17632/kgbsjvrj32.1).

## Method and results

The original geometric mound detector requires at least 3 m local relief,
60–700 m diameter, and 0.45 circularity. A second, **more sensitive screen**
finds local relief peaks above 3 m after 10 m smoothing and subtraction of a
200 m background. Peaks must be 150 m apart. Both searches exclude a 350 m
window edge; the relief screen also excludes peaks within 20 m of DEM no-data.
Map matches allow 100 m between a DEM peak and a mapped feature center. A peak
is **not** evidence of an ice core or even a confirmed pingo.

| Equal 2 km window | Valid DEM pixels | Original geometric candidates | Screened relief peaks | Peaks / valid search km² | Mapped features matched |
|---|---:|---:|---:|---:|---:|
| AP-1 | 61% | 0 | 6 | 5.08 | 1 of 2 |
| AP-8 center | 67% | 0 | 7 | 4.33 | 0 mapped locally |
| Tuktoyaktuk, Ibyuk center | 100% | 6 | 14 | 8.28 | 1 of 1 |
| Nearby Prairie | 100% | 0 | 0 | 0 | no inventory labels |

The AP-1 and AP-8 screen densities are similar. The screen does **not**
distinguish the locally mapped AP-1 pingo-like terrain from this AP-8 window.
For the one AP-1 match, 2,000 random draws of two valid points in the AP-1
search area matched at least as many peaks **26.4%** of the time. With only two
mapped features in the window, this is weak evidence of recognition.

The full 4 km Tuktoyaktuk window gives a broader Earth check. At the 3 m relief
threshold, the screen finds **71 peaks and 7 of 10** mapped pingos within 100 m;
the Prairie 4 km window has **zero** peaks. Random valid positions in Tuktoyaktuk
match about **2 of 10** on average, and match at least 7 in 0.1% of 2,000 draws.
This suggests the screen responds to pingo-bearing terrain, but most of its 71
peaks remain unverified. At 4 m, recovery drops to 4 of 10. The original
geometric detector recovered only 3 of 10 in the earlier experiment.

## Limits and decision

- The published AP-1 map file contains **13** polygons labeled `Pingo-like`, and
  the AP-8 map contains **3** labeled `Pingo-like feature`. The paper reports
  **12** AP-1 features and **none** at AP-8. None of the AP-8 mapped polygons lies
  near our AP-8 center window. The map and paper counts need reconciliation
  before treating those labels as a complete validation set.
- The Mars stereo windows contain substantial no-data. Missing pixels were
  filled from their nearest valid neighbor **only for smoothing**; peaks within
  20 m of a gap were excluded. Larger-scale smoothing can still be affected by
  gaps. [USGS guidance](https://stac.astrogeology.usgs.gov/docs/data/mars/hirise_dtms/)
  also cautions that stereo DEM pixels can contain artifacts and that post
  spacing is finer than true resolving power.
- The Earth inventory was partly mapped using HRDEM, so the Earth label check
  is not independent of the elevation source. The 100 m positional tolerance
  is generous relative to some landforms. Random-point matching is a simple
  reference benchmark, not a formal significance test for spatially clustered
  landforms.

**Do not add a pingo dimension to the website score yet.** The next useful work
is to inspect the AP-1/AP-8 DEMs against stereo quality masks and HiRISE images,
reconcile map labels, and validate a detector on additional mapped landforms
and harder controls. Keep the broad 200 m terrain match separate from this
landform-scale evidence.

## Reproduce

```bash
python scripts/matched_scale_pingo.py --fetch
python scripts/matched_scale_pingo.py --analyze
```

`--fetch` makes range reads from the public stereo GeoTIFFs, downloads the
published maps and Earth inventory if needed, and caches inputs in ignored
`data/external/arcadia_pingo/`. The reviewable result is
[matched_scale_pingo.json](matched_scale_pingo.json). The source Mars files
are about 3.9 GB (AP-1) and 1.0 GB (AP-8); the script reads only the
requested windows.
