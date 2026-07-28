"""Executable source contract for the native Backstage culling workspace."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "native" / "PhotosByElieBackstage"


class NativeCullingParityTest(unittest.TestCase):
    def test_owner_core_owns_filter_window_burst_and_hierarchy_rules(self):
        source = (
            NATIVE / "Sources" / "OwnerCore" / "CullingWorkspace.swift"
        ).read_text(encoding="utf-8")
        for marker in (
            "CullingQuery",
            "CullingWorkspaceResult",
            "boundedLimit",
            "visibleRange",
            "func burst(",
            "func path(to fixtureID:",
        ):
            self.assertIn(marker, source)

    def test_native_ui_exposes_sidecar_parity_without_a_browser_route(self):
        source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        for marker in (
            "OutlineGroup(model.fixtures",
            "Review picked",
            "Select burst",
            "Search title, file, or keyword",
            "Send to Metadata",
            "Send to Uploads",
            "thumbnail: model.cullingThumbnails",
            'onKeyPress("p")',
            'onKeyPress("h")',
            'onKeyPress("x")',
            'onKeyPress("u")',
            'onKeyPress("b")',
            "P include in fixture",
            "H exclude from fixture",
            "X globally reject",
            "Button(\"Stop\")",
            ".frame(minHeight: 140, idealHeight: 180, maxHeight: 220)",
            "ScrollView(.vertical)",
        ):
            self.assertIn(marker, source)
        self.assertNotIn("127.0.0.1:8011", source)

    def test_cancelled_fixture_reload_does_not_replace_loaded_state_with_an_error(self):
        source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "guard !(error is CancellationError), !Task.isCancelled else { return }",
            source,
        )

    def test_fixture_policy_controls_adapt_to_the_available_width(self):
        source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        for marker in (
            "AdaptiveFixtureFieldPair",
            "ViewThatFits(in: .horizontal)",
            "minimumColumnWidth",
            "FixturePickerField",
            ".frame(width: 220, height: 28",
        ):
            self.assertIn(marker, source)
        self.assertNotIn(".frame(width: 165)", source)

    def test_large_pool_work_is_bounded_and_reports_progress(self):
        source = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        for marker in (
            "cullingWindowLimit = 200",
            "by: 500",
            "by: 200",
            "cullingDecisionProgress",
            "cullingCancellationRequested",
            "completed batches remain audited and undoable",
            "FixtureCullingSemantics.mutation(",
            "await applyFixturePlacement(state, label: label)",
            "X remains the global reject action",
        ):
            self.assertIn(marker, source)
        self.assertNotIn("await applyPickDecision()", source)

    def test_large_queue_pagers_stay_visible_above_scrolling_content(self):
        source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        culling = source.split("private struct MediaLibraryView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]
        review = source.split("private struct FixtureReviewView", 1)[1].split(
            "private struct ReviewAssetRow", 1
        )[0]

        self.assertLess(
            culling.index('Button("Next \\(workspace.limit)")'),
            culling.index("ScrollViewReader"),
        )
        self.assertIn(
            "of \\(workspace.summary.filtered.formatted())",
            culling,
        )
        self.assertLess(
            review.index('Button("Next \\(model.reviewWindowLimit)")'),
            review.index("ScrollViewReader"),
        )
        self.assertIn(
            "of \\(window.summary.total.formatted())",
            review,
        )
        self.assertIn("FlowLayout(spacing: 10)", review)
        self.assertNotIn(".frame(minWidth: 620)", review)

    def test_density_controls_resize_only_the_grid_viewport(self):
        source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        culling = source.split("private struct MediaLibraryView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]

        self.assertIn("GeometryReader { geometry in", culling)
        self.assertIn("GridItem(.flexible(minimum: 0), spacing: 8)", culling)
        self.assertNotIn("GridItem(.flexible(minimum: 84)", culling)
        self.assertIn("model.updateCullingGridWidth", culling)
        self.assertIn("Button(\"−\") { model.decreaseCullingThumbnailSize() }", culling)
        self.assertIn("Button(\"+\") { model.increaseCullingThumbnailSize() }", culling)
        self.assertIn(".disabled(!model.canDecreaseCullingThumbnailSize)", culling)
        self.assertIn(".disabled(!model.canIncreaseCullingThumbnailSize)", culling)
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "guard width >= CullingGridLayout.minimumColumnWidth else { return }",
            model,
        )

    def test_getting_started_describes_the_native_large_pool_path(self):
        guide = (ROOT / "docs" / "BACKSTAGE_GETTING_STARTED.md").read_text(
            encoding="utf-8"
        )
        guide = re.sub(r"\s+", " ", guide)
        for marker in (
            "at most 200 matching rows",
            "Review picked",
            "Select burst",
            "Send to Metadata",
            "Send to Uploads",
        ):
            self.assertIn(marker, guide)


if __name__ == "__main__":
    unittest.main()
