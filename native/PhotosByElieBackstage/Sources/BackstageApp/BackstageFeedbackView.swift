import SwiftUI

/// A compact, shared presentation surface for Backstage operation feedback.
///
/// Individual workflows remain responsible for detailed status and receipts;
/// this view gives the operator one consistent visual and accessibility
/// treatment for the current message.
struct BackstageFeedbackView: View {
    let message: String
    var isWorking = false

    var body: some View {
        HStack(spacing: 8) {
            if isWorking {
                ProgressView()
                    .controlSize(.small)
                    .tint(.white)
                    .accessibilityHidden(true)
            }
            Text(message)
                .font(.callout)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .foregroundStyle(Color.white)
        .background(Color.black, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(isWorking ? "Working. \(message)" : message)
        .accessibilityValue(isWorking ? "In progress" : "Ready")
    }
}
