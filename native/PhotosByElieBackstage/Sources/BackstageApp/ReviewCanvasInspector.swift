import SwiftUI

/// Production title and keyword editor kept source-selectable in Xcode Canvas.
struct ReviewTitleKeywordEditor: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                TextField(
                    "Title",
                    text: Binding(
                        get: { model.reviewTitle },
                        set: { model.updateReviewTitle($0) }
                    ),
                    axis: .vertical
                )
                .textFieldStyle(.roundedBorder)
                Button {
                    Task { await model.propagateReviewTitle() }
                } label: {
                    Image(systemName: "arrow.down")
                }
                .disabled(model.isRunningReview)
                .backstageHelp("Copy the current title to the other selected Review items using the active propagation scope.")
            }
            HStack(alignment: .top, spacing: 8) {
                TextField(
                    "Keywords, comma separated",
                    text: Binding(
                        get: { model.reviewKeywords },
                        set: { model.updateReviewKeywords($0) }
                    ),
                    axis: .vertical
                )
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...7)
                Button {
                    Task { await model.propagateReviewKeywords() }
                } label: {
                    Image(systemName: "arrow.down")
                }
                .disabled(model.isRunningReview)
                .backstageHelp("Copy the current keywords to the other selected Review items using the active propagation scope.")
            }
        }
    }
}

#if DEBUG
#Preview("T/K — Inspector") {
    ReviewTitleKeywordEditor(model: ReviewPreviewFixtures.loaded())
        .padding()
        .frame(width: 520, height: 260)
}
#endif
