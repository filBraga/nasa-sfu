"""Similarity scores (0 = nothing alike, 1 = identical) between two sites' terrain features.

Each dimension is scored separately so the result shows *where* the analogy holds
and where it breaks, which is what the challenge asks for. Which dimensions are used
depends on the target's site type (config/site_types.json).
"""

import math

import numpy as np
from scipy.stats import wasserstein_distance
from .similarity import exponential_similarity, geometric_mean, policy

# name: (weight, label, explanation)
# The team compares four equal categories: slope, temperature (cold + swing), dust and plants
# (the last three are data layers in config/layers.json, weights 0.5 + 0.5, 1, 1). Slope is the
# only terrain metric in the default score; the others are still computed and can be ticked in
# the viewer, where they count with the weights below.
DEFAULT_ON = {"slope"}
METRICS = {
    "slope":         (1.00, "Slope distribution", "Wasserstein distance between slope histograms (scale 8 deg)"),
    "roughness":     (0.15, "Surface roughness", "Wasserstein distance of log10 Terrain Ruggedness Index (scale 0.3)"),
    "hypsometry":    (0.15, "Hypsometry", "Mean gap between normalised elevation-area curves (scale 0.08)"),
    "profile":       (0.30, "Crater profile shape", "Exponential similarity of normalized compass-sector height distributions at matched r/R; symmetric and rotation-independent; provisional tolerance"),
    "depth":         (0.20, "Depth / diameter", "Log-ratio of depth/diameter (score 0.5 at a 2x difference)"),
    "flat_fraction": (0.20, "Flat ground (< 5 deg)", "Difference in the share of area flatter than 5 deg (scale 0.15)"),
    "illumination":  (0.30, "Sunlight at low sun", "Wasserstein distance of per-pixel lit fraction over 16 sun azimuths at the target's sun elevation, with body curvature (scale 0.15)"),
    "texture":       (0.20, "Terrain texture", "Mean gap between normalised log power spectra, 100 m - 20 km wavelengths (scale 0.3)"),
}

# Plain-language description and where the code is, shown when hovering a dimension in the viewer.
METRIC_INFO = {
    "slope": ("How steep the ground is at every pixel. The whole spread of steepness is compared, not just the average.",
              "analog/terrain.py: slope_deg()"),
    "roughness": ("How bumpy the ground is: the average height difference between each pixel and its 8 neighbours "
                  "(Terrain Ruggedness Index).", "analog/terrain.py: tri()"),
    "hypsometry": ("How much of the area is high ground versus low ground, i.e. the shape of the landscape's "
                   "elevation distribution.", "analog/terrain.py: hypsometry()"),
    "profile": ("Difference between normalized sector-height distributions at each normalized radius. "
                "Symmetric and independent of compass orientation; crater amplitude is assessed separately by depth/diameter.",
                "analog/terrain.py: radial_profile(); analog/compare.py: _profile()"),
    "depth": ("How deep the crater is relative to its width (rim height minus floor, divided by diameter).",
              "analog/terrain.py: crater_metrics()"),
    "flat_fraction": ("Share of the ground flatter than 5 degrees: where a lander or habitat could sit.",
                      "analog/terrain.py: site_features() (flat_fraction)"),
    "illumination": ("From how many of 16 directions each spot gets sunlight when the Sun is just above the horizon "
                     "(1.5 degrees at the lunar south pole). Computed from terrain shadows out to 20 km, including the "
                     "planet's curvature.", "analog/terrain.py: illumination()"),
    "texture": ("The pattern of hills and hollows at scales from 100 m to 20 km (shape of the terrain's power spectrum).",
                "analog/terrain.py: power_spectrum()"),
}


def _norm(p):
    p = np.asarray(p, float)
    ok = np.isfinite(p)
    if not ok.any():
        return np.zeros_like(p), ok
    lo, hi = np.min(p[ok]), np.max(p[ok])
    out = (p - lo) / max(hi - lo, 1e-6)
    return out, ok


def _profile(a, b):
    # Compare distributions of normalized compass-sector heights at each r/R.
    # Symmetric, orientation independent, and identical valid sites score exactly 1.
    def sectors(f):
        profiles = np.atleast_2d(f.get("sector_profiles", f.get("profile", [])))
        return [_norm(row)[0] for row in profiles if np.isfinite(row).sum() >= 6]
    aa, bb = sectors(a), sectors(b)
    if not aa or not bb or len(aa[0]) != len(bb[0]):
        return None
    distances = []
    for left, right in zip(np.asarray(aa).T, np.asarray(bb).T):
        left, right = left[np.isfinite(left)], right[np.isfinite(right)]
        if len(left) and len(right):
            distances.append(wasserstein_distance(left, right))
    return _similarity("profile", float(np.mean(distances))) if len(distances) >= 6 else None


