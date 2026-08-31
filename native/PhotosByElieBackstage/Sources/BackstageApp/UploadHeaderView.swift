import OwnerCore
import SwiftUI

/// Production Upload heading kept small enough for Xcode Canvas source mapping.
struct UploadHeaderView: View {
    @ObservedObject var model: BackstageViewModel
    var isPreviewMode: Bool
    @Binding var confirmingSelectedPublication: Bool
    @Binding var confirmingCatalogDeployment: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Uploads & website").font(.largeTitle.bold())
                    Text(model.selectedFixtureBreadcrumb.isEmpty
                        ? "Fixture unavailable"
                        : model.selectedFixtureBreadcrumb)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if let plan = model.nativeUploadPlan,
                   plan.needsUploadCount > plan.items.count {
                    Button(plan.order.alternateLabel) {
                        Task {
                            let nextOrder: NativeUploadPlanOrder = plan.order == .recent ? .oldest : .recent
                            await model.loadNativeUploadPlan(order: nextOrder)
                        }
                    }
                    .disabled(model.isRunningDelivery || model.selectedFixtureID.isEmpty)
                    .backstageHelp(plan.order == .recent
                        ? "Return to the oldest-first upload queue. Recent approvals remain eligible and are not changed by this view switch."
                        : "Load the newest approved items first so recent Review approvals can be found without changing the oldest-first upload queue.")
                }
                if model.nativeUploadPlan?.items.isEmpty == true {
                    Button("Load next 200") {
                        Task { await model.loadNativeUploadPlan() }
                    }
                    .disabled(model.isRunningDelivery || model.selectedFixtureID.isEmpty)
                    .backstageHelp("Load the next eligible batch of up to 200 approved assets after the current upload tray is complete.")
                }
                Button("Upload selection…") {
                    confirmingSelectedPublication = true
                }
                    .disabled(!model.canStartCloudWorkflow || model.selectedDeliveryIDs.isEmpty)
                    .backstageHelp("Review the confirmation for uploading only the selected eligible assets and preparing their catalog entries.")
                if let plan = model.nativeUploadPlan,
                   plan.deploymentPendingCount + plan.deploymentFailedCount > 0 {
                    Button(model.isDeployingPublicCatalog ? "Deploying & verifying…" : "Deploy & verify website…") {
                        confirmingCatalogDeployment = true
                    }
                    .disabled(!model.canStartPublicCatalogDeployment)
                    .backstageHelp("Deploy the exact approved Owner catalog projection, then wait until the public website returns the same verified checksum.")
                }
            }
            Text("Upload prepares full-resolution media and catalog entries. Deploy & verify website is the separate final step; only checksum-verified website items are Live.")
                .foregroundStyle(.secondary)
            if model.isRunningDelivery, model.nativeUploadPlan == nil {
                ProgressView("Loading approved upload eligibility…")
            }
            BackstageFeedbackView(
                message: model.nativeUploadStatus,
                isWorking: model.isRunningDelivery || model.isRunningNativePublication
            )
        }
    }
}

#if DEBUG
@MainActor
private func uploadHeaderPreviewModel() -> BackstageViewModel {
    let model = UploadPreviewFixtures.ready()
    if let firstItemID = model.nativeUploadPlan?.items.first?.id {
        model.selectedDeliveryIDs = [firstItemID]
    }
    return model
}

#Preview("Uploads — Header") {
    UploadHeaderView(
        model: uploadHeaderPreviewModel(),
        isPreviewMode: true,
        confirmingSelectedPublication: .constant(false),
        confirmingCatalogDeployment: .constant(false)
    )
    .padding()
    .frame(width: 1_200, height: 240)
}
#endif
