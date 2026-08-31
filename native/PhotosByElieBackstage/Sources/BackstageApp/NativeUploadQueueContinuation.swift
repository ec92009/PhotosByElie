import Foundation
import OwnerCore

/// Tracks terminal upload receipts so a failed item can be deferred while the
/// remaining eligible queue continues without retrying completed work.
struct NativeUploadQueueContinuation {
    private(set) var attemptedIDs = Set<String>()
    private(set) var successfulIDs = Set<String>()
    private(set) var failedIDs = Set<String>()

    var nextPlanOffset: Int { failedIDs.count }

    /// Records only terminal item states. Nonterminal items remain eligible for
    /// the current worker to finish or for a safe cancellation to preserve.
    mutating func record(_ items: [NativeUploadRunItem]) {
        for item in items {
            record(assetID: item.assetID, status: item.status)
        }
    }

    mutating func record(assetID: String, status: String) {
        guard !assetID.isEmpty else { return }
        switch status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "verified", "live":
                attemptedIDs.insert(assetID)
                successfulIDs.insert(assetID)
                failedIDs.remove(assetID)
            case "failed":
                attemptedIDs.insert(assetID)
                successfulIDs.remove(assetID)
                failedIDs.insert(assetID)
            case "skipped":
                attemptedIDs.insert(assetID)
                successfulIDs.remove(assetID)
                failedIDs.remove(assetID)
            default:
                break
        }
    }

    /// Removes receipts already observed in this continuous run. Failed items
    /// remain in the durable queue but do not block later windows.
    func nextAssetIDs(in items: [NativeUploadPlanItem]) -> [String] {
        var seen = Set<String>()
        return items.compactMap { item in
            guard !item.assetID.isEmpty,
                  !attemptedIDs.contains(item.assetID),
                  seen.insert(item.assetID).inserted else {
                return nil
            }
            return item.assetID
        }
    }

    static func batchCount(for eligibleCount: Int, limit: Int = 50) -> Int {
        guard eligibleCount > 0, limit > 0 else { return 0 }
        return (eligibleCount + limit - 1) / limit
    }
}
