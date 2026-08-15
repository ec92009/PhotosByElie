"""Executable source contract for the native Backstage culling workspace."""

from pathlib import Path
import plistlib
import re
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "native" / "PhotosByElieBackstage"


def backstage_ui_source() -> str:
    source_dir = NATIVE / "Sources" / "BackstageApp"
    return "\n".join(
        (source_dir / filename).read_text(encoding="utf-8")
        for filename in (
            "CullingView.swift",
            "CullingCanvasControls.swift",
            "CullingPreview.swift",
            "ReviewView.swift",
            "ReviewCanvasInspector.swift",
            "ReviewPreview.swift",
            "UploadView.swift",
            "UploadHeaderView.swift",
            "UploadQuickView.swift",
            "UploadPreview.swift",
            "PhotosByElieBackstageApp.swift",
        )
    )


class NativeCullingParityTest(unittest.TestCase):
    def test_culling_thumbnails_resolve_identifier_fallbacks_and_report_failures(self):
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        photo_library = (
            NATIVE / "Sources" / "OwnerCore" / "PhotoLibraryService.swift"
        ).read_text(encoding="utf-8")
        source = backstage_ui_source()

        for marker in (
            "photoLibraryIdentifierCandidates(",
            "previewForAsset(",
            "cullingThumbnailFailures: [String: CullingThumbnailFailure]",
            "CullingThumbnailFailure(error: error)",
            "cullingThumbnailFailures[assetID] = lastFailure",
            "func retryThumbnail(for assetID: String)",
        ):
            self.assertIn(marker, model)
        for marker in (
            "PHCloudIdentifier(stringValue:",
            "localIdentifierMappings(for:",
            "apple-photos-cloud://",
            "Choose Allow Photos",
        ):
            self.assertIn(marker, photo_library)
        for marker in (
            "thumbnailFailure: model.cullingThumbnailFailures[asset.id]",
            "onRetryThumbnail: { model.retryThumbnail(for: asset.id) }",
            "await model.authorizeAndLoadPhotos()",
            "if let thumbnailFailure",
            "Button(thumbnailFailure.actionTitle)",
            "Loading preview…",
        ):
            self.assertIn(marker, source)

    def test_owner_core_owns_filter_window_burst_and_hierarchy_rules(self):
        source = (
            NATIVE / "Sources" / "OwnerCore" / "CullingWorkspace.swift"
        ).read_text(encoding="utf-8")
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        for marker in (
            "CullingQuery",
            "CullingWorkspaceResult",
            "boundedLimit",
            "visibleRange",
            "func captureDate(",
            "func burst(",
            "func path(to fixtureID:",
        ):
            self.assertIn(marker, source)
        self.assertIn(
            "CullingWorkspace.burstRejectCandidates(in: timedItems)",
            model,
        )
        self.assertIn("abs(capturedAt.timeIntervalSince(previous)) > maximumGap", source)

    def test_native_ui_exposes_sidecar_parity_without_a_browser_route(self):
        source = backstage_ui_source()
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
            "X move to recoverable Waste Basket",
            "Button(\"Stop\")",
            "ScrollView(.vertical)",
            "FixtureCullingView.selectableCases",
            "cullingRatingFilters.contains",
            "CullingColorFilter.selectableCases",
        ):
            self.assertIn(marker, source)
        self.assertNotIn("127.0.0.1:8011", source)
        self.assertIn(
            'Button("Select burst") { model.selectVisibleBurstCandidates() }',
            source,
        )
        self.assertNotIn(
            ".disabled(model.focusedCullingAssetID == nil)",
            source,
        )

    def test_window_and_preview_layout_persist_between_launches(self):
        app = backstage_ui_source()
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        persistence = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageWindowState.swift"
        ).read_text(encoding="utf-8")
        adapter = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageAppKitAdapters.swift"
        ).read_text(encoding="utf-8")
        self.assertIn('WindowFrameAutosaver(name: "PhotosByElieBackstage.MainWindow")', app)
        self.assertIn('SplitViewAutosaver(name: "PhotosByElieBackstage.NavigationSplit")', app)
        self.assertIn('SplitViewAutosaver(name: "PhotosByElieBackstage.FixturesSplit")', app)
        self.assertIn('SplitViewAutosaver(name: "PhotosByElieBackstage.AccessSplit")', app)
        self.assertIn('SplitViewAutosaver(name: "PhotosByElieBackstage.CullingSplit")', app)
        self.assertIn('SplitViewAutosaver(name: "PhotosByElieBackstage.ReviewSplit")', app)
        self.assertIn("navigationSidebarVisible", app)
        self.assertIn("selectedSectionPreferenceKey", model)
        self.assertIn("cullingPreviewPanelVisibilityPreferenceKey", model)
        self.assertIn("reviewPreviewPanelVisibilityPreferenceKey", model)
        self.assertIn("quickLookFrameAutosaveName", adapter)
        self.assertIn("setFrameUsingName", adapter)
        self.assertIn("setFrameAutosaveName", persistence)
        self.assertIn("splitView.autosaveName", persistence)

    def test_culling_inspector_shows_capture_time_to_seconds(self):
        source = backstage_ui_source()
        self.assertIn("MMM d, yyyy 'at' HH:mm:ss", source)

    def test_fixture_filters_hide_stale_or_recent_photo_fallback_rows(self):
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        ui = backstage_ui_source()
        self.assertIn("fixtureCullingWindow = nil", model)
        self.assertIn('cullingStatus = "Applying culling filters…"', model)
        self.assertIn("if !model.isBlockingFixtureCullingLoad", ui)
        self.assertIn('Text("Applying filters…")', ui)
        self.assertIn(".fixedSize(horizontal: true, vertical: false)", ui)
        self.assertIn(".frame(maxWidth: .infinity, maxHeight: .infinity)", ui)

    def test_fixture_decisions_keep_the_visible_grid_during_low_priority_backfill(self):
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        ui = backstage_ui_source()
        self.assertIn(
            "func loadFixtureCullingWindow(preservingVisibleWindow: Bool = false)",
            model,
        )
        self.assertIn("Task(priority: .utility)", model)
        self.assertIn(
            "loadFixtureCullingWindow(preservingVisibleWindow: true)",
            model,
        )
        self.assertIn(
            "isLoadingFixtureCulling && fixtureCullingWindow == nil",
            model,
        )
        self.assertIn("if model.isBlockingFixtureCullingLoad", ui)

    def test_thumbnail_requests_outlive_transient_card_task_cancellation(self):
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        ui = backstage_ui_source()
        self.assertIn("private var cullingThumbnailTasks:", model)
        self.assertIn("func requestThumbnail(for assetID:", model)
        self.assertIn("for attempt in 0..<3", model)
        self.assertIn("model.requestThumbnail(for: asset.id)", ui)
        self.assertIn("model.requestReviewThumbnail(for: item)", ui)

    def test_review_loading_is_canvas_visible_and_cancellation_safe(self):
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        ui = backstage_ui_source()
        canvas = backstage_ui_source()
        review_loader = model.split(
            "func loadFixtureReviewWindow", 1
        )[1].split("func clickReviewItem", 1)[0]
        self.assertIn("reviewWindowRequestSerial", review_loader)
        self.assertIn("isTransientCancellation(error)", review_loader)
        self.assertNotIn("fixtureReviewWindow = nil", review_loader)
        self.assertIn(
            "model.isRunningReview, model.fixtureReviewWindow == nil",
            ui,
        )
        self.assertIn("model.fixtureReviewWindow != nil", ui)
        for marker in (
            'struct ReviewView: View',
            '#Preview("Review — Loaded")',
            '#Preview("Review — Refreshing Last Good Window")',
            '#Preview("Review — Initial Loading")',
            '#Preview("Review — Empty")',
        ):
            self.assertIn(marker, canvas)

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
        app = backstage_ui_source()
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        upload = app.split("struct UploadView", 1)[1].split(
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
            "plan.order.label",
            'Button("Publish these \\(plan.items.count.formatted())…")',
            "confirmingVisiblePublication",
            'Button("Upload selection…")',
            'onKeyPress("r")',
            'onKeyPress("h")',
            "onKeyPress(.space)",
            ".focused($isUploadQuickViewFocused)",
            "onKeyPress(.upArrow)",
            "onKeyPress(.downArrow)",
            "moveUploadQuickView(in: plan, by: -1)",
            "moveUploadQuickView(in: plan, by: 1)",
            "Use ↑/↓ to navigate",
            "UploadQuickView",
            "item.keywords.joined",
            'Button("Hide…")',
            'Button("Load next 200")',
            "Batch complete",
        ):
            self.assertIn(marker, upload)
        for column in ("Title", "Keywords", "Captured", "State", "Error"):
            self.assertIn(f'TableColumn("{column}", value:', upload)
        self.assertNotIn('TableColumn("File", value:', upload)
        self.assertIn("func returnSelectedUploadsToReview()", model)
        self.assertIn("func hideSelectedUploads()", model)
        self.assertIn("func loadNativeUploadPreview(", model)
        self.assertIn("items: current.items.filter { !returnedIDs.contains($0.id) }", model)
        self.assertIn("selectedDeliveryIDs.subtract(returnedIDs)", model)
        self.assertIn(".returnToReview", model)
        self.assertIn("func publishVisibleNativeWindow()", model)
        self.assertIn("func preserveNativeUploadTray(", model)
        self.assertIn("items: retainedItems", model)
        self.assertIn("attemptedIDs.subtracting(failedIDs)", model)
        self.assertIn("Failed items remain in this tray for retry.", model)
        self.assertIn("stride(from: 0, to: ids.count, by: 50)", model)
        self.assertIn("limit: batch.count", model)
        self.assertIn("isRunningNativePublication = true", model)
        self.assertIn("nativePublicationBatchNumber = batchIndex + 1", model)
        self.assertIn("nativePublicationBatchCount = batches.count", model)
        self.assertIn("if model.isRunningNativePublication,", upload)
        self.assertIn(
            '"Batch \\(model.nativePublicationBatchNumber) of \\(model.nativePublicationBatchCount)"',
            upload,
        )
        self.assertNotIn(
            'nativeUploadStatus += " The rows were removed locally; refreshing the queue can be retried."',
            model,
        )
        self.assertNotIn(
            'nativeUploadStatus += " Refreshing the queue can be retried."',
            model,
        )
        self.assertNotIn('Button("Refresh queue")', upload)
        self.assertNotIn("Publish next eligible 50", upload)

    def test_review_keeps_completed_filtered_approved_and_hidden_propagation_anchors(self):
        app = backstage_ui_source()
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
        self.assertIn("let retainsCompletedAction = changesByID[item.id] != nil", apply_action)
        self.assertIn("retainingConsumedProposal: retainsCompletedAction", apply_action)
        self.assertIn("reviewStateFilters.contains(state)", apply_action)
        self.assertIn(
            "retainingConsumedProposal || !reviewProposalAvailableOnly || item.proposalReady",
            apply_action,
        )
        self.assertIn(
            'guard !item.mediaType.lowercased().contains("video") else { return false }',
            apply_action,
        )
        self.assertNotIn("fixtureService.reviewWindow(", apply_action)
        review_action_and_retention = apply_action.split(
            "private func removeUnpickedReviewItems",
            1,
        )[0]
        self.assertNotIn("reviewScrollTargetID =", review_action_and_retention)
        self.assertIn('.saturation(item.placementState == "hidden" ? 0 : 1)', row)
        self.assertIn('item.editorialState == "approved"', row)
        self.assertIn('systemName: "checkmark.circle.fill"', row)
        self.assertIn(".font(.system(size: 30", row)
        self.assertIn("var proposalDraft: ReviewMetadataDraft?", row)
        self.assertIn('label: "Current"', row)
        self.assertIn('label: "Proposed"', row)
        self.assertIn("proposalDraft?.isProposal == true", row)
        self.assertIn("proposalDraft.keywords.joined(separator: \", \")", row)
        self.assertIn('"Proposal Available"', app)
        self.assertIn("reviewProposalAvailableOnly", model)
        self.assertIn("hydrateReviewProposalDrafts(from: window.items)", model)
        hydration = model.split(
            "private func hydrateReviewProposalDrafts(",
            1,
        )[1].split("private func clearReviewDraft()", 1)[0]
        self.assertIn("item.proposedTitle", hydration)
        self.assertIn("item.proposedKeywords", hydration)
        self.assertNotIn("markAIProposalsLoaded", hydration)
        review = app.split("struct ReviewView", 1)[1].split(
            "private struct ReviewAssetRow", 1
        )[0]
        self.assertNotIn('Text("Media")', review)
        self.assertNotIn("toggleReviewMediaFilter", review)
        self.assertNotIn("func toggleReviewMediaFilter", model)
        self.assertIn(
            "mediaFilters: [CullingMediaFilter.photos.rawValue]",
            model,
        )
        self.assertIn("FixtureReviewStateFilter.allCases", app)
        self.assertIn("reviewStateFilters.contains", app)
        self.assertIn("toggleReviewStateFilter", model)
        self.assertIn(
            'let hasActiveAIRequest = item.editorialState == "requesting-ai"',
            model,
        )
        self.assertIn(
            "reviewAIReasons = hasActiveAIRequest ? Set(item.aiReasons) : []",
            model,
        )
        self.assertNotIn("hasExplicitPendingMetadataEdit", apply_action)
        preflight = apply_action.split(
            "let ids = selectedReviewAssetIDs",
            1,
        )[0]
        self.assertNotIn("await saveReviewMetadataIfNeeded()", preflight)
        self.assertIn(
            "let approvalDraft = action == .approve ? reviewProposalDrafts[anchor] : nil",
            apply_action,
        )
        self.assertIn("title: approvalTitle", apply_action)
        self.assertIn("keywords: approvalKeywords", apply_action)

    def test_review_unpick_clears_fixture_pick_from_list_inspector_and_quick_look(self):
        app = backstage_ui_source()
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        adapter = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageAppKitAdapters.swift"
        ).read_text(encoding="utf-8")
        review = app.split("struct ReviewView", 1)[1].split(
            "private struct ReviewAssetRow", 1
        )[0]
        unpick = model.split("func unpickReviewSelection()", 1)[1].split(
            "func updateReviewTitle(", 1
        )[0]
        undo = model.split("func undoLastReviewAction()", 1)[1].split(
            "func saveReviewMetadata()", 1
        )[0]

        self.assertIn('onKeyPress("u")', review)
        self.assertIn('Button("Unpick")', app)
        self.assertIn('.keyboardShortcut("u", modifiers: [])', app)
        self.assertGreaterEqual(
            app.count("unpickReviewSelection()"),
            3,
        )
        self.assertIn("ReviewQuickLookPresenter.present", review)
        self.assertIn("fixtureService.applyState(", unpick)
        self.assertIn(".undecided", unpick)
        self.assertIn('reason: "Native Review unpick"', unpick)
        self.assertIn("removeUnpickedReviewItems", unpick)
        self.assertIn("fixtureChanges: changes", unpick)
        self.assertNotIn("applyReviewAction(.hide)", unpick)
        self.assertIn("if !entry.fixtureChanges.isEmpty", undo)
        self.assertIn("by: \\.beforePlacementState", undo)
        self.assertIn("fixtureService.applyState(", undo)
        self.assertIn('case "u": .unpick', adapter)
        self.assertIn("QLPreviewPanel.shared()?.isVisible == true", adapter)

    def test_quick_look_supports_culling_review_shortcuts_metadata_and_advancement(self):
        app = backstage_ui_source()
        adapter = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageAppKitAdapters.swift"
        ).read_text(encoding="utf-8")

        for shortcut in (
            "case 123: return .previous",
            "case 124: return .next",
            'case "p": .pick',
            'case "h": .hide',
            'case "a": .approve',
            'case "1": .rating(1)',
            'case "5": .rating(5)',
            'case "6": .color(.red)',
            'case "9": .color(.blue)',
        ):
            self.assertIn(shortcut, adapter)
        for metadata_label in (
            'addMetadataRow("File"',
            'addMetadataRow("Title"',
            '"Keywords"',
            'addMetadataRow("Captured"',
            'addMetadataRow("Rating"',
            'addMetadataRow("Color"',
            'addMetadataRow("State"',
        ):
            self.assertIn(metadata_label, adapter)
        self.assertIn("currentPreviewItemIndex", adapter)
        self.assertIn("NSVisualEffectView", adapter)
        self.assertIn("NSPanel(", adapter)
        self.assertIn("panel.addChildWindow(metadataWindow, ordered: .above)", adapter)
        self.assertIn("case .beside:", adapter)
        self.assertIn("case .below:", adapter)
        self.assertIn("image.size.height > image.size.width", adapter)
        self.assertNotIn("contentView.addSubview(metadataPanel)", adapter)

        culling = app.split("private enum CullingQuickLookPresenter", 1)[1].split(
            "private enum ReviewQuickLookPresenter", 1
        )[0]
        self.assertIn("await model.applyPickShortcut(action)", culling)
        self.assertIn("await model.applyRatingShortcut(value)", culling)
        self.assertIn("await model.applyColorShortcut(value)", culling)
        self.assertIn("model.moveCullingSelection(by: delta, extending: false)", culling)
        self.assertIn("if wasVisible && !remainsVisible", culling)
        self.assertIn("present(model: model, coordinator: coordinator)", culling)

        review_presenter = app.split("private enum ReviewQuickLookPresenter", 1)[1].split(
            "struct ReviewView", 1
        )[0]
        self.assertIn("applyReviewAction(", review_presenter)
        self.assertIn(".approve", review_presenter)
        self.assertIn(".hide", review_presenter)
        self.assertIn("model.moveReviewSelection(by: delta, extending: false)", review_presenter)
        self.assertIn("coordinator.dismiss()", review_presenter)

    def test_fixture_policy_controls_adapt_to_the_available_width(self):
        source = backstage_ui_source()
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
            "X still moves the asset to the recoverable Waste Basket",
        ):
            self.assertIn(marker, source)
        self.assertNotIn("await applyPickDecision()", source)

    def test_large_queue_pagers_stay_visible_above_scrolling_content(self):
        source = backstage_ui_source()
        culling = source.split("struct CullingView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]
        review = source.split("struct ReviewView", 1)[1].split(
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
        source = backstage_ui_source()
        culling = source.split("struct CullingView", 1)[1].split(
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
            ".frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)",
            grid,
        )
        self.assertIn(".clipped()", grid)
        self.assertIn(".id(cullingViewportIdentity)", grid)
        self.assertIn(".padding(.top, 12)", grid)
        self.assertIn(".safeAreaInset(edge: .bottom, spacing: 0)", culling)
        self.assertIn(".frame(maxWidth: .infinity, alignment: .bottomLeading)", culling)
        self.assertIn(".layoutPriority(2)", culling)
        self.assertNotIn(".frame(maxWidth: .infinity, minHeight: 240, maxHeight: .infinity)", culling)
        self.assertNotIn("GeometryReader { paneGeometry in", culling)
        workspace = culling.split("private var cullingWorkspacePane", 1)[1].split(
            "private var cullingHeader", 1
        )[0]
        self.assertIn("cullingActions", workspace)
        self.assertNotIn(".clipped()", workspace)
        self.assertIn(".frame(minWidth: 480)", culling)
        self.assertIn(
            ".frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)",
            culling,
        )
        self.assertIn("GeometryReader { viewport in", culling)
        self.assertIn("let topInset = viewport.safeAreaInsets.top", culling)
        self.assertIn("let bottomInset = viewport.safeAreaInsets.bottom", culling)
        self.assertIn(".padding(.top, topInset)", culling)
        self.assertIn(".padding(.bottom, bottomInset)", culling)
        self.assertIn(
            "height: max(0, viewport.size.height - topInset - bottomInset)",
            culling,
        )
        self.assertIn(".frame(maxWidth: .infinity, maxHeight: .infinity)", culling)

    def test_culling_filters_are_visible_immediate_and_stale_safe(self):
        app = backstage_ui_source()
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        culling = app.split("struct CullingView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]
        card = app.split("private struct CullingAssetCard", 1)[1].split(
            "private struct", 1
        )[0]

        self.assertNotIn('Button("Apply")', culling)
        self.assertNotIn("Menu {", culling)
        self.assertGreaterEqual(culling.count(".toggleStyle(.checkbox)"), 1)
        self.assertNotIn("Text(\"Media\")", culling)
        self.assertIn("Text(\"Status\")", culling)
        self.assertIn("Text(\"Rating\")", culling)
        self.assertIn("Text(\"Color\")", culling)
        self.assertIn("LightroomRatingFilterButton(", culling)
        self.assertIn("LightroomColorFilterButton(", culling)
        self.assertIn("onChange(of: model.cullingSearch)", culling)
        self.assertIn("model.scheduleCullingSearchRefresh()", culling)
        self.assertIn(".saturation(isHidden ? 0 : 1)", card)
        self.assertIn("asset.placementState == .hidden", card)
        self.assertIn('Image(systemName: "flag.fill")', card)
        self.assertIn("asset.placementState == .picked", card)
        self.assertIn("cullingFilterTask?.cancel()", model)
        self.assertIn("cullingWindowRequestSerial", model)
        self.assertIn("let previousStates = ids.map", model)
        self.assertIn("decision.pickState = state.rawValue", model)
        self.assertIn("cullingStates.removeValue(forKey: id)", model)
        self.assertIn(
            "guard requestSerial == cullingWindowRequestSerial, !Task.isCancelled else { return }",
            model,
        )

    def test_source_workflows_are_still_only_without_media_controls(self):
        app = backstage_ui_source()
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        owner = (
            NATIVE / "Sources" / "OwnerCore" / "FixtureWorkflowService.swift"
        ).read_text(encoding="utf-8")
        photo_library = (
            NATIVE / "Sources" / "OwnerCore" / "PhotoLibraryService.swift"
        ).read_text(encoding="utf-8")
        bridge = (ROOT / "scripts" / "apple_photos_bridge.swift").read_text(
            encoding="utf-8"
        )
        pipeline = (ROOT / "scripts" / "fixture_pipeline.py").read_text(
            encoding="utf-8"
        )
        culling = app.split("struct CullingView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]
        review = app.split("struct ReviewView", 1)[1].split(
            "private struct ReviewAssetRow", 1
        )[0]
        loader = model.split(
            "func loadFixtureCullingWindow(preservingVisibleWindow: Bool = false)",
            1,
        )[1].split("private func scheduleFixtureCullingBackfill", 1)[0]

        self.assertNotIn('Text("Media")', culling)
        self.assertNotIn("cullingMediaFilterControls", culling)
        self.assertNotIn('Text("Media")', review)
        self.assertNotIn("toggleReviewMediaFilter", review)
        self.assertIn("PHAsset.fetchAssets(with: .image", photo_library)
        self.assertGreaterEqual(
            bridge.count("PHAsset.fetchAssets(with: .image"),
            2,
        )
        self.assertIn('format: "mediaType == %d"', bridge)
        self.assertIn('code: "source_video_unsupported"', bridge)
        self.assertNotIn('case "video":', bridge)
        self.assertNotIn("writeLocalVideoPosterPreviewJPEG", bridge)
        self.assertNotIn("writeVideoResource", bridge)
        self.assertNotIn("import AVFoundation", bridge)
        self.assertIn("case unsupportedMediaType(String)", photo_library)
        self.assertGreaterEqual(
            pipeline.count("lower(COALESCE(a.media_type, 'photo')) NOT LIKE '%video%'"),
            5,
        )
        self.assertIn(
            "source videos cannot enter a still-only Culling snapshot",
            pipeline,
        )
        self.assertIn('mediaFilters: [String] = ["photos"]', owner)
        self.assertIn('mediaTypes: ["photo"]', loader)
        self.assertIn("cullingMediaFilters = [.photos]", loader)
        self.assertIn("reviewMediaFilters = [.photos]", model)
        self.assertIn(
            "mediaFilters: [CullingMediaFilter.photos.rawValue]",
            model,
        )
        self.assertIn("fixtureCullingMediaAvailability = window.mediaAvailability", loader)
        self.assertEqual(loader.count("let window = try await requestWindow("), 1)
        self.assertNotIn("requestedMediaFilters", loader)
        self.assertNotIn("requestedMediaFilters.isDisjoint", loader)
        self.assertIn(
            "normalizeCullingMediaFilters(for: cullingMediaFilterControls)",
            model,
        )
        reset = model.split("private func resetFixtureScopedViewState()", 1)[1].split(
            "func refreshVisibleFixtureSurface", 1
        )[0]
        apply_filters = model.split("func applyCullingFilters", 1)[1].split(
            "func scheduleCullingSearchRefresh", 1
        )[0]
        self.assertIn("fixtureCullingMediaAvailability = nil", reset)
        self.assertNotIn("fixtureCullingMediaAvailability = nil", apply_filters)
        self.assertNotIn("window.items.count(where:", model)

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
        self.assertIn('if [[ -e "$app" || -L "$app" ]]', build_script)
        self.assertIn('if [[ -L "$app" || ! -d "$app" ]]', build_script)
        self.assertIn('chmod -R u+w "$app"', build_script)
        self.assertLess(
            build_script.index('chmod -R u+w "$app"'),
            build_script.index('rm -rf "$app"'),
        )

    def test_backstage_release_metadata_excludes_the_legacy_bridge(self):
        metadata = (NATIVE / "release-metadata.zsh").read_text(encoding="utf-8")
        build_script = (NATIVE / "scripts" / "build-app.zsh").read_text(
            encoding="utf-8"
        )
        bridge_installer = (
            ROOT / "scripts" / "install_sidecar_photos_bridge_app.zsh"
        ).read_text(encoding="utf-8")

        def value(name: str) -> str:
            match = re.search(rf'^{name}="([^"]+)"$', metadata, re.MULTILINE)
            self.assertIsNotNone(match, name)
            return match.group(1)

        self.assertEqual(value("PBE_BACKSTAGE_VERSION"), "227.1")
        self.assertEqual(value("PBE_BACKSTAGE_BUILD"), "91")
        self.assertIn('source "$release_metadata"', build_script)
        self.assertIn('source "$release_metadata"', bridge_installer)
        self.assertIn("PBE_BACKSTAGE_INFO_PLIST", bridge_installer)
        self.assertNotIn("PBE_PHOTOS_BRIDGE_", metadata)
        self.assertNotIn("PBEPhotosBridge", build_script)
        self.assertNotIn("Backstage and Photos Bridge", build_script)
        self.assertIn('PBE_PHOTOS_BRIDGE_VERSION="${PBE_PHOTOS_BRIDGE_VERSION:-141.10}"', bridge_installer)
        self.assertIn('PBE_PHOTOS_BRIDGE_BUILD="${PBE_PHOTOS_BRIDGE_BUILD:-1}"', bridge_installer)
        self.assertNotIn("Print :PBEPhotosBridge", bridge_installer)
        self.assertNotIn("SIDECAR_VERSION", build_script)
        self.assertNotIn("SIDECAR_VERSION", bridge_installer)
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
        self.assertIn('identity="${PBE_CODESIGN_IDENTITY:-}"', bridge_installer)
        self.assertIn("Developer ID Application:", bridge_installer)
        self.assertIn("Apple Development:", bridge_installer)
        self.assertIn('PBE_ALLOW_ADHOC_SIGNING:-0', bridge_installer)
        self.assertIn(
            "Photos Bridge installation is blocked because ad-hoc rebuilds can lose Photos and Keychain authorization.",
            bridge_installer,
        )
        self.assertIn("--options runtime --sign", bridge_installer)
        self.assertIn("Signature=adhoc", bridge_installer)

    def test_bridge_installer_refuses_a_silent_downgrade(self):
        installer = ROOT / "scripts" / "install_sidecar_photos_bridge_app.zsh"
        with tempfile.TemporaryDirectory() as temporary_directory:
            app = Path(temporary_directory) / "PhotosByElie Photos Bridge.app"
            contents = app / "Contents"
            contents.mkdir(parents=True)
            marker = contents / "must-survive"
            marker.write_text("newer helper\n", encoding="utf-8")
            with (contents / "Info.plist").open("wb") as handle:
                plistlib.dump(
                    {
                        "CFBundleIdentifier": "com.photosbyelie.photos-bridge",
                        "CFBundleShortVersionString": "999.0",
                        "CFBundleVersion": "999",
                    },
                    handle,
                )

            result = subprocess.run(
                ["zsh", str(installer), "--app-dir", str(app)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Preserved newer Photos Bridge 999.0 build 999", result.stdout)
            self.assertEqual(marker.read_text(encoding="utf-8"), "newer helper\n")

    def test_backstage_control_cli_is_structured_and_does_not_use_cua(self):
        control = (
            NATIVE / "Sources" / "OwnerCore" / "BackstageControlService.swift"
        ).read_text(encoding="utf-8")
        launcher = (
            NATIVE / "Sources" / "BackstageLauncher" / "main.swift"
        ).read_text(encoding="utf-8")
        wrapper = (ROOT / "scripts" / "backstage-control.zsh").read_text(
            encoding="utf-8"
        )
        docs = (ROOT / "docs" / "BACKSTAGE_GETTING_STARTED.md").read_text(
            encoding="utf-8"
        )

        for marker in (
            "BackstageControlHealth",
            "schemaVersion",
            "photoLibrary.authorization()",
            "ownerAuthenticated",
            "release verify",
            "photos health",
            "photos authorize",
            "requestAuthorization",
            "invalid_arguments",
        ):
            self.assertIn(marker, control)
        self.assertNotIn("PhotosBridgeHealthService", control)
        self.assertNotIn("PhotosByElie Photos Bridge.app", control)
        self.assertIn('arguments.first == "--control"', launcher)
        self.assertIn("Darwin.exit(exitCode)", launcher)
        self.assertIn("/usr/bin/open -n -j", wrapper)
        self.assertIn('--args --control "$@"', wrapper)
        self.assertIn('--stdout "$stdout_path"', wrapper)
        self.assertIn('payload.get("ok") is True', wrapper)
        self.assertNotIn('exec "$executable" --control', wrapper)
        self.assertIn("scripts/backstage-control.zsh health --pretty", docs)
        self.assertNotIn("AXUIElement", control)
        self.assertNotIn("CGEvent", control)

    def test_culling_refreshes_previews_without_competing_owner_reconciliation(self):
        source = backstage_ui_source()
        model_source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        culling = source.split("struct CullingView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]
        feedback = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageFeedbackView.swift"
        ).read_text(encoding="utf-8")

        self.assertIn("await model.refreshPhotos()", culling)
        self.assertIn("struct BackstageFeedbackView: View", feedback)
        self.assertIn('.accessibilityLabel(isWorking ? "Working. ', feedback)
        self.assertIn("BackstageFeedbackView(", culling)
        self.assertIn(
            "isWorking: model.isLoadingPhotos || model.isReconcilingPhotosIndex",
            culling,
        )
        self.assertIn('photoStatus = "Refreshing Photos previews…"', model_source)
        self.assertIn("guard !isLoadingPhotos else { return }", model_source)
        self.assertIn('Text("Refreshing previews…")', culling)
        self.assertIn('"Refreshing Photos previews" : "Refresh Photos previews"', culling)
        self.assertNotIn("await model.refreshPhotosAndRecentIndex()", culling)
        self.assertNotIn("await model.refreshPhotosAndRecentIndex(force: true)", culling)
        self.assertIn("await model.reconcilePhotosLibraryIndex()", culling)
        self.assertIn("func reconcileRecentPhotosIndex(force: Bool = false)", model_source)
        self.assertIn("value: -45", model_source)
        self.assertIn('dateFormatter.dateFormat = "yyyy-MM-dd"', model_source)
        self.assertLess(
            culling.index("await model.refreshPhotos()"),
            culling.index("await model.loadFixtureCullingWindow()"),
        )

    def test_shared_feedback_surface_is_adopted_by_review_and_upload_headers(self):
        source_dir = NATIVE / "Sources" / "BackstageApp"
        review = (source_dir / "ReviewView.swift").read_text(encoding="utf-8")
        upload = (source_dir / "UploadHeaderView.swift").read_text(encoding="utf-8")

        self.assertIn("BackstageFeedbackView(", review)
        self.assertIn("message: model.aiProposalStatus", review)
        self.assertIn(
            "isWorking: model.isRunningAIPass || model.fixtureAIStatus?.active == true",
            review,
        )
        self.assertNotIn("Text(model.aiProposalStatus)", review)

        self.assertIn("BackstageFeedbackView(", upload)
        self.assertIn("message: model.nativeUploadStatus", upload)
        self.assertIn(
            "isWorking: model.isRunningDelivery || model.isRunningNativePublication",
            upload,
        )
        self.assertNotIn("Text(model.nativeUploadStatus)", upload)

    def test_shared_feedback_surface_is_adopted_by_main_app_status_surfaces(self):
        app = (
            NATIVE / "Sources" / "BackstageApp" / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")

        expected_feedback = {
            "authenticationStatus": "model.isAuthenticating",
            "deliveryStatus": "model.isRunningDelivery",
            "r2ReconciliationStatus": "model.isRunningR2Reconciliation",
            "lifecycleStatus": "model.isRunningLifecycle",
            "fixturePolicyStatus": "model.isLoadingFixturePolicy",
            "fixtureSnapshotStatus": "model.isRunningFixtureSnapshotOperation",
            "accessStatus": "model.isRunningAccess",
            "photosSyncStatus": "model.isSyncingPhotos",
            "metadataModelLadderStatus": "model.isSavingMetadataModelLadder",
            "metadataStatus": "model.isRunningMetadata",
        }
        for status, flag in expected_feedback.items():
            self.assertIn("BackstageFeedbackView(", app)
            self.assertIn(f"message: model.{status}", app)
            self.assertIn(f"isWorking: {flag}", app)
            self.assertNotIn(f"Text(model.{status})", app)

        self.assertIn(
            'message: model.isLoadingFixtureTree ? "Loading fixture tree…" : model.fixtureStatus',
            app,
        )
        self.assertNotIn("Text(model.fixtureStatus)", app)

        for status in ("metadataReviewStatus", "metadataProposalStatus"):
            self.assertIn("BackstageFeedbackView(", app)
            self.assertIn(f"message: model.{status}", app)
            self.assertNotIn(f"Text(model.{status})", app)

        for flag in (
            "model.isRunningFixture",
            "model.isSearchingFixtureAssets",
            "model.isRunningFixtureSnapshotOperation",
            "model.isLoadingFixturePolicy",
        ):
            self.assertIn(flag, app)

    def test_shared_feedback_surface_is_adopted_by_remaining_workflow_surfaces(self):
        source_dir = NATIVE / "Sources" / "BackstageApp"
        culling = (source_dir / "CullingView.swift").read_text(encoding="utf-8")
        review = (source_dir / "ReviewView.swift").read_text(encoding="utf-8")
        upload = (source_dir / "UploadView.swift").read_text(encoding="utf-8")
        picker = (source_dir / "FixturePicker.swift").read_text(encoding="utf-8")

        self.assertIn("BackstageFeedbackView(", culling)
        self.assertIn("message: model.cullingStatus", culling)
        for flag in (
            "model.isLoadingFixtureCulling",
            "model.isLoadingCullingDecisions",
            "model.isApplyingCullingDecision",
            "model.isLoadingPreview",
        ):
            self.assertIn(flag, culling)
        self.assertNotIn("Text(model.cullingStatus)", culling)

        self.assertGreaterEqual(review.count("message: model.reviewStatus"), 2)
        self.assertGreaterEqual(review.count("BackstageFeedbackView("), 2)
        self.assertIn(
            "isWorking: model.isRunningReview || model.isRunningAIPass",
            review,
        )
        self.assertNotIn("Text(model.reviewStatus)", review)

        self.assertIn("BackstageFeedbackView(", upload)
        self.assertIn("message: model.uploadRecoveryStatus", upload)
        self.assertIn("isWorking: model.isRunningDelivery", upload)
        self.assertNotIn("Text(model.uploadRecoveryStatus)", upload)

        self.assertIn("BackstageFeedbackView(", picker)
        self.assertIn("message: model.pbeOwnerSessionStatus", picker)
        self.assertIn("isWorking: model.isLaunchingPBEOwner", picker)
        self.assertNotIn("Text(model.pbeOwnerSessionStatus)", picker)

    def test_fixture_window_is_filtered_again_before_cards_are_rendered(self):
        model_source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")

        self.assertIn("let exactWindow = CullingWorkspace.evaluate(", model_source)
        self.assertIn("query: cullingQuery", model_source)
        self.assertIn("return exactWindow.items.compactMap", model_source)

    def test_density_controls_resize_only_the_grid_viewport(self):
        source = backstage_ui_source()
        culling = source.split("struct CullingView", 1)[1].split(
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
        source = backstage_ui_source()
        culling = source.split("struct CullingView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]
        review = source.split("struct ReviewView", 1)[1].split(
            "private struct ReviewInspector", 1
        )[0]
        root = source.split("private struct OverviewView", 1)[0]
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")

        self.assertIn("var isPreviewPanelVisible: Bool", model)
        self.assertIn("cullingPreviewPanelVisibilityPreferenceKey", model)
        self.assertIn("reviewPreviewPanelVisibilityPreferenceKey", model)
        self.assertIn('Image(systemName: "sidebar.right")', root)
        self.assertIn('model.selection == .culling || model.selection == .review', root)
        self.assertIn("Collapse the Culling or Review preview inspector", root)
        self.assertIn("Expand the Culling or Review preview inspector", root)
        self.assertIn("if model.authentication.phase == .authenticated", root)
        self.assertIn('else if model.status != "Connected"', root)
        self.assertLess(
            root.index("if model.authentication.phase == .authenticated"),
            root.index('Image(systemName: "sidebar.right")'),
        )
        self.assertNotIn("@State private var isCullingPreviewVisible", culling)
        self.assertIn("if model.isPreviewPanelVisible", culling)
        self.assertIn(".frame(minWidth: 220, idealWidth: 300, maxWidth: 360)", culling)
        preview_boundary = culling.index("if model.isPreviewPanelVisible")
        for persistent_control in (
            'Button("Clear filters")',
            'Button("Previous \\(workspace.limit)")',
            'Button("Next \\(workspace.limit)")',
            'Button("−")',
            'Button("+")',
            'Button(model.cullingUsesFill ? "Fill" : "Fit")',
        ):
            self.assertIn(persistent_control, culling)
        self.assertIn('Button("Review picked")', source)
        self.assertIn("if model.isPreviewPanelVisible", review)
        self.assertIn(".frame(minWidth: 300, idealWidth: 380, maxWidth: 480)", review)

    def test_primary_canvases_are_colocated_with_production_views(self):
        source_dir = NATIVE / "Sources" / "BackstageApp"
        expectations = (
            ("CullingView.swift", "struct CullingView: View", '#Preview("Culling — Wide")'),
            ("ReviewView.swift", "struct ReviewView: View", '#Preview("Review — Loaded")'),
            ("UploadView.swift", "struct UploadView: View", '#Preview("Uploads — Ready")'),
        )
        for filename, view_marker, preview_marker in expectations:
            source = (source_dir / filename).read_text(encoding="utf-8")
            self.assertIn(view_marker, source)
            self.assertIn(preview_marker, source)
            self.assertIn("guard !isPreviewMode else { return }", source)

        app = (source_dir / "PhotosByElieBackstageApp.swift").read_text(
            encoding="utf-8"
        )
        self.assertIn("CullingView(model: model)", app)
        self.assertIn("ReviewView(model: model)", app)
        self.assertIn("UploadView(model: model)", app)
        self.assertNotIn("MediaLibraryView", app)
        self.assertNotIn("FixtureReviewView", app)
        self.assertNotIn("UploadWorkflowView", app)

    def test_native_xcode_host_enables_canvas_source_selection(self):
        project_definition = (NATIVE / "project.yml").read_text(encoding="utf-8")
        project_file = (
            NATIVE / "PhotosByElieBackstage.xcodeproj" / "project.pbxproj"
        ).read_text(encoding="utf-8")
        package = (NATIVE / "Package.swift").read_text(encoding="utf-8")

        self.assertIn("ENABLE_DEBUG_DYLIB: YES", project_definition)
        self.assertIn("ENABLE_DEBUG_DYLIB = YES;", project_file)
        self.assertIn("path = CullingView.swift;", project_file)
        self.assertIn("path = ReviewView.swift;", project_file)
        self.assertIn("path = UploadView.swift;", project_file)
        self.assertIn("BACKSTAGE_XCODE_HOST", project_definition)
        self.assertIn("path: Sources/BackstageApp", project_definition)
        self.assertNotIn("path: Sources/BackstageLauncher", project_definition)
        self.assertIn("target: OwnerCore", project_definition)
        self.assertNotIn("target: BackstageUI", project_definition)
        self.assertNotIn("BackstageUI.framework", project_file)
        for filename in ("CullingView.swift", "ReviewView.swift", "UploadView.swift"):
            source = (NATIVE / "Sources" / "BackstageApp" / filename).read_text(
                encoding="utf-8"
            )
            self.assertIn("import OwnerCore", source)
            self.assertNotIn("#if !BACKSTAGE_XCODE_HOST", source)
        app_source = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageXcodeApp.swift"
        ).read_text(encoding="utf-8")
        self.assertIn("#if BACKSTAGE_XCODE_HOST", app_source)
        self.assertIn("@main", app_source)
        self.assertIn('WindowGroup("Backstage Canvas Host")', app_source)
        self.assertIn("Color.clear", app_source)
        self.assertNotIn("BackstageApplication().body", app_source)
        self.assertNotIn("BackstageViewModel", app_source)
        self.assertIn(
            "PRODUCT_BUNDLE_IDENTIFIER: com.photosbyelie.backstage.canvas",
            project_definition,
        )
        self.assertIn(
            '.library(name: "BackstageUI", targets: ["BackstageUI"])',
            package,
        )
        self.assertNotIn(
            '.library(name: "BackstageUI", type: .dynamic',
            package,
        )

    def test_review_edits_autosave_and_propagation_controls_stay_compact(self):
        ui = backstage_ui_source()
        inspector = ui.split("private struct ReviewInspector", 1)[1]
        editor = (
            NATIVE / "Sources" / "BackstageApp" / "ReviewCanvasInspector.swift"
        ).read_text(encoding="utf-8")
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        reason_toggle = model.split("func toggleReviewAIReason", 1)[1].split(
            "func updateReviewAINote", 1
        )[0]

        self.assertNotIn('Button("Save T/K")', editor)
        self.assertIn("model.updateReviewTitle($0)", editor)
        self.assertIn("model.updateReviewKeywords($0)", editor)
        self.assertGreaterEqual(editor.count('Image(systemName: "arrow.down")'), 2)
        self.assertIn("Copy the current title to the other selected Review items", editor)
        self.assertIn("Copy the current keywords to the other selected Review items", editor)
        self.assertIn("scheduleReviewMetadataAutosave()", model)
        self.assertIn("Task.sleep(for: .milliseconds(600))", model)
        self.assertNotIn("applyReviewAction", reason_toggle)
        self.assertNotIn("reviewLastAction", reason_toggle)
        self.assertIn("model.toggleReviewAIReason(reason)", inspector)
        self.assertNotIn("await model.toggleReviewAIReason(reason)", inspector)
        self.assertIn('Text("Mark for AI review")', inspector)
        self.assertNotIn("reviewAIRequestButtonLabel", inspector)
        self.assertIn("model.updateReviewAINote($0)", inspector)
        self.assertNotIn("scheduleReviewAIRequestAutosave", model)
        self.assertNotIn("reviewAIRequestAutosaveTask", model)

    def test_canvas_components_are_production_reused_and_source_selectable(self):
        source_dir = NATIVE / "Sources" / "BackstageApp"
        ui = backstage_ui_source()
        inspector = ui.split("private struct ReviewInspector", 1)[1]
        model = (source_dir / "BackstageViewModel.swift").read_text(
            encoding="utf-8"
        )
        culling = (source_dir / "CullingCanvasControls.swift").read_text(
            encoding="utf-8"
        )
        review = (source_dir / "ReviewCanvasInspector.swift").read_text(
            encoding="utf-8"
        )
        upload = (source_dir / "UploadHeaderView.swift").read_text(
            encoding="utf-8"
        )
        self.assertIn('#Preview("Culling — Controls")', culling)
        self.assertIn('#Preview("T/K — Inspector")', review)
        self.assertIn('#Preview("Uploads — Header")', upload)
        self.assertIn("CullingSearchControls(model: model)", backstage_ui_source())
        self.assertIn("ReviewTitleKeywordEditor(model: model)", backstage_ui_source())
        self.assertIn("UploadHeaderView(", backstage_ui_source())
        self.assertIn(
            "confirmingSelectedPublication: $confirmingSelectedPublication",
            backstage_ui_source(),
        )
        self.assertIn('Button("Needs AI")', inspector)
        self.assertIn("await model.markReviewSelectionNeedsAI()", inspector)
        self.assertIn(".disabled(!model.canMarkReviewSelectionNeedsAI)", inspector)
        self.assertIn(
            "Prepare the reasons and optional note, then press Needs AI",
            inspector,
        )
        self.assertNotIn("hasExplicitPendingMetadataEdit", model)
        self.assertIn("if action == .approve", model)
        self.assertIn('Button(model.isRunningAIPass ? "AI pass running…" : "Run AI pass now")', ui)
        self.assertIn(".disabled(!model.canRunAIProposalPass)", ui)
        actions = inspector.split('Button("Approve")', 1)[1].split("Divider()", 1)[0]
        self.assertIn('Button("Hide")', actions)
        self.assertIn('Button("Needs AI")', actions)
        self.assertIn('Button("Propagate")', actions)
        self.assertIn('Image(systemName: "checkmark.circle.fill")', ui)
        self.assertIn('Image(systemName: "questionmark.circle.fill")', ui)
        self.assertIn("hasDraftAIReason: false", ui)
        self.assertIn('.saturation(item.placementState == "hidden" ? 0 : 1)', ui)
        self.assertIn(".font(.system(size: 30, weight: .bold))", ui)
        self.assertIn(
            "if [.approve, .hide, .requestAI].contains(action)",
            model,
        )
        propagate = model.split("func propagateLastReviewAction", 1)[1].split(
            "func refreshAIStatus", 1
        )[0]
        self.assertIn(
            "let action = hasReviewAIDraft ? .requestAI : reviewLastAction",
            propagate,
        )
        self.assertIn("await applyReviewAction(action, propagate: true)", propagate)
        self.assertNotIn(
            "await applyReviewAction(reviewLastAction, propagate: true)",
            propagate,
        )

    def test_every_backstage_button_has_half_second_hover_help(self):
        source_dir = NATIVE / "Sources" / "BackstageApp"
        total_buttons = 0
        for path in sorted(source_dir.glob("*.swift")):
            source = path.read_text(encoding="utf-8")
            button_count = len(re.findall(r"\bButton\s*(?:\(|\{)", source))
            if button_count == 0:
                continue
            help_count = source.count(".backstageHelp(")
            self.assertEqual(
                button_count,
                help_count,
                f"{path.name} must attach one backstageHelp explanation to every Button",
            )
            total_buttons += button_count

        self.assertGreaterEqual(total_buttons, 123)
        hover_help = (source_dir / "BackstageHoverHelp.swift").read_text(
            encoding="utf-8"
        )
        self.assertIn("Task.sleep(for: .milliseconds(500))", hover_help)
        self.assertIn("BackstageTooltipPlacement", hover_help)
        self.assertIn("NSPanel", hover_help)
        self.assertIn("window.addChildWindow(panel, ordered: .above)", hover_help)
        self.assertIn("NSWindow.didResizeNotification", hover_help)
        self.assertIn("NSView.boundsDidChangeNotification", hover_help)
        self.assertIn("maximumContentHeight", hover_help)
        self.assertIn("maximumLineCount", hover_help)
        self.assertIn(".truncationMode(.tail)", hover_help)
        self.assertIn(".allowsHitTesting(false)", hover_help)
        self.assertIn("panel.ignoresMouseEvents = true", hover_help)
        self.assertNotIn(".popover(", hover_help)
        self.assertIn(".accessibilityHint(explanation)", hover_help)
        self.assertIn(".accessibilityLabel(explanation)", hover_help)

    def test_upload_preview_hides_current_item_and_advances(self):
        ui = backstage_ui_source()
        upload = ui.split("struct UploadView", 1)[1].split(
            "private struct DeliverablesView",
            1,
        )[0]
        self.assertIn('.onKeyPress("h")', upload)
        self.assertIn("hideCurrentUploadQuickView(in: plan)", upload)
        self.assertIn("await model.hideSelectedUploads()", upload)
        self.assertIn("uploadQuickViewItem = next", upload)
        self.assertIn("await model.loadNativeUploadPreview(for: next)", upload)
        self.assertIn("H hides", upload)

    def test_upload_preview_returns_current_item_to_review_and_advances(self):
        ui = backstage_ui_source()
        upload = ui.split("struct UploadView", 1)[1].split(
            "private struct DeliverablesView",
            1,
        )[0]
        self.assertIn('.onKeyPress("r")', upload)
        self.assertIn("returnCurrentUploadQuickViewToReview(in: plan)", upload)
        self.assertIn("await model.returnSelectedUploadsToReview()", upload)
        self.assertIn("uploadQuickViewItem = next", upload)
        self.assertIn("await model.loadNativeUploadPreview(for: next)", upload)
        self.assertIn("R returns to Review", upload)

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

    def test_current_source_media_contract_is_documented(self):
        guide = (ROOT / "docs" / "BACKSTAGE_GETTING_STARTED.md").read_text(
            encoding="utf-8"
        )
        parity = (
            ROOT / "docs" / "architecture" / "sidecar-parity-inventory.md"
        ).read_text(encoding="utf-8")
        historical = (ROOT / "docs" / "architecture" / "sidecar.md").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "Backstage Culling and Review source candidates are still photos only",
            guide,
        )
        self.assertIn(
            "Generated Real Estate videos are downstream Delivery outputs",
            guide,
        )
        self.assertIn("source video assets are rejected before candidate", parity)
        self.assertIn(
            "generated Real Estate videos are handled only by Delivery",
            parity,
        )
        self.assertIn("Historical-only video behavior", historical)
        self.assertIn(
            "Current Backstage source and review workflows are stills-only",
            historical,
        )


if __name__ == "__main__":
    unittest.main()
