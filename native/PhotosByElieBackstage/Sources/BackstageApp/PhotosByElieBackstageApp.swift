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
                        .tag(section)
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
            .task { await model.bootstrapAuthentication() }
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
            OverviewView(model: model)
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
        case .wasteBasket:
            LifecycleView(model: model)
        case .uploads:
            UploadWorkflowView(model: model)
        case .delivery:
            DeliverablesView(model: model)
        case .publication:
            PublicationView(model: model)
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

private struct OverviewView: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Label("PhotosByElie Backstage", systemImage: "photo.on.rectangle.angled")
                    .font(.largeTitle.bold())
                Text("Max-first Owner workspace. Public and client sites remain independent.")
                    .foregroundStyle(.secondary)
                GroupBox("This Mac") {
                    VStack(alignment: .leading, spacing: 12) {
                    LabeledContent("Authentication", value: model.authentication.phase.rawValue)
                    if let deviceID = model.authentication.deviceId {
                        LabeledContent("Device", value: deviceID)
                            .textSelection(.enabled)
                    }
                    if let expiresAt = model.authentication.accessExpiresAt {
                        LabeledContent("Access token", value: expiresAt.formatted())
                    }
                    Text(model.authenticationStatus)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    if model.authentication.phase != .authenticated {
                        SecureField("One-time enrollment code", text: $model.enrollmentCode)
                            .textFieldStyle(.roundedBorder)
                        HStack {
                            Button("Enroll this Mac") {
                                Task { await model.enroll() }
                            }
                            .disabled(model.isAuthenticating || model.enrollmentCode.isEmpty)
                            Button("Check Keychain again") {
                                Task { await model.bootstrapAuthentication() }
                            }
                            .disabled(model.isAuthenticating)
                        }
                        Text("Create the code from Owner in a currently authenticated browser. It is exchanged immediately and stored only in this Mac's Keychain.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        HStack {
                            Button("Refresh session") {
                                Task { await model.bootstrapAuthentication() }
                            }
                            .disabled(model.isAuthenticating)
                            Button("Sign out", role: .destructive) {
                                Task { await model.signOut() }
                            }
                            .disabled(model.isAuthenticating)
                        }
                    }
                    }
                    .padding(6)
                }
                GroupBox("Signed Photos helper") {
                    VStack(alignment: .leading, spacing: 10) {
                    LabeledContent("Installed", value: model.photosBridgeHealth.installed ? "Yes" : "No")
                    LabeledContent("Background-only", value: model.photosBridgeHealth.headless ? "Yes" : "No")
                    LabeledContent("Photos access", value: model.photosBridgeHealth.photoAccess)
                    if !model.photosBridgeHealth.version.isEmpty {
                        LabeledContent("Version", value: model.photosBridgeHealth.version)
                    }
                    Text(model.photosBridgeHealth.message)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    Button("Check helper") {
                        Task { await model.refreshPhotosBridgeHealth() }
                    }
                    }
                    .padding(6)
                }
                Spacer()
            }
            .padding(24)
        }
    }
}

private struct FixturePicker: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        Picker("Fixture", selection: $model.selectedFixtureID) {
            Text("Choose a fixture").tag("")
            ForEach(model.flatFixtures) { fixture in
                Text(fixture.name).tag(fixture.id)
            }
        }
        .frame(minWidth: 240)
        Button("Refresh fixtures") { Task { await model.loadFixtures() } }
            .disabled(model.isRunningFixture)
    }
}

