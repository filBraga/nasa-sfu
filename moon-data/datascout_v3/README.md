# Scouting v3: dust, gas, light and lunar soil

Scouting is complete for eight candidate dataset families. **No science pixels or
time-series measurements were extracted.** Thirty distinct metadata URLs were
checked; 29 returned readable metadata. The failed LDEX endpoint remains recorded;
its published PDS mirror provided the dust product label.

| Category | Sources found | What they can provide | South-polar grid suitability |
|---|---|---|---|
| Dust | LADEE LDEX; Apollo 17 LEAM | Dust-density altitude/local-time profiles; local raw detector records | Not a verified surface dust map |
| Pressure/exosphere | LADEE NMS; Apollo 15 CCIG | Species densities and uncertainty; local raw records | No verified south-polar surface-pressure raster found in this scout |
| Light | LRO LAMP; LROC WAC Hapke | Polar UV albedo and related quality products; photometric parameters | LAMP is a polar candidate; selected Hapke maps stop at 70 S |
| Soil/regolith | Diviner rock abundance; Apollo 15 penetrometer | Derived rock-cover estimates; actual local force/depth/stress tests | Selected Diviner product stops at 70 S; Apollo tests are local |

The Moon's regolith properties require specific variables. Rock abundance is not
dust quantity, soil chemistry, or bearing strength. UV albedo is not visible lux
or the fraction of time sunlit. Gas density is not surface pressure. These
distinctions must survive any later handoff.

## Evidence and limitations

- [Machine-readable report](scout.json) contains source links, timestamps, remote
  identifiers, parsed label fields, checksums and failure history.
- [Registry](dataset_registry.csv) and the eight dataset cards document candidate
  suitability. Files under `snapshots/` preserve unmodified metadata, named by SHA256.
- Labels checked: LDEX derived density v2.0, one NMS argon product v2.0, Diviner
  rock abundance v1.0, one Apollo 15 soil-mechanics table v1.0, and a LAMP
  south-polar long-band albedo v1.0. Labels do not prove valid target-area pixels.
- Apollo 15 CCIG's current readme reports erroneous columns awaiting redelivery.
  Treat that bundle as requiring correction/review before scientific use.
- LAMP's exact product dates differ from its catalog dates. Both are recorded;
  this scout does not silently choose one interval.
- No remote raster window or COG-layout test was performed in v3. Science file
  links are discovered references, not verified full-file downloads.
- Exact missing-data rules, calibration, effective resolution and frame details
  remain unknown wherever the cards explicitly say so. No zero-filled layers
  or global dust/pressure measurements were fabricated.

## Reproduce

Python 3.10+; standard library only, no pip dependencies:

```powershell
py -3 scripts/scout_environment.py
py -3 scripts/scout_environment.py --resume
py -3 scripts/scout_environment.py --resume --retry-unavailable
py -3 -m unittest discover -s tests -v
```

In this workspace the actual executable was
`.tools/python/cpython-3.12.16-windows-x86_64-none/python.exe`; use it if `py -3`
cannot locate Python. The source list is `config/scouting_v3.json`. Only explicit
metadata URLs are fetched, each capped at 2 MB; there is no recursive science-data
download. Resume verifies cached snapshot checksums and retains original check
times. Omit resume to refresh all checks; prior content-addressed snapshots remain.
Failed checks are kept even when a published mirror succeeds.

## Recommended next extraction

Start with the v2 LOLA terrain and quality companions, plus the verified-access
solar illumination alternative. LAMP UV albedo is the strongest new polar spatial
candidate, after checking its IMG layout, row direction, valid coverage and quality
companions. Keep dust, gas and local soil tests as separate contextual datasets.
Do not interpolate them into unobserved polar pixels.

Sources are linked in each card. Principal catalog pages:
[LDEX](https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/LADEE/ldex.html),
[NMS](https://pds.nasa.gov/ds-view/pds/viewCollection.jsp?identifier=urn:nasa:pds:ladee_nms:data_derived),
[Apollo](https://pds-geosciences.wustl.edu/missions/apollo/),
[LAMP](https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=LRO-L-LAMP-5-GDR-V1.0),
[LROC](https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_HAPKEPARAMMAP), and
[Diviner](https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_ghrm/geotiff/).
