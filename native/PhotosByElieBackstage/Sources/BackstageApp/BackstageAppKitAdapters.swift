import AppKit
import OwnerCore
import Quartz

struct BackstageQuickLookMetadata: Equatable {
    var assetID: String
    var filename: String
    var title: String
    var keywords: [String]
    var locationLabel: String
    var capturedAt: String
    var rating: Int
    var color: String
    var state: String
    var shortcutHint: String
}

enum BackstageQuickLookShortcut: Equatable {
    case previous
    case next
    case pick
    case hide
    case approve
    case returnToReview
    case unpick
    case rating(Int)
    case color(SidecarColor)
}

@MainActor
final class BackstageSelectionController: ObservableObject {
    @Published private(set) var selection = OwnerSelectionModel<String>()

    func replaceItems(_ ids: [String]) {
        selection.replaceItems(ids)
    }

    func click(_ id: String, modifiers: NSEvent.ModifierFlags) {
        selection.click(
            id,
            extending: modifiers.contains(.shift),
            toggling: modifiers.contains(.command)
        )
    }

    func move(_ direction: OwnerSelectionDirection, modifiers: NSEvent.ModifierFlags) {
        selection.move(direction, extending: modifiers.contains(.shift))
    }

    func selectAll() {
        selection.selectAll()
    }

    func clear() {
        selection.clear()
    }
}

