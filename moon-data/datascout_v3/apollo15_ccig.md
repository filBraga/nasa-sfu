# Dataset card: Apollo 15 SIDE/CCIG raw records

Human-researched candidate facts; see source and saved access evidence.

- **id:** apollo15_ccig
- **category:** pressure_exosphere
- **name:** Apollo 15 SIDE/CCIG raw records
- **status:** candidate
- **measurement kind:** observed raw instrument records
- **representation:** local-station ASCII time series
- **units:** raw fields pending labels and calibration; no pressure conversion applied
- **south polar suitability:** not suitable as south-polar grid; Apollo 15 site only
- **source page:** https://pds-geosciences.wustl.edu/missions/apollo/
- **identifier:** urn:nasa:pds:a15side_ccig_raw_arcsav
- **coverage time:** Catalog: April-June 1975
- **quality:** Readme verified: October 2026 error affects WD-4-5 and WD-9-10; corrections awaiting redelivery. Quarantine for scientific use until corrected or reviewed against documented correction.
- **limitation:** Raw CCIG observations and separate scanned density plots are not a global pressure raster. Density and pressure must remain distinct.
- **extraction status:** not run
- **evidence requests:** ['ccig_archive', 'ccig_readme']
- **access results:** {'ccig_archive': 'metadata_read', 'ccig_readme': 'metadata_read'}

## Access evidence

- ccig_archive: metadata_read; https://pds-geosciences.wustl.edu/lunar/urn-nasa-pds-a15side_ccig_raw_arcsav/; snapshot snapshots\8813fa7e3731a1ee86d7e697ee9838aca4620f511840fff67f8f4a75f92e8466.txt
- ccig_readme: metadata_read; https://pds-geosciences.wustl.edu/lunar/urn-nasa-pds-a15side_ccig_raw_arcsav/readme.txt; snapshot snapshots\b591da3eda0428e9feb7250d37a930247bdcda618e5833cc6f0614bb87a4d1cf.txt

## Remaining extraction gate

No science pixels or time-series values inspected. Unless explicitly verified above, product version, dtype, scaling, offsets, fill/masks, uncertainty, valid coverage, exact lunar frame/ephemeris, datum, effective resolution and reuse/license conditions remain unverified. A label describes metadata, not valid coverage at the proposed target. No output raster has been exported, so no layer manifest or pixel-value validation is claimed.
