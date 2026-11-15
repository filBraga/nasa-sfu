"""Download DEM windows for each body and resample them onto a local square grid.

Every site ends up on an azimuthal-equidistant grid centred on the site, in metres,
using that body's own radius. That makes slopes and distances comparable between
Earth, the Moon and Mars.

Only the needed part of each global dataset is read (HTTP range requests), so no
multi-gigabyte downloads are required.
"""

import math
import os
from pathlib import Path

import numpy as np
import requests
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin, rowcol
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import Window

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.TIF")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")

RADIUS_M = {"moon": 1737400.0, "mars": 3396190.0}

COPERNICUS_URL = "https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"
MARS_DEM_URL = ("https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/"
                "Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif")
LOLA_SOUTH_URL = ("https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/"
                  "data/lola_gdr/polar/float_img/ldem_80s_80m_float.img")
# Values from the PDS label LDEM_80S_80M_FLOAT.LBL
LOLA_SOUTH = dict(n=7600, res=80.0, record_bytes=30400, x0=-304000.0, y0=304000.0)


def local_crs(body, lat, lon):
    if body == "earth":
        return CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m +no_defs")
    return CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +R={RADIUS_M[body]} +units=m +no_defs")


def local_grid(window_km, res_m):
    n = int(round(window_km * 1000.0 / res_m))
    half = n * res_m / 2.0
    return n, half, from_origin(-half, half, res_m, res_m)


# ---------------------------------------------------------------- Earth

def _copernicus_name(lat_i, lon_i):
    ns = "N" if lat_i >= 0 else "S"
    ew = "E" if lon_i >= 0 else "W"
    return f"Copernicus_DSM_COG_10_{ns}{abs(lat_i):02d}_00_{ew}{abs(lon_i):03d}_00_DEM"


def fetch_earth(site, res_m, log=print):
    crs = local_crs("earth", site["lat"], site["lon"])
    n, half, transform = local_grid(site["window_km"], res_m)
    w, s, e, nth = transform_bounds(crs, "EPSG:4326", -half, -half, half, half, densify_pts=41)
    dst = np.full((n, n), np.nan, np.float32)
    for lat_i in range(math.floor(s), math.floor(nth) + 1):
        for lon_i in range(math.floor(w), math.floor(e) + 1):
            url = COPERNICUS_URL.format(name=_copernicus_name(lat_i, lon_i))
            if requests.head(url, timeout=30).status_code != 200:
                log(f"    tile {lat_i},{lon_i}: not available (ocean?)")
                continue
            log(f"    tile {lat_i},{lon_i}: reading")
            tmp = np.full((n, n), np.nan, np.float32)
            with rasterio.open("/vsicurl/" + url) as ds:
                reproject(rasterio.band(ds, 1), tmp, dst_transform=transform, dst_crs=crs,
                          dst_nodata=np.nan, resampling=Resampling.bilinear)
            dst = np.where(np.isnan(dst), tmp, dst)
    missing = float(np.isnan(dst).mean())
    if missing:
        log(f"    {missing:.1%} of the grid had no tile (treated as sea level 0 m)")
        dst = np.nan_to_num(dst, nan=0.0)
    return dst, crs, transform


# ---------------------------------------------------------------- Mars

def fetch_mars(site, res_m, log=print):
    R = RADIUS_M["mars"]
    crs = local_crs("mars", site["lat"], site["lon"])
    geo = CRS.from_proj4(f"+proj=longlat +R={R} +no_defs")
    n, half, transform = local_grid(site["window_km"], res_m)
    w, s, e, nth = transform_bounds(crs, geo, -half, -half, half, half, densify_pts=41)
    pad = 0.05
    with rasterio.open("/vsicurl/" + MARS_DEM_URL) as ds:
        (r0, r1), (c0, c1) = rowcol(ds.transform, [w - pad, e + pad], [nth + pad, s - pad])
        win = Window(c0, r0, c1 - c0 + 1, r1 - r0 + 1)
        log(f"    reading {win.width}x{win.height} px window from HRSC-MOLA blend")
        arr = ds.read(1, window=win).astype(np.float32)
        nodata = ds.nodata
        if nodata is not None:
            arr[arr == nodata] = np.nan
        arr = arr * float(ds.scales[0]) + float(ds.offsets[0])
        src_transform = ds.window_transform(win)
    dst = np.full((n, n), np.nan, np.float32)
    reproject(arr, dst, src_transform=src_transform, src_crs=geo, src_nodata=np.nan,
              dst_transform=transform, dst_crs=crs, dst_nodata=np.nan,
              resampling=Resampling.bilinear)
    return dst, crs, transform


# ---------------------------------------------------------------- Moon

