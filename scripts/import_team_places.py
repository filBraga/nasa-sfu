"""Import the team's places file into the Earth places map and the terrain pipeline.

Usage:  python scripts/import_team_places.py [places_new.json]
Then:   python scripts/fetch_dems.py && python scripts/analyze.py

What it does (safe to run again, it updates in place):
  1. web/data/places_all.json: each team place is merged into the entry with the same id
     (or added), gets the label "team" and a `site_id` that links it to the terrain viewer.
  2. config/sites.json: each team place becomes an Earth analog site tagged "team".
     `compare_bodies` comes from the place's `targets`, so analyze.py compares it with every
     Moon and/or Mars target, whatever the target's type.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLACES_ALL = ROOT / "web" / "data" / "places_all.json"
SITES = ROOT / "config" / "sites.json"
TAG = "team"


def site_id_for(place_id):
    return "team_" + re.sub(r"[^a-z0-9]+", "_", place_id.lower()).strip("_")


def site_name(place, used):
    name = (place.get("region") or "").split(",")[0].strip() or f"Earth location {place['id']}"
    if name in used:  # e.g. two "Arctic mainland" places
        name = f"{name} ({place['id'].split('-')[-1]})"
    used.add(name)
    return name


def connect_all_map_places(places, cfg):
    """Connect every map entry; retain existing sites and never use heuristic scores as measurements."""
    by_id = {s["id"]: s for s in cfg["sites"]}
    used = {s["name"] for s in cfg["sites"]}
    added = []
    for place in places:
        if not place.get("region"):
            place["region"] = f"Earth location {place['id']} ({place['lat']}, {place['lon']})"
        sid = place.get("site_id") or site_id_for(place["id"])
        if sid in by_id:
            if by_id[sid]["body"] != "earth":
                raise ValueError(f"Map entry points to a non-Earth site: {place['id']}")
            if any(abs(by_id[sid][key] - place[key]) > 1e-6 for key in ("lat", "lon")):
                raise ValueError(f"Map/site coordinate mismatch: {place['id']}")
            if "map_connected" in by_id[sid].get("tags", []):
                by_id[sid]["crater_geometry_verified"] = False
            place["site_id"] = sid
            continue
        lat, lon = place.get("lat"), place.get("lon")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
            raise ValueError(f"Invalid map coordinates: {place['id']}")
        bodies = sorted({b.lower() for b in place.get("targets", [])} & {"moon", "mars"}) or ["moon", "mars"]
        site = {"id": sid, "name": site_name(place, used), "region": place.get("region") or f"Map coordinate {lat}, {lon}",
                "body": "earth", "role": "analog", "tags": [TAG, "map_connected"], "types": [],
                "compare_bodies": bodies, "place_id": place["id"], "lat": lat, "lon": lon,
                "diameter_km": 25, "window_km": 30, "refine_center": False, "fetch_res_m": 30,
                "crater_geometry_verified": False,
                "source": "Copernicus DEM GLO-30 (ESA / AWS Open Data)",
                "blurb": "Connected Earth map candidate. Terrain is measured from a DEM; map heuristic match percentages are not used as physical measurements.",
                "verify": "Saved map coordinate; region name may be unverified. The 25 km profile reference is an analysis scale, not a measured crater diameter."}
        added.append(site)
        by_id[sid] = site
        place["site_id"] = sid
        place["labels"] = sorted(set(place.get("labels", [])) | {TAG})
    first_target = next((i for i, s in enumerate(cfg["sites"]) if s["body"] != "earth"), len(cfg["sites"]))
    cfg["sites"][first_target:first_target] = added
    return added


def main(argv):
    if "--connect-all" in argv:
        places = json.loads(PLACES_ALL.read_text(encoding="utf-8"))
        cfg = json.loads(SITES.read_text(encoding="utf-8"))
        added = connect_all_map_places(places, cfg)
        PLACES_ALL.write_text(json.dumps(places, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        SITES.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        sources_path = ROOT / "config/data_sources.json"
        sources = json.loads(sources_path.read_text(encoding="utf-8"))
        for s in cfg["sites"]:
            if "map_connected" in s.get("tags", []):
                sources.setdefault("site_coordinates", {})[s["id"]] = {
                    "source": "Saved team coordinate in web/data/places_all.json",
                    "note": "Region text may be unverified. Descriptive map percentages are not physical measurements."}
        sources_path.write_text(json.dumps(sources, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Connected {len(places)} map entries; added {len(added)} Earth comparison sites")
        return
    src = Path(argv[0]) if argv else ROOT / "places_new.json"
    team = json.loads(src.read_text(encoding="utf-8"))

    # 1. Earth places map
    places = json.loads(PLACES_ALL.read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in places}
    added = updated = 0
    for t in team:
        entry = {**t, "site_id": site_id_for(t["id"])}
        entry["labels"] = sorted(set(t.get("labels", [])) | {TAG})
        old = by_id.get(t["id"])
        if old is None:
            places.append(entry)
            added += 1
        else:
            if (round(old["lat"], 4), round(old["lon"], 4)) != (round(t["lat"], 4), round(t["lon"], 4)):
                print(f"  ! {t['id']}: coordinates changed {old['lat']},{old['lon']} -> {t['lat']},{t['lon']}")
            labels = sorted(set(old.get("labels", [])) | set(entry["labels"]))
            old.update(entry)
            old["labels"] = labels
            updated += 1
    PLACES_ALL.write_text(json.dumps(places, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{PLACES_ALL.relative_to(ROOT)}: {updated} updated, {added} added, labelled #{TAG}")

    # 2. terrain pipeline sites
    cfg = json.loads(SITES.read_text(encoding="utf-8"))
    sites = [s for s in cfg["sites"] if TAG not in s.get("tags", [])]  # drop old team sites, re-add below
    used = {s["name"] for s in sites}
    new_sites = []
    for t in team:
        bodies = sorted({b.lower() for b in t.get("targets", [])} & {"mars", "moon"}) or ["mars", "moon"]
        mt = t.get("marsRegionType") or {}
        lt = t.get("moonRegionType") or {}
        team_match = ", ".join(f"{k} {v}%" for k, v in (t.get("match") or {}).items() if v is not None)
        new_sites.append({
            "id": site_id_for(t["id"]),
            "name": site_name(t, used),
            "region": t["region"],
            "body": "earth",
            "role": "analog",
            "tags": [TAG],
            "types": [],
            "compare_bodies": bodies,
            "place_id": t["id"],
            "lat": t["lat"],
            "lon": t["lon"],
            "diameter_km": 25,
            "window_km": 30,
            "refine_center": False,
            "fetch_res_m": 30,
            "source": "Copernicus DEM GLO-30 (ESA / AWS Open Data)",
            "blurb": (f"#team place {t['id']} (climate match {team_match}). "
                      + (f"Mars type: {mt['name']}. " if mt.get("name") else "")
                      + (f"Moon type: {lt['name']}." if lt.get("name") else "")).strip(),
            **({"verify": "region name not verified by the team script"} if t.get("regionVerified") is False else {}),
        })
    cfg["sites"] = sites[:]
    # keep team sites with the other Earth sites, before the targets
    first_target = next((i for i, s in enumerate(cfg["sites"]) if s["body"] != "earth"), len(cfg["sites"]))
    cfg["sites"][first_target:first_target] = new_sites
    SITES.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{SITES.relative_to(ROOT)}: {len(new_sites)} #{TAG} Earth sites")


if __name__ == "__main__":
    main(sys.argv[1:])
