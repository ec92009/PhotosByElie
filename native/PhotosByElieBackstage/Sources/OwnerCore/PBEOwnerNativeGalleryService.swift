import Foundation

public struct PBEOwnerNativeGallerySummary: Codable, Sendable, Equatable {
    public var filtered: Int
    public var universe: Int
    public var undecided: Int
    public var picked: Int
    public var hidden: Int
}

public struct PBEOwnerNativeGalleryMediaAvailability: Codable, Sendable, Equatable {
    public var photos: Int
    public var videos: Int
}

public struct PBEOwnerNativeGalleryItem: Codable, Sendable, Equatable {
    public var assetId: String
    public var photoLibraryIdentifier: String
    public var title: String
    public var filename: String
    public var mediaType: String
    public var capturedAt: String
    public var locationLabel: String
    public var pixelWidth: Int
    public var pixelHeight: Int
    public var resourceFormat: String
    public var originalByteCount: Int64
    public var placementState: String
    public var eligibilityState: String
    public var rating: Int
    public var color: String
    public var editorialState: String
    public var keywords: [String]

    public init(
        assetId: String,
        photoLibraryIdentifier: String,
        title: String,
        filename: String,
        mediaType: String,
        capturedAt: String,
        locationLabel: String,
        pixelWidth: Int,
        pixelHeight: Int,
        resourceFormat: String,
        originalByteCount: Int64,
        placementState: String,
        eligibilityState: String,
        rating: Int,
        color: String,
        editorialState: String,
        keywords: [String]
    ) {
        self.assetId = assetId
        self.photoLibraryIdentifier = photoLibraryIdentifier
        self.title = title
        self.filename = filename
        self.mediaType = mediaType
        self.capturedAt = capturedAt
        self.locationLabel = locationLabel
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.resourceFormat = resourceFormat
        self.originalByteCount = originalByteCount
        self.placementState = placementState
        self.eligibilityState = eligibilityState
        self.rating = rating
        self.color = color
        self.editorialState = editorialState
        self.keywords = keywords
    }

    init(_ item: FixtureAsset) {
        assetId = item.id
        photoLibraryIdentifier = item.photoLibraryIdentifier
        title = item.title
        filename = item.filename
        mediaType = item.mediaType
        capturedAt = item.capturedAt
        locationLabel = item.locationLabel
        pixelWidth = item.pixelWidth
        pixelHeight = item.pixelHeight
        resourceFormat = item.resourceFormat
        originalByteCount = item.originalByteCount
        placementState = item.placementState.rawValue
        eligibilityState = item.eligibilityState
        rating = item.rating
        color = item.color
        editorialState = item.editorialState
        keywords = item.keywords
    }
}

public struct PBEOwnerNativeGallery: Codable, Sendable, Equatable {
    public var ok: Bool
    public var readOnly: Bool
    public var fixtureId: String
    public var fixtureBreadcrumb: String
    public var candidateMode: String
    public var view: String
    public var offset: Int
    public var limit: Int
    public var count: Int
    public var nextOffset: Int
    public var hasNext: Bool
    public var truncated: Bool
    public var summary: PBEOwnerNativeGallerySummary
    public var mediaAvailability: PBEOwnerNativeGalleryMediaAvailability?
    public var items: [PBEOwnerNativeGalleryItem]
}

/// Produces the only gallery window exposed by the PBB-114 native host.
/// The window is fixed to the active lease's picked and fixture-hidden still
/// photos so the browser can expose an explicit Hidden view and clear either
/// decision. It is read directly from Owner.sqlite without creating a
/// connector action.
public struct PBEOwnerNativeGalleryService: Sendable {
    public let ownerDatabaseURL: URL
    public let busyTimeoutMilliseconds: Int32
    private let cache: PBEOwnerNativeGalleryCache

    public init(ownerDatabaseURL: URL, busyTimeoutMilliseconds: Int32 = 2_000) {
        self.ownerDatabaseURL = ownerDatabaseURL.standardizedFileURL.resolvingSymlinksInPath()
        self.busyTimeoutMilliseconds = max(0, busyTimeoutMilliseconds)
        self.cache = PBEOwnerNativeGalleryCache()
    }

