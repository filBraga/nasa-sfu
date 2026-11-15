# Dataset card: AVGVISIB_85S_060M_201608_COG.TIF

- Review timestamp: 2026-11-14T20:58:47.693939+00:00
- Status: unavailable; extraction not run; not ready for scientific handoff.
- Mission/instrument/provider: LRO / LOLA / NASA PGDA.
- Exact file URL: https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608_COG.TIF
- Source page: https://pgda.gsfc.nasa.gov/products/69
- Property: illumination_candidate; kind: modeled.
- Units claimed by catalog: unverified; raster scaling unverified.
- Temporal basis: long-term modeled average.
- Access: unexpected_format; HTTP 206; Content-Range bytes 0-15/3789.
- Remote ETag: W/"ecd-KkisLmY0JuRYevUPaUnq2rpoQCY"; Last-Modified: None.
- Source label/version: not yet verified; filename is not a version guarantee.
- Raster dtype, scale, offset, NoData, mask and valid coverage: unverified.
- Effective resolution: unverified; pixel spacing is not effective ground resolution.
- License/reuse conditions and dataset-specific publication: not yet verified.
- Original bytes preserved: only the access-test signature was read; no pixel data exported.

## Catalog context and remaining checks

PGDA 69 describes a 1737.4 km lunar reference sphere, polar stereographic projection with true scale at the pole, and illumination averaged over hourly steps spanning approximately 18.6 years. The 85S product is listed at 60 m/pixel. Exact model interval, reference frame, units, scale/offset and missing-value rules require product-label verification. This is not a seasonal observation series.

A valid TIFF header plus byte ranges proves neither a valid COG layout nor physically meaningful pixels. Inspect metadata before selecting a small native window.
