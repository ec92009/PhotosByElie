import AppKit
import SwiftUI

enum BackstagePanelPreferenceKey {
    static let sidebarVisible = "PhotosByElieBackstage.navigationSidebarVisible"
    static let cullingInspectorVisible = "PhotosByElieBackstage.cullingPreviewPanelVisible"
    static let reviewInspectorVisible = "PhotosByElieBackstage.reviewPreviewPanelVisible"
    static let enrollmentFallbackExpanded = "PhotosByElieBackstage.enrollmentFallbackExpanded"
    static let fixturePlacementsExpanded = "PhotosByElieBackstage.fixturePlacementsExpanded"
    static let uploadRecoveryExpanded = "PhotosByElieBackstage.uploadRecoveryExpanded"
}

/// Gives the production window an AppKit autosave identity without moving the
/// SwiftUI scene lifecycle into an application delegate.
struct WindowFrameAutosaver: NSViewRepresentable {
    let name: String

    func makeNSView(context: Context) -> WindowFrameAutosaveView {
        WindowFrameAutosaveView(name: name)
    }

    func updateNSView(_ nsView: WindowFrameAutosaveView, context: Context) {
        nsView.autosaveName = name
        nsView.configureWindowIfNeeded()
    }
}

final class WindowFrameAutosaveView: NSView {
    var autosaveName: String
    private weak var configuredWindow: NSWindow?

    init(name: String) {
        self.autosaveName = name
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        configureWindowIfNeeded()
    }

    func configureWindowIfNeeded() {
        guard let window, configuredWindow !== window else { return }
        // AppKit saves this named frame as it changes and when the window
        // closes. The explicit restore below also repairs stale off-screen
        // geometry after a monitor arrangement changes.
        window.setFrameAutosaveName(autosaveName)
        if window.setFrameUsingName(autosaveName),
           let restoredFrame = Self.visibleRestoredFrame(
               window.frame,
               screenFrames: NSScreen.screens.map(\.visibleFrame)
           ), restoredFrame != window.frame {
            window.setFrame(restoredFrame, display: false)
        }
        configuredWindow = window
    }

    static func visibleRestoredFrame(
        _ frame: NSRect,
        screenFrames: [NSRect]
    ) -> NSRect? {
        guard frame.origin.x.isFinite,
              frame.origin.y.isFinite,
              frame.width.isFinite,
              frame.height.isFinite,
              frame.width > 0,
              frame.height > 0,
              let primaryScreen = screenFrames.first else {
            return nil
        }
        let requiredVisibleWidth = min(120, frame.width)
        let requiredVisibleHeight = min(80, frame.height)
        if screenFrames.contains(where: {
            let intersection = frame.intersection($0)
            return !intersection.isNull
                && intersection.width >= requiredVisibleWidth
                && intersection.height >= requiredVisibleHeight
        }) {
            return frame
        }

        let width = min(frame.width, primaryScreen.width)
        let height = min(frame.height, primaryScreen.height)
        return NSRect(
            x: min(max(frame.minX, primaryScreen.minX), primaryScreen.maxX - width),
            y: min(max(frame.minY, primaryScreen.minY), primaryScreen.maxY - height),
            width: width,
            height: height
        )
    }
}

/// Assigns a stable autosave name to the AppKit split view backing HSplitView,
/// preserving the user's divider position between launches.
struct SplitViewAutosaver: NSViewRepresentable {
    let name: String

    func makeNSView(context: Context) -> SplitViewAutosaveView {
        SplitViewAutosaveView(name: name)
    }

    func updateNSView(_ nsView: SplitViewAutosaveView, context: Context) {
        nsView.autosaveName = name
        nsView.configureSplitViewIfNeeded()
    }
}

final class SplitViewAutosaveView: NSView {
    var autosaveName: String
    private weak var configuredSplitView: NSSplitView?

    init(name: String) {
        self.autosaveName = name
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override func viewDidMoveToSuperview() {
        super.viewDidMoveToSuperview()
        configureSplitViewIfNeeded()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        configureSplitViewIfNeeded()
    }

    func configureSplitViewIfNeeded() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            var ancestor = self.superview
            while let view = ancestor {
                if let splitView = view as? NSSplitView {
                    guard self.configuredSplitView !== splitView else { return }
                    splitView.autosaveName = NSSplitView.AutosaveName(self.autosaveName)
                    self.configuredSplitView = splitView
                    return
                }
                ancestor = view.superview
            }
        }
    }
}