private struct UploadWorkflowView: View {
    @ObservedObject var model: BackstageViewModel
    @State private var confirmingAdoption = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Verified upload").font(.largeTitle.bold())
                Spacer()
                FixturePicker(model: model)
                Button("Load plan") { Task { await model.loadDeliveryPlan() } }
                Button("Queue health") { Task { await model.loadUploadHealth() } }
                Button("Upload selected") { Task { await model.deliverSelected() } }
                    .disabled(model.isRunningDelivery || model.selectedDeliveryIDs.isEmpty)
                Button("Retry failed") { Task { await model.retryDeliveryFailures() } }
                    .disabled(model.isRunningDelivery || model.deliveryFailedIDs.isEmpty)
            }
            Text("R2 upload and Apple Photos give-back stay fixture-scoped. Every failed asset remains independently retryable.")
                .foregroundStyle(.secondary)
            if model.deliveryTotal > 0 {
                ProgressView(
                    value: Double(model.deliveryCompleted),
                    total: Double(model.deliveryTotal)
                ) {
                    Text("\(model.deliveryCompleted) of \(model.deliveryTotal)")
                }
            }
            Text(model.deliveryStatus).font(.callout).foregroundStyle(.secondary)
            GroupBox("Recovery and prior-run adoption") {
                VStack(alignment: .leading, spacing: 8) {
                    if let health = model.uploadHealth {
                        HStack {
                            LabeledContent("Fixture assets", value: "\(health.activeAssetCount)")
                            LabeledContent("Queued", value: "\(health.queuedCount)")
                            LabeledContent("Uploadable", value: "\(health.uploadableCount)")
                            LabeledContent("Covered", value: "\(health.coveredCount)")
                            LabeledContent("Partial", value: "\(health.partiallyCoveredCount)")
                        }
                    }
                    HStack {
                        TextField("Upload Bridge run ID", text: $model.uploadRunID)
                        Button("Preview adoption") {
                            Task { await model.previewUploadRunAdoption() }
                        }
                        Button("Adopt verified run…") { confirmingAdoption = true }
                            .disabled(
                                model.isRunningDelivery
                                || (model.uploadAdoptionPlan?.eligibleIDs.isEmpty ?? true)
                            )
                    }
                    Text(model.uploadRecoveryStatus)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            Table(
                model.deliveryPlan?.items ?? [],
                selection: $model.selectedDeliveryIDs
            ) {
                TableColumn("Asset", value: \.assetID)
                TableColumn("Approved") { Text($0.approved ? "Yes" : "No") }
                TableColumn("R2", value: \.r2Status)
                TableColumn("Photos", value: \.photosStatus)
                TableColumn("R2 receipt") {
                    Text($0.r2Evidence)
                        .lineLimit(1)
                        .help($0.r2Evidence)
                }
                TableColumn("Photos receipt") {
                    Text($0.photosEvidence)
                        .lineLimit(1)
                        .help($0.photosEvidence)
                }
                TableColumn("Complete") { Text($0.complete ? "Verified" : "Pending") }
                TableColumn("Error", value: \.errorText)
            }
        }
        .padding()
        .task {
            if model.fixtures.isEmpty { await model.loadFixtures() }
        }
        .confirmationDialog(
            "Adopt this verified upload run into the selected fixture?",
            isPresented: $confirmingAdoption
        ) {
            Button("Adopt exact eligible items", role: .destructive) {
                Task { await model.commitUploadRunAdoption() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The existing R2 objects are checksum-verified before fixture receipts are reconstructed. No client message or publication is triggered.")
        }
    }
}

private struct DeliverablesView: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Delivery & share links").font(.largeTitle.bold())
                Spacer()
                FixturePicker(model: model)
                Button("Load") { Task { await model.loadDeliverables() } }
            }
            Text("Attach completed PDF, video, or originals products to their fixture. Recording a link never messages a client.")
                .foregroundStyle(.secondary)
            HStack {
                Picker("Product", selection: $model.deliverableKind) {
                    Text("PDF").tag("pdf")
                    Text("Video").tag("video")
                    Text("Originals").tag("originals")
                }
                .frame(width: 180)
                TextField("Authenticated share URL", text: $model.deliverableShareLink)
                Button("Record ready link") { Task { await model.linkDeliverable() } }
                    .disabled(model.isRunningDelivery)
            }
            Text(model.deliveryStatus).font(.callout).foregroundStyle(.secondary)
            Table(model.deliverables) {
                TableColumn("Kind", value: \.kind)
                TableColumn("State", value: \.state)
                TableColumn("Provider", value: \.provider)
                TableColumn("Share link", value: \.externalIdentity)
            }
        }
        .padding()
        .task {
            if model.fixtures.isEmpty { await model.loadFixtures() }
        }
    }
}

