"""Compare Earth sites with Moon/Mars targets of a matching site type and export results for the viewer.

Usage:  python scripts/analyze.py
Output: web/data/results.json and web/data/heightmaps/<id>.bin (Float32, row-major, north up)

Pairing: an Earth site is compared with a target when the target's `type` is in the site's
`types`. Control sites are compared with every target, to check that the method rejects them.
Sites with `compare_bodies` (the #team places) are compared with every target on those bodies.
"""

import json
import argparse
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from analog import RAW_DIR, ROOT, WEB_DATA_DIR, load_config  # noqa: E402
from analog.compare import DEFAULT_ON, METRIC_INFO, METRICS, explain, score_pair, verdict  # noqa: E402
from analog.facts import read_facts  # noqa: E402
from analog.layers import Constant, compare_layer, earth_range, inventory, load_registry, site_values  # noqa: E402
from analog.layers import _threshold_for as threshold_for  # noqa: E402
from analog.sources import RADIUS_M, resample  # noqa: E402
from analog.similarity import aggregate_similarity, metric_category, policy  # noqa: E402
from analog.terrain import (HYPSO_Q, ILLUM_BINS, PROFILE_R, ROUGH_BINS, SLOPE_BINS,  # noqa: E402
                            SPECTRUM_WAVELENGTHS, site_features, slope_deg)

HEIGHTMAP_MAX = 256
BODY_RADIUS = {"earth": 6371000.0, **RADIUS_M}


def load_raw(site_id):
    path = RAW_DIR / f"{site_id}.npz"
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run scripts/fetch_dems.py first.")
    d = np.load(path)
    return d["z"].astype(np.float32), float(d["res"])


def export_heightmap(site, z, res, out_dir):
    n = z.shape[0]
    target_res = res * max(1.0, n / site.get("heightmap_px", HEIGHTMAP_MAX))  # sharper 3D for high-res DEMs
    small = resample(z, res, target_res)
    small = np.nan_to_num(small, nan=float(np.nanmin(small)))
    (out_dir / f"{site['id']}.bin").write_bytes(small.astype("<f4").tobytes())
    return {
        "file": f"heightmaps/{site['id']}.bin",
        "size": int(small.shape[0]),
        "extent_km": round(small.shape[0] * target_res / 1000, 3),
        "zmin": float(small.min()), "zmax": float(small.max()),
    }


def r(x, nd=4):
    return [None if not np.isfinite(v) else round(float(v), nd) for v in np.asarray(x)]


