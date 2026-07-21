#!/usr/bin/env python3
from __future__ import annotations

import unittest

try:
    from scripts.cleanup_unreferenced_catalog_r2 import classify_object, media_id_from_key
except ModuleNotFoundError:  # Direct `python scripts/..._test.py` execution.
    from cleanup_unreferenced_catalog_r2 import classify_object, media_id_from_key


class CleanupClassificationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog_ids = {"current"}
        self.expected = {"masters/current.jpg", "renders/current_1mp.jpg"}
        self.available = set(self.expected)
        self.master_by_id = {"current": "masters/current.jpg"}

    def classify(self, key: str, protected: set[str] | None = None) -> tuple[str, str]:
        return classify_object(
            {"bucket": "photosbyelie-private", "key": key, "bytes": 1},
            catalog_ids=self.catalog_ids,
            expected_keys=self.expected,
            protected_ids=protected or set(),
            available_keys=self.available,
            master_by_id=self.master_by_id,
        )

    def test_extracts_current_and_nested_ids(self) -> None:
        self.assertEqual(media_id_from_key("expo/abc_900.jpg"), "abc")
        self.assertEqual(media_id_from_key("masters/abc/file.jpg"), "abc")
        self.assertEqual(media_id_from_key("renders/abc/file-jpg-3mp.jpg"), "abc")

    def test_keeps_exact_catalog_key(self) -> None:
        self.assertEqual(self.classify("masters/current.jpg"), ("keep", "current-catalog-key"))

    def test_deletes_redundant_current_key_when_master_exists(self) -> None:
        self.assertEqual(
            self.classify("masters/current/old.jpg"),
            ("delete", "redundant-key-for-current-catalog"),
        )

    def test_keeps_fallback_master_when_canonical_is_missing(self) -> None:
        self.available.remove("masters/current.jpg")
        self.assertEqual(
            self.classify("masters/current/old.jpg"),
            ("keep", "fallback-master-for-current-catalog"),
        )

    def test_preserves_non_catalog_protected_id(self) -> None:
        self.assertEqual(
            self.classify("renders/pending/old-jpg-1mp.jpg", {"pending"}),
            ("keep", "protected-active-or-hidden-id"),
        )

    def test_deletes_unprotected_non_catalog_id(self) -> None:
        self.assertEqual(
            self.classify("expo/retired_900.jpg"),
            ("delete", "unreferenced-non-catalog-id"),
        )

    def test_unclassified_key_fails_closed(self) -> None:
        self.assertEqual(
            self.classify("renders/not-a-known-shape.bin"),
            ("keep", "unclassified-fail-closed"),
        )


if __name__ == "__main__":
    unittest.main()
