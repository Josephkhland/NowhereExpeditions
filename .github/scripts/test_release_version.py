"""Run with:  python -m unittest discover -s .github/scripts"""

import unittest

from release_version import bump, decide_level, parse_version

CONFIG = {
    "major": {"markers": ["[major]"], "labels": ["release: major"], "paths": []},
    "minor": {"markers": ["[minor]"], "labels": ["release: minor"], "paths": ["public-site/*.js"]},
}


class BumpTests(unittest.TestCase):
    def test_bump_resets_lower_parts(self):
        self.assertEqual(bump((1, 4, 2), "patch"), (1, 4, 3))
        self.assertEqual(bump((1, 4, 2), "minor"), (1, 5, 0))
        self.assertEqual(bump((1, 4, 2), "major"), (2, 0, 0))

    def test_parse_rejects_other_formats(self):
        self.assertEqual(parse_version("1.10.0"), (1, 10, 0))
        with self.assertRaises(ValueError):
            parse_version("1.2")


class DecideLevelTests(unittest.TestCase):
    def test_default_is_patch(self):
        self.assertEqual(decide_level(CONFIG, ["Update after session 12"], ["public-site/data/jobs.json"], set())[0], "patch")

    def test_marker_is_case_insensitive_and_major_wins(self):
        messages = ["New marketplace [Minor]", "Rework the outpost [MAJOR]"]
        self.assertEqual(decide_level(CONFIG, messages, [], set())[0], "major")

    def test_label_and_path_rules(self):
        self.assertEqual(decide_level(CONFIG, ["x"], [], {"Release: Minor"})[0], "minor")
        self.assertEqual(decide_level(CONFIG, ["x"], ["public-site/site.js"], set())[0], "minor")


if __name__ == "__main__":
    unittest.main()
