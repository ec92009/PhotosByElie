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
                ForEach(GallerySavedView.allCases) { savedView in
                    Button(savedView.rawValue) {
                        model.applyGallerySavedView(savedView)
                    }
                    .backstageHelp("Show \(savedView.rawValue.lowercased()) in Gallery without changing any fixture decisions.")
                }
            }
            .accessibilityLabel("Gallery saved view")
            Button("Review picked") { model.showPickedReview() }
                .backstageHelp("Open Review with the assets currently picked in this fixture.")
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
