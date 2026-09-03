import Testing
@testable import BackstageUI

@Suite("Backstage Gallery workflow state")
struct BackstageGalleryWorkflowStateTests {
    @Test("A newer Gallery window request rejects stale completion ownership")
    func windowRequestOwnership() {
        var state = BackstageGalleryWorkflowState()

        let first = state.beginWindowRequest()
        #expect(state.ownsWindowRequest(first))

        let second = state.beginWindowRequest()
        #expect(!state.ownsWindowRequest(first))
        #expect(state.ownsWindowRequest(second))

        state.invalidateWindowRequests()
        #expect(!state.ownsWindowRequest(second))
    }

    @Test("A pending Gallery reveal is consumed exactly once")
    func pendingRevealConsumption() throws {
        var state = BackstageGalleryWorkflowState()
        state.queueReveal(ids: ["asset-b", "asset-a"], source: "Review")

        let pendingReveal = state.takePendingReveal()
        let reveal = try #require(pendingReveal)
        #expect(reveal.ids == ["asset-b", "asset-a"])
        #expect(reveal.source == "Review")
        #expect(state.takePendingReveal() == nil)
    }
}
