"""Import researched Moon sites, named features and successful landing locations.

Matches the Mars importer: known craters use crater metrics, other locations use
landing-zone metrics. Uses the cached 16 ppd DEM at an honest 2 km grid. Existing
high-resolution polar targets and all Mars targets are preserved.
"""
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def distance_km(a, b):
    lat1, lat2 = math.radians(a["lat"]), math.radians(b["lat"])
    dl = math.radians((a["lon"] - b["lon"] + 180) % 360 - 180)
    v = math.sin((lat1 - lat2) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dl / 2) ** 2
    return 3474.8 * math.asin(math.sqrt(min(1, max(0, v))))


def candidates():
    read = lambda name: json.loads((ROOT / "moon-data" / name).read_text(encoding="utf-8"))
    features = read("moon_features.json")["features"]
    features_by_name = {s["name"].lower().replace(" crater", ""): s for s in features}
    rows = []
    for s in read("moon_data.json")["sites"]:
        f = features_by_name.get(s["name"].lower().replace(" crater", ""), {})
        rows.append({**s, "diam_km": f.get("diam_km"), "kind": f.get("type", "region"),
                     "source_file": "moon-data/moon_data.json"})
    rows += [{**s, "kind": s["type"], "source_file": "moon-data/moon_features.json"} for s in features]
    rows += [{**s, "kind": "landing site", "source_file": "moon-data/moon_landers.json"}
             for s in read("moon_landers.json")["landers"]
             if s["type"] in ("Soft Landing", "Crewed Landing", "Lander")]
    return rows


def add_targets(cfg):
    retained = [s for s in cfg["sites"] if "moon_catalog" not in s.get("tags", [])]
    moon = [s for s in retained if s["body"] == "moon"]
    ids = {s["id"] for s in retained}
    added = []
    canonical_name = lambda name: re.sub(r"\s+", " ", re.sub(r"\(.*?\)|\bcrater\b", "", name.lower())).strip()
    for row in candidates():
        if not isinstance(row.get("lat"), (int, float)) or not isinstance(row.get("lon_e"), (int, float)):
            continue
        if not math.isfinite(row["lat"]) or not math.isfinite(row["lon_e"]) or abs(row["lat"]) > 90:
            continue
        position = {"lat": row["lat"], "lon": (row["lon_e"] + 180) % 360 - 180}
        match = next((s for s in moon + added if distance_km(position, s) < 10
                      or canonical_name(row["name"]) == canonical_name(s["name"])), None)
        if match:
            continue
        sid = "moon_" + re.sub(r"[^a-z0-9]+", "_", row["name"].lower()).strip("_")[:60]
        if sid in ids:
            suffix = 2
            while f"{sid}_{suffix}" in ids:
                suffix += 1
            sid = f"{sid}_{suffix}"
        diameter = row.get("diam_km")
        crater = row["kind"].lower() == "crater" and isinstance(diameter, (int, float)) and 20 <= diameter <= 200
        site = {
            "id": sid, "name": row["name"], **position, "body": "moon", "role": "target",
            "region": f"Moon ({row['kind']})", "type": "crater" if crater else "landing_zone",
            "window_km": round(min(3 * diameter, 300)) if crater else 80,
            "compare_res_m": 2000, "fetch_res_m": 2000, "heightmap_px": 128,
            "dem_source": "lola_global_16", "source": "NASA SVS / LRO LOLA global 16 ppd DEM",
            "blurb": f"{row['kind'].capitalize()} from {row['source_file']}; regional terrain comparison around the saved coordinate.",
            "catalog_source": row["source_file"], "source_id": row.get("id"),
            "verify": "2 km comparison grid from ~1.9 km native N-S terrain data. Small pits, boulders, narrow rilles and landing hazards are not resolved.",
            "earth_limits": ["Moon gravity, vacuum and radiation differ from Earth.",
                             "This is regional terrain similarity, not a landing or operations clearance.",
                             "Lunar dust is contextual/filter evidence and is excluded from the similarity score."],
            "tags": ["moon_catalog"],
        }
        if crater:
            site.update(diameter_km=diameter, refine_center=True)
        added.append(site)
        ids.add(sid)
    cfg["sites"] = retained + added
    for s in cfg["sites"]:
        if s["id"] in ("haughton", "hmp_plateau", "mcgill_uplands", "tuktoyaktuk"):
            s["types"] = list(dict.fromkeys(s.get("types", []) + ["landing_zone"]))
    return added


def main():
    path = ROOT / "config/sites.json"
    cfg = json.loads(path.read_text(encoding="utf-8"))
    added = add_targets(cfg)
    path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    source_path = ROOT / "config/data_sources.json"
    sources = json.loads(source_path.read_text(encoding="utf-8"))
    for s in added:
        sources.setdefault("site_coordinates", {})[s["id"]] = {
            "source": s["catalog_source"], "note": "Saved catalog coordinate; local comparison window, not an operationally certified site."}
    source_path.write_text(json.dumps(sources, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(added)} catalog Moon targets; {sum(s['body'] == 'moon' for s in cfg['sites'])} Moon targets total")


if __name__ == "__main__":
    main()
