"""Compare 2 m DEM patches at the published AP-1 site and two Earth sites.

Usage:
    python scripts/matched_scale_pingo.py --fetch
    python scripts/matched_scale_pingo.py --analyze

The Mars DEM is a separate UCLA/PDS stereo reduction of the same HiRISE image
pair used by Luzzi et al. (2025), not their unpublished stereo DEM. Inputs are
cached in data/external/arcadia_pingo/ and are not added to the website score.
"""

import argparse
import json
import math
import sqlite3
from pathlib import Path
from zipfile import ZipFile

import numpy as np
import rasterio
import requests
from pyproj import CRS, Transformer
from rasterio.enums import Resampling
from rasterio.windows import Window
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

if __package__:
    from .arcadia_pingo_experiment import CACHE, RES_M, SITES, detect_mounds, read_pingo_inventory, fetch as fetch_earth
else:
    from arcadia_pingo_experiment import CACHE, RES_M, SITES, detect_mounds, read_pingo_inventory, fetch as fetch_earth

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs/matched_scale_pingo.json"
DEM_ROOT = ("https://asc-pds-individual-investigations.s3.us-west-2.amazonaws.com/"
            "mars_mro_hirise_explorationzones_day_2023/data/")
MARS_URL = DEM_ROOT + "esp_052490_2200_esp_052424_2200_tied-dem.tif"
AP8_URL = DEM_ROOT + "esp_042930_2210_esp_043220_2210_tied-dem.tif"
MARS_MAP = CACHE / "vector/map-AP1.gpkg"
MARS_CENTER = (39.916, 202.105)  # lat, east lon; mapped mounds nearby
AP8_CENTER = (40.744, 201.2786)  # center window has no mapped pingo-like polygon
WINDOW_M = 2_000
SIZE = WINDOW_M // RES_M
MARS_CACHE = CACHE / "ap1_2m_2km.npz"
AP8_CACHE = CACHE / "ap8_2m_2km.npz"
MARS_GEO = CRS.from_proj4("+proj=longlat +a=3396190 +b=3396190 +no_defs")


def fetch():
    CACHE.mkdir(parents=True, exist_ok=True)
    if not MARS_MAP.exists() or not (CACHE / "vector/map-AP8.gpkg").exists():
        archive = CACHE / "Geomorphic-maps.zip"
        if not archive.exists():
            response = requests.get("https://zenodo.org/records/13647425/files/Geomorphic-maps.zip?download=1",
                                    timeout=120)
            response.raise_for_status()
            archive.write_bytes(response.content)
        with ZipFile(archive) as source:
            for name in ("vector/map-AP1.gpkg", "vector/map-AP8.gpkg"):
                path = CACHE / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(source.read(name))
    if any(not (CACHE / f"{site}_2m_4km.npz").exists()
           for site in ("tuktoyaktuk", "prairie_nearby")) or not (CACHE / "pingo_inventory.xlsx").exists():
        fetch_earth()
    for name, url, center, path in (("AP-1", MARS_URL, MARS_CENTER, MARS_CACHE),
                                    ("AP-8", AP8_URL, AP8_CENTER, AP8_CACHE)):
        if path.exists():
            print(f"Already cached: {path}")
            continue
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                          CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
            with rasterio.open(url) as ds:
                x, y = Transformer.from_crs(MARS_GEO, CRS.from_wkt(ds.crs.to_wkt()),
                                            always_xy=True, force_over=True).transform(
                                                center[1], center[0])
                row, col = ds.index(x, y)
                source_size = round(WINDOW_M / ds.res[0])
                window = Window(col - source_size // 2, row - source_size // 2,
                                source_size, source_size)
                if window.col_off < 0 or window.row_off < 0 or (window.col_off + window.width > ds.width
                        or window.row_off + window.height > ds.height):
                    raise ValueError(f"{name} window lies outside the stereo DEM")
                z = ds.read(1, window=window, out_shape=(SIZE, SIZE),
                            resampling=Resampling.bilinear, masked=True).astype(np.float32).filled(np.nan)
                t = ds.window_transform(window) * rasterio.Affine.scale(source_size / SIZE)
        valid = np.isfinite(z).mean()
        np.savez_compressed(path, z=z, transform=np.array(tuple(t)[:6]),
                            source_url=url, center=center)
        print(f"{name}: {z.shape}, {valid:.1%} valid; cached {path}")