private struct PublicationView: View {
    @ObservedObject var model: BackstageViewModel
    @State private var confirming = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Publication").font(.largeTitle.bold())
                Spacer()
                FixturePicker(model: model)
                Button("Preview gate") { Task { await model.loadPublicationPlan() } }
                Button("Register eligible…") { confirming = true }
                    .disabled(model.isRunningDelivery || (model.publicationPlan?.eligibleIDs.isEmpty ?? true))
            }
            Text("Only fixtures tagged public can cross this gate. Upload, catalog registration, deployment, and client messaging remain separate decisions.")
                .foregroundStyle(.secondary)
            Text(model.publicationStatus).font(.callout).foregroundStyle(.secondary)
            if let plan = model.publicationPlan {
                LabeledContent("Eligible", value: "\(plan.eligibleIDs.count)")
                LabeledContent("Blocked", value: "\(plan.blocked.count)")
                List(plan.blocked.sorted(by: { $0.key < $1.key }), id: \.key) { entry in
                    VStack(alignment: .leading) {
                        Text(entry.key).font(.headline)
                        Text(entry.value).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding()
        .task {
            if model.fixtures.isEmpty { await model.loadFixtures() }
        }
        .confirmationDialog("Register eligible assets in the static catalog?", isPresented: $confirming) {
            Button("Register and rebuild", role: .destructive) {
                Task { await model.publishEligible() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This changes catalog source files. It does not deploy, push, or message anyone.")
        }
    }
}

private struct LifecycleView: View {
    @ObservedObject var model: BackstageViewModel
    @State private var pendingDiscard: LifecycleItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Waste Basket").font(.largeTitle.bold())
                    Text("Restore is recoverable. Permanent discard is deliberately one item at a time.")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Refresh") { Task { await model.loadLifecycle() } }
                    .disabled(model.isRunningLifecycle)
                Button("Put back") { Task { await model.restoreLifecycleSelection() } }
                    .disabled(model.isRunningLifecycle || model.selectedLifecycleIDs.isEmpty)
            }
            Text(model.lifecycleStatus)
                .font(.callout)
                .foregroundStyle(.secondary)
            Table(model.lifecycleItems, selection: $model.selectedLifecycleIDs) {
                TableColumn("Title") { item in
                    Text(item.title.isEmpty ? item.mediaID : item.title)
                }
                TableColumn("State") { item in
                    Text(item.state == "hidden" ? "Recoverable" : "Discarded")
                        .foregroundStyle(item.state == "hidden" ? .primary : .secondary)
                }
                TableColumn("Collection", value: \.sourceSlug)
                TableColumn("Kind", value: \.mediaType)
                TableColumn("Updated", value: \.updatedAt)
                TableColumn("") { item in
                    if item.state == "hidden" {
                        Button("Discard", role: .destructive) { pendingDiscard = item }
                    }
                }
                .width(90)
            }
        }
        .padding()
        .task { await model.loadLifecycle() }
        .confirmationDialog(
            "Permanently discard this item?",
            isPresented: Binding(
                get: { pendingDiscard != nil },
                set: { if !$0 { pendingDiscard = nil } }
            ),
            presenting: pendingDiscard
        ) { item in
            Button("Discard permanently", role: .destructive) {
                pendingDiscard = nil
                Task { await model.discardLifecycleItem(item.id) }
            }
            Button("Cancel", role: .cancel) { pendingDiscard = nil }
        } message: { item in
            Text(item.title.isEmpty ? item.mediaID : item.title)
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
    @StateObject private var quickLook = BackstageQuickLookCoordinator()

    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.cullingPool?.name ?? "Photos index & export")
                            .font(.largeTitle.bold())
                        if let pool = model.cullingPool {
                            Text("Fixture pool \(pool.id) • \(pool.assetCount) immutable ordered assets")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if model.cullingPool != nil {
                        Button("All Photos") {
                            model.showAllPhotosInCulling()
                        }
                    }
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
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(model.cullingAssets) { asset in
                                CullingAssetRow(
                                    asset: asset,
                                    position: model.cullingPool?.assets
                                        .first(where: { $0.id == asset.id })?.position,
                                    state: model.cullingStates[asset.id],
                                    isSelected: model.cullingSelection.selectedIDs.contains(asset.id),
                                    isFocused: model.cullingSelection.focusedID == asset.id
                                )
                                .id(asset.id)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    model.clickCullingAsset(asset.id, modifiers: NSEvent.modifierFlags)
                                    Task { await model.loadPreview() }
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .focusable()
                    .onMoveCommand { direction in
                        let extending = NSEvent.modifierFlags.contains(.shift)
                        switch direction {
                        case .up, .left:
                            model.moveCullingSelection(.previous, extending: extending)
                        case .down, .right:
                            model.moveCullingSelection(.next, extending: extending)
                        default:
                            return
                        }
                        if let focused = model.focusedCullingAssetID {
                            proxy.scrollTo(focused, anchor: .center)
                        }
                    }
                    .onKeyPress("a", phases: .down) { press in
                        guard press.modifiers.contains(.command) else { return .ignored }
                        model.selectAllCullingAssets()
                        return .handled
                    }
                    .onKeyPress(.space) {
                        Task {
                            let urls = await model.prepareQuickLookURLs()
                            if !urls.isEmpty { quickLook.present(urls: urls) }
                        }
                        return .handled
                    }
                    .overlay {
                        if model.cullingAssets.isEmpty {
                            ContentUnavailableView(
                                "No culling items",
                                systemImage: "photo.stack",
                                description: Text("Open a fixture snapshot or load Photos.")
                            )
                        }
                    }
                }
                HStack {
                    Text("\(model.cullingSelection.selectedIDs.count) selected")
                    Picker("Pick state", selection: $model.cullingPickAction) {
                        ForEach(SidecarPickAction.allCases, id: \.self) {
                            Text($0.label).tag($0)
                        }
                    }
                    .frame(width: 180)
                    Button("Apply pick state") {
                        Task { await model.applyPickDecision() }
                    }
                    .disabled(model.cullingSelection.selectedIDs.isEmpty)
                    Picker("Rating", selection: $model.cullingRating) {
                        ForEach(0...5, id: \.self) { rating in
                            Text(rating == 0 ? "No rating" : "\(rating) star\(rating == 1 ? "" : "s")")
                                .tag(rating)
                        }
                    }
                    .frame(width: 170)
                    Button("Apply rating") {
                        Task { await model.applyRating() }
                    }
                    .disabled(model.cullingSelection.selectedIDs.isEmpty)
                    Picker("Color", selection: $model.cullingColor) {
                        ForEach(SidecarColor.allCases, id: \.self) {
                            Text($0.label).tag($0)
                        }
                    }
                    .frame(width: 145)
                    Button("Apply color") {
                        Task { await model.applyColor() }
                    }
                    .disabled(model.cullingSelection.selectedIDs.isEmpty)
                    Spacer()
                    Button("Quick Look") {
                        Task {
                            let urls = await model.prepareQuickLookURLs()
                            if !urls.isEmpty { quickLook.present(urls: urls) }
                        }
                    }
                    .keyboardShortcut(.space, modifiers: [])
                    .disabled(model.cullingSelection.selectedIDs.isEmpty)
                    Button("Export originals…") {
                        guard let directory = chooseExportDirectory() else { return }
                        Task { await model.exportSelected(to: directory) }
                    }
                    .disabled(model.cullingSelection.selectedIDs.isEmpty)
                }
                HStack {
                    Button("Undo") { Task { await model.undoLastCullingDecision() } }
                        .keyboardShortcut("z", modifiers: .command)
                        .disabled(model.cullingHistory.isEmpty)
                    if let last = model.cullingHistory.last {
                        Text("Last: \(last.label) • \(model.cullingHistory.count) reversible step\(model.cullingHistory.count == 1 ? "" : "s")")
                            .foregroundStyle(.secondary)
                    } else {
                        Text("No culling changes in this session.")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Reload decisions") {
                        Task { await model.refreshCullingDecisions() }
                    }
                    Button("Clear selection") { model.clearCullingSelection() }
                        .disabled(model.cullingSelection.selectedIDs.isEmpty)
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
                        description: Text("Select a photo for an inline preview, or use Quick Look for photos, videos, and panoramas.")
                    )
                }
            }
            .frame(minWidth: 280)
        }
        .task {
            if model.libraryItems.isEmpty {
                await model.refreshPhotos()
            }
            await model.refreshCullingDecisions()
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

private struct CullingAssetRow: View {
    var asset: FixtureAsset
    var position: Int?
    var state: SidecarDecisionState?
    var isSelected: Bool
    var isFocused: Bool

    var body: some View {
        HStack(spacing: 10) {
            Text(position.map { "\($0 + 1)" } ?? "—")
                .frame(width: 36, alignment: .trailing)
                .foregroundStyle(.secondary)
            Image(systemName: asset.mediaType == "video" ? "video" : "photo")
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(asset.title.isEmpty ? asset.filename : asset.title)
                    .lineLimit(1)
                if !asset.title.isEmpty {
                    Text(asset.filename)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let state {
                Text(state.pickState.capitalized)
                    .foregroundStyle(state.pickState == "picked" ? .green : (state.pickState == "rejected" ? .red : .secondary))
                Text(state.rating > 0 ? "\(state.rating)★" : "—")
                    .frame(width: 34)
                Circle()
                    .fill(color(state.color))
                    .overlay(Circle().stroke(.secondary.opacity(0.5)))
                    .frame(width: 12, height: 12)
            } else {
                Text("Undecided")
                    .foregroundStyle(.secondary)
                Text("—").frame(width: 34)
                Circle()
                    .stroke(.secondary.opacity(0.5))
                    .frame(width: 12, height: 12)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(isSelected ? Color.accentColor.opacity(0.22) : Color.clear)
        )
        .overlay(alignment: .leading) {
            if isFocused {
                Rectangle()
                    .fill(Color.accentColor)
                    .frame(width: 3)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func color(_ value: String) -> Color {
        switch value {
        case "red": .red
        case "yellow": .yellow
        case "green": .green
        case "blue": .blue
        case "purple": .purple
        default: .clear
        }
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
                    DisclosureGroup("Reversible fixture placements") {
                        HStack(alignment: .top) {
                            List(model.flatFixtures.filter { !$0.isArchived }, selection: $model.placementTargetFixtureIDs) { fixture in
                                Text(fixture.name).tag(fixture.id)
                            }
                            .frame(minHeight: 90, maxHeight: 130)
                            VStack(alignment: .leading) {
                                Button("Place selected assets") {
                                    Task { await model.placeFixtureAssets() }
                                }
                                .disabled(
                                    model.selectedFixtureAssetIDs.isEmpty
                                        || model.placementTargetFixtureIDs.isEmpty
                                )
                                Button("Review placements") {
                                    Task { await model.loadFixturePlacements() }
                                }
                                .disabled(model.selectedFixtureAssetIDs.isEmpty)
                            }
                        }
                        Table(model.fixturePlacements) {
                            TableColumn("Asset") { Text($0.assetID) }
                            TableColumn("Fixture") { Text($0.breadcrumbLabel) }
                            TableColumn("State") { Text($0.state.capitalized) }
                            TableColumn("Move") { placement in
                                Menu("Move to…") {
                                    ForEach(model.flatFixtures.filter { !$0.isArchived && $0.id != placement.fixtureID }) { fixture in
                                        Button(fixture.name) {
                                            Task { await model.movePlacement(placement.id, to: fixture.id) }
                                        }
                                    }
                                }
                            }
                            TableColumn("Relationship") { placement in
                                Button(placement.isActive ? "Remove" : "Restore") {
                                    Task { await model.togglePlacement(placement) }
                                }
                            }
                        }
                        .frame(minHeight: 140)
                    }
                    if let pool = model.fixturePool {
                        GroupBox("Latest snapshot") {
                            LabeledContent("Pool", value: pool.name)
                            LabeledContent("Assets", value: pool.assetCount.formatted())
                            LabeledContent("Pool ID", value: pool.id)
                            if !pool.snapshotHash.isEmpty {
                                LabeledContent("Snapshot", value: String(pool.snapshotHash.prefix(12)))
                            }
                            Button("Open in Culling") {
                                model.openFixturePoolInCulling()
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
                TextField("Caption", text: $model.metadataCaption)
                TextField("Comma-separated keywords", text: $model.metadataKeywords)
                HStack {
                    Button("Save title, caption & keywords") {
                        Task { await model.updatePhotoMetadata() }
                    }
                    Button("Queue selected for review") {
                        Task { await model.queueMetadataReview() }
                    }
                    Button("Undo last change") {
                        Task { await model.undoLastMetadataChange() }
                    }
                    .keyboardShortcut("z", modifiers: .command)
                    .disabled(model.metadataHistory.isEmpty)
                    if !model.metadataHistory.isEmpty {
                        Text("\(model.metadataHistory.count) reversible change\(model.metadataHistory.count == 1 ? "" : "s")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
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
            Section("AI proposal review") {
                HStack {
                    Button("Load proposals") {
                        Task { await model.loadMetadataProposals() }
                    }
                    Text(model.metadataProposalStatus)
                        .foregroundStyle(.secondary)
                }
                Table(model.metadataProposals) {
                    TableColumn("Current") { proposal in
                        VStack(alignment: .leading) {
                            Text(proposal.current.title)
                            Text(proposal.current.keywords.joined(separator: ", "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    TableColumn("AI proposal") { proposal in
                        VStack(alignment: .leading) {
                            Text(proposal.proposed.title)
                            Text(proposal.proposed.keywords.joined(separator: ", "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let reason = proposal.proposed.reason, !reason.isEmpty {
                                Text(reason).font(.caption2).foregroundStyle(.tertiary)
                            }
                        }
                    }
                    TableColumn("Decision") { proposal in
                        HStack {
                            Button("Approve") {
                                Task { await model.decideProposal(proposal, disposition: .approve) }
                            }
                            Button("Reject") {
                                Task { await model.decideProposal(proposal, disposition: .reject) }
                            }
                            Button("Block", role: .destructive) {
                                Task { await model.decideProposal(proposal, disposition: .block) }
                            }
                        }
                    }
                }
                .frame(minHeight: 180)
                Text("Proposals are read from Owner.sqlite through the local read-only helper. Every approval, rejection, or block remains a Worker-authorized Max action.")
                    .font(.caption)
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
