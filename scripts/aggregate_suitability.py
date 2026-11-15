"""Reaggregate saved metric scores without changing their normalization."""

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analog.scoring import GROUPS, MOON_GROUPS, aggregate_scores


def main():
    for path in sorted((ROOT / "web" / "data").glob("suitability_scores*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        groups = MOON_GROUPS if data.get("mode") == "moon_absolute" else GROUPS
        for site in data["scores"].values():
            metrics = {key: value for group in site["groups"].values()
                       for key, value in group.get("metric_scores", {}).items()}
            site.update(aggregate_scores(metrics, groups))
        data["aggregation"] = {"method": "weighted_geometric_mean", "min_coverage": 0.8,
                               "zero_is_veto": True, "groups": groups}
        path.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(f"Updated {path.name}: {len(data['scores'])} sites")


if __name__ == "__main__":
    main()
