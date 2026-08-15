import AppKit
import SwiftUI

/// Chooses a tooltip rectangle in a window-local coordinate space.
///
/// AppKit's origin is at the lower-left, so the preferred position is below
/// the hovered control. When that does not fit, the tooltip moves above it;
/// either position is then clamped to the available content rect.
struct BackstageTooltipPlacement {
    static let gap: CGFloat = 8
    static let windowMargin: CGFloat = 12
    static let horizontalPadding: CGFloat = 12
    static let verticalPadding: CGFloat = 9

    static func constrainedSize(
        _ tooltipSize: CGSize,
        in available: CGRect
    ) -> CGSize {
        guard available.width > 0, available.height > 0 else { return .zero }

        return CGSize(
            width: min(max(0, tooltipSize.width), available.width),
            height: min(max(0, tooltipSize.height), available.height)
        )
    }

    static func rect(
        for anchor: CGRect,
        tooltipSize: CGSize,
        in available: CGRect,
        gap: CGFloat = Self.gap
    ) -> CGRect {
        guard available.width > 0, available.height > 0 else { return .zero }

        let size = constrainedSize(tooltipSize, in: available)
        let width = size.width
        let height = size.height
        let maxX = available.maxX - width
        let x = min(max(anchor.midX - (width / 2), available.minX), maxX)

        let belowY = anchor.minY - gap - height
        let aboveY = anchor.maxY + gap
        let y: CGFloat
        if belowY >= available.minY {
            y = belowY
        } else if aboveY + height <= available.maxY {
            y = aboveY
        } else {
            y = min(max(belowY, available.minY), available.maxY - height)
        }

        return CGRect(x: x, y: y, width: width, height: height)
    }
}

/// Presents an action-specific explanation after a deliberate half-second hover.
///
/// SwiftUI's native `help` modifier follows the user's system tooltip delay,
/// which cannot express Backstage's fixed 0.5-second interaction contract.
/// The hover state remains on the control, while the visible bubble is hosted
/// in a non-interactive child window. That child is outside cards, split panes,
/// and scroll containers, and its frame is recomputed when the window layout
/// changes. A popover is deliberately avoided: SwiftUI can route the next
/// click to dismiss a visible popover instead of the button.
private struct BackstageHoverHelpModifier: ViewModifier {
    let explanation: String

    @State private var hoverTask: Task<Void, Never>?
    @State private var isPresented = false

    func body(content: Content) -> some View {
        content
            .onHover { isHovering in
                hoverTask?.cancel()
                if isHovering {
                    hoverTask = Task { @MainActor in
                        do {
                            try await Task.sleep(for: .milliseconds(500))
                        } catch {
                            return
                        }
                        guard !Task.isCancelled else { return }
                        isPresented = true
                    }
                } else {
                    isPresented = false
                    hoverTask = nil
                }
            }
            .background {
                BackstageTooltipAnchor(
                    explanation: explanation,
                    isPresented: isPresented
                )
                .allowsHitTesting(false)
            }
            .accessibilityHint(explanation)
            .onDisappear {
                hoverTask?.cancel()
                hoverTask = nil
                isPresented = false
            }
    }
}

private struct BackstageTooltipBubble: View {
    let explanation: String
    let contentWidth: CGFloat
    let horizontalPadding: CGFloat
    let verticalPadding: CGFloat
    let maximumContentHeight: CGFloat?
    let maximumLineCount: Int?

    var body: some View {
        Text(explanation)
            .font(.callout)
            .multilineTextAlignment(.leading)
            .lineLimit(maximumLineCount)
            .truncationMode(.tail)
            .fixedSize(horizontal: false, vertical: true)
            .frame(width: contentWidth, alignment: .leading)
            .frame(maxHeight: maximumContentHeight, alignment: .topLeading)
            .clipped()
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, verticalPadding)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(.secondary.opacity(0.25))
            }
            .shadow(radius: 8, y: 3)
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isStaticText)
            .accessibilityLabel(explanation)
    }
}

private final class BackstageTooltipAnchorView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? {
        nil
    }
}

