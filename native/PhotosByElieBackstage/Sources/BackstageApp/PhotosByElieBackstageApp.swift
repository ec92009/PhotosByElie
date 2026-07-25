import OwnerCore
import AppKit
import SwiftUI

@main
struct PhotosByElieBackstageApp: App {
    @StateObject private var model = BackstageViewModel()

    var body: some Scene {
        WindowGroup("PhotosByElie Backstage") {
            NavigationSplitView {
                List(BackstageViewModel.Section.allCases, selection: $model.selection) { section in
                    Label(section.rawValue, systemImage: icon(for: section))
                }
                .navigationTitle("Backstage")
                .frame(minWidth: 210)
            } detail: {
                detail
                    .frame(minWidth: 760, minHeight: 560)
                    .toolbar {
                        ToolbarItem {
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(model.status == "Connected" ? .green : .orange)
                                    .frame(width: 9, height: 9)
                                Text(model.status).lineLimit(1)
                            }
                        }
                    }
            }
            .task { await model.refreshActions() }
        }
        .commands {
            CommandMenu("Backstage") {
                Button("Refresh Activity") {
                    Task { await model.refreshActions() }
                }
                .keyboardShortcut("r")
            }
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch model.selection ?? .overview {
        case .overview:
            ContentUnavailableView(
                "PhotosByElie Backstage",
                systemImage: "photo.on.rectangle.angled",
                description: Text("Max-first Owner workspace. Public and client sites remain independent.")
            )
        case .activity:
            ActivityView(model: model)
        case .culling:
            MediaLibraryView(model: model)
        case .metadata:
            MetadataGiveBackView(model: model)
        default:
            WorkflowPlaceholder(section: model.selection ?? .overview)
        }
    }

    private func icon(for section: BackstageViewModel.Section) -> String {
        switch section {
        case .overview: "rectangle.grid.2x2"
        case .activity: "clock.arrow.circlepath"
        case .fixtures: "folder.badge.gearshape"
        case .access: "person.2"
        case .culling: "checkmark.rectangle.stack"
        case .metadata: "tag"
        case .wasteBasket: "trash"
        case .uploads: "arrow.up.circle"
        case .delivery: "shippingbox"
        case .publication: "globe"
        }
    }
}

private struct ActivityView: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Activity").font(.largeTitle.bold())
                Spacer()
                Button("Refresh") { Task { await model.refreshActions() } }
                    .disabled(model.isRefreshing)
            }
            .padding()
            Table(model.actions) {
                TableColumn("Kind", value: \.actionKind)
                TableColumn("Target", value: \.target)
                TableColumn("State") { Text($0.state.rawValue.capitalized) }
                TableColumn("Progress") { action in
                    if let progress = action.progress {
                        ProgressView(value: progress.percent, total: 100)
                    } else {
                        Text("—")
                    }
                }
            }
        }
    }
}

private struct MediaLibraryView: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Photos index & export").font(.largeTitle.bold())
                    Spacer()
                    Button("Allow Photos") {
                        Task { await model.authorizeAndLoadPhotos() }
                    }
                    Button("Refresh") {
                        Task { await model.refreshPhotos() }
                    }
                    .disabled(model.isLoadingPhotos)
                }
                Text(model.photoStatus)
                    .foregroundStyle(.secondary)
                Table(model.libraryItems, selection: $model.selectedPhotoIDs) {
                    TableColumn("File", value: \.filename)
                    TableColumn("Kind", value: \.mediaType)
                    TableColumn("Captured") { item in
                        Text(item.creationDate?.formatted(date: .numeric, time: .shortened) ?? "—")
                    }
                }
                HStack {
                    Text("\(model.selectedPhotoIDs.count) selected")
                    Spacer()
                    Button("Preview") {
                        Task { await model.loadPreview() }
                    }
                    Button("Export originals…") {
                        guard let directory = chooseExportDirectory() else { return }
                        Task { await model.exportSelected(to: directory) }
                    }
                    .disabled(model.selectedPhotoIDs.isEmpty)
                }
            }
            .padding()

            Group {
                if let preview = model.photoPreview,
                   let image = NSImage(data: preview.jpegData) {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFit()
                        Text("\(preview.pixelWidth) × \(preview.pixelHeight) preview")
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                } else {
                    ContentUnavailableView(
                        "No preview",
                        systemImage: "photo",
                        description: Text("Select one Photos item and choose Preview.")
                    )
                }
            }
            .frame(minWidth: 280)
        }
        .task {
            if model.libraryItems.isEmpty {
                await model.refreshPhotos()
            }
        }
    }

    private func chooseExportDirectory() -> URL? {
        let panel = NSOpenPanel()
        panel.title = "Export verified originals"
        panel.prompt = "Export"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        return panel.runModal() == .OK ? panel.url : nil
    }
}

private struct MetadataGiveBackView: View {
    @ObservedObject var model: BackstageViewModel
    @State private var showingCommitConfirmation = false

    var body: some View {
        Form {
            Section("Verified Apple Photos give-back") {
                TextField("Fixture ID", text: $model.fixtureID)
                Text("Max remains the single writer. Preview is read-only; Commit is a separate, explicit Worker-authorized action through the signed connector.")
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Preview changes") {
                        Task { await model.planMetadataGiveBack() }
                    }
                    .disabled(model.isRunningMetadata || model.fixtureID.isEmpty)
                    Button("Commit & verify") {
                        showingCommitConfirmation = true
                    }
                    .disabled(model.isRunningMetadata || model.fixtureID.isEmpty)
                    Button("Retry failed only") {
                        Task { await model.retryMetadataFailures() }
                    }
                    .disabled(model.isRunningMetadata || (model.metadataReport?.failed.isEmpty ?? true))
                    if model.isRunningMetadata {
                        ProgressView().controlSize(.small)
                    }
                }
                Text(model.metadataStatus)
            }
            if let report = model.metadataReport {
                Section("Receipt \(report.actionID)") {
                    LabeledContent("Mode", value: report.isDryRun ? "Dry run" : "Committed")
                    LabeledContent("Ready", value: report.readyCount.formatted())
                    LabeledContent("Verified", value: report.verifiedCount.formatted())
                    LabeledContent("Failed", value: report.failed.count.formatted())
                    LabeledContent("Blocked", value: report.blocked.count.formatted())
                    if !report.failed.isEmpty {
                        Text("Failed items remain independently retryable.")
                            .foregroundStyle(.red)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Metadata")
        .confirmationDialog(
            "Write approved metadata to Apple Photos?",
            isPresented: $showingCommitConfirmation
        ) {
            Button("Commit and verify", role: .destructive) {
                Task { await model.commitMetadataGiveBack() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The signed Max connector will preserve unrelated keywords, write only eligible same-version assets, then re-read every item before recording a verified receipt.")
        }
    }
}

private struct WorkflowPlaceholder: View {
    let section: BackstageViewModel.Section

    var body: some View {
        ContentUnavailableView(
            section.rawValue,
            systemImage: "hammer",
            description: Text("OwnerCore service boundary ready; native workflow screen pending parity implementation.")
        )
    }
}
