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
    var cameraBody: String = ""
    var lens: String = ""
    var focalLength: String = ""
    var sourceSize: BackstageQuickLookSourceSize = .unavailable
    var rating: Int
    var color: String
    var state: String
    var shortcutHint: String
}

struct BackstageQuickLookEquipment: Equatable {
    var cameraBody: String
    var lens: String
    var focalLength: String

    var displayValue: String? {
        let camera = Self.normalizedCamera(cameraBody)
        let lens = Self.normalizedLens(lens)
        let focal = Self.normalizedFocalLength(focalLength)
        var value = camera
        if !lens.isEmpty {
            value = value.isEmpty ? lens : value + " with " + lens
        }
        if !focal.isEmpty {
            value = value.isEmpty ? focal : value + " at " + focal
        }
        return value.isEmpty ? nil : value
    }

    private static func normalizedCamera(_ raw: String) -> String {
        var value = collapsed(raw).uppercased()
        value = value.replacingOccurrences(of: "NIKON CORPORATION", with: "NIKON")
        value = collapsed(value)
        for brand in ["NIKON", "CANON", "SONY", "FUJIFILM", "PANASONIC", "LEICA", "OLYMPUS"] {
            let duplicate = brand + " " + brand + " "
            if value.hasPrefix(duplicate) {
                value = brand + " " + value.dropFirst(duplicate.count)
            }
        }
        return value
    }

