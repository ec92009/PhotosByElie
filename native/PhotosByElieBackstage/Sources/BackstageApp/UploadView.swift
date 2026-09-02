import AppKit
import OwnerCore
import SwiftUI

/// The production Upload workspace and its Canvas-selectable implementation.
///
/// Synthetic fixtures live in `UploadPreview.swift`; automatic work stays disabled in Canvas.
struct UploadView: View {
    @ObservedObject var model: BackstageViewModel
    var isPreviewMode = false
    @AppStorage(BackstagePanelPreferenceKey.uploadRecoveryExpanded)
    private var uploadRecoveryExpanded = false
    @State private var uploadSortOrder = [
        KeyPathComparator(\NativeUploadPlanItem.capturedAt, order: .forward),
    ]
    @State private var confirmingAdoption = false
    @State private var confirmingSelectedPublication = false
    @State private var confirmingVisiblePublication = false
    @State private var confirmingCatalogDeployment = false
    @State private var confirmingCatalogRecovery = false
    @State private var confirmingReturnToReview = false
    @State private var confirmingUploadHide = false
    @StateObject private var quickLook = BackstageQuickLookCoordinator()

    private func sortedItems(_ plan: NativeUploadPlan) -> [NativeUploadPlanItem] {
        plan.items.sorted(using: uploadSortOrder)
    }

    static func catalogRecoveryConfirmationTitle(count: Int) -> String {
        "Recover \(count) catalog entries from existing R2 receipts?"
    }

