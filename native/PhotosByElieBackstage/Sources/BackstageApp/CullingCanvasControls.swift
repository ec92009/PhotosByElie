import OwnerCore
import SwiftUI

/// Production Culling scope controls kept source-selectable in Xcode Canvas.
struct CullingSearchControls: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
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
                .backstageHelp("Open Review with the assets currently picked in this fixture.")
            Button("Select burst") { model.selectVisibleBurstCandidates() }
                .backstageHelp("Select likely duplicate frames in each visible capture burst while keeping the probable best frame unselected.")
        }
    }
}

#if DEBUG
#Preview("Culling — Controls") {
    CullingSearchControls(model: CullingPreviewFixtures.model())
        .padding()
        .frame(width: 900, height: 180)
}
#endif
