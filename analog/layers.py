"""Data layers (temperature, albedo, radar, ...) delivered as GeoTIFFs by the data teams.

Contract: data/layers/<layer_id>/<site_id>.tif, any resolution, any CRS as long as the CRS
belongs to the right body (EPSG:4326 for Earth, IAU_2015:49900 for Mars, IAU_2015:30100 for
the Moon, or a projected CRS on those). Each file is reprojected onto the same local grid the
terrain analysis uses, then compared as a distribution.
"""

import json
import math

import numpy as np
import rasterio
from pyproj import CRS as PyCRS
from rasterio.warp import Resampling, reproject
from scipy.stats import wasserstein_distance

from . import ROOT
from .facts import FACTS_DIR, read_facts
from .sources import local_crs, local_grid

LAYER_DIR = ROOT / "data" / "layers"
REGISTRY = ROOT / "config" / "layers.json"
BODY_RADIUS_M = {"earth": 6378137.0, "moon": 1737400.0, "mars": 3396190.0}
MIN_COVERAGE = 0.2  # fraction of the site window that must have data
N_BINS = 30


def load_registry():
    if not REGISTRY.exists():
        return []
    return json.loads(REGISTRY.read_text(encoding="utf-8"))["layers"]


def layer_file(layer_id, site_id):
    p = LAYER_DIR / layer_id / f"{site_id}.tif"
    return p if p.exists() else None


def check_body(crs, body, path):
    """Catch the classic mistake of tagging Moon/Mars data with an Earth CRS (or vice versa)."""
    a = PyCRS.from_wkt(crs.to_wkt()).ellipsoid.semi_major_metre
    expected = BODY_RADIUS_M[body]
    if abs(a - expected) / expected > 0.02:
        raise ValueError(f"{path.name}: CRS radius {a / 1000:.0f} km does not match {body} "
                         f"({expected / 1000:.0f} km). Use EPSG:4326 for Earth, IAU_2015:49900 for Mars, "
                         f"IAU_2015:30100 for the Moon.")


def load_on_grid(path, site, res, resampling=Resampling.bilinear):
    """Reproject a layer GeoTIFF onto the site's local grid at `res` metres/pixel."""
    crs = local_crs(site["body"], site["lat"], site["lon"])
    n, _, transform = local_grid(site["window_km"], res)
    dst = np.full((n, n), np.nan, np.float32)
    with rasterio.open(path) as ds:
        if ds.crs is None:
            raise ValueError(f"{path.name} has no CRS")
        check_body(ds.crs, site["body"], path)
        reproject(rasterio.band(ds, 1), dst, dst_transform=transform, dst_crs=crs,
                  dst_nodata=np.nan, resampling=resampling)
    return dst


class Constant(float):
    """A known value for a whole site instead of a raster, e.g. 'Mars has no vegetation' (100% barren)."""


def fact_value(layer, site_id):
    """One number per site from data/facts/<kind>/<site_id>.json, for layers defined by `facts`,
    e.g. {"kind": "temperature", "mean_of": ["low_k", "high_k"]}. None when the fact is missing."""
    spec = layer["facts"]
    fact = read_facts(site_id).get(spec["kind"])
    if not fact:
        return None
    vals = [fact.get(k) for k in spec["mean_of"]]
    if any(v is None for v in vals):
        return None
    return float(np.mean(vals))


def site_values(layer, site, res, log=print):
    """Finite layer values for a site, a Constant for bodies the layer defines by a known value,
    or None when there is no (usable) file."""
    if site["body"] != "earth" and layer.get("planetary_value") is not None:
        return Constant(layer["planetary_value"])
    if layer.get("facts"):  # a single site-wide value, compared as a one-point distribution
        v = fact_value(layer, site["id"])
        return None if v is None else np.array([v], np.float32)
    path = layer_file(layer["id"], site["id"])
    if path is None:
        return None
    # threshold layers must not blend pixels (blending 0.1 and 0.5 gives 0.3 and moves the count)
    resampling = Resampling.nearest if layer.get("compare") in ("fraction_below", "fraction") else Resampling.bilinear
    try:
        grid = load_on_grid(path, site, res, resampling)
    except Exception as exc:
        log(f"    [layer {layer['id']}] {site['id']}: SKIPPED - {exc}")
        return None
    v = grid[np.isfinite(grid)]
    if v.size == 0 or v.size < MIN_COVERAGE * grid.size:
        log(f"    [layer {layer['id']}] {site['id']}: SKIPPED - only {v.size / grid.size:.0%} coverage")
        return None
    return v


