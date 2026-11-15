"""Make all researched Moon/Mars locations available to the terrain pipeline.

Existing targets retain their calibrated coordinates and DEMs. Imported locations
use regional terrain metrics and explicit native-resolution limits. No literature
temperature, mineral or rock abundance value is substituted for another quantity.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def imported_targets(config):
    existing = {s["id"] for s in config["sites"]}
    added = []
    aliases = {"shackleton_crater": "shackleton"}
    for body in ("moon", "mars"):
        path = ROOT / f"{body}-data/{body}_data.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        for record in data["sites"]:
            sid = aliases.get(record["id"], record["id"])
            if sid in existing:
                continue
            moon = body == "moon"
            added.append({
                "id": sid, "name": record["name"], "body": body, "role": "target",
                "region": f"Imported {body.title()} research location",
                "type": "regional_terrain", "compare_all_earth": True,
                "lat": record["lat"], "lon": (record["lon_e"] + 180) % 360 - 180,
                "window_km": 80 if moon else 60,
                "compare_res_m": 2000 if moon else 200,
                "fetch_res_m": 2000 if moon else 200,
                "heightmap_px": 128, "refine_center": False,
                "dem_source": "lola_global_16" if moon else "hrsc_mola_blend",
                "source": ("Cached LOLA global 16 ppd DEM (NASA SVS Moon Kit)" if moon else
                           "Mars HRSC-MOLA Blended DEM v2, 200 m (USGS Astrogeology)"),
                "blurb": f"Research location from {path.relative_to(ROOT).as_posix()}. Terrain comparison covers a local regional window, not the entire named feature.",
                "verify": ("Regional screening at 2 km/pixel (~1.9 km native N-S grid); cannot resolve landing hazards, pits or individual boulders." if moon else
                           "Research coordinates are approximate; regional terrain screening at 200 m/pixel cannot resolve individual pits or landing hazards."),
                "earth_limits": [
                    "Comparison describes regional terrain similarity, not operational safety or landing suitability.",
                    "Published thermal, composition and ice evidence is shown separately with its source and measurement scale.",
                    "Gravity, atmosphere, radiation and weathering differ from Earth.",
                ],
                "tags": ["planetary_import"],
            })
            existing.add(sid)
    return added


def main():
    path = ROOT / "config/sites.json"
    config = json.loads(path.read_text(encoding="utf-8"))
    added = imported_targets(config)
    config["sites"].extend(added)
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    path = ROOT / "config/site_types.json"
    types = json.loads(path.read_text(encoding="utf-8"))
    types["types"]["regional_terrain"] = {
        "label": "Regional terrain screening", "short": "regional terrain",
        "description": "Local terrain similarity at the stated grid resolution. Includes researched craters, plains and volcanic locations; does not infer whole-feature shape or small hazards.",
        "metrics": ["slope", "roughness", "hypsometry", "flat_fraction"],
    }
    path.write_text(json.dumps(types, indent=2) + "\n", encoding="utf-8")
    path = ROOT / "config/data_sources.json"
    sources = json.loads(path.read_text(encoding="utf-8"))
    global_source = next((d for d in sources["datasets"] if d["id"] == "lola_global_16"), None)
    if global_source is None:
        global_source = {}
        sources["datasets"].append(global_source)
    global_source.update({
            "id": "lola_global_16", "name": "LOLA global terrain, 16 pixels/degree", "short": "LOLA global",
            "category": "elevation", "bodies": ["moon"],
            "url": "https://svs.gsfc.nasa.gov/4720/", "provider": "NASA SVS / LRO LOLA",
            "agency": "NASA", "measures": "Regional lunar elevation above the 1737.4 km reference sphere",
            "links": [{"label": "NASA Moon Kit", "url": "https://svs.gsfc.nasa.gov/4720/"}],
            "how": "Local windows from the cached LOLA 16 ppd TIFF, with explicit georeferencing and km-to-m conversion; no global raster sent to the browser.",
            "resolution": "~1.9 km north-south native grid; compared at 2 km/pixel",
            "caveat": "Regional terrain only. Cached TIFF orientation and km-to-m conversion cross-checked against PDS samples. Not a landing-hazard map.",
    })
    coordinates = sources.setdefault("site_coordinates", {})
    for site in config["sites"]:
        if "planetary_import" in site.get("tags", []):
            coordinates[site["id"]] = {
                "source": f"{site['body']}-data/{site['body']}_data.json; approximate researched regional coordinate",
                "note": "Local terrain window; not a verified landing or cave entrance coordinate.",
            }
    path.write_text(json.dumps(sources, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Added {len(added)} selectable targets: " + ", ".join(s["id"] for s in added))


if __name__ == "__main__":
    main()
