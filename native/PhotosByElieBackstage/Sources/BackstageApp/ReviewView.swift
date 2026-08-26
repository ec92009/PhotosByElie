import AppKit
import OwnerCore
import SwiftUI

/// The production title and keyword Review workspace and its Canvas-selectable implementation.
///
/// Synthetic fixtures live in `ReviewPreview.swift`; automatic work stays disabled in Canvas.
@MainActor
private enum ReviewQuickLookPresenter {
    static func present(
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator,
        direction: OwnerSelectionDirection = .next
    ) {
        let ids = model.selectedReviewAssetIDs
        guard !ids.isEmpty else {
            model.reviewStatus = "Select one Review item before opening Quick Look."
            return
        }
        guard ids.count == 1 else {
            model.reviewStatus = "Quick Look opens one selected Review item at a time."
            return
        }
        let presentationID = coordinator.beginPresentation()
        Task { [weak model, weak coordinator] in
            guard let model, let coordinator else { return }
            let urls = await model.prepareReviewQuickLookURLs()
            guard coordinator.isCurrentPresentation(presentationID) else { return }
            let prepared = zip(ids, urls).compactMap { assetID, url in
                metadata(for: assetID, model: model).map { (url, $0) }
            }
            guard !prepared.isEmpty else { return }
            coordinator.present(
                urls: prepared.map(\.0),
                metadata: prepared.map(\.1),
                presentation: presentationID,
                onShortcut: { [weak model, weak coordinator] shortcut, assetID in
                    guard let model, let coordinator, !model.isRunningReview else {
                        return false
                    }
                    if BackstageQuickLookDecisionRouter.handle(
                        shortcut,
                        assetID: assetID,
                        model: model,
                        coordinator: coordinator
                    ) {
                        return true
                    }
                    switch shortcut {
                    case .previous, .previousRow:
                        navigate(
                            direction: .previous,
                            from: assetID,
                            model: model,
                            coordinator: coordinator
                        )
                    case .next, .nextRow:
                        navigate(
                            direction: .next,
                            from: assetID,
                            model: model,
                            coordinator: coordinator
                        )
                    case .approve:
                        applyReviewAction(
                            .approve,
                            assetID: assetID,
                            model: model,
                            coordinator: coordinator,
                            removalDirection: direction
                        )
                    case .hide:
                        applyReviewAction(
                            .hide,
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
                    case .unpick:
                        model.clickReviewItem(assetID, modifiers: [])
                        coordinator.dismiss()
                        Task { [weak model] in await model?.unpickReviewSelection() }
                    case .undo:
                        guard !model.reviewHistory.isEmpty else { return false }
                        coordinator.dismiss()
                        Task { [weak model] in await model?.undoLastReviewAction() }
                    case .pick, .returnToReview, .rating, .color:
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
        model.clickReviewItem(assetID, modifiers: [])
        model.moveReviewSelection(
            by: direction == .previous ? -1 : 1,
            extending: false
        )
        guard model.focusedReviewItem?.id != assetID, coordinator.isVisible else { return }
        present(model: model, coordinator: coordinator, direction: direction)
    }

    private static func applyReviewAction(
        _ action: FixtureReviewAction,
        assetID: String,
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator,
        removalDirection: OwnerSelectionDirection
    ) {
        let wasVisible = model.reviewItems.contains { $0.id == assetID }
        model.clickReviewItem(assetID, modifiers: [])
        Task { [weak model, weak coordinator] in
            guard let model, let coordinator else { return }
            await model.applyReviewAction(
                action,
                removalDirection: removalDirection
            )
            guard coordinator.isVisible else { return }
            let remainsVisible = model.reviewItems.contains { $0.id == assetID }
            if wasVisible && !remainsVisible {
                if model.focusedReviewItem == nil {
                    coordinator.dismiss()
                } else {
                    present(
                        model: model,
                        coordinator: coordinator,
                        direction: removalDirection
                    )
                }
            } else if let item = metadata(for: assetID, model: model) {
                coordinator.updateMetadata(item)
            }
        }
    }

    private static func applyWasteBasket(
        assetID: String,
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator,
        removalDirection: OwnerSelectionDirection
    ) {
        model.clickReviewItem(assetID, modifiers: [])
        Task { [weak model, weak coordinator] in
            guard let model, let coordinator else { return }
            await model.moveReviewSelectionToWasteBasket(
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

    private static func metadata(
        for assetID: String,
        model: BackstageViewModel
    ) -> BackstageQuickLookMetadata? {
        guard let item = model.reviewItems.first(where: { $0.id == assetID }) else {
            return nil
        }
        let draft = model.reviewProposalDrafts[assetID]
        let state = item.placementState == "hidden" ? item.placementState : item.editorialState
        return BackstageQuickLookMetadata(
            assetID: assetID,
            filename: item.filename,
            title: draft?.title ?? item.title,
            keywords: draft?.keywords ?? item.keywords,
            locationLabel: item.locationLabel,
            capturedAt: item.capturedAt,
            sourceSize: BackstageQuickLookSourceSize(
                mediaType: item.mediaType,
                pixelWidth: item.pixelWidth,
                pixelHeight: item.pixelHeight,
                byteCount: item.originalByteCount,
                currentImageByteCount: model.currentImageByteCount(for: assetID)
            ),
            rating: item.rating,
            color: item.color,
            state: state,
            shortcutHint: "Shortcuts: ←/→/↑/↓ navigate • A approve • H hide • X Waste Basket • U unpick • \(BackstageQuickLookDecisionRouter.shortcutHint) • ⌘Z undo"
        )
    }
}

private struct ReviewVisualComparisonTarget: Identifiable {
    let id: String
}

struct ReviewView: View {
    @ObservedObject var model: BackstageViewModel
    var isPreviewMode = false
    @StateObject private var quickLook = BackstageQuickLookCoordinator()
    @State private var visualComparisonTarget: ReviewVisualComparisonTarget?

    private func openReviewPreview() {
        if model.isREReviewScope {
            guard let item = model.focusedReviewItem else {
                model.reviewStatus = "Select a Review item before opening comparison."
                return
            }
            visualComparisonTarget = ReviewVisualComparisonTarget(id: item.id)
        } else {
            ReviewQuickLookPresenter.present(model: model, coordinator: quickLook)
        }
    }

    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 10) {
                    ViewThatFits(in: .horizontal) {
                        HStack {
                            reviewHeading
                            Spacer()
                            reviewScopeControls
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            reviewHeading
                            reviewScopeControls
                        }
                    }
                    HStack {
                        TextField("Search complete Review queue", text: $model.reviewSearch)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit {
                                model.reviewWindowOffset = 0
                                Task { await model.loadFixtureReviewWindow() }
                            }
                        Button("Search") {
                            model.reviewWindowOffset = 0
                            Task { await model.loadFixtureReviewWindow() }
                        }
                        .backstageHelp("Run the current search across the complete Review queue and return to its first page.")
                        Button("Refresh") {
                            Task { await model.loadFixtureReviewWindow() }
                        }
                        .disabled(model.isRunningReview)
                        .backstageHelp("Reload the current Review page, filters, proposals, and persisted states from Owner.")
                        Button("Select burst") {
                            model.selectReviewBurstCandidates()
                        }
                        .disabled(!model.canSelectReviewBurstCandidates)
                        .backstageHelp("Select likely duplicate frames in each current Review capture burst while keeping the probable best frame unselected. This changes selection only; choose Hide to apply the audited Review action.")
                    }
                }
                if let summary = model.fixtureReviewWindow?.summary {
                    FlowLayout(spacing: 10) {
                        Text("\(summary.total.formatted()) matching")
                        Text("\(summary.unreviewed.formatted()) unreviewed")
                        Text("\(summary.requestingAI.formatted()) requesting AI")
                        Text("\(summary.proposed.formatted()) proposed")
                        if model.reviewMode == .full {
                            Text("\(summary.approved.formatted()) approved")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                HStack(spacing: 10) {
                    if model.readyAIProposalCount > 0 {
                        Label(
                            "\(model.readyAIProposalCount.formatted()) proposal\(model.readyAIProposalCount == 1 ? "" : "s") available",
                            systemImage: "sparkles"
                        )
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.orange)
                    }
                    if !model.reviewProposalConflictIDs.isEmpty {
                        Button("Replace \(model.reviewProposalConflictIDs.count) conflicting draft\(model.reviewProposalConflictIDs.count == 1 ? "" : "s")") {
                            Task { await model.loadAIProposals(replacingConflicts: true) }
                        }
                        .tint(.orange)
                        .backstageHelp("Replace the listed local conflicting drafts with the latest completed AI proposals.")
                    }
                    Spacer()
                    Button(model.isRunningAIPass ? "AI pass running…" : "Run AI pass now") {
                        Task { await model.runAIProposalPass() }
                    }
                    .disabled(!model.canRunAIProposalPass)
                    .backstageHelp("Start the prepared AI proposal pass for assets currently requesting AI review.")
                    if model.fixtureAIStatus?.active == true {
                        Button("Cancel") {
                            Task { await model.cancelAIProposalPass() }
                        }
                        .backstageHelp("Request cancellation of the AI proposal pass currently in progress.")
                    }
                }
                BackstageFeedbackView(
                    message: model.aiProposalStatus,
                    isWorking: model.isRunningAIPass || model.fixtureAIStatus?.active == true
                )
                if let run = model.fixtureAIStatus?.run, model.fixtureAIStatus?.active == true {
                    ProgressView(
                        value: Double(run.processed),
                        total: Double(max(1, run.requested))
                    )
                }
                HStack(spacing: 10) {
                    if let window = model.fixtureReviewWindow {
                        let first = window.items.isEmpty ? 0 : window.offset + 1
                        let last = window.offset + window.items.count
                        Text("\(first.formatted())–\(last.formatted()) of \(window.summary.total.formatted())")
                            .font(.callout.weight(.semibold))
                            .monospacedDigit()
                    } else if model.isRunningReview {
                        Text("Loading Review queue…")
                            .font(.callout.weight(.semibold))
                    } else {
                        Text("Review queue unavailable")
                            .font(.callout.weight(.semibold))
                    }
                    Spacer()
                    Button("Previous \(model.reviewWindowLimit)") {
                        model.moveReviewWindow(forward: false)
                    }
                    .disabled((model.fixtureReviewWindow?.offset ?? 0) == 0)
                    .backstageHelp("Load the previous \(model.reviewWindowLimit) matching items in the Review queue.")
                    Button("Next \(model.reviewWindowLimit)") {
                        model.moveReviewWindow(forward: true)
                    }
                    .disabled(!(model.fixtureReviewWindow?.hasNext ?? false))
                    .backstageHelp("Load the next \(model.reviewWindowLimit) matching items in the Review queue.")
                }
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(model.reviewItems) { item in
                                ReviewAssetRow(
                                    item: item,
                                    proposalDraft: model.reviewProposalDrafts[item.id],
                                    thumbnail: model.reviewThumbnails[item.id],
                                    isSelected: model.reviewSelection.selectedIDs.contains(item.id),
                                    isFocused: model.reviewSelection.focusedID == item.id,
                                    hasDraftAIReason: false,
                                    hasProposalDraft: model.hasProposalDraft(for: item.id),
                                    hasProposalConflict: model.reviewProposalConflictIDs.contains(item.id)
                                )
                                .id(item.id)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    model.clickReviewItem(item.id, modifiers: NSEvent.modifierFlags)
                                }
                                .onAppear {
                                    guard !isPreviewMode else { return }
                                    model.requestReviewThumbnail(for: item)
                                }
                            }
                        }
                        .padding(6)
                    }
                    .focusable()
                    .onChange(of: model.reviewScrollTargetID) { _, target in
                        guard let target else { return }
                        proxy.scrollTo(target, anchor: .center)
                    }
                    .onMoveCommand { direction in
                        let extending = NSEvent.modifierFlags.contains(.shift)
                        switch direction {
                        case .up, .left:
                            model.moveReviewSelection(by: -1, extending: extending)
                        case .down, .right:
                            model.moveReviewSelection(by: 1, extending: extending)
                        default:
                            return
                        }
                    }
                    .onKeyPress("a", phases: .down) { press in
                        if press.modifiers.contains(.command) {
                            model.selectAllReviewItems()
                        } else {
                            Task { await model.applyReviewAction(.approve) }
                        }
                        return .handled
                    }
                    .onKeyPress("h") {
                        Task { await model.applyReviewAction(.hide) }
                        return .handled
                    }
                    .onKeyPress("x") {
                        Task { await model.moveReviewSelectionToWasteBasket() }
                        return .handled
                    }
                    .onKeyPress("b") {
                        model.selectReviewBurstCandidates()
                        return .handled
                    }
                    .onKeyPress("u") {
                        Task { await model.unpickReviewSelection() }
                        return .handled
                    }
                    .onKeyPress(.space) {
                        openReviewPreview()
                        return .handled
                    }
                    .overlay {
                        if model.isRunningReview, model.fixtureReviewWindow == nil {
                            VStack(spacing: 12) {
                                ProgressView()
                                    .controlSize(.large)
                                Text("Loading Review queue…")
                                    .fixedSize(horizontal: true, vertical: false)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else if !model.isRunningReview,
                                  model.fixtureReviewWindow != nil,
                                  model.reviewItems.isEmpty {
                            ContentUnavailableView(
                                "Review queue is clear",
                                systemImage: "checkmark.circle",
                                description: Text("Picked photos appear here until approved or hidden.")
                            )
                        }
                    }
                }
                .frame(minHeight: 360, maxHeight: .infinity)
                HStack {
                    Text("\(model.reviewSelection.selectedIDs.count) selected")
                    Spacer()
                    Button("Undo") {
                        Task { await model.undoLastReviewAction() }
                    }
                    .keyboardShortcut("z", modifiers: .command)
                    .disabled(
                        model.reviewHistory.isEmpty
                            || model.isRunningReview
                            || model.reviewWasteBasketQueueing
                            || model.reviewUndoIsBlockedByPendingWasteBasketAction
                    )
                    .backstageHelp("Reverse the most recent Review action made during this Backstage session.")
                    Button("Clear selection") { model.clearReviewSelection() }
                        .disabled(model.reviewSelection.selectedIDs.isEmpty)
                        .backstageHelp("Deselect every Review item without changing titles, keywords, or workflow states.")
                }
                    BackstageFeedbackView(
                        message: model.reviewStatus,
                        isWorking: model.isRunningReview
                            || model.reviewWasteBasketQueueing
                            || model.reviewWasteBasketPendingActionID != nil
                            || model.isRunningAIPass,
                        autoDismissAfter: .seconds(4)
                    )
            }
            .padding()
            .frame(minWidth: 480)

            if model.isPreviewPanelVisible {
                ReviewInspector(
                    model: model,
                    openQuickLook: {
                        openReviewPreview()
                    }
                )
                    .frame(minWidth: 300, idealWidth: 380, maxWidth: 480)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .background(SplitViewAutosaver(name: "PhotosByElieBackstage.ReviewSplit"))
        .animation(.snappy(duration: 0.24), value: model.isPreviewPanelVisible)
        .onAppear {
            quickLook.activate()
        }
        .onDisappear {
            quickLook.deactivate()
        }
        .sheet(item: $visualComparisonTarget) { target in
            if let item = model.reviewItems.first(where: { $0.id == target.id }) {
                VisualRepairComparisonView(
                    item: item,
                    original: model.reviewThumbnails[item.id],
                    proposal: model.reviewVisualProposals[item.id]
                )
            } else {
                ContentUnavailableView(
                    "Comparison unavailable",
                    systemImage: "photo.on.rectangle.angled",
                    description: Text("The Review item is no longer in the current window.")
                )
            }
        }
        .task {
            guard !isPreviewMode else { return }
            if model.fixtures.isEmpty {
                await model.loadFixtures()
            }
            await model.loadFixtureReviewWindow()
            await model.restoreLoadedAIProposalDrafts()
            await model.refreshAIStatus()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled else { break }
                await model.refreshReviewAIAvailability()
            }
        }
    }

    private var reviewHeading: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Review")
                .font(.largeTitle.bold())
            Text(
                model.selectedFixtureBreadcrumb.isEmpty
                    ? "Fixture unavailable"
                    : "\(model.selectedFixtureBreadcrumb) • Oldest picked photos first"
            )
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var reviewScopeControls: some View {
        FlowLayout(spacing: 10) {
            Text("State")
                .font(.callout.weight(.semibold))
            ForEach(FixtureReviewStateFilter.allCases) { filter in
                Toggle(
                    filter.label,
                    isOn: Binding(
                        get: { model.reviewStateFilters.contains(filter) },
                        set: { _ in model.toggleReviewStateFilter(filter) }
                    )
                )
                .toggleStyle(.checkbox)
            }
            Toggle(
                "Proposal Available",
                isOn: Binding(
                    get: { model.reviewProposalAvailableOnly },
                    set: { model.setReviewProposalAvailableOnly($0) }
                )
            )
            .toggleStyle(.checkbox)
        }
    }
}

private struct ReviewAssetRow: View {
    var item: FixtureReviewItem
    var proposalDraft: ReviewMetadataDraft?
    var thumbnail: NSImage?
    var isSelected: Bool
    var isFocused: Bool
    var hasDraftAIReason: Bool
    var hasProposalDraft: Bool
    var hasProposalConflict: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if let thumbnail {
                    Image(nsImage: thumbnail)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .saturation(item.placementState == "hidden" ? 0 : 1)
                } else {
                    Image(systemName: item.mediaType == "video" ? "video" : "photo")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 180, height: 126)
            .background(.quaternary.opacity(0.4))
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .overlay(alignment: .topTrailing) {
                reviewStateBadge
                    .padding(8)
            }
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Text(item.filename)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer()
                    Text(item.rating > 0 ? String(repeating: "★", count: item.rating) : "☆")
                    Circle()
                        .fill(reviewColor(item.color))
                        .overlay(Circle().stroke(.secondary.opacity(0.5)))
                        .frame(width: 12, height: 12)
                }
                Text(item.capturedAt)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack(alignment: .top, spacing: 12) {
                    reviewMetadataColumn(
                        label: "Current",
                        title: item.title.isEmpty ? "Untitled" : item.title,
                        keywords: item.keywords.isEmpty
                            ? "No keywords"
                            : item.keywords.joined(separator: ", "),
                        isProposal: false
                    )
                    Divider()
                    reviewMetadataColumn(
                        label: "Proposed",
                        title: proposalTitle,
                        keywords: proposalKeywords,
                        isProposal: proposalDraft?.isProposal == true
                    )
                }
                HStack {
                    Text(item.editorialState.replacingOccurrences(of: "-", with: " ").capitalized)
                    if item.editorialState == "requesting-ai" {
                        Text("• \(item.aiReasons.count) reason\(item.aiReasons.count == 1 ? "" : "s")")
                    }
                    if hasProposalDraft {
                        Label(
                            proposalDraft?.isHistoricalProposal == true
                                ? "Previous proposal"
                                : "Proposal draft",
                            systemImage: proposalDraft?.isHistoricalProposal == true
                                ? "clock.arrow.circlepath"
                                : "sparkles"
                        )
                    }
                    if hasProposalConflict {
                        Label("Manual draft kept", systemImage: "exclamationmark.triangle.fill")
                    }
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(
                    item.editorialState == "requesting-ai" || hasProposalDraft || hasProposalConflict
                        ? .orange
                        : .secondary
                )
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(isSelected ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.06))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(isFocused ? Color.accentColor : .clear, lineWidth: 3)
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var proposalTitle: String {
        guard let proposalDraft else { return "No proposal" }
        return proposalDraft.title.isEmpty ? "Untitled" : proposalDraft.title
    }

    private var proposalKeywords: String {
        guard let proposalDraft else { return "—" }
        return proposalDraft.keywords.isEmpty
            ? "No keywords"
            : proposalDraft.keywords.joined(separator: ", ")
    }

    private func reviewMetadataColumn(
        label: String,
        title: String,
        keywords: String,
        isProposal: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(label)
                    .font(.caption2.weight(.bold))
                    .textCase(.uppercase)
                if isProposal {
                    Image(systemName: "sparkles")
                }
            }
            .foregroundStyle(isProposal ? .orange : .secondary)
            Text(title)
                .font(.callout.weight(.semibold))
                .lineLimit(2)
            Text(keywords)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var reviewStateBadge: some View {
        if hasDraftAIReason || item.editorialState == "requesting-ai" {
            Image(systemName: "questionmark.circle.fill")
                .font(.system(size: 30, weight: .bold))
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, .orange)
                .accessibilityLabel("Marked for AI review")
        } else if item.editorialState == "approved" {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 30, weight: .bold))
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, .green)
                .accessibilityLabel("Approved")
        }
    }

