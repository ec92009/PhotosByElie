import AppKit
import OwnerCore
import SwiftUI

/// The production Upload workspace and its Canvas-selectable implementation.
///
/// Synthetic fixtures live in `UploadPreview.swift`; automatic work stays disabled in Canvas.
struct UploadView: View {
    @ObservedObject var model: BackstageViewModel
    var isPreviewMode = false
    @State private var uploadSortOrder = [
        KeyPathComparator(\NativeUploadPlanItem.capturedAt, order: .forward),
    ]
    @State private var confirmingAdoption = false
    @State private var confirmingSelectedPublication = false
    @State private var confirmingVisiblePublication = false
    @State private var confirmingReturnToReview = false
    @State private var confirmingUploadHide = false
    @State private var uploadQuickViewItem: NativeUploadPlanItem?
    @FocusState private var isUploadQuickViewFocused: Bool

    private func sortedItems(_ plan: NativeUploadPlan) -> [NativeUploadPlanItem] {
        plan.items.sorted(using: uploadSortOrder)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            UploadHeaderView(
                model: model,
                isPreviewMode: isPreviewMode,
                confirmingSelectedPublication: $confirmingSelectedPublication
            )
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
                                guard !isPreviewMode else { return }
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
                .focused($isUploadQuickViewFocused)
                .onAppear {
                    isUploadQuickViewFocused = true
                }
                .onKeyPress(.space) {
                    closeUploadQuickView()
                    return .handled
                }
                .onKeyPress(.upArrow) {
                    moveUploadQuickView(in: plan, by: -1)
                    return .handled
                }
                .onKeyPress(.downArrow) {
                    moveUploadQuickView(in: plan, by: 1)
                    return .handled
                }
                .onKeyPress("h") {
                    guard !model.isRunningDelivery else { return .handled }
                    hideCurrentUploadQuickView(in: plan)
                    return .handled
                }
                .onKeyPress("r") {
                    guard !model.isRunningDelivery else { return .handled }
                    returnCurrentUploadQuickViewToReview(in: plan)
                    return .handled
                }
            }
        }
        .task {
            guard !isPreviewMode else { return }
            if model.fixtures.isEmpty { await model.loadFixtures() }
            if model.selectedFixtureID.isEmpty {
                model.selectedFixtureID = model.flatFixtures.first(where: { $0.id == "fixture-expo" })?.id
                    ?? model.flatFixtures.first(where: { $0.parentID == nil && !$0.isArchived })?.id
                    ?? ""
            }
        }
        .task(id: model.selectedFixtureID) {
            guard !isPreviewMode, !model.selectedFixtureID.isEmpty else { return }
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
        isUploadQuickViewFocused = true
        Task { await model.loadNativeUploadPreview(for: item) }
    }

    private func closeUploadQuickView() {
        isUploadQuickViewFocused = false
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

    private func hideCurrentUploadQuickView(in plan: NativeUploadPlan) {
        let items = sortedItems(plan)
        guard let current = uploadQuickViewItem,
              let currentIndex = items.firstIndex(where: { $0.id == current.id }) else {
            return
        }
        let preferredNextID = items.indices.contains(currentIndex + 1)
            ? items[currentIndex + 1].id
            : items.indices.contains(currentIndex - 1)
                ? items[currentIndex - 1].id
                : nil
        model.selectedDeliveryIDs = [current.id]
        Task {
            await model.hideSelectedUploads()
            guard let updatedPlan = model.nativeUploadPlan else {
                closeUploadQuickView()
                return
            }
            let remaining = sortedItems(updatedPlan)
            let next = preferredNextID.flatMap { preferredID in
                remaining.first(where: { $0.id == preferredID })
            } ?? remaining.first
            guard let next else {
                closeUploadQuickView()
                return
            }
            uploadQuickViewItem = next
            model.selectedDeliveryIDs = [next.id]
            isUploadQuickViewFocused = true
            await model.loadNativeUploadPreview(for: next)
        }
    }

    private func returnCurrentUploadQuickViewToReview(in plan: NativeUploadPlan) {
        let items = sortedItems(plan)
        guard let current = uploadQuickViewItem,
              let currentIndex = items.firstIndex(where: { $0.id == current.id }) else {
            return
        }
        let preferredNextID = items.indices.contains(currentIndex + 1)
            ? items[currentIndex + 1].id
            : items.indices.contains(currentIndex - 1)
                ? items[currentIndex - 1].id
                : nil
        model.selectedDeliveryIDs = [current.id]
        Task {
            await model.returnSelectedUploadsToReview()
            guard let updatedPlan = model.nativeUploadPlan else {
                closeUploadQuickView()
                return
            }
            let remaining = sortedItems(updatedPlan)
            let next = preferredNextID.flatMap { preferredID in
                remaining.first(where: { $0.id == preferredID })
            } ?? remaining.first
            guard let next else {
                closeUploadQuickView()
                return
            }
            uploadQuickViewItem = next
            model.selectedDeliveryIDs = [next.id]
            isUploadQuickViewFocused = true
            await model.loadNativeUploadPreview(for: next)
        }
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
