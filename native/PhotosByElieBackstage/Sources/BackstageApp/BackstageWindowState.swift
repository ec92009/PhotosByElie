import AppKit
import SwiftUI

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
        window.setFrameAutosaveName(autosaveName)
        _ = window.setFrameUsingName(autosaveName)
        configuredWindow = window
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
