import OwnerCore
import SwiftUI

/// Production Upload heading kept small enough for Xcode Canvas source mapping.
struct UploadHeaderView: View {
    @ObservedObject var model: BackstageViewModel
    var isPreviewMode: Bool
    @Binding var confirmingSelectedPublication: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Upload & publish").font(.largeTitle.bold())
                Spacer()
                FixturePicker(model: model, isPreviewMode: isPreviewMode)
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
                        ? "Return to the oldest-first publication queue. Recent approvals remain eligible and are not changed by this view switch."
                        : "Load the newest approved items first so recent Review approvals can be found without changing the oldest-first publication queue.")
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
                    .disabled(model.isRunningDelivery || model.selectedDeliveryIDs.isEmpty)
                    .backstageHelp("Review the confirmation for publishing only the selected eligible assets.")
            }
            Text("Upload equals publication. Each verified source version becomes live immediately in every effective picked fixture; ACS alone determines who can see it. A failed asset remains Needs Upload without blocking the rest.")
                .foregroundStyle(.secondary)
            if model.isRunningDelivery, model.nativeUploadPlan == nil {
                ProgressView("Loading approved publication eligibility…")
            }
            Text(model.nativeUploadStatus)
                .font(.callout)
                .foregroundStyle(.secondary)
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
        confirmingSelectedPublication: .constant(false)
    )
    .padding()
    .frame(width: 1_200, height: 240)
}
#endif
