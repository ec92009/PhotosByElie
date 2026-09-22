import Foundation

/// Receipts stay bound to the selection captured when Perform AI started.
/// Approving a completed item does not reset progress for the rest of the batch.
struct ReviewAIBatchState {
    let work: ReviewAIWork
    var metadataReadyIDs: Set<String> = []
    var metadataFailedIDs: Set<String> = []
    var visualReadyIDs: Set<String> = []
    var visualFailedIDs: Set<String> = []
    var approvedIDs: Set<String> = []

    var ids: Set<String> { work.metadataIDs.union(work.visualIDs) }
    var completeIDs: Set<String> {
        Set(ids.filter { id in
            (!work.metadataIDs.contains(id) || metadataReadyIDs.contains(id))
                && (!work.visualIDs.contains(id) || visualReadyIDs.contains(id))
        }).union(approvedIDs)
    }
    var attentionIDs: Set<String> {
        metadataFailedIDs.union(visualFailedIDs).intersection(ids).subtracting(completeIDs)
    }
    var remaining: Int { ids.subtracting(completeIDs).subtracting(attentionIDs).count }
    var summary: String {
        "AI batch · \(ids.count) photos\n\(completeIDs.subtracting(approvedIDs).count) ready to review · \(remaining) still processing · \(attentionIDs.count) need attention · \(approvedIDs.count) approved"
    }
}
