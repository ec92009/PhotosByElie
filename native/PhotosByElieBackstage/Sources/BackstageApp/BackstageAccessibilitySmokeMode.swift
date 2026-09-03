import Foundation
import OwnerCore

/// A private launch mode used only by the installed-app accessibility smoke.
///
/// It deliberately composes the production SwiftUI workspaces while replacing
/// Photos and every durable Owner store with inert dependencies. The mode is
/// never selected by a normal launch and carries no action that can mutate the
/// user's library, Owner database, cloud state, or saved Backstage preferences.
@MainActor
enum BackstageAccessibilitySmokeMode {
    static let launchArgument = "--pbe-accessibility-smoke-read-only"

    static func isEnabled(arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        arguments.contains(launchArgument)
    }

    static func makeModel() -> BackstageViewModel {
        let suiteName = "com.photosbyelie.backstage.accessibility-smoke.\(ProcessInfo.processInfo.processIdentifier)"
        let preferences = UserDefaults(suiteName: suiteName) ?? UserDefaults()
        preferences.removePersistentDomain(forName: suiteName)

        let model = BackstageViewModel(
            photoLibrary: BackstageAccessibilitySmokePhotoLibrary(),
            preferences: preferences,
            workflowRecoveryStore: nil,
            currentImageSizeCache: nil,
            currentEquipmentCache: nil,
            equipmentBackfillStore: nil,
            externalEditJobStore: nil,
            customerPhotoLinks: nil,
            isReadOnlyAccessibilitySmoke: true
        )
        model.selection = .overview
        model.status = "Read-only accessibility smoke"
        model.authenticationStatus = "Read-only installed-app accessibility smoke. No Owner session was opened."
        model.activityStatus = "Synthetic empty state. No Owner activity was requested."
        model.fixtureStatus = "Synthetic empty state. No fixture data was requested."
        model.accessStatus = "Synthetic empty state. No people or access data was requested."
        model.cullingStatus = "Synthetic empty state. No Photos or Owner data is connected."
        model.reviewStatus = "Synthetic empty state. No Review data was requested."
        model.lifecycleStatus = "Synthetic empty state. No lifecycle data was requested."
        model.nativeUploadStatus = "Synthetic empty state. No upload data was requested."
        model.deliveryStatus = "Synthetic empty state. No delivery data was requested."
        model.publicationStatus = "Synthetic empty state. No storage data was requested."
        model.r2ReconciliationStatus = "Synthetic empty state. No R2 storage data was requested."
        model.updateState = .failed(
            message: "Synthetic failure state for installed accessibility verification.",
            recovery: "No update request was made and no installed app was changed."
        )
        return model
    }
}

private struct BackstageAccessibilitySmokePhotoLibrary: PhotoLibraryServing, @unchecked Sendable {
    func authorization() -> PhotoLibraryAccess { .denied }

    func requestAuthorization() async -> PhotoLibraryAccess { .denied }

    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        throw PhotoLibraryError.previewUnavailable("Read-only accessibility smoke")
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.exportFailed("Read-only accessibility smoke never exports originals.")
    }
}
