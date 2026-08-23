import AppKit
import OwnerCore
import SwiftUI

/// The production Culling workspace and its Canvas-selectable implementation.
///
/// Synthetic fixtures live in `CullingPreview.swift`; automatic work stays disabled in Canvas.
@MainActor
private enum CullingQuickLookPresenter {
    static func present(
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator,
        direction: OwnerSelectionDirection = .next
    ) {
        let ids = model.selectedCullingAssetIDs
        guard !ids.isEmpty else {
            model.cullingStatus = "Select one Culling item before opening Quick Look."
            return
        }
        guard ids.count == 1 else {
            model.cullingStatus = "Quick Look opens one selected Culling item at a time."
            return
        }
        Task { [weak model, weak coordinator] in
            guard let model, let coordinator else { return }
            let urls = await model.prepareQuickLookURLs()
            let prepared = zip(ids, urls).compactMap { assetID, url in
                metadata(for: assetID, model: model).map { (url, $0) }
            }
            guard !prepared.isEmpty else { return }
            coordinator.present(
                urls: prepared.map(\.0),
                metadata: prepared.map(\.1),
                onShortcut: { [weak model, weak coordinator] shortcut, assetID in
                    guard let model, let coordinator,
                          !model.isApplyingCullingDecision
                    else { return false }
                    switch shortcut {
                    case .previous:
                        navigate(
                            direction: .previous,
                            from: assetID,
                            model: model,
                            coordinator: coordinator
                        )
                    case .next:
                        navigate(
                            direction: .next,
                            from: assetID,
                            model: model,
                            coordinator: coordinator
                        )
                    case .pick:
                        applyPlacement(
                            .pick,
                            assetID: assetID,
                            model: model,
                            coordinator: coordinator,
                            removalDirection: direction
                        )
                    case .hide:
                        applyPlacement(
                            .reject,
                            assetID: assetID,
                            model: model,
                            coordinator: coordinator,
                            removalDirection: direction
                        )
                    case .wasteBasket:
                        applyWasteBasket(
                            assetID: assetID,
                            model: model,
                            coordinator: coordinator,
                            removalDirection: direction
                        )
                    case let .rating(value):
                        let previousIDs = model.visibleCullingAssets.map(\.id)
                        let wasVisible = previousIDs.contains(assetID)
                        model.clickCullingAsset(assetID, modifiers: [])
                        Task { [weak model, weak coordinator] in
                            guard let model, let coordinator else { return }
                            await model.applyRatingShortcut(value)
                            advanceOrRefresh(
                                assetID: assetID,
                                previousIDs: previousIDs,
                                wasVisible: wasVisible,
                                model: model,
                                coordinator: coordinator,
                                direction: direction
                            )
                        }
                    case let .color(value):
                        let previousIDs = model.visibleCullingAssets.map(\.id)
                        let wasVisible = previousIDs.contains(assetID)
                        model.clickCullingAsset(assetID, modifiers: [])
                        Task { [weak model, weak coordinator] in
                            guard let model, let coordinator else { return }
                            await model.applyColorShortcut(value)
                            advanceOrRefresh(
                                assetID: assetID,
                                previousIDs: previousIDs,
                                wasVisible: wasVisible,
                                model: model,
                                coordinator: coordinator,
                                direction: direction
                            )
                        }
                    case .approve, .returnToReview, .unpick:
                        return false
                    }
                    return true
                }
            )
        }
    }

    private static func navigate(
        direction: OwnerSelectionDirection,
        from assetID: String,
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator
    ) {
        model.clickCullingAsset(assetID, modifiers: [])
        model.moveCullingSelection(
            by: direction == .previous ? -1 : 1,
            extending: false
        )
        guard model.focusedCullingAssetID != assetID, coordinator.isVisible else { return }
        present(model: model, coordinator: coordinator, direction: direction)
    }

    private static func applyPlacement(
        _ action: SidecarPickAction,
        assetID: String,
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator,
        removalDirection: OwnerSelectionDirection
    ) {
        let previousIDs = model.visibleCullingAssets.map(\.id)
        // Quick Look can be opened from a command-click multi-selection. Do
        // not collapse that selection merely because the focused Quick Look
        // item is the target of H/P; the action must apply to the complete
        // explicit selection. Select the item only when it was not already
        // part of the selection.
        if !model.cullingSelection.selectedIDs.contains(assetID) {
            model.clickCullingAsset(assetID, modifiers: [])
        }
        Task { [weak model, weak coordinator] in
            guard let model, let coordinator else { return }
            let succeeded = await model.applyPickShortcut(
                action,
                removalDirection: removalDirection
            )
            guard coordinator.isVisible else { return }
            guard succeeded else {
                refreshMetadata(assetID, model: model, coordinator: coordinator)
                return
            }
            advanceAfterSuccessfulDecision(
                assetID: assetID,
                previousIDs: previousIDs,
                model: model,
                coordinator: coordinator,
                direction: removalDirection
            )
        }
    }

    private static func advanceAfterSuccessfulDecision(
        assetID: String,
        previousIDs: [String],
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator,
        direction: OwnerSelectionDirection
    ) {
        var selection = OwnerSelectionModel(
            orderedIDs: previousIDs,
            selectedIDs: [assetID],
            anchorID: assetID,
            focusedID: assetID
        )
        // H/P are completed editorial decisions, so Quick Look advances even
        // when the current filters continue to show the acted-on item.
        let remainingIDs = model.visibleCullingAssets.map(\.id).filter { $0 != assetID }
        let replacement = selection.replaceItems(
            remainingIDs,
            selectingSuccessorAfterRemoving: assetID,
            direction: direction
        )
        model.cullingSelection = selection
        model.selectedPhotoIDs = selection.selectedIDs
        if replacement != nil {
            present(model: model, coordinator: coordinator, direction: direction)
        } else {
            coordinator.dismiss()
        }
    }

