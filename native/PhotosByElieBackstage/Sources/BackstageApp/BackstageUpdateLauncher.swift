import AppKit
import Foundation

enum BackstageInstalledUpdateLaunchError: LocalizedError {
    case launchFailed(String)

    var errorDescription: String? {
        switch self {
        case let .launchFailed(detail):
            detail.isEmpty
                ? "macOS did not start the newly installed Backstage app."
                : detail
        }
    }
}

@MainActor
protocol BackstageInstalledUpdateLaunching {
    func launchAndTerminateCurrentApplication(at bundleURL: URL) async throws
}

@MainActor
struct SystemBackstageInstalledUpdateLauncher: BackstageInstalledUpdateLaunching {
    func launchAndTerminateCurrentApplication(at bundleURL: URL) async throws {
        Self.persistCurrentWindowFrame()
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            NSWorkspace.shared.openApplication(
                at: bundleURL,
                configuration: configuration
            ) { application, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let application, !application.isTerminated {
                    continuation.resume()
                } else if application != nil {
                    continuation.resume(throwing: BackstageInstalledUpdateLaunchError.launchFailed(
                        "The newly installed Backstage app exited before the handoff completed."
                    ))
                } else {
                    continuation.resume(throwing: BackstageInstalledUpdateLaunchError.launchFailed(""))
                }
            }
        }
        NSApp.terminate(nil)
    }

    static func persistCurrentWindowFrame(
        _ window: NSWindow? = NSApp.keyWindow ?? NSApp.mainWindow,
        preferences: UserDefaults = .standard
    ) {
        guard let window else { return }
        // Live move/resize persistence is the authority. The AppKit frame can
        // briefly diverge during SwiftUI layout or macOS zoom/cascade work;
        // copying that transient frame here would destroy the user's last
        // settled geometry immediately before launching the new process.
        let handoffFrame = BackstageWindowFrameStore.load(
            autosaveName: BackstageWindowFrameStore.mainWindowAutosaveName,
            preferences: preferences
        ) ?? window.frame
        BackstageWindowFrameStore.stageUpdateHandoff(
            handoffFrame,
            autosaveName: BackstageWindowFrameStore.mainWindowAutosaveName,
            preferences: preferences
        )
    }
}
