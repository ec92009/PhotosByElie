import AppKit
import OwnerCore
import Quartz

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
final class BackstageQuickLookCoordinator: NSObject, @preconcurrency QLPreviewPanelDataSource {
    private var items: [NSURL] = []

    func present(urls: [URL], startingAt index: Int = 0) {
        items = urls.map { $0 as NSURL }
        guard let panel = QLPreviewPanel.shared() else { return }
        panel.dataSource = self
        panel.currentPreviewItemIndex = max(0, min(items.count - 1, index))
        panel.reloadData()
        panel.makeKeyAndOrderFront(nil)
    }

    func dismiss() {
        QLPreviewPanel.shared()?.orderOut(nil)
        items = []
    }

    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        items.count
    }

    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
        items[index]
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