    private static func applyWasteBasket(
        assetID: String,
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator,
        removalDirection: OwnerSelectionDirection
    ) {
        if !model.cullingSelection.selectedIDs.contains(assetID) {
            model.clickCullingAsset(assetID, modifiers: [])
        }
        Task { [weak model, weak coordinator] in
            guard let model, let coordinator else { return }
            await model.moveCullingSelectionToWasteBasket(
                removalDirection: removalDirection
            ) { succeeded, replacementID in
                guard coordinator.isVisible else { return }
                guard succeeded else { return }
                if replacementID != nil {
                    present(
                        model: model,
                        coordinator: coordinator,
                        direction: removalDirection
                    )
                } else {
                    coordinator.dismiss()
                }
            }
        }
    }

    private static func advanceOrRefresh(
        assetID: String,
        previousIDs: [String],
        wasVisible: Bool,
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator,
        direction: OwnerSelectionDirection
    ) {
        guard coordinator.isVisible else { return }
        let remainsVisible = model.visibleCullingAssets.contains { $0.id == assetID }
        guard wasVisible && !remainsVisible else {
            refreshMetadata(assetID, model: model, coordinator: coordinator)
            return
        }
        var selection = OwnerSelectionModel(
            orderedIDs: previousIDs,
            selectedIDs: [assetID],
            anchorID: assetID,
            focusedID: assetID
        )
        let replacement = selection.replaceItems(
            model.visibleCullingAssets.map(\.id),
            selectingSuccessorAfterRemoving: assetID,
            direction: direction
        )
        model.cullingSelection = selection
        model.selectedPhotoIDs = selection.selectedIDs
        if replacement != nil {
            present(model: model, coordinator: coordinator, direction: direction)
        } else {
            coordinator.dismiss()
        }
    }

    private static func refreshMetadata(
        _ assetID: String,
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator
    ) {
        if let item = metadata(for: assetID, model: model) {
            coordinator.updateMetadata(item)
        }
    }

    private static func metadata(
        for assetID: String,
        model: BackstageViewModel
    ) -> BackstageQuickLookMetadata? {
        guard let asset = model.cullingAssets.first(where: { $0.id == assetID }) else {
            return nil
        }
        let decision = model.cullingStates[assetID]
        return BackstageQuickLookMetadata(
            assetID: assetID,
            filename: asset.filename,
            title: asset.title,
            keywords: asset.keywords,
            locationLabel: asset.locationLabel,
            capturedAt: asset.capturedAt,
            sourceSize: BackstageQuickLookSourceSize(
                mediaType: asset.mediaType,
                pixelWidth: asset.pixelWidth,
                pixelHeight: asset.pixelHeight,
                byteCount: asset.originalByteCount,
                currentImageByteCount: model.currentImageByteCount(for: assetID)
            ),
            rating: decision?.rating ?? asset.rating,
            color: decision?.color ?? asset.color,
            state: decision?.pickState ?? asset.placementState.rawValue,
            shortcutHint: "Shortcuts: ←/→/↑/↓ navigate • H exclude • P include • X Waste Basket • 0–5 rating • 6–9 color"
        )
    }
}

@MainActor
struct CullingView: View {
    @ObservedObject var model: BackstageViewModel
    var isPreviewMode = false
    @StateObject private var quickLook = BackstageQuickLookCoordinator()

