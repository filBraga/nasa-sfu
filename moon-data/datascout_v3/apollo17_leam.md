# Dataset card: Apollo 17 LEAM raw ARCSAV records

Human-researched candidate facts; see source and saved access evidence.

- **id:** apollo17_leam
- **category:** dust
- **name:** Apollo 17 LEAM raw ARCSAV records
- **status:** candidate
- **measurement kind:** observed raw instrument records
- **representation:** local-station ASCII time series
- **units:** raw field units pending label; no inferred dust flux
- **south polar suitability:** not suitable as south-polar grid; Apollo 17 site only
- **source page:** https://pds-geosciences.wustl.edu/missions/apollo/
- **identifier:** urn:nasa:pds:a17leam_raw_arcsav
- **coverage time:** Catalog: April-June 1975 recovered ARCSAV data
- **quality:** Raw detector and instrument response require documentation and calibration review
- **limitation:** LEAM counts must not be equated directly with mobile surface dust concentration. Local historical context only.
- **extraction status:** not run
- **evidence requests:** ['leam_bundle', 'leam_readme']
- **access results:** {'leam_bundle': 'metadata_read', 'leam_readme': 'metadata_read'}

## Access evidence

- leam_bundle: metadata_read; https://pds-geosciences.wustl.edu/lunar/urn-nasa-pds-a17leam_raw_arcsav/; snapshot snapshots\3f2e2685a1372f462857cf70067f4ea67b7c4957a4038cbaca3340d05e2ae7ed.txt
- leam_readme: metadata_read; https://pds-geosciences.wustl.edu/lunar/urn-nasa-pds-a17leam_raw_arcsav/readme.txt; snapshot snapshots\da62377741040e3d974485dd02aa348144c5ee1a141f40c0e5586b665994130e.txt

## Remaining extraction gate

No science pixels or time-series values inspected. Unless explicitly verified above, product version, dtype, scaling, offsets, fill/masks, uncertainty, valid coverage, exact lunar frame/ephemeris, datum, effective resolution and reuse/license conditions remain unverified. A label describes metadata, not valid coverage at the proposed target. No output raster has been exported, so no layer manifest or pixel-value validation is claimed.
