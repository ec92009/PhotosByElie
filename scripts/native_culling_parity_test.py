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
        self.assertIn(
            'Button("Select burst") { model.selectVisibleBurstCandidates() }',
            source,
        )
        self.assertNotIn(
            ".disabled(model.focusedCullingAssetID == nil)",
            source,
        )

    def test_window_and_preview_layout_persist_between_launches(self):
        app = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        persistence = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageWindowState.swift"
        ).read_text(encoding="utf-8")
        self.assertIn('WindowFrameAutosaver(name: "PhotosByElieBackstage.MainWindow")', app)
        self.assertIn('SplitViewAutosaver(name: "PhotosByElieBackstage.FixturesSplit")', app)
        self.assertIn('SplitViewAutosaver(name: "PhotosByElieBackstage.AccessSplit")', app)
        self.assertIn('SplitViewAutosaver(name: "PhotosByElieBackstage.CullingSplit")', app)
        self.assertIn('SplitViewAutosaver(name: "PhotosByElieBackstage.ReviewSplit")', app)
        self.assertIn("previewPanelVisibilityPreferenceKey", model)
        self.assertIn("setFrameAutosaveName", persistence)
        self.assertIn("splitView.autosaveName", persistence)

    def test_culling_inspector_shows_capture_time_to_seconds(self):
        source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        self.assertIn("MMM d, yyyy 'at' HH:mm:ss", source)

    def test_fixture_filters_hide_stale_or_recent_photo_fallback_rows(self):
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        ui = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
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
        ui = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
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
        ui = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
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
        ui = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        canvas = (
            NATIVE / "Sources" / "BackstageApp" / "ReviewView.swift"
        ).read_text(encoding="utf-8")
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

    def test_review_keeps_only_filtered_approved_and_hidden_propagation_anchors(self):
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
        self.assertIn(".filter(reviewItemMatchesActiveFilters)", apply_action)
        self.assertIn("reviewStateFilters.contains(state)", apply_action)
        self.assertIn("!reviewProposalAvailableOnly || item.proposalReady", apply_action)
        self.assertIn("reviewMediaFilters.contains(mediaFilter)", apply_action)
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
        self.assertIn("CullingMediaFilter.selectableCases", app)
        self.assertIn("reviewMediaFilters.contains", app)
        self.assertIn("toggleReviewMediaFilter", model)
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
        self.assertIn("if action == .approve", apply_action)
        request_ai_guard = apply_action.split(
            "let ids = selectedReviewAssetIDs",
            1,
        )[0]
        self.assertNotIn(
            "await saveReviewMetadataIfNeeded()",
            request_ai_guard.split("if action == .approve", 1)[0],
        )

    def test_review_unpick_clears_fixture_pick_from_list_inspector_and_quick_look(self):
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
        adapter = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageAppKitAdapters.swift"
        ).read_text(encoding="utf-8")
        review = app.split("struct FixtureReviewView", 1)[1].split(
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
        app = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
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
        self.assertIn("widthAnchor.constraint(lessThanOrEqualToConstant: 560)", adapter)
        self.assertIn("metadataPanel.centerXAnchor.constraint", adapter)
        self.assertIn("metadataPanel.bottomAnchor.constraint", adapter)
        self.assertNotIn("metadataPanel.widthAnchor.constraint(equalToConstant: 300)", adapter)

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
            "struct MediaLibraryView", 1
        )[0]
        self.assertIn("applyReviewAction(", review_presenter)
        self.assertIn(".approve", review_presenter)
        self.assertIn(".hide", review_presenter)
        self.assertIn("model.moveReviewSelection(by: delta, extending: false)", review_presenter)
        self.assertIn("coordinator.dismiss()", review_presenter)

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
        culling = source.split("struct MediaLibraryView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]
        review = source.split("struct FixtureReviewView", 1)[1].split(
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
        culling = source.split("struct MediaLibraryView", 1)[1].split(
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
        self.assertIn("GeometryReader { viewport in", culling)
        self.assertIn(".padding(.top, viewport.safeAreaInsets.top)", culling)
        self.assertIn(
            "height: max(0, viewport.size.height - viewport.safeAreaInsets.top)",
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
        culling = app.split("struct MediaLibraryView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]
        card = app.split("private struct CullingAssetCard", 1)[1].split(
            "private struct", 1
        )[0]

        self.assertNotIn('Button("Apply")', culling)
        self.assertNotIn("Menu {", culling)
        self.assertGreaterEqual(culling.count(".toggleStyle(.checkbox)"), 2)
        self.assertIn("Text(\"Media\")", culling)
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

    def test_culling_refreshes_previews_without_competing_owner_reconciliation(self):
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
        culling = source.split("struct MediaLibraryView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]

        self.assertIn("await model.refreshPhotos()", culling)
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
        source = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        culling = source.split("struct MediaLibraryView", 1)[1].split(
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
        culling = source.split("struct MediaLibraryView", 1)[1].split(
            "private struct CullingAssetCard", 1
        )[0]
        review = source.split("struct FixtureReviewView", 1)[1].split(
            "private struct ReviewInspector", 1
        )[0]
        root = source.split("private struct OverviewView", 1)[0]
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")

        self.assertIn("@Published var isPreviewPanelVisible: Bool", model)
        self.assertIn("previewPanelVisibilityPreferenceKey", model)
        self.assertIn('Image(systemName: "sidebar.right")', root)
        self.assertIn('model.selection == .culling || model.selection == .review', root)
        self.assertIn('"Collapse preview panel"', root)
        self.assertIn('"Expand preview panel"', root)
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
            "func updateReviewAINote", 1
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
        self.assertNotIn("reviewAIRequestButtonLabel", inspector)
        self.assertIn("model.updateReviewAINote($0)", inspector)
        self.assertNotIn("scheduleReviewAIRequestAutosave", model)
        self.assertNotIn("reviewAIRequestAutosaveTask", model)
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

    def test_upload_preview_hides_current_item_and_advances(self):
        ui = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        upload = ui.split("private struct UploadWorkflowView", 1)[1].split(
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
        ui = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        upload = ui.split("private struct UploadWorkflowView", 1)[1].split(
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


if __name__ == "__main__":
    unittest.main()
