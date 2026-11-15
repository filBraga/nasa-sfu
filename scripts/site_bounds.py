"""Print the area each data team must export for every site (with a 10% margin).

Usage:
    python scripts/site_bounds.py            # table
    python scripts/site_bounds.py --json     # machine-readable, for export scripts
    python scripts/site_bounds.py --body earth
"""

import json
import sys
from pathlib import Path

from rasterio.crs import CRS
from rasterio.warp import transform_bounds

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from analog import load_config  # noqa: E402
from analog.sources import local_crs  # noqa: E402

DELIVERY = {
    "earth": ("EPSG:4326", CRS.from_string("EPSG:4326")),
    "mars": ("IAU_2015:49900", CRS.from_string("IAU_2015:49900")),
    "moon": ("IAU_2015:30100", CRS.from_string("IAU_2015:30100")),
}
MOON_POLAR = CRS.from_proj4("+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs")
MARGIN = 1.1


def bounds_for(site):
    half = site["window_km"] * 1000 * MARGIN / 2
    local = local_crs(site["body"], site["lat"], site["lon"])
    code, geo = DELIVERY[site["body"]]
    out = {"id": site["id"], "body": site["body"], "crs": code}
    if site["body"] == "moon" and site["lat"] < -80:
        # lon/lat boxes are meaningless at the pole: give the polar-stereographic box instead
        x0, y0, x1, y1 = transform_bounds(local, MOON_POLAR, -half, -half, half, half, densify_pts=41)
        out.update(crs="polar stereographic, +proj=stere +lat_0=-90 +lon_0=0 +R=1737400",
                   polar_bounds_m=[round(v) for v in (x0, y0, x1, y1)],
                   lat_range=[-90, round(site["lat"] + site["window_km"] * MARGIN / 2 / 30.3, 2)])
    else:
        w, s, e, n = transform_bounds(local, geo, -half, -half, half, half, densify_pts=41)
        out["lonlat_bounds"] = [round(v, 4) for v in (w, s, e, n)]
    return out


def main(argv):
    sites = load_config()["sites"]
    if "--body" in argv:
        body = argv[argv.index("--body") + 1]
        sites = [s for s in sites if s["body"] == body]
    rows = [bounds_for(s) for s in sites]
    if "--json" in argv:
        print(json.dumps(rows, indent=1))
        return
    for r in rows:
        box = r.get("lonlat_bounds")
        where = (f"lon {box[0]}..{box[2]}, lat {box[1]}..{box[3]}" if box else
                 f"polar x/y {r['polar_bounds_m']} m, lat {r['lat_range'][0]}..{r['lat_range'][1]}")
        print(f"{r['id']:<20} {r['body']:<6} {where}\n{'':<27}CRS: {r['crs']}  ->  data/layers/<layer_id>/{r['id']}.tif")


if __name__ == "__main__":
    main(sys.argv[1:])
