"""Shared mathematical policy for physical similarity (not a probability)."""
import json
import math
from numbers import Real
from pathlib import Path
from functools import lru_cache

CONFIG = Path(__file__).resolve().parents[1] / "config/similarity.json"


@lru_cache(maxsize=1)
def policy():
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def finite(value):
    return isinstance(value, Real) and not isinstance(value, bool) and math.isfinite(value)


def metric_category(key, definition):
    return definition.get("category") or ("terrain" if definition.get("group") == "terrain" or key == "demo_tpi" else {
        "cold": "temperature", "thermal_amplitude": "temperature",
        "surface_dust": "dust", "barren_ground": "plants", "albedo": "materials", "radar_cpr": "radar",
    }.get(key, key))


def exponential_similarity(distance, tau, exponent=1):
    if not finite(tau) or tau <= 0 or exponent not in (1, 2):
        raise ValueError("Positive finite half-similarity tolerance and exponent 1 or 2 required")
    if distance is None:
        return None
    if not isinstance(distance, Real) or isinstance(distance, bool) or math.isnan(distance) or distance < 0:
        return None
    if math.isinf(distance):
        return 0.0
    ratio = distance / tau
    if not math.isfinite(ratio) or (exponent == 2 and ratio > 1e150):
        return 0.0
    return math.exp(-math.log(2) * ratio ** exponent)


def geometric_mean(values, epsilon=1e-12):
    if not finite(epsilon) or not 0 < epsilon < 1:
        raise ValueError("epsilon must be between zero and one")
    if not values:
        return None
    scale = max(w for _, w in values)
    return min(1.0, math.exp(math.fsum((w / scale) * math.log(max(s, epsilon)) for s, w in values)
                             / math.fsum(w / scale for _, w in values)))


def aggregate_similarity(scores, dimensions, selected=None, *, body=None,
                         not_applicable=(), dimension_weights=None, config=None):
    """Fixed category budgets prevent extra correlated metrics gaining extra weight.

    Missing values affect coverage, not metric similarity. Incomplete categories
    retain their configured priority in observed similarity. Publication requires
    a configurable evidence threshold; the observed value is always separate.
    """
    config = policy() if config is None else config
    threshold, epsilon = config["min_coverage"], config["epsilon"]
    if not finite(threshold) or not 0 <= threshold <= 1:
        raise ValueError("Invalid minimum coverage")
    weights = {**config["dimension_weights"], **(dimension_weights or {})}
    if any(not finite(w) or w < 0 for w in weights.values()):
        raise ValueError("Invalid dimension weight")
    groups = {}
    excluded = set(not_applicable)
    for key in dimensions if selected is None else selected:
        d = dimensions[key]
        if key in excluded or body in d.get("score_excluded_bodies", []):
            continue
        w = d["weight"]
        if not finite(w) or w < 0:
            raise ValueError(f"Invalid metric weight: {key}")
        category = metric_category(key, d)
        group_weight = weights.get(category, 1.0)
        if w == 0 or group_weight == 0:
            continue
        group = groups.setdefault(category, {"expected": [], "values": [], "weight": group_weight})
        group["expected"].append(w)
        value = scores.get(key)
        if finite(value) and 0 <= value <= 1:
            group["values"].append((float(value), w))
    scale = max((g["weight"] for g in groups.values()), default=1)
    total = math.fsum(g["weight"] / scale for g in groups.values())
    observed, covered, details = [], 0.0, {}
    for key, g in groups.items():
        metric_scale = max(g["expected"])
        coverage = math.fsum(w / metric_scale for _, w in g["values"]) / math.fsum(w / metric_scale for w in g["expected"])
        value = geometric_mean(g["values"], epsilon)
        covered += (g["weight"] / scale) * coverage
        if value is not None:
            observed.append((value, g["weight"]))
        details[key] = {"score": value, "coverage": coverage, "weight": g["weight"]}
    coverage = min(1.0, covered / total) if total else 0.0
    value = geometric_mean(observed, epsilon)
    return {"score": value if value is not None and coverage >= threshold else None,
            "observed_score": value, "coverage": coverage, "groups": details}