def fetch_moon(site, res_m, log=print):
    if site["lat"] > -80:
        raise ValueError("Only lunar south polar sites (lat <= -80) are supported by this starter.")
    R = RADIUS_M["moon"]
    L = LOLA_SOUTH
    crs = local_crs("moon", site["lat"], site["lon"])
    src_crs = CRS.from_proj4(f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={R} +units=m +no_defs")
    n, half, transform = local_grid(site["window_km"], res_m)
    xmin, ymin, xmax, ymax = transform_bounds(crs, src_crs, -half, -half, half, half, densify_pts=41)
    c0 = max(0, math.floor((xmin - L["x0"]) / L["res"]) - 2)
    c1 = min(L["n"] - 1, math.ceil((xmax - L["x0"]) / L["res"]) + 2)
    r0 = max(0, math.floor((L["y0"] - ymax) / L["res"]) - 2)
    r1 = min(L["n"] - 1, math.ceil((L["y0"] - ymin) / L["res"]) + 2)
    start, end = r0 * L["record_bytes"], (r1 + 1) * L["record_bytes"] - 1
    log(f"    reading LOLA rows {r0}-{r1} ({(end - start) / 1e6:.0f} MB)")
    resp = requests.get(LOLA_SOUTH_URL, headers={"Range": f"bytes={start}-{end}"}, timeout=600)
    resp.raise_for_status()
    if resp.status_code != 206:
        raise RuntimeError("Server ignored the byte-range request")
    rows = np.frombuffer(resp.content, dtype="<f4").reshape(-1, L["n"])
    arr = rows[:, c0:c1 + 1].astype(np.float32) * 1000.0  # km -> m
    src_transform = from_origin(L["x0"] + c0 * L["res"], L["y0"] - r0 * L["res"], L["res"], L["res"])
    dst = np.full((n, n), np.nan, np.float32)
    reproject(arr, dst, src_transform=src_transform, src_crs=src_crs,
              dst_transform=transform, dst_crs=crs, dst_nodata=np.nan,
              resampling=Resampling.bilinear)
    if site.get("hires_dem") == "lro_nac_south_pole":
        dst = merge_nac(dst, crs, transform, res_m, log)
    return dst, crs, transform


# ---------------------------------------------------------------- Moon, high resolution (LRO NAC)

NAC_URL = "https://asc-astropedia.s3.us-west-2.amazonaws.com/Moon/LRO/MOON_LRO_NAC_DEM_89S210E_4mp.tif"
NAC_LOCAL = Path(__file__).resolve().parent.parent / "data" / "external" / "moon" / "MOON_LRO_NAC_DEM_89S210E_4mp.tif"


def merge_nac(lola, crs, transform, res_m, log=print):
    """Replace LOLA with the 4 m LRO NAC stereo DEM (USGS 'Moon LRO South Pole DEM') where it has data.
    The file is stored row by row (310 MB), so it is downloaded once and read locally. Any vertical
    offset between the two DEMs is measured on the overlap and removed, so the seam doesn't show."""
    if not NAC_LOCAL.exists():
        NAC_LOCAL.parent.mkdir(parents=True, exist_ok=True)
        log(f"    downloading LRO NAC south pole DEM (310 MB) to {NAC_LOCAL.name}")
        with requests.get(NAC_URL, stream=True, timeout=1800) as r:
            r.raise_for_status()
            with open(NAC_LOCAL, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
    nac = np.full(lola.shape, np.nan, np.float32)
    with rasterio.open(NAC_LOCAL) as ds:
        reproject(rasterio.band(ds, 1), nac, dst_transform=transform, dst_crs=crs, dst_nodata=np.nan,
                  resampling=Resampling.average if res_m > ds.res[0] else Resampling.bilinear)
    both = np.isfinite(nac) & np.isfinite(lola)
    if not both.any():
        log("    NAC DEM does not overlap this site; using LOLA only")
        return lola
    offset = float(np.median(nac[both] - lola[both]))
    out = np.where(np.isfinite(nac), nac - offset, lola).astype(np.float32)
    log(f"    LRO NAC 4 m DEM covers {np.isfinite(nac).mean():.0%} of the window (LOLA fills the rest); "
        f"vertical offset NAC-LOLA {offset:+.1f} m removed")
    return out


FETCHERS = {"earth": fetch_earth, "mars": fetch_mars, "moon": fetch_moon}
NATIVE_RES = {"mars": 200.0, "moon": 80.0}


def fetch_site(site, log=print):
    res = float(site.get("fetch_res_m") or NATIVE_RES[site["body"]])
    z, crs, transform = FETCHERS[site["body"]](site, res, log=log)
    return z, res, crs


def resample(z, res_from, res_to):
    """Resample a centred local grid to another pixel size (area-average when coarsening)."""
    if abs(res_from - res_to) < 1e-6:
        return z
    n_from = z.shape[0]
    extent = n_from * res_from
    n_to = int(round(extent / res_to))
    half_f, half_t = extent / 2, n_to * res_to / 2
    dst = np.full((n_to, n_to), np.nan, np.float32)
    crs = CRS.from_proj4("+proj=eqc +R=1 +units=m +no_defs")  # dummy; both grids share it
    reproject(z, dst,
              src_transform=from_origin(-half_f, half_f, res_from, res_from), src_crs=crs,
              dst_transform=from_origin(-half_t, half_t, res_to, res_to), dst_crs=crs,
              src_nodata=np.nan, dst_nodata=np.nan,
              resampling=Resampling.average if res_to > res_from else Resampling.bilinear)
    return dst
