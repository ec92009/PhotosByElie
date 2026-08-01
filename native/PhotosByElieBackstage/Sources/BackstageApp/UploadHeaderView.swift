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
                if model.nativeUploadPlan?.items.isEmpty == true {
                    Button("Load next 200") {
                        Task { await model.loadNativeUploadPlan() }
                    }
                    .disabled(model.isRunningDelivery || model.selectedFixtureID.isEmpty)
                }
                Button("Upload selection…") {
                    confirmingSelectedPublication = true
                }
                    .disabled(model.isRunningDelivery || model.selectedDeliveryIDs.isEmpty)
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
#Preview("Uploads — Header") {
    UploadHeaderView(
        model: UploadPreviewFixtures.ready(),
        isPreviewMode: true,
        confirmingSelectedPublication: .constant(false)
    )
    .padding()
    .frame(width: 1_200, height: 240)
}
#endif
