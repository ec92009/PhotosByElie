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
        coordinator: BackstageQuickLookCoordinator
    ) {
        let ids = model.selectedCullingAssetIDs
        guard !ids.isEmpty else { return }
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
                            by: -1,
                            from: assetID,
                            model: model,
                            coordinator: coordinator
                        )
                    case .next:
                        navigate(
                            by: 1,
                            from: assetID,
                            model: model,
                            coordinator: coordinator
                        )
                    case .pick:
                        applyPlacement(
                            .pick,
                            assetID: assetID,
                            model: model,
                            coordinator: coordinator
                        )
                    case .hide:
                        applyPlacement(
                            .reject,
                            assetID: assetID,
                            model: model,
                            coordinator: coordinator
                        )
                    case let .rating(value):
                        model.clickCullingAsset(assetID, modifiers: [])
                        Task { [weak model, weak coordinator] in
                            guard let model, let coordinator else { return }
                            await model.applyRatingShortcut(value)
                            refreshMetadata(assetID, model: model, coordinator: coordinator)
                        }
                    case let .color(value):
                        model.clickCullingAsset(assetID, modifiers: [])
                        Task { [weak model, weak coordinator] in
                            guard let model, let coordinator else { return }
                            await model.applyColorShortcut(value)
                            refreshMetadata(assetID, model: model, coordinator: coordinator)
                        }
                    case .approve, .unpick:
                        return false
                    }
                    return true
                }
            )
        }
    }

    private static func navigate(
        by delta: Int,
        from assetID: String,
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator
    ) {
        model.clickCullingAsset(assetID, modifiers: [])
        model.moveCullingSelection(by: delta, extending: false)
        guard model.focusedCullingAssetID != assetID, coordinator.isVisible else { return }
        present(model: model, coordinator: coordinator)
    }

    private static func applyPlacement(
        _ action: SidecarPickAction,
        assetID: String,
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator
    ) {
        let wasVisible = model.visibleCullingAssets.contains { $0.id == assetID }
        model.clickCullingAsset(assetID, modifiers: [])
        Task { [weak model, weak coordinator] in
            guard let model, let coordinator else { return }
            await model.applyPickShortcut(action)
            guard coordinator.isVisible else { return }
            let remainsVisible = model.visibleCullingAssets.contains { $0.id == assetID }
            if wasVisible && !remainsVisible {
                if model.focusedCullingAssetID == nil {
                    coordinator.dismiss()
                } else {
                    present(model: model, coordinator: coordinator)
                }
            } else {
                refreshMetadata(assetID, model: model, coordinator: coordinator)
            }
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
            capturedAt: asset.capturedAt,
            rating: decision?.rating ?? asset.rating,
            color: decision?.color ?? asset.color,
            state: decision?.pickState ?? asset.placementState.rawValue,
            shortcutHint: "Shortcuts: ←/→ navigate • H exclude • P include • 1–5 rating • 6–9 color"
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
                cullingPreviewPane
            }
            .background(SplitViewAutosaver(name: "PhotosByElieBackstage.CullingSplit"))
            .padding(.top, viewport.safeAreaInsets.top)
            .frame(
                width: viewport.size.width,
                height: max(0, viewport.size.height - viewport.safeAreaInsets.top),
                alignment: .top
            )
        }
        .animation(.snappy(duration: 0.24), value: model.isPreviewPanelVisible)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            guard !isPreviewMode else { return }
            if model.fixtures.isEmpty {
                await model.loadFixtures()
            }
            if model.libraryItems.isEmpty {
                await model.refreshPhotos()
            }
            if !model.cullingFixtureID.isEmpty {
                await model.loadFixtureCullingWindow()
            } else {
                await model.refreshCullingDecisions()
            }
        }
    }

    private var cullingWorkspacePane: some View {
        VStack(alignment: .leading, spacing: 12) {
            cullingHeader
            cullingGrid
            cullingActions
        }
        .padding()
        .frame(minWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipped()
    }

    private var cullingHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            cullingTitleBar
            Text(model.photoStatus)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
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
            VStack(alignment: .leading, spacing: 8) {
                cullingHeading
                cullingHeaderActions
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }


    private var cullingFilterControls: some View {
        FlowLayout(spacing: 8) {
            Text("Media").font(.caption.weight(.semibold))
            ForEach(CullingMediaFilter.selectableCases, id: \.self) { filter in
                Toggle(
                    filter.label,
                    isOn: Binding(
                        get: { model.cullingMediaFilters.contains(filter) },
                        set: { _ in model.toggleCullingMediaFilter(filter) }
                    )
                )
                .toggleStyle(.checkbox)
            }
            Divider().frame(width: 1, height: 18)
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
            ForEach(0...5, id: \.self) { value in
                LightroomRatingFilterButton(
                    rating: value,
                    isSelected: model.cullingRatingFilters.contains(value)
                ) {
                    model.toggleCullingRatingFilter(value)
                }
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
                .backstageHelp("Restore the default Culling media, status, rating, color, and search filters.")
        }
        .onChange(of: model.cullingSearch) { _, _ in
            model.scheduleCullingSearchRefresh()
        }
        .onChange(of: model.cullingMediaFilters) { _, _ in model.applyCullingFilters() }
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
        .frame(maxWidth: .infinity, minHeight: 240, maxHeight: .infinity)
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
                    isSelected: model.cullingSelection.selectedIDs.contains(asset.id),
                    isFocused: model.cullingSelection.focusedID == asset.id,
                    usesFill: model.cullingUsesFill
                )
                .id(asset.id)
                .contentShape(Rectangle())
                .onTapGesture {
                    model.clickCullingAsset(asset.id, modifiers: NSEvent.modifierFlags)
                    Task { await model.loadPreview() }
                }
                .onAppear {
                    guard !isPreviewMode else { return }
                    model.requestThumbnail(for: asset.id)
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
        VStack(alignment: .leading, spacing: 8) {
            cullingDestinationActions
            cullingDecisionActions
            cullingHistoryActions
            Text(model.cullingStatus)
                .font(.caption)
                .foregroundStyle(.secondary)
            cullingOperationProgress
            Text("Shortcuts: P include in fixture • H exclude from fixture • X globally reject • U clear fixture decision • 0–5 rating • 6–9 color • +/− density • Z fit/fill • Space Quick Look • ⌘Z undo")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .bottomLeading)
        .layoutPriority(2)
    }

    private var cullingDestinationActions: some View {
        HStack {
            Button("Open in Review") { model.sendCullingSelection(to: .review) }
                .disabled(model.cullingSelection.selectedIDs.isEmpty)
                .backstageHelp("Open Review and carry the current Culling selection into that workspace.")
            Button("Send to Metadata") { model.sendCullingSelection(to: .metadata) }
                .disabled(model.cullingSelection.selectedIDs.isEmpty)
                .backstageHelp("Open Metadata and carry the current Culling selection into its editing workflow.")
            Button("Send to Uploads") { model.sendCullingSelection(to: .uploads) }
                .disabled(model.cullingSelection.selectedIDs.isEmpty)
                .backstageHelp("Open Uploads and carry the current Culling selection into the publication tray.")
            Spacer()
        }
    }

    private var cullingDecisionActions: some View {
        FlowLayout(spacing: 8) {
            Text("\(model.cullingSelection.selectedIDs.count) selected")
            cullingPlacementPicker
            Button("Apply fixture decision") {
                Task { await model.applyPickShortcut(model.cullingPickAction) }
            }
            .disabled(
                model.cullingSelection.selectedIDs.isEmpty
                    || model.isApplyingCullingDecision
                    || !model.hasCurrentCullingFixture
            )
            .backstageHelp("Apply the selected Include, Exclude, or Undecided fixture decision to every selected asset.")
            cullingRatingPicker
            Button("Apply rating") {
                Task { await model.applyRating() }
            }
            .disabled(model.cullingSelection.selectedIDs.isEmpty || model.isApplyingCullingDecision)
            .backstageHelp("Apply the chosen star rating to every selected asset.")
            cullingColorPicker
            Button("Apply color") {
                Task { await model.applyColor() }
            }
            .disabled(model.cullingSelection.selectedIDs.isEmpty || model.isApplyingCullingDecision)
            .backstageHelp("Apply the chosen color label to every selected asset.")
            Button("Quick Look") {
                CullingQuickLookPresenter.present(model: model, coordinator: quickLook)
            }
            .keyboardShortcut(.space, modifiers: [])
            .disabled(model.cullingSelection.selectedIDs.isEmpty)
            .backstageHelp("Open the focused selected asset in Quick Look without changing its Culling decision.")
            Button("Export originals…") {
                guard let directory = chooseExportDirectory() else { return }
                Task { await model.exportSelected(to: directory) }
            }
            .disabled(model.cullingSelection.selectedIDs.isEmpty)
            .backstageHelp("Choose a folder and export the original files for all selected assets.")
        }
        .labelsHidden()
    }

    private var cullingPlacementPicker: some View {
        Picker("Fixture decision", selection: $model.cullingPickAction) {
            ForEach(SidecarPickAction.allCases, id: \.self) { action in
                Text(cullingPickLabel(action)).tag(action)
            }
        }
        .frame(width: 180)
    }

    private var cullingRatingPicker: some View {
        Picker("Rating", selection: $model.cullingRating) {
            ForEach(0...5, id: \.self) { rating in
                Text(rating == 0 ? "No rating" : "\(rating) star\(rating == 1 ? "" : "s")")
                    .tag(rating)
            }
        }
        .frame(width: 170)
    }

    private var cullingColorPicker: some View {
        Picker("Color", selection: $model.cullingColor) {
            ForEach(SidecarColor.allCases, id: \.self) {
                Text($0.label).tag($0)
            }
        }
        .frame(width: 145)
    }

    private var cullingHistoryActions: some View {
        HStack {
            Button("Undo") { Task { await model.undoLastCullingDecision() } }
                .keyboardShortcut("z", modifiers: .command)
                .disabled(model.cullingHistory.isEmpty)
                .backstageHelp("Reverse the most recent Culling change made during this Backstage session.")
            cullingHistoryLabel
            Spacer()
            Button("Reload decisions") {
                Task { await model.refreshCullingDecisions() }
            }
            .backstageHelp("Reload the latest persisted ratings, colors, and fixture decisions for the visible assets.")
            Button("Clear selection") { model.clearCullingSelection() }
                .disabled(model.cullingSelection.selectedIDs.isEmpty)
                .backstageHelp("Deselect every currently selected Culling asset without changing any decisions.")
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

    private func cullingPickLabel(_ action: SidecarPickAction) -> String {
        switch action {
        case .pick: "Include"
        case .reject: "Exclude"
        case .unpick: "Undecided"
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
                    ?? model.flatFixtures.first(where: { $0.id == model.cullingFixtureID })?.name
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
            model.cullingFixtureID,
            model.cullingViews.map(\.rawValue).sorted().joined(separator: ","),
            String(model.cullingWorkspace.offset),
            model.visibleCullingAssets.first?.id ?? "empty",
        ].joined(separator: ":")
    }

    private var cullingHeaderActions: some View {
        HStack {
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
            Button("Refresh previews") {
                Task {
                    await model.refreshPhotos()
                    if !model.cullingFixtureID.isEmpty {
                        await model.loadFixtureCullingWindow()
                    }
                }
            }
            .disabled(model.isLoadingPhotos || model.isReconcilingPhotosIndex)
            .backstageHelp("Refresh local Photos previews and then reload the active fixture Culling window.")
            Button {
                Task { await model.reconcilePhotosLibraryIndex() }
            } label: {
                if model.isReconcilingPhotosIndex {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Reconciling complete Photos library")
                } else {
                    Text("Reconcile library")
                }
            }
            .disabled(model.isLoadingPhotos || model.isReconcilingPhotosIndex)
            .backstageHelp("Stream the complete Photos library through the signed helper and reconcile Owner without changing existing decisions.")
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
            metadataRow("Original size", value: formattedOriginalSize(asset.originalByteCount))
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

    private func formattedOriginalSize(_ byteCount: Int64) -> String {
        guard byteCount > 0 else {
            return "Unavailable without requesting the original; it may be cloud-only."
        }
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
                Task { await model.tombstoneCullingSelection() }
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

private struct CullingAssetCard: View {
    var asset: FixtureAsset
    var state: SidecarDecisionState?
    var thumbnail: NSImage?
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
                } else {
                    Image(systemName: asset.mediaType == "video" ? "video" : "photo")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
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

private struct LightroomRatingFilterButton: View {
    let rating: Int
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if rating == 0 {
                    Image(systemName: "star.slash")
                } else {
                    Image(systemName: "star.fill")
                }
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(isSelected ? Color.yellow : Color.secondary)
            .frame(width: 22, height: 22)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(isSelected ? Color.accentColor.opacity(0.24) : .clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5)
                    .stroke(isSelected ? Color.accentColor.opacity(0.8) : .clear)
            )
        }
        .buttonStyle(.plain)
        .backstageHelp(rating == 0
            ? "Toggle whether unrated assets are included in the current Culling results."
            : "Toggle whether \(rating)-star assets are included in the current Culling results.")
        .accessibilityLabel(rating == 0 ? "Unrated" : "\(rating) stars")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
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
            .padding(2)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(isSelected ? Color.accentColor.opacity(0.35) : .clear)
            )
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
