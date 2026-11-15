"""Similarity scores (0 = nothing alike, 1 = identical) between two sites' terrain features.

Each dimension is scored separately so the result shows *where* the analogy holds
and where it breaks, which is what the challenge asks for. Which dimensions are used
depends on the target's site type (config/site_types.json).
"""

import math

import numpy as np
from scipy.stats import wasserstein_distance

# name: (weight, label, explanation)
METRICS = {
    "slope":         (0.20, "Slope distribution", "Wasserstein distance between slope histograms (scale 8 deg)"),
    "roughness":     (0.15, "Surface roughness", "Wasserstein distance of log10 Terrain Ruggedness Index (scale 0.3)"),
    "hypsometry":    (0.15, "Hypsometry", "Mean gap between normalised elevation-area curves (scale 0.08)"),
    "profile":       (0.30, "Crater profile shape", "Lower-quartile correlation of 8 compass-sector radial profiles with the target profile (r/R 0-1.5)"),
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
    "profile": ("Whether the site has the same bowl-and-rim shape in all 8 compass directions as the target crater. "
                "Distances are divided by the crater radius, so different-sized craters can be compared.",
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
    lo, hi = np.nanmin(p), np.nanmax(p)
    out = (p - lo) / max(hi - lo, 1e-6)
    return out, ok


def _profile(a, b):
    # Correlate each compass sector of `a` with the target's mean profile, then average:
    # only terrain with a crater-like shape in every direction scores high.
    pb, okb = _norm(b["profile"])
    corrs = []
    for sec in a["sector_profiles"]:
        pa, oka = _norm(sec)
        ok = oka & okb
        c = np.corrcoef(pa[ok], pb[ok])[0, 1] if ok.sum() > 5 else 0.0
        corrs.append(c if np.isfinite(c) else 0.0)
    # A mountain can resemble a crater in a few directions. Require at least
    # three quarters of the compass sectors to share the target's bowl shape.
    return max(0.0, float(np.quantile(corrs, 0.25)))


def _depth(a, b):
    da, db = a["depth_over_diameter"], b["depth_over_diameter"]
    return 0.0 if da <= 0 or db <= 0 else 0.5 ** abs(math.log2(da / db))


def _texture(a, b):
    sa, sb = a["spectrum"], b["spectrum"]
    ok = np.isfinite(sa) & np.isfinite(sb)
    if ok.sum() < 4:
        return None  # windows share too few measurable wavelengths
    da, db = sa[ok] - sa[ok].mean(), sb[ok] - sb[ok].mean()  # compare shape, not amplitude
    return math.exp(-float(np.mean(np.abs(da - db))) / 0.3)


SCORERS = {
    "slope": lambda a, b: math.exp(-wasserstein_distance(a["slope_samples"], b["slope_samples"]) / 8.0),
    "roughness": lambda a, b: math.exp(-wasserstein_distance(a["rough_samples"], b["rough_samples"]) / 0.3),
    "hypsometry": lambda a, b: math.exp(-float(np.mean(np.abs(a["hypsometry"] - b["hypsometry"]))) / 0.08),
    "profile": _profile,
    "depth": _depth,
    "flat_fraction": lambda a, b: math.exp(-abs(a["flat_fraction"] - b["flat_fraction"]) / 0.15),
    "illumination": lambda a, b: math.exp(-wasserstein_distance(a["illum_samples"], b["illum_samples"]) / 0.15),
    "texture": _texture,
}


def score_pair(a, b, metrics=None):
    """Score the listed metrics (default: the original crater set). Metrics that can't be
    measured for this pair are left out rather than scored 0."""
    metrics = metrics or ["slope", "roughness", "hypsometry", "profile", "depth"]
    s = {}
    for k in metrics:
        v = SCORERS[k](a, b)
        if v is not None:
            s[k] = v
    overall = weighted_geometric_mean((v, METRICS[k][0]) for k, v in s.items())
    return s, overall


def weighted_geometric_mean(values):
    """Combine 0-1 matches without letting a strong dimension erase a failure.

    Only measured dimensions are passed in. A measured zero is a genuine mismatch;
    missing dimensions are not silently treated as zero.
    """
    pairs = list(values)
    if not pairs:
        return None
    total_weight = sum(weight for _, weight in pairs)
    if total_weight <= 0 or any(not math.isfinite(weight) or not math.isfinite(score)
                             or weight < 0 or not 0 <= score <= 1 for score, weight in pairs):
        raise ValueError("scores must be in [0, 1] and weights must be nonnegative with a positive total")
    if any(score == 0 and weight > 0 for score, weight in pairs):
        return 0.0
    return math.exp(sum(weight * math.log(score) for score, weight in pairs if weight > 0) / total_weight)


def verdict(score):
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
