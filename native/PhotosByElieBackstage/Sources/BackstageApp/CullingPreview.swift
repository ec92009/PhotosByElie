import AppKit
import OwnerCore
import SwiftUI

#if DEBUG
@MainActor
enum CullingPreviewFixtures {
    static func model(
        previewPanelVisible: Bool = true,
        loading: Bool = false,
        missingThumbnail: Bool = false,
        failedThumbnail: Bool = false
    ) -> BackstageViewModel {
        // Canvas previews must never reach the user's Photos library. The
        // fixture still exercises the real BackstageViewModel retry path, but
        // the injected service keeps every preview request synthetic.
        let model = BackstageViewModel(photoLibrary: PreviewPhotoLibrary())
        let assets = sampleAssets

        model.installFixtureTree([
            FixtureNode(
                id: "fixture-expo",
                name: "Expo",
                children: [
                    FixtureNode(
                        id: "fixture-france",
                        name: "France",
                        parentID: "fixture-expo"
                    )
                ]
            ),
            FixtureNode(id: "fixture-re", name: "RE"),
        ], preferredFixtureID: "fixture-expo", persistSelection: false)
        model.cullingPool = FixturePool(
            id: "pool-preview",
            name: "Expo",
            fixtureID: "fixture-expo",
            assetCount: 52_343,
            snapshotHash: "preview-only",
            assets: assets
        )
        model.cullingViews = Set(FixtureCullingView.selectableCases)
        model.cullingStates = [
            "expo-2": SidecarDecisionState(
                assetId: "expo-2",
                rating: 4,
                color: "green",
                pickState: "picked"
            ),
            "expo-5": SidecarDecisionState(
                assetId: "expo-5",
                rating: 2,
                color: "red",
                pickState: "rejected"
            ),
            "expo-7": SidecarDecisionState(
                assetId: "expo-7",
                rating: 5,
                color: "blue",
                pickState: "picked"
            ),
        ]
        model.cullingThumbnails = Dictionary(
            uniqueKeysWithValues: assets.enumerated().map { index, asset in
                (asset.id, placeholderImage(index: index))
            }
        )
        if missingThumbnail {
            model.cullingThumbnails["expo-1"] = nil
        }
        if failedThumbnail {
            model.cullingThumbnails["expo-1"] = nil
            model.cullingThumbnailFailures["expo-1"] = .previewUnavailable
        }
        model.cullingSelection = OwnerSelectionModel(
            orderedIDs: assets.map(\.id),
            selectedIDs: ["expo-3"],
            anchorID: "expo-3",
            focusedID: "expo-3"
        )
        model.isPreviewPanelVisible = previewPanelVisible
        model.isLoadingFixtureCulling = loading
        model.photoStatus = loading
            ? "Applying Culling filters…"
            : "Complete fixture scope loaded from the Owner index."
        model.cullingStatus = loading
            ? "Applying filters without displaying stale items."
            : "Preview data only. No Photos or Owner state is connected."

        if previewPanelVisible, let image = model.cullingThumbnails["expo-3"],
           let jpegData = jpegData(for: image) {
            model.photoPreview = PhotoPreview(
                assetID: "expo-3",
                jpegData: jpegData,
                pixelWidth: 6048,
                pixelHeight: 4024
            )
        }
        return model
    }

    private static let sampleAssets: [FixturePoolAsset] = [
        FixturePoolAsset(
            id: "expo-1",
            position: 0,
            title: "Golden Hour Over the Mediterranean",
            filename: "IMG_3982.jpg",
            mediaType: "photo"
        ),
        FixturePoolAsset(
            id: "expo-2",
            position: 1,
            title: "Palm-lined Promenade",
            filename: "IMG_4047.jpg",
            mediaType: "photo"
        ),
        FixturePoolAsset(
            id: "expo-3",
            position: 2,
            title: "Ronda Bridge at Dusk",
            filename: "IMG_4855.jpg",
            mediaType: "photo"
        ),
        FixturePoolAsset(
            id: "expo-4",
            position: 3,
            title: "Ornate Gallery Interior",
            filename: "20221216 171225 01081.jpg",
            mediaType: "photo"
        ),
        FixturePoolAsset(
            id: "expo-5",
            position: 4,
            title: "Museum Study",
            filename: "IMG_4587.jpg",
            mediaType: "photo"
        ),
        FixturePoolAsset(
            id: "expo-6",
            position: 5,
            title: "Plaza at Blue Hour",
            filename: "D5H_3447.JPG",
            mediaType: "photo"
        ),
        FixturePoolAsset(
            id: "expo-7",
            position: 6,
            title: "City Walk",
            filename: "IMG_4262.MOV",
            mediaType: "video"
        ),
        FixturePoolAsset(
            id: "expo-8",
            position: 7,
            title: "Coastal Architecture",
            filename: "IMG_4412.jpg",
            mediaType: "photo"
        ),
    ]

    private static func placeholderImage(index: Int) -> NSImage {
        let palettes: [(NSColor, NSColor)] = [
            (.systemOrange, .systemPink),
            (.systemTeal, .systemBlue),
            (.systemIndigo, .systemPurple),
            (.systemYellow, .systemOrange),
            (.systemGray, .systemBrown),
        ]
        let palette = palettes[index % palettes.count]
        let size = NSSize(width: 640, height: 420)
        return NSImage(size: size, flipped: false) { rect in
            let gradient = NSGradient(starting: palette.0, ending: palette.1)
            gradient?.draw(in: rect, angle: CGFloat(18 + index * 11))

            let symbolName = index == 6 ? "video.fill" : "photo.on.rectangle.angled"
            if let symbol = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil) {
                let symbolSize = NSSize(width: 110, height: 110)
                let symbolRect = NSRect(
                    x: rect.midX - symbolSize.width / 2,
                    y: rect.midY - symbolSize.height / 2,
                    width: symbolSize.width,
                    height: symbolSize.height
                )
                NSColor.white.withAlphaComponent(0.82).set()
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

    private static func jpegData(for image: NSImage) -> Data? {
        guard let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff)
        else { return nil }
        return bitmap.representation(
            using: .jpeg,
            properties: [.compressionFactor: 0.82]
        )
    }
}

private struct PreviewPhotoLibrary: PhotoLibraryServing, @unchecked Sendable {
    private static let previewData = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!

    func authorization() -> PhotoLibraryAccess { .authorized }

    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }

    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        PhotoPreview(
            assetID: localIdentifier,
            jpegData: Self.previewData,
            pixelWidth: 1,
            pixelHeight: 1
        )
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.exportFailed("Canvas previews do not export Photos originals.")
    }
}

#Preview("Culling — Compact") {
    CullingView(
        model: CullingPreviewFixtures.model(previewPanelVisible: false),
        isPreviewMode: true
    )
    .frame(width: 900, height: 680)
}

#Preview("Culling — Applying Filters") {
    CullingView(
        model: CullingPreviewFixtures.model(loading: true),
        isPreviewMode: true
    )
    .frame(width: 1_200, height: 760)
}

#Preview("Culling — Thumbnail Pending") {
    CullingView(
        model: CullingPreviewFixtures.model(missingThumbnail: true),
        isPreviewMode: true
    )
    .frame(width: 1_200, height: 760)
}

#Preview("Culling — Thumbnail Failure") {
    CullingView(
        model: CullingPreviewFixtures.model(failedThumbnail: true),
        isPreviewMode: true
    )
    .frame(width: 1_200, height: 760)
}

#endif
