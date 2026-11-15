# Dataset card: LROC WAC 643 nm Hapke parameter map

Human-researched candidate facts; see source and saved access evidence.

- **id:** lroc_hapke
- **category:** light_soil
- **name:** LROC WAC 643 nm Hapke parameter map
- **status:** candidate
- **measurement kind:** photometric model fit to observed reflectance
- **representation:** nine-band PDS IMG; TIFF alternative
- **units:** parameter dependent: single-scattering albedo dimensionless; other units/order must be verified
- **south polar suitability:** excluded from south-polar extraction: latitude limited to 70 S-70 N
- **source page:** https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_HAPKEPARAMMAP
- **identifier:** WAC_HAPKEPARAMMAP_643NM
- **citation:** Sato et al. (2014), doi:10.1002/2013JE004580
- **native sampling:** 1 degree by 1 degree catalog grid; effective resolution not inferred
- **frame:** equirectangular centered 0 latitude/longitude; exact lunar datum/radius pending label
- **coverage time:** Catalog: February 2010-October 2011
- **quality:** Several model parameters are fixed constants; cannot use them as measured spatial variation
- **limitation:** Reflective surface properties are not incoming illumination or direct soil strength. Too coarse and outside the south-polar area.
- **extraction status:** not run
- **evidence requests:** ['hapke_page', 'hapke_product']
- **access results:** {'hapke_page': 'metadata_read', 'hapke_product': 'metadata_read'}

## Access evidence

- hapke_page: metadata_read; https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_HAPKEPARAMMAP; snapshot snapshots\fd1aafe231ea3bfa24040ace67204117a615e49afd7671774125f2a4255c65a6.txt
- hapke_product: metadata_read; https://data.lroc.im-ldi.com/lroc/view_rdr_product/WAC_HAPKEPARAMMAP_643NM; snapshot snapshots\d42fac0cb73bd991d98d1e24d00ec87d2e48e2f089fc697d3a18b61c16b3815a.txt

## Remaining extraction gate

No science pixels or time-series values inspected. Unless explicitly verified above, product version, dtype, scaling, offsets, fill/masks, uncertainty, valid coverage, exact lunar frame/ephemeris, datum, effective resolution and reuse/license conditions remain unverified. A label describes metadata, not valid coverage at the proposed target. No output raster has been exported, so no layer manifest or pixel-value validation is claimed.
