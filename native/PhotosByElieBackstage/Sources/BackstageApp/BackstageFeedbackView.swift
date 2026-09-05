import SwiftUI

/// A compact, shared presentation surface for Backstage operation feedback.
///
/// Individual workflows remain responsible for detailed status and receipts;
/// this view gives the operator one consistent visual and accessibility
/// treatment for the current message.
struct BackstageFeedbackView: View {
    let message: String
    var isWorking = false
    var autoDismissAfter: Duration? = nil
    @State private var isVisible = true

    var body: some View {
        Group {
            if isVisible || isWorking {
                HStack(spacing: 8) {
                    if isWorking {
                        ProgressView()
                            .controlSize(.small)
                            .tint(.white)
                            .accessibilityHidden(true)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        if isWorking {
                            Text("1. Started")
                                .font(.caption2)
                            Text("2. \(message)")
                                .font(.caption)
                            Text("3. Waiting for the result")
                                .font(.caption2)
                        } else {
                            Text(message)
                                .font(.caption)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .foregroundStyle(Color.white)
                .background(Color.black, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                .accessibilityElement(children: .combine)
                .accessibilityLabel(isWorking ? "Started. Current step: \(message). Remaining: wait for the result." : message)
                .accessibilityValue(isWorking ? "In progress" : "Ready")
            }
        }
        .task(id: FeedbackTaskID(message: message, isWorking: isWorking)) {
            isVisible = true
            guard !isWorking, let autoDismissAfter else { return }
            do {
                try await Task.sleep(for: autoDismissAfter)
            } catch {
                return
            }
            isVisible = false
        }
    }
}

private struct FeedbackTaskID: Hashable {
    let message: String
    let isWorking: Bool
}
