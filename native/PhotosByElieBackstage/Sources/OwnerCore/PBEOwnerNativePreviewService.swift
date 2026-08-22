import Foundation

public struct PBEOwnerNativePreview: Sendable, Equatable {
    public var assetId: String
    public var jpegData: Data
    public var pixelWidth: Int
    public var pixelHeight: Int

    public init(
        assetId: String,
        jpegData: Data,
        pixelWidth: Int,
        pixelHeight: Int
    ) {
        self.assetId = assetId
        self.jpegData = jpegData
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
    }
}

/// Resolves one browser-visible PBE Owner gallery item through Backstage's
/// in-process PhotoKit service. The Owner asset ID is never treated as a file
/// path, and only an item in the bounded frozen gallery window can be read.
public struct PBEOwnerNativePreviewService: Sendable {
    public typealias GalleryProvider = @Sendable (
        PBEOwnerSessionContract
    ) async throws -> PBEOwnerNativeGallery

    private let galleryProvider: GalleryProvider
    private let photoLibrary: any PhotoLibraryServing
    private let galleryCache: PBEOwnerNativePreviewGalleryCache
    private let requestPool: PBEOwnerNativePreviewRequestPool
    public let maxPixelSize: Int
    public let maximumPreviewBytes: Int

    public init(
        galleryProvider: @escaping GalleryProvider,
        photoLibrary: any PhotoLibraryServing = PhotoKitLibraryService(),
        maxPixelSize: Int = BackstagePreviewIPCConstants.maximumMaxPixel,
        maximumPreviewBytes: Int = BackstagePreviewIPCConstants.maximumPreviewBytes,
        maximumConcurrentPreviews: Int = 4
    ) {
        self.galleryProvider = galleryProvider
        self.photoLibrary = photoLibrary
        self.galleryCache = PBEOwnerNativePreviewGalleryCache()
        self.requestPool = PBEOwnerNativePreviewRequestPool(
            limit: maximumConcurrentPreviews
        )
        self.maxPixelSize = max(
            BackstagePreviewIPCConstants.minimumMaxPixel,
            min(BackstagePreviewIPCConstants.maximumMaxPixel, maxPixelSize)
        )
        self.maximumPreviewBytes = max(
            1,
            min(BackstagePreviewIPCConstants.maximumPreviewBytes, maximumPreviewBytes)
        )
    }

    public init(
        galleryService: PBEOwnerNativeGalleryService,
        photoLibrary: any PhotoLibraryServing = PhotoKitLibraryService(),
        maxPixelSize: Int = BackstagePreviewIPCConstants.maximumMaxPixel,
        maximumPreviewBytes: Int = BackstagePreviewIPCConstants.maximumPreviewBytes,
        maximumConcurrentPreviews: Int = 4
    ) {
        self.init(
            galleryProvider: galleryService.provider(),
            photoLibrary: photoLibrary,
            maxPixelSize: maxPixelSize,
            maximumPreviewBytes: maximumPreviewBytes,
            maximumConcurrentPreviews: maximumConcurrentPreviews
        )
    }

    public func provider() -> @Sendable (
        PBEOwnerSessionContract,
        String
    ) async throws -> PBEOwnerNativePreview {
        { session, assetID in
            try await self.preview(session: session, assetID: assetID)
        }
    }

