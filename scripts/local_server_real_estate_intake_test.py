import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import local_server
import import_real_estate_gallery


class ApplePhotosRealEstateIntakeTests(unittest.TestCase):
    @staticmethod
    def _new_owner_action(mode, **manifest):
        return {
            "action": {
                "id": f"action-{mode}",
                "type": "sidecar-culling-review",
                "state": "claimed",
                "claim": {"connectorId": "max-local"},
                "payload": {
                    "manifest": {
                        "mode": mode,
                        "intakeAssignment": {
                            "track": "RE",
                            "fixture": "La Concha",
                            "project": "Apartment 1",
                        },
                        **manifest,
                    }
                },
            },
            "connectorId": "max-local",
        }

    def test_assignment_normalizes_the_re_fixture_project_hierarchy(self):
        assignment = local_server._apple_photos_real_estate_assignment(
            {
                "destinationKind": "real_estate",
                "intakeAssignment": {
                    "track": "re",
                    "fixture": "  La   Concha ",
                    "project": "Tennis court",
                },
            }
        )

        self.assertEqual(
            assignment,
            {"track": "RE", "fixture": "La Concha", "project": "Tennis court"},
        )

    def test_assignment_rejects_folder_traversal(self):
        with self.assertRaisesRegex(ValueError, "single folder name"):
            local_server._apple_photos_real_estate_assignment(
                {
                    "destinationKind": "real_estate",
                    "intakeAssignment": {
                        "track": "RE",
                        "fixture": "La Concha/../../Private",
                        "project": "Pool",
                    },
                }
            )

    def test_persistent_fixture_is_registered_only_as_an_re_source(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "repo"
            repo_root.mkdir()
            intake_root = Path(temp_dir) / "persistent-intake"
            payload = {
                "destinationKind": "real_estate",
                "intakeAssignment": {
                    "track": "RE",
                    "fixture": "La Concha",
                    "project": "Apartment 1",
                },
            }

            with patch.object(local_server, "REAL_ESTATE_APPLE_PHOTOS_INTAKE_ROOT", intake_root):
                destination, routing = local_server._apple_photos_intake_destination(
                    repo_root,
                    payload,
                    "July album",
                )
                (destination / "0001-test.jpg").write_bytes(b"test")
                source = local_server._remember_apple_photos_real_estate_source(repo_root, routing)

                self.assertTrue(destination.is_dir())
                self.assertEqual(destination.parent.name, "Apartment 1")
                self.assertEqual(Path(source["path"]), (intake_root / "RE" / "La Concha").resolve())
                self.assertEqual(source["intakeAssignment"]["project"], "Apartment 1")
                self.assertIn(
                    source["path"],
                    {row["path"] for row in local_server._real_estate_import_source_history(repo_root)},
                )
                self.assertNotIn(
                    source["path"],
                    {row["path"] for row in local_server._import_source_history(repo_root)},
                )

                projects = import_real_estate_gallery.album_dirs(Path(source["path"]), [])
                self.assertEqual([project.name for project in projects], ["Apartment 1"])
                self.assertEqual(
                    import_real_estate_gallery.scan_album_files(projects[0]),
                    [destination / "0001-test.jpg"],
                )

    def test_selected_assets_are_recorded_as_private_re_intake(self):
        blueprint = local_server._apple_photos_operation_blueprint(
            {
                "albumLocalIdentifier": "album-1",
                "albumName": "La Concha July",
                "selectedAssetIds": ["asset-1", "asset-2", "asset-1"],
                "destinationKind": "real_estate",
                "intakeAssignment": {
                    "track": "RE",
                    "fixture": "La Concha",
                    "project": "Main lobby",
                },
            },
            {"album": {"localIdentifier": "album-1", "assetCount": 36}},
        )

        self.assertEqual(blueprint["source"]["mode"], "selected_assets")
        self.assertEqual(blueprint["source"]["selectedAssetCount"], 2)
        self.assertEqual(blueprint["destination"]["fixture"], "La Concha")
        self.assertEqual(blueprint["destination"]["project"], "Main lobby")
        self.assertFalse(blueprint["outputs"]["publicPreview"])
        self.assertFalse(blueprint["outputs"]["watermarkPublicPreviews"])

    def test_new_owner_apple_photos_modes_fail_closed_without_backstage(self):
        for mode in ("apple-photos-re-albums", "apple-photos-re-preflight", "apple-photos-re-assign"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp_dir:
                response = local_server.new_owner_connector_result(
                    Path(temp_dir),
                    self._new_owner_action(
                        mode,
                        albums=[{"albumLocalIdentifier": "album-1", "albumName": "La Concha"}],
                        selectedAssetIds=["asset-1"],
                    ),
                )

            self.assertFalse(response["ok"])
            self.assertEqual(response["result"]["code"], "backstage_required")
            self.assertIn("signed PhotosByElie Backstage", response["result"]["error"])
            self.assertEqual(response["preview"], {"items": [], "stateCounts": []})


if __name__ == "__main__":
    unittest.main()