    public init(dataRoot: URL, busyTimeoutMilliseconds: Int32 = 2_000) {
        self.init(
            ownerDatabaseURL: dataRoot.appendingPathComponent(
                "assets/owner-actions/Owner.sqlite",
                isDirectory: false
            ),
            busyTimeoutMilliseconds: busyTimeoutMilliseconds
        )
    }

    public func gallery(session: PBEOwnerSessionContract) async throws -> PBEOwnerNativeGallery {
        try await cache.gallery(session: session) {
            let service = self
            return try await Task.detached(priority: .userInitiated) {
                try service.gallerySynchronously(session: session)
            }.value
        }
    }

    public func provider() -> @Sendable (PBEOwnerSessionContract) async throws -> PBEOwnerNativeGallery {
        { session in try await self.gallery(session: session) }
    }

    private func gallerySynchronously(
        session: PBEOwnerSessionContract
    ) throws -> PBEOwnerNativeGallery {
        let fixtureID = session.fixtureId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !fixtureID.isEmpty else {
            throw failure("pbe_owner_fixture_required", 400)
        }
        let window: FixtureCullingWindow
        do {
            window = try OwnerCullingSQLiteStore(
                databaseURL: ownerDatabaseURL,
                busyTimeoutMilliseconds: busyTimeoutMilliseconds
            ).cullingWindow(
                fixtureID: fixtureID,
                view: .picked,
                views: [.picked, .hidden],
                offset: 0,
                limit: 500,
                mediaTypes: ["photo"]
            )
        } catch {
            throw failure("pbe_owner_fixture_unavailable", 409)
        }
        guard window.fixtureID == fixtureID else {
            throw failure("pbe_owner_session_mismatch", 409)
        }
        let breadcrumb = session.fixtureBreadcrumb
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return PBEOwnerNativeGallery(
            ok: true,
            readOnly: true,
            fixtureId: fixtureID,
            fixtureBreadcrumb: breadcrumb.isEmpty ? fixtureID : breadcrumb,
            candidateMode: window.candidateMode,
            view: window.view.rawValue,
            offset: window.offset,
            limit: window.limit,
            count: window.items.count,
            nextOffset: window.nextOffset,
            hasNext: window.hasNext,
            truncated: window.hasNext,
            summary: .init(
                filtered: window.summary.filtered,
                universe: window.summary.universe,
                undecided: window.summary.undecided,
                picked: window.summary.picked,
                hidden: window.summary.hidden
            ),
            mediaAvailability: window.mediaAvailability.map {
                .init(photos: $0.photos, videos: $0.videos)
            },
            items: window.items.map(PBEOwnerNativeGalleryItem.init)
        )
    }

    private func failure(
        _ code: String,
        _ statusCode: Int
    ) -> PBEOwnerNativeSessionFailure {
        PBEOwnerNativeSessionFailure(
            code: code,
            statusCode: statusCode,
            message: "The frozen fixture gallery is unavailable; Owner actions are disabled."
        )
    }
}

/// A PBE Owner session freezes one exact gallery revision. Reuse that snapshot
/// for the browser payload, card previews, and action authorization so opening
/// a page cannot repeatedly scan the large Owner database before serving its
/// first thumbnails.
private actor PBEOwnerNativeGalleryCache {
    private var galleries: [String: Task<PBEOwnerNativeGallery, Error>] = [:]

    func gallery(
        session: PBEOwnerSessionContract,
        loader: @escaping @Sendable () async throws -> PBEOwnerNativeGallery
    ) async throws -> PBEOwnerNativeGallery {
        let key = [session.id, session.fixtureId, session.fixtureRevision]
            .joined(separator: "\u{1f}")
        if let existing = galleries[key] {
            return try await existing.value
        }
        let task = Task { try await loader() }
        galleries[key] = task
        do {
            return try await task.value
        } catch {
            galleries[key] = nil
            throw error
        }
    }
}
