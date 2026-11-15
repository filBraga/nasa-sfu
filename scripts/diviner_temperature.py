"""Moon day-night temperature swing from LRO Diviner (real measurements) for every Moon target.

Source: Diviner Lunar Radiometer, south polar 240 m bolometric temperature tables binned by
subsolar longitude (Williams et al. 2019, JGR 124, 2505-2521), LRO-L-DLRE-5-GCP-V1.0,
https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_polar/pds/

For each 240 m pixel we take max(T) - min(T) across sun positions sampled over a lunar day
in southern summer, i.e. the full lunar day-night swing. Only the strips of each ~200 MB table
that cover our sites are downloaded (rows are sorted by x, so we binary-search them with HTTP
Range requests). Output: data/layers/thermal_amplitude/<moon_site>.tif (polar stereographic).

Usage: python scripts/diviner_temperature.py [--every 8] [--season summer] [--half-km 20]
"""

import argparse
import io
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from analog import load_config  # noqa: E402
from analog.facts import write_fact  # noqa: E402
from analog.layers import LAYER_DIR  # noqa: E402
from analog.sources import local_crs  # noqa: E402

BASE = "https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_polar/pds"
R = 1737400.0
ROW = 58            # bytes per record incl. "\n" (the label says 59, i.e. assumes CRLF; detected per file below)
CELL = 240.0        # metres
STERE = CRS.from_proj4(f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={R} +units=m +no_defs")


def url_for(season, i):
    s = {"summer": "SUM", "winter": "WIN"}[season]
    return f"{BASE}/polar_south_80_{season}_sunlon/PCP_AVG_TBOL_POLS_{s}_SLON{i:02d}_240.TAB"


def get(url, start, end):
    """Byte range via the system curl. The UCLA server's TLS setup (old DH key, incomplete
    certificate chain) is rejected by Python's OpenSSL but accepted by Windows' TLS (curl/schannel);
    certificate verification stays on."""
    for attempt in range(4):
        try:  # hard timeout: a stalled transfer is killed and retried instead of hanging forever
            p = subprocess.run(["curl", "-sS", "--fail", "-m", "300", "--speed-limit", "20000", "--speed-time", "30",
                                "-r", f"{start}-{end}", url], capture_output=True, timeout=360)
        except subprocess.TimeoutExpired:
            p = subprocess.CompletedProcess([], 1, b"", b"timed out")
        if p.returncode == 0 and len(p.stdout) == end - start + 1:
            return p.stdout
        if attempt == 3:
            raise RuntimeError(f"curl failed for {url} [{start}-{end}]: {p.stderr.decode(errors='replace').strip()}")
        time.sleep(2 * (attempt + 1))


def content_length(url):
    p = subprocess.run(["curl", "-sSI", "--fail", "-m", "60", url], capture_output=True, text=True)
    for line in p.stdout.splitlines():
        if line.lower().startswith("content-length:"):
            return int(line.split(":")[1])
    raise RuntimeError(f"no Content-Length for {url}: {p.stderr.strip()}")


def record_length(url):
    """Fixed record length from the file itself: distance between the first newlines."""
    head = get(url, 0, 400)
    nl = [i for i, ch in enumerate(head) if ch == 10][:3]
    lens = {nl[0] + 1, nl[1] - nl[0], nl[2] - nl[1]}
    if len(lens) != 1:
        raise RuntimeError(f"records are not fixed-length in {url}: {sorted(lens)}")
    return lens.pop()


def row_x(url, i, rec):
    """x (normalised by R) of data row i (0-based, after the header record)."""
    off = rec * (i + 1)
    return float(get(url, off, off + rec - 1).split(b",")[0])


def first_row_at_least(url, nrows, x, rec):
    lo, hi = 0, nrows
    while lo < hi:
        mid = (lo + hi) // 2
        if row_x(url, mid, rec) < x:
            lo = mid + 1
        else:
            hi = mid
    return lo


def site_box(site, half_km):
    """Site box in polar-stereographic metres (limited to +-half_km around the centre)."""
    half = min(site["window_km"] / 2, half_km) * 1000
    return transform_bounds(local_crs("moon", site["lat"], site["lon"]), STERE, -half, -half, half, half, densify_pts=41)


def merge_intervals(iv, gap=5000):
    iv = sorted(iv)
    out = [list(iv[0])]
    for a, b in iv[1:]:
        if a <= out[-1][1] + gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def process_file(url, stripes, boxes):
    size = content_length(url)
    rec = record_length(url)
    if size % rec:
        raise RuntimeError(f"{url}: size {size} is not a multiple of the record length {rec}")
    nrows = size // rec - 1
    got = {sid: [] for sid in boxes}
    nbytes = 0
    for x0, x1 in stripes:
        a = first_row_at_least(url, nrows, x0 / R, rec)
        b = first_row_at_least(url, nrows, x1 / R, rec)
        if b <= a:
            continue
        raw = get(url, rec * (a + 1), rec * (b + 1) - 1)
        nbytes += len(raw)
        t = np.loadtxt(io.BytesIO(raw), delimiter=",")
        x, y, tb = t[:, 0] * R, t[:, 1] * R, t[:, 4]
        for sid, (bx0, by0, bx1, by1) in boxes.items():
            m = (x >= bx0) & (x <= bx1) & (y >= by0) & (y <= by1)
            if m.any():
                got[sid].append(np.column_stack([x[m], y[m], tb[m]]))
    return got, nbytes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--every", type=int, default=8, help="use every Nth of the 96 sun-position bins (8 -> 12 samples)")
    ap.add_argument("--season", default="summer", choices=["summer", "winter"])
    ap.add_argument("--half-km", type=float, default=20, help="half-size of the box extracted around each site")
    ap.add_argument("--min-samples", type=float, default=0.5, help="fraction of bins a pixel needs to get a value")
    args = ap.parse_args()

    sites = [s for s in load_config()["sites"] if s["body"] == "moon" and s["lat"] <= -80]
    boxes = {s["id"]: site_box(s, args.half_km) for s in sites}
    stripes = merge_intervals([(b[0], b[2]) for b in boxes.values()])
    bins = list(range(1, 97, args.every))
    print(f"Moon sites: {', '.join(boxes)}; {len(stripes)} strip(s); {len(bins)} sun positions ({args.season})")

    acc = {sid: {} for sid in boxes}  # (ix, iy) -> [min, max, count]
    total, t0 = 0, time.time()
    with ThreadPoolExecutor(6) as ex:
        futures = {i: ex.submit(process_file, url_for(args.season, i), stripes, boxes) for i in bins}
        for n, (i, fut) in enumerate(futures.items(), 1):
            got, nb = fut.result()
            total += nb
            for sid, parts in got.items():
                if not parts:
                    continue
                arr = np.concatenate(parts)
                ix = np.round(arr[:, 0] / CELL).astype(np.int64)
                iy = np.round(arr[:, 1] / CELL).astype(np.int64)
                a = acc[sid]
                for k1, k2, tv in zip(ix.tolist(), iy.tolist(), arr[:, 2].tolist()):
                    cur = a.get((k1, k2))
                    if cur is None:
                        a[(k1, k2)] = [tv, tv, 1]
                    else:
                        cur[0] = min(cur[0], tv); cur[1] = max(cur[1], tv); cur[2] += 1
            print(f"  bin {i:02d} done ({n}/{len(bins)}), {total / 1e6:.0f} MB so far, {time.time() - t0:.0f}s")

    out_dir = LAYER_DIR / "thermal_amplitude"
    out_dir.mkdir(parents=True, exist_ok=True)
    need = max(2, int(np.ceil(args.min_samples * len(bins))))
    for sid, a in acc.items():
        if not a:
            print(f"[skip] {sid}: no Diviner pixels found")
            continue
        keys = np.array(list(a.keys()))
        vals = np.array(list(a.values()))
        ix0, iy0 = keys[:, 0].min(), keys[:, 1].min()
        w, h = keys[:, 0].max() - ix0 + 1, keys[:, 1].max() - iy0 + 1
        grid = np.full((h, w), np.nan, np.float32)
        ok = vals[:, 2] >= need
        rows = (keys[:, 1].max() - keys[:, 1])[ok]
        cols = (keys[:, 0] - ix0)[ok]
        grid[rows, cols] = (vals[ok, 1] - vals[ok, 0]).astype(np.float32)
        transform = from_origin((ix0 - 0.5) * CELL, (keys[:, 1].max() + 0.5) * CELL, CELL, CELL)
        path = out_dir / f"{sid}.tif"
        with rasterio.open(path, "w", driver="GTiff", width=w, height=h, count=1, dtype="float32",
                           crs=STERE, transform=transform, nodata=np.nan, compress="deflate") as ds:
            ds.write(grid, 1)
            ds.update_tags(source="LRO Diviner PCP 240 m south polar, " + args.season + f", {len(bins)} sun positions",
                           quantity="max(T) - min(T) over a lunar day, K")
        write_fact("temperature", sid, dataset="diviner",
                   low_k=round(float(np.median(vals[ok, 0])), 1), high_k=round(float(np.median(vals[ok, 1])), 1),
                   what=f"typical coldest and hottest surface temperature over a lunar day, southern {args.season}")
        v = grid[np.isfinite(grid)]
        print(f"[ok] {path.relative_to(ROOT)}  {w}x{h} px, {v.size} valid, swing median {np.median(v):.0f} K "
              f"(min {v.min():.0f}, max {v.max():.0f})")


if __name__ == "__main__":
    main()
