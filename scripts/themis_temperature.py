"""Mars day-night temperature swing from Mars Odyssey THEMIS (real measurements) for every Mars target.

Source: THEMIS infrared Projected Brightness Temperature images (PDS ODY-M-THM-5-IRPBT-V2.0,
Arizona State University), 100 m/pixel, Kelvin, found with the NASA PDS Orbital Data Explorer
REST API (oderest.rsl.wustl.edu).

For each target we pick images in northern summer (Ls 90-180, same season as the Earth MODIS
June-August data; falls back to any season if too few), taken in the mid-afternoon (12-17 h local
solar time, near the daily maximum) and before dawn (0-7 h, near the minimum). Each set is
averaged on the site's grid and the swing is afternoon minus pre-dawn.

Output: data/layers/thermal_amplitude/<mars_site>.tif (local Mars grid, metres).
Downloads are cached in data/external/mars/themis/.
Usage: python scripts/themis_temperature.py [--max-images 8] [--any-season]
"""

import argparse
import json
import sys
import urllib.parse
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.warp import Resampling, reproject

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
from analog import load_config  # noqa: E402
from analog.facts import write_fact  # noqa: E402
from analog.layers import LAYER_DIR  # noqa: E402
from analog.sources import local_crs, local_grid  # noqa: E402
from site_bounds import bounds_for  # noqa: E402

ODE = "https://oderest.rsl.wustl.edu/live2/"
CACHE = ROOT / "data" / "external" / "mars" / "themis"
# Mars Odyssey's orbit only images at ~4-7 h and ~16-19 h local solar time, so the swing we can
# measure is late afternoon (still near the daily high) minus early morning (near the daily low).
WARM_HOURS, COLD_HOURS = (15.5, 18.5), (4.0, 7.5)
LS_HALF_WINDOW = 45.0   # day and night images must come from the same 90-degree stretch of the Mars year
GRID_RES = 200.0        # metres; matches the Mars comparison resolution
MIN_OVERLAP = 0.10      # below this, use typical(warm) - typical(cold) instead of pixel-by-pixel


def query_ode(w, s, e, n):
    """THEMIS IRPBT2 products whose footprint touches the box (longitudes 0-360 east)."""
    params = {"query": "product", "results": "mf", "output": "JSON", "target": "mars", "ihid": "ODY",
              "iid": "THEMIS", "pt": "IRPBT2", "minlat": s, "maxlat": n,
              "westlon": w % 360, "eastlon": e % 360, "limit": 1000}
    r = requests.get(ODE + "?" + urllib.parse.urlencode(params), timeout=300)
    r.raise_for_status()
    prods = r.json().get("ODEResults", {}).get("Products", {})
    if not prods:
        return []
    p = prods["Product"]
    return p if isinstance(p, list) else [p]


def describe(p):
    img = [f for f in p["Product_files"]["Product_file"] if f["FileName"].upper().endswith(".IMG")]
    if not img:
        return None
    return {"id": img[0]["FileName"][:-4], "url": img[0]["URL"], "kb": float(img[0]["KBytes"]),
            "hour": float(p["Solar_time"]), "ls": float(p["Solar_longitude"]), "inc": float(p["Incidence_angle"]),
            "date": p["Observation_time"][:10],
            "box": (float(p["Westernmost_longitude"]), float(p["Minimum_latitude"]),
                    float(p["Easternmost_longitude"]), float(p["Maximum_latitude"]))}