def mapped_mars_centers():
    """Return the published AP-1 pingo-like polygons' bounding-box centers."""
    if not MARS_MAP.exists():
        raise FileNotFoundError(f"Missing {MARS_MAP}; fetch the published map archive first")
    with sqlite3.connect(MARS_MAP) as db:
        rows = db.execute("""SELECT f.fid,r.minx,r.maxx,r.miny,r.maxy
                             FROM final_map AS f JOIN rtree_final_map_geom AS r ON r.id=f.fid
                             WHERE f.Feature='Pingo-like'""").fetchall()
    return [{"id": str(fid), "lat": (y0+y1)/2, "lon_east": (x0+x1)/2 + 360,
             "mapped_bbox_deg": [x0, y0, x1, y1]} for fid, x0, x1, y0, y1 in rows]


def _fill_small_gaps(z):
    """Fill no-data for filtering; candidate selection excludes nearby gaps."""
    valid = np.isfinite(z)
    _, nearest = ndi.distance_transform_edt(~valid, return_indices=True)
    filled = z[tuple(nearest)]
    clearance = ndi.distance_transform_edt(valid)
    return filled, valid, clearance


def screen_local_peaks(z, min_height_m=3):
    """Sensitive relief screen; these peaks are not classified as pingos."""
    filled, _, clearance = _fill_small_gaps(z)
    tpi = ndi.gaussian_filter(filled, 10 / RES_M) - ndi.gaussian_filter(filled, 200 / RES_M)
    peaks = (tpi == ndi.maximum_filter(tpi, size=round(100 / RES_M) + 1)) & (tpi >= min_height_m)
    edge = round(350 / RES_M)
    peaks[:edge, :] = False
    peaks[-edge:, :] = False
    peaks[:, :edge] = False
    peaks[:, -edge:] = False
    peaks &= clearance >= 20 / RES_M
    ys, xs = np.where(peaks)
    ranked = sorted(zip(ys, xs), key=lambda p: -tpi[p])
    selected = []
    for row, col in ranked:
        if all(math.hypot(row - p["row"], col - p["col"]) * RES_M >= 150 for p in selected):
            selected.append({"row": int(row), "col": int(col),
                             "local_relief_m": round(float(tpi[row, col]), 2)})
    return selected


def match_points(candidates, mapped, radius_m=100):
    if not mapped:
        return {"mapped": 0, "matched": 0, "candidate_matches": 0}
    tree = cKDTree([(c["row"], c["col"]) for c in candidates]) if candidates else None
    hits = [tree.query([p["row"], p["col"]], distance_upper_bound=radius_m / RES_M)
            if tree else (math.inf, 0) for p in mapped]
    return {"mapped": len(mapped), "matched": sum(math.isfinite(d) for d, _ in hits),
            "candidate_matches": len({int(i) for d, i in hits if math.isfinite(d)}),
            "radius_m": radius_m}


def random_match_baseline(candidates, mapped_count, observed, valid, trials=2000):
    """Chance-match benchmark for random valid points in the search interior."""
    edge = round(350 / RES_M)
    eligible = np.zeros(valid.shape, dtype=bool)
    eligible[edge:-edge, edge:-edge] = valid[edge:-edge, edge:-edge]
    coords = np.column_stack(np.where(eligible))
    if mapped_count == 0 or not candidates or len(coords) == 0:
        return None
    rng = np.random.default_rng(2026)
    chosen = coords[rng.integers(0, len(coords), size=(trials, mapped_count))]
    tree = cKDTree([(c["row"], c["col"]) for c in candidates])
    distances, _ = tree.query(chosen.reshape(-1, 2), distance_upper_bound=100 / RES_M)
    counts = np.isfinite(distances).reshape(trials, mapped_count).sum(axis=1)
    return {"trials": trials, "random_mean_matches": round(float(counts.mean()), 2),
            "random_95th_percentile": float(np.percentile(counts, 95)),
            "fraction_random_at_least_observed": round(float(((counts >= observed).sum() + 1) / (trials + 1)), 3)}


