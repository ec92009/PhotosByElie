import json
import os
from pathlib import Path
import stat
import sys
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from pbe143_live_identity_mapping import IdentityCollectionError, collect_identity_mapping


class PBE143LiveIdentityMappingTest(unittest.TestCase):
    def _private_root(self, directory: str) -> Path:
        root = Path(directory)
        root.chmod(0o700)
        return root

    def test_collects_paginated_source_tied_rows_atomically(self):
        with TemporaryDirectory() as directory:
            root = self._private_root(directory)
            destination = root / "mapping.jsonl"
            identifiers = [("local-secret-a", "cloud-secret-a"), ("local-secret-b", "")]
            calls = []

            def fetch_page(limit, offset, **_kwargs):
                calls.append((limit, offset))
                items = [
                    {"localIdentifier": local, "cloudIdentifier": cloud}
                    for local, cloud in identifiers[offset:offset + limit]
                ]
                return {
                    "ok": True,
                    "mode": "library-index",
                    "limit": limit,
                    "offset": offset,
                    "count": len(items),
                    "fetchedCount": len(identifiers),
                    "skippedCount": min(offset, len(identifiers)),
                    "items": items,
                }

            summary = collect_identity_mapping(destination, page_size=1, fetch_page=fetch_page)

            rows = [json.loads(line) for line in destination.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(calls, [(1, 0), (1, 1)])
            self.assertEqual(rows[0]["status"], "source-tied")
            self.assertEqual(rows[1]["status"], "missing")
            self.assertEqual(summary["sourceRowCount"], 2)
            self.assertEqual(summary["mappedCount"], 1)
            self.assertEqual(summary["missingCloudCount"], 1)
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
            self.assertNotIn("local-secret", json.dumps(summary))
            self.assertNotIn("cloud-secret", json.dumps(summary))
            self.assertEqual(list(root.glob(".*.tmp")), [])

    def test_snapshot_count_change_fails_closed_without_output(self):
        with TemporaryDirectory() as directory:
            root = self._private_root(directory)
            destination = root / "mapping.jsonl"

            def fetch_page(limit, offset, **_kwargs):
                total = 2 if offset == 0 else 3
                return {
                    "ok": True,
                    "mode": "library-index",
                    "limit": limit,
                    "offset": offset,
                    "count": 1,
                    "fetchedCount": total,
                    "skippedCount": offset,
                    "items": [{"localIdentifier": f"local-{offset}", "cloudIdentifier": f"cloud-{offset}"}],
                }

            with self.assertRaisesRegex(IdentityCollectionError, "library-snapshot-changed-or-invalid"):
                collect_identity_mapping(destination, page_size=1, fetch_page=fetch_page)
            self.assertFalse(destination.exists())
            self.assertEqual(list(root.glob(".*.tmp")), [])

    def test_incomplete_page_fails_closed(self):
        with TemporaryDirectory() as directory:
            root = self._private_root(directory)
            destination = root / "mapping.jsonl"

            def fetch_page(limit, offset, **_kwargs):
                return {
                    "ok": True,
                    "mode": "library-index",
                    "limit": limit,
                    "offset": offset,
                    "count": 0,
                    "fetchedCount": 1,
                    "skippedCount": 0,
                    "items": [],
                }

            with self.assertRaisesRegex(IdentityCollectionError, "library-page-incomplete"):
                collect_identity_mapping(destination, fetch_page=fetch_page)
            self.assertFalse(destination.exists())

    def test_interruption_removes_private_partial(self):
        with TemporaryDirectory() as directory:
            root = self._private_root(directory)
            destination = root / "mapping.jsonl"

            def fetch_page(*_args, **_kwargs):
                raise KeyboardInterrupt()

            with self.assertRaises(KeyboardInterrupt):
                collect_identity_mapping(destination, fetch_page=fetch_page)
            self.assertFalse(destination.exists())
            self.assertEqual(list(root.glob(".*.tmp")), [])

    def test_native_library_index_uses_bounded_cloud_identifier_batches(self):
        source = (
            ROOT
            / "native"
            / "PhotosByElieBackstage"
            / "Sources"
            / "OwnerCore"
            / "PhotoLibraryService.swift"
        ).read_text(encoding="utf-8")
        self.assertIn("let cloudIdentifiers = cloudIdentifiers(", source)
        self.assertIn("for start in stride(from: 0, to: localIdentifiers.count, by: 500)", source)
        self.assertNotIn("cloudIdentifierMappings(forLocalIdentifiers: [localIdentifier])", source)

    def test_requires_owner_only_new_destination(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o755)
            with self.assertRaisesRegex(IdentityCollectionError, "private-output-directory-required"):
                collect_identity_mapping(root / "mapping.jsonl", fetch_page=lambda *_args, **_kwargs: {})

            root.chmod(0o700)
            destination = root / "mapping.jsonl"
            destination.write_text("preserve", encoding="utf-8")
            with self.assertRaisesRegex(IdentityCollectionError, "output-path-must-be-new"):
                collect_identity_mapping(destination, fetch_page=lambda *_args, **_kwargs: {})
            self.assertEqual(destination.read_text(encoding="utf-8"), "preserve")

    def test_rejects_symlinked_output_directory(self):
        with TemporaryDirectory() as directory:
            root = self._private_root(directory)
            real_directory = root / "private"
            real_directory.mkdir(mode=0o700)
            linked_directory = root / "linked"
            linked_directory.symlink_to(real_directory, target_is_directory=True)
            with self.assertRaisesRegex(IdentityCollectionError, "private-output-directory-required"):
                collect_identity_mapping(
                    linked_directory / "mapping.jsonl",
                    fetch_page=lambda *_args, **_kwargs: {},
                )


if __name__ == "__main__":
    unittest.main()
