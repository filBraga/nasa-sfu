# Dataset card: LADEE LDEX derived dust density

Human-researched candidate facts; see source and saved access evidence.

- **id:** ladee_ldex
- **category:** dust
- **name:** LADEE LDEX derived dust density
- **status:** candidate
- **measurement kind:** derived from dust impacts
- **representation:** altitude/local-time ASCII profiles, not surface raster
- **units:** label: dust density and error M**-3 (m^-3), altitude Km (km)
- **verification level:** sample label verified; science values not read
- **label verified facts:** ldex_ltden_pds_derived.xml v2.0; grains radius greater than 0.3 micrometres; altitude and 11 local-time density/error pairs; missing constant -9.99E+00; product time 2013-10-25 to 2014-04-18
- **south polar suitability:** not verified; orbital sampling cannot represent every polar surface pixel
- **source page:** https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/LADEE/ldex.html
- **identifier:** urn:nasa:pds:ladee_ldex:data_derived::2.0
- **citation:** PDS collection parent DOI 10.26033/06sf-na65; Horanyi et al. (2014), doi:10.1007/s11214-014-0118-7. Version lineage needs review against older DOI on instrument page.
- **coverage time:** Catalog: 2013-10-24 to 2014-04-18; derived profiles described by altitude and local time
- **quality:** Instrument page describes dust-density errors; exact fields and calibration pending labels
- **limitation:** Orbital dust density is not surface dust depth, adhesion, or rover dust hazard. Archive access may fail; retain negative results.
- **extraction status:** not run
- **evidence requests:** ['ldex_page', 'ldex_collection', 'ldex_archive', 'ldex_mirror', 'ldex_derived', 'ldex_label']
- **access results:** {'ldex_page': 'metadata_read', 'ldex_collection': 'metadata_read', 'ldex_archive': 'unavailable', 'ldex_mirror': 'metadata_read', 'ldex_derived': 'metadata_read', 'ldex_label': 'metadata_read'}

## Access evidence

- ldex_page: metadata_read; https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/LADEE/ldex.html; snapshot snapshots\a53cb0c85bdd1242c6cf7b144d4cc62773115d46347f3a8317f031f5f43a257d.txt
- ldex_collection: metadata_read; https://pds.nasa.gov/ds-view/pds/viewCollection.jsp?identifier=urn:nasa:pds:ladee_ldex:data_derived; snapshot snapshots\e940d9fda304be542b28eb874df3dfd1eed750b11e28e6ad753280bfda983729.txt
- ldex_archive: unavailable; https://sbnarchive.psi.edu/pds4/ldex/ladee_ldex_20161118/data_derived/; snapshot none
- ldex_mirror: metadata_read; https://atmos.nmsu.edu/PDS/data/PDS4/LADEE/ldex_bundle/; snapshot snapshots\063e09b5ba573002679c6cf3e4386b23b066e913921f395e912047ae8b9f08a2.txt
- ldex_derived: metadata_read; https://atmos.nmsu.edu/PDS/data/PDS4/LADEE/ldex_bundle/data_derived/; snapshot snapshots\6b625a0305443bcd5c502a819aef5737f8f90719ce55fdc506eda166793aa045.txt
- ldex_label: metadata_read; https://atmos.nmsu.edu/PDS/data/PDS4/LADEE/ldex_bundle/data_derived/ldex_ltden_pds_derived.xml; snapshot snapshots\80f7374df3078c1d342fa9b86ecf87e56a0f170e828faf96cde86f4064ed8661.xml

## Remaining extraction gate

No science pixels or time-series values inspected. Unless explicitly verified above, product version, dtype, scaling, offsets, fill/masks, uncertainty, valid coverage, exact lunar frame/ephemeris, datum, effective resolution and reuse/license conditions remain unverified. A label describes metadata, not valid coverage at the proposed target. No output raster has been exported, so no layer manifest or pixel-value validation is claimed.