    private static func normalizedLens(_ raw: String) -> String {
        let value = collapsed(raw).uppercased()
        guard !value.isEmpty else { return "" }
        if let range = captures(#"(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*MM"#, in: value),
           range.count == 2 {
            let brand = value.split(separator: " ").first.map(String.init) ?? ""
            return [brand, "ZOOM", compactNumber(range[0]) + "-" + compactNumber(range[1])]
                .filter { !$0.isEmpty }
                .joined(separator: " ")
        }
        return value
    }

    private static func normalizedFocalLength(_ raw: String) -> String {
        let value = collapsed(raw)
        guard !value.isEmpty else { return "" }
        if let focal = captures(#"^(\d+(?:\.\d+)?)\s*(?:MM)?"#, in: value.uppercased())?.first {
            return compactNumber(focal) + "mm"
        }
        return value
    }

    private static func compactNumber(_ raw: String) -> String {
        guard let value = Double(raw) else { return raw }
        return value.rounded() == value ? String(Int(value)) : String(value)
    }

    private static func collapsed(_ value: String) -> String {
        value.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    private static func captures(_ pattern: String, in value: String) -> [String]? {
        guard let expression = try? NSRegularExpression(pattern: pattern),
              let match = expression.firstMatch(
                in: value,
                range: NSRange(value.startIndex..., in: value)
              )
        else { return nil }
        return (1..<match.numberOfRanges).compactMap { index in
            guard let range = Range(match.range(at: index), in: value) else { return nil }
            return String(value[range])
        }
    }
}

struct BackstageQuickLookSourceSize: Equatable {
    var mediaType: String
    var pixelWidth: Int
    var pixelHeight: Int
    var byteCount: Int64
    var currentImageByteCount: Int64? = nil

    static let unavailable = BackstageQuickLookSourceSize(
        mediaType: "photo",
        pixelWidth: 0,
        pixelHeight: 0,
        byteCount: 0
    )

    var displayValue: String {
        var components = [dimensionDisplay]
        if !isVideo {
            components.append(megapixelDisplay)
        } else {
            components.append(byteDisplay)
        }
        return components.joined(separator: " / ")
    }

    var currentImageSizeDisplayValue: String? {
        guard !isVideo, let currentImageByteCount, currentImageByteCount > 0 else { return nil }
        return Self.formattedBytes(currentImageByteCount)
    }

    var currentImageSizeAccessibilityValue: String? {
        currentImageSizeDisplayValue.map { "Current image size " + $0 + "." }
    }

    var accessibilityValue: String {
        let kind = isVideo ? "Video source." : "Image source."
        let dimensions = hasDimensions
            ? "Dimensions " + String(pixelWidth) + " by " + String(pixelHeight) + " pixels."
            : "Dimensions unavailable."
        let megapixels = isVideo
            ? ""
            : (hasDimensions
                ? megapixelNumber + " megapixels."
                : "Megapixels unavailable.")
        let bytes = isVideo
            ? (byteCount > 0
                ? "Source file size " + Self.formattedBytes(byteCount) + "."
                : "Source file size unavailable.")
            : ""
        return [kind, dimensions, megapixels, bytes]
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    private var isVideo: Bool {
        let value = mediaType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return value == "video" || value == "movie"
    }

    private var hasDimensions: Bool {
        pixelWidth > 0 && pixelHeight > 0
    }

    private var dimensionDisplay: String {
        hasDimensions
            ? String(pixelWidth) + " × " + String(pixelHeight)
            : "Dimensions unavailable"
    }

    private var megapixelDisplay: String {
        hasDimensions ? megapixelNumber + " MP" : "Megapixels unavailable"
    }

    private var megapixelNumber: String {
        let megapixels = Double(pixelWidth) * Double(pixelHeight) / 1_000_000
        if megapixels >= 10 {
            return String(format: "%.0f", megapixels)
        }
        let value = String(format: "%.1f", megapixels)
        return value.hasSuffix(".0") ? String(value.dropLast(2)) : value
    }

    private var byteDisplay: String {
        byteCount > 0
            ? Self.formattedBytes(byteCount)
            : "File size unavailable"
    }

    private static func formattedBytes(_ value: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: value, countStyle: .file)
    }
}

enum BackstageQuickLookShortcut: Equatable {
    case previous
    case next
    case previousRow
    case nextRow
    case pick
    case hide
    case wasteBasket
    case approve
    case returnToReview
    case unpick
    case undo
    case rating(Int)
    case color(SidecarColor)

    var isGlobalDecisionMutation: Bool {
        switch self {
        case .rating, .color:
            true
        default:
            false
        }
    }

    var ownerSelectionDirection: OwnerSelectionDirection? {
        switch self {
        case .previous, .previousRow:
            .previous
        case .next, .nextRow:
            .next
        default:
            nil
        }
    }

    func selectionDelta(rowStride: Int) -> Int? {
        switch self {
        case .previous:
            -1
        case .next:
            1
        case .previousRow:
            -max(1, rowStride)
        case .nextRow:
            max(1, rowStride)
        default:
            nil
        }
    }

    static func navigationShortcut(forKeyCode keyCode: UInt16) -> Self? {
        switch keyCode {
        case 123: .previous
        case 124: .next
        case 126: .previousRow
        case 125: .nextRow
        default: nil
        }
    }

    static func shortcut(
        forKeyCode keyCode: UInt16,
        charactersIgnoringModifiers: String?,
        modifierFlags: NSEvent.ModifierFlags
    ) -> Self? {
        let guardedModifiers = modifierFlags.intersection([.command, .control, .option])
        if guardedModifiers.contains(.command) {
            guard guardedModifiers == [.command],
                  !modifierFlags.contains(.shift),
                  charactersIgnoringModifiers?.lowercased() == "z"
            else { return nil }
            return .undo
        }
        guard guardedModifiers.isEmpty else { return nil }
        if let navigation = navigationShortcut(forKeyCode: keyCode) {
            return navigation
        }
        return switch charactersIgnoringModifiers?.lowercased() {
        case "p": .pick
        case "h": .hide
        case "x": .wasteBasket
        case "a": .approve
        case "r": .returnToReview
        case "u": .unpick
        case "0": .rating(0)
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
    private static weak var activeCoordinator: BackstageQuickLookCoordinator?
    private final class PreviewItem: NSObject, QLPreviewItem {
        let previewItemURL: URL?
        let previewItemTitle: String?
        var metadata: BackstageQuickLookMetadata?

        init(url: URL, title: String, metadata: BackstageQuickLookMetadata?) {
            previewItemURL = url
            previewItemTitle = title
            self.metadata = metadata
        }
    }

    typealias PresentationID = UInt64

    private var items: [PreviewItem] = []
    private var presentationID: PresentationID = 0
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
        window.collectionBehavior = Self.originSpaceCollectionBehavior(
            from: [.fullScreenAuxiliary]
        )
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
        ownsSharedPreviewPanel && QLPreviewPanel.shared()?.isVisible == true
    }

    var ownsSharedPreviewPanel: Bool {
        Self.activeCoordinator === self
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

    /// Reserve the next Quick Look presentation before asynchronous photo
    /// preparation. Only the newest reservation may update the shared panel.
    func beginPresentation() -> PresentationID {
        presentationID &+= 1
        return presentationID
    }

    func isCurrentPresentation(_ candidate: PresentationID) -> Bool {
        candidate == presentationID
    }

    static func previewTitle(
        for url: URL,
        metadata: BackstageQuickLookMetadata?
    ) -> String {
        let filename = metadata?.filename.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return filename.isEmpty ? url.lastPathComponent : filename
    }

    static func originSpaceCollectionBehavior(
        from behavior: NSWindow.CollectionBehavior
    ) -> NSWindow.CollectionBehavior {
        var result = behavior
        result.remove(.canJoinAllSpaces)
        result.remove(.moveToActiveSpace)
        result.insert(.managed)
        return result
    }

    func present(
        urls: [URL],
        startingAt index: Int = 0,
        metadata: [BackstageQuickLookMetadata] = [],
        presentation candidate: PresentationID,
        onShortcut: ((BackstageQuickLookShortcut, String) -> Bool)? = nil
    ) {
        guard isOwnerActive else { return }
        guard isCurrentPresentation(candidate) else { return }
        guard !urls.isEmpty else { return }
        claimSharedPreviewPanelOwnership()
        items = urls.enumerated().map { offset, url in
            PreviewItem(
                url: url,
                title: Self.previewTitle(for: url, metadata: metadata.indices.contains(offset) ? metadata[offset] : nil),
                metadata: metadata.indices.contains(offset) ? metadata[offset] : nil
            )
        }
        guard let panel = QLPreviewPanel.shared() else { return }
        NSApp.activate(ignoringOtherApps: true)
        configureQuickLookFrame(panel)
        panel.dataSource = self
        panel.reloadData()
        panel.currentPreviewItemIndex = max(0, min(items.count - 1, index))
        panel.refreshCurrentPreviewItem()
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
        installMetadataPanel(in: panel)
        observePreviewIndex(in: panel)
        installShortcutMonitor(onShortcut: onShortcut)
    }

    func dismiss() {
        let closesSharedPanel = ownsSharedPreviewPanel
        relinquishSharedPreviewPanel(closePanel: closesSharedPanel)
        if closesSharedPanel {
            Self.activeCoordinator = nil
        }
    }

    /// Quick Look is a process-wide AppKit panel. SwiftUI keeps each workflow
    /// alive long enough that an outgoing view can otherwise retain its own
    /// accessory window beside the incoming workflow's preview.
    func claimSharedPreviewPanelOwnership() {
        guard !ownsSharedPreviewPanel else { return }
        Self.activeCoordinator?.relinquishSharedPreviewPanel(closePanel: false)
        Self.activeCoordinator = self
    }

    private func relinquishSharedPreviewPanel(closePanel: Bool) {
        presentationID &+= 1
        let panel = configuredPreviewPanel
        metadataWindow.parent?.removeChildWindow(metadataWindow)
        metadataWindow.orderOut(nil)
        if panel?.delegate === self {
            panel?.delegate = nil
        }
        if closePanel {
            (panel ?? QLPreviewPanel.shared())?.orderOut(nil)
        }
        configuredPreviewPanel = nil
        items = []
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
        guard ownsSharedPreviewPanel else { return }
        guard let previewItem = items.first(where: { $0.metadata?.assetID == item.assetID }) else {
            return
        }
        previewItem.metadata = item
        updateMetadataPanel()
    }

    func updateDecisionMetadata(
        for assetID: String,
        rating: Int? = nil,
        color: SidecarColor? = nil
    ) {
        guard ownsSharedPreviewPanel else { return }
        guard let previewItem = items.first(where: { $0.metadata?.assetID == assetID }),
              var metadata = previewItem.metadata
        else {
            return
        }
        if let rating {
            metadata.rating = min(5, max(0, rating))
        }
        if let color {
            metadata.color = color.rawValue
        }
        previewItem.metadata = metadata
        updateMetadataPanel()
    }

    func decisionColorValue(for assetID: String) -> String {
        guard ownsSharedPreviewPanel else { return "" }
        return items.first(where: { $0.metadata?.assetID == assetID })?.metadata?.color ?? ""
    }

    private func installShortcutMonitor(
        onShortcut: ((BackstageQuickLookShortcut, String) -> Bool)?
    ) {
        removeShortcutMonitor()
        guard let onShortcut else { return }
        shortcutMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard self.ownsSharedPreviewPanel,
                  QLPreviewPanel.shared()?.isVisible == true,
                  let shortcut = BackstageQuickLookShortcut.shortcut(
                      forKeyCode: event.keyCode,
                      charactersIgnoringModifiers: event.charactersIgnoringModifiers,
                      modifierFlags: event.modifierFlags
                  ),
                  let item = self.currentMetadata,
                  onShortcut(shortcut, item.assetID)
            else {
                return event
            }
            return nil
        }
    }

    private var currentMetadata: BackstageQuickLookMetadata? {
        guard ownsSharedPreviewPanel else { return nil }
        guard let panel = QLPreviewPanel.shared() else { return nil }
        let index = panel.currentPreviewItemIndex
        guard items.indices.contains(index) else { return nil }
        return items[index].metadata
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
        panel.collectionBehavior = Self.originSpaceCollectionBehavior(
            from: panel.collectionBehavior
        )
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
        if let equipment = BackstageQuickLookEquipment(
            cameraBody: item.cameraBody,
            lens: item.lens,
            focalLength: item.focalLength
        ).displayValue {
            addMetadataRow("Equipment", value: equipment)
        }
        addMetadataRow(
            "Dimensions",
            value: item.sourceSize.displayValue,
            accessibilityValue: item.sourceSize.accessibilityValue
        )
        if let currentImageSize = item.sourceSize.currentImageSizeDisplayValue {
            addMetadataRow(
                "Current image size",
                value: currentImageSize,
                accessibilityValue: item.sourceSize.currentImageSizeAccessibilityValue
            )
        }
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
        let metadataHeight: CGFloat = 335
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
              let url = items[index].previewItemURL,
              let image = NSImage(contentsOf: url),
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
                        guard let self, self.ownsSharedPreviewPanel, let panel else { return }
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

    private func addMetadataRow(
        _ label: String,
        value: String,
        accessibilityValue: String? = nil
    ) {
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
        if let accessibilityValue {
            detail.setAccessibilityLabel(label)
            detail.setAccessibilityValue(accessibilityValue)
        }
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

/// Routes global rating and color mutations for every Backstage Quick Look
/// surface. Workspace-specific presenters remain responsible only for their
/// local navigation and placement actions.
@MainActor
enum BackstageQuickLookDecisionRouter {
    static let shortcutHint = "0–5 rating • 6–9 toggle color"

    @discardableResult
    static func handle(
        _ shortcut: BackstageQuickLookShortcut,
        assetID: String,
        model: BackstageViewModel,
        coordinator: BackstageQuickLookCoordinator,
        completion: @escaping @MainActor (Bool) -> Void = { _ in }
    ) -> Bool {
        guard !model.isApplyingCullingDecision else { return false }
        switch shortcut {
        case let .rating(value):
            Task { @MainActor [weak model, weak coordinator] in
                guard let model, let coordinator else { return }
                let succeeded = await model.applyQuickLookRating(
                    value,
                    assetID: assetID
                )
                if succeeded {
                    coordinator.updateDecisionMetadata(
                        for: assetID,
                        rating: value
                    )
                }
                completion(succeeded)
            }
            return true
        case let .color(value):
            Task { @MainActor [weak model, weak coordinator] in
                guard let model, let coordinator else { return }
                let target = value.toggleTarget(
                    for: [coordinator.decisionColorValue(for: assetID)]
                )
                let succeeded = await model.applyQuickLookColor(
                    target,
                    assetID: assetID
                )
                if succeeded {
                    coordinator.updateDecisionMetadata(
                        for: assetID,
                        color: target
                    )
                }
                completion(succeeded)
            }
            return true
        default:
            return false
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