    static func catalogRecoveryStageLabel(_ stage: AssetWorkflowStage) -> String {
        switch stage {
        case .needsUpload, .approved:
            "Queued"
        case .uploading:
            "Verifying R2"
        case .fullResolutionUploaded:
            "R2 Verified"
        case .publishing:
            "Rebuilding Catalog"
        case .live:
            "Catalog Recovered"
        default:
            stage.label
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            UploadHeaderView(
                model: model,
                isPreviewMode: isPreviewMode,
                confirmingSelectedPublication: $confirmingSelectedPublication,
                confirmingCatalogDeployment: $confirmingCatalogDeployment,
                confirmingCatalogRecovery: $confirmingCatalogRecovery
            )
            if let plan = model.nativeUploadPlan {
                HStack {
                    LabeledContent("In workflow", value: "\(plan.pickedCount)")
                    LabeledContent("Not yet approved", value: "\(plan.needsReviewCount)")
                    LabeledContent("Approved", value: "\(plan.approvedOnlyCount)")
                    LabeledContent("Needs Upload", value: "\(plan.needsUploadCount)")
                    LabeledContent("Media Uploaded", value: "\(plan.fullResolutionUploadedCount)")
                    LabeledContent("Catalog Preparing", value: "\(plan.projectionPendingCount)")
                    LabeledContent("Ready to Deploy", value: "\(plan.deploymentPendingCount)")
                    LabeledContent("Live", value: "\(plan.liveOnWebsiteCount)")
                    if plan.failedHealthCount > 0 {
                        LabeledContent("Failed health", value: "\(plan.failedHealthCount)")
                            .foregroundStyle(.red)
                    }
                }
                if plan.needsUploadCount > 0 {
                    HStack {
                        let outsideWindow = max(0, plan.needsUploadCount - plan.items.count)
                        Text(
                            "\(plan.items.count.formatted()) shown of \(plan.needsUploadCount.formatted()) needing upload"
                            + " • \(outsideWindow.formatted()) not shown"
                            + " • \(plan.order.label)"
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        Spacer()
                        Button(
                            plan.needsUploadCount > plan.items.count
                                ? "Upload all \(plan.needsUploadCount.formatted())…"
                                : "Upload these \(plan.items.count.formatted())…"
                        ) {
                            confirmingVisiblePublication = true
                        }
                        .disabled(!model.canStartCloudWorkflow || plan.items.isEmpty)
                        .backstageHelp("Review the confirmation for continuously uploading every eligible asset. Failed items remain independently retryable without blocking later windows.")
                    }
                }
                if plan.items.isEmpty {
                    ContentUnavailableView(
                        plan.needsUploadCount > 0 ? "Batch complete" : "No approved assets need upload",
                        systemImage: plan.needsUploadCount > 0 ? "tray" : "checkmark.circle",
                        description: Text(
                            plan.needsUploadCount > 0
                                ? "\(plan.needsUploadCount) eligible item\(plan.needsUploadCount == 1 ? "" : "s") remain. Refresh Uploads to retry any independently failed items."
                                : plan.needsReviewCount > 0
                                ? "\(plan.needsReviewCount) picked item\(plan.needsReviewCount == 1 ? "" : "s") still need Review approval."
                                : "This fixture has no approved upload work waiting."
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
                                guard !isPreviewMode else { return }
                                await model.loadNativeUploadThumbnail(for: item)
                            }
                        }
                        TableColumn("Keywords", value: \.keywordsText) { item in
                            Text(item.keywordsText.isEmpty ? "No keywords" : item.keywordsText)
                                .lineLimit(2)
                        }
                        TableColumn("Captured", value: \.capturedAt)
                        TableColumn("Stage") { Text($0.workflowStage.label) }
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
                        toggleUploadQuickLook(in: plan)
                        return .handled
                    }
                    HStack {
                        Text("\(model.selectedDeliveryIDs.count.formatted()) selected")
                            .foregroundStyle(.secondary)
                        Button("Open in Gallery") {
                            Task {
                                await model.openInGallery(
                                    assetIDs: model.selectedDeliveryIDs.sorted(),
                                    sourceLabel: "Uploads"
                                )
                            }
                        }
                        .disabled(model.isRunningDelivery || model.selectedDeliveryIDs.isEmpty)
                        .backstageHelp("Open the selected Upload asset in Gallery while preserving its current editorial and delivery state.")
                        Button("Return to Review…") {
                            confirmingReturnToReview = true
                        }
                        .disabled(model.isRunningDelivery || model.selectedDeliveryIDs.isEmpty)
                        .backstageHelp("Review the confirmation for reversing approval and returning the selected assets to Review.")
                        Button("Hide…") {
                            confirmingUploadHide = true
                        }
                        .disabled(model.isRunningDelivery || model.selectedDeliveryIDs.isEmpty)
                        .backstageHelp("Review the confirmation for hiding the selected assets from this fixture's upload queue.")
                        Button("Clear selection") {
                            model.selectedDeliveryIDs.removeAll()
                        }
                        .disabled(model.selectedDeliveryIDs.isEmpty)
                        .backstageHelp("Deselect every Upload row without changing approval, visibility, or publication state.")
                        Spacer()
                        Text("Use Command-click or Shift-click to adjust the selection; ⌘A selects all shown rows.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else if !model.isRunningDelivery {
                VStack(spacing: 12) {
                    ContentUnavailableView(
                        "Upload queue unavailable",
                        systemImage: "exclamationmark.arrow.triangle.2.circlepath",
                        description: Text(model.nativeUploadStatus)
                    )
                    Button("Retry loading uploads") {
                        Task { await model.loadNativeUploadPlan() }
                    }
                    .disabled(model.isRunningDelivery || model.selectedFixtureID.isEmpty)
                    .backstageHelp("Retry loading the fixture upload queue. No publication starts until you explicitly choose an upload action.")
                }
                .frame(maxWidth: .infinity, minHeight: 180)
            }
            if model.isRunningNativePublication,
               let run = model.nativeUploadRun,
               run.requested > 0 {
                HStack {
                    ProgressView(
                        value: Double(run.processed),
                        total: Double(run.requested)
                    ) {
                        Text(
                            (model.isRunningCatalogRecovery ? "Catalog recovery" : "Upload")
                            + " • batch \(model.nativePublicationBatchNumber) of \(model.nativePublicationBatchCount)"
                            + " • \(run.processed) of \(run.requested)"
                            + (model.isRunningCatalogRecovery
                                ? " • existing R2 only"
                                : " • \(run.live) website live")
                            + " • \(run.failed) failed"
                            + " • \(run.remaining) remaining"
                        )
                    }
                    Button(model.isCancellingNativePublication ? "Stopping…" : "Stop safely") {
                        Task { await model.cancelNativePublication() }
                    }
                    .disabled(model.isCancellingNativePublication)
                    .backstageHelp("Stop after currently active items finish. Completed receipts remain valid and unstarted items stay retryable.")
                }
            }
            if let run = model.nativeUploadRun,
               run.status == "failed" {
                HStack {
                    Label(
                        run.lastError.isEmpty
                            ? "Upload stopped before the run became terminal."
                            : run.lastError,
                        systemImage: "exclamationmark.triangle.fill"
                    )
                    .foregroundStyle(.orange)
                    Spacer()
                    Button(model.isRunningNativePublication ? "Retrying…" : "Retry same run") {
                        Task { await model.resumeFailedNativePublicationRun() }
                    }
                    .disabled(!model.canStartCloudWorkflow || run.remaining == 0)
                    .backstageHelp("Resume the exact failed upload run. Verified items are preserved and no replacement run is created.")
                }
            }
            if let run = model.nativeUploadRun,
               !run.items.isEmpty {
                Table(run.items) {
                    TableColumn("Asset", value: \.assetID)
                    TableColumn("Stage") {
                        Text(
                            model.isRunningCatalogRecovery
                                ? Self.catalogRecoveryStageLabel($0.workflowStage)
                                : $0.workflowStage.label
                        )
                    }
                    TableColumn("Error", value: \.errorText)
                }
                .frame(minHeight: 180)
            }
            DisclosureGroup(
                "Legacy recovery and fixture receipt inspection",
                isExpanded: $uploadRecoveryExpanded
            ) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Button("Load receipt audit") { Task { await model.loadDeliveryPlan() } }
                            .disabled(model.isRunningDelivery)
                            .backstageHelp("Load legacy fixture delivery receipts for inspection and recovery planning.")
                        Button("Queue health") { Task { await model.loadUploadHealth() } }
                            .disabled(model.isRunningDelivery)
                            .backstageHelp("Inspect legacy upload coverage, queue eligibility, and partial delivery health.")
                        Button("Retry legacy failures") { Task { await model.retryDeliveryFailures() } }
                            .disabled(model.isRunningDelivery || model.deliveryFailedIDs.isEmpty)
                            .backstageHelp("Retry only the failed items identified by the loaded legacy delivery audit.")
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
                        .disabled(
                            model.isRunningDelivery
                                || model.uploadRunID
                                    .trimmingCharacters(in: .whitespacesAndNewlines)
                                    .isEmpty
                        )
                        .backstageHelp("Verify the entered legacy Upload Bridge run and preview exactly which items could be adopted.")
                        Button("Adopt verified run…") { confirmingAdoption = true }
                            .disabled(
                                model.isRunningDelivery
                                || (model.uploadAdoptionPlan?.eligibleIDs.isEmpty ?? true)
                            )
                            .backstageHelp("Review the confirmation for reconstructing fixture receipts from the verified legacy upload run.")
                    }
                    BackstageFeedbackView(
                        message: model.uploadRecoveryStatus,
                        isWorking: model.isRunningDelivery
                    )
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
        .task {
            guard !isPreviewMode else { return }
            if model.fixtures.isEmpty { await model.loadFixtures() }
            if !model.selectedFixtureID.isEmpty {
                await model.loadNativeUploadPlan()
            }
        }
        .onAppear { quickLook.activate() }
        .onDisappear { quickLook.deactivate() }
        .confirmationDialog(
            "Return the selected approved assets to Review?",
            isPresented: $confirmingReturnToReview
        ) {
            Button("Return \(model.selectedDeliveryIDs.count) to Review") {
                Task { await model.returnSelectedUploadsToReview() }
            }
            .backstageHelp("Confirm reversal of approval and upload readiness for the selected assets while preserving their metadata and picks.")
            Button("Cancel", role: .cancel) {}
                .backstageHelp("Close this confirmation without returning any assets to Review.")
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
            .backstageHelp("Confirm hiding the selected assets from this fixture's upload queue without deleting their files.")
            Button("Cancel", role: .cancel) {}
                .backstageHelp("Close this confirmation without hiding any Upload assets.")
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
            .backstageHelp("Confirm checksum-verified receipt reconstruction for exactly the eligible items in this legacy run.")
            Button("Cancel", role: .cancel) {}
                .backstageHelp("Close this confirmation without adopting the legacy upload run.")
        } message: {
            Text("The existing R2 objects are checksum-verified before fixture receipts are reconstructed. No client message or publication is triggered.")
        }
        .confirmationDialog(
            "Upload and prepare the selected assets?",
            isPresented: $confirmingSelectedPublication
        ) {
            Button("Upload selection") {
                Task { await model.publishSelectedNatively() }
            }
            .backstageHelp("Confirm full-resolution upload and local catalog preparation for the selected eligible assets.")
            Button("Cancel", role: .cancel) {}
                .backstageHelp("Close this confirmation without uploading or preparing the selection.")
        } message: {
            Text("This uploads the media and prepares its catalog entries. The assets are not called Live until Deploy & verify website completes with an exact checksum match.")
        }
        .confirmationDialog(
            "Upload and prepare all \(model.nativeUploadPlan?.needsUploadCount ?? 0) eligible assets?",
            isPresented: $confirmingVisiblePublication
        ) {
            Button("Upload all \(model.nativeUploadPlan?.needsUploadCount ?? 0) assets") {
                Task { await model.publishVisibleNativeWindow() }
            }
            .backstageHelp("Confirm continuous upload and catalog preparation across every eligible queue window.")
            Button("Cancel", role: .cancel) {}
                .backstageHelp("Close this confirmation without uploading the visible tray.")
        } message: {
            Text("Backstage will continue through the complete eligible queue in sequential batches of up to 50. A failed item keeps its error and receipt for retry while later photos continue automatically. Website deployment remains a separate verified step.")
        }
        .confirmationDialog(
            Self.catalogRecoveryConfirmationTitle(
                count: model.nativeUploadPlan.map {
                    $0.projectionPendingCount + $0.projectionFailedCount
                } ?? 0
            ),
            isPresented: $confirmingCatalogRecovery
        ) {
            Button("Recover catalog entries") {
                Task { await model.recoverCatalogPreparing() }
            }
            .backstageHelp("Confirm bounded catalog-only recovery from exact current checksum-verified R2 receipts.")
            Button("Cancel", role: .cancel) {}
                .backstageHelp("Close this confirmation without changing catalog state.")
        } message: {
            Text("Backstage verifies each existing R2 object and rebuilds only the missing local catalog entry in batches of 50. It will not upload media. One failed asset remains independently retryable while later assets continue.")
        }
        .confirmationDialog(
            "Deploy the prepared catalog to the public website?",
            isPresented: $confirmingCatalogDeployment
        ) {
            Button("Deploy & verify website") {
                Task { await model.deployPublicCatalog() }
            }
            .backstageHelp("Publish only the exact approved Owner catalog projection and wait for the public website checksum to match.")
            Button("Cancel", role: .cancel) {}
                .backstageHelp("Close this confirmation without changing the public website catalog.")
        } message: {
            Text("Backstage uses an isolated checkout, publishes only the catalog file, and records Live only after the website returns the same checksum. A failed verification remains safely retryable.")
        }
    }

    private func toggleUploadQuickLook(in plan: NativeUploadPlan) {
        if quickLook.isVisible {
            quickLook.dismiss()
            return
        }
        guard model.selectedDeliveryIDs.count == 1 else {
            model.nativeUploadStatus = model.selectedDeliveryIDs.isEmpty
                ? "Select one Upload item before opening Quick Look."
                : "Quick Look opens one selected Upload item at a time."
            return
        }
        guard let item = sortedItems(plan).first(where: {
            model.selectedDeliveryIDs.contains($0.id)
        }) else {
            return
        }
        presentUploadQuickLook(item)
    }

    private func presentUploadQuickLook(
        _ item: NativeUploadPlanItem,
        direction: OwnerSelectionDirection = .next
    ) {
        model.nativeUploadStatus = "Preparing the selected Upload photo for Quick Look…"
        let presentationID = quickLook.beginPresentation()
        Task {
            guard let url = await model.prepareNativeUploadQuickLookURL(for: item) else {
                return
            }
            guard quickLook.isCurrentPresentation(presentationID) else { return }
            let source = model.cullingAssets.first(where: { $0.id == item.id })
            let decision = model.cullingStates[item.id]
            let equipment = model.quickLookEquipment(
                for: item.id,
                cameraBody: item.cameraBody,
                lens: item.lens,
                focalLength: item.focalLength
            )
            let metadata = BackstageQuickLookMetadata(
                assetID: item.id,
                filename: item.filename,
                title: item.title,
                keywords: item.keywords,
                locationLabel: source?.locationLabel ?? "",
                capturedAt: item.capturedAt,
                cameraBody: equipment.cameraBody,
                lens: equipment.lens,
                focalLength: equipment.focalLength,
                sourceSize: BackstageQuickLookSourceSize(
                    mediaType: item.mediaType,
                    pixelWidth: item.pixelWidth,
                    pixelHeight: item.pixelHeight,
                    byteCount: item.originalByteCount,
                    currentImageByteCount: model.currentImageByteCount(for: item.id)
                ),
                rating: decision?.rating ?? source?.rating ?? 0,
                color: decision?.color ?? source?.color ?? "",
                state: item.workflowStage.label,
                shortcutHint: "Shortcuts: ←/→/↑/↓ navigate • H hide • R return to Review • \(BackstageQuickLookDecisionRouter.shortcutHint)"
            )
            quickLook.present(
                urls: [url],
                metadata: [metadata],
                presentation: presentationID,
                onShortcut: { shortcut, assetID in
                    guard !model.isRunningDelivery else { return false }
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
                        moveUploadQuickLook(from: assetID, direction: .previous)
                    case .next, .nextRow:
                        moveUploadQuickLook(from: assetID, direction: .next)
                    case .hide:
                        hideCurrentUploadQuickLook(
                            assetID: assetID,
                            removalDirection: direction
                        )
                    case .returnToReview:
                        returnCurrentUploadQuickLookToReview(
                            assetID: assetID,
                            removalDirection: direction
                        )
                    case .pick, .approve, .unpick, .undo, .rating, .color, .wasteBasket:
                        return false
                    }
                    return true
                },
                externalEditors: model.availableExternalEditors,
                externalEditUnavailableReason: model.activeExternalEditJob == nil
                    ? nil
                    : "Finish or cancel the current external edit first.",
                onExternalEdit: { assetID, editor in
                    quickLook.dismiss()
                    model.requestExternalEdit(with: editor, assetIDs: [assetID])
                },
                onChooseExternalEditor: { assetID in
                    quickLook.dismiss()
                    model.chooseExternalEditor(for: [assetID])
                },
                externalEditActions: model.quickLookExternalEditActions
            )
            model.nativeUploadStatus = "Quick Look opened for the selected Upload photo."
        }
    }

    private func moveUploadQuickLook(
        from assetID: String,
        direction: OwnerSelectionDirection
    ) {
        guard let plan = model.nativeUploadPlan else { return }
        let items = sortedItems(plan)
        guard let index = items.firstIndex(where: { $0.id == assetID }) else {
            return
        }
        let nextIndex = index + (direction == .previous ? -1 : 1)
        guard items.indices.contains(nextIndex) else { return }
        let next = items[nextIndex]
        model.selectedDeliveryIDs = [next.id]
        presentUploadQuickLook(next, direction: direction)
    }

    private func hideCurrentUploadQuickLook(
        assetID: String,
        removalDirection: OwnerSelectionDirection
    ) {
        guard let plan = model.nativeUploadPlan else { return }
        let items = sortedItems(plan)
        guard items.contains(where: { $0.id == assetID }) else {
            return
        }
        model.selectedDeliveryIDs = [assetID]
        Task {
            await model.hideSelectedUploads()
            guard let updatedPlan = model.nativeUploadPlan else {
                quickLook.dismiss()
                return
            }
            let remaining = sortedItems(updatedPlan)
            let next = directionalUploadReplacement(
                from: items,
                removing: assetID,
                remaining: remaining,
                direction: removalDirection
            )
            guard let next else {
                quickLook.dismiss()
                return
            }
            model.selectedDeliveryIDs = [next.id]
            presentUploadQuickLook(next, direction: removalDirection)
        }
    }

    private func returnCurrentUploadQuickLookToReview(
        assetID: String,
        removalDirection: OwnerSelectionDirection
    ) {
        guard let plan = model.nativeUploadPlan else { return }
        let items = sortedItems(plan)
        guard items.contains(where: { $0.id == assetID }) else {
            return
        }
        model.selectedDeliveryIDs = [assetID]
        Task {
            await model.returnSelectedUploadsToReview()
            guard let updatedPlan = model.nativeUploadPlan else {
                quickLook.dismiss()
                return
            }
            let remaining = sortedItems(updatedPlan)
            let next = directionalUploadReplacement(
                from: items,
                removing: assetID,
                remaining: remaining,
                direction: removalDirection
            )
            guard let next else {
                quickLook.dismiss()
                return
            }
            model.selectedDeliveryIDs = [next.id]
            presentUploadQuickLook(next, direction: removalDirection)
        }
    }

    private func directionalUploadReplacement(
        from items: [NativeUploadPlanItem],
        removing assetID: String,
        remaining: [NativeUploadPlanItem],
        direction: OwnerSelectionDirection
    ) -> NativeUploadPlanItem? {
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
}

#if DEBUG
#Preview("Uploads — Ready") {
    UploadView(
        model: UploadPreviewFixtures.ready(),
        isPreviewMode: true
    )
    .frame(width: 1_440, height: 900)
}

#endif