def _depth(a, b):
    da, db = a["depth_over_diameter"], b["depth_over_diameter"]
    if not np.isfinite([da, db]).all() or min(da, db) < 0:
        return None
    if da == db == 0:
        return 1.0
    return _similarity("depth", math.inf if min(da, db) == 0 else abs(math.log(da) - math.log(db)))


def _texture(a, b):
    sa, sb = np.asarray(a["spectrum"], float), np.asarray(b["spectrum"], float)
    ok = np.isfinite(sa) & np.isfinite(sb)
    if ok.sum() < 4:
        return None  # windows share too few measurable wavelengths
    da, db = sa[ok] - sa[ok].mean(), sb[ok] - sb[ok].mean()  # compare shape, not amplitude
    return _similarity("texture", float(np.mean(np.abs(da - db))))


def _similarity(key, distance):
    spec = policy()["metrics"][key]
    tau = spec.get("tau", spec.get("scale", 1) * math.log(2))
    return exponential_similarity(distance, tau, spec.get("p", 1))


def _wasserstein(a, b, field, metric):
    aa, bb = np.asarray(a[field], float), np.asarray(b[field], float)
    aa, bb = aa[np.isfinite(aa)], bb[np.isfinite(bb)]
    return _similarity(metric, wasserstein_distance(aa, bb)) if len(aa) and len(bb) else None


def _hypsometry(a, b):
    aa, bb = np.asarray(a["hypsometry"], float), np.asarray(b["hypsometry"], float)
    if aa.shape != bb.shape:
        return None
    ok = np.isfinite(aa) & np.isfinite(bb)
    return _similarity("hypsometry", float(np.mean(np.abs(aa[ok] - bb[ok])))) if ok.sum() >= 2 else None


SCORERS = {
    "slope": lambda a, b: _wasserstein(a, b, "slope_samples", "slope"),
    "roughness": lambda a, b: _wasserstein(a, b, "rough_samples", "roughness"),
    "hypsometry": _hypsometry,
    "profile": _profile,
    "depth": _depth,
    "flat_fraction": lambda a, b: _similarity("flat_fraction", abs(a["flat_fraction"] - b["flat_fraction"])),
    "illumination": lambda a, b: _wasserstein(a, b, "illum_samples", "illumination"),
    "texture": _texture,
}


def score_pair(a, b, metrics=None):
    """Score the listed metrics (default: the original crater set). Metrics that can't be
    measured for this pair are left out rather than scored 0."""
    metrics = ["slope", "roughness", "hypsometry", "profile", "depth"] if metrics is None else metrics
    if "res_m" in a and "res_m" in b and not math.isclose(a["res_m"], b["res_m"], rel_tol=1e-6):
        raise ValueError("Terrain metrics require matching spatial resolutions")
    s = {}
    for k in metrics:
        try:
            v = SCORERS[k](a, b)
        except (KeyError, ValueError, TypeError, IndexError):
            v = None
        if v is not None and math.isfinite(v) and 0 <= v <= 1:
            s[k] = v
    overall = geometric_mean([(v, METRICS[k][0]) for k, v in s.items()])
    return s, overall


def verdict(score):
    if score is None:
        return "insufficient_evidence"
    if score >= 0.7:
        return "strong"
    if score >= 0.4:
        return "partial"
    return "weak"


def explain(a, b, a_name, b_name):
    """Plain-language notes on the measured terrain values. (Holds/breaks lists are built in
    the viewer, because they depend on which dimensions the user has switched on.)"""
    notes = [f"Median slope {a['slope_median']:.1f} deg at {a_name} vs {b['slope_median']:.1f} deg at {b_name}."]
    notes.append(f"Flat ground (< 5 deg): {a['flat_fraction']:.0%} vs {b['flat_fraction']:.0%}.")
    if "depth_over_diameter" in a and "depth_over_diameter" in b:
        notes.append(f"Depth/diameter {a['depth_over_diameter']:.3f} vs {b['depth_over_diameter']:.3f} "
                     f"({a['depth_m']:.0f} m vs {b['depth_m']:.0f} m deep).")
    if "illum_mean" in a and "illum_mean" in b:
        notes.append(f"With the sun {b['sun_elevation_deg']} deg above the horizon, the average spot is lit from "
                     f"{a['illum_mean']:.0%} of directions at {a_name} vs {b['illum_mean']:.0%} at {b_name}.")
    return notes
