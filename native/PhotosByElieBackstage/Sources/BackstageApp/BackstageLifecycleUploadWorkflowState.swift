import Foundation
import OwnerCore

/// Runtime coordination shared by Waste Basket and upload/publication flows.
///
/// Published UI bindings remain on `BackstageViewModel`. This holder owns
/// asynchronous task identities, optimistic lifecycle caches, durable-action
/// ordering, lifecycle counts, and publication cancellation so stale work and
/// resumable work share one explicit boundary.
struct BackstageLifecycleUploadWorkflowState {
    var thumbnailTasks: [String: Task<Void, Never>] = [:]
    var thumbnailTaskTokens: [String: UUID] = [:]
    var thumbnailPreferredIdentifiers: [String: String] = [:]
    var restorePendingActions: [String: OwnerAction] = [:]
    var restorePendingActionOrder: [String] = []
    var locallyObservedActions: [String: OwnerAction] = [:]
    var monitorTask: Task<Void, Never>?

    private(set) var recoverableCount = 0
    private(set) var tombstoneCount = 0
    private(set) var publicationCancellationRequested = false

    mutating func rememberPreferredIdentifier(_ identifier: String?, for assetID: String) {
        guard let identifier = identifier?.trimmingCharacters(in: .whitespacesAndNewlines),
              !identifier.isEmpty else { return }
        thumbnailPreferredIdentifiers[assetID] = identifier
    }

    mutating func beginThumbnailTask(for assetID: String) -> UUID {
        let token = UUID()
        thumbnailTaskTokens[assetID] = token
        return token
    }

    func ownsThumbnailTask(for assetID: String, token: UUID) -> Bool {
        thumbnailTaskTokens[assetID] == token
    }

    mutating func finishThumbnailTask(for assetID: String, token: UUID) {
        guard ownsThumbnailTask(for: assetID, token: token) else { return }
        thumbnailTaskTokens[assetID] = nil
        thumbnailTasks[assetID] = nil
    }

    mutating func cancelThumbnailTask(for assetID: String) {
        thumbnailTasks[assetID]?.cancel()
        thumbnailTasks[assetID] = nil
        thumbnailTaskTokens[assetID] = nil
    }

    mutating func setLifecycleCounts(recoverable: Int, tombstones: Int) {
        recoverableCount = max(0, recoverable)
        tombstoneCount = max(0, tombstones)
    }

    mutating func adjustRecoverableCount(by delta: Int) {
        recoverableCount = max(0, recoverableCount + delta)
    }

    var lifecycleCountSummary: String {
        "\(recoverableCount.formatted()) recoverable • \(tombstoneCount.formatted()) active global tombstone\(tombstoneCount == 1 ? "" : "s")"
    }

    mutating func retainLocallyObservedAction(_ action: OwnerAction) {
        locallyObservedActions[action.id] = action
    }

    func mergingLocallyObservedActions(into fetched: [OwnerAction]) -> [OwnerAction] {
        var merged = fetched
        for local in locallyObservedActions.values {
            if let index = merged.firstIndex(where: { $0.id == local.id }) {
                let remote = merged[index]
                let remoteUpdated = remote.updatedAt ?? remote.createdAt ?? Date.distantPast
                let localUpdated = local.updatedAt ?? local.createdAt ?? Date.distantPast
                if localUpdated >= remoteUpdated {
                    merged[index] = local
                }
            } else {
                merged.append(local)
            }
        }
        return merged
            .sorted {
                ($0.updatedAt ?? $0.createdAt ?? Date.distantPast)
                    > ($1.updatedAt ?? $1.createdAt ?? Date.distantPast)
            }
            .prefix(50)
            .map { $0 }
    }

    mutating func beginRestoreAction(_ action: OwnerAction) {
        restorePendingActions[action.id] = action
        restorePendingActionOrder.removeAll { $0 == action.id }
        restorePendingActionOrder.append(action.id)
    }

    mutating func updateRestoreAction(_ action: OwnerAction) {
        guard restorePendingActions[action.id] != nil else { return }
        restorePendingActions[action.id] = action
    }

    mutating func finishRestoreAction(_ actionID: String) {
        restorePendingActions.removeValue(forKey: actionID)
        restorePendingActionOrder.removeAll { $0 == actionID }
    }

    var latestRestoreActionID: String? {
        restorePendingActionOrder.last
    }

    mutating func beginPublication() {
        publicationCancellationRequested = false
    }

    mutating func requestPublicationCancellation() {
        publicationCancellationRequested = true
    }

    mutating func finishPublication() {
        publicationCancellationRequested = false
    }
}
