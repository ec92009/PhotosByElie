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

enum BackstageWindowFrameStore {
    static let mainWindowAutosaveName = "PhotosByElieBackstage.MainWindow"

    static func preferenceKey(for autosaveName: String) -> String {
        "PhotosByElieBackstage.windowFrame.\(autosaveName)"
    }

    static func save(
        _ frame: NSRect,
        autosaveName: String,
        preferences: UserDefaults = .standard,
        synchronize: Bool = false
    ) {
        guard validFrame(frame) != nil else { return }
        preferences.set(
            NSStringFromRect(frame),
            forKey: preferenceKey(for: autosaveName)
        )
        if synchronize {
            preferences.synchronize()
        }
    }

    static func load(
        autosaveName: String,
        preferences: UserDefaults = .standard
    ) -> NSRect? {
        guard let storedValue = preferences.string(
            forKey: preferenceKey(for: autosaveName)
        ) else {
            return nil
        }
        return validFrame(NSRectFromString(storedValue))
    }

    private static func validFrame(_ frame: NSRect) -> NSRect? {
        guard frame.origin.x.isFinite,
              frame.origin.y.isFinite,
              frame.width.isFinite,
              frame.height.isFinite,
              frame.width > 0,
              frame.height > 0 else {
            return nil
        }
        return frame
    }
}

/// Gives the production window an AppKit autosave identity without moving the
/// SwiftUI scene lifecycle into an application delegate.
struct WindowFrameAutosaver: NSViewRepresentable {
    let name: String
    var preferences: UserDefaults = .standard

    func makeNSView(context: Context) -> WindowFrameAutosaveView {
        WindowFrameAutosaveView(name: name, preferences: preferences)
    }

    func updateNSView(_ nsView: WindowFrameAutosaveView, context: Context) {
        nsView.autosaveName = name
        nsView.configureWindowIfNeeded()
    }
}

final class WindowFrameAutosaveView: NSView {
    var autosaveName: String
    private let preferences: UserDefaults
    private weak var configuredWindow: NSWindow?

    init(name: String, preferences: UserDefaults = .standard) {
        self.autosaveName = name
        self.preferences = preferences
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if configuredWindow !== window {
            stopObservingWindowFrameChanges()
            configuredWindow = nil
        }
        configureWindowIfNeeded()
    }

    func configureWindowIfNeeded() {
        guard let window, configuredWindow !== window else { return }
        // The explicit preference is written on every move and resize. AppKit's
        // named autosave remains as a compatibility fallback for older builds.
        if let storedFrame = BackstageWindowFrameStore.load(
            autosaveName: autosaveName,
            preferences: preferences
        ) {
            window.setFrame(storedFrame, display: false)
        } else {
            window.setFrameUsingName(autosaveName)
        }
        if let restoredFrame = Self.visibleRestoredFrame(
            window.frame,
            screenFrames: NSScreen.screens.map(\.visibleFrame)
        ), restoredFrame != window.frame {
            window.setFrame(restoredFrame, display: false)
        }
        window.setFrameAutosaveName(autosaveName)
        configuredWindow = window
        startObservingWindowFrameChanges(window)
        persistCurrentWindowFrame()
    }

    private func startObservingWindowFrameChanges(_ window: NSWindow) {
        let center = NotificationCenter.default
        center.addObserver(
            self,
            selector: #selector(windowFrameDidChange(_:)),
            name: NSWindow.didMoveNotification,
            object: window
        )
        center.addObserver(
            self,
            selector: #selector(windowFrameDidChange(_:)),
            name: NSWindow.didResizeNotification,
            object: window
        )
        center.addObserver(
            self,
            selector: #selector(windowFrameDidChange(_:)),
            name: NSWindow.didEndLiveResizeNotification,
            object: window
        )
    }

    private func stopObservingWindowFrameChanges() {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func windowFrameDidChange(_ notification: Notification) {
        guard notification.object as? NSWindow === configuredWindow else { return }
        persistCurrentWindowFrame()
    }

    private func persistCurrentWindowFrame() {
        guard let configuredWindow else { return }
        BackstageWindowFrameStore.save(
            configuredWindow.frame,
            autosaveName: autosaveName,
            preferences: preferences
        )
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
