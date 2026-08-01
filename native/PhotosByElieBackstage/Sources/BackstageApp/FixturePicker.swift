import SwiftUI

struct FixturePicker: View {
    @ObservedObject var model: BackstageViewModel
    var isPreviewMode = false

    var body: some View {
        Picker("Fixture", selection: $model.selectedFixtureID) {
            Text("Choose a fixture").tag("")
            ForEach(model.flatFixtures) { fixture in
                Text(fixture.name).tag(fixture.id)
            }
        }
        .frame(minWidth: 240)
        Button("Refresh fixtures") { Task { await model.loadFixtures() } }
            .disabled(model.isRunningFixture || isPreviewMode)
    }
}