def _normalize(v, how):
    if how == "zscore":
        return (v - v.mean()) / max(float(v.std()), 1e-9)
    if how == "minmax":
        lo, hi = np.percentile(v, [2, 98])
        return np.clip((v - lo) / max(hi - lo, 1e-9), 0, 1)
    return v


def _sample(v, k=100_000):
    if v.size <= k:
        return v
    return np.random.default_rng(0).choice(v, size=k, replace=False)


def _compare_ratio(layer, a, b):
    """Compare the sites' typical values as a ratio: score = 0.5 ** (log(ratio) / log(halving)).
    With halving = 4 the score halves for every 4x difference (1x -> 1.0, 4x -> 0.5, 16x -> 0.25).
    Used when the bodies differ by orders of magnitude (e.g. day-night swing: Earth ~10 K, Moon ~150 K)."""
    floor = float(layer.get("ratio_floor", 0.1))
    ma, mb = max(float(np.median(a)), floor), max(float(np.median(b)), floor)
    score = 0.5 ** (abs(math.log(ma / mb)) / math.log(float(layer.get("ratio_halving", 4))))
    la, lb = np.log10(np.clip(_sample(a), floor, None)), np.log10(np.clip(_sample(b), floor, None))
    lo = float(min(np.percentile(la, 1), np.percentile(lb, 1)))
    hi = max(float(max(np.percentile(la, 99), np.percentile(lb, 99))), lo + 1e-6)
    bins = np.linspace(lo, hi, N_BINS + 1)
    rd = lambda x: [round(float(y), 5) for y in x]
    return score, {
        "kind": "ratio", "normalized": "log10",
        "x_label": f"log10 {layer.get('unit') or 'value'}",
        "bins": rd(bins),
        "earth_hist": rd(np.histogram(np.clip(la, lo, hi), bins, density=True)[0]),
        "target_hist": rd(np.histogram(np.clip(lb, lo, hi), bins, density=True)[0]),
        "earth_median": round(ma, 3), "target_median": round(mb, 3),
        "ratio": round(mb / ma, 2),
    }


def _threshold_for(layer, body):
    """(value, direction) for a body. Layers whose data differ by body (e.g. dust: Earth soil %
    vs Mars emissivity index) give per-body thresholds in `thresholds`."""
    t = (layer.get("thresholds") or {}).get(body)
    if t:
        return float(t["value"]), t.get("direction", "below")
    return float(layer["threshold"]), layer.get("direction", "below")


def _compare_fraction(layer, a, b, body_a="earth", body_b=None):
    """Compare the share of each site below (or above) a threshold (e.g. NDVI < 0.2 = barren)."""
    def frac(v, body):
        if isinstance(v, Constant):
            return float(v)
        thr, d = _threshold_for(layer, body)
        return float(((v > thr) if d == "above" else (v < thr)).mean())
    fa, fb = frac(a, body_a), frac(b, body_b or body_a)
    thr, direction = _threshold_for(layer, body_a)
    t_thr, t_dir = _threshold_for(layer, body_b or body_a)
    above = direction == "above"
    score = math.exp(-abs(fa - fb) / float(layer["scale"]))
    rd = lambda x: [round(float(y), 5) for y in x]
    out = {"kind": "fraction", "threshold": thr, "direction": direction,
           "target_threshold": t_thr, "target_direction": t_dir,
           "earth_value": round(fa, 4), "target_value": round(fb, 4),
           "target_is_constant": isinstance(b, Constant)}
    if not isinstance(a, Constant):  # histogram of the Earth site's raw values, for context
        lo, hi = float(np.percentile(a, 1)), float(np.percentile(a, 99))
        hi = max(hi, lo + 1e-6)
        bins = np.linspace(min(lo, thr), max(hi, thr), N_BINS + 1)
        out.update(bins=rd(bins), earth_hist=rd(np.histogram(np.clip(a, bins[0], bins[-1]), bins, density=True)[0]))
    return score, out


