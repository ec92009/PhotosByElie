import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SidecarParityInventoryTest(unittest.TestCase):
    def test_shared_page_keeps_global_culling_controls(self):
        html = (ROOT / "sidecar.html").read_text(encoding="utf-8")
        for marker in (
            'data-sidecar-page="culling"', 'data-sidecar-page="review"',
            'data-sidecar-search', 'data-sidecar-filter="rating"',
            'data-sidecar-filter="color"', 'data-sidecar-filter="pickState"',
            'data-sidecar-filter="mediaType"', 'data-sidecar-burst-cull',
            'data-sidecar-upload-plan', 'data-sidecar-commit-plan',
            'data-sidecar-empty-wastebasket',
        ):
            self.assertIn(marker, html)

    def test_fixture_scope_uses_the_shared_shortcut_and_decision_layer(self):
        source = (ROOT / "sidecar.js").read_text(encoding="utf-8")
        self.assertIn('new URL(window.location.href).searchParams.get("pool")', source)
        self.assertIn('params.set("poolId", fixturePoolId)', source)
        for action in ('"rating"', '"color"', '"pick"', '"approve"', '"reject"', '"hide"', '"unpick"'):
            self.assertIn(action, source)
        for key in ('"ArrowLeft"', '"ArrowRight"', '" "'):
            self.assertIn(key, source)

    def test_owner_exposes_universal_fixture_search_and_recovery_controls(self):
        html = (ROOT / "owner.html").read_text(encoding="utf-8")
        for marker in (
            "data-fixture-archive", "data-fixture-reopen", "data-fixture-date-from",
            "data-fixture-date-to", "data-fixture-albums", "data-fixture-camera",
            "data-fixture-lens", "data-fixture-rating", "data-fixture-color",
            "data-fixture-delivery-state", "data-fixture-filter-parent", "data-fixture-dedupe-exact",
            "data-fixture-placement-targets", "data-fixture-place-selected", "data-fixture-placement-list",
            "data-fixture-upload-run-id", "data-fixture-upload-run-plan",
            "data-fixture-upload-run-commit",
        ):
            self.assertIn(marker, html)

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


if __name__ == "__main__":
    unittest.main()
