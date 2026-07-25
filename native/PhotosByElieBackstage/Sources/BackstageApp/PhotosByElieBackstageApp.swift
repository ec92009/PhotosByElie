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
        case .fixtures:
            FixtureWorkflowView(model: model)
        case .access:
            AccessControlView(model: model)
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
                    Picker("Decision", selection: $model.cullingState) {
                        ForEach(SidecarDecisionState.allCases, id: \.self) {
                            Text($0.rawValue.capitalized).tag($0)
                        }
                    }
                    .frame(width: 180)
                    Button("Apply decision") {
                        Task { await model.applyCullingDecision() }
                    }
                    .disabled(model.selectedPhotoIDs.isEmpty)
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
                Text(model.cullingStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
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

private struct FixtureWorkflowView: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Fixtures").font(.largeTitle.bold())
                Spacer()
                Button("Reload tree") { Task { await model.loadFixtures() } }
                    .disabled(model.isRunningFixture)
            }
            Text(model.fixtureStatus).foregroundStyle(.secondary)
            HSplitView {
                VStack(alignment: .leading, spacing: 10) {
                    List(model.flatFixtures, selection: $model.selectedFixtureID) { fixture in
                        HStack {
                            Image(systemName: fixture.isArchived ? "archivebox" : "folder")
                            VStack(alignment: .leading) {
                                Text(fixture.name)
                                Text(fixture.id).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .tag(fixture.id)
                    }
                    HStack {
                        TextField("New fixture or new name", text: $model.fixtureName)
                        TextField("Template", text: $model.fixtureTemplate)
                            .frame(width: 130)
                    }
                    HStack {
                        Button(model.selectedFixtureID.isEmpty ? "Create root" : "Create child") {
                            Task { await model.createFixture() }
                        }
                        .disabled(model.fixtureName.isEmpty || model.isRunningFixture)
                        Button("Rename") { Task { await model.renameFixture() } }
                            .disabled(model.selectedFixtureID.isEmpty || model.fixtureName.isEmpty)
                        Button("Archive / reopen") { Task { await model.toggleFixtureArchive() } }
                            .disabled(model.selectedFixtureID.isEmpty)
                    }
                }
                .padding()

                VStack(alignment: .leading, spacing: 10) {
                    Text("Find and snapshot assets").font(.title2.bold())
                    HStack {
                        TextField("Title, keyword, file, camera…", text: $model.fixtureSearch)
                        Button("Search") { Task { await model.searchFixtureAssets() } }
                            .disabled(model.selectedFixtureID.isEmpty || model.isRunningFixture)
                    }
                    Table(model.fixtureAssets, selection: $model.selectedFixtureAssetIDs) {
                        TableColumn("Title", value: \.title)
                        TableColumn("File", value: \.filename)
                        TableColumn("Kind", value: \.mediaType)
                    }
                    HStack {
                        Text("\(model.selectedFixtureAssetIDs.count) selected")
                        Spacer()
                        Button("Create stable culling snapshot") {
                            Task { await model.snapshotFixtureAssets() }
                        }
                        .disabled(model.selectedFixtureAssetIDs.isEmpty || model.selectedFixtureID.isEmpty)
                    }
                    if let pool = model.fixturePool {
                        GroupBox("Latest snapshot") {
                            LabeledContent("Pool", value: pool.name)
                            LabeledContent("Assets", value: pool.assetCount.formatted())
                            if let url = pool.sidecarURL {
                                Link("Open in Sidecar", destination: url)
                            }
                        }
                    }
                }
                .padding()
            }
        }
        .task {
            if model.fixtures.isEmpty { await model.loadFixtures() }
        }
    }
}

private struct AccessControlView: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("People & Access").font(.largeTitle.bold())
                Spacer()
                Button("Reload") { Task { await model.loadAccess() } }
                    .disabled(model.isRunningAccess)
            }
            Text(model.accessStatus).foregroundStyle(.secondary)
            HSplitView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("People").font(.title2.bold())
                        Spacer()
                        Button("New") { model.newPerson() }
                    }
                    List(model.accessState.allPeople, selection: $model.selectedPersonID) { person in
                        VStack(alignment: .leading) {
                            Text(person.displayName?.isEmpty == false ? person.displayName! : person.email)
                            Text(person.email).font(.caption).foregroundStyle(.secondary)
                        }
                        .tag(person.id)
                        .onTapGesture { model.selectPerson(person.id) }
                    }
                    TextField("Email", text: $model.personEmail)
                    TextField("Display name", text: $model.personName)
                    Text("Groups").font(.headline)
                    ScrollView {
                        VStack(alignment: .leading) {
                            ForEach(model.accessState.allGroups.filter { !$0.isArchived }) { group in
                                Toggle(
                                    group.label ?? group.id,
                                    isOn: Binding(
                                        get: { model.personGroupIDs.contains(group.id) },
                                        set: { enabled in
                                            if enabled { model.personGroupIDs.insert(group.id) }
                                            else { model.personGroupIDs.remove(group.id) }
                                        }
                                    )
                                )
                            }
                        }
                    }
                    HStack {
                        Button("Save person & access") { Task { await model.savePerson() } }
                        Button("Disable", role: .destructive) { Task { await model.disablePerson() } }
                            .disabled(model.selectedPersonID.isEmpty)
                    }
                }
                .padding()

                VStack(alignment: .leading, spacing: 10) {
                    Text("Groups & inherited grants").font(.title2.bold())
                    Table(model.accessState.allGroups) {
                        TableColumn("Group") { Text($0.label ?? $0.id) }
                        TableColumn("Kind") { Text($0.kind ?? "event") }
                        TableColumn("State") { Text($0.state ?? "active") }
                        TableColumn("Actions") { group in
                            Button("Archive") { Task { await model.archiveGroup(group.id) } }
                                .disabled(group.isArchived)
                        }
                    }
                    TextField("Stable group ID", text: $model.groupID)
                    TextField("Label", text: $model.groupName)
                    Picker("Kind", selection: $model.groupKind) {
                        Text("Event").tag("event")
                        Text("Family").tag("family")
                        Text("Fixture").tag("fixture")
                        Text("Real estate").tag("real_estate")
                    }
                    Button("Save group") { Task { await model.saveGroup() } }
                        .disabled(model.groupID.isEmpty || model.groupName.isEmpty)
                    Text("Usernames and emails are normalized by the Worker. Passwords remain case-sensitive and are never returned to this app.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
        }
        .task {
            if model.accessState.allPeople.isEmpty { await model.loadAccess() }
        }
    }
}

private struct MetadataGiveBackView: View {
    @ObservedObject var model: BackstageViewModel
    @State private var showingCommitConfirmation = false

    var body: some View {
        Form {
            Section("Title, keywords, and review queue") {
                HStack {
                    TextField("Asset ID", text: $model.metadataAssetID)
                    Button("Use selected Photos item") { model.useSelectedPhotoForMetadata() }
                        .disabled(model.selectedPhotoIDs.isEmpty)
                }
                TextField("Title", text: $model.metadataTitle)
                TextField("Comma-separated keywords", text: $model.metadataKeywords)
                HStack {
                    Button("Save title & keywords") {
                        Task { await model.updatePhotoMetadata() }
                    }
                    Button("Queue selected for review") {
                        Task { await model.queueMetadataReview() }
                    }
                }
                HStack {
                    TextField("Keyword blacklist (comma-separated)", text: $model.metadataBlacklist)
                    Button("Replace blacklist") {
                        Task { await model.saveMetadataBlacklist() }
                    }
                }
                Text(model.metadataReviewStatus)
                    .foregroundStyle(.secondary)
            }
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
