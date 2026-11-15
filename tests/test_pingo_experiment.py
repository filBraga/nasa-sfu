import unittest

import numpy as np

from scripts.arcadia_pingo_experiment import detect_mounds
from scripts.matched_scale_pingo import match_points, screen_local_peaks


class PingoExperimentTests(unittest.TestCase):
    def test_landform_scale_mound_is_found_but_a_plain_is_not(self):
        y, x = np.mgrid[-300:300, -300:300]
        mound = 8 * np.exp(-((2 * x)**2 + (2 * y)**2) / (2 * 70**2))
        plain = 0.001 * (2 * x + 2 * y)
        found = detect_mounds((mound + plain).astype(np.float32))
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0]["mars_size_height_range"])
        self.assertEqual(detect_mounds(plain.astype(np.float32)), [])

    def test_relief_screen_finds_mapped_peak_and_rejects_flat_control(self):
        y, x = np.mgrid[-500:500, -500:500]
        mound = 8 * np.exp(-((2 * x)**2 + (2 * y)**2) / (2 * 70**2))
        peaks = screen_local_peaks(mound.astype(np.float32))
        self.assertEqual(match_points(peaks, [{"row": 500, "col": 500}])["matched"], 1)
        self.assertEqual(screen_local_peaks(np.zeros_like(mound, dtype=np.float32)), [])


if __name__ == "__main__":
    unittest.main()
