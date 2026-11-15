# Scout v3 lunar dust extraction

`ldex_ltden_pds_derived.tab` and its PDS4 XML label are the original LADEE LDEX
derived v2.0 archive files. `scripts/sample_dust.mjs` validates the product ID,
record size, field positions, units and missing constants before parsing them.

The table has 26 altitude bins (5–255 km) and 11 local-solar-time bins. Dust number
density and its reported error are in m^-3, for grains larger than 0.3 micrometres
in radius. Missing `-9.99E+00` values become null. No surface extrapolation is made.
The original label declares 9-byte science fields starting on separators, whereas
the table has 10-byte numeric slots. The parser reads complete numbers up to the
next field start and checks full scientific notation. This avoids truncating the
exponent (for example, 3.16E-03 must remain 0.00316).
The resulting `data/enrichment/dust.json` preserves hashes and links to the source.

This is orbital dust evidence, not surface dust coverage, depth, adhesion or a
site hazard map. Apollo 17 LEAM remains metadata-only because raw local detector
counts require calibration before any physical dust estimate. Diviner's modeled
rock cover is retained separately and is never converted to a dust percentage.

From the repository root:

```powershell
node --use-system-ca moon-data/scripts/sample_dust.mjs
node scripts/export_evidence.mjs
```

Default execution reuses the original cached files. Use `--refresh` to fetch them
again. The website receives compact JSON, not the labels or raw records.

Sources:
- https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/LADEE/ldex.html
- https://atmos.nmsu.edu/PDS/data/PDS4/LADEE/ldex_bundle/data_derived/
- https://pds-geosciences.wustl.edu/lunar/urn-nasa-pds-a17leam_raw_arcsav/readme.txt
- https://doi.org/10.1029/2022JE007532
