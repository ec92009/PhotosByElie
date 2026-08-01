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
        coordinator: BackstageQuickLookCoordinator
    ) {
        let ids = model.selectedReviewAssetIDs
        guard !ids.isEmpty else { return }
        Task { [weak model, weak coordinator] in
            guard let model, let coordinator else { return }
            let urls = await model.prepareReviewQuickLookURLs()
            let prepared = zip(ids, urls).compactMap { assetID, url in
                metadata(for: assetID, model: model).map { (url, $0) }
            }
            guard !prepared.isEmpty else { return }
            coordinator.present(
                urls: prepared.map(\.0),
                metadata: prepared.map(\.1),
                onShortcut: { [weak model, weak coordinator] shortcut, assetID in
                    guard let model, let coordinator, !model.isRunningReview else {
                        return false
                    }
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
                    case .approve:
                        applyReviewAction(
                            .approve,
                            assetID: assetID,
                            model: model,
                            coordinator: coordinator
                        )
                    case .hide:
                        applyReviewAction(
                            .hide,
                            assetID: assetID,
                            model: model,
                            coordinator: coordinator
                        )
                    case .unpick:
                        model.clickReviewItem(assetID, modifiers: [])
                        coordinator.dismiss()
                        Task { [weak model] in await model?.unpickReviewSelection() }
                    case .pick, .rating, .color:
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
        model.clickReviewItem(assetID, modifiers: [])
        model.moveReviewSelection(by: delta, extending: false)
        guard model.focusedReviewItem?.id != assetID, coordinator.isVisible else { return }
        present(model: model, coordinator: coordinator)
    }

    private static func applyReviewAction(
        _ action: FixtureReviewAction,
        assetID: String,
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator
    ) {
        let wasVisible = model.reviewItems.contains { $0.id == assetID }
        model.clickReviewItem(assetID, modifiers: [])
        Task { [weak model, weak coordinator] in
            guard let model, let coordinator else { return }
            await model.applyReviewAction(action)
            guard coordinator.isVisible else { return }
            let remainsVisible = model.reviewItems.contains { $0.id == assetID }
            if wasVisible && !remainsVisible {
                if model.focusedReviewItem == nil {
                    coordinator.dismiss()
                } else {
                    present(model: model, coordinator: coordinator)
                }
            } else if let item = metadata(for: assetID, model: model) {
                coordinator.updateMetadata(item)
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
            capturedAt: item.capturedAt,
            rating: item.rating,
            color: item.color,
            state: state,
            shortcutHint: "Shortcuts: ←/→ navigate • A approve • H hide • U unpick"
        )
    }
}

struct ReviewView: View {
    @ObservedObject var model: BackstageViewModel
    var isPreviewMode = false
    @StateObject private var quickLook = BackstageQuickLookCoordinator()

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
                            "\(model.readyAIProposalCount.formatted()) new proposal\(model.readyAIProposalCount == 1 ? "" : "s") ready",
                            systemImage: "sparkles"
                        )
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.orange)
                        Button("Load proposals") {
                            Task { await model.loadAIProposals() }
                        }
                        .backstageHelp("Load newly completed AI title and keyword proposals as editable Review drafts.")
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
                Text(model.aiProposalStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
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
                    .onKeyPress("u") {
                        Task { await model.unpickReviewSelection() }
                        return .handled
                    }
                    .onKeyPress(.space) {
                        ReviewQuickLookPresenter.present(model: model, coordinator: quickLook)
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
                    .disabled(model.reviewHistory.isEmpty || model.isRunningReview)
                    .backstageHelp("Reverse the most recent Review action made during this Backstage session.")
                    Button("Clear selection") { model.clearReviewSelection() }
                        .disabled(model.reviewSelection.selectedIDs.isEmpty)
                        .backstageHelp("Deselect every Review item without changing titles, keywords, or workflow states.")
                }
                Text(model.reviewStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding()
            .frame(minWidth: 480)

            if model.isPreviewPanelVisible {
                ReviewInspector(
                    model: model,
                    openQuickLook: {
                        ReviewQuickLookPresenter.present(model: model, coordinator: quickLook)
                    }
                )
                    .frame(minWidth: 300, idealWidth: 380, maxWidth: 480)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .background(SplitViewAutosaver(name: "PhotosByElieBackstage.ReviewSplit"))
        .animation(.snappy(duration: 0.24), value: model.isPreviewPanelVisible)
        .task {
            guard !isPreviewMode else { return }
            if model.fixtures.isEmpty {
                await model.loadFixtures()
            }
            if model.reviewFixtureID.isEmpty {
                model.reviewFixtureID = model.cullingFixtureID
            }
            await model.loadFixtureReviewWindow()
            await model.restoreLoadedAIProposalDrafts()
            await model.refreshAIStatus()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled else { break }
                await model.refreshAIStatus()
            }
        }
    }

    private var reviewHeading: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Review")
                .font(.largeTitle.bold())
            Text("Oldest picked photos first")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var reviewScopeControls: some View {
        FlowLayout(spacing: 10) {
            Picker(
                "Fixture",
                selection: Binding(
                    get: { model.reviewFixtureID },
                    set: { model.selectReviewFixture($0) }
                )
            ) {
                ForEach(model.flatFixtures.filter { !$0.isArchived }) { fixture in
                    let depth = max(0, model.fixtures.path(to: fixture.id).count - 1)
                    Text("\(String(repeating: "  ", count: depth))\(fixture.name)")
                        .tag(fixture.id)
                }
            }
            .frame(width: 180)
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
            Text("Media")
                .font(.callout.weight(.semibold))
            ForEach(CullingMediaFilter.selectableCases, id: \.rawValue) { filter in
                Toggle(
                    filter.label,
                    isOn: Binding(
                        get: { model.reviewMediaFilters.contains(filter) },
                        set: { _ in model.toggleReviewMediaFilter(filter) }
                    )
                )
                .toggleStyle(.checkbox)
            }
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
                        Button("Propagate") {
                            Task { await model.propagateLastReviewAction() }
                        }
                        .backstageHelp("Apply the prepared Review change to the matching assets in the active two-hour shoot scope.")
                    }
                    .buttonStyle(.borderedProminent)
                    HStack(spacing: 8) {
                        if model.isRunningReview {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(model.reviewStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
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
                    Text("Prepare the reasons and optional note, then press Needs AI for the selection or Propagate for the two-hour shoot.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Divider()
                    Button("Quick Look") {
                        openQuickLook()
                    }
                    .keyboardShortcut(.space, modifiers: [])
                    .backstageHelp("Open the focused Review item in Quick Look without applying a Review action.")
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