def public_features(f):
    out = {
        "res_m": f["res_m"],
        "slope_hist": r(f["slope_hist"], 5),
        "rough_hist": r(f["rough_hist"], 5),
        "hypsometry": r(f["hypsometry"]),
        "slope_median": round(f["slope_median"], 2),
        "slope_p90": round(f["slope_p90"], 2),
        "flat_fraction": round(f["flat_fraction"], 4),
        "relief_m": round(f["relief_m"], 1),
    }
    if "profile" in f:
        out.update(center_offset_km=f["center_offset_km"], profile_m=r(f["profile"], 1),
                   depth_m=round(f["depth_m"], 1), depth_over_diameter=round(f["depth_over_diameter"], 4))
    if "illum_hist" in f:
        out.update(illum_hist=r(f["illum_hist"], 4), illum_mean=round(f["illum_mean"], 4),
                   sun_elevation_deg=f["sun_elevation_deg"])
    if "spectrum" in f:
        out["spectrum"] = r(f["spectrum"], 3)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--body", choices=("moon", "mars"), help="Rebuild one body's comparisons; preserve other bodies from the existing results export")
    parser.add_argument("--calculations-only", action="store_true", help="Recalculate all scores without rewriting terrain assets; use exported terrain at its actual coarser resolution if a raw DEM cache is absent")
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / "scripts"))
    from data_sync import pull_if_configured
    pull_if_configured()  # fills data/raw, data/layers, data/external from Supabase if missing
    previous = None
    if args.body or args.calculations_only:
        previous = json.loads((WEB_DATA_DIR / "results.json").read_text(encoding="utf-8"))
    if args.body and previous.get("scoring", {}).get("version") != policy()["version"]:
        raise SystemExit("Scoring policy changed: run --calculations-only for both bodies first")
    cfg = load_config()
    types = json.loads((ROOT / "config" / "site_types.json").read_text(encoding="utf-8"))["types"]
    sites = cfg["sites"]
    earth = [s for s in sites if s["body"] == "earth"]
    targets = [s for s in sites if s["role"] == "target"]
    for t in targets:
        if t.get("type") not in types:
            raise SystemExit(f"Target {t['id']} has unknown type {t.get('type')!r}; see config/site_types.json")
    target_types = {t["type"] for t in targets}
    hm_dir = WEB_DATA_DIR / "heightmaps"
    hm_dir.mkdir(parents=True, exist_ok=True)

    src_path = ROOT / "config" / "data_sources.json"
    data_sources = json.loads(src_path.read_text(encoding="utf-8")) if src_path.exists() else {"datasets": []}
    dem_source = {b: d["id"] for d in data_sources["datasets"] for b in d.get("dem_for", [])}

    fallback = set()
    raw = {}
    for s in sites:
        if args.body and s["body"] not in ("earth", args.body):
            continue
        if (RAW_DIR / f"{s['id']}.npz").exists():
            raw[s["id"]] = load_raw(s["id"])
        elif args.calculations_only and s["id"] in previous["sites"]:
            hm = previous["sites"][s["id"]]["heightmap"]
            z = np.fromfile(WEB_DATA_DIR / hm["file"], dtype="<f4").reshape(hm["size"], hm["size"])
            if not np.isfinite(z).all():
                raise ValueError(f"Invalid exported terrain: {s['id']}")
            raw[s["id"]] = z, hm["extent_km"] * 1000 / hm["size"]
            fallback.add(s["id"])
        else:
            raw[s["id"]] = load_raw(s["id"])
    site_out = {}
    for s in sites:
        if s["id"] not in raw:
            if s["id"] not in previous["sites"]:
                raise SystemExit(f"No saved export for {s['id']}; run a full analysis first")
            site_out[s["id"]] = previous["sites"][s["id"]]
            continue
        z, res = raw[s["id"]]
        meta = {k: s.get(k) for k in ("id", "name", "region", "body", "role", "lat", "lon", "diameter_km",
                                      "window_km", "source", "blurb", "earth_limits", "type",
                                      "sun_elevation_deg", "verify", "tags", "compare_bodies", "place_id", "compare_all_earth", "source_id", "catalog_source", "crater_geometry_verified")}
        meta["types"] = s.get("types") or ([s["type"]] if s.get("type") else [])
        meta["has_target"] = (s["role"] != "analog" or bool(set(meta["types"]) & target_types)
                              or any(t["body"] in s.get("compare_bodies", []) for t in targets)
                              or any(t.get("compare_all_earth") and t["body"] in s.get("compare_bodies", ["moon", "mars"]) for t in targets))
        if (args.calculations_only or (args.body and s["body"] == "earth")) and s["id"] in previous["sites"]:
            meta["heightmap"] = previous["sites"][s["id"]]["heightmap"]
        else:
            meta["heightmap"] = export_heightmap(s, z, res, hm_dir)
        meta["dem_source"] = s.get("dem_source") or dem_source.get(s["body"])
        meta["coord_source"] = data_sources.get("site_coordinates", {}).get(s["id"])
        site_out[s["id"]] = {k: v for k, v in meta.items() if v is not None}

    # ---- dimensions = terrain metrics (with the types they apply to) + data layers
    layers = load_registry()
    for L in layers:
        if L.get("compare") == "relative":
            L["_range"] = earth_range(L, sites)
    dimensions ={k: {"group": "terrain", "label": l, "weight": w, "method": m, "default_on": k in DEFAULT_ON,
                      "description": METRIC_INFO[k][0], "code": METRIC_INFO[k][1],
                      "applies_to": [tid for tid, td in types.items() if k in td["metrics"]]}
                  for k, (w, l, m) in METRICS.items()}
    for L in layers:
        dimensions[L["id"]] = {
            "group": "layer", "label": L["label"], "weight": L["weight"], "unit": L.get("unit", ""),
            "default_on": L.get("default_on", True), "description": L.get("description", ""),
            "sources": L.get("sources", {}), "source_ids": L.get("source_ids", {}),
            "normalize": L.get("normalize", "none"),
            "planetary_value": L.get("planetary_value"),
            "score_excluded_bodies": L.get("score_excluded_bodies", []),
            "code": f"analog/layers.py: site_values(), compare_layer(); files in data/layers/{L['id']}/",
            "method": ("Wasserstein distance of raw values " if L.get("normalize", "none") == "none"
                       else f"Wasserstein distance of {L['normalize']}-normalised values ")
                      +
                      f"(scale {L.get('scale', '-')}{' ' + L['unit'] if L.get('normalize', 'none') == 'none' and L.get('unit') else ''})",
        }
        if L.get("facts"):
            dimensions[L["id"]]["code"] = (f"analog/layers.py: fact_value(), _compare_relative(); "
                                           f"files in data/facts/{L['facts']['kind']}/")
        if L.get("compare") == "relative" and L.get("_range"):
            lo, hi = L["_range"]
            dimensions[L["id"]]["method"] = (
                f"Scored against the other Earth sites, because all of them are far warmer than Mars and the Moon: "
                f"coldest Earth site ({lo:.0f} {L.get('unit', '')}) = 1.0, warmest ({hi:.0f} {L.get('unit', '')}) = 0.0, "
                f"linear in between. Colder = closer to the target.")
        if L.get("compare") in ("fraction_below", "fraction"):
            side ="above" if L.get("direction") == "above" else "below"
            per_body = "; ".join(f"{b}: {t.get('direction', 'below')} {t['value']}" for b, t in (L.get("thresholds") or {}).items())
            dimensions[L["id"]]["method"] = (
                (f"Share of the area past each body's threshold ({per_body}); " if per_body else
                 f"Share of the area {side} {L['threshold']}{' ' + L['unit'] if L.get('unit') else ''} at each site; ")
                + f"score = exp(-|difference| / {L['scale']})."
                + (f" Moon and Mars use the known value {L['planetary_value']:.0%}." if L.get("planetary_value") is not None else ""))
        elif L.get("compare") == "ratio":
            h = L.get("ratio_halving", 4)
            dimensions[L["id"]]["method"] = (
                f"Ratio of the two sites' median values; score = 0.5^(log(ratio)/log({h})): "
                f"1.0 when equal, 0.5 at a {h}x difference, 0.25 at {h * h}x.")
    inv = inventory(layers, set(site_out))
    available = {}  # dataset id -> site ids that have a delivered file from it
    print("Data layers:")
    for L in layers:
        info = inv[L["id"]]
        print(f"  {L['id']:<20} {len(info['sites'])} site file(s)"
              + (f"  ! unknown site ids: {', '.join(info['unknown_files'])}" if info["unknown_files"] else ""))
        dimensions[L["id"]]["sites_with_data"] = info["sites"]
        for sid in info["sites"]:
            ds_id = L.get("source_ids", {}).get(site_out[sid]["body"])
            if ds_id:
                available.setdefault(ds_id, []).append(sid)
    for ds in data_sources["datasets"]:
        if ds.get("category") == "layer":
            ds["available_sites"] = sorted(set(available.get(ds["id"], [])))
    # ---- per-site facts for the viewer's facts strip (independent of any comparison)
    facts_res = {"earth": 200.0, "mars": 200.0, "moon": 80.0}
    for s in sites:
        if s["id"] not in raw:
            continue
        res = max(facts_res[s["body"]], raw[s["id"]][1])
        z0, r0 = raw[s["id"]]
        slope = slope_deg(resample(z0, r0, res), res)
        slope = slope[np.isfinite(slope)]
        f = {"terrain": {"dataset": site_out[s["id"]].get("dem_source"), "res_m": res,
                         "slope_median": round(float(np.median(slope)), 1),
                         "flat_fraction": round(float((slope < 5).mean()), 3)},
             "layers": {}}
        f.update(read_facts(s["id"]))
        for L in layers:
            v = site_values(L, s, res, log=lambda *_: None)
            if v is None:
                continue
            item = {"dataset": (L.get("source_ids") or {}).get(s["body"])}
            if isinstance(v, Constant):
                item.update(fraction=float(v), constant=True, note=(L.get("sources") or {}).get(s["body"]))
            else:
                item["median"] = round(float(np.median(v)), 3)
                if L.get("compare") in ("fraction_below", "fraction"):
                    thr, d = threshold_for(L, s["body"])
                    item.update(fraction=round(float(((v > thr) if d == "above" else (v < thr)).mean()), 3),
                                threshold=thr, direction=d)
            f["layers"][L["id"]] = item
        site_out[s["id"]]["facts"] = f
    waiting = [s for s in site_out.values() if not s["has_target"]]
    if waiting:
        print("Sites waiting for a target of their type: "
              + ", ".join(f"{s['id']} ({'/'.join(s['types'])})" for s in waiting))

    for key, d in dimensions.items():
        d["category"] = metric_category(key, d)
    for L in layers:
        if L.get("compare") == "absolute":
            dimensions[L["id"]]["method"] = (
                f"exp(-ln(2) * (absolute midpoint difference / {L.get('tau', L['scale'] * np.log(2)):.3f} K)^1). "
                "Provisional tolerance; reported endpoint statistics have different temporal support.")
            dimensions[L["id"]]["description"] = L.get("description", "")
            dimensions[L["id"]]["code"] = "analog/layers.py: compare_layer() absolute target difference"

    cache = {}
    layer_cache = {}

    def values(layer, site, res, extent):
        key = layer["id"], site["id"], res, extent
        if key not in layer_cache:
            layer_cache[key] = site_values(layer, {**site, "window_km": extent}, res)
        return layer_cache[key]

    def features(site, res, metrics, sun, extent):
        key = (site["id"], res, sun, tuple(sorted(metrics)), extent)
        if key not in cache:
            z, r0 = raw[site["id"]]
            grid = resample(z, r0, res)
            n = min(len(grid), int(round(extent * 1000 / res)))
            start = (len(grid) - n) // 2
            common = grid[start:start+n, start:start+n]
            base_metrics = set(metrics) - {"profile", "depth"}
            f = site_features(common, res, site, base_metrics, sun, BODY_RADIUS[site["body"]])
            if set(metrics) & {"profile", "depth"} and site.get("crater_geometry_verified", True):
                full = site_features(grid, res, site, {"profile", "depth"}, sun, BODY_RADIUS[site["body"]])
                for field in ("center_offset_km", "profile", "sector_profiles", "rim_m", "floor_m", "depth_m", "depth_over_diameter"):
                    f[field] = full[field]
            f["comparison_extent_km"] = n * res / 1000
            cache[key] = f
        return cache[key]

    comparisons = [] if not args.body else [c for c in previous["comparisons"]
        if c["earth"] in site_out and c["target"] in site_out and site_out[c["target"]]["body"] != args.body]
    for t in targets:
        if args.body and t["body"] != args.body:
            continue
        ttype = t["type"]
        metrics = types[ttype]["metrics"]
        # Never upsample a coarser input and then treat its derivatives as finer evidence.
        res = max(float(t["compare_res_m"]), raw[t["id"]][1], max(raw[e["id"]][1] for e in earth))
        sun = t.get("sun_elevation_deg")
        not_applicable = [k for k in METRICS if k not in metrics]
        candidates = [e for e in earth if e["role"] == "control" or ttype in e.get("types", [])
                      or t["body"] in e.get("compare_bodies", [])
                      or (t.get("compare_all_earth") and t["body"] in e.get("compare_bodies", ["moon", "mars"]))]
        print(f"\n=== {t['name']} ({t['body']}, {types[ttype]['label']}) @ {res:.0f} m"
              + "  [matched grid and common terrain window]")
        rows = []
        for e in candidates:
            extent = min(e["window_km"], t["window_km"])
            fe, ft = features(e, res, metrics, sun, extent), features(t, res, metrics, sun, extent)
            scores, _ = score_pair(fe, ft, metrics)
            layer_data = {}
            for L in layers:
                tv = values(L, t, res, extent)
                ev = values(L, e, res, extent) if tv is not None else None
                if tv is not None and ev is not None:
                    value, detail = compare_layer(L, ev, tv, e["body"], t["body"])
                    if value is not None and np.isfinite(value) and 0 <= value <= 1:
                        scores[L["id"]], layer_data[L["id"]] = value, detail
            # The browser uses these same unrounded metric values and aggregation policy.
            result = aggregate_similarity(scores, dimensions, [k for k, d in dimensions.items() if d["default_on"]],
                body=t["body"], not_applicable=not_applicable, dimension_weights=types[ttype].get("dimension_weights", {}))
            overall = result["score"]
            comparisons.append({
                "earth": e["id"], "target": t["id"], "res_m": res, "target_type": ttype,
                "is_pair": any(p["earth"] == e["id"] and p["target"] == t["id"] for p in cfg["pairs"]),
                "scores": scores,
                "not_applicable": not_applicable,
                "score_excluded": [k for k, d in dimensions.items() if t["body"] in d.get("score_excluded_bodies", [])],
                "overall": overall, "verdict": verdict(overall),
                "observed_score": result["observed_score"], "coverage": result["coverage"], "groups": result["groups"],
                "comparison_extent_km": extent,
                "calculation_source": "exported terrain at its actual resolution" if t["id"] in fallback else "cached native DEM",
                "measurement_caveats": ["Temperature endpoints have different local-time/seasonal support; midpoint and swing are provisional proxies."] if "cold" in scores or "thermal_amplitude" in scores else [],
                "notes": explain(fe, ft, e["name"], t["name"]),
                "layers": layer_data,
                "earth_features": public_features(fe), "target_features": public_features(ft),
            })
            rows.append((result["observed_score"], e, scores))
        rows.sort(key=lambda x: -(x[0] if x[0] is not None else -1))
        cols = [k for k in dimensions if any(k in sc for _, _, sc in rows)]
        hdr = "  ".join(f"{k[:7]:>7}" for k in cols)
        print(f"  {'rank':<4} {'earth site':<28} {'overall':>7}  {hdr}")
        for i, (ov, e, sc) in enumerate(rows, 1):
            cells = "  ".join(f"{sc[k]:7.2f}" if k in sc else f"{'-':>7}" for k in cols)
            mark = " *" if e["role"] == "control" else " #" if "team" in e.get("tags", []) else ""
            print(f"  {i:<4} {(e['name'] + mark)[:30]:<30} {ov if ov is not None else float('nan'):7.2f}  {cells}")
    print("\n(* = control site; it should rank below the real candidates; # = #team place)")
    print("(table shows observed similarity; overall is withheld below the configured evidence coverage)")

    out = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "site_types": {k: {"label": v["label"], "short": v["short"], "description": v["description"],
                           "metrics": v["metrics"], "dimension_weights": v.get("dimension_weights", {})} for k, v in types.items()},
        "scoring": policy(),
        "dimensions": dimensions,
        "bins": {"slope_deg": r(SLOPE_BINS, 2), "rough_log10_tri": r(ROUGH_BINS, 3),
                 "profile_r": r(PROFILE_R, 4), "hypsometry_area": r(HYPSO_Q, 3),
                 "illum_lit_fraction": r((ILLUM_BINS[1:] + ILLUM_BINS[:-1]) / 2, 4),
                 "spectrum_wavelength_m": r(SPECTRUM_WAVELENGTHS, 1)},
        "sites": site_out,
        "data_sources": data_sources,
        "pairs": cfg["pairs"],
        "comparisons": comparisons,
    }
    (WEB_DATA_DIR / "results.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    validation = []
    for pair in cfg["pairs"]:
        matches = [c for c in comparisons if c["target"] == pair["target"]]
        analog = next((c for c in matches if c["earth"] == pair["earth"]), None)
        controls = [c for c in matches if site_out[c["earth"]]["role"] == "control"]
        if analog:
            validation.append({**pair, "analog": {k: analog[k] for k in ("overall", "observed_score", "coverage")},
                "controls": [{"earth": c["earth"], **{k: c[k] for k in ("overall", "observed_score", "coverage")}} for c in controls],
                "note": "Diagnostic only. No rank bonuses or tolerance fitting to force analogs above controls."})
    (WEB_DATA_DIR / "calculation_validation.json").write_text(json.dumps({"scoring_version": policy()["version"], "pairs": validation}, indent=2), encoding="utf-8")
    print(f"\nWrote {WEB_DATA_DIR / 'results.json'}")
    subprocess.run(["node", str(ROOT / "scripts" / "export_evidence.mjs")], check=True)


if __name__ == "__main__":
    main()
