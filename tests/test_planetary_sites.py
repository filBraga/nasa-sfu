import json
from pathlib import Path
import unittest

from scripts.import_planetary_sites import imported_targets

ROOT = Path(__file__).resolve().parents[1]


class PlanetarySiteTests(unittest.TestCase):
    def test_import_preserves_existing_sites_and_is_idempotent(self):
        config = json.loads((ROOT / 'config/sites.json').read_text(encoding='utf-8'))
        original = [s for s in config['sites'] if 'planetary_import' not in s.get('tags', [])]
        added = imported_targets({'sites': original})
        self.assertEqual(len(added), 12)
        self.assertEqual(sum(s['body'] == 'moon' for s in added), 8)
        self.assertEqual(sum(s['body'] == 'mars' for s in added), 4)
        self.assertEqual(imported_targets({'sites': original + added}), [])
        self.assertNotIn('shackleton_crater', [s['id'] for s in added])

    def test_research_locations_have_selectable_targets(self):
        config = json.loads((ROOT / 'config/sites.json').read_text(encoding='utf-8'))
        by_id = {s['id']: s for s in config['sites']}
        for body in ('moon', 'mars'):
            source = json.loads((ROOT / f'{body}-data/{body}_data.json').read_text(encoding='utf-8'))
            for site in source['sites']:
                sid = 'shackleton' if site['id'] == 'shackleton_crater' else site['id']
                self.assertEqual(by_id[sid]['role'], 'target')
                self.assertEqual(by_id[sid]['body'], body)

    def test_cached_lunar_orientation_and_units(self):
        import math
        import rasterio
        validation = json.loads((ROOT / 'moon-data/data/enrichment/sampling_validation.json').read_text())
        with rasterio.open(ROOT / 'moon-data/data/rasters/ldem_16.tif') as image:
            for check in validation['checks']:
                row = min(2879, math.floor((90 - check['lat']) * 16))
                col = math.floor(((check['lon_e'] + 180) % 360) * 16)
                height = float(image.read(1, window=((row, row + 1), (col, col + 1)))[0, 0]) * 1000
                self.assertAlmostEqual(height, check['actual_m'], places=2)


if __name__ == '__main__':
    unittest.main()
