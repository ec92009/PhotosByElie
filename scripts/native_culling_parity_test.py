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
            "ScrollView(.vertical)",
            "CullingMediaFilter.selectableCases",
            "FixtureCullingView.selectableCases",
            "cullingRatingFilters.contains",
            "CullingColorFilter.selectableCases",
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

    def test_upload_queue_supports_sorting_multi_selection_previews_and_review_reversal(self):
        app = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        upload = app.split("private struct UploadWorkflowView", 1)[1].split(
            "private struct DeliverablesView", 1
        )[0]

        for marker in (
            "sortOrder: $uploadSortOrder",
            "selection: $model.selectedDeliveryIDs",
            "model.nativeUploadThumbnails[item.id]",
            ".frame(width: 50, height: 50)",
            "Use Command-click or Shift-click",
            'Button("Return to Review…")',
            "confirmingReturnToReview",
            "shown of",
            "not shown",
            "oldest eligible by upload-readiness time",
            'Button("Publish these \\(plan.items.count.formatted())…")',
            "confirmingVisiblePublication",
            'onKeyPress("r")',
            'onKeyPress("h")',
            "onKeyPress(.space)",
            "UploadQuickView",
            "item.keywords.joined",
            'Button("Hide…")',
        ):
            self.assertIn(marker, upload)
        for column in ("Title", "File", "Captured", "State", "Error"):
            self.assertIn(f'TableColumn("{column}", value:', upload)
        self.assertIn("func returnSelectedUploadsToReview()", model)
        self.assertIn("func hideSelectedUploads()", model)
        self.assertIn("func loadNativeUploadPreview(", model)
        self.assertIn("items: current.items.filter { !returnedIDs.contains($0.id) }", model)
        self.assertIn("selectedDeliveryIDs.subtract(returnedIDs)", model)
        self.assertIn("The rows were removed locally; refreshing the queue can be retried.", model)
        self.assertIn(".returnToReview", model)
        self.assertIn("func publishVisibleNativeWindow()", model)
        self.assertIn("stride(from: 0, to: ids.count, by: 50)", model)
        self.assertIn("limit: batch.count", model)
        self.assertNotIn("Publish next eligible 50", upload)

    def test_review_keeps_approved_and_hidden_cards_as_propagation_anchors(self):
        app = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        apply_action = model.split("func applyReviewAction(", 1)[1].split(
            "func undoLastReviewAction()", 1
        )[0]
        row = app.split("private struct ReviewAssetRow", 1)[1].split(
            "private struct ReviewInspector", 1
        )[0]

        self.assertIn("retainReviewResultInCurrentWindow(result, action: action)", apply_action)
        self.assertIn('item.editorialState = "approved"', apply_action)
        self.assertIn('item.placementState = "hidden"', apply_action)
        self.assertNotIn("fixtureService.reviewWindow(", apply_action)
        self.assertIn('.saturation(item.placementState == "hidden" ? 0 : 1)', row)
        self.assertIn('item.editorialState == "approved"', row)
        self.assertIn('systemName: "checkmark.circle.fill"', row)
        self.assertIn(".font(.system(size: 30", row)

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

    def test_culling_header_and_actions_are_structurally_pinned_around_grid(self):
        source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        culling = source.split("private struct MediaLibraryView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]

        grid_start = culling.index("ScrollViewReader")
        grid_end = culling.index('Button("Open in Review")')
        header = culling[:grid_start]
        grid = culling[grid_start:grid_end]
        actions = culling[grid_end:]

        self.assertIn("VStack(alignment: .leading, spacing: 12)", header)
        self.assertIn(".layoutPriority(3)", header)
        self.assertIn(
            ".frame(maxWidth: .infinity, minHeight: 240, maxHeight: .infinity)",
            grid,
        )
        self.assertIn(".clipped()", grid)
        self.assertIn(".id(cullingViewportIdentity)", grid)
        self.assertIn(".padding(.top, 12)", grid)
        self.assertIn(".frame(maxWidth: .infinity, alignment: .bottomLeading)", actions)
        self.assertIn(".layoutPriority(2)", actions)
        self.assertNotIn("GeometryReader { paneGeometry in", culling)
        self.assertIn(".frame(minWidth: 480)", culling)
        self.assertIn(
            ".frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)",
            culling,
        )
        self.assertIn(".frame(maxWidth: .infinity, maxHeight: .infinity)", culling)

    def test_culling_filters_are_visible_immediate_and_stale_safe(self):
        app = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        culling = app.split("private struct MediaLibraryView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]
        card = app.split("private struct CullingAssetCard", 1)[1].split(
            "private struct", 1
        )[0]

        self.assertNotIn('Button("Apply")', culling)
        self.assertNotIn("Menu {", culling)
        self.assertGreaterEqual(culling.count(".toggleStyle(.checkbox)"), 4)
        self.assertIn("Text(\"Media\")", culling)
        self.assertIn("Text(\"Status\")", culling)
        self.assertIn("Text(\"Rating\")", culling)
        self.assertIn("Text(\"Color\")", culling)
        self.assertIn("onChange(of: model.cullingSearch)", culling)
        self.assertIn("model.scheduleCullingSearchRefresh()", culling)
        self.assertIn(".saturation(isHidden ? 0 : 1)", card)
        self.assertIn("asset.placementState == .hidden", card)
        self.assertIn("cullingFilterTask?.cancel()", model)
        self.assertIn("cullingWindowRequestSerial", model)
        self.assertIn(
            "guard requestSerial == cullingWindowRequestSerial, !Task.isCancelled else { return }",
            model,
        )

    def test_backstage_release_requires_a_stable_signing_identity(self):
        build_script = (
            NATIVE / "scripts" / "build-app.zsh"
        ).read_text(encoding="utf-8")

        self.assertIn('identity="${PBE_CODESIGN_IDENTITY:-}"', build_script)
        self.assertIn("Developer ID Application:", build_script)
        self.assertIn("Apple Development:", build_script)
        self.assertIn('PBE_ALLOW_ADHOC_SIGNING:-0', build_script)
        self.assertIn(
            "Release installation is blocked because ad-hoc rebuilds cause recurring Keychain prompts.",
            build_script,
        )
        self.assertIn(
            'if [[ "$identity" == "-" && "$configuration" == "release"',
            build_script,
        )
        self.assertIn("--options runtime --sign", build_script)
        self.assertIn('Signature=adhoc', build_script)
        self.assertIn(
            'identifier "com.photosbyelie.backstage"',
            build_script,
        )

    def test_culling_refresh_reconciles_recent_photos_before_owner_window(self):
        source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        model_source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        culling = source.split("private struct MediaLibraryView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]

        self.assertIn("await model.refreshPhotosAndRecentIndex()", culling)
        self.assertIn("await model.refreshPhotosAndRecentIndex(force: true)", culling)
        self.assertIn("func reconcileRecentPhotosIndex(force: Bool = false)", model_source)
        self.assertIn("value: -45", model_source)
        self.assertIn('dateFormatter.dateFormat = "yyyy-MM-dd"', model_source)
        self.assertLess(
            culling.index("await model.refreshPhotosAndRecentIndex()"),
            culling.index("await model.loadFixtureCullingWindow()"),
        )

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

        self.assertIn("GeometryReader { gridGeometry in", culling)
        self.assertIn(".background {", culling)
        grid = culling.split("ScrollViewReader", 1)[1].split(
            ".frame(minHeight: 120", 1
        )[0]
        self.assertNotIn(
            """ScrollViewReader { proxy in
                    GeometryReader""",
            grid,
        )
        self.assertIn("GridItem(.flexible(minimum: 0), spacing: 8)", culling)
        self.assertNotIn("GridItem(.flexible(minimum: 84)", culling)
        self.assertIn("model.updateCullingGridWidth", culling)
        self.assertIn("Button(\"−\") { decreaseCullingThumbnailSize() }", culling)
        self.assertIn("Button(\"+\") { increaseCullingThumbnailSize() }", culling)
        self.assertIn(".disabled(!model.canDecreaseCullingThumbnailSize)", culling)
        self.assertIn(".disabled(!model.canIncreaseCullingThumbnailSize)", culling)
        self.assertIn(".animation(.snappy(duration: 0.24), value: model.cullingGridDensity)", culling)
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "guard width >= CullingGridLayout.minimumColumnWidth else { return }",
            model,
        )

    def test_culling_preview_is_bounded_and_collapsible(self):
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
            "private struct ReviewInspector", 1
        )[0]
        root = source.split("private struct OverviewView", 1)[0]
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")

        self.assertIn("@Published var isPreviewPanelVisible = true", model)
        self.assertIn('Image(systemName: "sidebar.right")', root)
        self.assertIn('model.selection == .culling || model.selection == .review', root)
        self.assertIn('"Collapse preview panel"', root)
        self.assertIn('"Expand preview panel"', root)
        self.assertIn('if model.status == "Connected"', root)
        self.assertNotIn("@State private var isCullingPreviewVisible", culling)
        self.assertIn("if model.isPreviewPanelVisible", culling)
        self.assertIn(".frame(minWidth: 220, idealWidth: 300, maxWidth: 360)", culling)
        preview_boundary = culling.index("if model.isPreviewPanelVisible")
        for persistent_control in (
            'Button("Clear filters")',
            'Button("Review picked")',
            'Button("Previous \\(workspace.limit)")',
            'Button("Next \\(workspace.limit)")',
            'Button("−")',
            'Button("+")',
            'Button(model.cullingUsesFill ? "Fill" : "Fit")',
        ):
            self.assertLess(culling.index(persistent_control), preview_boundary)
        self.assertIn("if model.isPreviewPanelVisible", review)
        self.assertIn(".frame(minWidth: 300, idealWidth: 380, maxWidth: 480)", review)

    def test_review_edits_autosave_and_propagation_controls_stay_compact(self):
        ui = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        inspector = ui.split("private struct ReviewInspector", 1)[1]
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        reason_toggle = model.split("func toggleReviewAIReason", 1)[1].split(
            "func updateReviewTitle", 1
        )[0]

        self.assertNotIn('Button("Save T/K")', inspector)
        self.assertIn("model.updateReviewTitle($0)", inspector)
        self.assertIn("model.updateReviewKeywords($0)", inspector)
        self.assertGreaterEqual(inspector.count('Image(systemName: "arrow.down")'), 2)
        self.assertIn('.help("Propagate title")', inspector)
        self.assertIn('.help("Propagate keywords")', inspector)
        self.assertIn("scheduleReviewMetadataAutosave()", model)
        self.assertIn("Task.sleep(for: .milliseconds(600))", model)
        self.assertNotIn("applyReviewAction", reason_toggle)
        self.assertNotIn("reviewLastAction", reason_toggle)
        self.assertIn("model.toggleReviewAIReason(reason)", inspector)
        self.assertNotIn("await model.toggleReviewAIReason(reason)", inspector)
        self.assertIn('Text("Mark for AI review")', inspector)
        self.assertIn('Button("Update AI review mark")', inspector)
        self.assertIn('Button(model.isRunningAIPass ? "AI pass running…" : "Run AI pass now")', ui)
        actions = inspector.split('Button("Approve")', 1)[1].split("Divider()", 1)[0]
        self.assertIn('Button("Hide")', actions)
        self.assertIn('Button("Propagate")', actions)
        self.assertNotIn(".disabled(", actions)
        self.assertIn('Image(systemName: "checkmark.circle.fill")', ui)
        self.assertIn('Image(systemName: "questionmark.circle.fill")', ui)
        self.assertIn(
            "hasDraftAIReason: model.reviewSelection.selectedIDs.contains(item.id)",
            ui,
        )
        self.assertIn('.saturation(item.placementState == "hidden" ? 0 : 1)', ui)
        self.assertIn(".font(.system(size: 30, weight: .bold))", ui)
        self.assertIn(
            "if [.approve, .hide, .requestAI].contains(action)",
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