def ls_dist(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def candidates(images):
    warm = [i for i in images if WARM_HOURS[0] <= i["hour"] <= WARM_HOURS[1] and i["inc"] < 88]
    cold = [i for i in images if COLD_HOURS[0] <= i["hour"] <= COLD_HOURS[1]]
    return warm, cold


def best_season(warm, cold):
    """Centre (Ls) of the 90-degree season window holding the most usable warm AND cold images."""
    best = (-1, None)
    for c in range(0, 360, 5):
        n = min(sum(ls_dist(i["ls"], c) <= LS_HALF_WINDOW for i in warm),
                sum(ls_dist(i["ls"], c) <= LS_HALF_WINDOW for i in cold))
        if n > best[0]:
            best = (n, c)
    return best[1]


def pick(imgs, centre, max_n):
    """Images within the season window, spread across longitude (strips are ~32 km wide, N-S)."""
    ok = [i for i in imgs if centre is None or ls_dist(i["ls"], centre) <= LS_HALF_WINDOW]
    chosen, used = [], []
    for i in sorted(ok, key=lambda i: (ls_dist(i["ls"], centre or i["ls"]), i["kb"])):
        c = (i["box"][0] + i["box"][2]) / 2
        if all(abs(c - u) > 0.1 for u in used) or len(chosen) < 2:
            chosen.append(i)
            used.append(c)
        if len(chosen) >= max_n:
            break
    return chosen


def fetch(img):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{img['id']}.IMG"
    if not path.exists() or path.stat().st_size < 10_000:
        r = requests.get(img["url"], timeout=900)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


def on_grid(path, site):
    crs = local_crs("mars", site["lat"], site["lon"])
    n, _, transform = local_grid(site["window_km"], GRID_RES)
    dst = np.full((n, n), np.nan, np.float32)
    with rasterio.open(path) as ds:
        src = ds.read(1).astype(np.float32)
        src[(src < 100) | (src > 350) | ~np.isfinite(src)] = np.nan  # fill values and bad pixels
        reproject(src, dst, src_transform=ds.transform, src_crs=ds.crs, src_nodata=np.nan,
                  dst_transform=transform, dst_crs=crs, dst_nodata=np.nan, resampling=Resampling.average)
    return dst, crs, transform


def mean_stack(grids):
    stack = np.stack(grids)
    with np.errstate(invalid="ignore"):
        return np.nanmean(stack, axis=0) if np.isfinite(stack).any() else stack[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-images", type=int, default=8, help="per site, per day/night set")
    ap.add_argument("--any-season", action="store_true", help="don't prefer northern summer")
    args = ap.parse_args()

    out_dir = LAYER_DIR / "thermal_amplitude"
    out_dir.mkdir(parents=True, exist_ok=True)
    for site in [s for s in load_config()["sites"] if s["body"] == "mars"]:
        w, s, e, n = bounds_for(site)["lonlat_bounds"]
        images = [d for d in map(describe, query_ode(w, s, e, n)) if d]
        warm, cold = candidates(images)
        centre = None if args.any_season else best_season(warm, cold)
        day, night = pick(warm, centre, args.max_images), pick(cold, centre, args.max_images)
        season = "any season" if centre is None else f"season Ls {centre - LS_HALF_WINDOW:.0f}-{centre + LS_HALF_WINDOW:.0f}"
        print(f"[{site['id']}] {len(images)} THEMIS PBT images in the box ({len(warm)} late-afternoon, {len(cold)} early-morning); "
              f"{season}: using {len(day)} + {len(night)}")
        if not day or not night:
            print("    not enough images, skipped")
            continue
        sets = {}
        for name, chosen in (("day", day), ("night", night)):
            grids = []
            for img in chosen:
                print(f"    {name:<5} {img['id']}  {img['date']}  {img['hour']:5.2f} h  Ls {img['ls']:5.1f}  {img['kb'] / 1000:5.1f} MB")
                g, crs, transform = on_grid(fetch(img), site)
                grids.append(g)
            sets[name] = mean_stack(grids)
        swing = (sets["day"] - sets["night"]).astype(np.float32)
        method = "pixel by pixel"
        if np.isfinite(swing).mean() < MIN_OVERLAP:
            # afternoon and morning strips barely overlap: use the typical early-morning temperature
            # of the window as the baseline for every afternoon pixel
            swing = (sets["day"] - np.nanmedian(sets["night"])).astype(np.float32)
            method = "afternoon pixels minus the window's median early-morning temperature (strips barely overlap)"
        swing[swing <= 0] = np.nan  # afternoon colder than morning = cloud/frost artefact, not a real swing
        path = out_dir / f"{site['id']}.tif"
        with rasterio.open(path, "w", driver="GTiff", width=swing.shape[1], height=swing.shape[0], count=1,
                           dtype="float32", crs=crs, transform=transform, nodata=np.nan, compress="deflate") as ds:
            ds.write(swing, 1)
            ds.update_tags(source="Mars Odyssey THEMIS IRPBT (ASU/PDS)",
                           images=json.dumps({k: [i["id"] for i in v] for k, v in (("day", day), ("night", night))}),
                           season=season, method=method,
                           quantity="late-afternoon minus early-morning brightness temperature, K")
        write_fact("temperature", site["id"], dataset="themis_ir",
                   low_k=round(float(np.nanmedian(sets["night"])), 1), high_k=round(float(np.nanmedian(sets["day"])), 1),
                   what=f"typical early-morning (~5-7 h) and late-afternoon (~17-18 h) surface temperature, {season}; "
                        "Mars Odyssey never sees midday or midnight, so the true range is wider")
        v = swing[np.isfinite(swing)]
        print(f"[ok] {path.relative_to(ROOT)}  coverage {v.size / swing.size:.0%} ({method}), swing median {np.median(v):.0f} K "
              f"(afternoon {np.nanmedian(sets['day']):.0f} K, morning {np.nanmedian(sets['night']):.0f} K)")


if __name__ == "__main__":
    main()
