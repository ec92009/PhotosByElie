import Testing
@testable import BackstageUI

@Suite("Backstage lifecycle and upload workflow state")
struct BackstageLifecycleUploadWorkflowStateTests {
    @Test("A stale lifecycle thumbnail completion cannot clear newer work")
    func thumbnailTaskOwnership() {
        var state = BackstageLifecycleUploadWorkflowState()

        let first = state.beginThumbnailTask(for: "asset")
        let second = state.beginThumbnailTask(for: "asset")
        state.finishThumbnailTask(for: "asset", token: first)

        #expect(!state.ownsThumbnailTask(for: "asset", token: first))
        #expect(state.ownsThumbnailTask(for: "asset", token: second))
    }

    @Test("Optimistic lifecycle counts stay nonnegative and keep tombstones separate")
    func lifecycleCounts() {
        var state = BackstageLifecycleUploadWorkflowState()
        state.setLifecycleCounts(recoverable: 3, tombstones: 1)
        state.adjustRecoverableCount(by: -5)

        #expect(state.recoverableCount == 0)
        #expect(state.tombstoneCount == 1)
        #expect(state.lifecycleCountSummary == "0 recoverable • 1 active global tombstone")
    }

    @Test("Publication cancellation latches immediately and resets for the next run")
    func publicationCancellationLatch() {
        var state = BackstageLifecycleUploadWorkflowState()

        state.beginPublication()
        #expect(!state.publicationCancellationRequested)

        state.requestPublicationCancellation()
        #expect(state.publicationCancellationRequested)

        state.finishPublication()
        #expect(!state.publicationCancellationRequested)
    }
}
