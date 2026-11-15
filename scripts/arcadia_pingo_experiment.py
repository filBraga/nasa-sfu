"""Small, reproducible landform-scale comparison for Arcadia and two Earth sites.

The Mars reference is the published AP-1/AP-9 pingo-like landform inventory
(Luzzi et al., 2025, doi:10.1029/2024JE008724). It is *not* a measurement of
buried ice at our broad Arcadia grid point. Earth DEM windows come from NRCan's
2 m HRDEM mosaic; they are cached under data/external/arcadia_pingo/.

Usage:
    python scripts/arcadia_pingo_experiment.py --fetch
    python scripts/arcadia_pingo_experiment.py --analyze
"""

import argparse
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import numpy as np
import rasterio
import requests
from rasterio.warp import transform
from rasterio.windows import Window
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data/external/arcadia_pingo"
WINDOW_M = 4_000
RES_M = 2
MARS_REFERENCE = {
    "source": "https://doi.org/10.1029/2024JE008724",
    "region": "AP-1 and AP-9, near Arcadia Planitia (not the broad Arcadia site in config/sites.json)",
    "feature": "pingo-like mounds; interpretation unconfirmed without ground truth",
    "diameter_m": [117, 440],
    "height_m": [4, 10],
}
PINGO_INVENTORY = {
    "source": "https://doi.org/10.17632/kgbsjvrj32.1",
    "download": "https://data.mendeley.com/public-files/datasets/kgbsjvrj32/files/036c430b-c16c-4f47-9acd-b850927be788/file_downloaded",
}
SITES = {
    "tuktoyaktuk": {
        "lat": 69.399971, "lon": -133.0777525,  # NRCan Ibyuk Pingo name record LAKZW
        "url": "https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-2m/3_8-mosaic-2m-dtm.tif",
    },
    "prairie_nearby": {
        "lat": 50.35, "lon": -105.3,  # 11 km south of the control; that point lacks 2 m coverage
        "url": "https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-2m/4_3-mosaic-2m-dtm.tif",
    },
}


