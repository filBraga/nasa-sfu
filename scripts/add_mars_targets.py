"""Add the Mars sites from mars-data/ (landing candidates + Oxia) as comparison targets in config/sites.json.

Idempotent: re-running replaces the generated `mars_*` targets. Then run fetch_dems.py and analyze.py.
Type: named craters with a known diameter -> crater; everything else -> landing_zone (flat-ground metrics).
"""
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = ROOT / "config" / "sites.json"
LIMITS = ["Mars gravity is 0.38 g and the air is ~0.6% of Earth's pressure.",
          "No magnetic field: surface radiation far above Earth levels.",
          "200 m elevation data cannot see metre-scale features; HiRISE DEMs would be needed."]


def lon180(x):
    return round(((x + 180) % 360) - 180, 3)


def far(a, b, deg=1.0):
    return math.hypot(a["lat"] - b["lat"], (a["lon"] - b["lon"] + 180) % 360 - 180) < deg


def main():
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    cfg["sites"] = [s for s in cfg["sites"] if not s["id"].startswith("mars_")]
    feats = {f["name"]: f for f in json.loads((ROOT / "mars-data/mars_features.json").read_text(encoding="utf-8"))["features"]
             if "Crater" in f["type"]}
    cands = json.loads((ROOT / "mars-data/mars_candidates.json").read_text(encoding="utf-8"))["candidates"]
    data = json.loads((ROOT / "mars-data/mars_data.json").read_text(encoding="utf-8"))["sites"]
    raw = [{"name": s["name"], "lat": s["lat"], "lon": s["lon_e"], "group": "mars_data"} for s in data if s["id"] == "oxia"]
    raw += [{"name": c["name"], "lat": c["lat"], "lon": c["lon_e"], "group": c["group"]}
            for c in cands if c["lat"] is not None and c["lon_e"] is not None]
    kept = [s for s in cfg["sites"] if s["body"] == "mars"]  # jezero, arcadia
    new = []
    for r in raw:
        r["lon"] = lon180(r["lon"])
        if any(far(r, k) for k in kept + new):
            continue
        base = re.sub(r"\b(crater|EZ|planitia)\b|\(.*?\)|/.*", "", r["name"], flags=re.I).strip()
        crater = feats.get(base.split()[0]) if "crater" in r["name"].lower() else None
        diam = crater["diam_km"] if crater else None
        site = {"id": "mars_" + re.sub(r"[^a-z0-9]+", "_", r["name"].lower()).strip("_")[:40], "name": r["name"],
                "region": f"Mars ({r['group'][:30]})", "body": "mars", "role": "target",
                "type": "crater" if diam else "landing_zone", "lat": r["lat"], "lon": r["lon"],
                "window_km": round(min(3 * diam, 300)) if diam else 60,
                "compare_res_m": 200,
                "source": "Mars HRSC-MOLA Blended DEM v2, 200 m (USGS Astrogeology)",
                "blurb": f"Candidate landing / exploration site from mars-data ({r['group']}).", "earth_limits": LIMITS}
        if diam:
            site.update(diameter_km=round(diam, 1), refine_center=True)
        new.append(site)
    cfg["sites"] += new
    # Earth terrain candidates that may be compared with landing zones
    for s in cfg["sites"]:
        if s["id"] in ("haughton", "hmp_plateau", "mcgill_uplands", "tuktoyaktuk") and "landing_zone" not in s["types"]:
            s["types"].append("landing_zone")
    CFG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(new)} Mars targets added ({sum(s['type'] == 'crater' for s in new)} craters)")


main()
