import SwiftUI

/// Production title and keyword editor kept source-selectable in Xcode Canvas.
struct ReviewTitleKeywordEditor: View {
    @ObservedObject var model: BackstageViewModel

    private let countries = [
        ("", "Unknown"),
        ("france", "France"),
        ("italy", "Italy"),
        ("mexico", "Mexico"),
        ("portugal", "Portugal"),
        ("slovakia", "Slovakia"),
        ("spain", "Spain"),
        ("usa", "USA"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .center, spacing: 8) {
                    Picker(
                        "Country",
                        selection: Binding(
                            get: { model.reviewCountry },
                            set: { model.updateReviewCountry($0) }
                        )
                    ) {
                        ForEach(countries, id: \.0) { country in
                            Text(country.1).tag(country.0)
                        }
                    }
                    .pickerStyle(.menu)
                    .disabled(
                        model.isRunningReview
                            || model.fixtureReviewWindow?.countryWriteEnabled != true
                    )
                    Button {
                        Task { await model.propagateReviewCountry() }
                    } label: {
                        Image(systemName: "arrow.down")
                    }
                    .disabled(
                        model.isRunningReview
                            || model.fixtureReviewWindow?.countryWriteEnabled != true
                    )
                    .accessibilityLabel("Propagate country through the active two-hour shoot scope")
                    .backstageHelp("Propagate country through the active two-hour shoot scope.")
                }
                if let item = model.focusedReviewItem {
                    let accepted = item.country.isEmpty ? "Unknown" : item.country.capitalized
                    let suggestion = item.suggestedCountry.isEmpty
                        ? ""
                        : " · Suggested: \(item.suggestedCountry.capitalized) via \(item.countrySuggestionSource)"
                    let proposal = item.proposedCountry.isEmpty
                        ? ""
                        : " · AI proposal: \(item.proposedCountry.capitalized)"
                    Text("Accepted: \(accepted)\(suggestion)\(proposal)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if model.fixtureReviewWindow?.countryWriteEnabled != true,
                   let reason = model.fixtureReviewWindow?.countryWriteBlockReason,
                   !reason.isEmpty {
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
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