def mapped_earth_centers(z):
    """Project the published Tuk inventory into the 4 km cached HRDEM grid."""
    inventory = read_pingo_inventory()
    if inventory is None:
        raise FileNotFoundError("Missing published Tuktoyaktuk inventory")
    from rasterio.warp import transform as project
    site = SITES["tuktoyaktuk"]
    cx, cy = project("EPSG:4326", "EPSG:3979", [site["lon"]], [site["lat"]])
    xs, ys = project("EPSG:4326", "EPSG:3979",
                     [p["lon"] for p in inventory], [p["lat"] for p in inventory])
    center = z.shape[0] // 2
    return [{"id": p["id"], "row": int(round(center + (cy[0] - y) / RES_M)),
             "col": int(round(center + (x - cx[0]) / RES_M))}
            for p, x, y in zip(inventory, xs, ys)]


def analyze():
    if not MARS_CACHE.exists() or not AP8_CACHE.exists():
        raise SystemExit("Run --fetch first")
    with np.load(MARS_CACHE) as data:
        mars = data["z"]
        transform = rasterio.Affine(*data["transform"])
    with np.load(AP8_CACHE) as data:
        ap8 = data["z"]
    result = {"mars_dem": MARS_URL, "mars_map": "https://doi.org/10.5281/zenodo.13647425",
              "mars_center": MARS_CENTER, "mars_control_dem": AP8_URL,
              "mars_control_center": AP8_CENTER, "window_m": WINDOW_M, "resolution_m": RES_M,
              "sites": {}, "earth_inventory_calibration": {}}
    mapped_mars = mapped_mars_centers()
    with sqlite3.connect(CACHE / "vector/map-AP8.gpkg") as db:
        result["ap8_map_pingo_polygons_total"] = db.execute(
            "SELECT count(*) FROM final_map WHERE Unit LIKE 'Pingo-like%'").fetchone()[0]
        result["ap8_map_pingo_polygons_near_window"] = db.execute(
            """SELECT count(*) FROM final_map AS f
               JOIN rtree_final_map_geom AS r ON r.id=f.fid
               WHERE f.Unit LIKE 'Pingo-like%'
               AND (r.minx+r.maxx)/2 BETWEEN ? AND ?
               AND (r.miny+r.maxy)/2 BETWEEN ? AND ?""",
            (AP8_CENTER[1] - 360 - 0.02, AP8_CENTER[1] - 360 + 0.02,
             AP8_CENTER[0] - 0.02, AP8_CENTER[0] + 0.02)).fetchone()[0]
    for name in ("ap1", "ap8", "tuktoyaktuk", "prairie_nearby"):
        if name == "ap1":
            z = mars
        elif name == "ap8":
            z = ap8
        else:
            path = CACHE / f"{name}_2m_4km.npz"
            if not path.exists():
                raise SystemExit(f"Missing {path}; run arcadia_pingo_experiment.py --fetch")
            with np.load(path) as data:
                full = data["z"]
            offset = (full.shape[0] - SIZE) // 2
            z = full[offset:offset+SIZE, offset:offset+SIZE]
        filled, valid, gap_clearance = _fill_small_gaps(z)
        candidates = detect_mounds(filled, res_m=RES_M)
        # An interpolated stereo gap can make a false mound. Require every
        # candidate footprint to be at least 20 m from original no-data.
        candidates = [c for c in candidates if gap_clearance[c["row"], c["col"]] >= 20 / RES_M]
        item = {"valid_fraction": round(float(valid.mean()), 4),
                "geometric_candidates": len(candidates),
                "in_mars_size_height_range": sum(c["mars_size_height_range"] for c in candidates),
                "candidates": candidates}
        screened = screen_local_peaks(z)
        item["relief_screen_candidates"] = screened
        edge = round(350 / RES_M)
        search_area_km2 = float(valid[edge:-edge, edge:-edge].sum() * RES_M**2 / 1e6)
        item["valid_search_area_km2"] = round(search_area_km2, 3)
        item["relief_peak_density_per_km2"] = round(len(screened) / search_area_km2, 2) if search_area_km2 else None
        if name == "ap1":
            mapped = []
            for m in mapped_mars:
                x, y = Transformer.from_crs(MARS_GEO, CRS.from_proj4(
                    "+proj=sinu +lon_0=-157.92 +a=3396190 +b=3396190 +units=m +no_defs"),
                    always_xy=True, force_over=True).transform(m["lon_east"], m["lat"])
                row, col = map(int, rasterio.transform.rowcol(transform, x, y))
                if 350 / RES_M <= row < SIZE - 350 / RES_M and 350 / RES_M <= col < SIZE - 350 / RES_M:
                    mapped.append({"id": m["id"], "row": row, "col": col,
                                   "valid_at_center": bool(valid[row, col]),
                                   "clearance_m": round(float(gap_clearance[row, col] * RES_M), 1)})
            item["mapped_pingos_interior"] = mapped
            item["mapped_pingo_matches"] = match_points(screened, mapped)
            item["random_match_baseline"] = random_match_baseline(
                screened, len(mapped), item["mapped_pingo_matches"]["matched"], valid)
        if name == "tuktoyaktuk":
            mapped = [{"id": p["id"], "row": p["row"] - offset, "col": p["col"] - offset}
                      for p in mapped_earth_centers(full)]
            mapped = [p for p in mapped if 350 / RES_M <= p["row"] < SIZE - 350 / RES_M
                      and 350 / RES_M <= p["col"] < SIZE - 350 / RES_M]
            item["mapped_pingos_interior"] = mapped
            item["mapped_pingo_matches"] = match_points(screened, mapped)
            item["random_match_baseline"] = random_match_baseline(
                screened, len(mapped), item["mapped_pingo_matches"]["matched"], valid)
        result["sites"][name] = item
        print(name, item["valid_fraction"], item["geometric_candidates"], item["in_mars_size_height_range"],
              "relief peaks", len(screened), "mapped", len(item.get("mapped_pingos_interior", [])))
    tuk = np.load(CACHE / "tuktoyaktuk_2m_4km.npz")["z"]
    prairie = np.load(CACHE / "prairie_nearby_2m_4km.npz")["z"]
    border = round(350 / RES_M)
    mapped_earth = [p for p in mapped_earth_centers(tuk)
                    if border <= p["row"] < tuk.shape[0] - border
                    and border <= p["col"] < tuk.shape[1] - border]
    all_tuk_peaks = screen_local_peaks(tuk, 1.5)
    all_prairie_peaks = screen_local_peaks(prairie, 1.5)
    for threshold in (1.5, 2, 3, 4):
        found = [p for p in all_tuk_peaks if p["local_relief_m"] >= threshold]
        control = [p for p in all_prairie_peaks if p["local_relief_m"] >= threshold]
        result["earth_inventory_calibration"][str(threshold)] = {
            "tuk_screened": len(found), "prairie_screened": len(control),
            "tuk_mapped_match": match_points(found, mapped_earth),
        }
        result["earth_inventory_calibration"][str(threshold)]["random_match_baseline"] = (
            random_match_baseline(found, len(mapped_earth),
                                  result["earth_inventory_calibration"][str(threshold)]["tuk_mapped_match"]["matched"],
                                  np.isfinite(tuk)))
    OUT.write_text(json.dumps(result, indent=2))
    print(f"Wrote {OUT}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--fetch", action="store_true")
    p.add_argument("--analyze", action="store_true")
    args = p.parse_args()
    if not (args.fetch or args.analyze):
        p.error("choose --fetch or --analyze")
    if args.fetch:
        fetch()
    if args.analyze:
        analyze()


if __name__ == "__main__":
    main()
