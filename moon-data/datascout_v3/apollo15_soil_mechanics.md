# Dataset card: Apollo 15 LSRP soil mechanics

Human-researched candidate facts; see source and saved access evidence.

- **id:** apollo15_soil_mechanics
- **category:** soil
- **name:** Apollo 15 LSRP soil mechanics
- **status:** candidate
- **measurement kind:** observed and reduced penetrometer measurements
- **representation:** local experiment tables with documentation
- **units:** selected label: load Newton, stress Newton/cm^2, penetration depth Centimeter, drum deflection Millimeter
- **verification level:** one table label verified; measurements not extracted
- **label verified facts:** a15_smss_71_m016935_011 v1.0; run index 2; handtyped raw and reduced chart; 1971-08-01T18:01:15Z; corrected-depth field applies 3.75 cm correction. Final initial-drum-depth values absent from source chart. Preserve original notes and units.
- **south polar suitability:** not a south-polar raster; six tests at Apollo 15 Station 8
- **source page:** https://pds-geosciences.wustl.edu/missions/apollo/a15lsrp.htm
- **identifier:** urn:nasa:pds:a15lsrp_soil_mechanics
- **coverage time:** 1971-08-01
- **quality:** Retain raw versus reduced tables, cone/plate setup and calibration separately
- **limitation:** Useful real soil-mechanics context; do not spread local point tests across unobserved terrain.
- **extraction status:** not run
- **evidence requests:** ['soil_mechanics_page', 'soil_tables', 'soil_label']
- **access results:** {'soil_mechanics_page': 'metadata_read', 'soil_tables': 'metadata_read', 'soil_label': 'metadata_read'}

## Access evidence

- soil_mechanics_page: metadata_read; https://pds-geosciences.wustl.edu/missions/apollo/a15lsrp.htm; snapshot snapshots\3c98e3e8afcd8e1b6f6af7a445a10c1fb7a6fb55e336d15aa0cf5478c596ab33.txt
- soil_tables: metadata_read; https://pds-geosciences.wustl.edu/lunar/urn-nasa-pds-a15lsrp_soil_mechanics/data; snapshot snapshots\704c9e0d18bf15297669591cdb2970aa433f5c514953bd3baddb17e72e03b87f.txt
- soil_label: metadata_read; https://pds-geosciences.wustl.edu/lunar/urn-nasa-pds-a15lsrp_soil_mechanics/data/a15_smss_71_m016935_011.xml; snapshot snapshots\6729ea48ccce203513cfb9f0642e7b40f8990e9f3ae3242b3354e646876cdae7.xml

## Remaining extraction gate

No science pixels or time-series values inspected. Unless explicitly verified above, product version, dtype, scaling, offsets, fill/masks, uncertainty, valid coverage, exact lunar frame/ephemeris, datum, effective resolution and reuse/license conditions remain unverified. A label describes metadata, not valid coverage at the proposed target. No output raster has been exported, so no layer manifest or pixel-value validation is claimed.
