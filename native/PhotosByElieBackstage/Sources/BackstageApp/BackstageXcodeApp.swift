#if BACKSTAGE_XCODE_HOST
import SwiftUI

/// Native entry point for the developer-only Xcode Canvas host.
///
/// SwiftPM continues to enter through `Sources/BackstageLauncher/main.swift`.
/// The host scene stays deliberately empty: Xcode injects each `#Preview`
/// into this process, so constructing the production application here would
/// also start its Keychain authentication and Photos synchronization tasks.
@main
private struct BackstageXcodeApplication: App {
    var body: some Scene {
        WindowGroup("Backstage Canvas Host") {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityHidden(true)
        }
    }
}

#endif
