# Dataset card: LDSM_80S_80MPP_ADJ_ERR.TIF

- Review timestamp: 2026-11-14T20:58:47.693939+00:00
- Status: candidate; extraction not run; not ready for scientific handoff.
- Mission/instrument/provider: LRO / LOLA / NASA PGDA.
- Exact file URL: https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDSM_80S_80MPP_ADJ_ERR.TIF
- Source page: https://pgda.gsfc.nasa.gov/products/90
- Property: slope_error; kind: derived.
- Units claimed by catalog: degree; raster scaling unverified.
- Temporal basis: static terrain.
- Access: range_read_verified; HTTP 206; Content-Range bytes 0-15/250069801.
- Remote ETag: W/"ee7c329-1887eb80080"; Last-Modified: Sat, 03 Jun 2023 00:46:08 GMT.
- Source label/version: not yet verified; filename is not a version guarantee.
- Raster dtype, scale, offset, NoData, mask and valid coverage: unverified.
- Effective resolution: unverified; pixel spacing is not effective ground resolution.
- License/reuse conditions and dataset-specific publication: not yet verified.
- Original bytes preserved: only the access-test signature was read; no pixel data exported.

## Catalog context and remaining checks

PGDA 90 states its TIFFs are COGs in south-polar stereographic X/Y metres, MOON_ME / JPL DE421. The exact CRS parameters, longitude convention, reference radius and height datum must still be checked against product metadata. The 80S family claims 80–90 degrees south coverage; valid-pixel coverage is unverified. 80MPP filenames denote 80 m sampling; roughness candidates use 50 or 1000 m sampling with a 100 m plane-fit baseline. Roughness is the spread of spot-height residuals around a plane fit, not an RGB value. Retain count, effective-resolution and height/slope-error companions separately; do not treat error fields as propagated uncertainties after future resampling without a justified method.

A valid TIFF header plus byte ranges proves neither a valid COG layout nor physically meaningful pixels. Inspect metadata before selecting a small native window.
