import AppKit
import Foundation

/// The work that must settle before Backstage can terminate safely.
///
/// Read-only thumbnail/status work is intentionally not represented here: it
/// can be canceled when the window closes. Fixture-window reads remain
/// represented by their loading flags because they own their own cleanup. The
/// flags below cover operations that can still be changing Owner, Photos, or
/// the local fixture state.
struct BackstageShutdownWorkState: Equatable, Sendable {
    var isAuthenticating = false
    var isRefreshing = false
    var isLoadingPhotos = false
    var isReconcilingPhotosIndex = false
    var isRunningMetadata = false
    var isRunningFixture = false
    var isLoadingFixtureTree = false
    var isSearchingFixtureAssets = false
    var isReloadingFixturePools = false
    var isOpeningFixturePool = false
    var isLoadingFixturePolicy = false
    var isLoadingFixtureCulling = false
    var isLoadingPreview = false
    var isLoadingCullingDecisions = false
    var isApplyingCullingDecision = false
    var isRunningReview = false
    var isRunningAIPass = false
    var isRunningAccess = false
    var isRunningLifecycle = false
    var isRunningDelivery = false
    var isRunningNativePublication = false
    var isSyncingPhotos = false
    var isRunningR2Reconciliation = false
    var isSavingMetadataModelLadder = false

    var hasActiveWork: Bool {
        [
            isAuthenticating,
            isRefreshing,
            isLoadingPhotos,
            isReconcilingPhotosIndex,
            isRunningMetadata,
            isRunningFixture,
            isLoadingFixtureTree,
            isSearchingFixtureAssets,
            isReloadingFixturePools,
            isOpeningFixturePool,
            isLoadingFixturePolicy,
            isLoadingFixtureCulling,
            isLoadingPreview,
            isLoadingCullingDecisions,
            isApplyingCullingDecision,
            isRunningReview,
            isRunningAIPass,
            isRunningAccess,
            isRunningLifecycle,
            isRunningDelivery,
            isRunningNativePublication,
            isSyncingPhotos,
            isRunningR2Reconciliation,
            isSavingMetadataModelLadder,
        ].contains(true)
    }
}

@MainActor
extension BackstageViewModel {
    var shutdownWorkState: BackstageShutdownWorkState {
        BackstageShutdownWorkState(
            isAuthenticating: isAuthenticating,
            isRefreshing: isRefreshing,
            isLoadingPhotos: isLoadingPhotos,
            isReconcilingPhotosIndex: isReconcilingPhotosIndex,
            isRunningMetadata: isRunningMetadata,
            isRunningFixture: isRunningFixture,
            isLoadingFixtureTree: isLoadingFixtureTree,
            isSearchingFixtureAssets: isSearchingFixtureAssets,
            isReloadingFixturePools: isReloadingFixturePools,
            isOpeningFixturePool: isOpeningFixturePool,
            isLoadingFixturePolicy: isLoadingFixturePolicy,
            isLoadingFixtureCulling: isLoadingFixtureCulling,
            isLoadingPreview: isLoadingPreview,
            isLoadingCullingDecisions: isLoadingCullingDecisions,
            isApplyingCullingDecision: isApplyingCullingDecision,
            isRunningReview: isRunningReview,
            isRunningAIPass: isRunningAIPass,
            isRunningAccess: isRunningAccess,
            isRunningLifecycle: isRunningLifecycle,
            isRunningDelivery: isRunningDelivery,
            isRunningNativePublication: isRunningNativePublication,
            isSyncingPhotos: isSyncingPhotos,
            isRunningR2Reconciliation: isRunningR2Reconciliation,
            isSavingMetadataModelLadder: isSavingMetadataModelLadder
        )
    }

    func waitForActiveWorkToFinish() async {
        while shutdownWorkState.hasActiveWork {
            do {
                try await Task.sleep(for: .milliseconds(50))
            } catch {
                return
            }
        }
    }
}

@MainActor
final class BackstageApplicationDelegate: NSObject, NSApplicationDelegate {
    private var model: BackstageViewModel?
    private var terminationReplyPending = false
    private var drainTask: Task<Void, Never>?

    func attach(model: BackstageViewModel) {
        self.model = model
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminationReplyPending else {
            return .terminateLater
        }

        terminationReplyPending = true
        let model = model
        drainTask = Task { @MainActor [weak self, model] in
            await model?.prepareForTermination()
            await model?.waitForActiveWorkToFinish()
            guard let self else { return }
            self.drainTask = nil
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        drainTask?.cancel()
        drainTask = nil
        model = nil
    }
}
