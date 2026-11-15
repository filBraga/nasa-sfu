# Dataset card: Diviner GHRM slope-adjusted-midnight rock abundance

Human-researched candidate facts; see source and saved access evidence.

- **id:** diviner_rock_abundance
- **category:** soil
- **name:** Diviner GHRM slope-adjusted-midnight rock abundance
- **status:** candidate
- **measurement kind:** derived thermal-model estimate
- **representation:** GeoTIFF and PDS IMG spatial products
- **units:** selected PDS label does not declare rock-abundance units; fraction versus percent remains unverified
- **verification level:** product label verified; raster not opened
- **label verified facts:** dghrm_ra_sam_70s70n_tif v1.0; 17920 lines x 46080 samples; IEEE754LSBSingle; missing NaN; 128 pixels/degree; 236.901175188667821 m projected sampling; equirectangular Moon_2000 sphere radius 1737400 m; planetocentric, positive-east; bounds -180 to 180 longitude and -70 to 70 latitude; data 2009-07-05 to 2022-08-01
- **south polar suitability:** selected catalog product is 70 S-70 N; excluded from polar test region
- **source page:** https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_ghrm/geotiff/
- **identifier:** dghrm_ra_sam_70s70n_tif
- **citation:** Diviner derived bundle DOI 10.17189/wj0s-w188; exact product version and method citation pending label
- **native sampling:** label: 128 pixels/degree, 236.901175188667821 projected m/pixel; effective resolution unverified
- **coverage time:** label: 2009-07-05 to 2022-08-01; cumulative derived mosaic, not instantaneous
- **quality:** Verify model assumptions and missing-value constants in label
- **limitation:** Areal rock abundance is not dust quantity, grain-size distribution, mineral chemistry, or bearing strength. Listing shows approximately 3.3 GB: metadata only in this scout.
- **extraction status:** not run
- **evidence requests:** ['ra_directory', 'ra_label']
- **access results:** {'ra_directory': 'metadata_read', 'ra_label': 'metadata_read'}

## Access evidence

- ra_directory: metadata_read; https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_ghrm/geotiff/; snapshot snapshots\9aa6adc58b5b4e4151200ca68147cfdb307317130e18a9ed8b8aabe05881d4f4.txt
- ra_label: metadata_read; https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_ghrm/geotiff/dghrm_ra_sam_70s70n_tif.xml; snapshot snapshots\2ac9cedf3c9db29f32a909e76fbd7c95359cd04eaf11c442ec10c0c439fdc6f6.xml

## Remaining extraction gate

No science pixels or time-series values inspected. Unless explicitly verified above, product version, dtype, scaling, offsets, fill/masks, uncertainty, valid coverage, exact lunar frame/ephemeris, datum, effective resolution and reuse/license conditions remain unverified. A label describes metadata, not valid coverage at the proposed target. No output raster has been exported, so no layer manifest or pixel-value validation is claimed.
