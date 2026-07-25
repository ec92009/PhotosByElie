import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import local_server
import owner_state_db
import sidecar_state_db


def action(mode, **manifest):
    return {
        "connectorId": "max",
        "action": {
            "id": f"action-{mode}",
            "type": "sidecar-culling-review",
            "state": "claimed",
            "claim": {"connectorId": "max"},
            "payload": {"manifest": {"mode": mode, **manifest}},
        },
    }


class FixtureConnectorTest(unittest.TestCase):
    def test_connector_lists_private_lifecycle_titles_without_mutation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with owner_state_db.connect(root) as connection:
                connection.execute(
                    """INSERT INTO media_lifecycle
                       (media_id, lifecycle_state, source_slug, title, media_type,
                        source_paths_json, public_preview_keys_json, private_keys_json,
                        updated_at)
                       VALUES (?, 'hidden', 'france', 'Private saved title', 'photo',
                               '[]', '[]', '[]', ?)""",
                    ("photo-hidden", "2026-07-25T00:00:00Z"),
                )
                connection.commit()

            listed = local_server.new_owner_connector_result(
                root,
                action("fixture-lifecycle-list"),
            )

        self.assertTrue(listed["result"]["readOnly"])
        self.assertEqual(listed["result"]["lifecycle"]["hiddenCount"], 1)
        self.assertEqual(
            listed["result"]["lifecycle"]["items"][0]["title"],
            "Private saved title",
        )

    def test_connector_supports_tree_search_pool_and_delivery_plan(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(root, [
                {"localIdentifier": "asset-1", "filename": "LaConcha.JPG", "mediaType": "photo", "creationDate": "2026-07-15T10:00:00Z"},
            ])
            created = local_server.new_owner_connector_result(root, action("fixture-create", name="La Concha", templateKey="real-estate"))
            fixture_id = created["result"]["fixture"]["fixtureId"]
            archived = local_server.new_owner_connector_result(root, action("fixture-archive", fixtureId=fixture_id))
            self.assertTrue(archived["result"]["fixture"]["archivedAt"])
            listed = local_server.new_owner_connector_result(root, action("fixture-tree-list", includeArchived=True))
            self.assertEqual(listed["result"]["fixtures"][0]["fixtureId"], fixture_id)
            reopened = local_server.new_owner_connector_result(root, action("fixture-reopen", fixtureId=fixture_id))
            self.assertFalse(reopened["result"]["fixture"]["archivedAt"])
            searched = local_server.new_owner_connector_result(root, action("fixture-search", filters={"query": "LaConcha"}))
            self.assertTrue(searched["result"]["readOnly"])
            self.assertEqual(searched["result"]["candidateCount"], 1)
            pooled = local_server.new_owner_connector_result(root, action(
                "fixture-pool-create",
                fixtureId=fixture_id,
                selectedAssetIds=["asset-1"],
                criteria={"query": "LaConcha"},
            ))
            self.assertIn("?pool=pool-", pooled["result"]["sidecarUrl"])
            second = local_server.new_owner_connector_result(root, action("fixture-create", name="Apartment 2"))
            routed = local_server.new_owner_connector_result(root, action(
                "fixture-place-multi",
                fixtureIds=[second["result"]["fixture"]["fixtureId"]],
                assetIds=["asset-1"],
            ))
            self.assertEqual(routed["result"]["ledger"]["count"], 2)
            planned = local_server.new_owner_connector_result(root, action("fixture-delivery-plan", fixtureId=fixture_id))
            self.assertEqual(planned["result"]["delivery"]["assetCount"], 1)
            self.assertFalse(planned["result"]["clientMessageSent"])
            local_server.new_owner_connector_result(root, action("fixture-destinations", fixtureId=fixture_id, assetIds=["asset-1"], destinations=["r2", "apple_photos"]))
            photos_plan = local_server.new_owner_connector_result(root, action("fixture-photos-writeback-plan", fixtureId=fixture_id))
            self.assertTrue(photos_plan["result"]["readOnly"])
            self.assertEqual(photos_plan["result"]["photosWriteback"]["blockedCount"], 1)


if __name__ == "__main__":
    unittest.main()
