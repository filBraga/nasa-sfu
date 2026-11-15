"""Mars surface dust for every Mars target from the TES Dust Cover Index (real measurements).

Source: Ruff, S.W. and Christensen, P.R. (2002), Bright and dark regions on Mars: particle size
and mineralogical characteristics based on Thermal Emission Spectrometer data, JGR 107(E12), 5127.
Numeric file: https://www.mars.asu.edu/~ruff/DCI/dci_lo_ice_dust_16ppd_shifted.pds
(float32, 5760 x 2880, 16 pixels/degree, simple cylindrical, longitudes -180..180, 90N at the top).

The index is the average TES emissivity between 1350 and 1400 cm-1: fine dust lowers it.
Values below ~0.94 indicate a dust-covered surface. The longitude layout was checked against
known regions: dust-free Syrtis Major 0.977 and Acidalia 0.968, dusty Tharsis 0.935 and Arabia 0.933.

Output: data/layers/surface_dust/<mars_site>.tif (IAU_2015:49900, Mars sphere lon/lat).
Usage: python scripts/mars_dust.py
"""

import sys
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.crs import CRS
from rasterio.transform import from_origin
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
from analog import load_config  # noqa: E402
from analog.layers import LAYER_DIR  # noqa: E402
from site_bounds import bounds_for  # noqa: E402

URL = "https://www.mars.asu.edu/~ruff/DCI/dci_lo_ice_dust_16ppd_shifted.pds"
LOCAL = ROOT / "data" / "external" / "mars" / "dci_lo_ice_dust_16ppd_shifted.pds"
PPD, W, H, LABEL_BYTES = 16, 5760, 2880, 2 * 512  # from the file's PDS label
CRS_MARS = CRS.from_string("IAU_2015:49900")


def load_dci():
    if not LOCAL.exists():
        LOCAL.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {URL} (66 MB)")
        r = requests.get(URL, timeout=600)
        r.raise_for_status()
        LOCAL.write_bytes(r.content)
    a = np.fromfile(LOCAL, dtype="<f4", offset=LABEL_BYTES)
    if a.size != W * H:
        raise SystemExit(f"unexpected size {a.size}, expected {W * H}")
    a = a.reshape(H, W)
    a[(a < 0.5) | (a > 1.2) | ~np.isfinite(a)] = np.nan
    return a


def main():
    dci = load_dci()
    out_dir = LAYER_DIR / "surface_dust"
    out_dir.mkdir(parents=True, exist_ok=True)
    for site in [s for s in load_config()["sites"] if s["body"] == "mars"]:
        w, s, e, n = bounds_for(site)["lonlat_bounds"]
        c0, c1 = int(np.floor((w + 180) * PPD)) - 2, int(np.ceil((e + 180) * PPD)) + 2
        r0, r1 = int(np.floor((90 - n) * PPD)) - 2, int(np.ceil((90 - s) * PPD)) + 2
        cols = np.arange(c0, c1) % W  # wraps across the 180 meridian
        cut = dci[max(r0, 0):min(r1, H)][:, cols].astype(np.float32)
        transform = from_origin(-180 + c0 / PPD, 90 - max(r0, 0) / PPD, 1 / PPD, 1 / PPD)
        path = out_dir / f"{site['id']}.tif"
        with rasterio.open(path, "w", driver="GTiff", width=cut.shape[1], height=cut.shape[0], count=1,
                           dtype="float32", crs=CRS_MARS, transform=transform, nodata=np.nan) as ds:
            ds.write(cut, 1)
            ds.update_tags(source="TES Dust Cover Index, Ruff & Christensen 2002", quantity="emissivity 1350-1400 cm-1")
        v = cut[np.isfinite(cut)]
        print(f"[ok] {path.relative_to(ROOT)}  {cut.shape[1]}x{cut.shape[0]} px, DCI median {np.median(v):.3f}, "
              f"{(v < 0.94).mean():.0%} dust-covered (< 0.94)")


if __name__ == "__main__":
    main()
