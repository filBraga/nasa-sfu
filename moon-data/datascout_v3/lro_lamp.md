# Dataset card: LRO LAMP polar far-ultraviolet GDR maps

Human-researched candidate facts; see source and saved access evidence.

- **id:** lro_lamp
- **category:** light
- **name:** LRO LAMP polar far-ultraviolet GDR maps
- **status:** candidate
- **measurement kind:** derived radiometry; illumination uses a separate model
- **representation:** PDS IMG polar rasters with detached labels
- **units:** catalog: brightness photons/cm2/s/sr; albedo dimensionless; exposure s
- **south polar suitability:** catalog covers 80-90 S; valid coverage and exact product label pending
- **source page:** https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=LRO-L-LAMP-5-GDR-V1.0
- **identifier:** LRO-L-LAMP-5-GDR-V1.0
- **citation:** Kaufmann (2011), doi:10.17189/1520244
- **verification level:** south-polar cumulative long-band albedo label verified; pixels not read
- **label verified facts:** LAMP_80s_240mpp_long_albed_01.img v1.0: dimensionless albedo fraction, offset 0, scale 1; 32-bit PC_REAL, 2501 x 2501; LINE_DISPLAY_DIRECTION UP; polar stereographic centred -90 latitude, 0 longitude; MEAN EARTH/POLAR AXIS OF DE421; 1737.4 km sphere; east-positive, planetocentric; 240 m/pixel. Product label spans 2009-09-01 to 2010-10-01, differing from dataset catalog interval; preserve both until reconciled. Wavelength 129.57-189.57 nm. Catalog specifies NaN; confirm against image bytes before extraction.
- **native sampling:** catalog: 240 m/pixel at pole; 2501 x 2501; effective resolution not inferred
- **frame:** catalog: lunar planetocentric ME, east-positive 0-360 longitude, polar stereographic; exact radius/ephemeris pending label
- **coverage time:** Catalog: 2009-09-16 to 2010-09-14; cumulative and monthly products
- **quality:** Catalog supplies exposure, counts, statistical-error and quality maps; no-data IEEE NaN
- **limitation:** Far-UV brightness/albedo are not visible lux, broadband solar power, or the fraction of time sunlit. Exact file access and label still needed.
- **extraction status:** not run
- **evidence requests:** ['lamp_catalog', 'lamp_volumes', 'lamp_gdr', 'lamp_data_directory', 'lamp_errata', 'lamp_albedo_directory', 'lamp_south_label']
- **access results:** {'lamp_catalog': 'metadata_read', 'lamp_volumes': 'metadata_read', 'lamp_gdr': 'metadata_read', 'lamp_data_directory': 'metadata_read', 'lamp_errata': 'metadata_read', 'lamp_albedo_directory': 'metadata_read', 'lamp_south_label': 'metadata_read'}

## Access evidence

- lamp_catalog: metadata_read; https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=LRO-L-LAMP-5-GDR-V1.0; snapshot snapshots\9192aa97597fb7756955c93cdc92d92ea528225d9a6639fcc0dfa23770901cca.txt
- lamp_volumes: metadata_read; https://pds-imaging.jpl.nasa.gov/volumes/lro.html; snapshot snapshots\e849112f7665869055c27c875036f71469ae74635b252f80533e7ce31b3c4ff9.txt
- lamp_gdr: metadata_read; https://pds-imaging.jpl.nasa.gov/data/lro/lamp/gdr/LROLAM_2001/; snapshot snapshots\2ad90615b82429e285b6011e624f06d482c749ec44a01edad7a52c541dd49736.txt
- lamp_data_directory: metadata_read; https://planetarydata.jpl.nasa.gov/img/data/lro/lamp/gdr/LROLAM_2001/DATA/; snapshot snapshots\1ffb234eb679a74eb3d4c1032b8f0cbe0fc1011201b1343bd2ad1469e46ea52f.txt
- lamp_errata: metadata_read; https://planetarydata.jpl.nasa.gov/img/data/lro/lamp/gdr/LROLAM_2001/ERRATA.TXT; snapshot snapshots\90fbe365d4a0ebbf62c52d1ae271ddd37399e92666996128ad6f0c17bbdcc688.txt
- lamp_albedo_directory: metadata_read; https://planetarydata.jpl.nasa.gov/img/data/lro/lamp/gdr/LROLAM_2001/DATA/ALBEDO/; snapshot snapshots\d1720b12fe6cafb64ab49bb61a866e3e5862a5b1b06416d42508bb2fe1254221.txt
- lamp_south_label: metadata_read; https://planetarydata.jpl.nasa.gov/img/data/lro/lamp/gdr/LROLAM_2001/DATA/ALBEDO/LAMP_80s_240mpp_long_albed_01.lbl; snapshot snapshots\7352c46f65be7763b02844f999c1e4ddc4876ce933b61386c229ebdd8e1b709d.txt

## Remaining extraction gate

No science pixels or time-series values inspected. Unless explicitly verified above, product version, dtype, scaling, offsets, fill/masks, uncertainty, valid coverage, exact lunar frame/ephemeris, datum, effective resolution and reuse/license conditions remain unverified. A label describes metadata, not valid coverage at the proposed target. No output raster has been exported, so no layer manifest or pixel-value validation is claimed.
