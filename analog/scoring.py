"""Coverage-aware geometric aggregation of normalized suitability metrics."""

import math
from numbers import Real


GROUPS = {
    "slope": {"weight": 1.0, "metrics": {"slope": 1.0}},
    "temperature": {"weight": 1.0, "metrics": {"cold": 0.5, "swing": 0.5}},
    "dust": {"weight": 1.0, "metrics": {"dust": 1.0}},
    "plants": {"weight": 1.0, "metrics": {"plants": 1.0}},
}

MOON_GROUPS = {
    "slope": {"weight": 1.0, "metrics": {"slope": 1.0}},
    "temperature": {"weight": 1.0, "metrics": {"midnight_temp": 1.0}},
    "regolith": {"weight": 1.0, "metrics": {"rock_abundance": 1.0}},
    "materials": {"weight": 1.0, "metrics": {"albedo": 1.0}},
}


def _finite_number(value):
    return isinstance(value, Real) and not isinstance(value, bool) and math.isfinite(value)


def _mean(values):
    if not values:
        return None
    if any(score == 0 for score, _ in values):
        return 0.0
    return math.exp(math.fsum(weight * math.log(score) for score, weight in values)
                    / math.fsum(weight for _, weight in values))


def aggregate_scores(scores, groups=None, min_coverage=0.8):
    """Aggregate 0–1 scores; missing/invalid values reduce weighted coverage.

    Zero is a veto. Disabled (zero-weight) metrics/groups do not affect coverage.
    Invalid metric values are reported separately from missing values.
    """
    if not _finite_number(min_coverage) or not 0 <= min_coverage <= 1:
        raise ValueError("min_coverage must be a finite number between 0 and 1")
    groups = GROUPS if groups is None else groups
    total_weight = 0.0
    observed = []
    breakdown, details = {}, {}
    invalid_metrics = []
    for name, config in groups.items():
        weight = config["weight"]
        metric_weights = config["metrics"]
        if not _finite_number(weight) or weight < 0:
            raise ValueError(f"Invalid group weight: {name}")
        if any(not _finite_number(w) or w < 0 for w in metric_weights.values()):
            raise ValueError(f"Invalid metric weight in group: {name}")
        expected = math.fsum(metric_weights.values())
        if expected <= 0:
            raise ValueError(f"Group needs a positive metric weight: {name}")
        if weight == 0:
            continue
        total_weight += weight
        valid = []
        metric_scores = {}
        for key, metric_weight in metric_weights.items():
            if metric_weight == 0:
                continue
            value = scores.get(key)
            if value is None:
                metric_scores[key] = None
            elif not _finite_number(value) or not 0 <= value <= 1:
                invalid_metrics.append(key)
                metric_scores[key] = None
            else:
                metric_scores[key] = value
                valid.append((value, metric_weight))
                observed.append((value, weight * metric_weight / expected))
        coverage = math.fsum(w for _, w in valid) / expected
        group_score = _mean(valid)
        breakdown[name] = group_score
        details[name] = {"score": group_score, "coverage": coverage,
                         "metric_scores": metric_scores}
    coverage = math.fsum(w for _, w in observed) / total_weight if total_weight else 0.0
    coverage = min(1.0, coverage)
    observed_score = _mean(observed)
    return {
        "score": round(observed_score, 4) if observed_score is not None and coverage >= min_coverage else None,
        "observed_score": observed_score,
        "coverage": round(coverage, 4),
        "breakdown": breakdown,
        "groups": details,
        "invalid_metrics": sorted(set(invalid_metrics)),
    }