private struct BackstageTooltipAnchor: NSViewRepresentable {
    let explanation: String
    let isPresented: Bool

    func makeCoordinator() -> BackstageTooltipCoordinator {
        BackstageTooltipCoordinator()
    }

    func makeNSView(context: Context) -> BackstageTooltipAnchorView {
        let view = BackstageTooltipAnchorView(frame: .zero)
        view.alphaValue = 0
        view.postsFrameChangedNotifications = true
        view.postsBoundsChangedNotifications = true
        return view
    }

    func updateNSView(_ nsView: BackstageTooltipAnchorView, context: Context) {
        context.coordinator.update(
            anchorView: nsView,
            explanation: explanation,
            isPresented: isPresented
        )
    }

    static func dismantleNSView(_ nsView: BackstageTooltipAnchorView, coordinator: BackstageTooltipCoordinator) {
        coordinator.dismiss()
    }
}

@MainActor
private final class BackstageTooltipCoordinator: @unchecked Sendable {
    private weak var anchorView: NSView?
    private weak var window: NSWindow?
    private var panel: NSPanel?
    private var hostingView: NSHostingView<BackstageTooltipBubble>?
    private var observers: [NSObjectProtocol] = []
    private var observedViews: [NSView] = []
    private var previousFrameNotificationState: [ObjectIdentifier: Bool] = [:]
    private var previousBoundsNotificationState: [ObjectIdentifier: Bool] = [:]
    private var explanation = ""
    private var isPresented = false
    private var retryScheduled = false

    func update(anchorView: NSView, explanation: String, isPresented: Bool) {
        self.anchorView = anchorView
        self.explanation = explanation
        self.isPresented = isPresented

        guard isPresented else {
            dismiss()
            return
        }

        guard let window = anchorView.window else {
            scheduleAttachmentRetry(for: anchorView)
            return
        }

        if self.window !== window {
            removeObservers()
            if let panel {
                self.window?.removeChildWindow(panel)
            }
            self.window = window
            installObservers(for: window, anchorView: anchorView)
        }

        reposition()
    }

    func dismiss() {
        isPresented = false
        retryScheduled = false
        removeObservers()
        if let panel, let parent = panel.parent {
            parent.removeChildWindow(panel)
        }
        panel?.orderOut(nil)
        panel = nil
        hostingView = nil
        window = nil
    }

    private func scheduleAttachmentRetry(for anchorView: NSView) {
        guard !retryScheduled else { return }
        retryScheduled = true
        DispatchQueue.main.async { [weak self, weak anchorView] in
            guard let self else { return }
            self.retryScheduled = false
            guard self.isPresented, let anchorView else { return }
            self.update(
                anchorView: anchorView,
                explanation: self.explanation,
                isPresented: true
            )
        }
    }