@MainActor
final class BackstageQuickLookCoordinator: NSObject, ObservableObject, NSWindowDelegate, @preconcurrency QLPreviewPanelDataSource {
    private var items: [NSURL] = []
    private var metadata: [BackstageQuickLookMetadata] = []
    private var shortcutMonitor: Any?
    private var previewIndexObservation: NSKeyValueObservation?
    private var previewPanelObservers: [NSObjectProtocol] = []
    private weak var configuredPreviewPanel: QLPreviewPanel?
    private let metadataPanel = NSVisualEffectView()
    private let metadataStack = NSStackView()
    private lazy var metadataWindow: NSPanel = {
        let window = NSPanel(
            contentRect: .zero,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = true
        window.hidesOnDeactivate = false
        window.ignoresMouseEvents = true
        window.isReleasedWhenClosed = false
        window.collectionBehavior = [.fullScreenAuxiliary]
        return window
    }()
    private var isMetadataPanelConfigured = false
    private var isOwnerActive = true
    private static let quickLookFrameAutosaveName =
        "PhotosByElieBackstage.QuickLookWindow"

    private enum MetadataPlacement {
        case beside
        case below
    }

    var isVisible: Bool {
        QLPreviewPanel.shared()?.isVisible == true
    }

    static func isConfiguredQuickLookPanel(
        _ sender: NSWindow,
        configuredPanel: NSWindow?
    ) -> Bool {
        sender === configuredPanel
    }

    func activate() {
        isOwnerActive = true
    }

    func deactivate() {
        isOwnerActive = false
        dismiss()
    }

    func present(
        urls: [URL],
        startingAt index: Int = 0,
        metadata: [BackstageQuickLookMetadata] = [],
        onShortcut: ((BackstageQuickLookShortcut, String) -> Bool)? = nil
    ) {
        guard isOwnerActive else { return }
        guard !urls.isEmpty else { return }
        items = urls.map { $0 as NSURL }
        self.metadata = metadata
        guard let panel = QLPreviewPanel.shared() else { return }
        NSApp.activate(ignoringOtherApps: true)
        configureQuickLookFrame(panel)
        panel.dataSource = self
        panel.currentPreviewItemIndex = max(0, min(items.count - 1, index))
        panel.reloadData()
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
        installMetadataPanel(in: panel)
        observePreviewIndex(in: panel)
        installShortcutMonitor(onShortcut: onShortcut)
    }

    func dismiss() {
        let panel = configuredPreviewPanel ?? QLPreviewPanel.shared()
        metadataWindow.parent?.removeChildWindow(metadataWindow)
        metadataWindow.orderOut(nil)
        panel?.orderOut(nil)
        panel?.delegate = nil
        configuredPreviewPanel = nil
        items = []
        metadata = []
        previewIndexObservation = nil
        removePreviewPanelObservers()
        removeShortcutMonitor()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard let panel = sender as? QLPreviewPanel,
              Self.isConfiguredQuickLookPanel(
                  panel,
                  configuredPanel: configuredPreviewPanel
              )
        else {
            return true
        }

        // Route the red close control through the same cleanup path as Escape
        // so Quick Look closes without terminating or destabilizing Backstage.
        dismiss()
        return false
    }

    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        items.count
    }

    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
        items[index]
    }

    func updateMetadata(_ item: BackstageQuickLookMetadata) {
        guard let index = metadata.firstIndex(where: { $0.assetID == item.assetID }) else {
            return
        }
        metadata[index] = item
        updateMetadataPanel()
    }

    private func installShortcutMonitor(
        onShortcut: ((BackstageQuickLookShortcut, String) -> Bool)?
    ) {
        removeShortcutMonitor()
        guard let onShortcut else { return }
        shortcutMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard QLPreviewPanel.shared()?.isVisible == true,
                  event.modifierFlags.intersection([.command, .control, .option]).isEmpty,
                  let shortcut = self.shortcut(for: event),
                  let item = self.currentMetadata,
                  onShortcut(shortcut, item.assetID)
            else {
                return event
            }
            return nil
        }
    }

    private func shortcut(for event: NSEvent) -> BackstageQuickLookShortcut? {
        switch event.keyCode {
        case 123: return .previous
        case 124: return .next
        default: break
        }
        return switch event.charactersIgnoringModifiers?.lowercased() {
        case "p": .pick
        case "h": .hide
        case "a": .approve
        case "r": .returnToReview
        case "u": .unpick
        case "1": .rating(1)
        case "2": .rating(2)
        case "3": .rating(3)
        case "4": .rating(4)
        case "5": .rating(5)
        case "6": .color(.red)
        case "7": .color(.yellow)
        case "8": .color(.green)
        case "9": .color(.blue)
        default: nil
        }
    }

    private var currentMetadata: BackstageQuickLookMetadata? {
        guard let panel = QLPreviewPanel.shared() else { return nil }
        let index = panel.currentPreviewItemIndex
        guard metadata.indices.contains(index) else { return nil }
        return metadata[index]
    }

    private func observePreviewIndex(in panel: QLPreviewPanel) {
        previewIndexObservation = panel.observe(\.currentPreviewItemIndex, options: [.initial, .new]) {
            [weak self] _, _ in
            Task { @MainActor [weak self] in
                self?.updateMetadataPanel()
            }
        }
    }

    private func installMetadataPanel(in panel: QLPreviewPanel) {
        configureQuickLookFrame(panel)
        configureMetadataPanel()
        if metadataWindow.parent !== panel {
            metadataWindow.parent?.removeChildWindow(metadataWindow)
            panel.addChildWindow(metadataWindow, ordered: .above)
        }
        observePreviewPanelGeometry(panel)
        metadataWindow.orderFront(nil)
        updateMetadataPanel()
    }

    private func configureQuickLookFrame(_ panel: QLPreviewPanel) {
        guard configuredPreviewPanel !== panel else { return }
        panel.setFrameAutosaveName(Self.quickLookFrameAutosaveName)
        _ = panel.setFrameUsingName(Self.quickLookFrameAutosaveName)
        configuredPreviewPanel = panel
        panel.delegate = self
    }

    private func configureMetadataPanel() {
        guard !isMetadataPanelConfigured else { return }
        metadataPanel.material = .hudWindow
        metadataPanel.blendingMode = .behindWindow
        metadataPanel.state = .active
        metadataPanel.wantsLayer = true
        metadataPanel.layer?.cornerRadius = 12
        metadataPanel.layer?.masksToBounds = true
        metadataWindow.contentView = metadataPanel

        metadataStack.orientation = .vertical
        metadataStack.alignment = .width
        metadataStack.spacing = 5
        metadataStack.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        metadataStack.translatesAutoresizingMaskIntoConstraints = false
        metadataPanel.addSubview(metadataStack)
        NSLayoutConstraint.activate([
            metadataStack.topAnchor.constraint(equalTo: metadataPanel.topAnchor),
            metadataStack.leadingAnchor.constraint(equalTo: metadataPanel.leadingAnchor),
            metadataStack.trailingAnchor.constraint(equalTo: metadataPanel.trailingAnchor),
            metadataStack.bottomAnchor.constraint(equalTo: metadataPanel.bottomAnchor),
        ])
        isMetadataPanelConfigured = true
    }

    private func updateMetadataPanel() {
        metadataStack.arrangedSubviews.forEach {
            metadataStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        guard let item = currentMetadata else {
            metadataWindow.orderOut(nil)
            return
        }
        metadataWindow.orderFront(nil)
        let heading = NSTextField(labelWithString: "Preview metadata")
        heading.font = .systemFont(ofSize: 15, weight: .semibold)
        metadataStack.addArrangedSubview(heading)
        addMetadataRow("File", value: item.filename)
        addMetadataRow("Title", value: item.title.isEmpty ? "Untitled" : item.title)
        addMetadataRow(
            "Location",
            value: item.locationLabel.isEmpty ? "None" : item.locationLabel
        )
        addMetadataRow(
            "Keywords",
            value: item.keywords.isEmpty ? "None" : item.keywords.joined(separator: ", ")
        )
        addMetadataRow("Captured", value: item.capturedAt.isEmpty ? "Unknown" : item.capturedAt)
        addMetadataRow("Rating", value: item.rating == 0 ? "Unrated" : String(repeating: "★", count: item.rating))
        addMetadataRow("Color", value: item.color.isEmpty ? "None" : item.color.capitalized)
        addMetadataRow("State", value: item.state.capitalized)
        let shortcuts = NSTextField(
            wrappingLabelWithString: item.shortcutHint
        )
        shortcuts.font = .systemFont(ofSize: 11)
        shortcuts.textColor = .secondaryLabelColor
        metadataStack.addArrangedSubview(shortcuts)
        if let panel = configuredPreviewPanel {
            positionMetadataWindow(relativeTo: panel)
        }
    }

    private func positionMetadataWindow(relativeTo panel: QLPreviewPanel) {
        let placement = currentMetadataPlacement
        let gap: CGFloat = 8
        let metadataHeight: CGFloat = 280
        let metadataWidth: CGFloat = placement == .beside ? 320 : panel.frame.width
        var panelFrame = panel.frame

        if let visibleFrame = panel.screen?.visibleFrame {
            switch placement {
            case .beside:
                panelFrame.size.width = min(
                    panelFrame.width,
                    max(420, visibleFrame.width - metadataWidth - gap)
                )
                panelFrame.origin.x = min(
                    max(panelFrame.minX, visibleFrame.minX),
                    visibleFrame.maxX - panelFrame.width - metadataWidth - gap
                )
                panelFrame.origin.y = min(
                    max(panelFrame.minY, visibleFrame.minY),
                    visibleFrame.maxY - panelFrame.height
                )
            case .below:
                panelFrame.size.height = min(
                    panelFrame.height,
                    max(360, visibleFrame.height - metadataHeight - gap)
                )
                panelFrame.origin.x = min(
                    max(panelFrame.minX, visibleFrame.minX),
                    visibleFrame.maxX - panelFrame.width
                )
                panelFrame.origin.y = min(
                    max(panelFrame.minY, visibleFrame.minY + metadataHeight + gap),
                    visibleFrame.maxY - panelFrame.height
                )
            }
        }
        if panel.frame != panelFrame {
            panel.setFrame(panelFrame, display: true)
        }

        let metadataFrame: NSRect
        switch placement {
        case .beside:
            metadataFrame = NSRect(
                x: panelFrame.maxX + gap,
                y: panelFrame.maxY - metadataHeight,
                width: metadataWidth,
                height: metadataHeight
            )
        case .below:
            metadataFrame = NSRect(
                x: panelFrame.minX,
                y: panelFrame.minY - metadataHeight - gap,
                width: panelFrame.width,
                height: metadataHeight
            )
        }
        metadataWindow.setFrame(metadataFrame, display: true)
    }

    private var currentMetadataPlacement: MetadataPlacement {
        guard let panel = configuredPreviewPanel else { return .below }
        let index = panel.currentPreviewItemIndex
        guard items.indices.contains(index),
              let image = NSImage(contentsOf: items[index] as URL),
              image.size.width > 0,
              image.size.height > image.size.width
        else {
            return .below
        }
        return .beside
    }

    private func observePreviewPanelGeometry(_ panel: QLPreviewPanel) {
        removePreviewPanelObservers()
        for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
            previewPanelObservers.append(
                NotificationCenter.default.addObserver(
                    forName: name,
                    object: panel,
                    queue: .main
                ) { [weak self, weak panel] _ in
                    Task { @MainActor [weak self, weak panel] in
                        guard let self, let panel else { return }
                        self.positionMetadataWindow(relativeTo: panel)
                    }
                }
            )
        }
    }

    private func removePreviewPanelObservers() {
        previewPanelObservers.forEach(NotificationCenter.default.removeObserver)
        previewPanelObservers = []
    }

    private func addMetadataRow(_ label: String, value: String) {
        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .firstBaseline
        row.spacing = 8
        let heading = NSTextField(labelWithString: label.uppercased())
        heading.font = .systemFont(ofSize: 10, weight: .semibold)
        heading.textColor = .secondaryLabelColor
        heading.alignment = .right
        heading.widthAnchor.constraint(equalToConstant: 64).isActive = true
        let detail = NSTextField(wrappingLabelWithString: value)
        detail.font = .systemFont(ofSize: 12)
        detail.maximumNumberOfLines = 2
        detail.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        row.addArrangedSubview(heading)
        row.addArrangedSubview(detail)
        metadataStack.addArrangedSubview(row)
    }

    private func removeShortcutMonitor() {
        if let shortcutMonitor {
            NSEvent.removeMonitor(shortcutMonitor)
            self.shortcutMonitor = nil
        }
    }

}

@MainActor
final class BackstageContextMenuAction: NSObject {
    let handler: () -> Void

    init(handler: @escaping () -> Void) {
        self.handler = handler
    }

    @objc func invoke() {
        handler()
    }
}

@MainActor
final class BackstageContextMenuFactory {
    private var retainedActions: [BackstageContextMenuAction] = []

    func makeMenu(_ actions: [(title: String, handler: () -> Void)]) -> NSMenu {
        retainedActions = actions.map { BackstageContextMenuAction(handler: $0.handler) }
        let menu = NSMenu()
        for (index, action) in actions.enumerated() {
            let item = NSMenuItem(
                title: action.title,
                action: #selector(BackstageContextMenuAction.invoke),
                keyEquivalent: ""
            )
            item.target = retainedActions[index]
            menu.addItem(item)
        }
        return menu
    }
}
