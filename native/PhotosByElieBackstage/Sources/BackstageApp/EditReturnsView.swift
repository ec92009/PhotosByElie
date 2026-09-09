import AppKit
import OwnerCore
import SwiftUI

struct EditReturnsView: View {
    @ObservedObject var model: BackstageViewModel
    @StateObject private var quickLook = BackstageQuickLookCoordinator()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            BackstageFeedbackView(
                message: model.externalEdit.status,
                isWorking: !model.externalEdit.decisionInFlightIDs.isEmpty
            )
            content
        }
        .padding()
        .navigationTitle("Edit Returns")
        .task { model.loadExternalEditReturns() }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Edit Returns").font(.title2.bold())
                Text("Fixture: \(model.selectedFixtureBreadcrumb)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                model.loadExternalEditReturns()
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .disabled(!model.externalEdit.decisionInFlightIDs.isEmpty)
            .backstageHelp("Reload unresolved returned edits from Owner.sqlite.")
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.externalEdit.pendingReturns.isEmpty {
            ContentUnavailableView(
                "No edits waiting",
                systemImage: "checkmark.circle",
                description: Text("Returned files appear here before they can replace an original or enter Review as a new asset.")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 14) {
                    ForEach(model.externalEdit.pendingReturns) { candidate in
                        EditReturnComparisonCard(
                            candidate: candidate,
                            isDeciding: model.externalEdit.isDeciding(candidate.id),
                            quickLook: quickLook,
                            resolve: { decision in
                                model.resolveExternalEditReturn(candidate, decision: decision)
                            }
                        )
                    }
                }
                .padding(.bottom, 12)
            }
        }
    }
}

private struct EditReturnComparisonCard: View {
    let candidate: ExternalEditReturnCandidate
    let isDeciding: Bool
    @ObservedObject var quickLook: BackstageQuickLookCoordinator
    let resolve: (ExternalEditReturnDecision) -> Void

    var body: some View {
        BackstageSectionCard(cardTitle) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 12) {
                    comparisonColumn(
                        title: candidate.originalFileURLs.count > 1 ? "Original sources" : "Original",
                        urls: candidate.originalFileURLs,
                        filenames: candidate.sources.map(\.originalFilename)
                    )
                    Image(systemName: "arrow.right")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxHeight: .infinity)
                        .accessibilityHidden(true)
                    comparisonColumn(
                        title: "Returned edit",
                        urls: [candidate.returnedFileURL],
                        filenames: [candidate.returnedFileURL.lastPathComponent]
                    )
                }
                metadata
                if !candidate.errorMessage.isEmpty {
                    Label(candidate.errorMessage, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .accessibilityLabel("Last decision failed: \(candidate.errorMessage)")
                }
                actions
            }
            .padding(4)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Returned edit from \(candidate.editor.name)")
    }

    private var cardTitle: String {
        let names = candidate.sources.map(\.originalFilename).filter { !$0.isEmpty }
        return names.count == 1 ? names[0] : "\(names.count.formatted()) source composite"
    }

    private func comparisonColumn(
        title: String,
        urls: [URL],
        filenames: [String]
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline).accessibilityAddTraits(.isHeader)
            if urls.isEmpty {
                unavailablePreview("Prepared source preview is unavailable")
            } else if urls.count == 1 {
                preview(url: urls[0], label: filenames.first ?? title)
            } else {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                            preview(
                                url: url,
                                label: filenames.indices.contains(index) ? filenames[index] : url.lastPathComponent,
                                compact: true
                            )
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private func preview(url: URL, label: String, compact: Bool = false) -> some View {
        if let image = NSImage(contentsOf: url) {
            Button {
                presentQuickLook(urls: [url], title: label)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: compact ? 260 : .infinity, minHeight: 180, maxHeight: 320)
                        .background(.black.opacity(0.06))
                    Text(label)
                        .font(.caption.monospaced())
                        .lineLimit(1)
                }
            }
            .buttonStyle(.plain)
            .backstageHelp("Open \(label) in Quick Look.")
            .accessibilityLabel("Open \(label) in Quick Look")
        } else {
            unavailablePreview("\(label) preview is unavailable")
        }
    }

    private func unavailablePreview(_ message: String) -> some View {
        Label(message, systemImage: "photo.badge.exclamationmark")
            .frame(maxWidth: .infinity, minHeight: 180)
            .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
            .foregroundStyle(.secondary)
    }

    private var metadata: some View {
        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
            GridRow {
                Text("Editor").foregroundStyle(.secondary)
                Text(candidate.editor.name)
            }
            GridRow {
                Text("Returned").foregroundStyle(.secondary)
                Text(candidate.createdAt.formatted(date: .abbreviated, time: .standard))
            }
            GridRow {
                Text("Source identity").foregroundStyle(.secondary)
                Text(sourceIdentity).font(.caption.monospaced()).textSelection(.enabled)
            }
            GridRow {
                Text("Returned receipt").foregroundStyle(.secondary)
                Text("\(candidate.byteCount.formatted(.byteCount(style: .file))) • \(candidate.checksumSHA256.prefix(12))…")
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
            }
        }
        .font(.caption)
    }

    private var sourceIdentity: String {
        candidate.sources.map {
            $0.sourceVersionID.isEmpty ? $0.assetID : $0.sourceVersionID
        }.joined(separator: ", ")
    }

    private var actions: some View {
        HStack(spacing: 8) {
            decisionButton(.keepOriginal, systemImage: "arrow.uturn.backward.circle")
            decisionButton(.replaceOriginal, systemImage: "arrow.triangle.2.circlepath")
                .disabled(!candidate.canReplaceOriginal || isDeciding)
                .backstageHelp(candidate.canReplaceOriginal
                    ? "Accept the returned file as a new source version of the same asset and send it to Review."
                    : "Replace original requires one edited source; use Keep both for a composite.")
            decisionButton(.keepBoth, systemImage: "plus.square.on.square")
            Spacer()
            if isDeciding {
                ProgressView().controlSize(.small).accessibilityLabel("Saving decision")
            }
        }
    }

    private func decisionButton(
        _ decision: ExternalEditReturnDecision,
        systemImage: String
    ) -> some View {
        Button {
            resolve(decision)
        } label: {
            Label(decision.label, systemImage: systemImage)
        }
        .disabled(isDeciding)
        .backstageHelp(help(for: decision))
        .accessibilityIdentifier("backstage.edit-returns.\(candidate.id).\(decision.rawValue)")
    }

    private func help(for decision: ExternalEditReturnDecision) -> String {
        switch decision {
        case .keepOriginal:
            "Resolve this return while preserving the current asset and source version."
        case .replaceOriginal:
            "Accept the returned file as a new source version of the same asset and send it to Review."
        case .keepBoth:
            "Keep the original and register the returned file as a linked new asset awaiting Review."
        }
    }

    private func presentQuickLook(urls: [URL], title: String) {
        let presentation = quickLook.beginPresentation()
        quickLook.present(
            urls: urls,
            metadata: [BackstageQuickLookMetadata(
                assetID: candidate.id,
                filename: urls.first?.lastPathComponent ?? title,
                title: title,
                keywords: [],
                locationLabel: "",
                capturedAt: candidate.createdAt.formatted(date: .abbreviated, time: .standard),
                rating: 0,
                color: "",
                state: "Edit Return",
                shortcutHint: "Edit Returns preview • Escape closes"
            )],
            presentation: presentation
        )
    }
}
