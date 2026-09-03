import AppKit
import OwnerCore

/// Cohesive runtime state for the Gallery workflow.
///
/// `BackstageViewModel` remains the SwiftUI composition boundary and continues
/// to expose the existing Gallery bindings. This holder owns asynchronous task
/// identity, thumbnail caches, scroll visibility, window generations, and
/// pending selection reveals so stale work cannot escape into other workflows.
struct BackstageGalleryWorkflowState {
    var filterTask: Task<Void, Never>?
    var backfillTask: Task<Void, Never>?
    var thumbnailTasks: [String: Task<Void, Never>] = [:]
    var thumbnailTaskTokens: [String: UUID] = [:]
    var thumbnailTimeoutTasks: [String: Task<Void, Never>] = [:]
    var thumbnailUpgradeTasks: [String: Task<Void, Never>] = [:]
    var thumbnailUpgradeTaskTokens: [String: UUID] = [:]
    var thumbnailUpgradeAttempts = Set<String>()
    var basicThumbnails: [String: NSImage] = [:]
    var thumbnailRecency: [String] = []
    var thumbnailBackfillTask: Task<Void, Never>?
    var thumbnailBackfillTaskToken: UUID?
    var pendingCurrentImageByteCounts: [String: Int64] = [:]
    var quickLookEquipmentByAssetID: [String: BackstageQuickLookEquipment] = [:]
    var currentImageSizeFlushTask: Task<Void, Never>?
    var thumbnailPreferredIdentifiers: [String: String] = [:]
    var wasteBasketPendingActions: [String: OwnerAction] = [:]
    var wasteBasketPendingActionOrder: [String] = []
    var stableWindowIndexes: [String: Int] = [:]
    var visibleAssetIDs = Set<String>()
    var isScrolling = false
    var shouldInjectNextThumbnailFailure: Bool
    var controlledFailedAssetID: String?

    private(set) var windowRequestSerial = 0
    private var pendingRevealIDs: [String] = []
    private var pendingRevealSource = ""

    init(injectNextThumbnailFailure: Bool = false) {
        shouldInjectNextThumbnailFailure = injectNextThumbnailFailure
    }

    mutating func invalidateWindowRequests() {
        windowRequestSerial += 1
    }

    mutating func beginWindowRequest() -> Int {
        windowRequestSerial += 1
        return windowRequestSerial
    }

    func ownsWindowRequest(_ serial: Int) -> Bool {
        serial == windowRequestSerial
    }

    mutating func queueReveal(ids: [String], source: String) {
        pendingRevealIDs = ids
        pendingRevealSource = source
    }

    mutating func takePendingReveal() -> (ids: [String], source: String)? {
        guard !pendingRevealIDs.isEmpty else { return nil }
        defer {
            pendingRevealIDs = []
            pendingRevealSource = ""
        }
        return (pendingRevealIDs, pendingRevealSource)
    }

    func thumbnailBackfillAssets(
        cullingAssets: [FixtureAsset],
        libraryItems: [PhotoLibraryItem],
        limit: Int
    ) -> [FixtureAsset] {
        let visible = cullingAssets.filter { visibleAssetIDs.contains($0.id) }
        let remaining = cullingAssets.filter { !visibleAssetIDs.contains($0.id) }
        let loadedPhotos = libraryItems
            .filter { !$0.mediaType.lowercased().contains("video") }
            .map {
                FixtureAsset(
                    id: $0.id,
                    title: "",
                    filename: $0.filename,
                    mediaType: $0.mediaType
                )
            }

        var seen = Set<String>()
        let ordered = (visible + remaining + loadedPhotos).filter { asset in
            !asset.id.isEmpty && seen.insert(asset.id).inserted
        }
        return Array(ordered.prefix(limit))
    }

    func savedViewPreset(
        _ savedView: GallerySavedView
    ) -> (
        views: Set<FixtureCullingView>,
        editorial: Set<GalleryEditorialFilter>,
        delivery: Set<GalleryDeliveryFilter>,
        sources: Set<GallerySourceFilter>
    ) {
        let allViews = Set(FixtureCullingView.selectableCases)
        let allSources = Set(GallerySourceFilter.allCases)
        return switch savedView {
        case .allAssets:
            (allViews, [], [], allSources)
        case .culling:
            ([.undecided], [], [], [.available])
        case .reviewQueue:
            ([.picked], [.needsReview, .aiRequested, .proposalAvailable], [], [.available])
        case .approved:
            ([.picked], [.approved], [], [.available])
        case .uploadQueue:
            ([.picked], [.approved], [.needsUpload, .uploading, .failed], [.available])
        case .live:
            ([.picked], [], [.live], [.available])
        case .hidden:
            ([.hidden], [], [], [.available])
        case .unavailable:
            (allViews, [], [], [.unavailable])
        }
    }

    static func adjustSummary(
        _ window: inout FixtureCullingWindow,
        for items: [FixtureAsset],
        delta: Int
    ) {
        guard !items.isEmpty else { return }
        window.summary.filtered = max(0, window.summary.filtered + (items.count * delta))
        window.summary.universe = max(0, window.summary.universe + (items.count * delta))
        for item in items {
            switch item.placementState {
            case .undecided:
                window.summary.undecided = max(0, window.summary.undecided + delta)
            case .picked:
                window.summary.picked = max(0, window.summary.picked + delta)
            case .hidden:
                window.summary.hidden = max(0, window.summary.hidden + delta)
            }
        }
    }

    static func basicThumbnail(from image: NSImage) -> NSImage {
        let longest = max(image.size.width, image.size.height)
        guard longest > 180 else { return image }
        let scale = 180 / longest
        let width = max(1, Int(image.size.width * scale))
        let height = max(1, Int(image.size.height * scale))
        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0
        ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return image }
        let size = NSSize(width: width, height: height)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        image.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        let thumbnail = NSImage(size: size)
        thumbnail.addRepresentation(bitmap)
        return thumbnail
    }
}