def earth_range(layer, sites):
    """(lowest, highest) typical value over all Earth sites, for compare = "relative" layers."""
    vals = [fact_value(layer, s["id"]) for s in sites if s["body"] == "earth"]
    vals = [v for v in vals if v is not None]
    return (min(vals), max(vals)) if vals else None


def _compare_relative(layer, a, b):
    """Score the Earth site against the other Earth sites, not against the target directly:
    lowest Earth value = 1.0, highest = 0.0. Used for `cold`: every Earth site is far warmer than
    Mars and the Moon, so a raw temperature gap scores them all near 0; colder = closer is fair."""
    if not layer.get("_range"):
        raise ValueError(f"layer {layer['id']}: relative compare needs the Earth range (set by analyze.py)")
    lo, hi = layer["_range"]
    ta, tb = float(np.median(a)), float(np.median(b))
    score = float(np.clip((hi - ta) / max(hi - lo, 1e-9), 0.0, 1.0))
    return score, {"kind": "relative", "earth_value": round(ta, 1), "target_value": round(tb, 1),
                   "earth_min": round(lo, 1), "earth_max": round(hi, 1)}


def compare_layer(layer, a, b, body_a="earth", body_b=None):
    """Score two sites' layer values; returns the score plus chart data for the viewer."""
    if layer.get("compare") == "relative":
        return _compare_relative(layer, a, b)
    if layer.get("compare") in ("fraction_below", "fraction"):
        return _compare_fraction(layer, a, b, body_a, body_b)
    if layer.get("compare") == "ratio":
        if isinstance(a, Constant) or isinstance(b, Constant):
            raise ValueError(f"layer {layer['id']}: ratio compare needs rasters on both sides")
        return _compare_ratio(layer, a, b)
    if isinstance(a, Constant) or isinstance(b, Constant):
        raise ValueError(f"layer {layer['id']}: planetary_value needs compare = fraction_below")
    how = layer.get("normalize", "none")
    na, nb = _normalize(_sample(a), how), _normalize(_sample(b), how)
    w = wasserstein_distance(na, nb)
    score = math.exp(-w / float(layer["scale"]))
    lo = float(min(np.percentile(na, 1), np.percentile(nb, 1)))
    hi = float(max(np.percentile(na, 99), np.percentile(nb, 99)))
    if hi <= lo:
        hi = lo + 1e-6
    bins = np.linspace(lo, hi, N_BINS + 1)
    rd = lambda x: [round(float(y), 5) for y in x]
    return score, {
        "normalized": how,
        "distance": round(float(w), 5),
        "bins": rd(bins),
        "earth_hist": rd(np.histogram(np.clip(na, lo, hi), bins, density=True)[0]),
        "target_hist": rd(np.histogram(np.clip(nb, lo, hi), bins, density=True)[0]),
        "earth_median": round(float(np.median(a)), 4),
        "target_median": round(float(np.median(b)), 4),
    }


def inventory(layers, site_ids):
    """Which layer files exist, and which files don't match any site (typo in the name?)."""
    report = {}
    for layer in layers:
        if layer.get("facts"):  # values come from data/facts/<kind>/, not from GeoTIFFs
            d = FACTS_DIR / layer["facts"]["kind"]
            found = sorted(p.stem for p in d.glob("*.json")) if d.exists() else []
            report[layer["id"]] = {"sites": [s for s in found if s in site_ids], "unknown_files": []}
            continue
        d = LAYER_DIR / layer["id"]
        found = sorted(p.stem for p in d.glob("*.tif")) if d.exists() else []
        report[layer["id"]] = {
            "sites": [s for s in found if s in site_ids],
            "unknown_files": [s for s in found if s not in site_ids],
        }
    return report
