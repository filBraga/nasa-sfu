# Diviner seasonal PCP: deferred extraction candidate

Status: candidate, label verified; data table not downloaded or ingested.

Provider: NASA PDS Geosciences / LRO Diviner / Jean-Pierre Williams, UCLA.

Exact label (downloaded, 13093 bytes):
https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_pcp/seasonal/slon/pols/pcp_avg_tbol_pols_ls030_slon01_240.xml

Logical identifier: `urn:nasa:pds:lro_diviner_derived1:data_derived_pcp:pcp_avg_tbol_pols_ls030_slon01_240`.
Version: 1.0. Local unmodified label: `pcp_avg_tbol_pols_ls030_slon01_240.xml`.
SHA256: `c434aa4916cf70917a09ecbed4c6bd44537ff343687c6c9c056ede843a4064e8`.

Data file listed in the archive and label: `pcp_avg_tbol_pols_ls030_slon01_240.tab`;
archive lists 215979356 bytes. This is an ASCII table, not a remotely window-readable
COG. No table bytes or temperatures were extracted.

Label-verified: derived average bolometric brightness temperature `tbol`, K;
240 m spatial bins; observations 2009-07-05 to 2020-03-15; this particular file
contains Ls 0–60 degrees and subsolar longitude 0–15 degrees. Empty bins are omitted.
Invalid constant -9998 and unknown constant -9999 are declared for table fields;
neither is a physical measurement. Columns: x, y, clon, clat, ltim, tbol.
The x/y columns are normalized polar stereographic coordinates, with units `deg`
in the label, normalized by mean lunar radius 1737.4 km; do not ingest as metres.
Longitude/latitude are in degrees; local time is in hours. Exact conversion and
coordinate frame need the coordinate documentation before rasterization.

The team overview describes six Ls and 24 subsolar longitude bins for this family:
https://www.diviner.ucla.edu/single-post/new-diviner-south-polar-data-products-released-on-pds
This is observed-bin aggregation, not instantaneous ground temperature and not
the same time support as the long-term solar illumination map. Counts/uncertainty
are not among this table's six listed columns; do not invent them. Effective
resolution, valid spatial coverage, coordinate frame, license/reuse terms and
additional quality products remain unverified.

Method cited in label: Schorghofer and Williams (2020), Mapping of ice storage
processes on the Moon with time-dependent temperatures, PSJ 1:54,
https://doi.org/10.3847/PSJ/abb6ff.
