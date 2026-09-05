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

    @Test("A newer AI proposal cannot overwrite a manually edited Review draft")
    func proposalHydrationPreservesManualDraft() {
        var drafts = ["asset-a": ReviewMetadataDraft(
            title: "My title", keywords: ["My keyword"],
            proposalID: "old-proposal", hasManualEdits: true
        )]
        var conflicts: Set<String> = []
        let item = proposalItem(id: "new-proposal")

        BackstageReviewWorkflowState.hydrateProposalDrafts(
            from: [item], drafts: &drafts, conflicts: &conflicts
        )

        #expect(drafts["asset-a"]?.title == "My title")
        #expect(drafts["asset-a"]?.keywords == ["My keyword"])
        #expect(drafts["asset-a"]?.proposalID == "old-proposal")
        #expect(conflicts == ["asset-a"])
        #expect(item.title == "Stored title")
    }

    @Test("Incremental proposals refresh untouched drafts and preserve edits for the same proposal")
    func proposalHydrationRefreshesOnlyEligibleFields() {
        var drafts: [String: ReviewMetadataDraft] = [:]
        var conflicts: Set<String> = []
        var item = proposalItem(id: "first")
        BackstageReviewWorkflowState.hydrateProposalDrafts(
            from: [item], drafts: &drafts, conflicts: &conflicts
        )
        #expect(drafts["asset-a"]?.title == "Suggested first")
        #expect(drafts["asset-a"]?.keywords == ["Suggested keyword"])

        item = proposalItem(id: "second")
        BackstageReviewWorkflowState.hydrateProposalDrafts(
            from: [item], drafts: &drafts, conflicts: &conflicts
        )
        #expect(drafts["asset-a"]?.title == "Suggested second")
        #expect(drafts["asset-a"]?.proposalID == "second")
        #expect(conflicts.isEmpty)

        drafts["asset-a"]?.title = "Owner correction"
        drafts["asset-a"]?.hasManualEdits = true
        item.proposalStatus = "superseded"
        BackstageReviewWorkflowState.hydrateProposalDrafts(
            from: [item], drafts: &drafts, conflicts: &conflicts
        )
        #expect(drafts["asset-a"]?.title == "Owner correction")
        #expect(drafts["asset-a"]?.hasManualEdits == true)
        #expect(drafts["asset-a"]?.proposalStatus == "superseded")
        #expect(conflicts.isEmpty)
    }

    private func proposalItem(id: String) -> FixtureReviewItem {
        FixtureReviewItem(
            id: "asset-a", photoLibraryIdentifier: "synthetic-asset-a",
            title: "Stored title", keywords: ["Stored keyword"],
            filename: "synthetic.jpg", capturedAt: "2026-09-05T07:00:00Z",
            proposalReady: true, proposalContextAvailable: true,
            proposalID: id, proposedTitle: "Suggested \(id)",
            proposedKeywords: ["Suggested keyword"], proposalStatus: "ready"
        )
    }
}
