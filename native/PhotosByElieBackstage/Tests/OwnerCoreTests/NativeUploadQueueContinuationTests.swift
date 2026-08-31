@testable import BackstageUI
import OwnerCore
import Testing

@Suite("Native upload queue continuation")
struct NativeUploadQueueContinuationTests {
    @Test("A failed item is deferred while later windows continue")
    func failedItemDoesNotBlockLaterWindow() {
        var continuation = NativeUploadQueueContinuation()
        continuation.record(assetID: "uploaded", status: "verified")
        continuation.record(assetID: "blocked", status: "failed")

        let nextIDs = continuation.nextAssetIDs(in: [
            planItem("blocked"),
            planItem("later-1"),
            planItem("later-2"),
        ])

        #expect(continuation.nextPlanOffset == 1)
        #expect(continuation.failedIDs == ["blocked"])
        #expect(nextIDs == ["later-1", "later-2"])
    }

    @Test("Terminal receipts are never scheduled twice")
    func terminalReceiptsAreNotRepeated() {
        var continuation = NativeUploadQueueContinuation()
        continuation.record(assetID: "verified", status: "verified")
        continuation.record(assetID: "live", status: "live")
        continuation.record(assetID: "skipped", status: "skipped")

        let nextIDs = continuation.nextAssetIDs(in: [
            planItem("verified"),
            planItem("live"),
            planItem("skipped"),
            planItem("new"),
            planItem("new"),
        ])

        #expect(nextIDs == ["new"])
        #expect(continuation.successfulIDs == ["verified", "live"])
        #expect(continuation.failedIDs.isEmpty)
    }

    @Test("Progress estimates every bounded worker batch")
    func batchCountCoversWholeQueue() {
        #expect(NativeUploadQueueContinuation.batchCount(for: 0) == 0)
        #expect(NativeUploadQueueContinuation.batchCount(for: 1) == 1)
        #expect(NativeUploadQueueContinuation.batchCount(for: 50) == 1)
        #expect(NativeUploadQueueContinuation.batchCount(for: 51) == 2)
        #expect(NativeUploadQueueContinuation.batchCount(for: 390) == 8)
    }

    private func planItem(_ assetID: String) -> NativeUploadPlanItem {
        NativeUploadPlanItem(
            assetID: assetID,
            photoLibraryIdentifier: assetID,
            title: assetID,
            keywords: [],
            filename: "\(assetID).jpg",
            capturedAt: "2026-09-01T00:00:00Z",
            deliveryState: "needs-upload",
            errorText: ""
        )
    }
}
