import AppKit
import OwnerCore
import SwiftUI

#if DEBUG
@MainActor
enum UploadPreviewFixtures {
    static func ready() -> BackstageViewModel {
        let model = BackstageViewModel()
        let items = sampleItems
        model.installFixtureTree(
            [FixtureNode(id: "fixture-expo", name: "Expo")],
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        model.nativeUploadPlan = NativeUploadPlan(
            fixtureID: "fixture-expo",
            fixtureName: "Expo",
            cloudAllowed: true,
            pickedCount: 2_548,
            approvedCount: 847,
            needsReviewCount: 1_701,
            needsUploadCount: 4,
            liveCount: 843,
            offset: 0,
            limit: 200,
            hasNext: false,
            items: items
        )
        model.selectedDeliveryIDs = [items[0].id]
        model.nativeUploadStatus = "4 approved need upload • 843 live • showing the complete eligible window."
        model.nativeUploadThumbnails = Dictionary(
            uniqueKeysWithValues: items.enumerated().map { index, item in
                (item.id, placeholderImage(index: index))
            }
        )
        return model
    }

    static func empty() -> BackstageViewModel {
        let model = BackstageViewModel()
        model.installFixtureTree(
            [FixtureNode(id: "fixture-expo", name: "Expo")],
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        model.nativeUploadPlan = NativeUploadPlan(
            fixtureID: "fixture-expo",
            fixtureName: "Expo",
            cloudAllowed: true,
            pickedCount: 2_548,
            approvedCount: 847,
            needsReviewCount: 1_701,
            needsUploadCount: 0,
            liveCount: 847,
            offset: 0,
            limit: 200,
            hasNext: false,
            items: []
        )
        model.nativeUploadStatus = "847 approved • 847 live • nothing needs upload."
        return model
    }

    private static let sampleItems = [
        NativeUploadPlanItem(
            assetID: "upload-1",
            photoLibraryIdentifier: "upload-1",
            title: "Ronda Bridge at Dusk",
            keywords: ["Ronda", "Puente Nuevo", "blue hour"],
            filename: "IMG_4855.jpg",
            capturedAt: "2024-09-18T19:42:31Z",
            deliveryState: "needs-upload",
            errorText: ""
        ),
        NativeUploadPlanItem(
            assetID: "upload-2",
            photoLibraryIdentifier: "upload-2",
            title: "Golden Hour Over the Mediterranean",
            keywords: ["Mediterranean", "golden hour", "coast"],
            filename: "IMG_3982.jpg",
            capturedAt: "2024-09-20T18:06:14Z",
            deliveryState: "needs-upload",
            errorText: ""
        ),
        NativeUploadPlanItem(
            assetID: "upload-3",
            photoLibraryIdentifier: "upload-3",
            title: "Ornate Gallery Interior",
            keywords: ["Paris", "museum", "historic interior"],
            filename: "20221216 171225 01081.jpg",
            capturedAt: "2022-12-17T01:12:25Z",
            deliveryState: "needs-upload",
            errorText: ""
        ),
        NativeUploadPlanItem(
            assetID: "upload-4",
            photoLibraryIdentifier: "upload-4",
            title: "Palm-lined Promenade",
            keywords: ["promenade", "palm trees", "Spain"],
            filename: "IMG_4047.jpg",
            capturedAt: "2024-09-21T09:14:52Z",
            deliveryState: "needs-upload",
            errorText: ""
        ),
    ]

    private static func placeholderImage(index: Int) -> NSImage {
        let palettes: [(NSColor, NSColor)] = [
            (.systemIndigo, .systemPurple),
            (.systemOrange, .systemPink),
            (.systemTeal, .systemBlue),
            (.systemYellow, .systemOrange),
        ]
        let palette = palettes[index % palettes.count]
        let size = NSSize(width: 640, height: 420)
        return NSImage(size: size, flipped: false) { rect in
            NSGradient(starting: palette.0, ending: palette.1)?
                .draw(in: rect, angle: CGFloat(20 + index * 12))
            return true
        }
    }
}

#Preview("Uploads — Empty") {
    UploadView(
        model: UploadPreviewFixtures.empty(),
        isPreviewMode: true
    )
    .frame(width: 1_200, height: 760)
}

#endif