    public func preview(
        session: PBEOwnerSessionContract,
        assetID: String
    ) async throws -> PBEOwnerNativePreview {
        let cleanAssetID = assetID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanAssetID.isEmpty,
              cleanAssetID == assetID,
              cleanAssetID.utf8.count <= BackstagePreviewIPCConstants.maximumAssetIDBytes,
              cleanAssetID.unicodeScalars.allSatisfy({
                  !CharacterSet.controlCharacters.contains($0)
              }) else {
            throw failure("pbe_owner_preview_asset_invalid", 400)
        }

        // The browser can ask for dozens of visible cards at once. Rebuilding
        // the same 500-item SQLite window for every card both wastes work and
        // delays later HTTP connections past their deadline. A frozen Owner
        // session is immutable, so one coalesced gallery read is authoritative
        // for every preview served by this host session.
        let gallery = try await galleryCache.gallery(
            session: session,
            provider: galleryProvider
        )
        guard gallery.fixtureId == session.fixtureId,
              let item = gallery.items.first(where: { $0.assetId == cleanAssetID }),
              item.mediaType.lowercased() == "photo" else {
            throw failure("pbe_owner_fixture_mismatch", 409)
        }
        let photosIdentifier = item.photoLibraryIdentifier
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !photosIdentifier.isEmpty else {
            throw failure("pbe_owner_preview_unavailable", 503)
        }

        let preview: PhotoPreview
        do {
            preview = try await requestPool.run {
                try await photoLibrary.renderedJPEGPreview(
                    localIdentifier: photosIdentifier,
                    maxPixelSize: maxPixelSize
                )
            }
        } catch let error as PhotoLibraryError {
            switch error {
            case .accessDenied:
                throw failure("pbe_owner_photos_access_required", 503)
            case .assetNotFound:
                throw failure("pbe_owner_preview_not_found", 404)
            default:
                throw failure("pbe_owner_preview_unavailable", 502)
            }
        } catch {
            throw failure("pbe_owner_preview_unavailable", 502)
        }

        guard preview.assetID == photosIdentifier,
              preview.pixelWidth > 0,
              preview.pixelHeight > 0,
              preview.pixelWidth <= maxPixelSize,
              preview.pixelHeight <= maxPixelSize,
              preview.jpegData.count <= maximumPreviewBytes,
              Self.isJPEG(preview.jpegData) else {
            throw failure("pbe_owner_preview_invalid", 502)
        }
        return PBEOwnerNativePreview(
            assetId: cleanAssetID,
            jpegData: preview.jpegData,
            pixelWidth: preview.pixelWidth,
            pixelHeight: preview.pixelHeight
        )
    }

    private static func isJPEG(_ data: Data) -> Bool {
        data.count >= 4
            && data[data.startIndex] == 0xff
            && data[data.index(after: data.startIndex)] == 0xd8
            && data[data.index(data.endIndex, offsetBy: -2)] == 0xff
            && data[data.index(before: data.endIndex)] == 0xd9
    }

    private func failure(
        _ code: String,
        _ statusCode: Int
    ) -> PBEOwnerNativeSessionFailure {
        PBEOwnerNativeSessionFailure(
            code: code,
            statusCode: statusCode,
            message: "The frozen fixture preview is unavailable; Owner actions are disabled."
        )
    }
}

private actor PBEOwnerNativePreviewGalleryCache {
    private var galleries: [String: Task<PBEOwnerNativeGallery, Error>] = [:]

    func gallery(
        session: PBEOwnerSessionContract,
        provider: @escaping PBEOwnerNativePreviewService.GalleryProvider
    ) async throws -> PBEOwnerNativeGallery {
        let key = [session.id, session.fixtureId, session.fixtureRevision]
            .joined(separator: "\u{1f}")
        if let existing = galleries[key] {
            return try await existing.value
        }
        let task = Task { try await provider(session) }
        galleries[key] = task
        do {
            return try await task.value
        } catch {
            galleries[key] = nil
            throw error
        }
    }
}

private actor PBEOwnerNativePreviewRequestPool {
    private let limit: Int
    private var active = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(limit: Int) {
        self.limit = max(1, min(8, limit))
    }

    func run<Value: Sendable>(
        _ operation: @escaping @Sendable () async throws -> Value
    ) async throws -> Value {
        if active < limit {
            active += 1
        } else {
            await withCheckedContinuation { continuation in
                waiters.append(continuation)
            }
        }
        defer { release() }
        return try await operation()
    }

    private func release() {
        if waiters.isEmpty {
            active = max(0, active - 1)
        } else {
            waiters.removeFirst().resume()
        }
    }
}
