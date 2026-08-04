import SwiftUI

/// Presents an action-specific explanation after a deliberate half-second hover.
///
/// SwiftUI's native `help` modifier follows the user's system tooltip delay,
/// which cannot express Backstage's fixed 0.5-second interaction contract.
/// This modifier keeps the explanation accessible while presenting it in a
/// non-interactive overlay. A popover is deliberately avoided: SwiftUI can
/// route the next click to dismiss a visible popover instead of the button.
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
            .overlay(alignment: .bottom) {
                if isPresented {
                    Text(explanation)
                        .font(.callout)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 320, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                        .overlay {
                            RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(.secondary.opacity(0.25))
                        }
                        .shadow(radius: 8, y: 3)
                        .offset(y: 8)
                        .allowsHitTesting(false)
                        .zIndex(1000)
                        .accessibilityAddTraits(.isStaticText)
                }
            }
            .accessibilityHint(explanation)
            .onDisappear {
                hoverTask?.cancel()
                hoverTask = nil
                isPresented = false
            }
    }
}

extension View {
    /// Explains a Backstage button after the pointer rests on it for 0.5 seconds.
    func backstageHelp(_ explanation: String) -> some View {
        modifier(BackstageHoverHelpModifier(explanation: explanation))
    }
}
