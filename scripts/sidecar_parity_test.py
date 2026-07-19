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
        ):
            self.assertIn(marker, html)


if __name__ == "__main__":
    unittest.main()
