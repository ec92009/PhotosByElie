import Foundation
import OwnerCore

/// Owner-facing update coordination while verification and installation remain
/// in their dedicated `OwnerCore` services.
///
/// The view model publishes this value as its SwiftUI boundary. This holder
/// owns immediate busy latches and request generations so stale check/download
/// callbacks cannot replace a newer update or install state.
struct BackstageUpdateWorkflowState {
    private(set) var state: BackstageUpdateState = .idle
    private(set) var operationSerial = 0

    var isOperationInProgress: Bool {
        switch state {
        case .checking, .updateAvailable, .downloading, .installing:
            true
        case .idle, .current, .verified, .installed, .failed:
            false
        }
    }

    var existingVerifiedUpdate: BackstageVerifiedUpdate? {
        guard case let .verified(update) = state else { return nil }
        return update
    }

    func shouldAutomaticallyCheck(canPerformActions: Bool) -> Bool {
        guard canPerformActions else { return false }
        return switch state {
        case .idle, .current, .verified, .failed:
            true
        case .checking, .updateAvailable, .downloading, .installing, .installed:
            false
        }
    }

    mutating func replaceState(_ state: BackstageUpdateState) {
        operationSerial += 1
        self.state = state
    }

    mutating func beginCheck() -> Int {
        operationSerial += 1
        state = .checking
        return operationSerial
    }

    func owns(_ serial: Int) -> Bool {
        serial == operationSerial
    }

    /// Applies discovery and returns the manifest that must be downloaded now.
    mutating func resolveCheck(
        _ check: BackstageUpdateCheck,
        existingVerifiedUpdate: BackstageVerifiedUpdate?,
        serial: Int
    ) -> BackstageReleaseManifest? {
        guard owns(serial) else { return nil }
        switch check.availability {
        case .current:
            state = .current(check.manifest)
            return nil
        case .updateAvailable:
            if let existingVerifiedUpdate,
               existingVerifiedUpdate.manifest == check.manifest {
                state = .verified(existingVerifiedUpdate)
                return nil
            }
            state = .updateAvailable(check.manifest)
            return check.manifest
        case .downgradeRejected:
            let error = BackstageUpdateError.downgradeRejected
            state = .failed(
                message: error.localizedDescription,
                recovery: error.recoveryGuidance
            )
            return nil
        case .incompatible:
            let error = BackstageUpdateError.incompatible(
                "The cloud release is not compatible with this Backstage installation or Mac."
            )
            state = .failed(
                message: error.localizedDescription,
                recovery: error.recoveryGuidance
            )
            return nil
        }
    }

    mutating func beginDownload(_ manifest: BackstageReleaseManifest) -> Int {
        operationSerial += 1
        state = .downloading(
            manifest,
            receivedBytes: 0,
            totalBytes: manifest.fileSize
        )
        return operationSerial
    }

    mutating func recordDownloadProgress(
        manifest: BackstageReleaseManifest,
        receivedBytes: Int64,
        totalBytes: Int64,
        serial: Int
    ) {
        guard owns(serial),
              case let .downloading(activeManifest, _, _) = state,
              activeManifest == manifest else { return }
        state = .downloading(
            manifest,
            receivedBytes: receivedBytes,
            totalBytes: totalBytes > 0 ? totalBytes : manifest.fileSize
        )
    }

    mutating func finishDownload(_ update: BackstageVerifiedUpdate, serial: Int) {
        guard owns(serial) else { return }
        state = .verified(update)
    }

    mutating func beginInstall() -> (serial: Int, update: BackstageVerifiedUpdate)? {
        guard case let .verified(update) = state else { return nil }
        operationSerial += 1
        state = .installing(update.manifest)
        return (operationSerial, update)
    }

    mutating func finishInstall(_ receipt: BackstageInstallationReceipt, serial: Int) {
        guard owns(serial) else { return }
        state = .installed(receipt)
    }

    mutating func fail(_ error: BackstageUpdateError, serial: Int) {
        guard owns(serial) else { return }
        state = .failed(
            message: error.localizedDescription,
            recovery: error.recoveryGuidance
        )
    }

    mutating func fail(message: String, recovery: String, serial: Int) {
        guard owns(serial) else { return }
        state = .failed(message: message, recovery: recovery)
    }
}
