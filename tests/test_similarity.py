import copy
import math
import unittest

import numpy as np

from analog.compare import score_pair
from analog.layers import compare_layer
from analog.similarity import aggregate_similarity, exponential_similarity, policy


class SimilarityTests(unittest.TestCase):
    def test_half_tolerance_and_limits(self):
        for p in (1, 2):
            self.assertEqual(exponential_similarity(0, 8, p), 1)
            self.assertAlmostEqual(exponential_similarity(8, 8, p), .5)
            self.assertEqual(exponential_similarity(math.inf, 8, p), 0)
            self.assertIsNone(exponential_similarity(math.nan, 8, p))
        self.assertEqual(exponential_similarity(1e308, 1e-308, 2), 0)
        with self.assertRaises(ValueError):
            exponential_similarity(1, 0)

    def test_existing_e_folding_response_is_preserved(self):
        self.assertAlmostEqual(exponential_similarity(8, 8 * math.log(2)), math.exp(-1))

    def test_hierarchy_category_budgets_and_coverage(self):
        dims = {"a": {"weight": 1, "category": "terrain"},
                "b": {"weight": 1, "category": "terrain"},
                "c": {"weight": 1, "category": "plants"}}
        result = aggregate_similarity({"a": .25, "b": .25, "c": 1}, dims)
        self.assertAlmostEqual(result['score'], .5)
        self.assertEqual(result['coverage'], 1)
        result = aggregate_similarity({"a": 1, "b": 1}, dims)
        self.assertEqual(result['observed_score'], 1)
        self.assertEqual(result['coverage'], .5)
        self.assertIsNone(result['score'])

    def test_site_type_weights_and_invalid_missing_values(self):
        dims = {"a": {"weight": 1, "category": "terrain"}, "b": {"weight": 1, "category": "plants"}}
        result = aggregate_similarity({"a": .25, "b": 1}, dims, dimension_weights={"terrain": 3, "plants": 1})
        self.assertAlmostEqual(result['score'], .25 ** .75)
        for value in (None, math.nan, math.inf, -1, 2, True, '1'):
            result = aggregate_similarity({"a": value}, {"a": dims['a']})
            self.assertIsNone(result['observed_score'])
            self.assertEqual(result['coverage'], 0)
        with self.assertRaises(ValueError):
            aggregate_similarity({}, dims, dimension_weights={"terrain": -1})

    def test_empty_selection_zero_policy_and_body_exclusion(self):
        dims = {"a": {"weight": 1, "category": "terrain"},
                "dust": {"weight": 1, "category": "dust", "score_excluded_bodies": ['moon']}}
        self.assertIsNone(aggregate_similarity({}, dims, [])['score'])
        value = aggregate_similarity({"a": 0}, {"a": dims['a']})['score']
        self.assertAlmostEqual(value, policy()['epsilon'])
        self.assertEqual(aggregate_similarity({"a": 1, "dust": 0}, dims, body='moon')['score'], 1)

    def test_large_finite_weights_do_not_overflow(self):
        dims = {'a': {'weight': 1e308, 'category': 'terrain'},
                'b': {'weight': 1e308, 'category': 'terrain'},
                'c': {'weight': 1, 'category': 'plants'}}
        result = aggregate_similarity({'a': .25, 'b': .25, 'c': 1}, dims,
                                     dimension_weights={'terrain': 1e308, 'plants': 1e308})
        self.assertAlmostEqual(result['score'], .5)
        self.assertEqual(result['coverage'], 1)

    def test_all_metrics_identical_symmetric_and_missing(self):
        x = np.linspace(0, 1, 61)
        f = {'res_m': 200, 'slope_samples': np.array([0, 1, 2]),
             'rough_samples': np.array([0, .1, .2]), 'hypsometry': x,
             'profile': x ** 2, 'sector_profiles': np.array([x ** 2, x ** 3]),
             'depth_over_diameter': .05, 'flat_fraction': .8,
             'illum_samples': np.array([.1, .3, .5]), 'spectrum': np.linspace(1, 3, 25)}
        keys = ['slope', 'roughness', 'hypsometry', 'profile', 'depth', 'flat_fraction', 'illumination', 'texture']
        scores, overall = score_pair(f, copy.deepcopy(f), keys)
        self.assertEqual(len(scores), len(keys))
        self.assertTrue(all(abs(v - 1) < 1e-12 for v in scores.values()))
        self.assertEqual(overall, 1)
        g = copy.deepcopy(f)
        g['sector_profiles'] = np.array([x, x ** 4])
        self.assertAlmostEqual(score_pair(f, g, ['profile'])[0]['profile'], score_pair(g, f, ['profile'])[0]['profile'])
        self.assertEqual(score_pair({}, {}, ['slope']), ({}, None))
        with self.assertRaises(ValueError):
            score_pair(f, {**f, 'res_m': 2000}, ['slope'])

    def test_temperature_depends_on_target_and_ratio_keeps_halving(self):
        layer = {'compare': 'absolute', 'scale': 51.65}
        identical, _ = compare_layer(layer, np.array([250]), np.array([250]))
        farther, _ = compare_layer(layer, np.array([250]), np.array([150]))
        self.assertEqual(identical, 1)
        self.assertLess(farther, identical)
        ratio = {'compare': 'ratio', 'ratio_floor': .5, 'ratio_halving': 4}
        self.assertAlmostEqual(compare_layer(ratio, np.array([10]), np.array([40]))[0], .5)
        self.assertIsNone(compare_layer(layer, np.array([]), np.array([1]))[0])


if __name__ == '__main__':
    unittest.main()
