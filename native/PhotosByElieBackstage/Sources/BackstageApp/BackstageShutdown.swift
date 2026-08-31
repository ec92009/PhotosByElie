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
    var isDeferringCullingWasteBasketUndo = false
    var isRunningReview = false
    var isSavingReviewMetadata = false
    var isRunningAIPass = false
    var isAIPassDetachable = false
    var isRunningAccess = false
    var isRunningLifecycle = false
    var isRunningDelivery = false
    var isRunningNativePublication = false
    var isSyncingPhotos = false
    var isBackfillingEquipment = false
    var isRunningR2Reconciliation = false
    var isSavingMetadataModelLadder = false

    var activeReasons: [String] {
        var reasons: [String] = []
        if isAuthenticating { reasons.append("Owner sign-in") }
        if isRefreshing { reasons.append("Owner refresh") }
        if isLoadingPhotos { reasons.append("Apple Photos loading") }
        if isReconcilingPhotosIndex { reasons.append("Photos index reconciliation") }
        if isRunningMetadata { reasons.append("metadata write-back") }
        if isRunningFixture { reasons.append("fixture update") }
        if isLoadingFixtureTree { reasons.append("fixture list loading") }
        if isSearchingFixtureAssets { reasons.append("fixture search") }
        if isReloadingFixturePools { reasons.append("fixture pool refresh") }
        if isOpeningFixturePool { reasons.append("fixture opening") }
        if isLoadingFixturePolicy { reasons.append("fixture policy loading") }
        if isLoadingFixtureCulling { reasons.append("Gallery loading") }
        if isLoadingPreview { reasons.append("preview loading") }
        if isLoadingCullingDecisions { reasons.append("culling decisions loading") }
        if isApplyingCullingDecision { reasons.append("culling decision write") }
        if isDeferringCullingWasteBasketUndo { reasons.append("Waste Basket undo") }
        if isRunningReview { reasons.append("Review update") }
        if isSavingReviewMetadata { reasons.append("Review metadata save") }
        if isRunningAIPass { reasons.append("AI proposal pass") }
        if isRunningAccess { reasons.append("access update") }
        if isRunningLifecycle { reasons.append("Waste Basket update") }
        if isRunningDelivery { reasons.append("delivery work") }
        if isRunningNativePublication { reasons.append("media upload") }
        if isSyncingPhotos { reasons.append("Apple Photos sync") }
        if isBackfillingEquipment { reasons.append("camera equipment backfill") }
        if isRunningR2Reconciliation { reasons.append("R2 reconciliation") }
        if isSavingMetadataModelLadder { reasons.append("AI model settings save") }
        return reasons
    }

    var hasActiveWork: Bool {
        !activeReasons.isEmpty
    }

    var hasNonAIPassActiveWork: Bool {
        activeReasons.count > (isRunningAIPass ? 1 : 0)
    }

    var canDetachAIPass: Bool {
        isRunningAIPass && isAIPassDetachable
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
            isDeferringCullingWasteBasketUndo: !cullingWasteBasketDeferredUndoActionIDs.isEmpty,
            isRunningReview: isRunningReview,
            isSavingReviewMetadata: hasPendingReviewMetadataAutosave,
            isRunningAIPass: isRunningAIPass,
            isAIPassDetachable: isRunningAIPass && fixtureAIStatus?.active == true,
            isRunningAccess: isRunningAccess,
            isRunningLifecycle: isRunningLifecycle,
            isRunningDelivery: isRunningDelivery,
            isRunningNativePublication: isRunningNativePublication,
            isSyncingPhotos: isSyncingPhotos,
            isBackfillingEquipment: isBackfillingEquipment,
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
    private var terminationCoordinator = BackstageTerminationCoordinator()
    private var drainTask: Task<Void, Never>?

    func attach(model: BackstageViewModel) {
        self.model = model
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let workState = model?.shutdownWorkState ?? BackstageShutdownWorkState()
        let disposition = terminationCoordinator.decide(workState: workState) {
            BackstageShutdownAlert.present(for: workState)
        }
        switch disposition {
        case .cancel:
            return .terminateCancel
        case .terminateNow:
            return .terminateNow
        case .alreadyPending:
            return .terminateLater
        case let .terminateLater(detachAIPass):
            beginGracefulTermination(sender, detachAIPass: detachAIPass)
            return .terminateLater
        }
    }

    private func beginGracefulTermination(
        _ sender: NSApplication,
        detachAIPass: Bool
    ) {
        let model = model
        drainTask = Task { @MainActor [weak self, model] in
            if detachAIPass {
                _ = model?.detachAIProposalPassForTermination()
            }
            await model?.prepareForTermination()
            await model?.waitForActiveWorkToFinish()
            guard let self, !Task.isCancelled else { return }
            self.drainTask = nil
            sender.reply(toApplicationShouldTerminate: true)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        drainTask?.cancel()
        drainTask = nil
        model = nil
    }
}
