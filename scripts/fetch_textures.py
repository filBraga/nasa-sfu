"""Download / build planet textures for the 3D globe view into web/textures/.

Earth: NASA Blue Marble Next Generation (Jan 2004)
Moon:  NASA SVS CGI Moon Kit, LROC colour mosaic
Mars:  built here from the MGS MOLA 463 m global DEM (colour-by-elevation + hillshade),
       so the Mars globe literally shows the elevation dataset.
"""

import io
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from analog import ROOT  # noqa: E402

OUT = ROOT / "web" / "textures"
EARTH_URL = ("https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/"
             "bmng-base/january/world.200401.3x5400x2700.jpg")
MOON_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg"
MOLA_URL = "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")


def save_remote_image(url, out, width):
    print(f"  downloading {url}")
    r = requests.get(url, timeout=300)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    img = img.resize((width, width // 2), Image.LANCZOS)
    img.save(out, quality=90)
    print(f"  saved {out} {img.size}")


def build_mars(out, width=2048):
    import rasterio
    from rasterio.windows import Window
    rows = width // 2
    with rasterio.open("/vsicurl/" + MOLA_URL) as ds:
        W, H = ds.width, ds.height
    row_idx = ((np.arange(rows) + 0.5) * H / rows).astype(int)
    col_idx = ((np.arange(width) + 0.5) * W / width).astype(int)
    print(f"  reading {rows} sampled rows of MOLA ({rows * W * 2 / 1e6:.0f} MB, takes a few minutes)")

    def read_rows(chunk):
        out_rows = []
        with rasterio.open("/vsicurl/" + MOLA_URL) as ds:
            for r in chunk:
                out_rows.append(ds.read(1, window=Window(0, int(r), W, 1))[0, col_idx])
        return out_rows

    chunks = np.array_split(row_idx, 16)
    with ThreadPoolExecutor(8) as ex:
        z = np.array([row for part in ex.map(read_rows, chunks) for row in part], dtype=np.float32)

    # colour by elevation (low = dark basalt, high = pale dust) + hillshade
    t = np.clip((z - np.percentile(z, 1)) / (np.percentile(z, 99.5) - np.percentile(z, 1)), 0, 1)
    stops = np.array([[0.00, 40, 30, 35], [0.25, 110, 60, 40], [0.5, 170, 100, 60],
                      [0.75, 205, 150, 105], [1.00, 240, 220, 200]], dtype=float)
    rgb = np.stack([np.interp(t, stops[:, 0], stops[:, i]) for i in (1, 2, 3)], axis=-1)
    gy, gx = np.gradient(z)
    lat = np.radians(90 - (np.arange(rows) + 0.5) * 180 / rows)[:, None]
    gx = gx / np.maximum(np.cos(lat), 0.05)
    k = 0.004
    shade = 1 / np.sqrt(1 + (k * gx) ** 2 + (k * gy) ** 2) * (1 - 0.6 * np.clip(k * (gx - gy), -1, 1))
    rgb = np.clip(rgb * (0.55 + 0.45 * shade[..., None]), 0, 255).astype(np.uint8)
    Image.fromarray(rgb).save(out, quality=90)
    print(f"  saved {out} {width}x{rows}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = {
        "earth.jpg": lambda p: save_remote_image(EARTH_URL, p, 2048),
        "moon.jpg": lambda p: save_remote_image(MOON_URL, p, 1024),
        "mars.jpg": lambda p: build_mars(p, 2048),
    }
    for name, job in jobs.items():
        path = OUT / name
        if path.exists() and "--force" not in sys.argv:
            print(f"[skip] {name}")
            continue
        print(f"[texture] {name}")
        try:
            job(path)
        except Exception as exc:
            print(f"  FAILED ({exc}); the viewer will fall back to a plain colour")


if __name__ == "__main__":
    main()
