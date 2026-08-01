import AppKit
import OwnerCore
import Quartz

struct BackstageQuickLookMetadata: Equatable {
    var assetID: String
    var filename: String
    var title: String
    var keywords: [String]
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
final class BackstageQuickLookCoordinator: NSObject, ObservableObject, @preconcurrency QLPreviewPanelDataSource {
    private var items: [NSURL] = []
    private var metadata: [BackstageQuickLookMetadata] = []
    private var shortcutMonitor: Any?
    private var previewIndexObservation: NSKeyValueObservation?
    private let metadataPanel = NSVisualEffectView()
    private let metadataStack = NSStackView()
    private var isMetadataPanelConfigured = false

    var isVisible: Bool {
        QLPreviewPanel.shared()?.isVisible == true
    }

    func present(
        urls: [URL],
        startingAt index: Int = 0,
        metadata: [BackstageQuickLookMetadata] = [],
        onShortcut: ((BackstageQuickLookShortcut, String) -> Bool)? = nil
    ) {
        items = urls.map { $0 as NSURL }
        self.metadata = metadata
        guard let panel = QLPreviewPanel.shared() else { return }
        panel.dataSource = self
        panel.currentPreviewItemIndex = max(0, min(items.count - 1, index))
        panel.reloadData()
        panel.makeKeyAndOrderFront(nil)
        installMetadataPanel(in: panel)
        observePreviewIndex(in: panel)
        installShortcutMonitor(onShortcut: onShortcut)
    }

    func dismiss() {
        QLPreviewPanel.shared()?.orderOut(nil)
        items = []
        metadata = []
        previewIndexObservation = nil
        metadataPanel.removeFromSuperview()
        removeShortcutMonitor()
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
        guard let contentView = panel.contentView else { return }
        metadataPanel.removeFromSuperview()
        metadataPanel.material = .hudWindow
        metadataPanel.blendingMode = .withinWindow
        metadataPanel.state = .active
        metadataPanel.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(metadataPanel)

        if !isMetadataPanelConfigured {
            metadataStack.orientation = .vertical
            metadataStack.alignment = .leading
            metadataStack.spacing = 8
            metadataStack.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
            metadataStack.translatesAutoresizingMaskIntoConstraints = false
            metadataPanel.addSubview(metadataStack)
            NSLayoutConstraint.activate([
                metadataPanel.widthAnchor.constraint(equalToConstant: 300),
                metadataStack.topAnchor.constraint(equalTo: metadataPanel.topAnchor),
                metadataStack.leadingAnchor.constraint(equalTo: metadataPanel.leadingAnchor),
                metadataStack.trailingAnchor.constraint(equalTo: metadataPanel.trailingAnchor),
                metadataStack.bottomAnchor.constraint(lessThanOrEqualTo: metadataPanel.bottomAnchor),
            ])
            isMetadataPanelConfigured = true
        }

        NSLayoutConstraint.activate([
            metadataPanel.topAnchor.constraint(equalTo: contentView.topAnchor),
            metadataPanel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            metadataPanel.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
        ])
        updateMetadataPanel()
    }

    private func updateMetadataPanel() {
        metadataStack.arrangedSubviews.forEach {
            metadataStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        guard let item = currentMetadata else {
            metadataPanel.isHidden = true
            return
        }
        metadataPanel.isHidden = false
        let heading = NSTextField(labelWithString: "Preview metadata")
        heading.font = .systemFont(ofSize: 15, weight: .semibold)
        metadataStack.addArrangedSubview(heading)
        addMetadataRow("File", value: item.filename)
        addMetadataRow("Title", value: item.title.isEmpty ? "Untitled" : item.title)
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
    }

    private func addMetadataRow(_ label: String, value: String) {
        let heading = NSTextField(labelWithString: label.uppercased())
        heading.font = .systemFont(ofSize: 10, weight: .semibold)
        heading.textColor = .secondaryLabelColor
        let detail = NSTextField(wrappingLabelWithString: value)
        detail.font = .systemFont(ofSize: 12)
        detail.maximumNumberOfLines = 4
        metadataStack.addArrangedSubview(heading)
        metadataStack.addArrangedSubview(detail)
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
