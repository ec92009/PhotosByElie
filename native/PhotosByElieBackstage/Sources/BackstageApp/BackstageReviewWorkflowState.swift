import AppKit
import OwnerCore

/// Cohesive runtime state for the Review workflow.
///
/// `BackstageViewModel` remains the SwiftUI composition boundary and keeps its
/// existing published bindings. This holder owns request generations, delayed
/// metadata saves, thumbnail work, AI refresh coordination, suggestion seeds,
/// and pending Waste Basket actions so stale work cannot mutate newer Review
/// state.
struct BackstageReviewWorkflowState {
    var thumbnailTasks: [String: Task<Void, Never>] = [:]
    var metadataAutosaveTask: Task<Void, Never>?
    var aiPassStartFailure: String?
    var aiStatusRefreshTask: Task<Void, Never>?

    var countrySuggestionSeedAssetID: String?
    var countrySuggestionSeedValue = ""
    var wasteBasketPendingActions: [String: OwnerAction] = [:]
    var wasteBasketPendingActionOrder: [String] = []

    private(set) var windowRequestSerial = 0
    private(set) var metadataAutosaveTaskToken: UUID?
    private(set) var hasPendingMetadataAutosave = false
    private(set) var aiStatusRefreshGeneration = 0
    private(set) var aiAvailabilityToken = ""
    private(set) var aiWindowRefreshPending = false

    mutating func invalidateWindowRequests() {
        windowRequestSerial += 1
    }

    mutating func beginWindowRequest() -> Int {
        windowRequestSerial += 1
        return windowRequestSerial
    }

    func ownsWindowRequest(_ serial: Int) -> Bool {
        serial == windowRequestSerial
    }

    func restoredSelection(
        orderedIDs: [String],
        selectedIDs: Set<String>,
        anchorID: String?,
        focusedID: String?,
        preferredAssetID: String?
    ) -> OwnerSelectionModel<String> {
        let currentID = preferredAssetID ?? focusedID ?? selectedIDs.first
        let replacementID = currentID.flatMap { orderedIDs.contains($0) ? $0 : nil }
            ?? orderedIDs.first
        let restoredSelectedIDs = selectedIDs.intersection(orderedIDs)
        let selectionIDs = preferredAssetID == nil && !restoredSelectedIDs.isEmpty
            ? restoredSelectedIDs
            : Set(replacementID.map { [$0] } ?? [])
        let restoredAnchorID = (preferredAssetID ?? anchorID).flatMap {
            orderedIDs.contains($0) ? $0 : nil
        } ?? replacementID
        let restoredFocusedID = (preferredAssetID ?? focusedID).flatMap {
            orderedIDs.contains($0) ? $0 : nil
        } ?? replacementID
        return OwnerSelectionModel(
            orderedIDs: orderedIDs,
            selectedIDs: selectionIDs,
            anchorID: restoredAnchorID,
            focusedID: restoredFocusedID
        )
    }

    func burstSelection(
        orderedIDs: [String],
        candidateIDs: [String],
        current: OwnerSelectionModel<String>
    ) -> OwnerSelectionModel<String> {
        let candidates = Set(candidateIDs)
        let focusedID = current.focusedID.flatMap { candidates.contains($0) ? $0 : nil }
            ?? candidateIDs.first
        let anchorID = current.anchorID.flatMap { candidates.contains($0) ? $0 : nil }
            ?? candidateIDs.first
        return OwnerSelectionModel(
            orderedIDs: orderedIDs,
            selectedIDs: candidates,
            anchorID: anchorID,
            focusedID: focusedID
        )
    }

    mutating func clearCountrySuggestionSeed() {
        countrySuggestionSeedAssetID = nil
        countrySuggestionSeedValue = ""
    }

    mutating func setCountrySuggestionSeed(assetID: String, value: String) {
        countrySuggestionSeedAssetID = assetID
        countrySuggestionSeedValue = value
    }

    func preservedCountry(assetID: String, visibleCountry: String, storedCountry: String) -> String {
        countrySuggestionSeedAssetID == assetID && countrySuggestionSeedValue == visibleCountry
            ? storedCountry
            : visibleCountry
    }

    mutating func beginMetadataAutosave() -> UUID {
        metadataAutosaveTask?.cancel()
        let token = UUID()
        metadataAutosaveTaskToken = token
        hasPendingMetadataAutosave = true
        return token
    }

    mutating func installMetadataAutosaveTask(_ task: Task<Void, Never>) {
        metadataAutosaveTask = task
    }

    func ownsMetadataAutosave(_ token: UUID) -> Bool {
        metadataAutosaveTaskToken == token
    }

    mutating func finishMetadataAutosave(_ token: UUID) {
        guard ownsMetadataAutosave(token) else { return }
        metadataAutosaveTask = nil
        metadataAutosaveTaskToken = nil
        hasPendingMetadataAutosave = false
    }

    mutating func cancelMetadataAutosave() {
        metadataAutosaveTask?.cancel()
        metadataAutosaveTask = nil
        metadataAutosaveTaskToken = nil
        hasPendingMetadataAutosave = false
    }

    mutating func beginAIStatusRefresh() -> Int {
        aiStatusRefreshTask?.cancel()
        aiStatusRefreshGeneration += 1
        return aiStatusRefreshGeneration
    }

    mutating func installAIStatusRefreshTask(_ task: Task<Void, Never>) {
        aiStatusRefreshTask = task
    }

    func ownsAIStatusRefresh(_ generation: Int) -> Bool {
        generation == aiStatusRefreshGeneration
    }

