import OwnerCore
import SwiftUI

/// Production Gallery scope controls kept source-selectable in Xcode Canvas.
struct CullingSearchControls: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        FlowLayout(spacing: 8) {
            TextField("Search title, file, or keyword", text: $model.cullingSearch)
                .textFieldStyle(.roundedBorder)
                .frame(width: 240)
                .onSubmit { model.applyCullingFilters() }
            Menu("View: \(model.gallerySavedViewLabel)") {
                Button("All fixture assets") {
                    model.showAllFixtureAssetsInGallery()
                }
                .backstageHelp("Show Undecided, Picked, and Hidden assets in the current fixture Gallery.")
                Button("Culling — Undecided") {
                    model.showCullingSavedView()
                }
                .backstageHelp("Show the Culling saved view containing only Undecided assets.")
            }
            .accessibilityLabel("Gallery saved view")
            Button("Review picked") { model.showPickedReview() }
                .backstageHelp("Open Review with the assets currently picked in this fixture.")
            Button("Select burst") { model.selectVisibleBurstCandidates() }
                .backstageHelp("Select likely duplicate frames in each visible capture burst while keeping the probable best frame unselected.")
        }
    }
}

#if DEBUG
#Preview("Gallery — Controls") {
    CullingSearchControls(model: CullingPreviewFixtures.model())
        .padding()
        .frame(width: 900, height: 180)
}
#endif
