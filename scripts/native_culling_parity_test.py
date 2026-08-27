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
            "UploadPreview.swift",
            "PhotosByElieBackstageApp.swift",
        )
    )


class NativeCullingParityTest(unittest.TestCase):
    def test_gallery_is_the_visible_destination_and_culling_is_a_saved_view(self):
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        app = (
            NATIVE / "Sources" / "BackstageApp" / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        controls = (
            NATIVE / "Sources" / "BackstageApp" / "CullingCanvasControls.swift"
        ).read_text(encoding="utf-8")
        surface = (
            NATIVE / "Sources" / "BackstageApp" / "CullingView.swift"
        ).read_text(encoding="utf-8")

        self.assertIn('case culling = "Culling"', model)
        self.assertIn('self == .culling ? "Gallery" : rawValue', model)
        self.assertIn("Label(section.title, systemImage: icon(for: section))", app)
        self.assertIn('Text("Gallery")', surface)
        self.assertIn('Menu("View: \\(model.gallerySavedViewLabel)")', controls)
        self.assertIn("ForEach(GallerySavedView.allCases)", controls)
        self.assertIn("Button(savedView.rawValue)", controls)
        self.assertIn("model.applyGallerySavedView(savedView)", controls)
        for marker in (
            'case allAssets = "All fixture assets"',
            'case culling = "Culling — Undecided"',
            'case reviewQueue = "Review queue"',
            'case approved = "Approved"',
            'case uploadQueue = "Upload queue"',
            'case live = "Live"',
            'case hidden = "Hidden"',
            'case unavailable = "Unavailable"',
            "case .allAssets:",
            "case .culling:",
            "([.undecided], [], [], [.available])",
        ):
            self.assertIn(marker, model)

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
            "func retryThumbnail(for assetID: String,",
            "cullingThumbnailUpgradeTasks: [String: Task<Void, Never>]",
            "cullingVisibleAssetIDs = Set<String>()",
            "func cullingAssetDidAppear(_ asset: FixtureAsset)",
            "func cullingAssetDidDisappear(_ assetID: String)",
            "func cullingScrollPhaseChanged(isScrolling: Bool)",
            "cullingThumbnailUpgradeDelay: Duration = .seconds(1)",
            '"PBE_CULLING_PREVIEW_FAIL_ONCE"',
            "Task.sleep(for: self.cullingThumbnailUpgradeDelay)",
            "maxPixelSize: Self.cullingThumbnailUpgradePixelSize",
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
            "CullingScrollPhaseObserver(model: model)",
            "model.cullingAssetDidAppear(asset)",
            "model.cullingAssetDidDisappear(asset.id)",
            ".onScrollPhaseChange",
            "phase.isScrolling",
        ):
            self.assertIn(marker, source)

    def test_culling_preview_fixture_exposes_stable_failed_thumbnail_retry_state(self):
        preview = (
            NATIVE / "Sources" / "BackstageApp" / "CullingPreview.swift"
        ).read_text(encoding="utf-8")
        for marker in (
            "failedThumbnail: Bool = false",
            "if failedThumbnail",
            'model.cullingThumbnailFailures[\"expo-1\"] = .previewUnavailable',
            '#Preview(\"Gallery — Thumbnail Failure\")',
            "BackstageViewModel(photoLibrary: PreviewPhotoLibrary())",
            "private struct PreviewPhotoLibrary: PhotoLibraryServing",
            "Canvas previews must never reach the user's Photos library.",
        ):
            self.assertIn(marker, preview)

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
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        for marker in (
            "OutlineGroup(model.fixtures",
            "Review picked",
            "Select burst",
            "Search title, file, or keyword",
            'Button("P Pick")',
            'Button("H Hide")',
            'Button("U \\(model.cullingClearDecisionLabel)")',
            'accessibilityLabel("U \\(model.cullingClearDecisionLabel) selected items")',
            "Task { await model.applyPickShortcut(.unpick) }",
            'Button("X Waste Basket")',
            'Menu("Workflows")',
            "thumbnail: model.cullingThumbnails",
            'onKeyPress("p")',
            'onKeyPress("h")',
            'onKeyPress("x")',
            'onKeyPress("z", phases: .down)',
            "press.modifiers.contains(.command)",
            "await model.undoLastCullingDecision()",
            'onKeyPress("u")',
            'onKeyPress("b")',
            "P pick • H hide • U clears the selected fixture decision",
            "X Waste Basket",
            "Button(\"Stop\")",
            "ScrollView(.vertical)",
            "FixtureCullingView.selectableCases",
            "cullingMinimumRating",
            "CullingColorFilter.selectableCases",
        ):
            self.assertIn(marker, source)
        for marker in (
            'var cullingClearDecisionLabel: String',
            'var canClearCullingDecision: Bool',
            'if placements == [.hidden] { return "Unhide" }',
            'if placements == [.picked] { return "Unpick" }',
            'return "Clear decisions"',
        ):
            self.assertIn(marker, model)
        self.assertIn("case .unpick:", source)
        self.assertIn("applyPlacement(\n                            .unpick,", source)
        self.assertNotIn("127.0.0.1:8011", source)
        self.assertRegex(
            source,
            re.compile(
                r'Button\("Select burst"\)\s*\{\s*model\.selectReviewBurstCandidates\(\)\s*\}',
                re.DOTALL,
            ),
        )
        self.assertNotIn(
            ".disabled(model.focusedCullingAssetID == nil)",
            source,
        )

    def test_review_exposes_selection_only_burst_action(self):
        review = (
            NATIVE / "Sources" / "BackstageApp" / "ReviewView.swift"
        ).read_text(encoding="utf-8")
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        workspace = (
            NATIVE / "Sources" / "OwnerCore" / "CullingWorkspace.swift"
        ).read_text(encoding="utf-8")
        for marker in (
            'Button("Select burst")',
            "model.canSelectReviewBurstCandidates",
            "model.selectReviewBurstCandidates()",
            'onKeyPress("b")',
        ):
            self.assertIn(marker, review)
        for marker in (
            "var canSelectReviewBurstCandidates: Bool",
            "func selectReviewBurstCandidates()",
            "CullingWorkspace.reviewBurstRejectCandidates(in: items)",
            "reviewScrollTargetID = focusedID",
        ):
            self.assertIn(marker, model)
        self.assertIn(
            "func reviewBurstRejectCandidates(",
            workspace,
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

    def test_fresh_launch_defaults_to_expo_culling_undecided_only(self):
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        coordinator = (
            NATIVE
            / "Sources"
            / "OwnerCore"
            / "FixtureSelectionCoordinator.swift"
        ).read_text(encoding="utf-8")
        self.assertIn("flatMap(Section.init(rawValue:)) ?? .culling", model)
        self.assertIn(
            "@Published var cullingViews: Set<FixtureCullingView> = [.undecided]",
            model,
        )
        self.assertIn(
            'selectedFixtureID = fixtureSelectionCoordinator.selectedFixtureID ?? ""',
            model,
        )
        self.assertIn('public static let expoFixtureID = "fixture-expo"', coordinator)
        self.assertIn(
            "@Published var reviewStateFilters: Set<FixtureReviewStateFilter> = [.picked]",
            model,
        )

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

    def test_thumbnail_requests_cancel_when_cards_leave_the_viewport(self):
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        ui = backstage_ui_source()
        self.assertIn("private var cullingThumbnailTasks:", model)
        self.assertIn("private var cullingThumbnailTaskTokens:", model)
        self.assertIn("func requestThumbnail(\n        for assetID:", model)
        self.assertIn("for attempt in 0..<3", model)
        self.assertIn("cullingThumbnailTasks[assetID]?.cancel()", model)
        self.assertIn("cullingThumbnailTaskTokens.removeValue(forKey: assetID)", model)
        self.assertIn("model.cullingAssetDidAppear(asset)", ui)
        self.assertIn("model.requestReviewThumbnail(for: item)", ui)

    def test_photokit_thumbnail_requests_are_bounded_and_cancellable(self):
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        photo_library = (
            NATIVE / "Sources" / "OwnerCore" / "PhotoLibraryService.swift"
        ).read_text(encoding="utf-8")
        for marker in (
            "requestImage(",
            "options.deliveryMode = isFastThumbnail ? .fastFormat : .highQualityFormat",
            "PHImageResultIsDegradedKey",
            "options.resizeMode = isFastThumbnail ? .fast : .exact",
            "PhotoKitPreviewResultGate",
            "thumbnailRequestTimeout",
            "withTaskCancellationHandler",
            "manager.cancelImageRequest",
            "func cullingPreview(localIdentifier: String, maxPixelSize: Int)",
            "preferredAcceptedStillResource(for asset: PHAsset)",
            "for format in [\"JPEG\", \"HEIC\"]",
            "preferredRenderedJPEGResource(for asset: PHAsset)",
            "resourceFormat($0) == \"JPEG\"",
            "PHAssetResourceManager.default()",
            "requestData(",
            "PhotoKitResourcePreviewResultGate",
            "manager.cancelDataRequest",
        ):
            self.assertIn(marker, photo_library)

        focused_preview = model.split("func loadPreview() async", 1)[1].split(
            "func requestThumbnail(", 1
        )[0]
        self.assertIn("renderedJPEGPreviewForAsset(", focused_preview)
        self.assertNotIn("previewForAsset(", focused_preview)
        culling_preview = photo_library.split(
            "public func cullingPreview(", 1
        )[1].split("public func renderedJPEGPreview(", 1)[0]
        self.assertIn("if maxPixelSize > 180,", culling_preview)
        self.assertNotIn("maxPixelSize <= Self.thumbnailRequestMaxPixelSize,\n            let renderedJPEG", culling_preview)

        self.assertIn("cullingPreviewForAsset(", model)
        self.assertIn("photoLibrary.cullingPreview(", model)
        full_preview = photo_library.split(
            "private func requestFullPreview(", 1
        )[1].split("private static func previewFromImage(", 1)[0]
        self.assertIn("manager.requestImage(", full_preview)
        self.assertIn("PHImageResultIsDegradedKey", full_preview)
        self.assertNotIn("requestImageDataAndOrientation(", full_preview)

        ipc_protocol = (
            NATIVE / "Sources" / "OwnerCore" / "BackstagePreviewIPCProtocol.swift"
        ).read_text(encoding="utf-8")
        self.assertIn("libraryIndexOperationTimeout: Duration = .seconds(300)", ipc_protocol)
        self.assertIn("let operationTimeout = limits.libraryIndexOperationTimeout", ipc_protocol)

    def test_current_image_size_uses_complete_source_data_and_a_distinct_cache(self):
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        photo_library = (
            NATIVE / "Sources" / "OwnerCore" / "PhotoLibraryService.swift"
        ).read_text(encoding="utf-8")
        size_store = (
            NATIVE
            / "Sources"
            / "OwnerCore"
            / "OwnerCurrentImageSizeSQLiteStore.swift"
        ).read_text(encoding="utf-8")
        adapters = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageAppKitAdapters.swift"
        ).read_text(encoding="utf-8")
        culling = (
            NATIVE / "Sources" / "BackstageApp" / "CullingView.swift"
        ).read_text(encoding="utf-8")

        resource_preview = photo_library.split(
            "private func requestAcceptedStillResourcePreview(", 1
        )[1].split("private func requestFullPreview(", 1)[0]
        self.assertIn("let sourceData = gate.dataSnapshot()", resource_preview)
        self.assertIn(
            "currentImageByteCount: Int64(sourceData.count)",
            resource_preview,
        )
        full_preview = photo_library.split(
            "private func requestFullPreview(", 1
        )[1].split("static func previewFromImageData(", 1)[0]
        self.assertIn("manager.requestImage(", full_preview)
        self.assertNotIn("currentImageByteCount:", full_preview)
        self.assertNotIn("requestImageDataAndOrientation(", photo_library)

        culling_preview = photo_library.split(
            "public func cullingPreview(", 1
        )[1].split("public func renderedJPEGPreview(", 1)[0]
        self.assertIn(
            "let acceptedSource = preferredAcceptedStillResource(for: asset)",
            culling_preview,
        )
        self.assertIn(
            "requestAcceptedStillResourcePreview(",
            culling_preview,
        )
        rendered_preview = photo_library.split(
            "public func renderedJPEGPreview(", 1
        )[1].split("private func requestThumbnailPreview(", 1)[0]
        self.assertIn(
            "let acceptedSource = preferredAcceptedStillResource(for: asset)",
            rendered_preview,
        )
        self.assertIn(
            "requestAcceptedStillResourcePreview(",
            rendered_preview,
        )

        self.assertIn("asset_current_image_sizes", size_store)
        self.assertIn("current_image_byte_count", size_store)
        self.assertNotIn("originalByteCount", size_store)
        self.assertIn("pendingCurrentImageByteCounts", model)
        self.assertIn("scheduleCurrentImageSizeFlush()", model)
        self.assertIn("persistPromptly: false", model)
        self.assertIn("persistPromptly: true", model)

        quick_look = model.split("func prepareQuickLookURLs() async", 1)[1].split(
            "private func applyCullingDecisions", 1
        )[0]
        self.assertLess(
            quick_look.index("await learnCurrentImageByteCount("),
            quick_look.rindex("return urls"),
        )
        self.assertIn("func currentImageByteCount(for assetID:", model)

        self.assertIn('"Current image size"', adapters)
        self.assertIn("if let currentImageSize", adapters)
        inspector = culling.split("private func cullingMetadataInspector(", 1)[1].split(
            "private func metadataRow(", 1
        )[0]
        self.assertIn('metadataRow("Current image size"', inspector)
        self.assertNotIn('metadataRow("Original size"', inspector)

    def test_photo_index_excludes_raw_only_assets_before_pagination(self):
        photo_library = (
            NATIVE / "Sources" / "OwnerCore" / "PhotoLibraryService.swift"
        ).read_text(encoding="utf-8")
        fetch_source = photo_library.split("public func fetch(", 1)[1].split(
            "public func libraryIndex(", 1
        )[0]
        index_source = photo_library.split("public func libraryIndex(", 1)[1].split(
            "public func preview(", 1
        )[0]
        row_source = photo_library.split("private func libraryIndexRow(", 1)[1].split(
            "private func resourceRows(", 1
        )[0]
        self.assertIn("guard let acceptedSource = preferredAcceptedStillResource(for: asset) else", fetch_source)
        self.assertIn("var acceptedAssets: [PHAsset] = []", index_source)
        self.assertIn("if preferredAcceptedStillResource(for: asset) != nil", index_source)
        self.assertIn("let pageStart = min(safeOffset, acceptedAssets.count)", index_source)
        self.assertNotIn("options.fetchLimit = safeOffset + safeLimit", index_source)
        self.assertIn("RAW-only Photos assets without a JPEG or HEIC resource are excluded", index_source)
        self.assertIn("Photos asset has no JPEG or HEIC resource; PBB/PBE source intake excludes it.", row_source)

    def test_quick_look_h_preserves_an_existing_multi_selection(self):
        culling = (
            NATIVE / "Sources" / "BackstageApp" / "CullingView.swift"
        ).read_text(encoding="utf-8")
        placement = culling.split("private static func applyPlacement(", 1)[1].split(
            "private static func refreshMetadata(", 1
        )[0]
        self.assertIn("model.cullingSelection.selectedIDs.contains(assetID)", placement)
        self.assertIn("model.clickCullingAsset(assetID, modifiers: [])", placement)
        self.assertIn("let succeeded = await model.applyPickShortcut(", placement)
        self.assertIn("guard succeeded else", placement)
        self.assertIn("advanceAfterSuccessfulDecision(", placement)
        self.assertIn("filter { $0 != assetID }", placement)

        presenter = culling.split("private enum CullingQuickLookPresenter", 1)[1].split(
            "struct CullingView", 1
        )[0]
        review = (
            NATIVE / "Sources" / "BackstageApp" / "ReviewView.swift"
        ).read_text(encoding="utf-8")
        review_presenter = review.split("private enum ReviewQuickLookPresenter", 1)[1].split(
            "private struct ReviewVisualComparisonTarget", 1
        )[0]
        for source, status in (
            (presenter, "Quick Look opens one selected Culling item at a time."),
            (review_presenter, "Quick Look opens one selected Review item at a time."),
        ):
            self.assertIn("guard ids.count == 1 else", source)
            self.assertIn(status, source)
            self.assertIn("direction: OwnerSelectionDirection = .next", source)
            self.assertIn("case .wasteBasket:", source)
        self.assertIn("shortcut.selectionDelta(", presenter)
        self.assertIn("rowStride: model.cullingGridDensity", presenter)
        self.assertIn("direction == .previous ? -1 : 1", review_presenter)

        app = (
            NATIVE / "Sources" / "BackstageApp" / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        lifecycle = app.split("struct LifecycleView", 1)[1].split(
            "private struct ActivityView", 1
        )[0]
        self.assertIn(
            "Quick Look opens one selected Waste Basket item at a time.",
            lifecycle,
        )
        self.assertIn("case .pick:", lifecycle)
        self.assertIn("case .wasteBasket:", lifecycle)
        self.assertIn("moveQuickLook(", lifecycle)
        self.assertIn("Put back is available only for a recoverable Waste Basket item.", lifecycle)
        self.assertIn("Shortcuts: ←/→/↑/↓ navigate", lifecycle)

        selection = (
            NATIVE
            / "Sources"
            / "OwnerCore"
            / "OwnerSelectionModel.swift"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "direction: OwnerSelectionDirection = .next",
            selection,
        )
        self.assertIn("case .previous:", selection)

    def test_lifecycle_actions_surface_async_phase_receipts(self):
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        owner_models = (
            NATIVE / "Sources" / "OwnerCore" / "OwnerModels.swift"
        ).read_text(encoding="utf-8")
        runner = (
            NATIVE / "Sources" / "OwnerCore" / "OwnerActionRunner.swift"
        ).read_text(encoding="utf-8")
        lifecycle = (
            NATIVE / "Sources" / "OwnerCore" / "LifecycleService.swift"
        ).read_text(encoding="utf-8")
        for marker in (
            "OwnerActionPhaseTiming",
            "OwnerConnectorTiming",
            "connectorTiming",
            "diagnosticPhaseName",
            "diagnosticPhaseElapsedMs",
            "failedAt",
        ):
            self.assertIn(marker, owner_models)
        self.assertIn("onUpdate: (@Sendable (OwnerAction) -> Void)? = nil", runner)
        self.assertIn("onUpdate?(action)", runner)
        self.assertIn("onUpdate: (@Sendable (OwnerAction) -> Void)? = nil", lifecycle)
        for marker in (
            "pendingLifecycleActionStatus(",
            "updateCullingWasteBasketAction(update)",
            "updateReviewWasteBasketAction(update)",
            "lifecyclePendingAction = update",
            "Culling remains available while it completes.",
            "Review remains available while it completes.",
            "Browsing and Quick Look remain available while it completes.",
        ):
            self.assertIn(marker, model)
        app = backstage_ui_source()
        for marker in (
            'TableColumn("Phase")',
            "action.diagnosticPhaseName",
            "action.diagnosticPhaseElapsedMs",
        ):
            self.assertIn(marker, app)
        self.assertGreaterEqual(
            model.count("awaitCompletion(of: action) { [weak self] update in"),
            4,
        )

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
            "BackstageQuickLookCoordinator()",
            "prepareNativeUploadQuickLookURL(for: item)",
            "quickLook.present(",
            "BackstageQuickLookMetadata(",
            "model.selectedDeliveryIDs.count == 1",
            "moveUploadQuickLook(from: assetID, direction: .previous)",
            "moveUploadQuickLook(from: assetID, direction: .next)",
            "←/→/↑/↓ navigate • H hide • R return to Review",
            "keywords: item.keywords",
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
        self.assertIn("func prepareNativeUploadQuickLookURL(", model)
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
        self.assertIn("let approvalProposalID = action == .approve", apply_action)
        self.assertIn("proposalID: approvalProposalID", apply_action)
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

    def test_review_undo_applies_a_normalized_receipt_before_reload_fallback(self):
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        service = (
            NATIVE
            / "Sources"
            / "OwnerCore"
            / "FixtureWorkflowService.swift"
        ).read_text(encoding="utf-8")
        pipeline = (ROOT / "scripts" / "fixture_pipeline.py").read_text(
            encoding="utf-8"
        )
        undo = model.split("func undoLastReviewAction()", 1)[1].split(
            "func saveReviewMetadata()", 1
        )[0]
        fast_path = undo.split("if retainedLocally", 1)[1].split("} else {", 1)[0]

        self.assertIn("reviewItems: [FixtureReviewItem]", model)
        self.assertIn("reviewItemIndexes: [String: Int]", model)
        self.assertIn("retainReviewUndoResultInCurrentWindow", undo)
        self.assertIn("entry.reviewItems", undo)
        self.assertIn("entry.reviewItemIndexes", undo)
        self.assertNotIn("fixtureService.reviewWindow", fast_path)
        self.assertIn("change.review", model)
        self.assertIn("public var review: [String: JSONValue]", service)
        self.assertIn("public var timing: [String: JSONValue]", service)
        self.assertIn("reviewLastTiming", model)
        self.assertIn("clickToRefreshDurationMs", model)
        self.assertIn('"review": _review_item_update_from_snapshot', pipeline)
        self.assertIn('"localTransaction": local_transaction_timing', pipeline)

    def test_quick_look_supports_culling_review_shortcuts_metadata_and_advancement(self):
        app = backstage_ui_source()
        adapter = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageAppKitAdapters.swift"
        ).read_text(encoding="utf-8")

        for shortcut in (
            "case 123: .previous",
            "case 124: .next",
            "case 126: .previousRow",
            "case 125: .nextRow",
            'case "p": .pick',
            'case "h": .hide',
            'case "x": .wasteBasket',
            'case "a": .approve',
            'return .undo',
            'case "0": .rating(0)',
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
        self.assertIn("await model.applyPickShortcut(", culling)
        self.assertIn("BackstageQuickLookDecisionRouter.handle(", culling)
        self.assertIn("await model.undoLastCullingDecision()", culling)
        self.assertIn("if model.selectedCullingAssetIDs.count == 1", culling)
        self.assertIn("shortcut.selectionDelta(", culling)
        self.assertIn("rowStride: model.cullingGridDensity", culling)
        self.assertIn("model.moveCullingSelection(by: delta", culling)
        self.assertIn("guard wasVisible && !remainsVisible else", culling)
        self.assertIn("present(model: model, coordinator: coordinator, direction: direction)", culling)

        review_presenter = app.split("private enum ReviewQuickLookPresenter", 1)[1].split(
            "struct ReviewView", 1
        )[0]
        self.assertIn("applyReviewAction(", review_presenter)
        self.assertIn(".approve", review_presenter)
        self.assertIn(".hide", review_presenter)
        self.assertIn("case .approve:", review_presenter)
        self.assertNotIn("case .approve, .pick:", review_presenter)
        self.assertIn("case .pick, .returnToReview", review_presenter)
        self.assertIn("A approve", review_presenter)
        self.assertNotIn("P/A approve", review_presenter)
        self.assertIn("case .undo:", review_presenter)
        self.assertIn("guard !model.reviewHistory.isEmpty else", review_presenter)
        self.assertIn("await model?.undoLastReviewAction()", review_presenter)
        self.assertIn("direction == .previous ? -1 : 1", review_presenter)
        self.assertIn("coordinator.dismiss()", review_presenter)

    def test_quick_look_owner_lifecycle_dismisses_stale_coordinator(self):
        adapter = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageAppKitAdapters.swift"
        ).read_text(encoding="utf-8")

        for filename in ("CullingView.swift", "ReviewView.swift"):
            source = (
                NATIVE / "Sources" / "BackstageApp" / filename
            ).read_text(encoding="utf-8")
            self.assertRegex(
                source,
                r"\.onAppear\s*\{\s*quickLook\.activate\(\)\s*\}",
            )
            self.assertRegex(
                source,
                r"\.onDisappear\s*\{\s*quickLook\.deactivate\(\)",
            )

        self.assertIn("private var isOwnerActive = true", adapter)
        self.assertIn("func activate()", adapter)
        deactivate = adapter.split("func deactivate()", 1)[1].split(
            "func present(", 1
        )[0]
        self.assertIn("isOwnerActive = false", deactivate)
        self.assertIn("dismiss()", deactivate)
        present = adapter.split("func present(", 1)[1].split(
            "func dismiss()", 1
        )[0]
        self.assertIn("guard isOwnerActive else { return }", present)

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
            "await applyFixturePlacement(",
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
        grid_end = culling.index("private var cullingActions")
        header = culling[:grid_start]
        grid = culling[grid_start:grid_end]
        actions = culling[grid_end:]

        self.assertIn("VStack(alignment: .leading, spacing: 6)", header)
        self.assertIn(".layoutPriority(3)", header)
        self.assertIn(
            ".frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)",
            grid,
        )
        self.assertIn(".clipped()", grid)
        self.assertIn(".id(cullingViewportIdentity)", grid)
        self.assertIn(".padding(.top, 12)", grid)
        self.assertIn(".frame(maxWidth: .infinity, alignment: .bottomLeading)", culling)
        self.assertIn(".layoutPriority(2)", culling)
        footer = culling.split("private var cullingDecisionActions", 1)[1].split(
            "private var cullingHistoryActions", 1
        )[0]
        self.assertIn('Button("P Pick")', footer)
        self.assertIn('Button("H Hide")', footer)
        self.assertIn('Button("X Waste Basket")', footer)
        self.assertNotIn('Button("Send to Metadata")', culling)
        self.assertNotIn('Button("Quick Look")', footer)
        self.assertNotIn('Button("Open in Review")', footer)
        self.assertNotIn('Button("Export originals…")', footer)
        self.assertNotIn('Button("Reload decisions")', footer)
        self.assertIn('Menu("Workflows")', culling)
        self.assertNotIn(".frame(maxWidth: .infinity, minHeight: 240, maxHeight: .infinity)", culling)
        self.assertNotIn("GeometryReader { paneGeometry in", culling)
        workspace = culling.split("private var cullingWorkspacePane", 1)[1].split(
            "private var cullingHeader", 1
        )[0]
        self.assertIn("cullingActions", workspace)
        self.assertIn("cullingHeader", workspace)
        self.assertIn("cullingGrid", workspace)
        self.assertIn("cullingFooter", workspace)
        self.assertLess(workspace.index("cullingHeader"), workspace.index("cullingGrid"))
        self.assertLess(workspace.index("cullingGrid"), workspace.index("cullingFooter"))
        self.assertNotIn(".clipped()", workspace)
        self.assertNotIn(".safeAreaInset(edge: .bottom, spacing: 0)", culling)
        self.assertIn(".frame(minWidth: 480)", culling)
        self.assertIn(
            ".frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)",
            culling,
        )
        self.assertIn("GeometryReader { viewport in", culling)
        self.assertNotIn("viewport.safeAreaInsets", culling)
        self.assertNotIn(".padding(.top, topInset)", culling)
        self.assertNotIn(".padding(.bottom, bottomInset)", culling)
        self.assertIn("width: viewport.size.width", culling)
        self.assertIn("height: viewport.size.height", culling)
        self.assertGreaterEqual(culling.count("height: viewport.size.height"), 3)
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
        self.assertNotIn("Text(\"Status\")", culling)
        self.assertIn('.accessibilityLabel("Status filter")', culling)
        self.assertNotIn("Text(\"Rating\")", culling)
        self.assertNotIn("Text(\"Color\")", culling)
        self.assertIn("CullingRatingSlider(", culling)
        self.assertIn("model.cullingMinimumRating", culling)
        self.assertIn("model.setCullingMinimumRating(rating)", culling)
        self.assertIn("LightroomColorFilterButton(", culling)
        self.assertGreaterEqual(
            culling.count("HStack(spacing: CullingCompactControlMetrics.groupSpacing)"),
            2,
        )
        self.assertIn('.accessibilityLabel("Color filter")', culling)
        self.assertIn('.accessibilityLabel("Color assignment")', culling)
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

    def test_assignment_controls_use_one_rating_slider_and_toggle_colors(self):
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
        culling = app.split("private var cullingDecisionActions", 1)[1].split(
            "private var cullingHistoryActions", 1
        )[0]
        actions = app.split("private var cullingActions", 1)[1].split(
            "private var cullingDestinationActions", 1
        )[0]
        self.assertEqual(culling.count("CullingRatingSlider("), 1)
        self.assertNotIn('ForEach(0...5, id: \\.self)', culling)
        self.assertNotIn("cullingRatingAssignmentButton", culling)
        self.assertIn("SidecarColor.allCases.filter { $0 != .none }", culling)
        self.assertIn("cullingColorAssignmentButton(color)", culling)
        self.assertNotIn('Picker("Rating"', culling)
        self.assertNotIn('Picker("Color"', culling)
        self.assertNotIn('Button("Apply rating")', culling)
        self.assertNotIn('Button("Apply color")', culling)
        self.assertIn("model.applyRatingShortcut(rating)", culling)
        self.assertIn("model.toggleCullingColor(color)", culling)
        self.assertIn("CullingCompactControlMetrics.ratingWidth", app)
        self.assertIn("CullingCompactControlMetrics.ratingHorizontalPadding", app)
        self.assertIn("Int(normalized * 6)", app)
        self.assertNotIn("selectedRating == rating ? 0 : selectedRating", app)
        self.assertIn("CullingCompactControlMetrics.colorWidth", app)
        self.assertIn("CullingCompactControlMetrics.swatchSize", app)
        self.assertIn("CullingCompactControlMetrics.swatchCornerRadius", app)
        self.assertIn("CullingCompactControlMetrics.groupSpacing", app)
        self.assertNotIn(
            "isSelected ? Color.accentColor : Color(nsColor: .separatorColor)",
            app,
        )
        self.assertIn("isSelected ? Color.primary.opacity(0.10)", app)
        self.assertIn("ForEach(1...5, id: \\.self)", app)
        self.assertIn("value <= displayedRating ? Color.yellow", app)
        self.assertIn("cullingSelectionRating", model)
        self.assertIn("func setCullingMinimumRating", model)
        self.assertIn("cullingSelectionHasColor", model)
        self.assertIn("func toggleCullingColor", model)
        self.assertIn("await toggleCullingColor(color)", model)
        self.assertIn('accessibilityAction(named: "Clear rating")', app)
        self.assertIn(".accessibilityAdjustableAction", app)
        self.assertIn('case .red: "6"', culling)
        self.assertIn('case .blue: "9"', culling)
        self.assertIn("case .purple, .none: nil", culling)
        self.assertIn("Rating slider 0–5", actions)
        self.assertIn("Color buttons and 6–9 toggle", actions)
        self.assertIn('case "0": .rating(0)', adapter)
        self.assertIn('case "5": .rating(5)', adapter)
        self.assertIn('case "6": .color(.red)', adapter)
        self.assertIn('case "9": .color(.blue)', adapter)
        self.assertIn("value.toggleTarget(", adapter)
        self.assertIn("coordinator.decisionColorValue(for: assetID)", adapter)
        self.assertIn("color: target", adapter)
        self.assertIn("6–9 toggle color", adapter)

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
        self.assertIn('return format == "JPEG" || format == "HEIC"', bridge)
        self.assertIn('asset.mediaType == .image && !imageFallbackResourceCandidates(asset).isEmpty', bridge)
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

    def test_culling_filter_responses_cannot_overwrite_newer_decisions(self):
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        self.assertIn("private func invalidateCullingWindowLoads()", model)
        filter_slice = model.split("func applyCullingFilters", 1)[1].split(
            "func scheduleCullingSearchRefresh", 1
        )[0]
        decision_slice = model.split("private func applyCullingDecisions", 1)[1].split(
            "private func mergedCullingState", 1
        )[0]
        placement_slice = model.split("private func applyFixturePlacement", 1)[1].split(
            "private func undoDecisions", 1
        )[0]
        for slice_ in (filter_slice, decision_slice, placement_slice):
            self.assertIn("invalidateCullingWindowLoads()", slice_)

    def test_backstage_release_requires_a_stable_signing_identity(self):
        build_script = (
            NATIVE / "scripts" / "build-app.zsh"
        ).read_text(encoding="utf-8")

        self.assertIn('identity="${PBE_CODESIGN_IDENTITY:-}"', build_script)
        self.assertIn("Developer ID Application:", build_script)
        self.assertIn("Apple Development:", build_script)
        self.assertIn('PBE_ALLOW_ADHOC_SIGNING:-0', build_script)
        self.assertIn('release_architectures=(arm64)', build_script)
        self.assertNotIn('release_architectures=(arm64 x86_64)', build_script)
        self.assertIn('--triple "$target_triple"', build_script)
        self.assertNotIn('/usr/bin/lipo -create', build_script)
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
        manifest_builder = (
            ROOT / "scripts" / "build_backstage_release_manifest.zsh"
        ).read_text(encoding="utf-8")
        release_publisher = (
            ROOT / "scripts" / "publish_backstage_release.zsh"
        ).read_text(encoding="utf-8")

        def value(name: str) -> str:
            match = re.search(rf'^{name}="([^"]+)"$', metadata, re.MULTILINE)
            self.assertIsNotNone(match, name)
            return match.group(1)

        self.assertEqual(value("PBE_BACKSTAGE_VERSION"), "239.2")
        self.assertEqual(value("PBE_BACKSTAGE_BUILD"), "221")
        self.assertEqual(
            value("PBE_BACKSTAGE_UPDATE_MANIFEST_URL"),
            "https://download.photos-by-elie.com/backstage/releases/latest.json",
        )
        self.assertEqual(
            value("PBE_BACKSTAGE_RELEASE_SOURCE_REF"),
            "refs/heads/release/backstage",
        )
        self.assertIn('source "$release_metadata"', build_script)
        self.assertIn("NSAppleEventsUsageDescription", build_script)
        self.assertIn("PBEBackstageUpdateManifestURL", build_script)
        self.assertIn("PBEBackstageReleaseSourceRef", build_script)
        self.assertIn("PBE_BACKSTAGE_UPDATE_MANIFEST_URL", build_script)
        self.assertIn("PBE_BACKSTAGE_RELEASE_SOURCE_REF", build_script)
        self.assertIn('chmod -R u+w "$stage_root"', manifest_builder)
        self.assertIn('"architectures": architectures.split()', manifest_builder)
        self.assertIn('"canonicalRef": source_ref', manifest_builder)
        self.assertIn('"commit": source_revision', manifest_builder)
        self.assertIn('verify_backstage_release_source.zsh', manifest_builder)
        self.assertIn(
            "Refusing to publish a non-arm64 Apple-silicon Backstage release",
            manifest_builder,
        )
        self.assertNotIn("--sequesterRsrc", release_publisher)
        self.assertIn("approved title, caption, and keyword metadata", build_script)
        self.assertIn('--entitlements "$entitlements"', build_script)
        self.assertIn("Backstage is missing the signed Photos Library entitlement", build_script)
        self.assertIn(
            "Refusing to publish Backstage without the signed Photos Library entitlement",
            manifest_builder,
        )
        entitlements = (NATIVE / "Backstage.entitlements").read_text(encoding="utf-8")
        self.assertIn("com.apple.security.automation.apple-events", entitlements)
        self.assertIn(
            "com.apple.security.personal-information.photos-library",
            entitlements,
        )
        self.assertNotIn("PBE_PHOTOS_BRIDGE_", metadata)
        self.assertNotIn("PBEPhotosBridge", build_script)
        self.assertNotIn("Backstage and Photos Bridge", build_script)
        self.assertIn("PhotosByElie Photos Bridge is retired (PBB-92).", bridge_installer)
        self.assertIn("exit 64", bridge_installer)
        self.assertNotIn("swiftc", bridge_installer)
        self.assertNotIn("codesign", bridge_installer)
        self.assertNotIn("open ", bridge_installer)
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
    def test_bridge_installer_fails_closed_without_touching_a_legacy_bundle(self):
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

            self.assertEqual(result.returncode, 64, result.stderr)
            self.assertIn("PhotosByElie Photos Bridge is retired", result.stderr)
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
        self.assertIn("RetiredPhotosBridgeService", control)
        self.assertNotIn("NSWorkspace", control)
        self.assertNotIn("Process()", control)
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

    def test_culling_refresh_resumes_discovery_and_keeps_full_audit_explicit(self):
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

        self.assertIn("await model.refreshPhotosAndRecentIndex()", culling)
        self.assertIn("await model.discoverRecentPhotosAtStartupIfNeeded()", culling)
        self.assertIn("struct BackstageFeedbackView: View", feedback)
        self.assertIn('.accessibilityLabel(isWorking ? "Working. ', feedback)
        self.assertIn("BackstageFeedbackView(", culling)
        self.assertIn(
            "isWorking: model.isLoadingPhotos || model.isReconcilingPhotosIndex",
            culling,
        )
        self.assertIn('photoStatus = "Refreshing Photos previews…"', model_source)
        self.assertIn("guard !isLoadingPhotos else { return }", model_source)
        self.assertIn('Text("Discovering recent Photos…")', culling)
        self.assertIn('Text("Refresh & discover")', culling)
        self.assertIn('Text("Full library audit")', culling)
        self.assertIn("await model.reconcilePhotosLibraryIndex()", culling)
        self.assertIn("func reconcileRecentPhotosIndex()", model_source)
        self.assertIn(
            "func discoverRecentPhotosAtStartupIfNeeded()",
            model_source,
        )
        self.assertIn(
            "guard !didStartAutomaticRecentPhotosDiscovery else { return }",
            model_source,
        )
        self.assertIn(
            "await loadFixtureCullingWindow(preservingVisibleWindow: true)",
            model_source,
        )
        self.assertIn("reconcilePhotosIndex(fullLibrary: true)", model_source)
        self.assertNotIn("value: -45", model_source)
        self.assertNotIn("hasReconciledRecentPhotosIndex", model_source)
        refresh_call = culling.index("await model.refreshPhotosAndRecentIndex()")
        self.assertIn(
            "await model.loadFixtureCullingWindow()",
            culling[refresh_call:refresh_call + 500],
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

    def test_waste_basket_supports_bounded_previews_sorting_and_scoped_delete(self):
        app = (
            NATIVE / "Sources" / "BackstageApp" / "PhotosByElieBackstageApp.swift"
        ).read_text(encoding="utf-8")
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        lifecycle = (
            NATIVE / "Sources" / "OwnerCore" / "LifecycleService.swift"
        ).read_text(encoding="utf-8")
        preview = (
            NATIVE / "Sources" / "BackstageApp" / "LifecyclePreview.swift"
        ).read_text(encoding="utf-8")

        for marker in (
            "private var sortedLifecycleItems: [LifecycleItem]",
            "sortOrder: lifecycleSortBinding",
            "@StateObject private var lifecycleScrollPosition = LifecycleTableScrollPosition()",
            "lifecycleScrollPosition.captureBeforeSort()",
            "LifecycleTableScrollProbe(",
            'Button("Delete Selected", role: .destructive)',
            "model.selectedRecoverableLifecycleIDs.isEmpty",
            "Text(model.lifecycleCountSummary)",
            "model.lifecycleThumbnailFailures[item.mediaID]",
            "ProgressView()",
            "model.retryLifecycleThumbnail(",
            'Button("Quick Look")',
            "model.prepareLifecycleQuickLookURL(for: item)",
            ".onKeyPress(.space)",
            "preferredIdentifier: item.photoLibraryIdentifier",
            "model.lifecycleThumbnails[item.mediaID]",
            "model.requestLifecycleThumbnail(",
            'TableColumn("Filename", value: \\.filename)',
            'TableColumn("Title", value: \\.title)',
            'TableColumn("State", value: \\.state)',
            'TableColumn("Deleted", value: \\.updatedAt) { item in',
            'Text(deletedAt, style: .relative)',
            "BackstageUndoCommands(model: model)",
            "CommandGroup(replacing: .undoRedo)",
            "Task { await model.undoCurrentSection() }",
        ):
            self.assertIn(marker, app)
        self.assertNotIn('TableColumn("Updated", value: \\.updatedAt)', app)
        for marker in (
            "@Published var lifecycleCountSummary",
            "@Published private(set) var lifecycleQueueing",
            "@Published private(set) var lifecyclePendingActionID",
            "@Published private(set) var lifecycleRestoreQueueing",
            "@Published private(set) var lifecycleRestorePendingActionID",
            "@Published private(set) var cullingWasteBasketQueueing",
            "@Published private(set) var cullingWasteBasketPendingActionID",
            "@Published private(set) var cullingWasteBasketPendingActionIDs: Set<String> = []",
            "@Published private(set) var cullingWasteBasketDeferredUndoActionIDs: Set<String> = []",
            "@Published private(set) var reviewWasteBasketQueueing",
            "@Published private(set) var reviewWasteBasketPendingActionID",
            "lifecycleMonitorTask: Task<Void, Never>?",
            "cullingWasteBasketPendingActions: [String: OwnerAction] = [:]",
            "reviewWasteBasketPendingActions: [String: OwnerAction] = [:]",
            "reviewWasteBasketPendingActionIDs: Set<String> = []",
            "reviewUndoIsBlockedByPendingWasteBasketAction",
            "var selectedRecoverableLifecycleIDs: [String]",
            "func emptyWasteBasketSelection() async",
            "enqueueEmptyWasteBasket(",
            "enqueueMoveToWasteBasket(",
            "enqueueRestore(mediaIDs: ids)",
            "lifecycleService.awaitCompletion(of: action)",
            "The selected row",
            "restored locally",
            "Submitting Delete Selected for",
            "Queued X for",
            "The local Culling grid is updated",
            "restoreWasteBasketCullingEntryInCurrentWindow",
            "finishDeferredCullingWasteBasketUndo",
            "Delete Selected queued as action",
            "func prepareLifecycleQuickLookURL(for item: LifecycleItem) async -> URL?",
            "private func exportOriginalForAsset(",
            "thumbnailPreferredIdentifiers",
            "mediaIDs: ids",
        ):
            self.assertIn(marker, model)
        self.assertIn("renderedJPEGPreviewForAsset(", model)
        self.assertNotIn("thumbnailFallbackPaths", model)
        self.assertNotIn("lifecyclePreviewURL(", model)
        self.assertIn("from Apple Photos.", model)
        self.assertNotIn("retained JPG", model)
        self.assertNotIn("fallbackPath:", app)
        self.assertNotIn("previewPath", lifecycle)
        self.assertNotIn("quickLookPath", lifecycle)
        for marker in (
            "mediaIDs: [String] = []",
            "mediaIDs: mediaIDs",
            'operation: \"waste-basket-empty\"',
            "public func awaitCompletion(",
        ):
            self.assertIn(marker, lifecycle)
        self.assertIn("photoLibraryIdentifier", lifecycle)
        for marker in (
            '#Preview("Waste Basket — Mixed, large count, and failed preview")',
            '#Preview("Waste Basket — Empty")',
            '#Preview("Waste Basket — Loading")',
            "isPreviewMode: true",
            "3,546 recoverable • 6,110 active global tombstones",
            ".previewUnavailable",
        ):
            self.assertIn(marker, preview)
        self.assertIn("guard !isPreviewMode else { return }", app)

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

        self.assertIn("BackstageFeedbackView(", app)
        self.assertIn("message: model.metadataReviewStatus", app)
        self.assertNotIn("Text(model.metadataReviewStatus)", app)

        for flag in (
            "model.isRunningFixture",
            "model.isSearchingFixtureAssets",
            "model.isRunningFixtureSnapshotOperation",
            "model.isLoadingFixturePolicy",
        ):
            self.assertIn(flag, app)

    def test_shared_feedback_surface_is_adopted_by_active_workflow_surfaces(self):
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
            "model.cullingWasteBasketPendingActionID",
            "model.isLoadingPreview",
        ):
            self.assertIn(flag, culling)
        self.assertIn("private var cullingStatusFeedback", culling)
        self.assertIn(
            "BackstageFeedbackView(message: model.cullingStatus, isWorking: true)",
            culling,
        )
        self.assertIn("Text(model.cullingStatus)", culling)

        self.assertGreaterEqual(review.count("message: model.reviewStatus"), 2)
        self.assertGreaterEqual(review.count("BackstageFeedbackView("), 2)
        self.assertIn("isWorking: model.isRunningReview", review)
        self.assertIn("model.reviewWasteBasketPendingActionID", review)
        self.assertIn("model.isRunningAIPass", review)
        self.assertNotIn("Text(model.reviewStatus)", review)

        self.assertIn("BackstageFeedbackView(", upload)
        self.assertIn("message: model.uploadRecoveryStatus", upload)
        self.assertIn("isWorking: model.isRunningDelivery", upload)
        self.assertNotIn("Text(model.uploadRecoveryStatus)", upload)

        self.assertNotIn("BackstageFeedbackView(", picker)
        self.assertNotIn("model.pbeOwnerSessionStatus", picker)
        self.assertNotIn("model.isLaunchingPBEOwner", picker)

    def test_current_fixture_selector_is_left_aligned_in_sidebar(self):
        picker = (
            NATIVE / "Sources" / "BackstageApp" / "FixturePicker.swift"
        ).read_text(encoding="utf-8")
        selector = picker.split("FixtureHierarchyMenu(", 1)[1].split(
            "if let explanation", 1
        )[0]

        self.assertIn(
            ".frame(maxWidth: .infinity, alignment: .leading)",
            selector,
        )
        self.assertNotIn(".frame(maxWidth: .infinity)\n", selector)

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
        self.assertIn("width: CGFloat(model.cullingGridColumnWidth)", culling)
        self.assertIn(".clipped()", culling)
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
        self.assertIn("var cullingGridColumnWidth: Double", model)

    def test_culling_actions_use_stable_selection_and_audited_receipts(self):
        model = (
            NATIVE / "Sources" / "BackstageApp" / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        selection = (
            NATIVE / "Sources" / "OwnerCore" / "OwnerSelectionModel.swift"
        ).read_text(encoding="utf-8")
        lifecycle = (
            NATIVE / "Sources" / "OwnerCore" / "LifecycleService.swift"
        ).read_text(encoding="utf-8")

        self.assertIn("cullingSelection.selectedInDisplayOrder", model)
        self.assertIn("public var selectedInDisplayOrder", selection)
        self.assertIn("LifecycleActionReceipt.summarize(", model)
        self.assertIn("Affected \\(affected.formatted())", lifecycle)
        self.assertIn("skipped \\(skipped.formatted())", lifecycle)
        self.assertIn("failed \\(failed.formatted())", lifecycle)
        self.assertIn("return await applyFixturePlacement(", model)
        self.assertNotIn(
            "guard await preparePhotosMutation() else",
            model.split("private func applyFixturePlacement(", 1)[1].split(
                "private func undoDecisions", 1
            )[0],
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
        self.assertIn("Collapse the Gallery or Review preview inspector", root)
        self.assertIn("Expand the Gallery or Review preview inspector", root)
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
            ("CullingView.swift", "struct CullingView: View", '#Preview("Gallery — Wide")'),
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
        self.assertIn('#Preview("Gallery — Controls")', culling)
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
        self.assertNotIn('Button("Propagate")', actions)
        self.assertNotIn("Propagate for the two-hour shoot", inspector)
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

    def test_owner_connector_is_action_scoped_and_native_review_has_no_ipc(self):
        runner = (
            NATIVE / "Sources" / "OwnerCore" / "OwnerActionRunner.swift"
        ).read_text(encoding="utf-8")
        review = (
            NATIVE / "Sources" / "OwnerCore" / "LocalFixtureReviewService.swift"
        ).read_text(encoding="utf-8")
        identity = (
            NATIVE / "Sources" / "OwnerCore" / "OwnerConnectorIdentity.swift"
        ).read_text(encoding="utf-8")
        connector = (ROOT / "scripts" / "new_owner_connector.py").read_text(
            encoding="utf-8"
        )

        self.assertIn("public struct OnDemandOwnerActionWaker", runner)
        self.assertIn("--once", runner)
        self.assertIn("--action-id", runner)
        self.assertIn(
            "waker: any OwnerActionWaking = OnDemandOwnerActionWaker()",
            runner,
        )
        self.assertNotIn("LocalOwnerActionWaker", runner)
        self.assertNotIn("wake-owner-action", runner)
        self.assertNotIn("localhost:8766", runner)
        self.assertNotIn("127.0.0.1:8766", runner)
        self.assertIn("OwnerReviewSQLiteStore", review)
        self.assertIn("nativeStore().applyReview", review)
        self.assertIn('"native_review_database_missing"', review)
        self.assertNotIn("requestViaOnDemandProcess", review)
        self.assertNotIn("new_owner_connector.py", review)
        self.assertNotIn("Process()", review)
        self.assertIn('public init(target: String = "max")', identity)
        self.assertNotIn("connector-status", identity)
        self.assertNotIn("URLSession", identity)
        self.assertNotIn("connector.json", identity)
        self.assertIn('"--action-id"', connector)
        self.assertIn("if args.action_id:", connector)
        self.assertIn("LEGACY_CONNECTOR_DAEMON_ENABLED", connector)
        self.assertIn("PBE_ENABLE_LEGACY_CONNECTOR_DAEMON=1", connector)

    def test_review_proposals_arrive_incrementally_without_batch_load(self):
        app = backstage_ui_source()
        review = app.split("struct ReviewView", 1)[1].split(
            "private struct ReviewAssetRow", 1
        )[0]
        model = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageViewModel.swift"
        ).read_text(encoding="utf-8")
        loader = model.split("func loadFixtureReviewWindow", 1)[1].split(
            "func clickReviewItem", 1
        )[0]
        hydration = model.split(
            "private func hydrateReviewProposalDrafts(",
            1,
        )[1].split("private func clearReviewDraft()", 1)[0]
        preservation = model.split(
            "private func preserveCurrentReviewDraft()", 1
        )[1].split("private func scheduleReviewMetadataAutosave", 1)[0]

        self.assertNotIn('Button("Load proposals")', review)
        self.assertIn("await model.refreshReviewAIAvailability()", review)
        self.assertIn("func refreshReviewAIAvailability()", model)
        self.assertIn("reviewAIAvailabilityToken", model)
        self.assertIn("reviewAIWindowRefreshPending", model)
        self.assertIn("preservedSelectedIDs", loader)
        self.assertIn("preservedFocusedID", loader)
        self.assertIn("hasManualEdits", hydration)
        self.assertIn("conflicts.insert(item.id)", hydration)
        self.assertIn("existing.hasManualEdits", preservation)
        self.assertNotIn("markAIProposalsLoaded", hydration)
        self.assertIn('Button("Replace ', review)

    def test_metadata_reads_only_saved_model_ladder_from_owner_sqlite(self):
        service = (ROOT / "native/PhotosByElieBackstage/Sources/OwnerCore/MetadataReviewService.swift").read_text()
        store = (ROOT / "native/PhotosByElieBackstage/Sources/OwnerCore/MetadataProposalSQLiteStore.swift").read_text()
        metadata = (ROOT / "native/PhotosByElieBackstage/Sources/BackstageApp/PhotosByElieBackstageApp.swift").read_text()
        model = (ROOT / "native/PhotosByElieBackstage/Sources/BackstageApp/BackstageViewModel.swift").read_text()
        review = (ROOT / "native/PhotosByElieBackstage/Sources/BackstageApp/ReviewView.swift").read_text()

        self.assertNotIn("localhost:8766", service)
        self.assertNotIn("127.0.0.1:8766", service)
        self.assertIn("MetadataModelLadderSQLiteStore", service)
        self.assertIn("SQLITE_OPEN_READONLY", store)
        self.assertIn("title_keyword_model_ladder_json", store)
        self.assertNotIn("title_keyword_queue", store)
        self.assertNotIn("title_keyword_proposals", store)
        for retired in (
            'Section("AI proposal review")',
            'Button("Queue selected for review")',
            'Button("Load ladder & proposals")',
            'Button("Reject")',
            'Button("Block"',
        ):
            self.assertNotIn(retired, metadata)
        for retired in (
            "metadataProposals",
            "metadataProposalStatus",
            "queueMetadataReview",
            "loadMetadataProposals",
            "decideProposal",
        ):
            self.assertNotIn(retired, model)
        self.assertIn('Button("Approve")', review)
        self.assertIn('Button("Needs AI")', review)
        self.assertNotIn('Button("Reject")', review)
        self.assertNotIn('Button("Block"', review)

    def test_backstage_reconciles_ghost_workflows_natively_at_bootstrap(self):
        store = (ROOT / "native/PhotosByElieBackstage/Sources/OwnerCore/OwnerWorkflowRecoverySQLiteStore.swift").read_text()
        model = (ROOT / "native/PhotosByElieBackstage/Sources/BackstageApp/BackstageViewModel.swift").read_text()

        self.assertIn("SQLITE_OPEN_READWRITE", store)
        self.assertIn("recovery_state = 'needs-review'", store)
        self.assertIn("status = 'failed'", store)
        self.assertIn("status = 'interrupted'", store)
        self.assertIn("await reconcileInterruptedOwnerWorkflows()", model)
        self.assertNotIn("new_owner_connector.py", store)

    def test_every_backstage_button_has_half_second_hover_help(self):
        source_dir = NATIVE / "Sources" / "BackstageApp"
        total_buttons = 0
        for path in sorted(source_dir.glob("*.swift")):
            source = path.read_text(encoding="utf-8")
            button_count = len(re.findall(r"\bButton\s*(?:\(|\{)", source))
            if button_count == 0:
                continue
            help_count = source.count(".backstageHelp(")
            adjustable_control_count = source.count(".accessibilityAdjustableAction")
            self.assertGreaterEqual(
                help_count,
                button_count + adjustable_control_count,
                f"{path.name} must provide at least one backstageHelp explanation per Button or adjustable control",
            )
            total_buttons += button_count

        culling = (source_dir / "CullingView.swift").read_text(encoding="utf-8")
        fit_button = culling.split(
            'Button(model.cullingUsesFill ? "Fill" : "Fit")', 1
        )[1].split("private var cullingGrid", 1)[0]
        self.assertIn("model.toggleCullingFitFill()", fit_button)
        self.assertIn(".backstageHelp(", fit_button)

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
        self.assertIn("hideCurrentUploadQuickLook(", upload)
        self.assertIn("await model.hideSelectedUploads()", upload)
        self.assertIn("presentUploadQuickLook(next, direction: removalDirection)", upload)
        self.assertIn("removalDirection: OwnerSelectionDirection", upload)
        self.assertIn("directionalUploadReplacement(", upload)
        self.assertIn("direction: removalDirection", upload)
        self.assertIn("H hide", upload)

    def test_upload_preview_returns_current_item_to_review_and_advances(self):
        ui = backstage_ui_source()
        upload = ui.split("struct UploadView", 1)[1].split(
            "private struct DeliverablesView",
            1,
        )[0]
        self.assertIn('.onKeyPress("r")', upload)
        self.assertIn("returnCurrentUploadQuickLookToReview(", upload)
        self.assertIn("await model.returnSelectedUploadsToReview()", upload)
        self.assertIn("presentUploadQuickLook(next, direction: removalDirection)", upload)
        self.assertIn("removalDirection: OwnerSelectionDirection", upload)
        self.assertIn("directionalUploadReplacement(", upload)
        self.assertIn("R return to Review", upload)

    def test_metadata_uses_canonical_thumbnail_and_quick_look(self):
        ui = backstage_ui_source()
        metadata = ui.split("private struct MetadataGiveBackView", 1)[1]
        for marker in (
            "model.cullingThumbnails[assetID]",
            "preferredIdentifier: source?.photoLibraryIdentifier",
            "model.requestThumbnail(",
            "prepareMetadataQuickLookURL(",
            "BackstageQuickLookMetadata(",
            "BackstageQuickLookSourceSize(",
            "quickLook.present(",
            "canonical Quick Look presentation. Rating and color shortcuts remain audited.",
        ):
            self.assertIn(marker, metadata)
        self.assertNotIn('TableColumn("Preview")', metadata)

    def test_all_photo_quick_look_surfaces_share_rating_and_color_routing(self):
        appkit = (
            NATIVE
            / "Sources"
            / "BackstageApp"
            / "BackstageAppKitAdapters.swift"
        ).read_text(encoding="utf-8")
        culling = (
            NATIVE / "Sources" / "BackstageApp" / "CullingView.swift"
        ).read_text(encoding="utf-8")
        review = (
            NATIVE / "Sources" / "BackstageApp" / "ReviewView.swift"
        ).read_text(encoding="utf-8")
        upload = (
            NATIVE / "Sources" / "BackstageApp" / "UploadView.swift"
        ).read_text(encoding="utf-8")
        app = backstage_ui_source()
        lifecycle = app.split("struct LifecycleView", 1)[1].split(
            "private struct ActivityView", 1
        )[0]
        metadata = app.split("private struct MetadataGiveBackView", 1)[1]

        self.assertIn("enum BackstageQuickLookDecisionRouter", appkit)
        self.assertIn("applyQuickLookRating", appkit)
        self.assertIn("applyQuickLookColor", appkit)
        for surface in (culling, review, upload, lifecycle, metadata):
            self.assertIn("BackstageQuickLookDecisionRouter.handle(", surface)
            self.assertIn("BackstageQuickLookDecisionRouter.shortcutHint", surface)

    def test_getting_started_describes_the_native_large_pool_path(self):
        guide = (ROOT / "docs" / "BACKSTAGE_GETTING_STARTED.md").read_text(
            encoding="utf-8"
        )
        guide = re.sub(r"\s+", " ", guide)
        for marker in (
            "at most 200 matching rows",
            "Review picked",
            "Select burst",
            "Metadata",
            "Review",
            "Uploads",
            "Gallery no longer duplicates those navigation actions",
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
            "Backstage Gallery and Review source candidates are still photos only",
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
