import AppKit
import OwnerCore
import SwiftUI

struct UploadQuickView: View {
    var item: NativeUploadPlanItem
    var image: NSImage?
    var onClose: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.78)
                .ignoresSafeArea()
                .onTapGesture(perform: onClose)
            HStack(alignment: .top, spacing: 24) {
                Group {
                    if let image {
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFit()
                    } else {
                        ProgressView("Preparing preview…")
                    }
                }
                .frame(maxWidth: 900, maxHeight: 720)
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("Upload preview")
                            .font(.title2.bold())
                        Spacer()
                        Button(action: onClose) {
                            Image(systemName: "xmark.circle.fill")
                                .font(.title2)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Close preview")
                        .backstageHelp("Close the Upload preview and return to the upload tray.")
                    }
                    Divider()
                    LabeledContent("Title", value: item.title.isEmpty ? "Untitled" : item.title)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Keywords")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(item.keywords.isEmpty ? "No keywords" : item.keywords.joined(separator: ", "))
                            .textSelection(.enabled)
                    }
                    LabeledContent("Captured", value: item.capturedAt.isEmpty ? "Unknown" : item.capturedAt)
                    LabeledContent("File", value: item.filename)
                    Spacer()
                    Text("Use ↑/↓ to navigate • H hides • R returns to Review • Space closes")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(width: 320)
                .frame(maxHeight: 720, alignment: .top)
            }
            .padding(24)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(36)
        }
        .transition(.opacity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Upload preview for \(item.title)")
    }
}
