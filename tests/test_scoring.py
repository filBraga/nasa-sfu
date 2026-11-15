import unittest
import json
from pathlib import Path

from analog.compare import weighted_geometric_mean


class WeightedGeometricMeanTests(unittest.TestCase):
    @staticmethod
    def exported_results():
        path = Path(__file__).resolve().parents[1] / "web/data/results.json"
        return json.loads(path.read_text())

    def test_weak_dimension_cannot_be_hidden_by_a_strong_one(self):
        self.assertAlmostEqual(weighted_geometric_mean([(0.9, 1), (0.1, 1)]), 0.3)

    def test_zero_match_remains_zero(self):
        self.assertEqual(weighted_geometric_mean([(1, 1), (0, 1)]), 0)

    def test_only_measured_dimensions_enter_the_denominator(self):
        self.assertAlmostEqual(weighted_geometric_mean([(0.64, 2)]), 0.64)
        self.assertIsNone(weighted_geometric_mean([]))

    def test_invalid_inputs_are_rejected(self):
        for pairs in ([(1.1, 1)], [(-0.1, 1)], [(0.5, -1)], [(0.5, 0)],
                      [(float("nan"), 1)], [(0.5, float("inf"))]):
            with self.subTest(pairs=pairs), self.assertRaises(ValueError):
                weighted_geometric_mean(pairs)

    def test_exported_scores_use_the_same_rule(self):
        data = self.exported_results()
        dimensions = data["dimensions"]
        for comparison in data["comparisons"]:
            pairs = [(score, dimensions[key]["weight"])
                     for key, score in comparison["scores"].items()
                     if dimensions[key]["default_on"]]
            with self.subTest(earth=comparison["earth"], target=comparison["target"]):
                self.assertAlmostEqual(weighted_geometric_mean(pairs), comparison["overall"], delta=0.002)

    def test_known_craters_beat_controls(self):
        data = self.exported_results()
        sites = data["sites"]
        for target in ("jezero", "shackleton"):
            rows = [c for c in data["comparisons"] if c["target"] == target]
            best_crater = max(c["overall"] for c in rows if c["earth"] in
                              ("haughton", "mistastin", "pingualuit"))
            best_control = max(c["overall"] for c in rows if sites[c["earth"]]["role"] == "control")
            with self.subTest(target=target):
                self.assertGreater(best_crater, best_control)


if __name__ == "__main__":
    unittest.main()
