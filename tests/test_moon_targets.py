import copy
import json
from pathlib import Path
import unittest

from scripts.add_moon_targets import add_targets

ROOT = Path(__file__).resolve().parents[1]


class MoonTargetsTests(unittest.TestCase):
    def test_catalog_import_is_idempotent_and_preserves_mars(self):
        cfg = json.loads((ROOT / 'config/sites.json').read_text(encoding='utf-8'))
        mars = copy.deepcopy([s for s in cfg['sites'] if s['body'] == 'mars'])
        original_ids = [s['id'] for s in cfg['sites']]
        added = add_targets(cfg)
        self.assertEqual(len(added), 114)
        self.assertEqual(original_ids, [s['id'] for s in cfg['sites']])
        self.assertEqual(mars, [s for s in cfg['sites'] if s['body'] == 'mars'])
        self.assertEqual(len({s['id'] for s in cfg['sites']}), len(cfg['sites']))
        self.assertTrue(any(s['type'] == 'crater' for s in added))
        self.assertTrue(any(s['type'] == 'landing_zone' for s in added))

    def test_global_moon_windows_cross_seam_and_reach_poles(self):
        import numpy as np
        from analog.sources import fetch_moon_global
        for lat, lon in ((0, 179.9), (-89.5, 0)):
            z, _, _ = fetch_moon_global({'lat': lat, 'lon': lon, 'window_km': 80}, 2000, log=lambda *_: None)
            self.assertEqual(z.shape, (40, 40))
            self.assertTrue(np.isfinite(z).all())
            self.assertGreater(float(z.max() - z.min()), 0)


if __name__ == '__main__':
    unittest.main()
