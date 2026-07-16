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

    def test_new_owner_album_mode_uses_the_existing_connector_action(self):
        payload = self._new_owner_action("apple-photos-re-albums")
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(
            local_server,
            "_run_apple_photos_bridge",
            return_value={
                "ok": True,
                "albums": [{"localIdentifier": "album-1", "title": "La Concha", "assetCount": 36}],
            },
        ):
            response = local_server.new_owner_connector_result(Path(temp_dir), payload)

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["workflow"], "apple-photos-real-estate-intake")
        self.assertEqual(response["result"]["albums"][0]["localIdentifier"], "album-1")
        self.assertFalse(response["result"]["published"])

    def test_new_owner_preflight_exposes_private_candidates_for_selection(self):
        payload = self._new_owner_action(
            "apple-photos-re-preflight",
            albums=[{"albumLocalIdentifier": "album-1", "albumName": "La Concha"}],
            limit=60,
        )
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(
            local_server,
            "_apple_photos_preflight",
            return_value={
                "ok": True,
                "album": {"localIdentifier": "album-1", "title": "La Concha"},
                "count": 2,
                "candidateCount": 1,
                "burstFilter": {"skippedCount": 1},
                "items": [
                    {
                        "localIdentifier": "asset-1",
                        "filename": "pool.jpg",
                        "eligible": True,
                        "status": "candidate",
                    },
                    {
                        "localIdentifier": "asset-2",
                        "filename": "pool-burst.jpg",
                        "eligible": False,
                        "status": "blocked_by_policy",
                        "burstFilterOutcome": "waste-basket",
                    },
                ],
            },
        ):
            response = local_server.new_owner_connector_result(Path(temp_dir), payload)

        self.assertEqual(len(response["preview"]["items"]), 1)
        item = response["preview"]["items"][0]
        self.assertEqual(item["assetId"], "asset-1")
        self.assertEqual(item["albumName"], "La Concha")
        self.assertEqual(response["result"]["inspectedCount"], 2)
        self.assertEqual(response["result"]["burstFilteredCount"], 1)
        self.assertIn("1 burst frame(s) filtered", response["result"]["message"])
        self.assertEqual(response["result"]["intakeAssignment"]["project"], "Apartment 1")
        self.assertFalse(response["result"]["published"])

    def test_new_owner_assign_mode_stays_private_and_uses_persistent_re_import(self):
        payload = self._new_owner_action(
            "apple-photos-re-assign",
            albums=[{"albumLocalIdentifier": "album-1", "albumName": "La Concha"}],
            selectedAssetIds=["asset-1"],
        )
        imported = {
            "ok": True,
            "message": "Assigned locally. Nothing was published.",
            "destinationKind": "real_estate",
            "intakeAssignment": {"track": "RE", "fixture": "La Concha", "project": "Apartment 1"},
        }
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(
            local_server,
            "_start_apple_photos_import",
            return_value=imported,
        ) as start_import:
            response = local_server.new_owner_connector_result(Path(temp_dir), payload)

        start_payload = start_import.call_args.args[1]
        self.assertEqual(start_payload["selectedAssetIds"], ["asset-1"])
        self.assertEqual(start_payload["destinationKind"], "real_estate")
        self.assertFalse(response["result"]["published"])
        self.assertEqual(response["result"]["destinationKind"], "real_estate")


if __name__ == "__main__":
    unittest.main()