    var body: some View {
        GeometryReader { viewport in
            HSplitView {
                cullingWorkspacePane
                    .frame(height: viewport.size.height, alignment: .topLeading)
                cullingPreviewPane
                    .frame(height: viewport.size.height, alignment: .topLeading)
            }
            .background(SplitViewAutosaver(name: "PhotosByElieBackstage.CullingSplit"))
            .frame(
                width: viewport.size.width,
                height: viewport.size.height,
                alignment: .top
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.snappy(duration: 0.24), value: model.isPreviewPanelVisible)
        .onAppear {
            quickLook.activate()
        }
        .onDisappear {
            quickLook.deactivate()
        }
        .task {
            guard !isPreviewMode else { return }
            if model.fixtures.isEmpty {
                await model.loadFixtures()
            }
            if model.libraryItems.isEmpty {
                await model.refreshPhotos()
            }
            if !model.selectedFixtureID.isEmpty {
                await model.loadFixtureCullingWindow()
            } else {
                await model.refreshCullingDecisions()
            }
            await model.discoverRecentPhotosAtStartupIfNeeded()
        }
    }

    private var cullingWorkspacePane: some View {
        VStack(alignment: .leading, spacing: 6) {
            cullingHeader
            cullingGrid
            cullingFooter
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .frame(minWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var cullingFooter: some View {
        VStack(alignment: .leading, spacing: 4) {
            Divider()
            cullingActions
        }
        .padding(.top, 4)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .bottomLeading)
        .layoutPriority(2)
    }

    private var cullingHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            cullingTitleBar
            BackstageFeedbackView(
                message: model.photoStatus,
                isWorking: model.isLoadingPhotos || model.isReconcilingPhotosIndex
            )
            CullingSearchControls(model: model)
            cullingFilterControls
            cullingSummary
            cullingWindowControls
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .layoutPriority(3)
    }

    private var cullingTitleBar: some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                cullingHeading
                Spacer()
                cullingHeaderActions
            }
            VStack(alignment: .leading, spacing: 4) {
                cullingHeading
                cullingHeaderActions
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }


    private var cullingFilterControls: some View {
        FlowLayout(spacing: 8) {
            Text("Status").font(.caption.weight(.semibold))
            ForEach(FixtureCullingView.selectableCases, id: \.self) { view in
                Toggle(
                    view.label,
                    isOn: Binding(
                        get: { model.cullingViews.contains(view) },
                        set: { _ in model.toggleCullingViewFilter(view) }
                    )
                )
                .toggleStyle(.checkbox)
            }
            Divider().frame(width: 1, height: 18)
            Text("Rating").font(.caption.weight(.semibold))
            CullingRatingSlider(
                rating: model.cullingMinimumRating,
                isDisabled: false,
                accessibilityLabel: "Minimum rating filter",
                help: "Click or drag across the stars to show that rating and above. Zero shows all ratings."
            ) { rating in
                model.setCullingMinimumRating(rating)
            }
            Divider().frame(width: 1, height: 18)
            Text("Color").font(.caption.weight(.semibold))
            ForEach(CullingColorFilter.selectableCases, id: \.self) { color in
                LightroomColorFilterButton(
                    color: color,
                    isSelected: model.cullingColorFilters.contains(color)
                ) {
                    model.toggleCullingColorFilter(color)
                }
            }
            Button("Clear filters") { model.clearCullingFilters() }
                .backstageHelp("Restore the default Culling status, rating, color, and search filters.")
        }
        .onChange(of: model.cullingSearch) { _, _ in
            model.scheduleCullingSearchRefresh()
        }
        .onChange(of: model.cullingViews) { _, _ in model.applyCullingFilters() }
        .onChange(of: model.cullingRatingFilters) { _, _ in model.applyCullingFilters() }
        .onChange(of: model.cullingColorFilters) { _, _ in model.applyCullingFilters() }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var cullingSummary: some View {
        let summary = model.cullingWorkspace.summary
        return FlowLayout(spacing: 8) {
            Text("\(summary.filtered.formatted()) match • \(summary.total.formatted()) in scope")
            Text("• \(summary.undecided.formatted()) undecided")
            Text("• \(summary.picked.formatted()) picked")
            Text("• \(summary.rejected.formatted()) hidden")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var cullingWindowControls: some View {
        let workspace = model.cullingWorkspace
        return HStack {
            if let range = workspace.visibleRange {
                Text("\(range.lowerBound.formatted())–\(range.upperBound.formatted()) of \(workspace.summary.filtered.formatted())")
                    .font(.callout.weight(.semibold))
                    .monospacedDigit()
            } else {
                Text("0 of \(workspace.summary.filtered.formatted())")
                    .font(.callout.weight(.semibold))
            }
            Button("Previous \(workspace.limit)") {
                model.moveCullingWindow(forward: false)
            }
            .disabled(!workspace.hasPrevious)
            .backstageHelp("Load the previous \(workspace.limit) matching assets in the current Culling scope.")
            Button("Next \(workspace.limit)") {
                model.moveCullingWindow(forward: true)
            }
            .disabled(!workspace.hasNext)
            .backstageHelp("Load the next \(workspace.limit) matching assets in the current Culling scope.")
            Spacer()
            HStack(spacing: 0) {
                Button("−") { decreaseCullingThumbnailSize() }
                    .disabled(!model.canDecreaseCullingThumbnailSize)
                    .backstageHelp("Show more assets at once by making each Culling thumbnail smaller.")
                Divider().frame(height: 18)
                Button("+") { increaseCullingThumbnailSize() }
                    .disabled(!model.canIncreaseCullingThumbnailSize)
                    .backstageHelp("Make each Culling thumbnail larger, showing fewer assets at once.")
            }
            .buttonStyle(.bordered)
            .backstageHelp(model.cullingUsesFill
                ? "Switch thumbnails to Fit so each complete image remains visible inside its card."
                : "Switch thumbnails to Fill so images crop to cover their cards edge to edge.")
            Button(model.cullingUsesFill ? "Fill" : "Fit") {
                model.toggleCullingFitFill()
            }
            .buttonStyle(.bordered)
        }
    }

    private var cullingGrid: some View {
        ScrollViewReader { proxy in
            cullingGridViewport
                .onMoveCommand { direction in
                    moveCullingSelection(direction)
                    if let focused = model.focusedCullingAssetID {
                        proxy.scrollTo(focused, anchor: .center)
                    }
                }
                .modifier(
                    CullingPrimaryKeyCommands(
                        model: model,
                        quickLook: quickLook
                    )
                )
                .modifier(CullingDisplayKeyCommands(model: model))
        }
        .frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
        .clipped()
        .layoutPriority(1)
    }

    private var cullingGridViewport: some View {
        ScrollView {
            if !model.isBlockingFixtureCullingLoad {
                cullingGridCards
            }
        }
        .id(cullingViewportIdentity)
        .background {
            GeometryReader { gridGeometry in
                Color.clear
                    .onAppear {
                        updateCullingGridWidth(gridGeometry.size.width)
                    }
                    .onChange(of: gridGeometry.size.width) { _, width in
                        updateCullingGridWidth(width)
                    }
            }
        }
        .focusable()
        .overlay { cullingGridOverlay }
        .modifier(CullingScrollPhaseObserver(model: model))
    }

    private var cullingGridCards: some View {
        LazyVGrid(
            columns: Array(
                repeating: GridItem(.flexible(minimum: 0), spacing: 8),
                count: model.cullingGridDensity
            ),
            spacing: 8
        ) {
            ForEach(model.visibleCullingAssets) { asset in
                CullingAssetCard(
                    asset: asset,
                    state: model.cullingStates[asset.id],
                    thumbnail: model.cullingThumbnails[asset.id],
                    thumbnailFailure: model.cullingThumbnailFailures[asset.id],
                    onRetryThumbnail: { model.retryThumbnail(for: asset.id) },
                    onAllowPhotos: {
                        Task {
                            await model.authorizeAndLoadPhotos()
                            model.retryThumbnail(for: asset.id)
                        }
                    },
                    isSelected: model.cullingSelection.selectedIDs.contains(asset.id),
                    isFocused: model.cullingSelection.focusedID == asset.id,
                    usesFill: model.cullingUsesFill
                )
                .frame(
                    width: CGFloat(model.cullingGridColumnWidth),
                    alignment: .topLeading
                )
                .clipped()
                .id(asset.id)
                .contentShape(Rectangle())
                .onTapGesture {
                    model.clickCullingAsset(asset.id, modifiers: NSEvent.modifierFlags)
                    Task { await model.loadPreview() }
                }
                .onAppear {
                    guard !isPreviewMode else { return }
                    model.cullingAssetDidAppear(asset)
                }
                .onDisappear {
                    model.cullingAssetDidDisappear(asset.id)
                }
            }
        }
        .padding(.horizontal, 6)
        .padding(.top, 12)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .animation(.snappy(duration: 0.24), value: model.cullingGridDensity)
    }

    @ViewBuilder
    private var cullingGridOverlay: some View {
        if model.isBlockingFixtureCullingLoad {
            VStack(spacing: 12) {
                ProgressView()
                    .controlSize(.large)
                Text("Applying filters…")
                    .fixedSize(horizontal: true, vertical: false)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if model.visibleCullingAssets.isEmpty {
            ContentUnavailableView(
                model.cullingAssets.isEmpty ? "No culling items" : "No matching items",
                systemImage: "photo.stack",
                description: Text(
                    model.cullingAssets.isEmpty
                        ? "Open a fixture snapshot or load Photos."
                        : "Change or clear the current filters."
                )
            )
        }
    }

    private func updateCullingGridWidth(_ width: CGFloat) {
        model.updateCullingGridWidth(Double(width - 12))
    }

    private func moveCullingSelection(_ direction: MoveCommandDirection) {
        let extending = NSEvent.modifierFlags.contains(.shift)
        switch direction {
        case .left:
            model.moveCullingSelection(by: -1, extending: extending)
        case .right:
            model.moveCullingSelection(by: 1, extending: extending)
        case .up:
            model.moveCullingSelection(by: -model.cullingGridDensity, extending: extending)
        case .down:
            model.moveCullingSelection(by: model.cullingGridDensity, extending: extending)
        default:
            return
        }
    }

    private var cullingActions: some View {
        VStack(alignment: .leading, spacing: 4) {
            cullingDestinationActions
            cullingDecisionActions
            cullingHistoryActions
            cullingStatusFeedback
            cullingOperationProgress
            Text("P include • H exclude • X Waste Basket • U clear • Rating slider 0–5 • Color buttons toggle • 6–9 color shortcuts • +/− density • Z fit/fill • Space Quick Look • ⌘Z undo")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .controlSize(.small)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .bottomLeading)
        .layoutPriority(2)
    }

    @ViewBuilder
    private var cullingStatusFeedback: some View {
        let isWorking = model.isLoadingFixtureCulling
            || model.isLoadingCullingDecisions
            || model.isApplyingCullingDecision
            || model.cullingWasteBasketQueueing
            || model.cullingWasteBasketPendingActionID != nil
            || model.isLoadingPreview
        if isWorking {
            BackstageFeedbackView(message: model.cullingStatus, isWorking: true)
        } else {
            Text(model.cullingStatus)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var cullingDestinationActions: some View {
        HStack(spacing: 6) {
            Button("Send to Metadata") { model.sendCullingSelection(to: .metadata) }
                .disabled(model.cullingSelection.selectedIDs.isEmpty)
                .accessibilityLabel("Send selection to Metadata")
                .accessibilityHint("Metadata is the authoritative title and keyword review handoff; this does not approve or publish the selection.")
                .backstageHelp("Send selected assets to Metadata, the authoritative title and keyword review surface. This does not approve or publish them.")
            Text("Review and Uploads remain available from the sidebar.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer()
        }
    }

    private var cullingDecisionActions: some View {
        FlowLayout(spacing: 4) {
            Button("P Include") {
                Task { await model.applyPickShortcut(.pick) }
            }
            .disabled(model.cullingSelection.selectedIDs.isEmpty || model.isApplyingCullingDecision)
            .accessibilityLabel("P Include selected items")
            .backstageHelp("Instantly include the explicit selection in the current fixture. The existing audited fixture writer reports affected, skipped, and failed items.")
            Button("H Exclude") {
                Task { await model.applyPickShortcut(.reject) }
            }
            .disabled(model.cullingSelection.selectedIDs.isEmpty || model.isApplyingCullingDecision)
            .accessibilityLabel("H Exclude selected items")
            .backstageHelp("Instantly exclude the explicit selection from the current fixture. This remains fixture-local and reversible with session Undo.")
            Button("X Waste Basket") {
                Task { await model.moveCullingSelectionToWasteBasket() }
            }
            .disabled(
                model.cullingSelection.selectedIDs.isEmpty
                    || model.isApplyingCullingDecision
                    || model.cullingWasteBasketQueueing
                    || model.cullingWasteBasketPendingActionID != nil
            )
            .accessibilityLabel("X move selected items to the recoverable Waste Basket")
            .backstageHelp("Move the explicit selection to the recoverable Waste Basket through the guarded lifecycle writer; it does not create a global tombstone directly.")
            Text("Rating")
                .font(.caption.weight(.semibold))
            CullingRatingSlider(
                rating: model.cullingSelectionRating,
                isDisabled: model.cullingSelection.selectedIDs.isEmpty || model.isApplyingCullingDecision,
                accessibilityLabel: "Selected photo rating",
                help: "Click or drag across the stars to assign 1–5. Choose the current rating again to clear it. Shortcuts: 0–5."
            ) { rating in
                Task { await model.applyRatingShortcut(rating) }
            }
            Text("Color")
                .font(.caption.weight(.semibold))
            ForEach(SidecarColor.allCases.filter { $0 != .none }, id: \.self) { color in
                cullingColorAssignmentButton(color)
            }
        }
    }

    private func cullingColorAssignmentButton(_ color: SidecarColor) -> some View {
        let isSelected = model.cullingSelectionHasColor(color)
        return Button {
            Task { await model.toggleCullingColor(color) }
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 4)
                    .fill(cullingAssignmentColor(color))
                RoundedRectangle(cornerRadius: 4)
                    .stroke(isSelected ? Color.white : Color.secondary, lineWidth: isSelected ? 2 : 1)
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: 20, height: 20)
            .modifier(CullingCompactControlChrome(
                width: CullingCompactControlMetrics.colorWidth,
                isSelected: isSelected
            ))
        }
        .buttonStyle(.plain)
        .disabled(model.cullingSelection.selectedIDs.isEmpty || model.isApplyingCullingDecision)
        .accessibilityLabel("Assign \(color.label) color")
        .accessibilityValue(isSelected
            ? "Applied to every selected asset; press again to clear."
            : "Not applied to every selected asset.")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .backstageHelp(cullingColorAssignmentHelp(color))
    }

    private func cullingColorAssignmentHelp(_ color: SidecarColor) -> String {
        let shortcut: String? = switch color {
        case .red: "6"
        case .yellow: "7"
        case .green: "8"
        case .blue: "9"
        case .purple, .none: nil
        }
        let suffix = shortcut.map { " (\($0))." } ?? "."
        return "Toggle \(color.label.lowercased()) on selected assets\(suffix)"
    }

    private func cullingAssignmentColor(_ color: SidecarColor) -> Color {
        switch color {
        case .none: .clear
        case .red: .red
        case .yellow: .yellow
        case .green: .green
        case .blue: .blue
        case .purple: .purple
        }
    }

    private var cullingHistoryActions: some View {
        HStack(spacing: 6) {
            Text("\(model.cullingSelection.selectedIDs.count) selected")
                .foregroundStyle(.secondary)
            Button("Undo") { Task { await model.undoLastCullingDecision() } }
                .keyboardShortcut("z", modifiers: .command)
                .disabled(model.cullingHistory.isEmpty)
                .backstageHelp("Reverse the most recent Culling change made during this Backstage session.")
            cullingHistoryLabel
            Spacer()
            if !model.cullingSelection.selectedIDs.isEmpty {
                Button("Clear selection") { model.clearCullingSelection() }
                    .backstageHelp("Deselect every currently selected Culling asset without changing any decisions.")
            }
        }
    }

    @ViewBuilder
    private var cullingHistoryLabel: some View {
        if let last = model.cullingHistory.last {
            Text("Last: \(last.label) • \(model.cullingHistory.count) reversible step\(model.cullingHistory.count == 1 ? "" : "s")")
                .foregroundStyle(.secondary)
        } else {
            Text("No culling changes in this session.")
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var cullingOperationProgress: some View {
        if model.isLoadingCullingDecisions || model.isApplyingCullingDecision {
            HStack {
                ProgressView(
                    value: Double(model.cullingDecisionProgress),
                    total: Double(max(1, model.cullingDecisionTotal))
                )
                Button("Stop") { model.cancelCullingOperation() }
                    .disabled(model.cullingCancellationRequested)
                    .backstageHelp("Request cancellation of the Culling operation currently in progress.")
            }
        }
    }

    @ViewBuilder
    private var cullingPreviewPane: some View {
                if model.isPreviewPanelVisible {
                    Group {
                        if model.isLoadingPreview {
                            ProgressView("Loading preview…")
                        } else if let preview = model.photoPreview,
                                  let image = NSImage(data: preview.jpegData),
                                  let asset = model.focusedCullingAsset {
                            ScrollView {
                                VStack(alignment: .leading, spacing: 12) {
                                    Image(nsImage: image)
                                        .resizable()
                                        .scaledToFit()
                                    cullingMetadataInspector(asset)
                                }
                                .padding()
                            }
                        } else {
                            ContentUnavailableView(
                                "No preview",
                                systemImage: "photo",
                                description: Text("Select a photo, or press Space for Quick Look.")
                            )
                        }
                    }
                    .frame(minWidth: 220, idealWidth: 300, maxWidth: 360)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }
    }
    private var cullingHeading: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(
                model.cullingPool?.name
                    ?? (model.selectedFixtureBreadcrumb.isEmpty
                        ? nil
                        : model.selectedFixtureBreadcrumb)
                    ?? "Fixture Culling"
            )
            .font(.largeTitle.bold())
            if let pool = model.cullingPool {
                Text("Fixture pool \(pool.id) • \(pool.assetCount) immutable ordered assets")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var cullingViewportIdentity: String {
        [
            model.selectedFixtureID,
            model.cullingViews.map(\.rawValue).sorted().joined(separator: ","),
            String(model.cullingWorkspace.offset),
            model.visibleCullingAssets.first?.id ?? "empty",
        ].joined(separator: ":")
    }

    private var cullingHeaderActions: some View {
        HStack {
            Menu("Workflows") {
                Button("Open in Review") { model.sendCullingSelection(to: .review) }
                    .disabled(model.cullingSelection.selectedIDs.isEmpty)
                    .backstageHelp("Open the owning Review workspace for the explicit Culling selection without changing its decisions.")
                Button("Export selected originals…") {
                    guard let directory = chooseExportDirectory() else { return }
                    Task { await model.exportSelected(to: directory) }
                }
                .disabled(model.cullingSelection.selectedIDs.isEmpty)
                .backstageHelp("Choose a destination for verified original resources from the explicit Culling selection; this does not upload or publish them.")
            }
            .disabled(model.cullingSelection.selectedIDs.isEmpty)
            .accessibilityLabel("Culling workflows")
            if model.cullingPool != nil {
                Button("All Photos") {
                    model.showAllPhotosInCulling()
                }
                .backstageHelp("Leave the current fixture pool and show the complete indexed Photos library in Culling.")
            }
            Button("Allow Photos") {
                Task { await model.authorizeAndLoadPhotos() }
            }
            .backstageHelp("Request Photos permission for Backstage and load the available local library previews.")
            Button {
                Task {
                    await model.refreshPhotosAndRecentIndex()
                    if !model.selectedFixtureID.isEmpty {
                        await model.loadFixtureCullingWindow()
                    }
                }
            } label: {
                if model.isLoadingPhotos || model.isReconcilingPhotosIndex {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Discovering recent Photos…")
                    }
                } else {
                    Text("Refresh & discover")
                }
            }
            .disabled(model.isLoadingPhotos || model.isReconcilingPhotosIndex)
            .accessibilityLabel(
                model.isLoadingPhotos || model.isReconcilingPhotosIndex
                    ? "Discovering recent Photos"
                    : "Refresh previews and discover recent Photos"
            )
            .backstageHelp("Refresh local previews, resume recent-photo discovery from the durable Owner checkpoint, and reload Culling. A seven-day overlap safely rechecks the boundary without changing decisions.")
            Button {
                Task { await model.reconcilePhotosLibraryIndex() }
            } label: {
                if model.isReconcilingPhotosIndex {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Reconciling complete Photos library")
                } else {
                    Text("Full library audit")
                }
            }
            .disabled(model.isLoadingPhotos || model.isReconcilingPhotosIndex)
            .backstageHelp("Explicitly audit the complete Photos library and reconcile unavailable assets. This maintenance pass can take several minutes and does not change existing decisions.")
        }
    }

    @ViewBuilder
    private func cullingMetadataInspector(_ asset: FixtureAsset) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(asset.title.isEmpty ? asset.filename : asset.title)
                .font(.headline)
                .textSelection(.enabled)
            metadataRow("File", value: asset.filename)
            metadataRow(
                "Format",
                value: asset.resourceFormat.isEmpty
                    ? (asset.filename as NSString).pathExtension.uppercased()
                    : asset.resourceFormat
            )
            metadataRow("Captured", value: formattedCaptureDate(asset.capturedAt))
            metadataRow("Dimensions", value: formattedDimensions(asset))
            if let byteCount = model.currentImageByteCount(for: asset.id) {
                metadataRow("Current image size", value: formattedCurrentImageSize(byteCount))
            }
            metadataRow(
                "Location",
                value: asset.locationLabel.isEmpty ? "No location" : asset.locationLabel
            )
            VStack(alignment: .leading, spacing: 3) {
                Text("Keywords")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(asset.keywords.isEmpty ? "No keywords" : asset.keywords.joined(separator: ", "))
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func metadataRow(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value.isEmpty ? "Unavailable" : value)
                .textSelection(.enabled)
        }
    }

    private func formattedCaptureDate(_ value: String) -> String {
        guard !value.isEmpty,
              let date = CullingWorkspace.captureDate(value)
        else { return "Unavailable" }
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.timeZone = .current
        formatter.dateFormat = value.contains(".")
            ? "MMM d, yyyy 'at' HH:mm:ss.SSS"
            : "MMM d, yyyy 'at' HH:mm:ss"
        return formatter.string(from: date)
    }

    private func formattedDimensions(_ asset: FixtureAsset) -> String {
        guard asset.pixelWidth > 0, asset.pixelHeight > 0 else {
            return "Unavailable"
        }
        let megapixels = Double(asset.pixelWidth * asset.pixelHeight) / 1_000_000
        return "\(asset.pixelWidth) × \(asset.pixelHeight) • \(megapixels.formatted(.number.precision(.fractionLength(1)))) MP"
    }

    private func formattedCurrentImageSize(_ byteCount: Int64) -> String {
        return ByteCountFormatter.string(fromByteCount: byteCount, countStyle: .file)
    }

    private func increaseCullingThumbnailSize() {
        withAnimation(.snappy(duration: 0.24)) {
            model.increaseCullingThumbnailSize()
        }
    }

    private func decreaseCullingThumbnailSize() {
        withAnimation(.snappy(duration: 0.24)) {
            model.decreaseCullingThumbnailSize()
        }
    }

    private func chooseExportDirectory() -> URL? {
        let panel = NSOpenPanel()
        panel.title = "Export verified originals"
        panel.prompt = "Export"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        return panel.runModal() == .OK ? panel.url : nil
    }
}

private struct CullingPrimaryKeyCommands: ViewModifier {
    @ObservedObject var model: BackstageViewModel
    @ObservedObject var quickLook: BackstageQuickLookCoordinator

    func body(content: Content) -> some View {
        content
            .onKeyPress("a", phases: .down) { press in
                guard press.modifiers.contains(.command) else { return .ignored }
                model.selectAllCullingAssets()
                return .handled
            }
            .onKeyPress(.space) {
                CullingQuickLookPresenter.present(model: model, coordinator: quickLook)
                return .handled
            }
            .onKeyPress("p") {
                Task { await model.applyPickShortcut(.pick) }
                return .handled
            }
            .onKeyPress("h") {
                Task { await model.applyPickShortcut(.reject) }
                return .handled
            }
            .onKeyPress("x") {
                Task { await model.moveCullingSelectionToWasteBasket() }
                return .handled
            }
            .onKeyPress("u") {
                Task { await model.applyPickShortcut(.unpick) }
                return .handled
            }
            .onKeyPress("b") {
                model.selectVisibleBurstCandidates()
                return .handled
            }
    }
}

private struct CullingDisplayKeyCommands: ViewModifier {
    @ObservedObject var model: BackstageViewModel

    func body(content: Content) -> some View {
        content
            .onKeyPress("+") {
                withAnimation(.snappy(duration: 0.24)) {
                    model.increaseCullingThumbnailSize()
                }
                return .handled
            }
            .onKeyPress("-") {
                withAnimation(.snappy(duration: 0.24)) {
                    model.decreaseCullingThumbnailSize()
                }
                return .handled
            }
            .onKeyPress("z") {
                model.toggleCullingFitFill()
                return .handled
            }
            .onKeyPress(characters: .decimalDigits) { press in
                applyNumericShortcut(press.characters)
            }
    }

    private func applyNumericShortcut(_ characters: String) -> KeyPress.Result {
        guard let value = Int(characters) else { return .ignored }
        if (0...5).contains(value) {
            Task { await model.applyRatingShortcut(value) }
            return .handled
        }
        let colors: [Int: SidecarColor] = [
            6: .red, 7: .yellow, 8: .green, 9: .blue,
        ]
        guard let color = colors[value] else { return .ignored }
        Task { await model.applyColorShortcut(color) }
        return .handled
    }
}

private struct CullingScrollPhaseObserver: ViewModifier {
    @ObservedObject var model: BackstageViewModel

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(macOS 15.0, *) {
            content.onScrollPhaseChange { _, phase in
                model.cullingScrollPhaseChanged(isScrolling: phase.isScrolling)
            }
        } else {
            content
        }
    }
}

private struct CullingAssetCard: View {
    var asset: FixtureAsset
    var state: SidecarDecisionState?
    var thumbnail: NSImage?
    var thumbnailFailure: CullingThumbnailFailure?
    var onRetryThumbnail: () -> Void
    var onAllowPhotos: () -> Void
    var isSelected: Bool
    var isFocused: Bool
    var usesFill: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Group {
                if let thumbnail {
                    Image(nsImage: thumbnail)
                        .resizable()
                        .aspectRatio(contentMode: usesFill ? .fill : .fit)
                } else if let thumbnailFailure {
                    VStack(spacing: 5) {
                        Image(systemName: thumbnailFailure.systemImage)
                            .font(.title2)
                        Text(thumbnailFailure.title)
                            .font(.caption2.weight(.semibold))
                        Text(thumbnailFailure.detail)
                            .font(.caption2)
                            .multilineTextAlignment(.center)
                            .lineLimit(3)
                        Button(thumbnailFailure.actionTitle) {
                            if thumbnailFailure.offersPhotosAccess {
                                onAllowPhotos()
                            } else {
                                onRetryThumbnail()
                            }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .backstageHelp(
                            thumbnailFailure.offersPhotosAccess
                                ? "Request Photos permission for Backstage, then retry this thumbnail."
                                : "Retry loading this individual Photos thumbnail without changing its culling decision."
                        )
                    }
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(
                        "\(thumbnailFailure.title). \(thumbnailFailure.detail)"
                    )
                } else {
                    VStack(spacing: 5) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Loading preview…")
                            .font(.caption2)
                    }
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(4 / 3, contentMode: .fit)
            .background(.quaternary.opacity(0.45))
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .clipped()
            .saturation(isHidden ? 0 : 1)
            .overlay(alignment: .topTrailing) {
                if isPicked {
                    Image(systemName: "flag.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(6)
                        .background(.blue, in: Circle())
                        .padding(6)
                        .accessibilityLabel("Picked")
                }
            }
            HStack(spacing: 5) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(asset.title.isEmpty ? asset.filename : asset.title)
                        .lineLimit(1)
                        .font(.caption.weight(.semibold))
                    if !asset.title.isEmpty {
                        Text(asset.filename)
                            .lineLimit(1)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 2)
                Text(starLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Circle()
                    .fill(color(state?.color ?? ""))
                    .overlay(Circle().stroke(.secondary.opacity(0.5)))
                    .frame(width: 11, height: 11)
            }
        }
        .padding(6)
        .background(
            RoundedRectangle(cornerRadius: 9)
                .fill(isSelected ? Color.accentColor.opacity(0.22) : Color.secondary.opacity(0.06))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 9)
                .stroke(
                    isFocused ? Color.accentColor : (isSelected ? Color.accentColor.opacity(0.65) : .clear),
                    lineWidth: isFocused ? 3 : 1
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var starLabel: String {
        let rating = state?.rating ?? asset.rating
        return rating > 0 ? String(repeating: "★", count: rating) : "☆"
    }

    private var isHidden: Bool {
        asset.placementState == .hidden
            || state?.pickState == "hidden"
            || state?.pickState == "rejected"
    }

    private var isPicked: Bool {
        asset.placementState == .picked
            || state?.pickState == "picked"
    }

    private func color(_ value: String) -> Color {
        switch value {
        case "red": .red
        case "yellow": .yellow
        case "green": .green
        case "blue": .blue
        case "purple": .purple
        default: .clear
        }
    }

}

private enum CullingCompactControlMetrics {
    static let ratingWidth: CGFloat = 78
    static let colorWidth: CGFloat = 30
    static let height: CGFloat = 28
    static let cornerRadius: CGFloat = 6
}

private struct CullingCompactControlChrome: ViewModifier {
    let width: CGFloat
    let isSelected: Bool

    func body(content: Content) -> some View {
        content
            .frame(width: width, height: CullingCompactControlMetrics.height)
            .background(
                RoundedRectangle(cornerRadius: CullingCompactControlMetrics.cornerRadius)
                    .fill(isSelected ? Color.accentColor.opacity(0.20) : Color(nsColor: .controlBackgroundColor))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CullingCompactControlMetrics.cornerRadius)
                    .stroke(
                        isSelected ? Color.accentColor : Color(nsColor: .separatorColor),
                        lineWidth: isSelected ? 2 : 1
                    )
            )
    }
}

private struct CullingRatingSlider: View {
    let rating: Int?
    let isDisabled: Bool
    let accessibilityLabel: String
    let help: String
    let action: (Int) -> Void

    @State private var pendingRating: Int?

    private var displayedRating: Int {
        pendingRating ?? rating ?? 0
    }

    private var accessibilityValue: String {
        guard let rating else { return "Mixed" }
        if accessibilityLabel == "Minimum rating filter" {
            return rating == 0 ? "All ratings" : "\(rating) stars and above"
        }
        return rating == 0 ? "Unrated" : "\(rating) star\(rating == 1 ? "" : "s")"
    }

    var body: some View {
        ZStack {
            HStack(spacing: 1) {
                ForEach(1...5, id: \.self) { value in
                    Image(systemName: "star.fill")
                        .foregroundStyle(value <= displayedRating ? Color.yellow : Color.secondary.opacity(0.38))
                }
            }
            .font(.system(size: 12, weight: .semibold))

            GeometryReader { geometry in
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { gesture in
                                guard !isDisabled else { return }
                                pendingRating = rating(at: gesture.location.x, width: geometry.size.width)
                            }
                            .onEnded { gesture in
                                guard !isDisabled else { return }
                                let selectedRating = rating(at: gesture.location.x, width: geometry.size.width)
                                pendingRating = nil
                                action(selectedRating == rating ? 0 : selectedRating)
                            }
                    )
            }
        }
        .modifier(CullingCompactControlChrome(
            width: CullingCompactControlMetrics.ratingWidth,
            isSelected: rating != nil
        ))
        .disabled(isDisabled)
        .backstageHelp(help)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(accessibilityValue)
        .accessibilityAdjustableAction { direction in
            guard !isDisabled else { return }
            let current = rating ?? 0
            switch direction {
            case .increment:
                action(min(5, current + 1))
            case .decrement:
                action(max(0, current - 1))
            @unknown default:
                break
            }
        }
        .accessibilityAction(named: "Clear rating") {
            guard !isDisabled else { return }
            action(0)
        }
    }

    private func rating(at location: CGFloat, width: CGFloat) -> Int {
        guard width > 0 else { return 0 }
        let normalized = min(max(location / width, 0), 0.999_999)
        return min(5, max(1, Int(normalized * 5) + 1))
    }
}

private struct LightroomColorFilterButton: View {
    let color: CullingColorFilter
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 3)
                    .fill(filterColor)
                RoundedRectangle(cornerRadius: 3)
                    .stroke(isSelected ? Color.white : Color.secondary, lineWidth: isSelected ? 2 : 1)
                if color == .none {
                    Image(systemName: "slash")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 20, height: 20)
            .modifier(CullingCompactControlChrome(
                width: CullingCompactControlMetrics.colorWidth,
                isSelected: isSelected
            ))
        }
        .buttonStyle(.plain)
        .backstageHelp("Toggle whether assets labeled \(color.label.lowercased()) are included in the current Culling results.")
        .accessibilityLabel(color.label)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var filterColor: Color {
        switch color {
        case .red: .red
        case .yellow: .yellow
        case .green: .green
        case .blue: .blue
        case .purple: .purple
        case .none, .all: .clear
        }
    }
}

struct FixturePickerOption: Identifiable {
    let label: String
    let value: String

    var id: String { value }

    init(_ label: String, _ value: String) {
        self.label = label
        self.value = value
    }
}

struct FixturePickerField: View {
    let title: String
    @Binding var selection: String
    let options: [FixturePickerOption]

    init(
        _ title: String,
        selection: Binding<String>,
        options: [FixturePickerOption]
    ) {
        self.title = title
        _selection = selection
        self.options = options
    }

    var body: some View {
        HStack(spacing: 12) {
            Text(title)
                .lineLimit(1)
                .layoutPriority(1)
            Spacer(minLength: 8)
            Menu {
                ForEach(options) { option in
                    Button {
                        selection = option.value
                    } label: {
                        if option.value == selection {
                            Label(option.label, systemImage: "checkmark")
                        } else {
                            Text(option.label)
                        }
                    }
                    .backstageHelp("Select \(option.label) for \(title.lowercased()).")
                }
            } label: {
                HStack {
                    Text(options.first(where: { $0.value == selection })?.label ?? selection)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.up.chevron.down")
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 10)
                .frame(width: 220, height: 28, alignment: .leading)
                .background(
                    Color.secondary.opacity(0.18),
                    in: RoundedRectangle(cornerRadius: 7)
                )
                .contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AdaptiveFixtureFieldPair<Left: View, Right: View>: View {
    let minimumColumnWidth: CGFloat
    @ViewBuilder let left: Left
    @ViewBuilder let right: Right

    init(
        minimumColumnWidth: CGFloat = 250,
        @ViewBuilder left: () -> Left,
        @ViewBuilder right: () -> Right
    ) {
        self.minimumColumnWidth = minimumColumnWidth
        self.left = left()
        self.right = right()
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 24) {
                left
                    .frame(minWidth: minimumColumnWidth, maxWidth: .infinity)
                right
                    .frame(minWidth: minimumColumnWidth, maxWidth: .infinity)
            }
            VStack(alignment: .leading, spacing: 8) {
                left
                right
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if DEBUG
#Preview("Culling — Wide") {
    CullingView(
        model: CullingPreviewFixtures.model(),
        isPreviewMode: true
    )
    .frame(width: 1_440, height: 900)
}
#endif
