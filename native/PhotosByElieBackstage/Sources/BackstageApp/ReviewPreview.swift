import AppKit
import OwnerCore
import SwiftUI

#if DEBUG
@MainActor
enum ReviewPreviewFixtures {
    static func loaded(refreshing: Bool = false) -> BackstageViewModel {
        let model = BackstageViewModel()
        let items = sampleItems
        model.installFixtureTree(
            [FixtureNode(id: "fixture-expo", name: "Expo")],
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        model.reviewMode = .full
        model.reviewStateFilters = [.picked]
        model.fixtureReviewWindow = FixtureReviewWindow(
            fixtureID: "fixture-expo",
            mode: .full,
            offset: 0,
            limit: 200,
            nextOffset: items.count,
            hasNext: true,
            countryWriteEnabled: true,
            summary: FixtureReviewSummary(
                total: 1_825,
                unreviewed: 1_631,
                requestingAI: 0,
                proposed: 194,
                approved: 0,
                countryMissing: 1_012
            ),
            items: items
        )
        model.reviewSelection = OwnerSelectionModel(
            orderedIDs: items.map(\.id),
            selectedIDs: ["review-1"],
            anchorID: "review-1",
            focusedID: "review-1"
        )
        model.reviewTitle = items[0].proposedTitle
        model.reviewKeywords = items[0].proposedKeywords.joined(separator: ", ")
        model.reviewCountry = items[0].proposedCountry
        model.reviewProposalDrafts["review-1"] = ReviewMetadataDraft(
            country: items[0].proposedCountry,
            title: items[0].proposedTitle,
            keywords: items[0].proposedKeywords,
            proposalID: items[0].proposalID,
            proposalReason: items[0].proposalReason,
            proposalStatus: items[0].proposalStatus
        )
        model.reviewStatus = refreshing
            ? "Refreshing Review while retaining the last complete queue."
            : "1,825 Picked items • oldest first."
        model.aiProposalStatus = "No requested AI work is waiting."
        model.isRunningReview = refreshing
        model.reviewThumbnails = Dictionary(
            uniqueKeysWithValues: items.enumerated().map { index, item in
                (item.id, placeholderImage(index: index))
            }
        )
        return model
    }

    static func loading() -> BackstageViewModel {
        let model = BackstageViewModel()
        model.installFixtureTree(
            [FixtureNode(id: "fixture-expo", name: "Expo")],
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        model.fixtureReviewWindow = nil
        model.isRunningReview = true
        model.reviewStatus = "Loading the oldest unresolved picked photos…"
        model.aiProposalStatus = "Checking requested AI work…"
        return model
    }

    static func empty() -> BackstageViewModel {
        let model = BackstageViewModel()
        model.installFixtureTree(
            [FixtureNode(id: "fixture-expo", name: "Expo")],
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        model.fixtureReviewWindow = FixtureReviewWindow(
            fixtureID: "fixture-expo",
            mode: .full,
            offset: 0,
            limit: 200,
            nextOffset: 0,
            hasNext: false,
            summary: FixtureReviewSummary(
                total: 0,
                unreviewed: 0,
                requestingAI: 0,
                proposed: 0,
                approved: 0
            ),
            items: []
        )
        model.reviewStatus = "0 Picked items • oldest first."
        model.aiProposalStatus = "No requested AI work is waiting."
        return model
    }

    private static let sampleItems = [
        FixtureReviewItem(
            id: "review-1",
            photoLibraryIdentifier: "review-1",
            title: "Paris, Musee Carnavalet",
            keywords: ["Paris", "Musee Carnavalet"],
            country: "france",
            suggestedCountry: "france",
            countrySuggestionSource: "accepted assignment",
            filename: "20221216 164519 01061.jpg",
            capturedAt: "2022-12-17T00:45:19Z",
            editorialState: "proposed",
            proposalReady: true,
            proposalContextAvailable: true,
            proposalID: "proposal-1",
            proposedTitle: "Notre Dame Cathedral Model in Paris",
            proposedKeywords: [
                "Notre Dame Cathedral",
                "architectural model",
                "Paris",
                "museum display",
            ],
            proposedCountry: "france",
            countryProposalSource: "ai-vision-context",
            proposalReason: "A detailed architectural model is visible.",
            proposalStatus: "ready"
        ),
        FixtureReviewItem(
            id: "review-2",
            photoLibraryIdentifier: "review-2",
            title: "Paris, Musee Carnavalet",
            keywords: [],
            filename: "20221216 164540 01062.jpg",
            capturedAt: "2022-12-17T00:45:40Z"
        ),
        FixtureReviewItem(
            id: "review-3",
            photoLibraryIdentifier: "review-3",
            title: "Ornate Salon",
            keywords: ["Paris", "historic interior"],
            filename: "20221216 171225 01081.jpg",
            capturedAt: "2022-12-17T01:12:25Z",
            editorialState: "requesting-ai",
            aiReasons: ["Add details"]
        ),
    ]

    private static func placeholderImage(index: Int) -> NSImage {
        let palettes: [(NSColor, NSColor)] = [
            (.systemIndigo, .systemPurple),
            (.systemOrange, .systemPink),
            (.systemTeal, .systemBlue),
        ]
        let palette = palettes[index % palettes.count]
        let size = NSSize(width: 640, height: 420)
        return NSImage(size: size, flipped: false) { rect in
            NSGradient(starting: palette.0, ending: palette.1)?
                .draw(in: rect, angle: CGFloat(22 + index * 12))
            if let symbol = NSImage(
                systemSymbolName: "photo.on.rectangle.angled",
                accessibilityDescription: nil
            ) {
                let symbolRect = NSRect(
                    x: rect.midX - 55,
                    y: rect.midY - 55,
                    width: 110,
                    height: 110
                )
                symbol.draw(
                    in: symbolRect,
                    from: .zero,
                    operation: .sourceOver,
                    fraction: 0.82
                )
            }
            return true
        }
    }
}

#Preview("Review — Refreshing Last Good Window") {
    ReviewView(
        model: ReviewPreviewFixtures.loaded(refreshing: true),
        isPreviewMode: true
    )
    .frame(width: 1_200, height: 760)
}

#Preview("Review — Initial Loading") {
    ReviewView(
        model: ReviewPreviewFixtures.loading(),
        isPreviewMode: true
    )
    .frame(width: 1_200, height: 760)
}

#Preview("Review — Empty") {
    ReviewView(
        model: ReviewPreviewFixtures.empty(),
        isPreviewMode: true
    )
    .frame(width: 1_000, height: 700)
}

#endif