    private func reviewColor(_ value: String) -> Color {
        switch value {
        case "red": .red
        case "yellow": .yellow
        case "green": .green
        case "blue": .blue
        default: .clear
        }
    }
}

private struct VisualRepairComparisonView: View {
    let item: FixtureReviewItem
    let original: NSImage?
    let proposal: VisualRepairProposal?
    @Environment(\.dismiss) private var dismiss

    private var proposedImage: NSImage? {
        guard let proposal,
              proposal.derivedAvailable,
              VisualRepairComparisonState.isRenderableReference(proposal.derivedReference),
              let url = URL(string: proposal.derivedReference)
        else {
            return nil
        }
        return NSImage(contentsOf: url)
    }

    private var state: VisualRepairComparisonState {
        let originalReference = item.sourceVersionID.isEmpty
            ? "immutable-source-asset://\(item.id)"
            : "immutable-source-version://\(item.sourceVersionID)"
        return VisualRepairComparisonState(
            originalReference: originalReference,
            proposal: proposal,
            proposedImageAvailable: proposedImage != nil
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Visual repair comparison")
                        .font(.title2.bold())
                    Text(item.filename)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("Read only")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Button("Close") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .backstageHelp("Close the read-only visual repair comparison without changing the Review item.")
            }

            HStack(alignment: .top, spacing: 12) {
                comparisonPanel(
                    title: "Original · immutable",
                    image: original,
                    symbol: "photo",
                    detail: state.originalReference,
                    accessibility: "Original immutable source image"
                )
                comparisonPanel(
                    title: "Proposed · draft only",
                    image: proposedImage,
                    symbol: state.proposalAvailable ? "sparkles" : "questionmark.circle",
                    detail: state.proposalAvailable
                        ? state.proposedReference
                        : "No rendered proposal is available",
                    accessibility: "Proposed visual repair draft, read only"
                )
            }

            if let proposal {
                Text(proposal.defectCategories.map(\.label).joined(separator: " · "))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                Text("Attempt \(proposal.attempt) · \(proposal.resolvedModel) · \(proposal.reasoningEffort) · \(proposal.status.rawValue)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(state.message)
                .font(.callout)
                .foregroundStyle(.secondary)
            Text("This comparison cannot edit the original, title, keywords, rating, fixture decision, upload, or publication state.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(22)
        .frame(minWidth: 760, minHeight: 470)
        .accessibilityElement(children: .contain)
    }

    private func comparisonPanel(
        title: String,
        image: NSImage?,
        symbol: String,
        detail: String,
        accessibility: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            Group {
                if let image {
                    Image(nsImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                } else {
                    VStack(spacing: 10) {
                        Image(systemName: symbol)
                            .font(.system(size: 36))
                        Text(detail)
                            .font(.caption)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 250)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 250, maxHeight: 300)
            .background(.quaternary.opacity(0.35))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .accessibilityLabel(accessibility)
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ReviewInspector: View {
    @ObservedObject var model: BackstageViewModel
    let openQuickLook: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Editorial")
                    .font(.title2.bold())
                if let item = model.focusedReviewItem {
                    if let thumbnail = model.reviewThumbnails[item.id] {
                        Image(nsImage: thumbnail)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .saturation(item.placementState == "hidden" ? 0 : 1)
                            .frame(maxHeight: 240)
                            .frame(maxWidth: .infinity)
                            .background(.quaternary.opacity(0.35))
                            .clipShape(RoundedRectangle(cornerRadius: 9))
                            .overlay(alignment: .topTrailing) {
                                if !model.reviewAIReasons.isEmpty
                                    || item.editorialState == "requesting-ai" {
                                    Image(systemName: "questionmark.circle.fill")
                                        .font(.system(size: 30, weight: .bold))
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .orange)
                                        .padding(8)
                                } else if item.editorialState == "approved" {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 30, weight: .bold))
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .green)
                                        .padding(8)
                                }
                            }
                    }
                    Text(item.filename)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    ReviewTitleKeywordEditor(model: model)
                    if let proposal = model.reviewProposalDrafts[item.id], proposal.isProposal {
                        Label(
                            proposal.isHistoricalProposal
                                ? "Previous proposal kept while AI revises it"
                                : (
                                    proposal.proposalReason.isEmpty
                                        ? "AI proposal loaded as an editable draft"
                                        : proposal.proposalReason
                                ),
                            systemImage: proposal.isHistoricalProposal
                                ? "clock.arrow.circlepath"
                                : "sparkles"
                        )
                        .font(.caption)
                        .foregroundStyle(.orange)
                        if !proposal.resolvedModel.isEmpty || !proposal.reasoningEffort.isEmpty {
                            Text("Used \(proposal.resolvedModel.isEmpty ? proposal.requestedGeneratorModel : proposal.resolvedModel) · \(proposal.reasoningEffort.isEmpty ? "effort unknown" : proposal.reasoningEffort) · \(proposal.vision ? "vision" : "text")")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Divider()
                    HStack {
                        Button("Approve") {
                            Task { await model.applyReviewAction(.approve) }
                        }
                        .keyboardShortcut("a", modifiers: [])
                        .backstageHelp("Approve the selected title and keywords and make the assets eligible for Uploads.")
                        Button("Hide") {
                            Task { await model.applyReviewAction(.hide) }
                        }
                        .keyboardShortcut("h", modifiers: [])
                        .backstageHelp("Hide the selected assets from this fixture without deleting their files.")
                        Button("Waste Basket") {
                            Task { await model.moveReviewSelectionToWasteBasket() }
                        }
                        .disabled(
                            model.isRunningReview
                                || model.reviewWasteBasketQueueing
                        )
                        .keyboardShortcut("x", modifiers: [])
                        .backstageHelp("Move the selected Review assets to the recoverable Waste Basket through the shared lifecycle gateway.")
                        Button("Unpick") {
                            Task { await model.unpickReviewSelection() }
                        }
                        .keyboardShortcut("u", modifiers: [])
                        .backstageHelp("Clear the fixture pick and return the selected assets to Culling as Undecided.")
                        Button("Needs AI") {
                            Task { await model.markReviewSelectionNeedsAI() }
                        }
                        .disabled(!model.canMarkReviewSelectionNeedsAI)
                        .backstageHelp("Submit the selected AI-review reasons and optional note for the selected assets.")
                    }
                    .buttonStyle(.borderedProminent)
                    HStack(spacing: 8) {
                        BackstageFeedbackView(
                            message: model.reviewStatus,
                            isWorking: model.isRunningReview
                                || model.reviewWasteBasketQueueing
                                || model.reviewWasteBasketPendingActionID != nil
                                || model.isRunningAIPass,
                            autoDismissAfter: .seconds(4)
                        )
                    }
                    Divider()
                    Text("Mark for AI review")
                        .font(.headline)
                    FlowLayout(spacing: 6) {
                        ForEach(model.reviewAIReasonChoices, id: \.self) { reason in
                            Button {
                                model.toggleReviewAIReason(reason)
                            } label: {
                                Label(
                                    reason,
                                    systemImage: model.reviewAIReasons.contains(reason)
                                        ? "checkmark.circle.fill"
                                        : "circle"
                                )
                            }
                            .buttonStyle(.bordered)
                            .tint(model.reviewAIReasons.contains(reason) ? .orange : nil)
                            .backstageHelp("Toggle the \(reason) reason for the next Needs AI request.")
                        }
                    }
                    TextField(
                        "Optional AI note",
                        text: Binding(
                            get: { model.reviewAINote },
                            set: { model.updateReviewAINote($0) }
                        ),
                        axis: .vertical
                    )
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(2...5)
                    Text("Prepare the reasons and optional note, then press Needs AI for the selection.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if model.isREReviewScope {
                        Divider()
                        Text("Visual repair drafts")
                            .font(.headline)
                        FlowLayout(spacing: 6) {
                            ForEach(VisualRepairDefectCategory.allCases) { category in
                                Button {
                                    model.toggleVisualRepairCategory(category)
                                } label: {
                                    Label(
                                        category.label,
                                        systemImage: model.visualRepairDefectCategories.contains(category)
                                            ? "checkmark.circle.fill"
                                            : "circle"
                                    )
                                }
                                .buttonStyle(.bordered)
                                .tint(model.visualRepairDefectCategories.contains(category) ? .orange : nil)
                                .backstageHelp("Select the \(category.label) defect category for a future visual repair draft.")
                            }
                        }
                        if let proposal = model.reviewVisualProposals[item.id] {
                            let hasRenderedProposal = proposal.derivedAvailable
                                && VisualRepairComparisonState.isRenderableReference(proposal.derivedReference)
                            Label(
                                hasRenderedProposal
                                    ? "Draft available for read-only comparison · attempt \(proposal.attempt)"
                                    : "Draft recorded; rendered comparison unavailable · attempt \(proposal.attempt)",
                                systemImage: hasRenderedProposal ? "sparkles" : "questionmark.circle"
                            )
                            .font(.caption)
                            .foregroundStyle(.orange)
                            if proposal.status == .draft {
                                HStack(spacing: 8) {
                                    Button("Accept draft") {
                                        Task { await model.decideVisualRepair(.accept, for: item.id) }
                                    }
                                    .disabled(!hasRenderedProposal)
                                    .backstageHelp("Record acceptance of this visual draft only; it will not replace the source or change title, keywords, delivery, or publication.")
                                    Button("Reject draft") {
                                        Task { await model.decideVisualRepair(.reject, for: item.id) }
                                    }
                                    .backstageHelp("Reject and hide this derived visual reference while retaining its audit provenance.")
                                    Button("Regenerate unavailable") {}
                                        .disabled(true)
                                        .backstageHelp("Regeneration stays unavailable until a privacy-reviewed visual generator is configured.")
                                }
                                .buttonStyle(.bordered)
                            }
                        } else {
                            Text("No visual draft is available for this source version.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Button("Request visual draft unavailable") {}
                            .disabled(true)
                            .backstageHelp("Production visual generation is not configured. Synthetic generation is test-only and never processes real private source media.")
                        Text(model.visualRepairStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Divider()
                    Button(model.isREReviewScope ? "Compare original / proposal" : "Quick Look") {
                        openQuickLook()
                    }
                    .keyboardShortcut(.space, modifiers: [])
                    .backstageHelp(
                        model.isREReviewScope
                            ? "Open a read-only original versus visual proposal comparison without applying a Review action."
                            : "Open the focused Review item in Quick Look without applying a Review action."
                    )
                } else {
                    ContentUnavailableView(
                        "No photo selected",
                        systemImage: "photo",
                        description: Text("Select a Review row to edit its title and keywords.")
                    )
                }
            }
            .padding()
        }
    }
}

#if DEBUG
#Preview("Review — Loaded") {
    ReviewView(
        model: ReviewPreviewFixtures.loaded(),
        isPreviewMode: true
    )
    .frame(width: 1_440, height: 900)
}
#endif