def fetch():
    CACHE.mkdir(parents=True, exist_ok=True)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        for site_id, site in SITES.items():
            path = CACHE / f"{site_id}_2m_4km.npz"
            if path.exists():
                print(f"Already cached: {path}")
                continue
            with rasterio.open(site["url"]) as ds:
                if ds.res != (RES_M, RES_M):
                    raise ValueError(f"Unexpected DEM pixel size for {site_id}: {ds.res}")
                x, y = transform("EPSG:4326", ds.crs, [site["lon"]], [site["lat"]])
                row, col = ds.index(x[0], y[0])
                size = WINDOW_M // RES_M
                window = Window(col - size // 2, row - size // 2, size, size)
                z = ds.read(1, window=window, masked=True).astype(np.float32).filled(np.nan)
            valid = np.isfinite(z).mean()
            if valid < 0.5:
                raise ValueError(f"Only {valid:.1%} valid elevation pixels at {site_id}")
            np.savez_compressed(path, z=z, res_m=RES_M, lat=site["lat"], lon=site["lon"],
                                source_url=site["url"])
            print(f"Cached {site_id}: {z.shape}, {valid:.1%} valid, "
                  f"{np.nanmin(z):.1f} to {np.nanmax(z):.1f} m: {path}")
    inventory_path = CACHE / "pingo_inventory.xlsx"
    if not inventory_path.exists():
        response = requests.get(PINGO_INVENTORY["download"], timeout=90)
        response.raise_for_status()
        inventory_path.write_bytes(response.content)
        with ZipFile(inventory_path) as workbook:
            if "xl/worksheets/sheet1.xml" not in workbook.namelist():
                raise ValueError("Downloaded pingo inventory is not the expected workbook")
        print(f"Cached published pingo inventory: {inventory_path}")


def detect_mounds(z, res_m=RES_M, min_height_m=3, min_circularity=0.45, tpi=None):
    """Find round, local positive-relief mounds at the paper's landform scale.

    A 10 m smoothing suppresses pixel noise; a 200 m background gives a local
    prominence. The half-prominence blob supplies an equivalent diameter and
    circularity. These are geometric candidates, not confirmed ice-cored pingos.
    """
    if not np.isfinite(z).all():
        raise ValueError("Mound detector needs a complete local elevation window")
    if tpi is None:
        smooth = ndi.gaussian_filter(z, 10 / res_m)
        background = ndi.gaussian_filter(z, 200 / res_m)
        tpi = smooth - background
    # Search well inside the window so a whole landform is available.
    border = round(350 / res_m)
    peaks = (tpi == ndi.maximum_filter(tpi, size=round(150 / res_m) * 2 + 1)) & (tpi >= min_height_m)
    peaks[:border, :] = False
    peaks[-border:, :] = False
    peaks[:, :border] = False
    peaks[:, -border:] = False
    peak_labels, count = ndi.label(peaks)
    out = []
    radius_px = round(350 / res_m)
    for label in range(1, count + 1):
        yy, xx = np.where(peak_labels == label)
        y, x = int(yy[0]), int(xx[0])
        height = float(tpi[y, x])
        patch = tpi[y - radius_px:y + radius_px + 1, x - radius_px:x + radius_px + 1]
        half = patch >= height / 2
        blobs, _ = ndi.label(half)
        center = radius_px
        blob = blobs == blobs[center, center]
        if not blob.any() or blob[0].any() or blob[-1].any() or blob[:, 0].any() or blob[:, -1].any():
            continue
        area_m2 = int(blob.sum()) * res_m**2
        diameter = 2 * math.sqrt(area_m2 / math.pi)
        # Count exposed pixel edges; this avoids a misleading perfect circle
        # score caused by counting one boundary pixel as one unit of length.
        perimeter = max(float(np.count_nonzero(blob[:, 1:] != blob[:, :-1])
                              + np.count_nonzero(blob[1:, :] != blob[:-1, :])) * res_m, 1)
        circularity = min(1.0, 4 * math.pi * area_m2 / perimeter**2)
        if 60 <= diameter <= 700 and circularity >= min_circularity:
            out.append({"row": y, "col": x, "height_m": round(height, 2),
                        "diameter_m": round(diameter, 1), "circularity": round(circularity, 2),
                        "mars_size_height_range": 117 <= diameter <= 440 and 4 <= height <= 10})
    return sorted(out, key=lambda p: -p["height_m"])


def read_pingo_inventory():
    """Read the authors' published spreadsheet without an Excel dependency."""
    path = CACHE / "pingo_inventory.xlsx"
    if not path.exists():
        return None
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with ZipFile(path) as workbook:
        shared = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
        strings = ["".join(t.text or "" for t in item.findall(".//m:t", ns)) for item in shared]
        sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
    records = []
    for row in sheet.findall(".//m:sheetData/m:row", ns)[1:]:
        cells = {}
        for cell in row.findall("m:c", ns):
            value = cell.find("m:v", ns)
            if value is not None:
                cells["".join(c for c in cell.attrib["r"] if c.isalpha())] = (
                    strings[int(value.text)] if cell.attrib.get("t") == "s" else value.text)
        if cells.get("C") and cells.get("D"):
            records.append({"id": cells.get("B"), "lat": float(cells["C"]), "lon": float(cells["D"]),
                            "state": cells.get("N"),
                            "height_m": float(cells["AG"]) if cells.get("AG") else None,
                            "diameter_m": 2 * math.sqrt(float(cells["AI"]) / math.pi)
                            if cells.get("AI") else None})
    return records


def validate_against_inventory(candidates, site, inventory, res_m=RES_M):
    """Match DEM peaks to mapped pingo summits within 100 m (position tolerance)."""
    if not inventory:
        return None
    cx, cy = transform("EPSG:4326", "EPSG:3979", [site["lon"]], [site["lat"]])
    xs, ys = transform("EPSG:4326", "EPSG:3979",
                       [p["lon"] for p in inventory], [p["lat"] for p in inventory])
    center = WINDOW_M / res_m / 2
    points = [(center + (x - cx[0]) / res_m, center + (cy[0] - y) / res_m)
              for x, y in zip(xs, ys)]
    border = 350 / res_m
    mapped = [(p, record) for p, record in zip(points, inventory)
              if border <= p[0] < 2 * center - border and border <= p[1] < 2 * center - border]
    if not mapped:
        return {"mapped_pingos": 0, "matched_pingos": 0, "matched_candidates": 0}
    tree = cKDTree([(c["col"], c["row"]) for c in candidates]) if candidates else None
    hits = [tree.query(p, distance_upper_bound=100 / res_m) if tree else (math.inf, 0)
            for p, _ in mapped]
    matched = [index for distance, index in hits if math.isfinite(distance)]
    matched_mars_range = [record["id"] for (p, record), (distance, _) in zip(mapped, hits)
                          if math.isfinite(distance) and record["height_m"] is not None
                          and record["diameter_m"] is not None
                          and 4 <= record["height_m"] <= 10 and 117 <= record["diameter_m"] <= 440]
    eligible = [record["id"] for _, record in mapped if record["height_m"] is not None
                and record["diameter_m"] is not None and 4 <= record["height_m"] <= 10
                and 117 <= record["diameter_m"] <= 440]
    return {"mapped_pingos": len(mapped), "matched_pingos": len(matched),
            "matched_candidates": len(set(matched)), "match_radius_m": 100,
            "published_mars_range_pingos": len(eligible), "matched_mars_range_pingos": len(matched_mars_range),
            "mapped_details": [{"id": r["id"], "height_m": r["height_m"],
                                "diameter_m": round(r["diameter_m"], 1) if r["diameter_m"] else None,
                                "nearest_candidate_m": round(float(hit[0]) * res_m, 1) if math.isfinite(hit[0]) else None}
                               for (_, r), hit in zip(mapped, hits)],
            "inventory_source": PINGO_INVENTORY["source"]}


def analyze():
    result = {"method": "10 m Gaussian smoothing minus 200 m background; local peaks and half-height blobs",
              "parameters": {"min_height_m": 3, "min_circularity": 0.45,
                             "diameter_m": [60, 700], "peak_separation_m": 150},
              "mars_reference": MARS_REFERENCE, "earth_windows": {}, "sensitivity": {}}
    inventory = read_pingo_inventory()
    if inventory is None:
        raise SystemExit("Missing published pingo inventory; run --fetch first")
    for site_id in SITES:
        path = CACHE / f"{site_id}_2m_4km.npz"
        if not path.exists():
            raise SystemExit(f"Missing {path}; run --fetch first")
        with np.load(path) as data:
            z = data["z"]
            res_m = float(data["res_m"])
        tpi = ndi.gaussian_filter(z, 10 / res_m) - ndi.gaussian_filter(z, 200 / res_m)
        candidates = detect_mounds(z, res_m, tpi=tpi)
        result["earth_windows"][site_id] = {
            "center": [SITES[site_id]["lat"], SITES[site_id]["lon"]],
            "dem_source": SITES[site_id]["url"],
            "resolution_m": res_m, "window_km": WINDOW_M / 1000,
            "relief_m": round(float(z.max() - z.min()), 2),
            "geometric_candidates": len(candidates),
            "in_published_mars_range": sum(c["mars_size_height_range"] for c in candidates),
            "candidates": candidates,
        }
        if site_id == "tuktoyaktuk" and inventory:
            result["earth_windows"][site_id]["inventory_check"] = validate_against_inventory(
                candidates, SITES[site_id], inventory, res_m)
        print(f"{site_id}: {len(candidates)} round mound candidates; "
              f"{result['earth_windows'][site_id]['in_published_mars_range']} "
              "in the paper's Mars size and height range")
        for candidate in candidates[:8]:
            print(" ", candidate)
        if site_id == "tuktoyaktuk" and inventory:
            print("  Published inventory:", result["earth_windows"][site_id]["inventory_check"])
        result["sensitivity"][site_id] = []
        for min_height in (3, 4):
            for min_circle in (0.35, 0.45, 0.55):
                found = detect_mounds(z, res_m, min_height, min_circle, tpi=tpi)
                check = validate_against_inventory(found, SITES[site_id], inventory, res_m) if site_id == "tuktoyaktuk" else None
                result["sensitivity"][site_id].append({
                    "min_height_m": min_height, "min_circularity": min_circle,
                    "candidates": len(found),
                    "in_published_mars_range": sum(c["mars_size_height_range"] for c in found),
                    "mapped_pingos_recovered": check["matched_pingos"] if check else None,
                })
    output = ROOT / "docs/arcadia_pingo_experiment.json"
    output.write_text(json.dumps(result, indent=2))
    print(f"Wrote {output}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--fetch", action="store_true", help="cache both public 2 m DEM windows")
    p.add_argument("--analyze", action="store_true", help="compare local mound candidates")
    args = p.parse_args()
    if args.fetch:
        fetch()
    if args.analyze:
        analyze()
    if not args.fetch and not args.analyze:
        p.error("choose --fetch or --analyze")


if __name__ == "__main__":
    main()
