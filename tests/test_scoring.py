import math
import unittest

from analog.scoring import aggregate_scores


class ScoringTests(unittest.TestCase):
    def test_equal_categories(self):
        result = aggregate_scores(dict(slope=1, cold=.25, swing=.25, dust=1, plants=1))
        self.assertAlmostEqual(result['observed_score'], .25 ** .25)
        self.assertEqual(result['coverage'], 1)

    def test_missing_temperature_metric(self):
        result = aggregate_scores(dict(slope=1, swing=1, dust=1, plants=1))
        self.assertEqual(result['coverage'], .875)
        self.assertEqual(result['groups']['temperature']['coverage'], .5)
        self.assertEqual(result['score'], 1)

    def test_missing_category_suppresses_score(self):
        result = aggregate_scores(dict(slope=1, cold=1, swing=1, dust=1))
        self.assertIsNone(result['score'])
        self.assertEqual(result['observed_score'], 1)
        self.assertEqual(result['coverage'], .75)

    def test_zero_is_exact_veto(self):
        result = aggregate_scores(dict(slope=0, cold=1, swing=1, dust=1, plants=1))
        self.assertEqual(result['score'], 0)

    def test_invalid_values_are_diagnosed(self):
        for value in ('bad', True, math.nan, math.inf, -1, 2):
            result = aggregate_scores({'slope': value})
            self.assertIsNone(result['score'])
            self.assertEqual(result['invalid_metrics'], ['slope'])

    def test_empty_data(self):
        result = aggregate_scores({})
        self.assertIsNone(result['observed_score'])
        self.assertEqual(result['coverage'], 0)

    def test_bad_configuration(self):
        for weight in (-1, math.nan, math.inf, '1'):
            with self.assertRaises(ValueError):
                aggregate_scores({}, {'x': {'weight': 1, 'metrics': {'x': weight}}})
        for threshold in (-1, 2, math.nan):
            with self.assertRaises(ValueError):
                aggregate_scores({}, min_coverage=threshold)

    def test_disabled_metrics_do_not_reduce_coverage(self):
        result = aggregate_scores({'x': .5}, {'g': {'weight': 1, 'metrics': {'x': 1, 'y': 0}}})
        self.assertEqual(result['coverage'], 1)
        self.assertEqual(result['score'], .5)


if __name__ == '__main__':
    unittest.main()
