import json
from pathlib import Path
import sqlite3
import stat
import sys
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from pbe143_live_identity_mapping import IdentityCollectionError, collect_identity_mapping
from sidecar_identity_migration import owner_local_identifiers_for_mapping


class PBE143LiveIdentityMappingTest(unittest.TestCase):
    def _private_root(self, directory: str) -> Path:
        root = Path(directory)
        root.chmod(0o700)
        return root

    def test_collects_only_owner_local_ids_in_bounded_batches(self):
        with TemporaryDirectory() as directory:
            root = self._private_root(directory)
            destination = root / "mapping.jsonl"
            identifiers = ["local-secret-a", "local-secret-b"]
            calls = []

            def fetch_mapping(requested, **_kwargs):
                calls.append(requested)
                items = [
                    {
                        "localIdentifier": local,
                        "cloudIdentifier": "cloud-secret-a" if local.endswith("a") else "",
                        "status": "source-tied" if local.endswith("a") else "missing",
                    }
                    for local in requested
                ]
                return {"ok": True, "mode": "identity-map", "count": len(items), "items": items}

            summary = collect_identity_mapping(
                destination,
                root / "Owner.sqlite",
                batch_size=1,
                fetch_mapping=fetch_mapping,
                load_local_identifiers=lambda _path: identifiers,
            )

            rows = [json.loads(line) for line in destination.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(calls, [["local-secret-a"], ["local-secret-b"]])
            self.assertEqual(rows[0]["status"], "source-tied")
            self.assertEqual(rows[1]["status"], "missing")
            self.assertEqual(summary["ownerLocalOnlyCount"], 2)
            self.assertEqual(summary["mappedCount"], 1)
            self.assertEqual(summary["missingCloudCount"], 1)
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
            self.assertNotIn("local-secret", json.dumps(summary))
            self.assertNotIn("cloud-secret", json.dumps(summary))
            self.assertEqual(list(root.glob(".*.tmp")), [])

    def test_mismatched_identity_response_fails_closed_without_output(self):
        with TemporaryDirectory() as directory:
            root = self._private_root(directory)
            destination = root / "mapping.jsonl"

            def fetch_mapping(_requested, **_kwargs):
                return {
                    "ok": True,
                    "mode": "identity-map",
                    "count": 1,
                    "items": [{"localIdentifier": "wrong", "cloudIdentifier": "cloud", "status": "source-tied"}],
                }

            with self.assertRaisesRegex(IdentityCollectionError, "identity-map-row-invalid"):
                collect_identity_mapping(
                    destination,
                    root / "Owner.sqlite",
                    fetch_mapping=fetch_mapping,
                    load_local_identifiers=lambda _path: ["expected"],
                )
            self.assertFalse(destination.exists())
            self.assertEqual(list(root.glob(".*.tmp")), [])

    def test_interruption_removes_private_partial(self):
        with TemporaryDirectory() as directory:
            root = self._private_root(directory)
            destination = root / "mapping.jsonl"

            def fetch_mapping(*_args, **_kwargs):
                raise KeyboardInterrupt()

            with self.assertRaises(KeyboardInterrupt):
                collect_identity_mapping(
                    destination,
                    root / "Owner.sqlite",
                    fetch_mapping=fetch_mapping,
                    load_local_identifiers=lambda _path: ["local"],
                )
            self.assertFalse(destination.exists())
            self.assertEqual(list(root.glob(".*.tmp")), [])

    def test_owner_loader_returns_unique_local_only_identities(self):
        with TemporaryDirectory() as directory:
            owner = Path(directory) / "Owner.sqlite"
            connection = sqlite3.connect(owner)
            connection.execute("CREATE TABLE sidecar_assets (asset_id TEXT, source_anchor TEXT, raw_json TEXT)")
            connection.executemany(
                "INSERT INTO sidecar_assets VALUES (?, ?, ?)",
                [
                    ("legacy-a", "apple-photos://local-b", json.dumps({"localIdentifier": "local-b"})),
                    ("legacy-b", "apple-photos://local-a", json.dumps({"localIdentifier": "local-a"})),
                    ("canonical", "apple-photos-cloud://cloud-a", json.dumps({"localIdentifier": "local-c", "cloudIdentifier": "cloud-a"})),
                    ("duplicate", "apple-photos://local-a", json.dumps({"localIdentifier": "local-a"})),
                ],
            )
            connection.commit()
            connection.close()
            self.assertEqual(owner_local_identifiers_for_mapping(owner), ["local-a", "local-b"])

    def test_native_paths_use_bounded_identity_mapping(self):
        source = (
            ROOT / "native" / "PhotosByElieBackstage" / "Sources" / "OwnerCore" / "PhotoLibraryService.swift"
        ).read_text(encoding="utf-8")
        protocol = (
            ROOT / "native" / "PhotosByElieBackstage" / "Sources" / "OwnerCore" / "BackstagePreviewIPCProtocol.swift"
        ).read_text(encoding="utf-8")
        self.assertIn("func identityMap(localIdentifiers: [String])", source)
        self.assertIn('identityMapOperation = "photos.identity-map"', protocol)
        self.assertIn("maximumIdentityMapItems = 64", protocol)
        self.assertNotIn("cloudIdentifierMappings(forLocalIdentifiers: [localIdentifier])", source)

    def test_requires_owner_only_new_destination(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o755)
            with self.assertRaisesRegex(IdentityCollectionError, "private-output-directory-required"):
                collect_identity_mapping(
                    root / "mapping.jsonl",
                    root / "Owner.sqlite",
                    load_local_identifiers=lambda _path: [],
                )

            root.chmod(0o700)
            destination = root / "mapping.jsonl"
            destination.write_text("preserve", encoding="utf-8")
            with self.assertRaisesRegex(IdentityCollectionError, "output-path-must-be-new"):
                collect_identity_mapping(
                    destination,
                    root / "Owner.sqlite",
                    load_local_identifiers=lambda _path: [],
                )
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
                    root / "Owner.sqlite",
                    load_local_identifiers=lambda _path: [],
                )


if __name__ == "__main__":
    unittest.main()
