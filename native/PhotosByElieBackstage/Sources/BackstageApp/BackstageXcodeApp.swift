#if BACKSTAGE_XCODE_HOST
import SwiftUI

/// Native entry point for the developer-only Xcode Canvas host.
///
/// SwiftPM continues to enter through `Sources/BackstageLauncher/main.swift`.
@main
private struct BackstageXcodeApplication: App {
    var body: some Scene {
        BackstageApplication().body
    }
}

#endif
