import unittest
from pathlib import Path
import tempfile

from scripts.sidecar_state_db import connect, mirror_cloud_decisions, record_decision


ROOT = Path(__file__).resolve().parents[1]


class SidecarParityInventoryTest(unittest.TestCase):
    def test_native_retirement_contract_has_no_ambiguous_second_ui(self):
        contract = (
            ROOT / "docs" / "architecture" / "sidecar-parity-inventory.md"
        ).read_text(encoding="utf-8")
        for marker in (
            "PhotosByElie Backstage",
            "only operator UI",
            "Photos Bridge",
            "sole signed",
            "never recreates it",
            "Owner.sqlite",
            "Immutable fixture snapshot",
            "Selection and navigation",
            "Editorial metadata",
            "Upload plan and execution",
            "Rollback contract",
            "Evidence required to close the epic",
        ):
            self.assertIn(marker, contract)
        self.assertIn(
            "No ticket may call a capability complete merely because the browser Sidecar can",
            contract,
        )
        self.assertNotIn("Photos Bridge remains the sole Photos writer", contract)

    def test_shared_page_is_an_inert_retirement_notice(self):
        html = (ROOT / "sidecar.html").read_text(encoding="utf-8")
        self.assertIn("Sidecar moved to Backstage", html)
        self.assertIn('content="noindex,nofollow"', html)
        self.assertNotIn("sidecar.js", html)
        self.assertNotIn("data-sidecar-", html)

    def test_fixture_scope_uses_the_shared_shortcut_and_decision_layer(self):
        source = (ROOT / "sidecar.js").read_text(encoding="utf-8")
        self.assertIn('new URL(window.location.href).searchParams.get("pool")', source)
        self.assertIn('params.set("poolId", fixturePoolId)', source)
        for action in ('"rating"', '"color"', '"pick"', '"approve"', '"reject"', '"hide"', '"unpick"'):
            self.assertIn(action, source)
        for key in ('"ArrowLeft"', '"ArrowRight"', '" "'):
            self.assertIn(key, source)

    def test_owner_exposes_only_backstage_enrollment_and_recovery(self):
        html = (ROOT / "owner.html").read_text(encoding="utf-8")
        self.assertIn('aria-label="Backstage enrollment"', html)
        self.assertIn("data-backstage-enroll-create", html)
        self.assertIn("data-backstage-devices-refresh", html)
        self.assertIn("backstage-provisioning.js", html)
        self.assertNotIn("new-owner.js", html)
        self.assertNotIn("data-fixture-", html)

    def test_upload_run_handoff_requires_fixture_preview_before_commit(self):
        sidecar = (ROOT / "sidecar.js").read_text(encoding="utf-8")
        owner = (ROOT / "new-owner.js").read_text(encoding="utf-8")
        self.assertIn("Route ${uploadedItems.toLocaleString()} uploaded item", sidecar)
        self.assertIn('fixture-upload-run-adoption-plan', owner)
        self.assertIn('fixture-upload-run-adoption-commit', owner)
        self.assertIn('data-fixture-upload-run-asset-id', owner)
        self.assertIn("Preview this exact run and fixture before adopting it.", owner)

    def test_stale_browser_cannot_start_an_unscoped_real_upload(self):
        server = (ROOT / "scripts" / "sidecar_server.py").read_text(encoding="utf-8")
        drain = (ROOT / "scripts" / "sidecar_upload_bridge_drain.py").read_text(encoding="utf-8")
        self.assertIn("This Sidecar page is stale or unscoped", server)
        self.assertIn('"allowUnscoped": True', drain)

    def test_legacy_sidecar_requires_the_deliberate_rollback_switch(self):
        connector = (ROOT / "scripts" / "new_owner_connector.py").read_text(encoding="utf-8")
        installer = (ROOT / "scripts" / "install_sidecar_dock_app.zsh").read_text(encoding="utf-8")
        owner_html = (ROOT / "owner.html").read_text(encoding="utf-8")
        owner_js = (ROOT / "new-owner.js").read_text(encoding="utf-8")
        self.assertIn("PBE_ENABLE_LEGACY_SIDECAR", connector)
        self.assertIn("PBE_ENABLE_LEGACY_SIDECAR", installer)
        self.assertNotIn("Open scoped Sidecar", owner_html)
        self.assertNotIn("Open Sidecar on this Mac", owner_html)
        self.assertNotIn("LOCAL_SIDECAR_OPEN_URL", owner_js)

    def test_sidecar_restore_and_cloud_mirror_cannot_change_tombstones(self):
        with tempfile.TemporaryDirectory() as directory:
            repo_root = Path(directory)
            with connect(repo_root) as connection:
                now = "2026-08-13T12:00:00+00:00"
                connection.execute(
                    """
                    INSERT INTO sidecar_assets (asset_id, source_anchor, indexed_at, updated_at)
                    VALUES ('asset-one', 'apple-photos://asset-one', ?, ?)
                    """,
                    (now, now),
                )
                connection.execute(
                    """
                    INSERT INTO sidecar_tombstones (
                      asset_id, tombstone_state, reason, tombstoned_at, updated_at
                    ) VALUES ('asset-one', 'active', 'gateway tombstone', ?, ?)
                    """,
                    (now, now),
                )

            with self.assertRaisesRegex(ValueError, "Sidecar lifecycle writes are disabled"):
                record_decision(repo_root, {"assetId": "asset-one", "action": "restore"})

            mirrored = mirror_cloud_decisions(repo_root, [{
                "assetId": "asset-one",
                "state": {
                    "rating": 4,
                    "tombstoneState": "restored",
                    "tombstoneReason": "cloud bypass",
                },
            }])
            self.assertEqual(mirrored["mirroredCount"], 1)
            with connect(repo_root) as connection:
                tombstone = connection.execute(
                    "SELECT tombstone_state, reason FROM sidecar_tombstones WHERE asset_id = ?",
                    ("asset-one",),
                ).fetchone()
                rating = connection.execute(
                    "SELECT rating FROM sidecar_decisions WHERE asset_id = ?",
                    ("asset-one",),
                ).fetchone()
            self.assertEqual(tuple(tombstone), ("active", "gateway tombstone"))
            self.assertEqual(rating["rating"], 4)


if __name__ == "__main__":
    unittest.main()
