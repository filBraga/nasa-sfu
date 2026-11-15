"""Write a demo data layer (topographic position index) for every site, in the same format the
data teams must deliver: data/layers/demo_tpi/<site_id>.tif.

It deliberately writes each body in a *different* CRS (Earth EPSG:4326, Mars IAU_2015:49900,
Moon polar stereographic) so the whole reprojection path is tested. It is derived from the DEMs,
so it is only a pipeline test, not independent evidence.

Usage: python scripts/make_demo_layers.py
"""

import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin
from rasterio.warp import Resampling, calculate_default_transform, reproject
from scipy.ndimage import uniform_filter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from analog import RAW_DIR, load_config  # noqa: E402
from analog.layers import LAYER_DIR  # noqa: E402

DELIVERY_CRS = {
    "earth": CRS.from_string("EPSG:4326"),
    "mars": CRS.from_string("IAU_2015:49900"),
    "moon": CRS.from_proj4("+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"),
}
NEIGHBOURHOOD_M = 2000


def main():
    out_dir = LAYER_DIR / "demo_tpi"
    out_dir.mkdir(parents=True, exist_ok=True)
    for site in load_config()["sites"]:
        raw = RAW_DIR / f"{site['id']}.npz"
        if not raw.exists():
            print(f"[skip] {site['id']}: no DEM, run fetch_dems.py first")
            continue
        d = np.load(raw)
        z, res = d["z"].astype(np.float32), float(d["res"])
        src_crs = CRS.from_proj4(str(d["crs"]))
        n = z.shape[0]
        src_transform = from_origin(-n * res / 2, n * res / 2, res, res)
        k = max(3, int(round(NEIGHBOURHOOD_M / res)) | 1)
        tpi = z - uniform_filter(z, size=k, mode="nearest")

        dst_crs = DELIVERY_CRS[site["body"]]
        left, bottom, right, top = -n * res / 2, -n * res / 2, n * res / 2, n * res / 2
        transform, w, h = calculate_default_transform(src_crs, dst_crs, n, n, left, bottom, right, top)
        dst = np.full((h, w), np.nan, np.float32)
        reproject(tpi, dst, src_transform=src_transform, src_crs=src_crs, dst_transform=transform,
                  dst_crs=dst_crs, dst_nodata=np.nan, resampling=Resampling.bilinear)
        path = out_dir / f"{site['id']}.tif"
        with rasterio.open(path, "w", driver="GTiff", width=w, height=h, count=1, dtype="float32",
                           crs=dst_crs, transform=transform, nodata=np.nan, compress="deflate") as ds:
            ds.write(dst, 1)
        print(f"[ok] {path.relative_to(LAYER_DIR.parent.parent)}  {w}x{h}  CRS {dst_crs.to_string()[:40]}")


if __name__ == "__main__":
    main()
