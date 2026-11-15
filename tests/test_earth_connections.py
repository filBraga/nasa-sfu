import copy
import json
from pathlib import Path
import unittest

from scripts.import_team_places import connect_all_map_places

ROOT = Path(__file__).resolve().parents[1]


class EarthConnectionTests(unittest.TestCase):
    def test_all_map_entries_are_linked_and_import_is_idempotent(self):
        places = json.loads((ROOT / 'web/data/places_all.json').read_text(encoding='utf-8'))
        cfg = json.loads((ROOT / 'config/sites.json').read_text(encoding='utf-8'))
        original = copy.deepcopy(cfg)
        self.assertEqual(len(places), 50)
        self.assertEqual(connect_all_map_places(places, cfg), [])
        self.assertEqual(cfg, original)
        by_id = {s['id']: s for s in cfg['sites']}
        for place in places:
            site = by_id[place['site_id']]
            self.assertEqual(site['body'], 'earth')
            self.assertEqual((site['lat'], site['lon']), (place['lat'], place['lon']))
        self.assertEqual(sum(s['body'] == 'earth' for s in cfg['sites']), 61)

    def test_new_connections_do_not_convert_map_percentages_to_measurements(self):
        place = {'id': 'example', 'region': '', 'lat': 20, 'lon': 10,
                 'targets': ['Moon'], 'scores': {'cold': 95, 'dust': 90}}
        cfg = {'sites': []}
        added = connect_all_map_places([place], cfg)
        self.assertEqual(added[0]['compare_bodies'], ['moon'])
        self.assertNotIn('scores', added[0])
        self.assertNotIn('facts', added[0])
        self.assertTrue(added[0]['name'])
        self.assertEqual(place['site_id'], added[0]['id'])


if __name__ == '__main__':
    unittest.main()
