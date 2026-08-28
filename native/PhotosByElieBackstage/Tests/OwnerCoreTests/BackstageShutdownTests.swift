import AppKit
@testable import OwnerCore
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
            { $0.isSavingReviewMetadata = true },
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

    @Test("Quit prompt names every active blocker")
    func promptNamesActiveBlockers() {
        let state = BackstageShutdownWorkState(
            isApplyingCullingDecision: true,
            isRunningDelivery: true,
            isSyncingPhotos: true
        )
        let prompt = BackstageShutdownPromptModel(workState: state)

        #expect(state.activeReasons == [
            "culling decision write",
            "delivery work",
            "Apple Photos sync",
        ])
        #expect(prompt.informativeText.contains("culling decision write, delivery work, and Apple Photos sync"))
        #expect(prompt.actions.map(\.title) == ["Wait and Quit", "Cancel Quit", "Force Quit"])
        #expect(prompt.actions.last?.isDestructive == true)
    }

    @Test("Confirmed AI worker offers detach without hiding other blockers")
    func promptOffersAIDetach() {
        let aiOnly = BackstageShutdownPromptModel(workState: BackstageShutdownWorkState(
            isRunningAIPass: true,
            isAIPassDetachable: true
        ))
        #expect(aiOnly.actions.map(\.title) == [
            "Wait and Quit",
            "Detach AI Pass and Quit",
            "Cancel Quit",
            "Force Quit",
        ])
        #expect(aiOnly.informativeText.contains("independent durable worker"))

        let mixed = BackstageShutdownPromptModel(workState: BackstageShutdownWorkState(
            isRunningAIPass: true,
            isAIPassDetachable: true,
            isSyncingPhotos: true
        ))
        #expect(mixed.actions[1].title == "Detach AI Pass and Wait")

        let inconsistent = BackstageShutdownPromptModel(workState: BackstageShutdownWorkState(
            isAIPassDetachable: true,
            isSyncingPhotos: true
        ))
        #expect(!inconsistent.actions.map(\.title).contains("Detach AI Pass and Wait"))
    }

    @Test("Modal responses map to the visible action order")
    func modalResponsesMapToActions() {
        let prompt = BackstageShutdownPromptModel(workState: BackstageShutdownWorkState(
            isRunningAIPass: true,
            isAIPassDetachable: true
        ))
        let first = NSApplication.ModalResponse.alertFirstButtonReturn.rawValue

        #expect(prompt.choice(for: .init(rawValue: first)) == .waitAndQuit)
        #expect(prompt.choice(for: .init(rawValue: first + 1)) == .detachAIPassAndQuit)
        #expect(prompt.choice(for: .init(rawValue: first + 2)) == .cancelQuit)
        #expect(prompt.choice(for: .init(rawValue: first + 3)) == .forceQuit)
        #expect(prompt.choice(for: .init(rawValue: first + 99)) == .cancelQuit)
    }

    @Test("AI detach stops only the confirmed Backstage monitor")
    @MainActor
    func detachStopsOnlyConfirmedMonitor() {
        let model = BackstageViewModel()
        model.isRunningAIPass = true

        #expect(!model.detachAIProposalPassForTermination())
        #expect(model.isRunningAIPass)

        model.fixtureAIStatus = FixtureAIStatus(json: [
            "active": .bool(true),
            "requested": .number(1),
        ])
        #expect(model.detachAIProposalPassForTermination())
        #expect(!model.isRunningAIPass)
        #expect(model.fixtureAIStatus?.active == true)
        #expect(model.aiProposalStatus.contains("continue in the background"))
    }

    @Test("Termination decisions coalesce repeated quit requests")
    func terminationDecisionsCoalesce() {
        var promptCount = 0
        var coordinator = BackstageTerminationCoordinator()
        let state = BackstageShutdownWorkState(isRunningAIPass: true)

        let first = coordinator.decide(workState: state) {
            promptCount += 1
            return .waitAndQuit
        }
        let repeated = coordinator.decide(workState: state) {
            promptCount += 1
            return .forceQuit
        }

        #expect(first == .terminateLater(detachAIPass: false))
        #expect(repeated == .alreadyPending)
        #expect(promptCount == 1)
    }

    @Test("Cancel and force quit remain immediate explicit choices")
    func terminationImmediateChoices() {
        let state = BackstageShutdownWorkState(isRunningReview: true)
        var cancelCoordinator = BackstageTerminationCoordinator()
        var forceCoordinator = BackstageTerminationCoordinator()

        #expect(cancelCoordinator.decide(workState: state) { .cancelQuit } == .cancel)
        #expect(!cancelCoordinator.terminationReplyPending)
        #expect(forceCoordinator.decide(workState: state) { .forceQuit } == .terminateNow)
        #expect(!forceCoordinator.terminationReplyPending)
    }

    @Test("Idle quit terminates immediately without a prompt")
    func idleQuitSkipsPrompt() {
        var promptCount = 0
        var coordinator = BackstageTerminationCoordinator()
        let disposition = coordinator.decide(workState: BackstageShutdownWorkState()) {
            promptCount += 1
            return .cancelQuit
        }

        #expect(disposition == .terminateNow)
        #expect(!coordinator.terminationReplyPending)
        #expect(promptCount == 0)
    }

    @Test("Pending Review metadata is named and drained before quit")
    func reviewMetadataSaveBlocksTermination() {
        var coordinator = BackstageTerminationCoordinator()
        let state = BackstageShutdownWorkState(isSavingReviewMetadata: true)

        #expect(state.activeReasons == ["Review metadata save"])
        #expect(coordinator.decide(workState: state) { .waitAndQuit }
            == .terminateLater(detachAIPass: false))
        #expect(coordinator.terminationReplyPending)
    }

    @Test("Last-window termination is enabled")
    @MainActor
    func lastWindowClosesTheApplication() {
        let delegate = BackstageApplicationDelegate()
        #expect(delegate.applicationShouldTerminateAfterLastWindowClosed(NSApplication.shared))
    }
}
