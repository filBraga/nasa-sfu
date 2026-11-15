# Dataset card: LADEE NMS derived Ar, He and Ne abundances

Human-researched candidate facts; see source and saved access evidence.

- **id:** ladee_nms
- **category:** pressure_exosphere
- **name:** LADEE NMS derived Ar, He and Ne abundances
- **status:** candidate
- **measurement kind:** derived from mass spectrometer observations
- **representation:** orbital ASCII time series
- **units:** selected argon label: density and Std P/Cc (particles per cubic centimetre); positions/altitude Kilometers
- **verification level:** one argon product label verified; other species labels not checked
- **label verified facts:** nms_ar_36077_20131122_081916 v2.0, 2013-11-22T08:19:16Z to 09:13:16Z; Ar_ABUNDANCE and Std; spacecraft XYZ in MOON_IAU; invalid constant -999.; original CSV not downloaded
- **south polar suitability:** not verified; orbital observations, not a polar surface pressure raster
- **source page:** https://pds.nasa.gov/ds-view/pds/viewCollection.jsp?identifier=urn:nasa:pds:ladee_nms:data_derived
- **identifier:** urn:nasa:pds:ladee_nms:data_derived::2.0
- **citation:** Benna and Lyness (2014), doi:10.17189/1408897
- **coverage time:** Collection catalog spans 2013-09-14 to 2014-04-18; verify selected observation intervals separately
- **quality:** Species calibration, sensitivity, spacecraft contamination and SPICE geometry must be reviewed
- **limitation:** Neutral species abundances are not total surface pressure. Do not derive pressure without an appropriate physical model and required temperatures.
- **extraction status:** not run
- **evidence requests:** ['nms_collection', 'nms_archive', 'nms_bundle_label', 'nms_derived', 'nms_november', 'nms_argon_label']
- **access results:** {'nms_collection': 'metadata_read', 'nms_archive': 'metadata_read', 'nms_bundle_label': 'metadata_read', 'nms_derived': 'metadata_read', 'nms_november': 'metadata_read', 'nms_argon_label': 'metadata_read'}

## Access evidence

- nms_collection: metadata_read; https://pds.nasa.gov/ds-view/pds/viewCollection.jsp?identifier=urn:nasa:pds:ladee_nms:data_derived; snapshot snapshots\0ab9a9ba50447a97139aa8d098fb4db79f3d27ec47943939d388bc4ff121e490.txt
- nms_archive: metadata_read; https://atmos.nmsu.edu/PDS/data/PDS4/LADEE/nms_bundle/; snapshot snapshots\40bbe22c43c9b2cf528846b557f6c4266ea6d6937a3034d2fac80feeccf4ef89.txt
- nms_bundle_label: metadata_read; https://atmos.nmsu.edu/PDS/data/PDS4/LADEE/nms_bundle/bundle_ladee_nms.xml; snapshot snapshots\65a1e9409418ceccc588315423ab88f4df06a1b49b9ea2f8352ed9b50cb53924.xml
- nms_derived: metadata_read; https://atmos.nmsu.edu/PDS/data/PDS4/LADEE/nms_bundle/data_derived/; snapshot snapshots\de320c73c542363ca93d0cfc2991164457cd473d804178fe17f83f4d9e386bd4.txt
- nms_november: metadata_read; https://atmos.nmsu.edu/PDS/data/PDS4/LADEE/nms_bundle/data_derived/2013-11/; snapshot snapshots\aafc63cc9b3dface5215d278ad055ad175462799d3e21a051f32ccc1fa084e35.txt
- nms_argon_label: metadata_read; https://atmos.nmsu.edu/PDS/data/PDS4/LADEE/nms_bundle/data_derived/2013-11/nms_ar_36077_20131122_081916.xml; snapshot snapshots\2acb9064e6243c56fe813f1b1f37f12f7a5db771ccc8dbb818922dc282e98cd5.xml

## Remaining extraction gate

No science pixels or time-series values inspected. Unless explicitly verified above, product version, dtype, scaling, offsets, fill/masks, uncertainty, valid coverage, exact lunar frame/ephemeris, datum, effective resolution and reuse/license conditions remain unverified. A label describes metadata, not valid coverage at the proposed target. No output raster has been exported, so no layer manifest or pixel-value validation is claimed.
