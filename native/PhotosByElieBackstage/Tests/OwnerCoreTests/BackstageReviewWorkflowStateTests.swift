import OwnerCore
import Testing
@testable import BackstageUI

@Suite("Backstage Review workflow state")
struct BackstageReviewWorkflowStateTests {
    @Test("A newer Review window request rejects stale completion ownership")
    func windowRequestOwnership() {
        var state = BackstageReviewWorkflowState()

        let first = state.beginWindowRequest()
        #expect(state.ownsWindowRequest(first))

        let second = state.beginWindowRequest()
        #expect(!state.ownsWindowRequest(first))
        #expect(state.ownsWindowRequest(second))

        state.invalidateWindowRequests()
        #expect(!state.ownsWindowRequest(second))
    }

    @Test("Review window replacement preserves visible selection and repairs stale focus")
    func windowSelectionContinuity() {
        let state = BackstageReviewWorkflowState()
        let selection = state.restoredSelection(
            orderedIDs: ["asset-b", "asset-c"],
            selectedIDs: ["asset-a", "asset-b"],
            anchorID: "asset-a",
            focusedID: "asset-a",
            preferredAssetID: nil
        )

        #expect(selection.selectedIDs == ["asset-b"])
        #expect(selection.anchorID == "asset-b")
        #expect(selection.focusedID == "asset-b")
    }

    @Test("Review burst selection repairs stale anchor and focus")
    func burstSelectionContinuity() {
        let state = BackstageReviewWorkflowState()
        let current = OwnerSelectionModel(
            orderedIDs: ["first", "keeper", "third", "stale"],
            selectedIDs: ["stale"],
            anchorID: "stale",
            focusedID: "stale"
        )

        let selection = state.burstSelection(
            orderedIDs: ["first", "keeper", "third", "stale"],
            candidateIDs: ["first", "third"],
            current: current
        )

        #expect(selection.selectedIDs == ["first", "third"])
        #expect(selection.anchorID == "first")
        #expect(selection.focusedID == "first")
    }

    @Test("Only the newest Review metadata autosave token can finish")
    func metadataAutosaveOwnership() {
        var state = BackstageReviewWorkflowState()

        let first = state.beginMetadataAutosave()
        let second = state.beginMetadataAutosave()
        state.finishMetadataAutosave(first)
        #expect(state.hasPendingMetadataAutosave)

        state.finishMetadataAutosave(second)
        #expect(!state.hasPendingMetadataAutosave)
    }

    @Test("Only the newest Review AI status refresh owns completion")
    func aiStatusRefreshOwnership() {
        var state = BackstageReviewWorkflowState()

        let first = state.beginAIStatusRefresh()
        let second = state.beginAIStatusRefresh()

        #expect(!state.ownsAIStatusRefresh(first))
        #expect(state.ownsAIStatusRefresh(second))
    }
}