    private func installObservers(for window: NSWindow, anchorView: NSView) {
        let center = NotificationCenter.default
        for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification, NSWindow.didEndLiveResizeNotification] {
            observers.append(
                center.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                    Task { @MainActor [weak self] in
                        self?.reposition()
                    }
                }
            )
        }

        var view: NSView? = anchorView
        while let current = view {
            observedViews.append(current)
            let identifier = ObjectIdentifier(current)
            previousFrameNotificationState[identifier] = current.postsFrameChangedNotifications
            previousBoundsNotificationState[identifier] = current.postsBoundsChangedNotifications
            current.postsFrameChangedNotifications = true
            current.postsBoundsChangedNotifications = true

            observers.append(
                center.addObserver(forName: NSView.frameDidChangeNotification, object: current, queue: .main) { [weak self] _ in
                    Task { @MainActor [weak self] in
                        self?.reposition()
                    }
                }
            )
            observers.append(
                center.addObserver(forName: NSView.boundsDidChangeNotification, object: current, queue: .main) { [weak self] _ in
                    Task { @MainActor [weak self] in
                        self?.reposition()
                    }
                }
            )
            view = current.superview
        }
    }

    private func removeObservers() {
        let center = NotificationCenter.default
        observers.forEach(center.removeObserver)
        observers.removeAll()
        for view in observedViews {
            let identifier = ObjectIdentifier(view)
            if let value = previousFrameNotificationState[identifier] {
                view.postsFrameChangedNotifications = value
            }
            if let value = previousBoundsNotificationState[identifier] {
                view.postsBoundsChangedNotifications = value
            }
        }
        observedViews.removeAll()
        previousFrameNotificationState.removeAll()
        previousBoundsNotificationState.removeAll()
    }

    private func reposition() {
        guard isPresented,
              let anchorView,
              let window,
              anchorView.window === window,
              let contentView = window.contentView else { return }

        let available = contentView.bounds.insetBy(
            dx: BackstageTooltipPlacement.windowMargin,
            dy: BackstageTooltipPlacement.windowMargin
        )
        guard available.width > 0, available.height > 0 else { return }

        let horizontalPadding = min(
            BackstageTooltipPlacement.horizontalPadding,
            available.width / 2
        )
        let verticalPadding = min(
            BackstageTooltipPlacement.verticalPadding,
            available.height / 2
        )
        let contentWidth = max(
            0,
            min(280, available.width - (horizontalPadding * 2))
        )
        let panel = makePanelIfNeeded()
        hostingView?.rootView = BackstageTooltipBubble(
            explanation: explanation,
            contentWidth: contentWidth,
            horizontalPadding: horizontalPadding,
            verticalPadding: verticalPadding,
            maximumContentHeight: nil,
            maximumLineCount: nil
        )
        hostingView?.setFrameSize(
            NSSize(width: contentWidth + (horizontalPadding * 2), height: 1)
        )
        hostingView?.layoutSubtreeIfNeeded()

        guard let hostingView else { return }
        let naturalSize = hostingView.fittingSize
        let tooltipSize = BackstageTooltipPlacement.constrainedSize(
            naturalSize,
            in: available
        )
        if naturalSize.height > tooltipSize.height {
            let maximumContentHeight = max(
                0,
                tooltipSize.height - (verticalPadding * 2)
            )
            let lineHeight = NSFont.preferredFont(
                forTextStyle: .callout
            ).boundingRectForFont.height
            hostingView.rootView = BackstageTooltipBubble(
                explanation: explanation,
                contentWidth: contentWidth,
                horizontalPadding: horizontalPadding,
                verticalPadding: verticalPadding,
                maximumContentHeight: maximumContentHeight,
                maximumLineCount: max(
                    1,
                    Int(floor(maximumContentHeight / max(1, lineHeight)))
                )
            )
        }
        hostingView.setFrameSize(tooltipSize)
        hostingView.layoutSubtreeIfNeeded()
        panel.setContentSize(tooltipSize)

        let anchor = anchorView.convert(anchorView.bounds, to: contentView)
        let placement = BackstageTooltipPlacement.rect(
            for: anchor,
            tooltipSize: tooltipSize,
            in: available
        )
        let windowRect = contentView.convert(placement, to: nil)
        let screenRect = window.convertToScreen(windowRect)
        panel.setFrame(screenRect, display: true)

        if panel.parent !== window {
            panel.parent?.removeChildWindow(panel)
            window.addChildWindow(panel, ordered: .above)
        }
        panel.orderFront(nil)
    }

    private func makePanelIfNeeded() -> NSPanel {
        if let panel { return panel }

        let panel = NSPanel(
            contentRect: .zero,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.ignoresMouseEvents = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.animationBehavior = .none
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.transient, .moveToActiveSpace]

        let hostingView = NSHostingView(
            rootView: BackstageTooltipBubble(
                explanation: explanation,
                contentWidth: 280,
                horizontalPadding: BackstageTooltipPlacement.horizontalPadding,
                verticalPadding: BackstageTooltipPlacement.verticalPadding,
                maximumContentHeight: nil,
                maximumLineCount: nil
            )
        )
        panel.contentView = hostingView
        self.hostingView = hostingView
        self.panel = panel
        return panel
    }
}

extension View {
    /// Explains a Backstage button after the pointer rests on it for 0.5 seconds.
    func backstageHelp(_ explanation: String) -> some View {
        modifier(BackstageHoverHelpModifier(explanation: explanation))
    }
}
