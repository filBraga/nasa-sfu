"""Download a DEM window for every site in config/sites.json into data/raw/<id>.npz.

Usage:
    python scripts/fetch_dems.py            # all sites (skips ones already cached)
    python scripts/fetch_dems.py jezero     # only some sites
    python scripts/fetch_dems.py --force    # re-download
"""

import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from analog import RAW_DIR, load_config  # noqa: E402
from analog.sources import fetch_site  # noqa: E402


def main(argv):
    force = "--force" in argv
    wanted = [a for a in argv if not a.startswith("--")]
    cfg = load_config()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    failed = []
    for site in cfg["sites"]:
        selected_body = next((a.split("=", 1)[1] for a in argv if a.startswith("--body=")), None)
        if selected_body and site["body"] != selected_body:
            continue
        if wanted and site["id"] not in wanted:
            continue
        out = RAW_DIR / f"{site['id']}.npz"
        if out.exists() and not force:
            with np.load(out) as cached:
                resolution = float(cached["res"])
                n = round(site["window_km"] * 1000 / resolution)
                current = (cached["z"].shape == (n, n)
                           and abs(float(cached["lat"]) - site["lat"]) < 1e-6
                           and abs(float(cached["lon"]) - site["lon"]) < 1e-6
                           and abs(float(site.get("fetch_res_m", resolution)) - resolution) < 1e-6)
            if current:
                print(f"[skip] {site['id']} (cached)")
                continue
            print(f"[refresh] {site['id']} (window, coordinates or resolution changed)")
        print(f"[fetch] {site['id']} - {site['name']} ({site['body']})")
        t = time.time()
        try:
            z, res, crs = fetch_site(site)
        except Exception as exc:  # keep going so one bad source doesn't block the rest
            print(f"    FAILED: {exc}")
            failed.append(site["id"])
            continue
        np.savez_compressed(out, z=z, res=res, crs=crs.to_proj4() or crs.to_wkt(),
                            lat=site["lat"], lon=site["lon"], body=site["body"])
        valid = np.isfinite(z)
        print(f"    {z.shape[0]}x{z.shape[1]} px @ {res:.0f} m, "
              f"elev {np.nanmin(z):.0f}..{np.nanmax(z):.0f} m, "
              f"{valid.mean():.1%} valid, {time.time() - t:.0f}s")
    if failed:
        print("Failed sites:", ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
