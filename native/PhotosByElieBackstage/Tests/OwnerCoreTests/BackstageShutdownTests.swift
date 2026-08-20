import AppKit
import Testing
@testable import BackstageUI

@Suite("Backstage shutdown")
struct BackstageShutdownTests {
    @Test("Idle Backstage has no work to drain")
    func idleStateIsReadyToTerminate() {
        #expect(!BackstageShutdownWorkState().hasActiveWork)
    }

    @Test("Every durable operation keeps termination pending")
    func durableOperationBlocksTermination() {
        var state = BackstageShutdownWorkState()
        let checks: [(inout BackstageShutdownWorkState) -> Void] = [
            { $0.isRunningReview = true },
            { $0.isApplyingCullingDecision = true },
            { $0.isRunningDelivery = true },
            { $0.isRunningNativePublication = true },
            { $0.isSyncingPhotos = true },
        ]

        for check in checks {
            state = BackstageShutdownWorkState()
            check(&state)
            #expect(state.hasActiveWork)
        }
    }

    @Test("Last-window termination is enabled")
    @MainActor
    func lastWindowClosesTheApplication() {
        let delegate = BackstageApplicationDelegate()
        #expect(delegate.applicationShouldTerminateAfterLastWindowClosed(NSApplication.shared))
    }
}
