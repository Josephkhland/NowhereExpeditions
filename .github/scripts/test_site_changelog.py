"""Run with:  python -m unittest discover -s .github/scripts"""

import unittest

from site_changelog import diff, field_changes, section_changes


def rule(rule_id, **fields):
    return ("game", {"id": rule_id, "type": "rule", "title": rule_id.title(), **fields})


class SectionTests(unittest.TestCase):
    def test_added_edited_and_removed_sections(self):
        before = "Intro.\n\n## Coins\nTwo coins.\n\n## Old rule\nGone soon."
        after = "Intro.\n\n## Coins\nThree coins.\n\n## Update (2026-11-01)\nA clarification."
        self.assertEqual(section_changes(before, after), [
            {"title": "Coins", "change": "updated"},
            {"title": "Update (2026-11-01)", "change": "added"},
            {"title": "Old rule", "change": "removed"},
        ])

    def test_opening_text_counts_as_a_section(self):
        self.assertEqual(section_changes("Old intro.\n## A\nx", "New intro.\n## A\nx"), [{"title": "Opening", "change": "updated"}])


class FieldTests(unittest.TestCase):
    def test_new_fields_holding_defaults_are_ignored(self):
        self.assertEqual(field_changes({"title": "A", "sponsor": None}, {"title": "A", "layout": "standard", "sponsor": False, "order": 4}), [])
        self.assertEqual(field_changes({"layout": "cheatsheet"}, {"layout": "standard"}), [{"field": "Layout"}])

    def test_details_object_is_looked_into(self):
        changes = field_changes({"details": {"kind": "faith", "startStep": None}}, {"details": {"kind": "event", "startStep": None}})
        self.assertEqual(changes, [{"field": "Kind"}])

    def test_markdown_text_lists_its_sections(self):
        changes = field_changes({"details": "## A\nx"}, {"details": "## A\ny"})
        self.assertEqual(changes, [{"field": "Text", "sections": [{"title": "A", "change": "updated"}]}])


class DiffTests(unittest.TestCase):
    def test_added_updated_removed_and_renamed(self):
        old = {"game:coins": rule("coins", details="x"), "game:old": rule("old"),
               "resources:ore": ("resources", {"id": "ore", "name": "Ore"})}
        new = {"game:coins": rule("coins", details="y"), "game:new": rule("new"),
               "resources:ore": ("resources", {"id": "ore", "name": "Bloom Iron"})}
        changes = {item["key"]: item for item in diff(old, new)}
        self.assertEqual(changes["game:coins"]["change"], "updated")
        self.assertEqual(changes["game:coins"]["href"], "game.html#post-coins")
        self.assertEqual(changes["game:new"]["change"], "added")
        self.assertEqual(changes["game:old"]["change"], "removed")
        self.assertNotIn("href", changes["game:old"])
        self.assertEqual(changes["resources:ore"]["previousTitle"], "Ore")

    def test_unchanged_records_are_left_out(self):
        same = {"game:coins": rule("coins", details="x")}
        self.assertEqual(diff(same, dict(same)), [])


if __name__ == "__main__":
    unittest.main()
