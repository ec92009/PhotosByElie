import AppKit
import OwnerCore
import SwiftUI

#if DEBUG
@MainActor
enum LifecyclePreviewFixtures {
    enum Scenario {
        case mixedLargeCount
        case empty
        case loading
    }

    static func model(_ scenario: Scenario) -> BackstageViewModel {
        let model = BackstageViewModel(
            photoLibrary: LifecyclePreviewPhotoLibrary(),
            workflowRecoveryStore: nil,
            currentImageSizeCache: nil
        )
        switch scenario {
        case .mixedLargeCount:
            model.lifecycleItems = sampleItems
            model.lifecycleCountSummary = "3,546 recoverable • 6,110 active global tombstones"
            model.lifecycleStatus = "Preview-only mixed Waste Basket state. No lifecycle service is connected."
            model.selectedLifecycleIDs = [sampleItems[0].id, sampleItems[1].id]
            model.lifecycleThumbnails = [
                sampleItems[0].mediaID: placeholderImage(color: .systemOrange),
                sampleItems[1].mediaID: placeholderImage(color: .systemTeal),
                sampleItems[3].mediaID: placeholderImage(color: .systemIndigo),
            ]
            model.lifecycleThumbnailFailures[sampleItems[2].mediaID] = .previewUnavailable
        case .empty:
            model.lifecycleItems = []
            model.lifecycleCountSummary = "0 recoverable • 0 active global tombstones"
            model.lifecycleStatus = "The Waste Basket is empty."
        case .loading:
            model.lifecycleItems = []
            model.lifecycleCountSummary = "Loading Waste Basket counts…"
            model.lifecycleStatus = "Loading the private lifecycle ledger…"
            model.isRunningLifecycle = true
        }
        return model
    }

    private static let sampleItems: [LifecycleItem] = [
        LifecycleItem(
            mediaID: "preview-recoverable-opera",
            state: "hidden",
            title: "Paris, Opera Garnier",
            filename: "20220505 0400 00135-Pano.jpg",
            capturedAt: "2022-05-05T11:00:53Z",
            photoLibraryIdentifier: "preview-opera",
            mediaType: "photo",
            sourceSlug: "fixture-expo",
            updatedAt: "2026-08-24T20:00:00Z"
        ),
        LifecycleItem(
            mediaID: "preview-recoverable-cascais",
            state: "hidden",
            title: "Cascais, Lisbon, Portugal",
            filename: "20220123 164137 00461.heic",
            capturedAt: "2022-01-23T16:41:37Z",
            photoLibraryIdentifier: "preview-cascais",
            mediaType: "photo",
            sourceSlug: "fixture-expo",
            updatedAt: "2026-08-24T19:09:45Z"
        ),
        LifecycleItem(
            mediaID: "preview-recoverable-failed",
            state: "hidden",
            title: "Preview failure is recoverable",
            filename: "IMG_4171.jpg",
            capturedAt: "2026-06-23T09:14:21Z",
            photoLibraryIdentifier: "preview-failed",
            mediaType: "photo",
            sourceSlug: "fixture-expo",
            updatedAt: "2026-08-02T09:25:39Z"
        ),
        LifecycleItem(
            mediaID: "preview-tombstone",
            state: "discarded",
            title: "Active tombstone example",
            filename: "IMG_4053.jpg",
            capturedAt: "2026-06-18T13:58:20Z",
            photoLibraryIdentifier: "preview-tombstone",
            mediaType: "photo",
            sourceSlug: "fixture-expo",
            updatedAt: "2026-07-21T20:02:31Z"
        ),
    ]

    private static func placeholderImage(color: NSColor) -> NSImage {
        NSImage(size: NSSize(width: 160, height: 120), flipped: false) { rect in
            color.setFill()
            rect.fill()
            return true
        }
    }
}

private struct LifecyclePreviewPhotoLibrary: PhotoLibraryServing, @unchecked Sendable {
    func authorization() -> PhotoLibraryAccess { .authorized }
    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }
    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        throw PhotoLibraryError.previewUnavailable(localIdentifier)
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.exportFailed("Lifecycle Canvas previews never export originals.")
    }
}

#Preview("Waste Basket — Mixed, large count, and failed preview") {
    LifecycleView(
        model: LifecyclePreviewFixtures.model(.mixedLargeCount),
        isPreviewMode: true
    )
    .frame(width: 1_200, height: 760)
}

#Preview("Waste Basket — Empty") {
    LifecycleView(
        model: LifecyclePreviewFixtures.model(.empty),
        isPreviewMode: true
    )
    .frame(width: 1_000, height: 680)
}

#Preview("Waste Basket — Loading") {
    LifecycleView(
        model: LifecyclePreviewFixtures.model(.loading),
        isPreviewMode: true
    )
    .frame(width: 1_000, height: 680)
}
#endif
