import OwnerCore
import AppKit
import SwiftUI

public struct BackstageApplication: App {
    @StateObject private var model: BackstageViewModel
    @NSApplicationDelegateAdaptor(BackstageApplicationDelegate.self)
    private var applicationDelegate
    @AppStorage(BackstagePanelPreferenceKey.sidebarVisible)
    private var navigationSidebarVisible = true

    public init() {
        let isReadOnlyAccessibilitySmoke = BackstageAccessibilitySmokeMode.isEnabled()
        // PBB-92: a current Backstage launch is the final authority over any
        // helper left by an older install or rollback. Retirement is
        // recoverable and intentionally does not touch historical archives.
        if !isReadOnlyAccessibilitySmoke {
            do {
                _ = try RetiredPhotosBridgeService().retireInstalledArtifacts()
            } catch {
                NSLog(
                    "PBB-92 could not retire a legacy Photos Bridge artifact: %@",
                    error.localizedDescription
                )
            }
        }
        _model = StateObject(
            wrappedValue: isReadOnlyAccessibilitySmoke
                ? BackstageAccessibilitySmokeMode.makeModel()
                : BackstageViewModel()
        )
    }

    public var body: some Scene {
        WindowGroup("PhotosByElie Backstage") {
            NavigationSplitView(columnVisibility: navigationColumnVisibility) {
                VStack(spacing: 0) {
                    FixturePicker(model: model)
                        .padding(.horizontal, 12)
                        .padding(.top, 12)
                        .padding(.bottom, 10)
                    Divider()
                    List(BackstageViewModel.Section.allCases, selection: $model.selection) { section in
                        Label(section.title, systemImage: icon(for: section))
                            .tag(section)
                            .accessibilityIdentifier("backstage.sidebar.\(section.rawValue)")
                    }
                    .accessibilityLabel("Sidebar")
                }
                .navigationTitle("Backstage")
                .frame(minWidth: 230, idealWidth: 260)
            } detail: {
                workspaceDetail
                    .accessibilityIdentifier(
                        "backstage.workspace.\((model.selection ?? .overview).rawValue)"
                    )
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
                                if let editLabel = model.activeExternalEditLabel {
                                    if model.isExternalEditOperationInProgress {
                                        ProgressView()
                                            .controlSize(.small)
                                            .help(model.externalEditStatus)
                                    }
                                    Menu {
                                        Button("Return finished file…") {
                                            model.chooseExternalEditReturn()
                                        }
                                        .backstageHelp("Choose the finished image that should become the current rendition for this edit job.")
                                        Button("Show return folder") {
                                            model.revealExternalEditReturnFolder()
                                        }
                                        .backstageHelp("Reveal the configured return folder for the active external edit in Finder.")
                                        Button("Choose return folder…") {
                                            model.chooseExternalEditReturnDirectory()
                                        }
                                        .backstageHelp("Choose the folder Backstage watches for finished external edits.")
                                        Divider()
                                        Button("Cancel edit job", role: .destructive) {
                                            model.requestCancelExternalEdit()
                                        }
                                        .backstageHelp("Cancel the active external edit without replacing its current Backstage rendition.")
                                    } label: {
                                        Label(editLabel, systemImage: "paintbrush.pointed")
                                            .lineLimit(1)
                                    }
                                    .disabled(model.isExternalEditOperationInProgress)
                                    .backstageHelp("Return, locate, reconfigure, or cancel the active external edit from any Backstage workspace.")
                                }
                                Text(backstageVersionLabel)
                                    .font(.caption.monospacedDigit().weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .help("Installed PhotosByElie Backstage version and build")
                                if model.authentication.phase == .authenticated {
                                    if model.selection == .culling || model.selection == .review {
                                        Button {
                                            withAnimation(.snappy(duration: 0.24)) {
                                                model.isPreviewPanelVisible.toggle()
                                            }
                                        } label: {
                                            Image(systemName: "sidebar.right")
                                        }
                                        .backstageHelp(
                                            model.isPreviewPanelVisible
                                                ? "Collapse the Gallery or Review preview inspector to give the main workspace more room."
                                                : "Expand the Gallery or Review preview inspector beside the main workspace."
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
            // Keep the navigation sidebar beside the workspace so changing its
            // visibility produces a real detail-width update for Gallery.
            .navigationSplitViewStyle(.balanced)
            .background(SplitViewAutosaver(name: "PhotosByElieBackstage.NavigationSplit"))
            .background(WindowFrameAutosaver(
                name: BackstageWindowFrameStore.mainWindowAutosaveName
            ))
            .frame(minWidth: 1_120, minHeight: 720)
            .onAppear { applicationDelegate.attach(model: model) }
            .task {
                guard !model.isReadOnlyAccessibilitySmoke else { return }
                model.startPreviewIPC()
            }
            .task {
                guard !model.isReadOnlyAccessibilitySmoke else { return }
                await model.bootstrapAuthentication()
            }
            .onChange(of: model.selectedFixtureID) { oldFixtureID, newFixtureID in
                guard oldFixtureID != newFixtureID, !newFixtureID.isEmpty else { return }
                Task { await model.refreshVisibleFixtureSurface() }
            }
        }
        .commands {
            BackstageSelectAllCommands(model: model)
            BackstageUndoCommands(model: model)
            CommandMenu("Backstage") {
                Button("Refresh Activity") {
                    Task { await model.refreshActions() }
                }
                .keyboardShortcut("r")
                .disabled(model.isRefreshing || model.isReadOnlyAccessibilitySmoke)
                .backstageHelp("Reload the latest audited Owner activity records and their progress states.")
            }
        }
    }

    private var navigationColumnVisibility: Binding<NavigationSplitViewVisibility> {
        Binding(
            get: { navigationSidebarVisible ? .all : .detailOnly },
            set: { navigationSidebarVisible = $0 != .detailOnly }
        )
    }

    private var backstageVersionLabel: String {
        let short = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "unknown"
        let build = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleVersion"
        ) as? String ?? "?"
        return "Backstage v\(short) · build \(build)"
    }

    @ViewBuilder
    private var workspaceDetail: some View {
        VStack(spacing: 0) {
            if model.isReadOnlyAccessibilitySmoke {
                HStack(spacing: 12) {
                    BackstageFeedbackView(
                        message: "Read-only installed-app accessibility smoke is active.",
                        isWorking: true
                    )
                    .accessibilityIdentifier("backstage.smoke.busy-state")
                    Text("Read-only workspace: \((model.selection ?? .overview).title)")
                        .font(.caption.monospaced())
                        .accessibilityIdentifier("backstage.smoke.current-workspace")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                Divider()
            }
            detail
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
            CullingView(model: model, isPreviewMode: model.isReadOnlyAccessibilitySmoke)
        case .review:
            ReviewView(model: model, isPreviewMode: model.isReadOnlyAccessibilitySmoke)
        case .metadata:
            MetadataGiveBackView(model: model)
        case .wasteBasket:
            LifecycleView(model: model, isPreviewMode: model.isReadOnlyAccessibilitySmoke)
        case .uploads:
            UploadView(model: model, isPreviewMode: model.isReadOnlyAccessibilitySmoke)
        case .delivery:
            DeliverablesView(model: model)
        case .publication:
            PublicationView(model: model)
        case .updates:
            BackstageUpdatesView(model: model)
        }
    }

    private func icon(for section: BackstageViewModel.Section) -> String {
        switch section {
        case .overview: "rectangle.grid.2x2"
        case .activity: "clock.arrow.circlepath"
        case .fixtures: "folder.badge.gearshape"
        case .access: "person.2"
        case .culling: "photo.stack"
        case .review: "checkmark.bubble"
        case .metadata: "tag"
        case .wasteBasket: "trash"
        case .uploads: "arrow.up.circle"
        case .delivery: "shippingbox"
        case .publication: "globe"
        case .updates: "arrow.triangle.2.circlepath"
        }
    }
}

/// Renders a visible, semantic section heading outside an unlabeled GroupBox.
///
/// Sky Computer Use crashes while observing the accessibility shape emitted by
/// a labeled GroupBox whose content also exposes accessible elements. Keeping
/// the heading adjacent to an unlabeled card preserves the same visual and
/// semantic hierarchy without creating that unstable native AX subtree.
struct BackstageSectionCard<Content: View>: View {
    private let title: String
    private let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            GroupBox {
                content
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BackstageSelectAllCommands: Commands {
    @ObservedObject var model: BackstageViewModel

    var body: some Commands {
        CommandGroup(replacing: .textEditing) {
            Button("Select All") {
                if model.isReadOnlyAccessibilitySmoke {
                    model.selectAllCurrentContent()
                } else {
                    let handledByFocusedControl = NSApp.sendAction(
                        #selector(NSResponder.selectAll(_:)),
                        to: nil,
                        from: nil
                    )
                    if !handledByFocusedControl {
                        model.selectAllCurrentContent()
                    }
                }
            }
            .keyboardShortcut("a", modifiers: .command)
            .backstageHelp(
                "Select all text in the focused field, all rows in the focused table, or every currently loaded item in the active Backstage workspace."
            )
        }
    }
}

private struct BackstageUndoCommands: Commands {
    @ObservedObject var model: BackstageViewModel
    @Environment(\.undoManager) private var undoManager

    var body: some Commands {
        CommandGroup(replacing: .undoRedo) {
            Button(model.currentUndoMenuTitle) {
                if model.canUndoCurrentSection {
                    Task { await model.undoCurrentSection() }
                } else {
                    undoManager?.undo()
                }
            }
            .keyboardShortcut("z", modifiers: .command)
            .disabled(!model.canUndoCurrentSection && undoManager?.canUndo != true)
            .backstageHelp("Undo the latest reversible change in the active Backstage section.")

            Button("Redo") {
                undoManager?.redo()
            }
            .keyboardShortcut("z", modifiers: [.command, .shift])
            .disabled(undoManager?.canRedo != true)
            .backstageHelp("Redo the latest standard text edit when the active field supports it.")
        }
    }
}

private struct OverviewView: View {
    @ObservedObject var model: BackstageViewModel
    @AppStorage(BackstagePanelPreferenceKey.enrollmentFallbackExpanded)
    private var enrollmentFallbackExpanded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Label("PhotosByElie Backstage", systemImage: "photo.on.rectangle.angled")
                    .font(.largeTitle.bold())
                Text("Max-first Owner workspace. Public and client sites remain independent.")
                    .foregroundStyle(.secondary)
                BackstageSectionCard("This Mac") {
                    VStack(alignment: .leading, spacing: 12) {
                    LabeledContent("Authentication", value: model.authentication.phase.rawValue)
                    if let deviceID = model.authentication.deviceId {
                        LabeledContent("Device", value: abbreviatedDeviceID(deviceID))
                            .textSelection(.enabled)
                    }
                    if let expiresAt = model.authentication.accessExpiresAt {
                        LabeledContent("Session expires", value: expiresAt.formatted())
                    }
                    BackstageFeedbackView(
                        message: model.authenticationStatus,
                        isWorking: model.isAuthenticating
                    )
                    if model.authentication.phase == .needsEnrollment
                        || model.authentication.phase == .signedOut {
                        HStack {
                            Button("Set up this Mac") {
                                model.setUpThisMac()
                            }
                            .disabled(model.isAuthenticating || model.isSettingUpThisMac)
                            .backstageHelp("Open the approved Owner identity check and return this Mac's short-lived enrollment result directly to Backstage. No credential is copied through the URL or clipboard.")
                            if model.isSettingUpThisMac {
                                Button(model.isCancellingMacSetup ? "Cancelling…" : "Cancel setup", role: .cancel) {
                                    model.cancelMacSetup()
                                }
                                .disabled(model.isCancellingMacSetup)
                                .backstageHelp("Cancel the active enrollment handoff. No device credential will be stored.")
                            }
                            Button("Check Keychain again") {
                                Task { await model.bootstrapAuthentication() }
                            }
                            .disabled(model.isAuthenticating || model.isSettingUpThisMac)
                            .backstageHelp("Recheck the saved Keychain credential and renew this Mac's Owner session if possible.")
                        }
                        Text("Backstage opens the Owner account picker, binds a five-minute single-use handoff to this Mac, and stores the resulting revocable credential only in Keychain. Photos permission remains separate.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        DisclosureGroup(
                            "Use one-time code fallback",
                            isExpanded: $enrollmentFallbackExpanded
                        ) {
                            VStack(alignment: .leading, spacing: 8) {
                                SecureField("One-time enrollment code", text: $model.enrollmentCode)
                                    .textFieldStyle(.roundedBorder)
                                Button("Enroll with code") {
                                    Task { await model.enroll() }
                                }
                                .disabled(model.isAuthenticating || model.enrollmentCode.isEmpty)
                                .backstageHelp("Use the restricted provisioning fallback and store the resulting device credential in Keychain.")
                                Text("Fallback only while native setup, revocation, and clean-state recovery are being accepted.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.top, 4)
                        }
                    } else if model.authentication.phase == .renewalFailed {
                        Button("Retry Owner session") {
                            Task { await model.bootstrapAuthentication() }
                        }
                        .disabled(model.isAuthenticating)
                        .backstageHelp("Retry renewal using this Mac's retained device credential. No new enrollment code is required.")
                        Text("This Mac's device enrollment is still stored in Keychain. Retry the session after checking the network or Owner service.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        HStack {
                            Button("Refresh session") {
                                Task { await model.bootstrapAuthentication() }
                            }
                            .disabled(model.isAuthenticating)
                            .backstageHelp("Renew the current Owner session using this Mac's saved device credential.")
                            Button("Sign out", role: .destructive) {
                                Task { await model.signOut() }
                            }
                            .disabled(model.isAuthenticating)
                            .backstageHelp("Revoke the current Owner session and remove its local tokens from this Mac's Keychain.")
                        }
                    }
                    }
                    .padding(6)
                }
                if model.authentication.phase == .authenticated {
                    BackstageSectionCard("Enrolled Macs") {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text(model.ownerDeviceManagementStatus)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Button("Refresh") {
                                    Task { await model.refreshOwnerDevices() }
                                }
                                .disabled(model.isRefreshingOwnerDevices)
                                .backstageHelp("Reload the enrolled Mac list through this Mac's verified Backstage device session.")
                            }
                            ForEach(model.enrolledOwnerDevices) { device in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(device.name)
                                        Text("\(device.platform) · enrolled \(device.createdAt.formatted())")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        if let revokedAt = device.revokedAt {
                                            Text("Revoked \(revokedAt.formatted())")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer()
                                    if device.revokedAt != nil {
                                        Label("Revoked", systemImage: "xmark.circle")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.secondary)
                                    } else if model.authentication.deviceId == device.id {
                                        Text("This Mac")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.secondary)
                                    }
                                    if device.revokedAt == nil {
                                        Button("Revoke", role: .destructive) {
                                            model.requestOwnerDeviceRevocation(device)
                                        }
                                        .disabled(model.isRefreshingOwnerDevices)
                                        .backstageHelp("Confirm revocation of \(device.name). That Mac will no longer be able to renew an Owner session.")
                                    }
                                }
                            }
                        }
                        .padding(6)
                    }
                    .confirmationDialog(
                        "Revoke \(model.pendingOwnerDeviceRevocation?.name ?? "this Mac")?",
                        isPresented: Binding(
                            get: { model.pendingOwnerDeviceRevocation != nil },
                            set: { if !$0 { model.cancelOwnerDeviceRevocation() } }
                        ),
                        titleVisibility: .visible
                    ) {
                        Button("Revoke Mac", role: .destructive) {
                            model.confirmOwnerDeviceRevocation()
                        }
                        .backstageHelp("Revoke the selected Mac's Owner credential after this explicit confirmation.")
                        Button("Cancel", role: .cancel) {
                            model.cancelOwnerDeviceRevocation()
                        }
                        .backstageHelp("Close this confirmation without changing any enrolled Mac or credential.")
                    } message: {
                        Text("The selected Mac will lose Owner access. If it is this Mac, its local Keychain credential will also be removed; Set up this Mac can recover it independently.")
                    }
                }
                BackstageSectionCard("Native Photos access") {
                    VStack(alignment: .leading, spacing: 10) {
                    LabeledContent("PhotoKit authority", value: "PhotosByElie Backstage")
                    LabeledContent("Photos access", value: photoAccessLabel(model.photoAccess))
                    Text(photoAccessMessage(model.photoAccess))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    Button(model.photoAccess == .notDetermined ? "Allow Photos" : "Refresh Photos access") {
                        Task { await model.authorizePhotosAccess() }
                    }
                    .disabled(model.isPhotoLibraryOperationInProgress)
                    .backstageHelp("Authorize or recheck PhotosByElie Backstage's native PhotoKit access without launching another app or helper.")
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

    private func photoAccessLabel(_ access: PhotoLibraryAccess) -> String {
        switch access {
        case .notDetermined: return "Not determined"
        case .denied: return "Denied"
        case .limited: return "Limited"
        case .authorized: return "Authorized"
        }
    }

    private func photoAccessMessage(_ access: PhotoLibraryAccess) -> String {
        switch access {
        case .authorized, .limited:
            return "Backstage is authorized to use PhotoKit for its native Photos workflows."
        case .notDetermined:
            return "Choose Allow Photos to authorize Backstage's native PhotoKit access."
        case .denied:
            return "Grant PhotosByElie Backstage Photos access in System Settings, then check again."
        }
    }
}

private struct BackstageUpdatesView: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Label("Backstage updates", systemImage: "arrow.triangle.2.circlepath")
                    .font(.largeTitle.bold())
                Text("Backstage immediately downloads a newer compatible release, then verifies its checksum and signature. Installation and rollback remain separate manual actions.")
                    .foregroundStyle(.secondary)

                BackstageSectionCard("Installed build") {
                    VStack(alignment: .leading, spacing: 8) {
                        LabeledContent("Bundle identifier", value: model.installedRelease.bundleIdentifier.isEmpty ? "Unavailable" : model.installedRelease.bundleIdentifier)
                        LabeledContent("Version", value: model.installedRelease.version.isEmpty ? "Unavailable" : model.installedRelease.version)
                        LabeledContent("Build", value: model.installedRelease.build.isEmpty ? "Unavailable" : model.installedRelease.build)
                    }
                    .padding(6)
                }

                BackstageSectionCard("Release status") {
                    VStack(alignment: .leading, spacing: 12) {
                        stateContent
                    }
                    .padding(6)
                }
            }
            .padding(24)
        }
        .task(id: model.isAIPassActive) {
            guard model.shouldAutomaticallyCheckForUpdates else { return }
            await model.checkForUpdates()
        }
    }

    @ViewBuilder
    private var stateContent: some View {
        if model.isAIPassActive {
            Label(
                "Update actions are unavailable while the AI proposal pass is active.",
                systemImage: "sparkles"
            )
            .foregroundStyle(.orange)
        }
        if model.isCloudWorkflowActive {
            Label(
                "Update actions are unavailable while upload, catalog deployment, client delivery, or storage maintenance is active.",
                systemImage: "shippingbox.and.arrow.backward"
            )
            .foregroundStyle(.orange)
        }
        switch model.updateState {
        case .idle:
            Label("Preparing update check", systemImage: "arrow.triangle.2.circlepath")
            Text("The authoritative release check starts automatically when this panel opens.")
                .foregroundStyle(.secondary)
        case .checking:
            ProgressView("Checking authoritative release metadata…")
        case let .current(manifest):
            statusLabel("Current", systemImage: "checkmark.circle.fill", color: .green)
            releaseSummary(manifest)
        case let .updateAvailable(manifest):
            statusLabel("Starting automatic download", systemImage: "arrow.down.circle.fill", color: .orange)
            releaseSummary(manifest)
            ProgressView()
            Text("The compatible archive downloads automatically. Verification leaves the running app untouched; installation remains separate.")
                .foregroundStyle(.secondary)
        case let .downloading(manifest, receivedBytes, totalBytes):
            statusLabel("Downloading", systemImage: "arrow.down.circle", color: .orange)
            releaseSummary(manifest)
            if totalBytes > 0 {
                ProgressView(value: Double(receivedBytes), total: Double(totalBytes))
                Text("\(receivedBytes.formatted()) / \(totalBytes.formatted()) bytes")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            } else {
                ProgressView()
                Text("The release server did not provide a total size; the manifest size will still be checked before verification.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case let .verified(update):
            statusLabel("Verified and ready to install", systemImage: "checkmark.shield.fill", color: .green)
            releaseSummary(update.manifest)
            Text("The archive passed exact-size, SHA-256, bundle-identity, and macOS code-signature checks. One action installs it, starts the new version, and closes this older copy after launch succeeds.")
                .foregroundStyle(.secondary)
            Button("Install and run new version") {
                Task { await model.installAndRunVerifiedUpdate() }
            }
            .disabled(!model.canPerformBackstageUpdateActions)
            .buttonStyle(.borderedProminent)
            .backstageHelp("Install the verified release, repeat release and signing checks, preserve rollback, atomically replace the canonical app, start the new version, and close this older copy after launch succeeds.")
        case let .installing(manifest):
            statusLabel("Installing and opening new version", systemImage: "arrow.triangle.2.circlepath", color: .orange)
            releaseSummary(manifest)
            ProgressView()
            Text("Staging and reverifying the complete app before the canonical bundle is exchanged and launched.")
                .foregroundStyle(.secondary)
        case let .installed(receipt):
            statusLabel("Installed; opening new version", systemImage: "checkmark.seal.fill", color: .green)
            releaseSummary(receipt.manifest)
            ProgressView()
            Text("The verified release is installed at /Applications/PhotosByElie Backstage.app. Waiting for the new process before closing this copy.")
                .foregroundStyle(.secondary)
            if receipt.rollbackBundleURL != nil {
                Text("The previous signed app is retained privately for rollback.")
                    .foregroundStyle(.secondary)
            }
        case let .failed(message, recovery):
            statusLabel("Failed safely", systemImage: "exclamationmark.triangle.fill", color: .red)
            Text(message)
            Text(recovery)
                .foregroundStyle(.secondary)
        }
    }

    private func statusLabel(_ title: String, systemImage: String, color: Color) -> some View {
        Label(title, systemImage: systemImage)
            .foregroundStyle(color)
            .font(.headline)
    }

    private func releaseSummary(_ manifest: BackstageReleaseManifest) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent("Available version", value: "\(manifest.version) (\(manifest.build))")
            LabeledContent("Minimum macOS", value: manifest.minimumOSVersion)
            if let architectures = manifest.architectures {
                let architectureSet = Set(architectures)
                LabeledContent(
                    "Architectures",
                    value: architectures == ["arm64"]
                        ? "Apple silicon (arm64)"
                        : architectureSet == Set(["arm64", "x86_64"])
                        ? "Universal (Apple silicon + Intel)"
                        : architectures.joined(separator: ", ")
                )
            }
            LabeledContent("Archive size", value: "\(manifest.fileSize.formatted()) bytes")
            Text(manifest.releaseNotes)
                .font(.callout)
                .textSelection(.enabled)
        }
    }
}

private struct DeliverablesView: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Client delivery").font(.largeTitle.bold())
                    Text(model.selectedFixtureBreadcrumb.isEmpty
                        ? "Fixture unavailable"
                        : model.selectedFixtureBreadcrumb)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Load") { Task { await model.loadDeliverables() } }
                    .disabled(model.isRunningDelivery || model.selectedFixtureID.isEmpty)
                    .backstageHelp("Load the selected fixture's existing PDF, video, originals, and share-link delivery records.")
            }
            Text("Record completed PDF, video, or originals packages and their authenticated share links. This workspace does not upload website photos or message a client.")
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
                        !model.canStartCloudWorkflow
                            || model.selectedFixtureID.isEmpty
                            || !model.deliverableShareLink
                                .trimmingCharacters(in: .whitespacesAndNewlines)
                                .hasPrefix("https://")
                    )
                    .backstageHelp("Record the authenticated HTTPS link as the ready delivery for the chosen product and fixture without messaging a client.")
            }
            BackstageFeedbackView(
                message: model.deliveryStatus,
                isWorking: model.isRunningDelivery
            )
            Table(model.deliverables) {
                TableColumn("Kind", value: \.kind)
                TableColumn("State", value: \.state)
                TableColumn("Provider", value: \.provider)
                TableColumn("Share link", value: \.externalIdentity)
            }
            .overlay {
                if model.deliverables.isEmpty {
                    ContentUnavailableView(
                        model.selectedFixtureID.isEmpty ? "Choose a fixture" : "No client deliveries yet",
                        systemImage: "shippingbox",
                        description: Text(
                            model.selectedFixtureID.isEmpty
                                ? "Select a fixture, then load its existing delivery records."
                                : "This stays empty until a completed PDF, video, or originals package is recorded for the fixture."
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
                Text("Storage maintenance").font(.largeTitle.bold())
                Spacer()
                Button("Preview reconciliation") {
                    Task { await model.previewR2Reconciliation() }
                }
                .disabled(!model.canStartCloudWorkflow)
                .backstageHelp("Scan R2 references and sales protection, then preview quarantine, restore, and deletion eligibility without changing objects.")
                Button("Apply guarded reconciliation…") { confirming = true }
                    .disabled(!model.canStartCloudWorkflow || model.r2Reconciliation == nil)
                    .backstageHelp("Review the confirmation for applying exactly the currently previewed guarded R2 reconciliation.")
                if model.isRunningR2Reconciliation {
                    Button(model.isCancellingR2Reconciliation ? "Stopping…" : "Stop safely") {
                        Task { await model.cancelR2Reconciliation() }
                    }
                    .disabled(model.isCancellingR2Reconciliation)
                    .backstageHelp("Stop after the current R2 object checkpoint. Completed quarantine, restore, protection, or deletion receipts remain auditable.")
                }
            }
            Text("This is R2 storage cleanup, not website publication. Sold masters and derivatives stay protected; other unreferenced objects enter a 30-day quarantine and can be deleted only after a second reconciliation still finds them unreferenced.")
                .foregroundStyle(.secondary)
            BackstageFeedbackView(
                message: model.r2ReconciliationStatus,
                isWorking: model.isRunningR2Reconciliation
            )
            if model.isRunningR2Reconciliation {
                ProgressView(model.r2Reconciliation?.stage ?? "Checking R2 references and sale protection…")
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
            await model.recoverR2ReconciliationRuns()
        }
        .confirmationDialog("Apply the guarded R2 reconciliation?", isPresented: $confirming) {
            Button("Apply reconciliation", role: .destructive) {
                Task { await model.commitR2Reconciliation() }
            }
            .backstageHelp("Confirm the previewed R2 reconciliation while preserving sold and referenced objects and enforcing quarantine rules.")
            Button("Cancel", role: .cancel) {}
                .backstageHelp("Close this confirmation without changing any R2 object state.")
        } message: {
            Text("Referenced or sold objects cannot be removed here. Unreferenced objects first enter quarantine; only a later second pass after 30 days may delete them.")
        }
    }
}

struct LifecycleView: View {
    @ObservedObject var model: BackstageViewModel
    var isPreviewMode = false
    @StateObject private var quickLook = BackstageQuickLookCoordinator()
    @StateObject private var lifecycleScrollPosition = LifecycleTableScrollPosition()
    @State private var confirmingEmpty = false
    @State private var confirmingDeleteSelected = false
    @State private var lifecycleSortOrder = [
        KeyPathComparator(\LifecycleItem.updatedAt, order: .reverse),
    ]
    @State private var lifecycleSortRevision = 0

    private var sortedLifecycleItems: [LifecycleItem] {
        model.lifecycleItems.sorted(using: lifecycleSortOrder)
    }

    private var lifecycleSortBinding: Binding<[KeyPathComparator<LifecycleItem>]> {
        Binding(
            get: { lifecycleSortOrder },
            set: { nextSortOrder in
                lifecycleScrollPosition.captureBeforeSort()
                lifecycleSortOrder = nextSortOrder
                lifecycleSortRevision += 1
            }
        )
    }

    private var pendingLifecycleOperationLabel: String {
        guard let action = model.lifecyclePendingAction else {
            return "Waste Basket action"
        }
        let selectedCount = action.payload?["photoIds"]?.arrayValue?.count ?? 0
        return selectedCount == 0
            ? "Empty Waste Basket"
            : "Delete Selected (\(selectedCount.formatted()))"
    }

    @ViewBuilder
    private var pendingLifecycleActionPanel: some View {
        if model.lifecycleQueueing || model.lifecyclePendingActionID != nil {
            HStack(alignment: .top, spacing: 10) {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(
                        model.lifecycleQueueing
                            ? "Submitting Waste Basket action…"
                            : "\(pendingLifecycleOperationLabel) is in progress"
                    )
                    .font(.headline)
                    if let action = model.lifecyclePendingAction {
                        Text(
                            "Worker state: \(action.state.rawValue.capitalized) • Phase: \(action.diagnosticPhaseName)"
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        Text("Action \(action.id)")
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    Text("Browsing, Refresh, and Quick Look remain available. Only duplicate destructive submissions are disabled.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("View Activity") {
                    model.selection = .activity
                    Task { await model.refreshActions() }
                }
                .backstageHelp("Open Activity to inspect the complete durable action state, progress, and receipt.")
            }
            .padding(10)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(
                model.lifecycleQueueing
                    ? "Submitting Waste Basket action"
                    : "\(pendingLifecycleOperationLabel) is in progress"
            )
            .accessibilityValue("Only duplicate destructive submissions are disabled. Browsing, Refresh, and Quick Look remain available.")
        }
    }

    private func openQuickLook(for item: LifecycleItem) {
        guard model.selectedLifecycleIDs.count <= 1 else {
            model.lifecycleStatus = "Quick Look opens one selected Waste Basket item at a time."
            return
        }
        model.selectedLifecycleIDs = [item.id]
        presentQuickLook(for: item)
    }

    private func presentQuickLook(
        for item: LifecycleItem,
        direction: OwnerSelectionDirection = .next
    ) {
        model.lifecycleStatus = "Preparing the selected Waste Basket photo for Quick Look…"
        let presentationID = quickLook.beginPresentation()
        Task { @MainActor in
            guard let url = await model.prepareLifecycleQuickLookURL(for: item) else {
                return
            }
            guard quickLook.isCurrentPresentation(presentationID) else { return }
            quickLook.present(
                urls: [url],
                metadata: [lifecycleQuickLookMetadata(for: item)],
                presentation: presentationID,
                onShortcut: { shortcut, assetID in
                    if BackstageQuickLookDecisionRouter.handle(
                        shortcut,
                        assetID: assetID,
                        model: model,
                        coordinator: quickLook
                    ) {
                        return true
                    }
                    switch shortcut {
                    case .previous, .previousRow:
                        moveQuickLook(
                            from: assetID,
                            direction: .previous
                        )
                    case .next, .nextRow:
                        moveQuickLook(
                            from: assetID,
                            direction: .next
                        )
                    case .pick:
                        restoreQuickLookItem(
                            assetID: assetID,
                            direction: direction
                        )
                    case .wasteBasket:
                        guard !model.isRunningLifecycle,
                              !model.lifecycleQueueing,
                              model.lifecyclePendingActionID == nil
                        else { return false }
                        model.selectedLifecycleIDs = [assetID]
                        confirmingDeleteSelected = true
                    case .hide, .approve, .returnToReview, .unpick, .undo, .rating, .color:
                        return false
                    }
                    return true
                },
                externalEditUnavailableReason: "Restore this photo before editing it.",
                externalEditActions: model.quickLookExternalEditActions
            )
            model.lifecycleStatus = "Quick Look opened for the selected Waste Basket photo."
        }
    }

    private func lifecycleQuickLookMetadata(
        for item: LifecycleItem
    ) -> BackstageQuickLookMetadata {
        let equipment = model.quickLookEquipment(for: item.mediaID)
        return BackstageQuickLookMetadata(
            assetID: item.mediaID,
            filename: item.filename.isEmpty ? item.mediaID : item.filename,
            title: item.title.isEmpty ? "Untitled" : item.title,
            keywords: [],
            locationLabel: item.sourceSlug,
            capturedAt: item.capturedAt,
            cameraBody: equipment.cameraBody,
            lens: equipment.lens,
            focalLength: equipment.focalLength,
            rating: 0,
            color: "",
            state: item.state == "hidden"
                ? "Recoverable"
                : "Active global tombstone",
            shortcutHint: "Shortcuts: ←/→/↑/↓ navigate • ⌘A select all shown • P put back • X delete selected recoverable • \(BackstageQuickLookDecisionRouter.shortcutHint) • Escape closes"
        )
    }

    private func moveQuickLook(
        from assetID: String,
        direction: OwnerSelectionDirection
    ) {
        let items = sortedLifecycleItems
        guard let index = items.firstIndex(where: { $0.id == assetID }) else {
            return
        }
        let nextIndex = index + (direction == .previous ? -1 : 1)
        guard items.indices.contains(nextIndex) else { return }
        let next = items[nextIndex]
        model.selectedLifecycleIDs = [next.id]
        presentQuickLook(for: next, direction: direction)
    }

    private func restoreQuickLookItem(
        assetID: String,
        direction: OwnerSelectionDirection
    ) {
        guard model.lifecycleItems.contains(where: {
            $0.id == assetID && $0.state == "hidden"
        }) else {
            model.lifecycleStatus = "Put back is available only for a recoverable Waste Basket item."
            return
        }
        guard !model.isRunningLifecycle,
              !model.lifecycleQueueing,
              !model.lifecycleRestoreQueueing,
              model.lifecyclePendingActionID == nil
        else { return }
        let before = sortedLifecycleItems
        model.selectedLifecycleIDs = [assetID]
        Task { @MainActor in
            await model.restoreLifecycleSelection()
            guard quickLook.isVisible else { return }
            let remaining = sortedLifecycleItems
            guard !remaining.contains(where: { $0.id == assetID && $0.state == "hidden" }) else {
                if let item = remaining.first(where: { $0.id == assetID }) {
                    quickLook.updateMetadata(lifecycleQuickLookMetadata(for: item))
                }
                return
            }
            guard let next = lifecycleReplacement(
                from: before,
                removing: assetID,
                remaining: remaining,
                direction: direction
            ) else {
                quickLook.dismiss()
                return
            }
            model.selectedLifecycleIDs = [next.id]
            presentQuickLook(for: next, direction: direction)
        }
    }

    private func lifecycleReplacement(
        from items: [LifecycleItem],
        removing assetID: String,
        remaining: [LifecycleItem],
        direction: OwnerSelectionDirection
    ) -> LifecycleItem? {
        guard let removedIndex = items.firstIndex(where: { $0.id == assetID }) else {
            return remaining.first
        }
        let preferredIDs: [String]
        switch direction {
        case .next:
            preferredIDs = Array(items.dropFirst(removedIndex + 1).map(\.id))
                + Array(items[..<removedIndex].reversed().map(\.id))
        case .previous:
            preferredIDs = Array(items[..<removedIndex].reversed().map(\.id))
                + Array(items.dropFirst(removedIndex + 1).map(\.id))
        }
        return preferredIDs.lazy.compactMap { preferredID in
            remaining.first(where: { $0.id == preferredID })
        }.first ?? remaining.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Waste Basket").font(.largeTitle.bold())
                    Text("X is recoverable. Click Quick Look or select a row and press Space to inspect it; only a confirmed Empty Waste Basket action activates global tombstones.")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Refresh") { Task { await model.loadLifecycle() } }
                    .disabled(model.isRunningLifecycle || isPreviewMode)
                    .backstageHelp("Reload the private lifecycle ledger and current Waste Basket contents.")
                Button("Put back") { Task { await model.restoreLifecycleSelection() } }
                    .disabled(
                        model.isRunningLifecycle
                            || model.lifecycleQueueing
                            || model.lifecycleRestoreQueueing
                            || model.selectedRecoverableLifecycleIDs.isEmpty
                            || isPreviewMode
                    )
                    .backstageHelp("Restore the selected recoverable items from the Waste Basket to their previous visible state.")
                Button("Delete Selected", role: .destructive) { confirmingDeleteSelected = true }
                    .disabled(
                        model.isRunningLifecycle
                            || model.lifecycleQueueing
                            || model.lifecycleRestoreQueueing
                            || model.lifecycleRestorePendingActionID != nil
                            || model.lifecyclePendingActionID != nil
                            || model.selectedRecoverableLifecycleIDs.isEmpty
                            || isPreviewMode
                    )
                    .backstageHelp("Review the explicit confirmation for changing only the selected recoverable items into global tombstones; active tombstones and unselected items are untouched.")
                Button("Empty Waste Basket", role: .destructive) { confirmingEmpty = true }
                    .disabled(
                        model.isRunningLifecycle
                            || model.lifecycleQueueing
                            || model.lifecycleRestoreQueueing
                            || model.lifecycleRestorePendingActionID != nil
                            || model.lifecyclePendingActionID != nil
                            || model.lifecycleItems.allSatisfy { $0.state != "hidden" }
                            || isPreviewMode
                    )
                    .backstageHelp("Explicitly confirm the one normal action that activates global tombstones. Source media and R2 objects remain retained.")
            }
            Text(model.lifecycleCountSummary)
                .font(.headline)
                .monospacedDigit()
                .accessibilityLabel("Waste Basket counts")
            pendingLifecycleActionPanel
            BackstageFeedbackView(
                message: model.lifecycleStatus,
                isWorking: model.isRunningLifecycle
                    || model.lifecycleQueueing
                    || model.lifecycleRestoreQueueing
                    || model.lifecycleRestorePendingActionID != nil
                    || model.lifecyclePendingActionID != nil
            )
            Table(
                sortedLifecycleItems,
                selection: $model.selectedLifecycleIDs,
                sortOrder: lifecycleSortBinding
            ) {
                TableColumn("Preview") { item in
                    Group {
                        if let thumbnail = model.lifecycleThumbnails[item.mediaID] {
                            Image(nsImage: thumbnail)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        } else if let failure = model.lifecycleThumbnailFailures[item.mediaID] {
                            VStack(spacing: 3) {
                                Image(systemName: failure.systemImage)
                                Text(failure.title)
                                    .font(.caption2.weight(.semibold))
                                    .lineLimit(1)
                                Button(failure.actionTitle) {
                                    if failure.offersPhotosAccess {
                                        Task {
                                            await model.authorizeAndLoadPhotos()
                                            model.retryLifecycleThumbnail(
                                                for: item.mediaID,
                                                preferredIdentifier: item.photoLibraryIdentifier
                                            )
                                        }
                                    } else {
                                        model.retryLifecycleThumbnail(
                                            for: item.mediaID,
                                            preferredIdentifier: item.photoLibraryIdentifier
                                        )
                                    }
                                }
                                .controlSize(.small)
                                .backstageHelp(
                                    failure.offersPhotosAccess
                                        ? "Request Photos permission for Backstage, then retry this Waste Basket thumbnail."
                                        : "Retry this individual Waste Basket thumbnail without changing its lifecycle state."
                                )
                            }
                            .foregroundStyle(.secondary)
                        } else {
                            VStack(spacing: 3) {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Loading preview…")
                                    .font(.caption2)
                            }
                            .foregroundStyle(.secondary)
                        }
                    }
                    .frame(width: 64, height: 48)
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                    .accessibilityLabel(item.filename.isEmpty ? "Preview" : "Preview of \(item.filename)")
                    .task(id: item.mediaID) {
                        guard !isPreviewMode else { return }
                        model.requestLifecycleThumbnail(
                            for: item.mediaID,
                            preferredIdentifier: item.photoLibraryIdentifier
                        )
                    }
                }
                .width(76)
                TableColumn("Filename", value: \.filename) { item in
                    Text(item.filename.isEmpty ? item.mediaID : item.filename)
                        .lineLimit(1)
                        .help(item.filename.isEmpty ? item.mediaID : item.filename)
                }
                TableColumn("Title", value: \.title) { item in
                    Text(item.title.isEmpty ? "Untitled" : item.title)
                        .lineLimit(1)
                        .help(item.title.isEmpty ? "Untitled" : item.title)
                }
                TableColumn("State", value: \.state) { item in
                    Text(item.state == "hidden" ? "Recoverable" : "Active global tombstone")
                        .foregroundStyle(item.state == "hidden" ? .primary : .secondary)
                }
                TableColumn("Captured", value: \.capturedAt)
                TableColumn("Deleted", value: \.updatedAt) { item in
                    if let deletedAt = try? Date(item.updatedAt, strategy: .iso8601) {
                        Text(deletedAt, style: .relative)
                            .help(deletedAt.formatted(date: .abbreviated, time: .standard))
                    } else {
                        Text(item.updatedAt.isEmpty ? "Unknown" : item.updatedAt)
                    }
                }
                TableColumn("Actions") { item in
                    Button("Quick Look") {
                        openQuickLook(for: item)
                    }
                    .disabled(model.isRunningLifecycle || isPreviewMode)
                    .backstageHelp("Open this Waste Basket item in private read-only Quick Look without changing lifecycle state.")
                }
                .width(100)
            }
            .background(
                LifecycleTableScrollProbe(
                    position: lifecycleScrollPosition,
                    sortRevision: lifecycleSortRevision
                )
            )
            .overlay {
                if model.isRunningLifecycle && model.lifecycleItems.isEmpty {
                    ProgressView("Loading private lifecycle ledger…")
                } else if model.lifecycleItems.isEmpty {
                    ContentUnavailableView(
                        "Waste Basket is empty",
                        systemImage: "trash",
                        description: Text("Recoverable and active global-tombstone items will appear here.")
                    )
                }
            }
            .onKeyPress(.space) {
                guard !isPreviewMode else { return .handled }
                guard model.selectedLifecycleIDs.count == 1 else {
                    model.lifecycleStatus = model.selectedLifecycleIDs.isEmpty
                        ? "Select one Waste Basket item before opening Quick Look."
                        : "Quick Look opens one selected Waste Basket item at a time."
                    return .handled
                }
                guard let item = sortedLifecycleItems.first(where: {
                    model.selectedLifecycleIDs.contains($0.id)
                }) else {
                    return .ignored
                }
                openQuickLook(for: item)
                return .handled
            }
        }
        .padding()
        .task {
            guard !isPreviewMode else { return }
            await model.loadLifecycle()
        }
        .confirmationDialog(
            "Empty Waste Basket?",
            isPresented: $confirmingEmpty
        ) {
            Button("Empty Waste Basket", role: .destructive) {
                confirmingEmpty = false
                Task { await model.emptyWasteBasket() }
            }
            .backstageHelp("Confirm the only normal transition that activates global tombstones. Source media, R2 objects, and history remain retained.")
            Button("Cancel", role: .cancel) { confirmingEmpty = false }
                .backstageHelp("Close this confirmation and keep every recoverable item in the Waste Basket.")
        } message: {
            Text("This changes all \(model.lifecycleItems.filter { $0.state == "hidden" }.count.formatted()) current recoverable Waste Basket entries into active global tombstones, regardless of table selection. Explicit tombstone restore remains a separate audited path.")
        }
        .confirmationDialog(
            "Delete selected recoverable items?",
            isPresented: $confirmingDeleteSelected
        ) {
            Button("Delete Selected", role: .destructive) {
                confirmingDeleteSelected = false
                Task { await model.emptyWasteBasketSelection() }
            }
            .backstageHelp("Confirm changing only the selected recoverable items into active global tombstones. Source media, R2 objects, and history remain retained.")
            Button("Cancel", role: .cancel) { confirmingDeleteSelected = false }
                .backstageHelp("Close this confirmation without changing any selected lifecycle item.")
        } message: {
            Text("Only selected recoverable items are affected. Active tombstones and unselected items remain unchanged; the normal lifecycle safeguards and audit receipt still apply.")
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
                    .backstageHelp("Reload the latest audited Owner actions, progress, completion states, and failures.")
            }
            .padding()
            BackstageFeedbackView(message: model.ownerWorkflowRecoveryStatus)
                .padding(.horizontal)
                .padding(.bottom, 8)
            BackstageFeedbackView(
                message: model.isRefreshing ? "Loading audited cloud activity…" : model.activityStatus,
                isWorking: model.isRefreshing
            )
            .padding(.horizontal)
            .padding(.bottom, 8)
            Table(model.actions) {
                TableColumn("Kind", value: \.actionKind)
                TableColumn("Target", value: \.target)
                TableColumn("State") { Text($0.state.rawValue.capitalized) }
                TableColumn("Phase") { action in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(action.diagnosticPhaseName)
                        if let elapsed = action.diagnosticPhaseElapsedMs {
                            Text(
                                elapsed.formatted(.number.precision(.fractionLength(0...1)))
                                    + " ms"
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                        }
                    }
                }
                .width(min: 140, ideal: 220)
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

@MainActor
private struct FixtureWorkflowView: View {
    @ObservedObject var model: BackstageViewModel
    @AppStorage(BackstagePanelPreferenceKey.fixturePlacementsExpanded)
    private var fixturePlacementsExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Fixtures").font(.largeTitle.bold())
                Spacer()
                Button("Reload tree") { Task { await model.loadFixtures() } }
                    .disabled(model.isLoadingFixtureTree)
                    .backstageHelp("Reload the complete fixture hierarchy and its current archived states from Owner.")
            }
            BackstageFeedbackView(
                message: model.isLoadingFixtureTree ? "Loading fixture tree…" : model.fixtureStatus,
                isWorking: model.isLoadingFixtureTree
                    || model.isRunningFixture
                    || model.isSearchingFixtureAssets
                    || model.isRunningFixtureSnapshotOperation
                    || model.isLoadingFixturePolicy
            )
            HSplitView {
                VStack(alignment: .leading, spacing: 10) {
                    List(selection: Binding<String?>(
                        get: {
                            model.selectedFixtureID.isEmpty ? nil : model.selectedFixtureID
                        },
                        set: { fixtureID in
                            guard let fixtureID else { return }
                            _ = model.selectFixture(fixtureID)
                        }
                    )) {
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
                        Button("Create child") {
                            Task { await model.createFixture() }
                        }
                        .disabled(
                            model.fixtureName.isEmpty
                                || model.selectedFixtureID.isEmpty
                                || model.isRunningFixture
                        )
                        .backstageHelp("Create a child fixture beneath the current fixture using the entered name and optional template.")
                        Button("Create root") {
                            Task { await model.createFixture(atRoot: true) }
                        }
                        .disabled(model.fixtureName.isEmpty || model.isRunningFixture)
                        .backstageHelp("Create a new top-level fixture using the entered name and optional template.")
                        Button("Rename") { Task { await model.renameFixture() } }
                            .disabled(
                                model.selectedFixtureID.isEmpty
                                    || model.fixtureName.isEmpty
                                    || model.isRunningFixture
                            )
                            .backstageHelp("Rename the selected fixture to the value entered in the name field.")
                        Button("Archive / reopen") { Task { await model.toggleFixtureArchive() } }
                            .disabled(model.selectedFixtureID.isEmpty || model.isRunningFixture)
                            .backstageHelp("Toggle the selected fixture between archived and active without deleting its history.")
                    }
                }
                .padding()

                VStack(alignment: .leading, spacing: 10) {
                    Text("Find and snapshot assets").font(.title2.bold())
                    HStack {
                        TextField("Title, keyword, file, camera…", text: $model.fixtureSearch)
                        Button("Search") { Task { await model.searchFixtureAssets() } }
                            .disabled(model.selectedFixtureID.isEmpty || model.isRunningFixture)
                            .backstageHelp("Search Owner for assets matching the entered title, keyword, filename, camera, or other indexed detail.")
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
                        .disabled(
                            model.selectedFixtureAssetIDs.isEmpty
                                || model.selectedFixtureID.isEmpty
                                || model.isRunningFixture
                        )
                        .backstageHelp("Create an immutable, ordered Culling snapshot from the currently selected candidate assets.")
                    }
                    ScrollView(.vertical) {
                        VStack(alignment: .leading, spacing: 10) {
                            if !model.selectedFixtureID.isEmpty {
                                BackstageSectionCard("Population contract") {
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
                                BackstageSectionCard("Configured on this fixture") {
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
                                            .backstageHelp("Save this fixture's population source and configured policy overrides, preserving inherited values where selected.")
                                            if model.isLoadingFixturePolicy {
                                                ProgressView().controlSize(.small)
                                            }
                                            BackstageFeedbackView(
                                                message: model.fixturePolicyStatus,
                                                isWorking: model.isLoadingFixturePolicy
                                            )
                                        }
                                    }
                                }
                                BackstageSectionCard("Effective policy • revision \(model.fixturePolicyRevision)") {
                                    Text(model.fixtureEffectivePolicySummary)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            DisclosureGroup(
                                "Reversible fixture placements",
                                isExpanded: $fixturePlacementsExpanded
                            ) {
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
                                                || model.isRunningFixture
                                        )
                                        .backstageHelp("Add the selected assets to every selected target fixture using reversible placement records.")
                                        Button("Review placements") {
                                            Task { await model.loadFixturePlacements() }
                                        }
                                        .disabled(model.selectedFixtureAssetIDs.isEmpty || model.isRunningFixture)
                                        .backstageHelp("Load the active and removed fixture relationships for the selected assets.")
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
                                                .disabled(model.isRunningFixture)
                                                .backstageHelp("Move this asset's placement from \(placement.breadcrumbLabel) to \(fixture.name).")
                                            }
                                        }
                                    }
                                    TableColumn("Relationship") { placement in
                                        Button(placement.isActive ? "Remove" : "Restore") {
                                            Task { await model.togglePlacement(placement) }
                                        }
                                        .disabled(model.isRunningFixture)
                                        .backstageHelp(placement.isActive
                                            ? "Remove this reversible fixture placement without deleting the asset or its other relationships."
                                            : "Restore this previously removed fixture placement.")
                                    }
                                }
                                .frame(minHeight: 140)
                            }
                            if !model.selectedFixtureID.isEmpty {
                                BackstageSectionCard("Saved culling snapshots") {
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
                                            .backstageHelp("Reload the selected fixture's saved immutable Culling snapshots.")
                                            Button(model.isOpeningFixturePool ? "Opening…" : "Open selected in Gallery") {
                                                Task { await model.openSelectedFixturePool() }
                                            }
                                            .disabled(
                                                model.selectedFixturePoolID.isEmpty
                                                    || model.isRunningFixtureSnapshotOperation
                                            )
                                            .backstageHelp("Open the selected saved snapshot as the active immutable Culling pool.")
                                            if model.isRunningFixtureSnapshotOperation {
                                                ProgressView()
                                                    .controlSize(.small)
                                            }
                                        }
                                        if !model.fixtureSnapshotStatus.isEmpty {
                                            BackstageFeedbackView(
                                                message: model.fixtureSnapshotStatus,
                                                isWorking: model.isRunningFixtureSnapshotOperation
                                            )
                                        }
                                    }
                                }
                            }
                            if let pool = model.selectedFixturePoolSummary {
                                BackstageSectionCard("Selected snapshot") {
                                    LabeledContent("Pool", value: pool.name)
                                    LabeledContent("Assets", value: pool.assetCount.formatted())
                                    LabeledContent("Pool ID", value: pool.id)
                                    if !pool.snapshotHash.isEmpty {
                                        LabeledContent("Snapshot", value: String(pool.snapshotHash.prefix(12)))
                                    }
                                    HStack {
                                        Button(model.isOpeningFixturePool ? "Opening…" : "Open in Gallery") {
                                            Task { await model.openSelectedFixturePool() }
                                        }
                                        .disabled(model.isRunningFixtureSnapshotOperation)
                                        .backstageHelp("Open this selected snapshot as the active immutable Culling pool.")
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
            .background(SplitViewAutosaver(name: "PhotosByElieBackstage.FixturesSplit"))
        }
        .task {
            if model.fixtures.isEmpty { await model.loadFixtures() }
            if !model.selectedFixtureID.isEmpty {
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
                    .backstageHelp("Reload people, groups, and inherited access grants from Owner.")
            }
            BackstageFeedbackView(
                message: model.accessStatus,
                isWorking: model.isRunningAccess
            )
            HSplitView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("People").font(.title2.bold())
                        Spacer()
                        Button("New") { model.newPerson() }
                            .backstageHelp("Clear the person editor so you can enter a new person and their group access.")
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
                            .disabled(model.isRunningAccess)
                            .backstageHelp("Save the person's normalized identity and replace their direct group memberships with the selected set.")
                        Button("Disable", role: .destructive) { Task { await model.disablePerson() } }
                            .disabled(model.selectedPersonID.isEmpty || model.isRunningAccess)
                            .backstageHelp("Disable the selected person's access without deleting their audit history.")
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
                                .disabled(group.isArchived || model.isRunningAccess)
                                .backstageHelp(group.isArchived
                                    ? "This group is already archived and cannot receive new direct membership changes."
                                    : "Archive this group while preserving its identity and access history.")
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
                        .disabled(
                            model.groupID.isEmpty
                                || model.groupName.isEmpty
                                || model.isRunningAccess
                        )
                        .backstageHelp("Create or update the stable group ID, display label, and group kind entered above.")
                    Text("Usernames and emails are normalized by the Worker. Passwords remain case-sensitive and are never returned to this app.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
            .background(SplitViewAutosaver(name: "PhotosByElieBackstage.AccessSplit"))
        }
        .task {
            if model.accessState.allPeople.isEmpty { await model.loadAccess() }
        }
    }
}

struct FlowLayout: Layout {
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
    @StateObject private var quickLook = BackstageQuickLookCoordinator()

    var body: some View {
        Form {
            Section("Incremental Apple Photos sync") {
                Text("Choose Sync now to run one bounded low-priority pass. Backstage does not start Photos synchronization merely because the app launches or becomes active. Metadata-only changes preserve approval and return to Needs Upload; rendered-image changes create a new source version and return to Review.")
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Sync now") {
                        Task { await model.syncPhotosIncrementally() }
                    }
                    .disabled(model.isSyncingPhotos)
                    .backstageHelp("Run one bounded incremental Photos synchronization now and classify metadata, appearance, missing, and returned changes.")
                    if model.isSyncingPhotos {
                        ProgressView().controlSize(.small)
                    }
                    BackstageFeedbackView(
                        message: model.photosSyncStatus,
                        isWorking: model.isSyncingPhotos
                    )
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
            Section("Camera equipment backfill") {
                Text("Read camera, lens, and focal-length metadata directly through PhotoKit in bounded, resumable batches. Backstage writes only the Owner equipment cache and durable checkpoints; fixture decisions, editorial state, originals, and public catalog state remain unchanged.")
                    .foregroundStyle(.secondary)
                HStack {
                    Button(model.equipmentBackfillReport?.remaining ?? 0 > 0 ? "Resume backfill" : "Start backfill") {
                        Task { await model.backfillPhotoEquipment() }
                    }
                    .disabled(model.isBackfillingEquipment)
                    .backstageHelp("Continue through repeated 25-photo checkpoints until the equipment backfill finishes or you choose Stop safely.")
                    if model.isBackfillingEquipment {
                        Button("Stop safely") {
                            model.cancelPhotoEquipmentBackfill()
                        }
                        .backstageHelp("Cancel the current PhotoKit request and preserve every completed equipment checkpoint.")
                        ProgressView().controlSize(.small)
                    } else if let report = model.equipmentBackfillReport,
                              report.unavailable + report.failed > 0 {
                        Button("Retry unavailable & failed") {
                            Task {
                                await model.backfillPhotoEquipment(
                                    continuously: true,
                                    retryUnavailableAndFailed: true
                                )
                            }
                        }
                        .backstageHelp("Requeue photos that were unavailable or failed in earlier equipment passes, then process the next 25.")
                    }
                    BackstageFeedbackView(
                        message: model.equipmentBackfillStatus,
                        isWorking: model.isBackfillingEquipment
                    )
                }
                if let report = model.equipmentBackfillReport {
                    HStack(spacing: 18) {
                        LabeledContent("Eligible", value: report.eligible.formatted())
                        LabeledContent("Updated", value: report.updated.formatted())
                        LabeledContent("No equipment", value: report.skipped.formatted())
                        LabeledContent("Unavailable", value: report.unavailable.formatted())
                        LabeledContent("Failed", value: report.failed.formatted())
                        LabeledContent("Remaining", value: report.remaining.formatted())
                    }
                    .font(.caption)
                }
            }
            Section("Title, caption, and keywords") {
                HStack {
                    TextField("Asset ID", text: $model.metadataAssetID)
                    Button("Use selected Photos item") { model.useSelectedPhotoForMetadata() }
                        .disabled(model.selectedPhotoIDs.isEmpty)
                        .backstageHelp("Copy the currently selected Photos asset ID into this Metadata editing form.")
                    if !model.metadataAssetID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        metadataThumbnail(
                            assetID: model.metadataAssetID,
                            title: model.metadataTitle,
                            keywords: model.metadataKeywords
                                .split(separator: ",")
                                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                        )
                    }
                }
                TextField("Title", text: $model.metadataTitle)
                TextField("Caption", text: $model.metadataCaption)
                TextField("Comma-separated keywords", text: $model.metadataKeywords)
                HStack {
                    Button("Save title, caption & keywords") {
                        Task { await model.updatePhotoMetadata() }
                    }
                    .disabled(model.isMetadataReviewOperationInProgress)
                    .backstageHelp("Save the entered title, caption, and keywords as an audited, reversible Owner metadata edit.")
                    Button("Undo last change") {
                        Task { await model.undoLastMetadataChange() }
                    }
                    .keyboardShortcut("z", modifiers: .command)
                    .disabled(
                        model.metadataHistory.isEmpty
                            || model.isMetadataReviewOperationInProgress
                    )
                    .backstageHelp("Reverse the most recent metadata edit or blacklist replacement made during this session.")
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
                    .disabled(model.isMetadataReviewOperationInProgress)
                    .backstageHelp("Replace the canonical metadata keyword blacklist with the normalized terms entered here.")
                }
                BackstageFeedbackView(message: model.metadataReviewStatus)
            }
            Section("OpenAI title & keyword proposal ladder") {
                Text("Add as many ordered rungs as needed. Each attempt advances through the saved order; every rung always receives a bounded JPEG preview.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ForEach(Array(model.metadataModelLadder.indices), id: \.self) { index in
                    HStack {
                        Text("\(index + 1).")
                            .frame(width: 24, alignment: .leading)
                            .foregroundStyle(.secondary)
                        TextField("Model", text: $model.metadataModelLadder[index].model)
                            .textFieldStyle(.roundedBorder)
                        TextField("Effort", text: $model.metadataModelLadder[index].effort)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 100)
                        Label("Vision", systemImage: "eye.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("↑") {
                            model.moveMetadataModelRung(at: index, offset: -1)
                        }
                        .disabled(index == 0)
                        .backstageHelp("Move this model rung earlier in the saved title and keyword proposal order.")
                        Button("↓") {
                            model.moveMetadataModelRung(at: index, offset: 1)
                        }
                        .disabled(index == model.metadataModelLadder.count - 1)
                        .backstageHelp("Move this model rung later in the saved title and keyword proposal order.")
                        Button(role: .destructive) {
                            model.removeMetadataModelRung(at: index)
                        } label: {
                            Image(systemName: "trash")
                        }
                        .backstageHelp("Remove this rung from the title and keyword proposal ladder.")
                    }
                }
                HStack {
                    Button("Add rung") {
                        model.addMetadataModelRung()
                    }
                    .backstageHelp("Append another editable model and effort rung to the proposal ladder.")
                    Button("Save ladder") {
                        Task { await model.saveMetadataModelLadder() }
                    }
                    .disabled(
                        model.metadataModelLadderValidation != nil
                            || model.isSavingMetadataModelLadder
                            || model.isMetadataReviewOperationInProgress
                    )
                    .backstageHelp("Save the selected OpenAI title and keyword proposal ladder through the audited Owner action.")
                    BackstageFeedbackView(
                        message: model.metadataModelLadderStatus,
                        isWorking: model.isSavingMetadataModelLadder
                            || model.isLoadingMetadataModelLadder
                    )
                }
                if let validation = model.metadataModelLadderValidation {
                    Text(validation)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                Text("Supported effort strings: none, minimal, low, medium, high, xhigh, max. Known GPT-5.4/5.6 combinations are checked before save; unfamiliar model strings are checked by Codex Desktop at execution. Approval remains a separate human decision.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Verified Apple Photos give-back") {
                LabeledContent(
                    "Current fixture",
                    value: model.selectedFixtureBreadcrumb.isEmpty
                        ? "Unavailable"
                        : model.selectedFixtureBreadcrumb
                )
                Text("Approved canonical title, keywords, rating, color, and PBE:Approved are global. Tombstones receive PBE:Tombstone. Fixture Pick/Hide state is never written to Photos. Preview is read-only; Commit is a separate Worker-authorized action through the signed connector.")
                    .foregroundStyle(.secondary)
                LabeledContent("Write scope", value: model.metadataGiveBackScopeDescription)
                Text("Enter an exact Asset ID in the Title, caption, and keywords section to limit both Preview and Commit to that one item. Leave it blank only when the entire current fixture is intended.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Preview changes") {
                        Task { await model.planMetadataGiveBack() }
                    }
                    .disabled(model.isMetadataReviewOperationInProgress)
                    .backstageHelp("Build a read-only plan of eligible Apple Photos metadata changes without writing anything.")
                    Button("Commit & verify") {
                        showingCommitConfirmation = true
                    }
                    .disabled(
                        model.isMetadataReviewOperationInProgress
                            || !model.metadataGiveBackCommitReady
                    )
                    .backstageHelp("Review the separate confirmation for writing the currently planned approved metadata to Apple Photos.")
                    Button("Retry failed only") {
                        Task { await model.retryMetadataFailures() }
                    }
                    .disabled(
                        model.isMetadataReviewOperationInProgress
                            || (model.metadataReport?.failed.isEmpty ?? true)
                    )
                    .backstageHelp("Retry only the independently failed assets from the most recent metadata give-back receipt.")
                    if model.isRunningMetadata {
                        ProgressView().controlSize(.small)
                    }
                }
                BackstageFeedbackView(
                    message: model.metadataStatus,
                    isWorking: model.isRunningMetadata
                )
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
        .task { await model.loadMetadataModelLadderIfNeeded() }
        .onAppear { quickLook.activate() }
        .onDisappear { quickLook.deactivate() }
        .confirmationDialog(
            "Write approved metadata to \(model.metadataReport?.readyCount ?? 0) Apple Photos item\((model.metadataReport?.readyCount ?? 0) == 1 ? "" : "s")?",
            isPresented: $showingCommitConfirmation
        ) {
            Button("Commit and verify \(model.metadataReport?.readyCount ?? 0) item\((model.metadataReport?.readyCount ?? 0) == 1 ? "" : "s")", role: .destructive) {
                Task { await model.commitMetadataGiveBack() }
            }
            .backstageHelp("Confirm the signed metadata write, then re-read every eligible Photos item before recording verified receipts.")
            Button("Cancel", role: .cancel) {}
                .backstageHelp("Close this confirmation without writing any metadata to Apple Photos.")
        } message: {
            Text("Scope: \(model.metadataGiveBackScopeDescription). The signed Max connector will preserve unrelated keywords, write only eligible same-version assets, then re-read every item before recording a verified receipt.")
        }
    }

    private func metadataThumbnail(
        assetID: String,
        title: String,
        keywords: [String]
    ) -> some View {
        Button {
            openMetadataQuickLook(assetID: assetID, title: title, keywords: keywords)
        } label: {
            Group {
                if let thumbnail = model.cullingThumbnails[assetID] {
                    Image(nsImage: thumbnail)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    Image(systemName: "photo")
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 64, height: 48)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: 5))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            "Open preview for \(title.isEmpty ? assetID : title)"
        )
        .backstageHelp("Open this exact Metadata asset in the canonical Quick Look presentation. Rating and color shortcuts remain audited.")
        .task(id: assetID) {
            let source = model.cullingAssets.first(where: { $0.id == assetID })
            model.requestThumbnail(
                for: assetID,
                preferredIdentifier: source?.photoLibraryIdentifier
            )
        }
    }

    private func openMetadataQuickLook(
        assetID: String,
        title: String,
        keywords: [String]
    ) {
        model.metadataReviewStatus = "Preparing the selected Metadata photo for Quick Look…"
        let presentationID = quickLook.beginPresentation()
        Task {
            let source = model.cullingAssets.first(where: { $0.id == assetID })
            guard let url = await model.prepareMetadataQuickLookURL(
                for: assetID,
                preferredIdentifier: source?.photoLibraryIdentifier
            ) else {
                return
            }
            guard quickLook.isCurrentPresentation(presentationID) else { return }
            let decision = model.cullingStates[assetID]
            let equipment = model.quickLookEquipment(
                for: assetID,
                cameraBody: source?.cameraBody ?? "",
                lens: source?.lens ?? "",
                focalLength: source?.focalLength ?? ""
            )
            quickLook.present(
                urls: [url],
                metadata: [
                    BackstageQuickLookMetadata(
                        assetID: assetID,
                        filename: source?.filename ?? assetID,
                        title: title,
                        keywords: keywords,
                        locationLabel: source?.locationLabel ?? "",
                        capturedAt: source?.capturedAt ?? "",
                        cameraBody: equipment.cameraBody,
                        lens: equipment.lens,
                        focalLength: equipment.focalLength,
                        sourceSize: BackstageQuickLookSourceSize(
                            mediaType: source?.mediaType ?? "photo",
                            pixelWidth: source?.pixelWidth ?? 0,
                            pixelHeight: source?.pixelHeight ?? 0,
                            byteCount: source?.originalByteCount ?? 0,
                            currentImageByteCount: model.currentImageByteCount(for: assetID)
                        ),
                        rating: decision?.rating ?? source?.rating ?? 0,
                        color: decision?.color ?? source?.color ?? "",
                        state: decision?.pickState ?? source?.placementState.rawValue ?? "metadata",
                        shortcutHint: "Metadata preview • \(BackstageQuickLookDecisionRouter.shortcutHint) • Escape closes"
                    )
                ],
                presentation: presentationID,
                onShortcut: { shortcut, currentAssetID in
                    BackstageQuickLookDecisionRouter.handle(
                        shortcut,
                        assetID: currentAssetID,
                        model: model,
                        coordinator: quickLook
                    )
                },
                externalEditors: model.availableExternalEditors,
                externalEditUnavailableReason: model.activeExternalEditJob == nil
                    ? nil
                    : "Finish or cancel the current external edit first.",
                onExternalEdit: { currentAssetID, editor in
                    quickLook.dismiss()
                    model.requestExternalEdit(with: editor, assetIDs: [currentAssetID])
                },
                onChooseExternalEditor: { currentAssetID in
                    quickLook.dismiss()
                    model.chooseExternalEditor(for: [currentAssetID])
                },
                externalEditActions: model.quickLookExternalEditActions
            )
            model.metadataReviewStatus = "Quick Look opened for the selected Metadata photo."
        }
    }
}
