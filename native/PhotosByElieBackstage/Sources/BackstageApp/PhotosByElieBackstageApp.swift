import OwnerCore
import AppKit
import SwiftUI

@main
struct PhotosByElieBackstageApp: App {
    @StateObject private var model = BackstageViewModel()
    @Environment(\.scenePhase) private var scenePhase

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
                    .frame(
                        minWidth: 760,
                        maxWidth: .infinity,
                        minHeight: 560,
                        maxHeight: .infinity,
                        alignment: .topLeading
                    )
                    .toolbar {
                        ToolbarItem(placement: .primaryAction) {
                            HStack(spacing: 10) {
                                Text(backstageVersionLabel)
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                    .help("Installed PhotosByElie Backstage version")
                                if model.authentication.phase == .authenticated {
                                    if model.selection == .culling || model.selection == .review {
                                        Button {
                                            withAnimation(.snappy(duration: 0.24)) {
                                                model.isPreviewPanelVisible.toggle()
                                            }
                                        } label: {
                                            Image(systemName: "sidebar.right")
                                        }
                                        .help(
                                            model.isPreviewPanelVisible
                                                ? "Collapse preview panel"
                                                : "Expand preview panel"
                                        )
                                    }
                                } else if model.status != "Connected" {
                                    HStack(spacing: 8) {
                                        Circle()
                                            .fill(.orange)
                                            .frame(width: 9, height: 9)
                                        Text(model.status).lineLimit(1)
                                    }
                                }
                            }
                        }
                    }
            }
            .frame(minWidth: 1_120, minHeight: 720)
            .task { await model.bootstrapAuthentication() }
            .task { await model.runPhotosSyncLoop() }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task { await model.syncPhotosIncrementally() }
            }
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

    private var backstageVersionLabel: String {
        let short = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "unknown"
        let build = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleVersion"
        ) as? String ?? "?"
        return "v\(short) (\(build))"
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
        case .review:
            FixtureReviewView(model: model)
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
        case .review: "checkmark.bubble"
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
                        LabeledContent("Device", value: abbreviatedDeviceID(deviceID))
                            .textSelection(.enabled)
                    }
                    if let expiresAt = model.authentication.accessExpiresAt {
                        LabeledContent("Session expires", value: expiresAt.formatted())
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
                        LabeledContent(
                            "Photos Bridge helper version",
                            value: model.photosBridgeHealth.version
                        )
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

    private func abbreviatedDeviceID(_ deviceID: String) -> String {
        guard deviceID.count > 18 else { return deviceID }
        return "\(deviceID.prefix(18))…"
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
    @State private var uploadSortOrder = [
        KeyPathComparator(\NativeUploadPlanItem.capturedAt, order: .forward),
    ]
    @State private var confirmingAdoption = false
    @State private var confirmingSelectedPublication = false
    @State private var confirmingVisiblePublication = false
    @State private var confirmingReturnToReview = false
    @State private var confirmingUploadHide = false
    @State private var uploadQuickViewItem: NativeUploadPlanItem?

    private func sortedItems(_ plan: NativeUploadPlan) -> [NativeUploadPlanItem] {
        plan.items.sorted(using: uploadSortOrder)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Upload & publish").font(.largeTitle.bold())
                Spacer()
                FixturePicker(model: model)
                if model.nativeUploadPlan?.items.isEmpty == true {
                    Button("Load next 200") { Task { await model.loadNativeUploadPlan() } }
                        .disabled(model.isRunningDelivery || model.selectedFixtureID.isEmpty)
                }
                Button("Upload selection…") { confirmingSelectedPublication = true }
                    .disabled(model.isRunningDelivery || model.selectedDeliveryIDs.isEmpty)
            }
            Text("Upload equals publication. Each verified source version becomes live immediately in every effective picked fixture; ACS alone determines who can see it. A failed asset remains Needs Upload without blocking the rest.")
                .foregroundStyle(.secondary)
            if model.isRunningDelivery, model.nativeUploadPlan == nil {
                ProgressView("Loading approved publication eligibility…")
            }
            Text(model.nativeUploadStatus).font(.callout).foregroundStyle(.secondary)
            if let plan = model.nativeUploadPlan {
                HStack {
                    LabeledContent("Picked", value: "\(plan.pickedCount)")
                    LabeledContent("Awaiting Review", value: "\(plan.needsReviewCount)")
                    LabeledContent("Approved", value: "\(plan.approvedCount)")
                    LabeledContent("Needs Upload", value: "\(plan.needsUploadCount)")
                    LabeledContent("Live", value: "\(plan.liveCount)")
                }
                if plan.needsUploadCount > 0 {
                    HStack {
                        let outsideWindow = max(0, plan.needsUploadCount - plan.items.count)
                        Text(
                            "\(plan.items.count.formatted()) shown of \(plan.needsUploadCount.formatted()) needing upload"
                            + " • \(outsideWindow.formatted()) not shown"
                            + " • oldest eligible by upload-readiness time"
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        Spacer()
                        Button("Publish these \(plan.items.count.formatted())…") {
                            confirmingVisiblePublication = true
                        }
                        .disabled(model.isRunningDelivery || plan.items.isEmpty)
                    }
                }
                if plan.items.isEmpty {
                    ContentUnavailableView(
                        plan.needsUploadCount > 0 ? "Batch complete" : "No approved assets need upload",
                        systemImage: plan.needsUploadCount > 0 ? "tray" : "checkmark.circle",
                        description: Text(
                            plan.needsUploadCount > 0
                                ? "\(plan.needsUploadCount) eligible item\(plan.needsUploadCount == 1 ? "" : "s") remain. Load the next batch of up to 200 when ready."
                                : plan.needsReviewCount > 0
                                ? "\(plan.needsReviewCount) picked item\(plan.needsReviewCount == 1 ? "" : "s") still need Review approval."
                                : "This fixture has no approved publication work waiting."
                        )
                    )
                    .frame(maxWidth: .infinity, minHeight: 150)
                } else {
                    Table(
                        sortedItems(plan),
                        selection: $model.selectedDeliveryIDs,
                        sortOrder: $uploadSortOrder
                    ) {
                        TableColumn("Title", value: \.title) { item in
                            HStack(spacing: 8) {
                                Group {
                                    if let thumbnail = model.nativeUploadThumbnails[item.id] {
                                        Image(nsImage: thumbnail)
                                            .resizable()
                                            .scaledToFill()
                                    } else {
                                        Image(systemName: "photo")
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .frame(width: 50, height: 50)
                                .background(.quaternary)
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                                .clipped()
                                Text(item.title)
                                    .lineLimit(2)
                            }
                            .task(id: item.id) {
                                await model.loadNativeUploadThumbnail(for: item)
                            }
                        }
                        TableColumn("Keywords", value: \.keywordsText) { item in
                            Text(item.keywordsText.isEmpty ? "No keywords" : item.keywordsText)
                                .lineLimit(2)
                        }
                        TableColumn("Captured", value: \.capturedAt)
                        TableColumn("State", value: \.deliveryState)
                        TableColumn("Error", value: \.errorText)
                    }
                    .frame(minHeight: 220)
                    .onKeyPress("r") {
                        guard !model.selectedDeliveryIDs.isEmpty else { return .ignored }
                        confirmingReturnToReview = true
                        return .handled
                    }
                    .onKeyPress("h") {
                        guard !model.selectedDeliveryIDs.isEmpty else { return .ignored }
                        confirmingUploadHide = true
                        return .handled
                    }
                    .onKeyPress(.space) {
                        toggleUploadQuickView(in: plan)
                        return .handled
                    }
                    HStack {
                        Text("\(model.selectedDeliveryIDs.count.formatted()) selected")
                            .foregroundStyle(.secondary)
                        Button("Return to Review…") {
                            confirmingReturnToReview = true
                        }
                        .disabled(model.isRunningDelivery || model.selectedDeliveryIDs.isEmpty)
                        Button("Hide…") {
                            confirmingUploadHide = true
                        }
                        .disabled(model.isRunningDelivery || model.selectedDeliveryIDs.isEmpty)
                        Button("Clear selection") {
                            model.selectedDeliveryIDs.removeAll()
                        }
                        .disabled(model.selectedDeliveryIDs.isEmpty)
                        Spacer()
                        Text("Use Command-click or Shift-click to select multiple rows.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if model.isRunningNativePublication,
               let run = model.nativeUploadRun,
               run.requested > 0 {
                ProgressView(
                    value: Double(run.processed),
                    total: Double(run.requested)
                ) {
                    Text(
                        "Batch \(model.nativePublicationBatchNumber) of \(model.nativePublicationBatchCount)"
                        + " • \(run.processed) of \(run.requested)"
                        + " • \(run.live) live"
                        + " • \(run.failed) failed"
                        + " • \(run.remaining) remaining"
                    )
                }
            }
            if model.isRunningNativePublication,
               let run = model.nativeUploadRun,
               !run.items.isEmpty {
                Table(run.items) {
                    TableColumn("Asset", value: \.assetID)
                    TableColumn("State", value: \.status)
                    TableColumn("Error", value: \.errorText)
                }
                .frame(minHeight: 180)
            }
            DisclosureGroup("Legacy recovery and fixture receipt inspection") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Button("Load receipt audit") { Task { await model.loadDeliveryPlan() } }
                        Button("Queue health") { Task { await model.loadUploadHealth() } }
                        Button("Retry legacy failures") { Task { await model.retryDeliveryFailures() } }
                            .disabled(model.isRunningDelivery || model.deliveryFailedIDs.isEmpty)
                    }
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
                    Table(
                        model.deliveryPlan?.items ?? [],
                        selection: $model.selectedDeliveryIDs
                    ) {
                        TableColumn("Asset", value: \.assetID)
                        TableColumn("Approved") { Text($0.approved ? "Yes" : "No") }
                        TableColumn("R2", value: \.r2Status)
                        TableColumn("Photos", value: \.photosStatus)
                        TableColumn("Complete") { Text($0.complete ? "Verified" : "Pending") }
                        TableColumn("Error", value: \.errorText)
                    }
                    .frame(minHeight: 180)
                }
            }
        }
        .padding()
        .overlay {
            if let item = uploadQuickViewItem,
               let plan = model.nativeUploadPlan {
                UploadQuickView(
                    item: item,
                    image: model.nativeUploadPreviewItemID == item.id
                        ? model.nativeUploadPreviewImage
                        : nil
                ) {
                    closeUploadQuickView()
                }
                .focusable()
                .onKeyPress(.space) {
                    closeUploadQuickView()
                    return .handled
                }
                .onMoveCommand { direction in
                    switch direction {
                    case .up:
                        moveUploadQuickView(in: plan, by: -1)
                    case .down:
                        moveUploadQuickView(in: plan, by: 1)
                    default:
                        return
                    }
                }
            }
        }
        .task {
            if model.fixtures.isEmpty { await model.loadFixtures() }
            if model.selectedFixtureID.isEmpty {
                model.selectedFixtureID = model.flatFixtures.first(where: { $0.id == "fixture-expo" })?.id
                    ?? model.flatFixtures.first(where: { $0.parentID == nil && !$0.isArchived })?.id
                    ?? ""
            }
        }
        .task(id: model.selectedFixtureID) {
            guard !model.selectedFixtureID.isEmpty else { return }
            await model.loadNativeUploadPlan()
        }
        .confirmationDialog(
            "Return the selected approved assets to Review?",
            isPresented: $confirmingReturnToReview
        ) {
            Button("Return \(model.selectedDeliveryIDs.count) to Review") {
                Task { await model.returnSelectedUploadsToReview() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This reverses approval and upload readiness for the selected items. Fixture picks and metadata are preserved, and the audited action can be undone.")
        }
        .confirmationDialog(
            "Hide the selected approved assets?",
            isPresented: $confirmingUploadHide
        ) {
            Button("Hide \(model.selectedDeliveryIDs.count) assets", role: .destructive) {
                Task { await model.hideSelectedUploads() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Hidden assets leave this fixture's upload queue. Their files are not deleted.")
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
        .confirmationDialog(
            "Upload the selected eligible assets now?",
            isPresented: $confirmingSelectedPublication
        ) {
            Button("Upload selection") {
                Task { await model.publishSelectedNatively() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Upload equals publication. Verified assets become live immediately in their effective picked fixtures.")
        }
        .confirmationDialog(
            "Publish the \(model.nativeUploadPlan?.items.count ?? 0) shown assets now?",
            isPresented: $confirmingVisiblePublication
        ) {
            Button("Publish these \(model.nativeUploadPlan?.items.count ?? 0) assets") {
                Task { await model.publishVisibleNativeWindow() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Backstage will publish exactly the assets remaining in this tray, in sequential batches of up to 50. Successful rows leave the tray; failures remain for retry. Load the next 200 only after this batch is complete.")
        }
    }

    private func toggleUploadQuickView(in plan: NativeUploadPlan) {
        if uploadQuickViewItem != nil {
            closeUploadQuickView()
            return
        }
        guard let item = sortedItems(plan).first(where: {
            model.selectedDeliveryIDs.contains($0.id)
        }) else {
            return
        }
        uploadQuickViewItem = item
        Task { await model.loadNativeUploadPreview(for: item) }
    }

    private func closeUploadQuickView() {
        uploadQuickViewItem = nil
        model.clearNativeUploadPreview()
    }

    private func moveUploadQuickView(in plan: NativeUploadPlan, by delta: Int) {
        let items = sortedItems(plan)
        guard let current = uploadQuickViewItem,
              let index = items.firstIndex(where: { $0.id == current.id }) else {
            return
        }
        let nextIndex = index + delta
        guard items.indices.contains(nextIndex) else { return }
        let next = items[nextIndex]
        uploadQuickViewItem = next
        model.selectedDeliveryIDs = [next.id]
        Task { await model.loadNativeUploadPreview(for: next) }
    }
}

private struct UploadQuickView: View {
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
                    Text("Use ↑/↓ to navigate • Press Space to close")
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
                    .disabled(
                        model.isRunningDelivery
                            || model.selectedFixtureID.isEmpty
                            || !model.deliverableShareLink
                                .trimmingCharacters(in: .whitespacesAndNewlines)
                                .hasPrefix("https://")
                    )
            }
            Text(model.deliveryStatus).font(.callout).foregroundStyle(.secondary)
            Table(model.deliverables) {
                TableColumn("Kind", value: \.kind)
                TableColumn("State", value: \.state)
                TableColumn("Provider", value: \.provider)
                TableColumn("Share link", value: \.externalIdentity)
            }
            .overlay {
                if model.deliverables.isEmpty {
                    ContentUnavailableView(
                        model.selectedFixtureID.isEmpty ? "Choose a fixture" : "No products loaded",
                        systemImage: "shippingbox",
                        description: Text(
                            model.selectedFixtureID.isEmpty
                                ? "Select a fixture, then load its existing delivery records."
                                : "Load the fixture to inspect its PDF, video, originals, and share-link records."
                        )
                    )
                }
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
                Text("R2 safety").font(.largeTitle.bold())
                Spacer()
                Button("Preview reconciliation") {
                    Task { await model.previewR2Reconciliation() }
                }
                .disabled(model.isRunningDelivery)
                Button("Apply guarded reconciliation…") { confirming = true }
                    .disabled(model.isRunningDelivery || model.r2Reconciliation == nil)
            }
            Text("Sold masters and sold derivatives are protected indefinitely. Other unreferenced objects enter a 30-day quarantine and can be deleted only after a second reconciliation still finds them unreferenced.")
                .foregroundStyle(.secondary)
            Text(model.r2ReconciliationStatus).font(.callout).foregroundStyle(.secondary)
            if model.isRunningDelivery {
                ProgressView("Checking R2 references and sale protection…")
            }
            if let report = model.r2Reconciliation {
                HStack {
                    LabeledContent("Scanned", value: "\(report.scanned)")
                    LabeledContent("Sale protected", value: "\(report.protected)")
                    LabeledContent("Quarantined", value: "\(report.quarantined)")
                    LabeledContent("Restored", value: "\(report.restored)")
                    LabeledContent("Eligible delete", value: "\(report.eligibleDelete)")
                    LabeledContent("Deleted", value: "\(report.deleted)")
                }
                Table(report.items) {
                    TableColumn("Object", value: \.key)
                    TableColumn("Asset", value: \.assetID)
                    TableColumn("Sold") { Text($0.sold ? "Protected" : "No") }
                    TableColumn("Referenced") { Text($0.referenced ? "Yes" : "No") }
                    TableColumn("Action", value: \.action)
                }
            } else if !model.isRunningDelivery {
                ContentUnavailableView(
                    "No reconciliation preview",
                    systemImage: "shield.checkered",
                    description: Text("Preview the protected and quarantined objects before the guarded apply action becomes available.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding()
        .task {
            if model.fixtures.isEmpty { await model.loadFixtures() }
        }
        .confirmationDialog("Apply the guarded R2 reconciliation?", isPresented: $confirming) {
            Button("Apply reconciliation", role: .destructive) {
                Task { await model.commitR2Reconciliation() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Referenced or sold objects cannot be removed here. Unreferenced objects first enter quarantine; only a later second pass after 30 days may delete them.")
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
            .overlay {
                if model.isRunningLifecycle && model.lifecycleItems.isEmpty {
                    ProgressView("Loading private lifecycle ledger…")
                } else if model.lifecycleItems.isEmpty {
                    ContentUnavailableView(
                        "Waste Basket is empty",
                        systemImage: "trash",
                        description: Text("Recoverable and permanently discarded items will appear here.")
                    )
                }
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
                TableColumn("Updated") { action in
                    Text(
                        (action.updatedAt ?? action.createdAt)?
                            .formatted(date: .abbreviated, time: .shortened)
                            ?? "—"
                    )
                    .monospacedDigit()
                }
                .width(min: 130, ideal: 160)
                TableColumn("Progress") { action in
                    if let progress = action.progress {
                        VStack(alignment: .leading, spacing: 2) {
                            ProgressView(value: progress.percent, total: 100)
                            if let detail = progress.detail, !detail.isEmpty {
                                Text(detail).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    } else {
                        Text("—")
                    }
                }
                TableColumn("Detail") { action in
                    Text(
                        action.error?["message"]?.stringValue
                            ?? action.error?["code"]?.stringValue
                            ?? String(action.id.prefix(12))
                    )
                    .lineLimit(2)
                    .foregroundStyle(action.state == .failed ? .red : .secondary)
                    .textSelection(.enabled)
                }
                .width(min: 150, ideal: 260)
            }
            .overlay {
                if model.isRefreshing && model.actions.isEmpty {
                    ProgressView("Loading audited activity…")
                } else if model.actions.isEmpty {
                    ContentUnavailableView(
                        "No recent activity",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("The latest audited Owner actions will appear here.")
                    )
                }
            }
        }
    }
}

private struct MediaLibraryView: View {
    @ObservedObject var model: BackstageViewModel
    @StateObject private var quickLook = BackstageQuickLookCoordinator()

    var body: some View {
        GeometryReader { viewport in
            HSplitView {
                VStack(alignment: .leading, spacing: 12) {
                let workspace = model.cullingWorkspace
                VStack(alignment: .leading, spacing: 12) {
                    ViewThatFits(in: .horizontal) {
                        HStack {
                            cullingHeading
                            Spacer()
                            cullingHeaderActions
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            cullingHeading
                            cullingHeaderActions
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    Text(model.photoStatus)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    FlowLayout(spacing: 8) {
                        Picker(
                            "Fixture",
                            selection: Binding(
                                get: { model.cullingFixtureID },
                                set: { model.selectCullingFixture($0) }
                            )
                        ) {
                            ForEach(model.flatFixtures.filter { !$0.isArchived }) { fixture in
                                let depth = max(0, model.fixtures.path(to: fixture.id).count - 1)
                                Text("\(String(repeating: "  ", count: depth))\(fixture.name)")
                                    .tag(fixture.id)
                            }
                        }
                        .frame(width: 180)
                        .labelsHidden()
                        TextField("Search title, file, or keyword", text: $model.cullingSearch)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 240)
                            .onSubmit { model.applyCullingFilters() }
                        Button("Review picked") { model.showPickedReview() }
                        Button("Select burst") { model.selectFocusedBurst() }
                            .disabled(model.focusedCullingAssetID == nil)
                    }
                    FlowLayout(spacing: 8) {
                        Text("Media").font(.caption.weight(.semibold))
                        ForEach(CullingMediaFilter.selectableCases, id: \.self) { filter in
                            Toggle(
                                filter.label,
                                isOn: Binding(
                                    get: { model.cullingMediaFilters.contains(filter) },
                                    set: { _ in model.toggleCullingMediaFilter(filter) }
                                )
                            )
                            .toggleStyle(.checkbox)
                        }
                        Divider().frame(width: 1, height: 18)
                        Text("Status").font(.caption.weight(.semibold))
                        ForEach(FixtureCullingView.selectableCases, id: \.self) { view in
                            Toggle(
                                view.label,
                                isOn: Binding(
                                    get: { model.cullingViews.contains(view) },
                                    set: { _ in model.toggleCullingViewFilter(view) }
                                )
                            )
                            .toggleStyle(.checkbox)
                        }
                        Divider().frame(width: 1, height: 18)
                        Text("Rating").font(.caption.weight(.semibold))
                        ForEach(0...5, id: \.self) { value in
                            LightroomRatingFilterButton(
                                rating: value,
                                isSelected: model.cullingRatingFilters.contains(value)
                            ) {
                                model.toggleCullingRatingFilter(value)
                            }
                        }
                        Divider().frame(width: 1, height: 18)
                        Text("Color").font(.caption.weight(.semibold))
                        ForEach(CullingColorFilter.selectableCases, id: \.self) { color in
                            LightroomColorFilterButton(
                                color: color,
                                isSelected: model.cullingColorFilters.contains(color)
                            ) {
                                model.toggleCullingColorFilter(color)
                            }
                        }
                        Button("Clear filters") { model.clearCullingFilters() }
                    }
                    .onChange(of: model.cullingSearch) { _, _ in
                        model.scheduleCullingSearchRefresh()
                    }
                    .onChange(of: model.cullingMediaFilters) { _, _ in model.applyCullingFilters() }
                    .onChange(of: model.cullingViews) { _, _ in model.applyCullingFilters() }
                    .onChange(of: model.cullingRatingFilters) { _, _ in model.applyCullingFilters() }
                    .onChange(of: model.cullingColorFilters) { _, _ in model.applyCullingFilters() }
                    .fixedSize(horizontal: false, vertical: true)
                    FlowLayout(spacing: 8) {
                        Text("\(workspace.summary.filtered.formatted()) match • \(workspace.summary.total.formatted()) in scope")
                        Text("• \(workspace.summary.undecided.formatted()) undecided")
                        Text("• \(workspace.summary.picked.formatted()) picked")
                        Text("• \(workspace.summary.rejected.formatted()) hidden")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    HStack {
                        if let range = workspace.visibleRange {
                            Text("\(range.lowerBound.formatted())–\(range.upperBound.formatted()) of \(workspace.summary.filtered.formatted())")
                                .font(.callout.weight(.semibold))
                                .monospacedDigit()
                        } else {
                            Text("0 of \(workspace.summary.filtered.formatted())")
                                .font(.callout.weight(.semibold))
                        }
                        Button("Previous \(workspace.limit)") {
                            model.moveCullingWindow(forward: false)
                        }
                        .disabled(!workspace.hasPrevious)
                        Button("Next \(workspace.limit)") {
                            model.moveCullingWindow(forward: true)
                        }
                        .disabled(!workspace.hasNext)
                        Spacer()
                        HStack(spacing: 0) {
                            Button("−") { decreaseCullingThumbnailSize() }
                                .help("Show more, smaller thumbnails")
                                .disabled(!model.canDecreaseCullingThumbnailSize)
                            Divider().frame(height: 18)
                            Button("+") { increaseCullingThumbnailSize() }
                                .help("Show fewer, larger thumbnails")
                                .disabled(!model.canIncreaseCullingThumbnailSize)
                        }
                        .buttonStyle(.bordered)
                        Button(model.cullingUsesFill ? "Fill" : "Fit") {
                            model.toggleCullingFitFill()
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .layoutPriority(3)
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVGrid(
                            columns: Array(
                                repeating: GridItem(.flexible(minimum: 0), spacing: 8),
                                count: model.cullingGridDensity
                            ),
                            spacing: 8
                        ) {
                            ForEach(model.visibleCullingAssets) { asset in
                                CullingAssetCard(
                                    asset: asset,
                                    state: model.cullingStates[asset.id],
                                    thumbnail: model.cullingThumbnails[asset.id],
                                    isSelected: model.cullingSelection.selectedIDs.contains(asset.id),
                                    isFocused: model.cullingSelection.focusedID == asset.id,
                                    usesFill: model.cullingUsesFill
                                )
                                .id(asset.id)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    model.clickCullingAsset(asset.id, modifiers: NSEvent.modifierFlags)
                                    Task { await model.loadPreview() }
                                }
                                .task { await model.loadThumbnail(for: asset.id) }
                            }
                        }
                        .padding(.horizontal, 6)
                        .padding(.top, 12)
                        .padding(.bottom, 6)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .animation(.snappy(duration: 0.24), value: model.cullingGridDensity)
                    }
                    .id(cullingViewportIdentity)
                    .background {
                        GeometryReader { gridGeometry in
                            Color.clear
                                .onAppear {
                                    model.updateCullingGridWidth(
                                        Double(gridGeometry.size.width - 12)
                                    )
                                }
                                .onChange(of: gridGeometry.size.width) { _, width in
                                    model.updateCullingGridWidth(Double(width - 12))
                                }
                        }
                    }
                    .focusable()
                    .onMoveCommand { direction in
                        let extending = NSEvent.modifierFlags.contains(.shift)
                        switch direction {
                        case .left:
                            model.moveCullingSelection(by: -1, extending: extending)
                        case .right:
                            model.moveCullingSelection(by: 1, extending: extending)
                        case .up:
                            model.moveCullingSelection(by: -model.cullingGridDensity, extending: extending)
                        case .down:
                            model.moveCullingSelection(by: model.cullingGridDensity, extending: extending)
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
                    .onKeyPress("p") {
                        Task { await model.applyPickShortcut(.pick) }
                        return .handled
                    }
                    .onKeyPress("h") {
                        Task { await model.applyPickShortcut(.reject) }
                        return .handled
                    }
                    .onKeyPress("x") {
                        Task { await model.tombstoneCullingSelection() }
                        return .handled
                    }
                    .onKeyPress("u") {
                        Task { await model.applyPickShortcut(.unpick) }
                        return .handled
                    }
                    .onKeyPress("b") {
                        model.selectFocusedBurst()
                        return .handled
                    }
                    .onKeyPress("+") {
                        increaseCullingThumbnailSize()
                        return .handled
                    }
                    .onKeyPress("-") {
                        decreaseCullingThumbnailSize()
                        return .handled
                    }
                    .onKeyPress("z") {
                        model.toggleCullingFitFill()
                        return .handled
                    }
                    .onKeyPress(characters: .decimalDigits) { press in
                        guard let value = Int(press.characters) else { return .ignored }
                        if (0...5).contains(value) {
                            Task { await model.applyRatingShortcut(value) }
                            return .handled
                        }
                        let colors: [Int: SidecarColor] = [
                            6: .red, 7: .yellow, 8: .green, 9: .blue,
                        ]
                        guard let color = colors[value] else { return .ignored }
                        Task { await model.applyColorShortcut(color) }
                        return .handled
                    }
                    .overlay {
                        if model.visibleCullingAssets.isEmpty {
                            ContentUnavailableView(
                                model.cullingAssets.isEmpty ? "No culling items" : "No matching items",
                                systemImage: "photo.stack",
                                description: Text(model.cullingAssets.isEmpty
                                    ? "Open a fixture snapshot or load Photos."
                                    : "Change or clear the current filters.")
                            )
                        }
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 240, maxHeight: .infinity)
                .clipped()
                .layoutPriority(1)
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Button("Open in Review") { model.sendCullingSelection(to: .review) }
                            .disabled(model.cullingSelection.selectedIDs.isEmpty)
                        Button("Send to Metadata") { model.sendCullingSelection(to: .metadata) }
                            .disabled(model.cullingSelection.selectedIDs.isEmpty)
                        Button("Send to Uploads") { model.sendCullingSelection(to: .uploads) }
                            .disabled(model.cullingSelection.selectedIDs.isEmpty)
                        Spacer()
                    }
                    FlowLayout(spacing: 8) {
                        Text("\(model.cullingSelection.selectedIDs.count) selected")
                        Picker("Fixture decision", selection: $model.cullingPickAction) {
                            ForEach(SidecarPickAction.allCases, id: \.self) { action in
                                let label: String = switch action {
                                case .pick: "Include"
                                case .reject: "Exclude"
                                case .unpick: "Undecided"
                                }
                                Text(label).tag(action)
                            }
                        }
                        .frame(width: 180)
                        Button("Apply fixture decision") {
                            Task { await model.applyPickShortcut(model.cullingPickAction) }
                        }
                        .disabled(
                            model.cullingSelection.selectedIDs.isEmpty
                                || model.isApplyingCullingDecision
                                || !model.hasCurrentCullingFixture
                        )
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
                        .disabled(model.cullingSelection.selectedIDs.isEmpty || model.isApplyingCullingDecision)
                        Picker("Color", selection: $model.cullingColor) {
                            ForEach(SidecarColor.allCases, id: \.self) {
                                Text($0.label).tag($0)
                            }
                        }
                        .frame(width: 145)
                        Button("Apply color") {
                            Task { await model.applyColor() }
                        }
                        .disabled(model.cullingSelection.selectedIDs.isEmpty || model.isApplyingCullingDecision)
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
                    .labelsHidden()
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
                    if model.isLoadingCullingDecisions || model.isApplyingCullingDecision {
                        HStack {
                            ProgressView(
                                value: Double(model.cullingDecisionProgress),
                                total: Double(max(1, model.cullingDecisionTotal))
                            )
                            Button("Stop") { model.cancelCullingOperation() }
                                .disabled(model.cullingCancellationRequested)
                        }
                    }
                    Text("Shortcuts: P include in fixture • H exclude from fixture • X globally reject • U clear fixture decision • 0–5 rating • 6–9 color • +/− density • Z fit/fill • Space Quick Look • ⌘Z undo")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .bottomLeading)
                .layoutPriority(2)
            }
            .padding()
            .frame(minWidth: 480)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .clipped()

                if model.isPreviewPanelVisible {
                    Group {
                        if model.isLoadingPreview {
                            ProgressView("Loading preview…")
                        } else if let preview = model.photoPreview,
                                  let image = NSImage(data: preview.jpegData),
                                  let asset = model.focusedCullingAsset {
                            ScrollView {
                                VStack(alignment: .leading, spacing: 12) {
                                    Image(nsImage: image)
                                        .resizable()
                                        .scaledToFit()
                                    cullingMetadataInspector(asset)
                                }
                                .padding()
                            }
                        } else {
                            ContentUnavailableView(
                                "No preview",
                                systemImage: "photo",
                                description: Text("Select a photo, or press Space for Quick Look.")
                            )
                        }
                    }
                    .frame(minWidth: 220, idealWidth: 300, maxWidth: 360)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .padding(.top, viewport.safeAreaInsets.top)
            .frame(
                width: viewport.size.width,
                height: max(0, viewport.size.height - viewport.safeAreaInsets.top),
                alignment: .top
            )
        }
        .animation(.snappy(duration: 0.24), value: model.isPreviewPanelVisible)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            if model.fixtures.isEmpty {
                await model.loadFixtures()
            }
            if model.libraryItems.isEmpty {
                await model.refreshPhotos()
            }
            if !model.cullingFixtureID.isEmpty {
                await model.loadFixtureCullingWindow()
            } else {
                await model.refreshCullingDecisions()
            }
        }
    }

    private var cullingHeading: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(
                model.cullingPool?.name
                    ?? model.flatFixtures.first(where: { $0.id == model.cullingFixtureID })?.name
                    ?? "Fixture Culling"
            )
            .font(.largeTitle.bold())
            if let pool = model.cullingPool {
                Text("Fixture pool \(pool.id) • \(pool.assetCount) immutable ordered assets")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var cullingViewportIdentity: String {
        [
            model.cullingFixtureID,
            model.cullingViews.map(\.rawValue).sorted().joined(separator: ","),
            String(model.cullingWorkspace.offset),
            model.visibleCullingAssets.first?.id ?? "empty",
        ].joined(separator: ":")
    }

    private var cullingHeaderActions: some View {
        HStack {
            if model.cullingPool != nil {
                Button("All Photos") {
                    model.showAllPhotosInCulling()
                }
            }
            Button("Allow Photos") {
                Task { await model.authorizeAndLoadPhotos() }
            }
            Button("Refresh previews") {
                Task {
                    await model.refreshPhotos()
                    if !model.cullingFixtureID.isEmpty {
                        await model.loadFixtureCullingWindow()
                    }
                }
            }
            .disabled(model.isLoadingPhotos || model.isReconcilingPhotosIndex)
            Button {
                Task { await model.reconcilePhotosLibraryIndex() }
            } label: {
                if model.isReconcilingPhotosIndex {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Reconciling complete Photos library")
                } else {
                    Text("Reconcile library")
                }
            }
            .disabled(model.isLoadingPhotos || model.isReconcilingPhotosIndex)
            .help("Stream the complete Photos library through the signed helper and reconcile Owner without changing existing decisions.")
        }
    }

    @ViewBuilder
    private func cullingMetadataInspector(_ asset: FixtureAsset) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(asset.title.isEmpty ? asset.filename : asset.title)
                .font(.headline)
                .textSelection(.enabled)
            metadataRow("File", value: asset.filename)
            metadataRow(
                "Format",
                value: asset.resourceFormat.isEmpty
                    ? (asset.filename as NSString).pathExtension.uppercased()
                    : asset.resourceFormat
            )
            metadataRow("Captured", value: formattedCaptureDate(asset.capturedAt))
            metadataRow("Dimensions", value: formattedDimensions(asset))
            metadataRow("Original size", value: formattedOriginalSize(asset.originalByteCount))
            VStack(alignment: .leading, spacing: 3) {
                Text("Keywords")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(asset.keywords.isEmpty ? "No keywords" : asset.keywords.joined(separator: ", "))
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func metadataRow(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value.isEmpty ? "Unavailable" : value)
                .textSelection(.enabled)
        }
    }

    private func formattedCaptureDate(_ value: String) -> String {
        guard !value.isEmpty,
              let date = ISO8601DateFormatter().date(from: value)
        else { return "Unavailable" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private func formattedDimensions(_ asset: FixtureAsset) -> String {
        guard asset.pixelWidth > 0, asset.pixelHeight > 0 else {
            return "Unavailable"
        }
        let megapixels = Double(asset.pixelWidth * asset.pixelHeight) / 1_000_000
        return "\(asset.pixelWidth) × \(asset.pixelHeight) • \(megapixels.formatted(.number.precision(.fractionLength(1)))) MP"
    }

    private func formattedOriginalSize(_ byteCount: Int64) -> String {
        guard byteCount > 0 else {
            return "Unavailable without requesting the original; it may be cloud-only."
        }
        return ByteCountFormatter.string(fromByteCount: byteCount, countStyle: .file)
    }

    private func increaseCullingThumbnailSize() {
        withAnimation(.snappy(duration: 0.24)) {
            model.increaseCullingThumbnailSize()
        }
    }

    private func decreaseCullingThumbnailSize() {
        withAnimation(.snappy(duration: 0.24)) {
            model.decreaseCullingThumbnailSize()
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

private struct CullingAssetCard: View {
    var asset: FixtureAsset
    var state: SidecarDecisionState?
    var thumbnail: NSImage?
    var isSelected: Bool
    var isFocused: Bool
    var usesFill: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Group {
                if let thumbnail {
                    Image(nsImage: thumbnail)
                        .resizable()
                        .aspectRatio(contentMode: usesFill ? .fill : .fit)
                } else {
                    Image(systemName: asset.mediaType == "video" ? "video" : "photo")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(4 / 3, contentMode: .fit)
            .background(.quaternary.opacity(0.45))
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .clipped()
            .saturation(isHidden ? 0 : 1)
            .overlay(alignment: .topTrailing) {
                if isPicked {
                    Image(systemName: "flag.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(6)
                        .background(.blue, in: Circle())
                        .padding(6)
                        .accessibilityLabel("Picked")
                }
            }
            HStack(spacing: 5) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(asset.title.isEmpty ? asset.filename : asset.title)
                        .lineLimit(1)
                        .font(.caption.weight(.semibold))
                    if !asset.title.isEmpty {
                        Text(asset.filename)
                            .lineLimit(1)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 2)
                Text(starLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Circle()
                    .fill(color(state?.color ?? ""))
                    .overlay(Circle().stroke(.secondary.opacity(0.5)))
                    .frame(width: 11, height: 11)
            }
        }
        .padding(6)
        .background(
            RoundedRectangle(cornerRadius: 9)
                .fill(isSelected ? Color.accentColor.opacity(0.22) : Color.secondary.opacity(0.06))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 9)
                .stroke(
                    isFocused ? Color.accentColor : (isSelected ? Color.accentColor.opacity(0.65) : .clear),
                    lineWidth: isFocused ? 3 : 1
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var starLabel: String {
        let rating = state?.rating ?? asset.rating
        return rating > 0 ? String(repeating: "★", count: rating) : "☆"
    }

    private var isHidden: Bool {
        asset.placementState == .hidden
            || state?.pickState == "hidden"
            || state?.pickState == "rejected"
    }

    private var isPicked: Bool {
        asset.placementState == .picked
            || state?.pickState == "picked"
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

private struct LightroomRatingFilterButton: View {
    let rating: Int
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if rating == 0 {
                    Image(systemName: "star.slash")
                } else {
                    Image(systemName: "star.fill")
                }
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(isSelected ? Color.yellow : Color.secondary)
            .frame(width: 22, height: 22)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(isSelected ? Color.accentColor.opacity(0.24) : .clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5)
                    .stroke(isSelected ? Color.accentColor.opacity(0.8) : .clear)
            )
        }
        .buttonStyle(.plain)
        .help(rating == 0 ? "Include unrated photos" : "Include \(rating)-star photos")
        .accessibilityLabel(rating == 0 ? "Unrated" : "\(rating) stars")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct LightroomColorFilterButton: View {
    let color: CullingColorFilter
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 3)
                    .fill(filterColor)
                RoundedRectangle(cornerRadius: 3)
                    .stroke(isSelected ? Color.white : Color.secondary, lineWidth: isSelected ? 2 : 1)
                if color == .none {
                    Image(systemName: "slash")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 20, height: 20)
            .padding(2)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(isSelected ? Color.accentColor.opacity(0.35) : .clear)
            )
        }
        .buttonStyle(.plain)
        .help("Include \(color.label.lowercased())")
        .accessibilityLabel(color.label)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var filterColor: Color {
        switch color {
        case .red: .red
        case .yellow: .yellow
        case .green: .green
        case .blue: .blue
        case .purple: .purple
        case .none, .all: .clear
        }
    }
}

private struct FixturePickerOption: Identifiable {
    let label: String
    let value: String

    var id: String { value }

    init(_ label: String, _ value: String) {
        self.label = label
        self.value = value
    }
}

private struct FixturePickerField: View {
    let title: String
    @Binding var selection: String
    let options: [FixturePickerOption]

    init(
        _ title: String,
        selection: Binding<String>,
        options: [FixturePickerOption]
    ) {
        self.title = title
        _selection = selection
        self.options = options
    }

    var body: some View {
        HStack(spacing: 12) {
            Text(title)
                .lineLimit(1)
                .layoutPriority(1)
            Spacer(minLength: 8)
            Menu {
                ForEach(options) { option in
                    Button {
                        selection = option.value
                    } label: {
                        if option.value == selection {
                            Label(option.label, systemImage: "checkmark")
                        } else {
                            Text(option.label)
                        }
                    }
                }
            } label: {
                HStack {
                    Text(options.first(where: { $0.value == selection })?.label ?? selection)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.up.chevron.down")
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 10)
                .frame(width: 220, height: 28, alignment: .leading)
                .background(
                    Color.secondary.opacity(0.18),
                    in: RoundedRectangle(cornerRadius: 7)
                )
                .contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct AdaptiveFixtureFieldPair<Left: View, Right: View>: View {
    let minimumColumnWidth: CGFloat
    @ViewBuilder let left: Left
    @ViewBuilder let right: Right

    init(
        minimumColumnWidth: CGFloat = 250,
        @ViewBuilder left: () -> Left,
        @ViewBuilder right: () -> Right
    ) {
        self.minimumColumnWidth = minimumColumnWidth
        self.left = left()
        self.right = right()
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 24) {
                left
                    .frame(minWidth: minimumColumnWidth, maxWidth: .infinity)
                right
                    .frame(minWidth: minimumColumnWidth, maxWidth: .infinity)
            }
            VStack(alignment: .leading, spacing: 8) {
                left
                right
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
                    .disabled(model.isLoadingFixtureTree)
            }
            HStack {
                if model.isLoadingFixtureTree {
                    ProgressView()
                        .controlSize(.small)
                }
                Text(model.isLoadingFixtureTree ? "Loading fixture tree…" : model.fixtureStatus)
                    .foregroundStyle(.secondary)
            }
            HSplitView {
                VStack(alignment: .leading, spacing: 10) {
                    List(selection: $model.selectedFixtureID) {
                        OutlineGroup(model.fixtures, children: \.outlineChildren) { fixture in
                            HStack {
                                Image(systemName: fixture.isArchived ? "archivebox" : "folder")
                                VStack(alignment: .leading) {
                                    Text(fixture.name)
                                    Text(fixture.id).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .tag(fixture.id)
                        }
                    }
                    if !model.selectedFixturePath.isEmpty {
                        Text(model.selectedFixturePath.map(\.name).joined(separator: "  ›  "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
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
                    .frame(minHeight: 140, idealHeight: 180, maxHeight: 220)
                    .overlay {
                        if model.isSearchingFixtureAssets && model.fixtureAssets.isEmpty {
                            ProgressView("Loading fixture candidates…")
                        } else if model.fixtureAssets.isEmpty {
                            ContentUnavailableView(
                                "No candidates loaded",
                                systemImage: "photo.stack",
                                description: Text("Choose a fixture and search by title, keyword, file, or camera.")
                            )
                        }
                    }
                    HStack {
                        Text("\(model.selectedFixtureAssetIDs.count) selected")
                        Spacer()
                        Button("Create stable culling snapshot") {
                            Task { await model.snapshotFixtureAssets() }
                        }
                        .disabled(model.selectedFixtureAssetIDs.isEmpty || model.selectedFixtureID.isEmpty)
                    }
                    ScrollView(.vertical) {
                        VStack(alignment: .leading, spacing: 10) {
                            if !model.selectedFixtureID.isEmpty {
                                GroupBox("Population contract") {
                                    VStack(alignment: .leading, spacing: 8) {
                                        AdaptiveFixtureFieldPair(minimumColumnWidth: 280) {
                                            FixturePickerField(
                                                "Population",
                                                selection: $model.fixturePopulationMode,
                                                options: [
                                                    FixturePickerOption("Curated", "curated"),
                                                    FixturePickerOption("Rule-based", "rule-based"),
                                                    FixturePickerOption("Parent subset", "parent-subset"),
                                                ]
                                            )
                                        } right: {
                                            FixturePickerField(
                                                "Source",
                                                selection: $model.fixtureCandidateSourceKind,
                                                options: [
                                                    FixturePickerOption("Photos library", "photos-library"),
                                                    FixturePickerOption(
                                                        "Parent effective snapshot",
                                                        "parent-effective"
                                                    ),
                                                    FixturePickerOption("Saved snapshot", "saved-snapshot"),
                                                ]
                                            )
                                        }
                                        if model.fixturePopulationMode == "rule-based" {
                                            TextField(
                                                "Saved rule query",
                                                text: $model.fixtureSavedRuleQuery
                                            )
                                        }
                                    }
                                }
                                GroupBox("Configured on this fixture") {
                                    VStack(alignment: .leading, spacing: 8) {
                                        AdaptiveFixtureFieldPair {
                                            FixturePickerField(
                                                "Visibility",
                                                selection: $model.fixturePolicyVisibility,
                                                options: [
                                                    FixturePickerOption("Inherit", "inherit"),
                                                    FixturePickerOption("Public", "public"),
                                                    FixturePickerOption("Private", "private"),
                                                    FixturePickerOption("Unlisted", "unlisted"),
                                                ]
                                            )
                                        } right: {
                                            FixturePickerField(
                                                "Search",
                                                selection: $model.fixturePolicySearchable,
                                                options: [
                                                    FixturePickerOption("Inherit", "inherit"),
                                                    FixturePickerOption("On", "on"),
                                                    FixturePickerOption("Off", "off"),
                                                ]
                                            )
                                        }
                                        AdaptiveFixtureFieldPair {
                                            FixturePickerField(
                                                "Retention",
                                                selection: $model.fixturePolicyRetention,
                                                options: [
                                                    FixturePickerOption("Inherit", "inherit"),
                                                    FixturePickerOption("Public preview", "public-preview"),
                                                    FixturePickerOption("Private master", "private-master"),
                                                    FixturePickerOption("Archive only", "archive-only"),
                                                    FixturePickerOption("No cloud", "no-cloud"),
                                                ]
                                            )
                                        } right: {
                                            FixturePickerField(
                                                "Delivery",
                                                selection: $model.fixturePolicyDelivery,
                                                options: [
                                                    FixturePickerOption("Inherit", "inherit"),
                                                    FixturePickerOption("Public", "public"),
                                                    FixturePickerOption("Granted", "granted"),
                                                    FixturePickerOption("Owner only", "owner-only"),
                                                    FixturePickerOption("Disabled", "disabled"),
                                                ]
                                            )
                                        }
                                        AdaptiveFixtureFieldPair {
                                            FixturePickerField(
                                                "Download",
                                                selection: $model.fixturePolicyDownload,
                                                options: [
                                                    FixturePickerOption("Inherit", "inherit"),
                                                    FixturePickerOption("On", "on"),
                                                    FixturePickerOption("Off", "off"),
                                                ]
                                            )
                                        } right: {
                                            FixturePickerField(
                                                "Commerce",
                                                selection: $model.fixturePolicyCommerce,
                                                options: [
                                                    FixturePickerOption("Inherit", "inherit"),
                                                    FixturePickerOption("Retail", "retail"),
                                                    FixturePickerOption("Paid service", "paid-service"),
                                                    FixturePickerOption("Free sharing", "free-sharing"),
                                                    FixturePickerOption("Disabled", "disabled"),
                                                ]
                                            )
                                        }
                                    }
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack {
                                            Button("Save contract") {
                                                Task { await model.saveFixtureConfiguration() }
                                            }
                                            .disabled(model.isLoadingFixturePolicy)
                                            if model.isLoadingFixturePolicy {
                                                ProgressView().controlSize(.small)
                                            }
                                            Text(model.fixturePolicyStatus)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                GroupBox("Effective policy • revision \(model.fixturePolicyRevision)") {
                                    Text(model.fixtureEffectivePolicySummary)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            DisclosureGroup("Reversible fixture placements") {
                                HStack(alignment: .top) {
                                    List(selection: $model.placementTargetFixtureIDs) {
                                        OutlineGroup(model.fixtures, children: \.outlineChildren) { fixture in
                                            if !fixture.isArchived {
                                                Text(fixture.name).tag(fixture.id)
                                            }
                                        }
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
                            if !model.selectedFixtureID.isEmpty {
                                GroupBox("Saved culling snapshots") {
                                    VStack(alignment: .leading, spacing: 8) {
                                        if model.fixturePools.isEmpty {
                                            Text("No saved snapshots loaded.")
                                                .foregroundStyle(.secondary)
                                        } else {
                                            List(model.fixturePools, selection: $model.selectedFixturePoolID) { pool in
                                                HStack {
                                                    VStack(alignment: .leading, spacing: 2) {
                                                        Text(pool.name)
                                                        Text("\(pool.assetCount) assets • \(String(pool.snapshotHash.prefix(12)))")
                                                            .font(.caption)
                                                            .foregroundStyle(.secondary)
                                                    }
                                                    Spacer()
                                                    Text(pool.state.capitalized)
                                                        .foregroundStyle(.secondary)
                                                }
                                                .tag(pool.id)
                                            }
                                            .frame(minHeight: 72, maxHeight: 130)
                                        }
                                        HStack {
                                            Button(model.isReloadingFixturePools ? "Reloading…" : "Reload snapshots") {
                                                Task { await model.loadFixturePools() }
                                            }
                                            .disabled(model.isRunningFixtureSnapshotOperation)
                                            Button(model.isOpeningFixturePool ? "Opening…" : "Open selected in Culling") {
                                                Task { await model.openSelectedFixturePool() }
                                            }
                                            .disabled(
                                                model.selectedFixturePoolID.isEmpty
                                                    || model.isRunningFixtureSnapshotOperation
                                            )
                                            if model.isRunningFixtureSnapshotOperation {
                                                ProgressView()
                                                    .controlSize(.small)
                                            }
                                        }
                                        if !model.fixtureSnapshotStatus.isEmpty {
                                            Text(model.fixtureSnapshotStatus)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                            if let pool = model.selectedFixturePoolSummary {
                                GroupBox("Selected snapshot") {
                                    LabeledContent("Pool", value: pool.name)
                                    LabeledContent("Assets", value: pool.assetCount.formatted())
                                    LabeledContent("Pool ID", value: pool.id)
                                    if !pool.snapshotHash.isEmpty {
                                        LabeledContent("Snapshot", value: String(pool.snapshotHash.prefix(12)))
                                    }
                                    HStack {
                                        Button(model.isOpeningFixturePool ? "Opening…" : "Open in Culling") {
                                            Task { await model.openSelectedFixturePool() }
                                        }
                                        .disabled(model.isRunningFixtureSnapshotOperation)
                                        if model.isOpeningFixturePool {
                                            ProgressView()
                                                .controlSize(.small)
                                        }
                                    }
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding()
            }
        }
        .task {
            if model.fixtures.isEmpty { await model.loadFixtures() }
        }
        .onChange(of: model.selectedFixtureID) { _, _ in
            Task {
                await model.loadFixturePools()
                await model.loadFixtureConfiguration()
            }
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
                            .width(min: 150, ideal: 190)
                        TableColumn("Kind") { Text($0.kind ?? "event") }
                            .width(min: 80, ideal: 100)
                        TableColumn("State") { Text($0.state ?? "active") }
                            .width(min: 70, ideal: 85)
                        TableColumn("Actions") { group in
                            Button(group.isArchived ? "Archived" : "Archive") {
                                Task { await model.archiveGroup(group.id) }
                            }
                                .disabled(group.isArchived)
                        }
                        .width(min: 78, ideal: 90)
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

private struct FixtureReviewView: View {
    @ObservedObject var model: BackstageViewModel
    @StateObject private var quickLook = BackstageQuickLookCoordinator()

    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 10) {
                    ViewThatFits(in: .horizontal) {
                        HStack {
                            reviewHeading
                            Spacer()
                            reviewScopeControls
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            reviewHeading
                            reviewScopeControls
                        }
                    }
                    HStack {
                        TextField("Search complete Review queue", text: $model.reviewSearch)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit {
                                model.reviewWindowOffset = 0
                                Task { await model.loadFixtureReviewWindow() }
                            }
                        Button("Search") {
                            model.reviewWindowOffset = 0
                            Task { await model.loadFixtureReviewWindow() }
                        }
                        Button("Refresh") {
                            Task { await model.loadFixtureReviewWindow() }
                        }
                        .disabled(model.isRunningReview)
                    }
                }
                if let summary = model.fixtureReviewWindow?.summary {
                    FlowLayout(spacing: 10) {
                        Text("\(summary.total.formatted()) unresolved")
                        Text("\(summary.unreviewed.formatted()) unreviewed")
                        Text("\(summary.requestingAI.formatted()) requesting AI")
                        Text("\(summary.proposed.formatted()) proposed")
                        if model.reviewMode == .full {
                            Text("\(summary.approved.formatted()) approved")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                HStack(spacing: 10) {
                    if model.readyAIProposalCount > 0 {
                        Label(
                            "\(model.readyAIProposalCount.formatted()) new proposal\(model.readyAIProposalCount == 1 ? "" : "s") ready",
                            systemImage: "sparkles"
                        )
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.orange)
                        Button("Load proposals") {
                            Task { await model.loadAIProposals() }
                        }
                    }
                    if !model.reviewProposalConflictIDs.isEmpty {
                        Button("Replace \(model.reviewProposalConflictIDs.count) conflicting draft\(model.reviewProposalConflictIDs.count == 1 ? "" : "s")") {
                            Task { await model.loadAIProposals(replacingConflicts: true) }
                        }
                        .tint(.orange)
                    }
                    Spacer()
                    Button(model.isRunningAIPass ? "AI pass running…" : "Run AI pass now") {
                        Task { await model.runAIProposalPass() }
                    }
                    .disabled(model.isRunningAIPass || (model.fixtureAIStatus?.requested ?? 0) == 0)
                    if model.fixtureAIStatus?.active == true {
                        Button("Cancel") {
                            Task { await model.cancelAIProposalPass() }
                        }
                    }
                }
                Text(model.aiProposalStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let run = model.fixtureAIStatus?.run, model.fixtureAIStatus?.active == true {
                    ProgressView(
                        value: Double(run.processed),
                        total: Double(max(1, run.requested))
                    )
                }
                HStack(spacing: 10) {
                    if let window = model.fixtureReviewWindow {
                        let first = window.items.isEmpty ? 0 : window.offset + 1
                        let last = window.offset + window.items.count
                        Text("\(first.formatted())–\(last.formatted()) of \(window.summary.total.formatted())")
                            .font(.callout.weight(.semibold))
                            .monospacedDigit()
                    } else {
                        Text("Loading Review queue…")
                            .font(.callout.weight(.semibold))
                    }
                    Spacer()
                    Button("Previous \(model.reviewWindowLimit)") {
                        model.moveReviewWindow(forward: false)
                    }
                    .disabled((model.fixtureReviewWindow?.offset ?? 0) == 0)
                    Button("Next \(model.reviewWindowLimit)") {
                        model.moveReviewWindow(forward: true)
                    }
                    .disabled(!(model.fixtureReviewWindow?.hasNext ?? false))
                }
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(model.reviewItems) { item in
                                ReviewAssetRow(
                                    item: item,
                                    proposalDraft: model.reviewProposalDrafts[item.id],
                                    thumbnail: model.reviewThumbnails[item.id],
                                    isSelected: model.reviewSelection.selectedIDs.contains(item.id),
                                    isFocused: model.reviewSelection.focusedID == item.id,
                                    hasDraftAIReason: model.reviewSelection.selectedIDs.contains(item.id)
                                        && !model.reviewAIReasons.isEmpty,
                                    hasProposalDraft: model.hasProposalDraft(for: item.id),
                                    hasProposalConflict: model.reviewProposalConflictIDs.contains(item.id)
                                )
                                .id(item.id)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    model.clickReviewItem(item.id, modifiers: NSEvent.modifierFlags)
                                }
                                .task { await model.loadReviewThumbnail(for: item) }
                            }
                        }
                        .padding(6)
                    }
                    .focusable()
                    .onChange(of: model.reviewScrollTargetID) { _, target in
                        guard let target else { return }
                        proxy.scrollTo(target, anchor: .center)
                    }
                    .onMoveCommand { direction in
                        let extending = NSEvent.modifierFlags.contains(.shift)
                        switch direction {
                        case .up, .left:
                            model.moveReviewSelection(by: -1, extending: extending)
                        case .down, .right:
                            model.moveReviewSelection(by: 1, extending: extending)
                        default:
                            return
                        }
                    }
                    .onKeyPress("a", phases: .down) { press in
                        if press.modifiers.contains(.command) {
                            model.selectAllReviewItems()
                        } else {
                            Task { await model.applyReviewAction(.approve) }
                        }
                        return .handled
                    }
                    .onKeyPress("h") {
                        Task { await model.applyReviewAction(.hide) }
                        return .handled
                    }
                    .onKeyPress(.space) {
                        Task {
                            let urls = await model.prepareReviewQuickLookURLs()
                            if !urls.isEmpty { quickLook.present(urls: urls) }
                        }
                        return .handled
                    }
                    .overlay {
                        if model.reviewItems.isEmpty {
                            ContentUnavailableView(
                                "Review queue is clear",
                                systemImage: "checkmark.circle",
                                description: Text("Picked photos appear here until approved or hidden.")
                            )
                        }
                    }
                }
                .frame(minHeight: 360, maxHeight: .infinity)
                HStack {
                    Text("\(model.reviewSelection.selectedIDs.count) selected")
                    Spacer()
                    Button("Undo") {
                        Task { await model.undoLastReviewAction() }
                    }
                    .keyboardShortcut("z", modifiers: .command)
                    .disabled(model.reviewHistory.isEmpty || model.isRunningReview)
                    Button("Clear selection") { model.clearReviewSelection() }
                        .disabled(model.reviewSelection.selectedIDs.isEmpty)
                }
                Text(model.reviewStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding()
            .frame(minWidth: 480)

            if model.isPreviewPanelVisible {
                ReviewInspector(model: model, quickLook: quickLook)
                    .frame(minWidth: 300, idealWidth: 380, maxWidth: 480)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.24), value: model.isPreviewPanelVisible)
        .task {
            if model.fixtures.isEmpty {
                await model.loadFixtures()
            }
            if model.reviewFixtureID.isEmpty {
                model.reviewFixtureID = model.cullingFixtureID
            }
            await model.loadFixtureReviewWindow()
            await model.restoreLoadedAIProposalDrafts()
            await model.refreshAIStatus()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled else { break }
                await model.refreshAIStatus()
            }
        }
    }

    private var reviewHeading: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Review")
                .font(.largeTitle.bold())
            Text("Oldest picked photos first")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var reviewScopeControls: some View {
        FlowLayout(spacing: 10) {
            Picker(
                "Fixture",
                selection: Binding(
                    get: { model.reviewFixtureID },
                    set: { model.selectReviewFixture($0) }
                )
            ) {
                ForEach(model.flatFixtures.filter { !$0.isArchived }) { fixture in
                    let depth = max(0, model.fixtures.path(to: fixture.id).count - 1)
                    Text("\(String(repeating: "  ", count: depth))\(fixture.name)")
                        .tag(fixture.id)
                }
            }
            .frame(width: 180)
            Picker(
                "Queue",
                selection: Binding(
                    get: { model.reviewMode },
                    set: { model.selectReviewMode($0) }
                )
            ) {
                ForEach(FixtureReviewMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 170)
            Toggle(
                "Proposal Available",
                isOn: Binding(
                    get: { model.reviewProposalAvailableOnly },
                    set: { model.setReviewProposalAvailableOnly($0) }
                )
            )
            .toggleStyle(.checkbox)
            Text("Media")
                .font(.callout.weight(.semibold))
            ForEach(CullingMediaFilter.selectableCases, id: \.rawValue) { filter in
                Toggle(
                    filter.label,
                    isOn: Binding(
                        get: { model.reviewMediaFilters.contains(filter) },
                        set: { _ in model.toggleReviewMediaFilter(filter) }
                    )
                )
                .toggleStyle(.checkbox)
            }
        }
    }
}

private struct ReviewAssetRow: View {
    var item: FixtureReviewItem
    var proposalDraft: ReviewMetadataDraft?
    var thumbnail: NSImage?
    var isSelected: Bool
    var isFocused: Bool
    var hasDraftAIReason: Bool
    var hasProposalDraft: Bool
    var hasProposalConflict: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if let thumbnail {
                    Image(nsImage: thumbnail)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .saturation(item.placementState == "hidden" ? 0 : 1)
                } else {
                    Image(systemName: item.mediaType == "video" ? "video" : "photo")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 180, height: 126)
            .background(.quaternary.opacity(0.4))
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .overlay(alignment: .topTrailing) {
                reviewStateBadge
                    .padding(8)
            }
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Text(item.filename)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer()
                    Text(item.rating > 0 ? String(repeating: "★", count: item.rating) : "☆")
                    Circle()
                        .fill(reviewColor(item.color))
                        .overlay(Circle().stroke(.secondary.opacity(0.5)))
                        .frame(width: 12, height: 12)
                }
                Text(item.capturedAt)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack(alignment: .top, spacing: 12) {
                    reviewMetadataColumn(
                        label: "Current",
                        title: item.title.isEmpty ? "Untitled" : item.title,
                        keywords: item.keywords.isEmpty
                            ? "No keywords"
                            : item.keywords.joined(separator: ", "),
                        isProposal: false
                    )
                    Divider()
                    reviewMetadataColumn(
                        label: "Proposed",
                        title: proposalTitle,
                        keywords: proposalKeywords,
                        isProposal: proposalDraft?.isProposal == true
                    )
                }
                HStack {
                    Text(item.editorialState.replacingOccurrences(of: "-", with: " ").capitalized)
                    if item.editorialState == "requesting-ai" {
                        Text("• \(item.aiReasons.count) reason\(item.aiReasons.count == 1 ? "" : "s")")
                    }
                    if hasProposalDraft {
                        Label("Proposal draft", systemImage: "sparkles")
                    }
                    if hasProposalConflict {
                        Label("Manual draft kept", systemImage: "exclamationmark.triangle.fill")
                    }
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(
                    item.editorialState == "requesting-ai" || hasProposalDraft || hasProposalConflict
                        ? .orange
                        : .secondary
                )
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(isSelected ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.06))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(isFocused ? Color.accentColor : .clear, lineWidth: 3)
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var proposalTitle: String {
        guard let proposalDraft else { return "No proposal" }
        return proposalDraft.title.isEmpty ? "Untitled" : proposalDraft.title
    }

    private var proposalKeywords: String {
        guard let proposalDraft else { return "—" }
        return proposalDraft.keywords.isEmpty
            ? "No keywords"
            : proposalDraft.keywords.joined(separator: ", ")
    }

    private func reviewMetadataColumn(
        label: String,
        title: String,
        keywords: String,
        isProposal: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(label)
                    .font(.caption2.weight(.bold))
                    .textCase(.uppercase)
                if isProposal {
                    Image(systemName: "sparkles")
                }
            }
            .foregroundStyle(isProposal ? .orange : .secondary)
            Text(title)
                .font(.callout.weight(.semibold))
                .lineLimit(2)
            Text(keywords)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var reviewStateBadge: some View {
        if hasDraftAIReason || !item.aiReasons.isEmpty || item.editorialState == "requesting-ai" {
            Image(systemName: "questionmark.circle.fill")
                .font(.system(size: 30, weight: .bold))
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, .orange)
                .accessibilityLabel("Marked for AI review")
        } else if item.editorialState == "approved" {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 30, weight: .bold))
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, .green)
                .accessibilityLabel("Approved")
        }
    }

    private func reviewColor(_ value: String) -> Color {
        switch value {
        case "red": .red
        case "yellow": .yellow
        case "green": .green
        case "blue": .blue
        default: .clear
        }
    }
}

private struct ReviewInspector: View {
    @ObservedObject var model: BackstageViewModel
    @ObservedObject var quickLook: BackstageQuickLookCoordinator

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Editorial")
                    .font(.title2.bold())
                if let item = model.focusedReviewItem {
                    if let thumbnail = model.reviewThumbnails[item.id] {
                        Image(nsImage: thumbnail)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .saturation(item.placementState == "hidden" ? 0 : 1)
                            .frame(maxHeight: 240)
                            .frame(maxWidth: .infinity)
                            .background(.quaternary.opacity(0.35))
                            .clipShape(RoundedRectangle(cornerRadius: 9))
                            .overlay(alignment: .topTrailing) {
                                if !model.reviewAIReasons.isEmpty
                                    || !item.aiReasons.isEmpty
                                    || item.editorialState == "requesting-ai" {
                                    Image(systemName: "questionmark.circle.fill")
                                        .font(.system(size: 30, weight: .bold))
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .orange)
                                        .padding(8)
                                } else if item.editorialState == "approved" {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 30, weight: .bold))
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .green)
                                        .padding(8)
                                }
                            }
                    }
                    Text(item.filename)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack(alignment: .top, spacing: 8) {
                        TextField(
                            "Title",
                            text: Binding(
                                get: { model.reviewTitle },
                                set: { model.updateReviewTitle($0) }
                            ),
                            axis: .vertical
                        )
                        .textFieldStyle(.roundedBorder)
                        Button {
                            Task { await model.propagateReviewTitle() }
                        } label: {
                            Image(systemName: "arrow.down")
                        }
                        .help("Propagate title")
                        .disabled(model.isRunningReview)
                    }
                    HStack(alignment: .top, spacing: 8) {
                        TextField(
                            "Keywords, comma separated",
                            text: Binding(
                                get: { model.reviewKeywords },
                                set: { model.updateReviewKeywords($0) }
                            ),
                            axis: .vertical
                        )
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(3...7)
                        Button {
                            Task { await model.propagateReviewKeywords() }
                        } label: {
                            Image(systemName: "arrow.down")
                        }
                        .help("Propagate keywords")
                        .disabled(model.isRunningReview)
                    }
                    if let proposal = model.reviewProposalDrafts[item.id], proposal.isProposal {
                        Label(
                            proposal.proposalReason.isEmpty
                                ? "AI proposal loaded as an editable draft"
                                : proposal.proposalReason,
                            systemImage: "sparkles"
                        )
                        .font(.caption)
                        .foregroundStyle(.orange)
                    }
                    Divider()
                    HStack {
                        Button("Approve") {
                            Task { await model.applyReviewAction(.approve) }
                        }
                        .keyboardShortcut("a", modifiers: [])
                        Button("Hide") {
                            Task { await model.applyReviewAction(.hide) }
                        }
                        .keyboardShortcut("h", modifiers: [])
                        Button("Propagate") {
                            Task { await model.propagateLastReviewAction() }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    HStack(spacing: 8) {
                        if model.isRunningReview {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(model.reviewStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                    Divider()
                    Text("Mark for AI review")
                        .font(.headline)
                    FlowLayout(spacing: 6) {
                        ForEach(model.reviewAIReasonChoices, id: \.self) { reason in
                            Button {
                                model.toggleReviewAIReason(reason)
                            } label: {
                                Label(
                                    reason,
                                    systemImage: model.reviewAIReasons.contains(reason)
                                        ? "checkmark.circle.fill"
                                        : "circle"
                                )
                            }
                            .buttonStyle(.bordered)
                            .tint(model.reviewAIReasons.contains(reason) ? .orange : nil)
                        }
                    }
                    TextField("Optional AI note", text: $model.reviewAINote, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(2...5)
                    Button("Update AI review mark") {
                        Task { await model.applyReviewAction(.requestAI) }
                    }
                    Divider()
                    Button("Quick Look") {
                        Task {
                            let urls = await model.prepareReviewQuickLookURLs()
                            if !urls.isEmpty { quickLook.present(urls: urls) }
                        }
                    }
                    .keyboardShortcut(.space, modifiers: [])
                } else {
                    ContentUnavailableView(
                        "No photo selected",
                        systemImage: "photo",
                        description: Text("Select a Review row to edit its title and keywords.")
                    )
                }
            }
            .padding()
        }
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let width = proposal.width ?? 0
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            view.place(
                at: CGPoint(x: x, y: y),
                anchor: .topLeading,
                proposal: ProposedViewSize(size)
            )
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

private struct MetadataGiveBackView: View {
    @ObservedObject var model: BackstageViewModel
    @State private var showingCommitConfirmation = false

    var body: some View {
        Form {
            Section("Incremental Apple Photos sync") {
                Text("A bounded low-priority pass runs at launch, whenever Backstage becomes active, and every 15 minutes. Metadata-only changes preserve approval and return to Needs Upload; rendered-image changes create a new source version and return to Review.")
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Sync now") {
                        Task { await model.syncPhotosIncrementally() }
                    }
                    .disabled(model.isSyncingPhotos)
                    if model.isSyncingPhotos {
                        ProgressView().controlSize(.small)
                    }
                    Text(model.photosSyncStatus)
                        .foregroundStyle(.secondary)
                }
                if let report = model.photosSyncReport {
                    HStack(spacing: 18) {
                        LabeledContent("Baseline", value: report.baseline.formatted())
                        LabeledContent("Unchanged", value: report.unchanged.formatted())
                        LabeledContent("Metadata", value: report.metadataOnly.formatted())
                        LabeledContent("Appearance", value: report.appearance.formatted())
                        LabeledContent("Missing", value: report.sourceMissing.formatted())
                        LabeledContent("Returned", value: report.sourceReturned.formatted())
                    }
                    .font(.caption)
                }
            }
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
                TextField("Optional fixture filter", text: $model.fixtureID)
                Text("Approved canonical title, keywords, rating, color, and PBE:Approved are global. Tombstones receive PBE:Tombstone. Fixture Pick/Hide state is never written to Photos. Preview is read-only; Commit is a separate Worker-authorized action through the signed connector.")
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Preview changes") {
                        Task { await model.planMetadataGiveBack() }
                    }
                    .disabled(model.isRunningMetadata)
                    Button("Commit & verify") {
                        showingCommitConfirmation = true
                    }
                    .disabled(model.isRunningMetadata)
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
