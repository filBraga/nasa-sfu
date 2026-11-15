"""Export Google Earth Engine layers for every Earth site into data/layers/<layer>/<site>.tif.

One-time setup (needs a Google account and a Google Cloud project registered for Earth Engine):
    source .venv/Scripts/activate
    earthengine authenticate            # opens a browser to log in

Usage:
    python scripts/gee_export.py --project YOUR_GCP_PROJECT --facts --force      # full year (default)
    python scripts/gee_export.py --project YOUR_GCP_PROJECT --season summer      # old June-August version
    python scripts/gee_export.py --project YOUR_GCP_PROJECT --layers barren_ground --year 2022
    python scripts/gee_export.py --project YOUR_GCP_PROJECT --sites haughton,mistastin --force
Then: python scripts/analyze.py

--season year (default) uses the whole calendar year, so long Arctic winters count: snow lowers the
plant signal and the cold months lower the typical temperature. --season summer uses June-August.

Layers (Earth side only; Moon and Mars data come from the PDS team):
    thermal_amplitude  MODIS/061/MOD11A2  mean (LST_Day_1km - LST_Night_1km) * 0.02 K
    barren_ground      MODIS/061/MOD13A2  year: mean NDVI * 0.0001 (snow months count as not green)
                                          summer: max NDVI * 0.0001, June-August (peak greenness)
    surface_dust       OpenLandMap sand + barren_ground: fine topsoil on barren ground
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import rasterio
import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
from analog import load_config  # noqa: E402
from analog.facts import write_fact  # noqa: E402
from analog.layers import LAYER_DIR  # noqa: E402
from site_bounds import bounds_for  # noqa: E402

NODATA = -9999.0


PERIOD_TEXT = {"year": "full year {year}", "summer": "June-August {year}"}


def period(collection, year, season):
    """The image collection over the chosen period: the whole calendar year or June-August."""
    import ee
    if season == "summer":
        return ee.ImageCollection(collection).filterDate(f"{year}-06-01", f"{year}-09-01")
    return ee.ImageCollection(collection).filterDate(f"{year}-01-01", f"{year + 1}-01-01")


def thermal_amplitude(year, season):
    """Day minus night land surface temperature (K), averaged over the period."""
    def swing(img):
        return img.select("LST_Day_1km").subtract(img.select("LST_Night_1km")).multiply(0.02).rename("v")
    return period("MODIS/061/MOD11A2", year, season).map(swing).mean()


def barren_ground(year, season):
    """NDVI; the pipeline turns it into 'share of area below 0.2'.
    year: mean over all 16-day composites, so months under snow (NDVI near 0) pull it down.
    summer: peak greenness (max) in June-August."""
    ndvi = period("MODIS/061/MOD13A2", year, season).select("NDVI")
    ndvi = ndvi.map(lambda img: img.updateMask(img.gte(-2000)))  # drop fill values (-3000)
    composite = ndvi.max() if season == "summer" else ndvi.mean()
    return composite.multiply(0.0001).rename("v")


def surface_dust(year, season):
    """Exposed fine soil: topsoil fine fraction (100 - sand %) on barren ground, 0 where vegetated."""
    import ee
    sand = ee.Image("OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02").select("b0")
    fine = ee.Image(100).subtract(sand)
    vegetated = barren_ground(year, season).gte(0.2)
    return fine.where(vegetated, 0).rename("v")


LAYERS = {  # layer id -> (image builder, native scale in metres, Earth Engine dataset)
    "thermal_amplitude": (thermal_amplitude, 1000, "MODIS/061/MOD11A2"),
    "barren_ground": (barren_ground, 1000, "MODIS/061/MOD13A2"),
    "surface_dust": (surface_dust, 250, "OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02 + MOD13A2"),
}


def temperature_facts(ee, site, year, season):
    """Typical night and day land surface temperature (K) over the site, computed by Earth Engine."""
    w, s, e, n = bounds_for(site)["lonlat_bounds"]
    region = ee.Geometry.Rectangle([w, s, e, n], proj="EPSG:4326", geodesic=False)
    lst = period("MODIS/061/MOD11A2", year, season).select(["LST_Day_1km", "LST_Night_1km"]).mean().multiply(0.02)
    stats = lst.reduceRegion(reducer=ee.Reducer.median(), geometry=region, scale=1000, maxPixels=1e8).getInfo()
    day, night = stats.get("LST_Day_1km"), stats.get("LST_Night_1km")
    if day is None or night is None:
        return None
    when = PERIOD_TEXT[season].format(year=year)
    return write_fact("temperature", site["id"], dataset="modis_lst", low_k=round(night, 1), high_k=round(day, 1),
                      what=f"typical ({when}) night (~22:30) and day (~10:30) land surface temperature")


def export_site(ee, image, scale, bounds, out_path):
    w, s, e, n = bounds
    region = ee.Geometry.Rectangle([w, s, e, n], proj="EPSG:4326", geodesic=False)
    url = image.unmask(NODATA).toFloat().clip(region).getDownloadURL(
        {"region": region, "scale": scale, "crs": "EPSG:4326", "format": "GEO_TIFF"})
    r = requests.get(url, timeout=600)
    r.raise_for_status()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(r.content)
    with rasterio.open(out_path, "r+") as ds:  # mark Earth Engine's masked pixels as nodata
        ds.nodata = NODATA
        v = ds.read(1)
        return float((v != NODATA).mean()), ds.width, ds.height


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True, help="Google Cloud project registered for Earth Engine")
    ap.add_argument("--layers", default=",".join(LAYERS), help="comma-separated layer ids")
    ap.add_argument("--sites", default="", help="comma-separated site ids (default: all Earth sites)")
    ap.add_argument("--year", type=int, default=2023, help="year to use")
    ap.add_argument("--season", choices=["year", "summer"], default="year",
                    help="year = whole calendar year (default); summer = June-August")
    ap.add_argument("--force", action="store_true", help="overwrite existing files")
    ap.add_argument("--facts", action="store_true", help="also save typical day/night temperatures for the viewer")
    ap.add_argument("--facts-only", action="store_true", help="only save the temperature facts, no layer downloads")
    args = ap.parse_args()

    import ee
    try:
        ee.Initialize(project=args.project)
    except Exception as exc:
        sys.exit(f"Earth Engine login failed: {exc}\nRun `earthengine authenticate` first "
                 f"(in Git Bash: source .venv/Scripts/activate && earthengine authenticate).")

    wanted_layers = [x for x in args.layers.split(",") if x]
    unknown = [x for x in wanted_layers if x not in LAYERS]
    if unknown:
        sys.exit(f"Unknown layer(s): {', '.join(unknown)}. Available: {', '.join(LAYERS)}")
    wanted_sites = set(filter(None, args.sites.split(",")))
    sites = [s for s in load_config()["sites"] if s["body"] == "earth" and (not wanted_sites or s["id"] in wanted_sites)]

    failed = 0
    when = PERIOD_TEXT[args.season].format(year=args.year)
    if args.facts or args.facts_only:
        print(f"[facts] typical {when} day/night temperature (MODIS MOD11A2)")
        for site in sites:
            try:
                path = temperature_facts(ee, site, args.year, args.season)
                print(f"  [ok]   {site['id']}" if path else f"  [none] {site['id']}: no valid pixels")
            except Exception as exc:
                failed += 1
                print(f"  [FAIL] {site['id']}: {exc}")
    if args.facts_only:
        wanted_layers = []
    for layer_id in wanted_layers:
        build, scale, dataset = LAYERS[layer_id]
        image = build(args.year, args.season)
        print(f"[{layer_id}] {dataset}, {when}, {scale} m")
        for site in sites:
            out = LAYER_DIR / layer_id / f"{site['id']}.tif"
            if out.exists() and not args.force:
                print(f"  [skip] {site['id']} (exists, use --force)")
                continue
            try:
                cover, w, h = export_site(ee, image, scale, bounds_for(site)["lonlat_bounds"], out)
                print(f"  [ok]   {site['id']:<20} {w}x{h} px, {cover:.0%} valid")
            except Exception as exc:
                failed += 1
                print(f"  [FAIL] {site['id']}: {exc}")
    print("\nNext: python scripts/analyze.py")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