    mutating func recordAIAvailability(_ status: FixtureAIStatus) {
        aiAvailabilityToken = Self.aiAvailabilityToken(for: status)
    }

    func aiAvailabilityChanged(from previousToken: String) -> Bool {
        previousToken != aiAvailabilityToken
    }

    mutating func deferAIWindowRefresh() {
        aiWindowRefreshPending = true
    }

    mutating func consumeAIWindowRefresh() {
        aiWindowRefreshPending = false
    }

    static func aiAvailabilityToken(for status: FixtureAIStatus) -> String {
        [
            String(status.ready),
            status.run?.id ?? "",
            String(status.run?.proposed ?? 0),
            String(status.run?.failed ?? 0),
            status.run?.status ?? "",
        ].joined(separator: "|")
    }

    static func applying(
        _ update: [String: JSONValue],
        to current: FixtureReviewItem
    ) -> FixtureReviewItem {
        var item = current
        if let value = update["title"]?.stringValue { item.title = value }
        if let value = update["caption"]?.stringValue { item.caption = value }
        if let value = update["keywords"]?.arrayValue {
            item.keywords = value.compactMap(\.stringValue)
        }
        if let value = update["rating"]?.intValue { item.rating = value }
        if let value = update["color"]?.stringValue { item.color = value }
        if let value = update["placementState"]?.stringValue { item.placementState = value }
        if let value = update["editorialState"]?.stringValue { item.editorialState = value }
        if let value = update["aiReasons"]?.arrayValue {
            item.aiReasons = value.compactMap(\.stringValue)
        }
        if let value = update["aiNote"]?.stringValue { item.aiNote = value }
        if let value = update["aiAttemptCount"]?.intValue { item.aiAttemptCount = value }
        if let value = update["aiLastError"]?.stringValue { item.aiLastError = value }
        if let value = update["proposalReady"]?.boolValue { item.proposalReady = value }
        if let value = update["proposalContextAvailable"]?.boolValue {
            item.proposalContextAvailable = value
        }
        if let value = update["proposalId"]?.stringValue { item.proposalID = value }
        if let value = update["proposedTitle"]?.stringValue { item.proposedTitle = value }
        if let value = update["proposedKeywords"]?.arrayValue {
            item.proposedKeywords = value.compactMap(\.stringValue)
        }
        if let value = update["country"]?.stringValue { item.country = value }
        if let value = update["proposedCountry"]?.stringValue { item.proposedCountry = value }
        if let value = update["countryProposalSource"]?.stringValue {
            item.countryProposalSource = value
        }
        if let value = update["proposalReason"]?.stringValue { item.proposalReason = value }
        if let value = update["proposalStatus"]?.stringValue { item.proposalStatus = value }
        if let value = update["requestedGeneratorModel"]?.stringValue {
            item.requestedGeneratorModel = value
        }
        if let value = update["resolvedModel"]?.stringValue { item.resolvedModel = value }
        if let value = update["reasoningEffort"]?.stringValue { item.reasoningEffort = value }
        if let value = update["vision"]?.boolValue { item.vision = value }
        if let value = update["modelLadder"]?.arrayValue {
            item.modelLadder = value.compactMap(\.stringValue)
        }
        if let value = update["deliveryState"]?.stringValue { item.deliveryState = value }
        return item
    }

    static func hydrateProposalDrafts(
        from items: [FixtureReviewItem],
        drafts: inout [String: ReviewMetadataDraft],
        conflicts: inout Set<String>
    ) {
        for item in items where item.proposalContextAvailable && !item.proposalID.isEmpty {
            if let existing = drafts[item.id] {
                if existing.proposalID == item.proposalID {
                    var refreshed = existing
                    refreshed.proposalStatus = item.proposalStatus
                    refreshed.requestedGeneratorModel = item.requestedGeneratorModel
                    refreshed.resolvedModel = item.resolvedModel
                    refreshed.reasoningEffort = item.reasoningEffort
                    refreshed.vision = item.vision
                    drafts[item.id] = refreshed
                    conflicts.remove(item.id)
                    continue
                }
                if !existing.isProposal || existing.hasManualEdits {
                    conflicts.insert(item.id)
                    continue
                }
            }
            drafts[item.id] = ReviewMetadataDraft(
                country: item.proposedCountry.isEmpty ? item.country : item.proposedCountry,
                title: item.proposedTitle,
                keywords: item.proposedKeywords,
                proposalID: item.proposalID,
                proposalReason: item.proposalReason,
                proposalStatus: item.proposalStatus,
                requestedGeneratorModel: item.requestedGeneratorModel,
                resolvedModel: item.resolvedModel,
                reasoningEffort: item.reasoningEffort,
                vision: item.vision
            )
            conflicts.remove(item.id)
        }
    }

    mutating func beginWasteBasketAction(_ action: OwnerAction) {
        wasteBasketPendingActions[action.id] = action
        wasteBasketPendingActionOrder.removeAll { $0 == action.id }
        wasteBasketPendingActionOrder.append(action.id)
    }

    mutating func updateWasteBasketAction(_ action: OwnerAction) {
        guard wasteBasketPendingActions[action.id] != nil else { return }
        wasteBasketPendingActions[action.id] = action
    }

    mutating func finishWasteBasketAction(_ actionID: String) {
        wasteBasketPendingActions.removeValue(forKey: actionID)
        wasteBasketPendingActionOrder.removeAll { $0 == actionID }
    }

    var latestWasteBasketAction: OwnerAction? {
        wasteBasketPendingActionOrder.last.flatMap { wasteBasketPendingActions[$0] }
    }
}
