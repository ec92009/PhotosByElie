import AppKit
import CryptoKit
import Foundation
import ImageIO
import Photos
import UniformTypeIdentifiers

public enum PhotoLibraryAccess: Sendable, Equatable {
    case notDetermined, denied, limited, authorized
}

public struct PhotoLibraryItem: Identifiable, Sendable, Equatable {
    public var id: String
    public var filename: String
    public var creationDate: Date?
    public var mediaType: String
}

public struct PhotoPreview: Sendable, Equatable {
    public var assetID: String
    public var jpegData: Data
    public var pixelWidth: Int
    public var pixelHeight: Int
    /// Byte count of complete accepted JPEG or HEIC data received directly
    /// from Photos before any preview downsampling or JPEG encoding. Nil when
    /// the preview came from a rendered `requestImage` raster or another
    /// partial path.
    public var currentImageByteCount: Int64?

    public init(
        assetID: String,
        jpegData: Data,
        pixelWidth: Int,
        pixelHeight: Int,
        currentImageByteCount: Int64? = nil
    ) {
        self.assetID = assetID
        self.jpegData = jpegData
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.currentImageByteCount = currentImageByteCount
    }
}

public struct PhotoExportReceipt: Sendable, Equatable {
    public var assetID: String
    public var filename: String
    public var destination: URL
    public var uniformTypeIdentifier: String
    public var byteCount: Int64
    public var checksumSHA256: String
}

public enum PhotoLibraryError: Error, Sendable, Equatable {
    case accessDenied
    case assetNotFound(String)
    case unsupportedMediaType(String)
    case resourceNotFound(String)
    case previewUnavailable(String)
    case exportFailed(String)
    case metadataFailed(String)
}

enum PhotoLibraryIdentifier {
    static let cloudPrefix = "apple-photos-cloud://"

    static func cloudValue(from identifier: String) -> String? {
        let value = identifier.hasPrefix(cloudPrefix)
            ? String(identifier.dropFirst(cloudPrefix.count))
            : identifier
        let components = value.split(separator: ":", omittingEmptySubsequences: false)
        guard components.count == 3,
              UUID(uuidString: String(components[0])) != nil,
              components[1].count == 3,
              components[1].allSatisfy(\.isNumber),
              (20...128).contains(components[2].count),
              components[2].unicodeScalars.allSatisfy({ scalar in
                  CharacterSet.alphanumerics.contains(scalar)
                      || scalar == "+"
                      || scalar == "/"
                      || scalar == "="
              })
        else { return nil }
        return value
    }
}

extension PhotoLibraryError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .accessDenied:
            return "Photos access is unavailable for Backstage. Choose Allow Photos or grant Full Access in System Settings."
        case .assetNotFound:
            return "This photo is unavailable in the current Photos library. Retry after Photos sync completes."
        case .unsupportedMediaType:
            return "Backstage source workflows accept still photos only."
        case .resourceNotFound:
            return "The original Photos resource is unavailable."
        case .previewUnavailable:
            return "Photos could not prepare this preview. Retry after a transient or iCloud download failure."
        case .exportFailed:
            return "Photos could not export this asset."
        case .metadataFailed(let message):
            return "Photos metadata automation failed: \(message)"
        }
    }
}

public protocol PhotoLibraryServing: Sendable {
    func authorization() -> PhotoLibraryAccess
    func requestAuthorization() async -> PhotoLibraryAccess
    func fetch(limit: Int) async -> [PhotoLibraryItem]
    func libraryIndex(limit: Int, offset: Int, dateFrom: Date?, dateTo: Date?) async throws -> Data
    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview
    func cullingPreview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview
    func renderedJPEGPreview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview
    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt
    func exportOriginal(
        localIdentifier: String,
        to directory: URL,
        allowICloudDownloads: Bool
    ) async throws -> PhotoExportReceipt
    func metadataReadMany(assetIDs: [String]) async throws -> Data
    func metadataApplyMany(requests: [PhotoMetadataApplyRequest]) async throws -> Data
}

public extension PhotoLibraryServing {
    func cullingPreview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        try await preview(localIdentifier: localIdentifier, maxPixelSize: maxPixelSize)
    }

    func renderedJPEGPreview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        try await preview(localIdentifier: localIdentifier, maxPixelSize: maxPixelSize)
    }

    func exportOriginal(
        localIdentifier: String,
        to directory: URL,
        allowICloudDownloads: Bool
    ) async throws -> PhotoExportReceipt {
        try await exportOriginal(localIdentifier: localIdentifier, to: directory)
    }

    func metadataReadMany(assetIDs: [String]) async throws -> Data {
        throw PhotoLibraryError.metadataFailed("This Photos library service does not provide metadata read-back.")
    }

    func metadataApplyMany(requests: [PhotoMetadataApplyRequest]) async throws -> Data {
        throw PhotoLibraryError.metadataFailed("This Photos library service does not provide metadata apply.")
    }

    func libraryIndex(limit: Int, offset: Int, dateFrom: Date?, dateTo: Date?) async throws -> Data {
        let safeLimit = max(1, min(1_000, limit))
        let safeOffset = max(0, offset)
        let fetched = await fetch(limit: min(5_000, safeOffset + safeLimit))
        let items = fetched.dropFirst(safeOffset).prefix(safeLimit).enumerated().map { index, item in
            [
                "index": safeOffset + index + 1,
                "assetId": item.id,
                "cloudIdentifier": "",
                "localIdentifier": item.id,
                "sourceAnchor": "apple-photos://\(item.id)",
                "localSourceAnchor": "apple-photos://\(item.id)",
                "filename": item.filename,
                "mediaType": item.mediaType,
                "creationDate": photoLibraryISODate(item.creationDate),
                "modificationDate": "",
                "pixelWidth": 0,
                "pixelHeight": 0,
                "duration": 0,
                "favorite": false,
                "hidden": false,
                "resourceFormat": "Unknown",
                "resourceFormats": [String](),
                "resourceFormatCounts": [String: Int](),
                "preferredResourceFilename": item.filename,
                "preferredResourceFormat": "",
                "fallbackResourceFilename": "",
                "fallbackResourceFormat": "",
                "localJPEGFallbackAvailable": false,
                "eligible": item.mediaType == "photo",
                "exportStrategy": item.mediaType == "photo" ? "rendered_jpeg" : "unsupported",
                "status": item.mediaType == "photo" ? "candidate" : "unsupported",
                "reason": item.mediaType == "photo" ? "Photos still image will import as the current rendered JPG from Photos." : "",
            ] as [String: Any]
        }
        let payload: [String: Any] = [
            "ok": true,
            "mode": "library-index",
            "limit": safeLimit,
            "offset": safeOffset,
            "count": items.count,
            "fetchedCount": fetched.count,
            "skippedCount": min(safeOffset, fetched.count),
            "dateFrom": photoLibraryISODate(dateFrom),
            "dateTo": photoLibraryISODate(dateTo),
            "items": items,
            "notes": [
                "Uses the PhotoLibraryServing implementation owned by Backstage.",
                "Sidecar culling decisions are local-first. Photos keyword/title write-back is staged separately.",
            ],
        ]
        return try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    }
}

public struct PhotoKitLibraryService: PhotoLibraryServing, @unchecked Sendable {
    private static let thumbnailRequestMaxPixelSize = 900
    private static let thumbnailRequestTimeout = Duration.seconds(10)
    private static let cullingJPEGRequestTimeout = Duration.seconds(10)
    private static let fullPreviewRequestTimeout = Duration.seconds(55)

    public init() {}

    public func authorization() -> PhotoLibraryAccess {
        map(PHPhotoLibrary.authorizationStatus(for: .readWrite))
    }

    public func requestAuthorization() async -> PhotoLibraryAccess {
        await withCheckedContinuation { continuation in
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
                continuation.resume(returning: map(status))
            }
        }
    }

    public func fetch(limit: Int = 200) async -> [PhotoLibraryItem] {
        guard [.authorized, .limited].contains(authorization()) else { return [] }
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        // Backstage source intake is still-photo only. Real-estate videos are
        // generated deliverables built from approved stills and do not belong
        // in the PhotoKit culling/preview universe. A RAW-only PHAsset also
        // stays out: PBB/PBE accept a JPEG or HEIC source that Photos can
        // safely render as the JPG consumed by the apps.
        let result = PHAsset.fetchAssets(with: .image, options: options)
        var items: [PhotoLibraryItem] = []
        result.enumerateObjects { asset, _, stop in
            guard let acceptedSource = preferredAcceptedStillResource(for: asset) else {
                return
            }
            items.append(PhotoLibraryItem(
                id: asset.localIdentifier,
                filename: renderedJPEGFilename(acceptedSource, index: items.count + 1),
                creationDate: asset.creationDate,
                mediaType: asset.mediaType == .video ? "video" : "photo"
            ))
            if items.count >= max(1, min(5_000, limit)) { stop.pointee = true }
        }
        return items
    }

    public func libraryIndex(
        limit: Int,
        offset: Int,
        dateFrom: Date?,
        dateTo: Date?
    ) async throws -> Data {
        try requireAccess()
        let safeLimit = max(1, min(1_000, limit))
        let safeOffset = max(0, min(1_000_000, offset))
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        var predicates: [NSPredicate] = []
        if let dateFrom {
            predicates.append(NSPredicate(format: "creationDate >= %@", dateFrom as NSDate))
        }
        if let dateTo {
            predicates.append(NSPredicate(format: "creationDate <= %@", dateTo as NSDate))
        }
        if !predicates.isEmpty {
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
        }
        // Backstage source intake is still-photo only. Generated real-estate
        // videos are downstream deliverables and never enter this index. A
        // RAW-only PHAsset is excluded because PBB/PBE require a JPEG or HEIC
        // source that Photos can render safely as JPG.
        let assets = PHAsset.fetchAssets(with: .image, options: options)
        // Filter before applying offset/limit. Applying pagination to the raw
        // Photos result first would make a page appear short and could skip
        // valid JPEG/HEIC-backed assets after a run of RAW-only assets.
        var acceptedAssets: [PHAsset] = []
        assets.enumerateObjects { asset, _, _ in
            if preferredAcceptedStillResource(for: asset) != nil {
                acceptedAssets.append(asset)
            }
        }
        let pageStart = min(safeOffset, acceptedAssets.count)
        let pageEnd = min(pageStart + safeLimit, acceptedAssets.count)
        let selected = pageStart < pageEnd
            ? Array(acceptedAssets[pageStart..<pageEnd])
            : []
        let cloudIdentifiers = cloudIdentifiers(
            for: selected.map(\.localIdentifier)
        )
        let rows = selected.enumerated().map { index, asset in
            libraryIndexRow(
                asset,
                index: pageStart + index + 1,
                cloudIdentifier: cloudIdentifiers[asset.localIdentifier] ?? ""
            )
        }
        let payload: [String: Any] = [
            "ok": true,
            "mode": "library-index",
            "limit": safeLimit,
            "offset": safeOffset,
            "count": rows.count,
            "fetchedCount": acceptedAssets.count,
            "skippedCount": pageStart,
            "dateFrom": photoLibraryISODate(dateFrom),
            "dateTo": photoLibraryISODate(dateTo),
            "items": rows,
            "notes": [
                "Uses PhotoKit metadata only; does not read .photoslibrary package internals.",
                "Sidecar culling decisions are local-first. Photos keyword/title write-back is staged separately.",
                "RAW-only Photos assets without a JPEG or HEIC resource are excluded from PBB/PBE source intake.",
            ],
        ]
        return try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    }

    public func preview(
        localIdentifier: String,
        maxPixelSize: Int = 1_600
    ) async throws -> PhotoPreview {
        try requireAccess()
        let asset = try asset(localIdentifier)

        if maxPixelSize <= Self.thumbnailRequestMaxPixelSize {
            return try await requestThumbnailPreview(
                for: asset,
                localIdentifier: localIdentifier,
                maxPixelSize: maxPixelSize
            )
        }

        return try await requestFullPreview(
            for: asset,
            localIdentifier: localIdentifier,
            maxPixelSize: maxPixelSize
        )
    }

    public func cullingPreview(
        localIdentifier: String,
        maxPixelSize: Int
    ) async throws -> PhotoPreview {
        try requireAccess()
        let asset = try asset(localIdentifier)

        if maxPixelSize <= Self.thumbnailRequestMaxPixelSize {
            return try await requestThumbnailPreview(
                for: asset,
                localIdentifier: localIdentifier,
                maxPixelSize: maxPixelSize
            )
        }

        // Idle culling upgrades need a bounded rendered image, not the complete
        // accepted JPEG or HEIC resource. Downloading full source data for every
        // visible card can exhaust the viewport's bounded retries before Photos
        // finishes serving large or iCloud-backed assets. Explicit workflows
        // that need complete bytes continue through renderedJPEGPreview.
        return try await requestFullPreview(
            for: asset,
            localIdentifier: localIdentifier,
            maxPixelSize: maxPixelSize
        )
    }

    public func renderedJPEGPreview(
        localIdentifier: String,
        maxPixelSize: Int
    ) async throws -> PhotoPreview {
        try requireAccess()
        let asset = try asset(localIdentifier)
        if let acceptedSource = preferredAcceptedStillResource(for: asset) {
            return try await requestAcceptedStillResourcePreview(
                resource: acceptedSource,
                localIdentifier: localIdentifier,
                maxPixelSize: maxPixelSize
            )
        }
        return try await preview(
            localIdentifier: localIdentifier,
            maxPixelSize: maxPixelSize
        )
    }

    private func requestThumbnailPreview(
        for asset: PHAsset,
        localIdentifier: String,
        maxPixelSize: Int
    ) async throws -> PhotoPreview {
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true
        let isFastThumbnail = maxPixelSize <= 180
        options.deliveryMode = isFastThumbnail ? .fastFormat : .highQualityFormat
        options.resizeMode = isFastThumbnail ? .fast : .exact
        options.version = .current
        let targetSize = CGSize(
            width: CGFloat(max(64, min(8_192, maxPixelSize))),
            height: CGFloat(max(64, min(8_192, maxPixelSize)))
        )
        let manager = PHImageManager.default()
        let gate = PhotoKitPreviewResultGate()

        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<PhotoPreview, Error>) in
                gate.installContinuation(continuation)
                let requestID = manager.requestImage(
                    for: asset,
                    targetSize: targetSize,
                    contentMode: .aspectFit,
                    options: options
                ) { image, info in
                    if let error = info?[PHImageErrorKey] as? Error {
                        gate.resume(with: .failure(PhotoLibraryError.previewUnavailable(error.localizedDescription)))
                    } else if info?[PHImageCancelledKey] as? Bool == true {
                        gate.resume(with: .failure(CancellationError()))
                    } else if let image {
                        if !isFastThumbnail,
                           info?[PHImageResultIsDegradedKey] as? Bool == true {
                            return
                        }
                        do {
                            gate.resume(with: .success(try Self.previewFromImage(
                                image,
                                localIdentifier: localIdentifier,
                                maxPixelSize: maxPixelSize
                            )))
                        } catch {
                            gate.resume(with: .failure(error))
                        }
                    } else {
                        gate.resume(with: .failure(PhotoLibraryError.previewUnavailable(localIdentifier)))
                    }
                }
                gate.installRequest(requestID, manager: manager)
                gate.installTimeout(Task {
                    do {
                        try await Task.sleep(for: Self.thumbnailRequestTimeout)
                    } catch {
                        return
                    }
                    gate.resume(with: .failure(PhotoLibraryError.previewUnavailable(localIdentifier)))
                })
            }
        }, onCancel: {
            gate.cancel()
        })
    }

    private func requestAcceptedStillResourcePreview(
        resource: PHAssetResource,
        localIdentifier: String,
        maxPixelSize: Int
    ) async throws -> PhotoPreview {
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        let manager = PHAssetResourceManager.default()
        let gate = PhotoKitResourcePreviewResultGate()

        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<PhotoPreview, Error>) in
                gate.installContinuation(continuation)
                let requestID = manager.requestData(
                    for: resource,
                    options: options,
                    dataReceivedHandler: { data in
                        gate.append(data)
                    },
                    completionHandler: { error in
                        if let error {
                            gate.resume(with: .failure(PhotoLibraryError.previewUnavailable(error.localizedDescription)))
                            return
                        }
                        do {
                            let sourceData = gate.dataSnapshot()
                            gate.resume(with: .success(try Self.previewFromImageData(
                                sourceData,
                                localIdentifier: localIdentifier,
                                maxPixelSize: maxPixelSize,
                                currentImageByteCount: Int64(sourceData.count)
                            )))
                        } catch {
                            gate.resume(with: .failure(error))
                        }
                    }
                )
                gate.installRequest(requestID, manager: manager)
                gate.installTimeout(Task {
                    do {
                        try await Task.sleep(for: Self.cullingJPEGRequestTimeout)
                    } catch {
                        return
                    }
                    gate.resume(with: .failure(PhotoLibraryError.previewUnavailable(localIdentifier)))
                })
            }
        }, onCancel: {
            gate.cancel()
        })
    }

    private func requestFullPreview(
        for asset: PHAsset,
        localIdentifier: String,
        maxPixelSize: Int
    ) async throws -> PhotoPreview {
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .exact
        options.version = .current
        let targetSize = CGSize(
            width: CGFloat(max(64, min(8_192, maxPixelSize))),
            height: CGFloat(max(64, min(8_192, maxPixelSize)))
        )
        let manager = PHImageManager.default()
        let gate = PhotoKitPreviewResultGate()

        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<PhotoPreview, Error>) in
                gate.installContinuation(continuation)
                // requestImage asks Photos for its rendered/current raster.
                // requestImageDataAndOrientation can return the source RAW
                // bytes for a RAW-only PHAsset, which bypasses Photos'
                // developed color rendering and produces a blue cast.
                let requestID = manager.requestImage(
                    for: asset,
                    targetSize: targetSize,
                    contentMode: .aspectFit,
                    options: options
                ) { image, info in
                    if let error = info?[PHImageErrorKey] as? Error {
                        gate.resume(with: .failure(PhotoLibraryError.previewUnavailable(error.localizedDescription)))
                    } else if info?[PHImageCancelledKey] as? Bool == true {
                        gate.resume(with: .failure(CancellationError()))
                    } else if info?[PHImageResultIsDegradedKey] as? Bool == true {
                        return
                    } else if let image {
                        do {
                            gate.resume(with: .success(try Self.previewFromImage(
                                image,
                                localIdentifier: localIdentifier,
                                maxPixelSize: maxPixelSize
                            )))
                        } catch {
                            gate.resume(with: .failure(error))
                        }
                    } else {
                        gate.resume(with: .failure(PhotoLibraryError.previewUnavailable(localIdentifier)))
                    }
                }
                gate.installRequest(requestID, manager: manager)
                gate.installTimeout(Task {
                    do {
                        try await Task.sleep(for: Self.fullPreviewRequestTimeout)
                    } catch {
                        return
                    }
                    gate.resume(with: .failure(PhotoLibraryError.previewUnavailable(localIdentifier)))
                })
            }
        }, onCancel: {
            gate.cancel()
        })
    }

    private static func previewFromImage(
        _ image: NSImage,
        localIdentifier: String,
        maxPixelSize: Int
    ) throws -> PhotoPreview {
        guard let sourceData = image.tiffRepresentation else {
            throw PhotoLibraryError.previewUnavailable(localIdentifier)
        }
        return try previewFromImageData(
            sourceData,
            localIdentifier: localIdentifier,
            maxPixelSize: maxPixelSize
        )
    }

    static func previewFromImageData(
        _ sourceData: Data,
        localIdentifier: String,
        maxPixelSize: Int,
        currentImageByteCount: Int64? = nil
    ) throws -> PhotoPreview {
        guard let source = CGImageSourceCreateWithData(sourceData as CFData, nil),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: max(64, min(8_192, maxPixelSize)),
            ] as CFDictionary) else {
            throw PhotoLibraryError.previewUnavailable(localIdentifier)
        }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            throw PhotoLibraryError.previewUnavailable(localIdentifier)
        }
        CGImageDestinationAddImage(destination, thumbnail, [
            kCGImageDestinationLossyCompressionQuality: 0.88,
        ] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw PhotoLibraryError.previewUnavailable(localIdentifier)
        }
        return PhotoPreview(
            assetID: localIdentifier,
            jpegData: output as Data,
            pixelWidth: thumbnail.width,
            pixelHeight: thumbnail.height,
            currentImageByteCount: currentImageByteCount
        )
    }

    public func exportOriginal(
        localIdentifier: String,
        to directory: URL
    ) async throws -> PhotoExportReceipt {
        try await exportOriginal(
            localIdentifier: localIdentifier,
            to: directory,
            allowICloudDownloads: true
        )
    }

    public func exportOriginal(
        localIdentifier: String,
        to directory: URL,
        allowICloudDownloads: Bool
    ) async throws -> PhotoExportReceipt {
        try requireAccess()
        let asset = try asset(localIdentifier)
        guard let resource = preferredOriginalResource(for: asset) else {
            throw PhotoLibraryError.resourceNotFound(localIdentifier)
        }
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        let destination = uniqueDestination(
            directory: directory,
            filename: resource.originalFilename
        )
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = allowICloudDownloads
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHAssetResourceManager.default().writeData(
                for: resource,
                toFile: destination,
                options: options
            ) { error in
                if let error {
                    continuation.resume(throwing: PhotoLibraryError.exportFailed(error.localizedDescription))
                } else {
                    continuation.resume()
                }
            }
        }
        let values = try destination.resourceValues(forKeys: [.fileSizeKey])
        return PhotoExportReceipt(
            assetID: localIdentifier,
            filename: resource.originalFilename,
            destination: destination,
            uniformTypeIdentifier: resource.uniformTypeIdentifier,
            byteCount: Int64(values.fileSize ?? 0),
            checksumSHA256: try sha256(of: destination)
        )
    }

    public func metadataReadMany(assetIDs: [String]) async throws -> Data {
        try requireAccess()
        do {
            return try PhotoMetadataAutomation.read(assetIDs: assetIDs)
        } catch {
            throw PhotoLibraryError.metadataFailed(error.localizedDescription)
        }
    }

    public func metadataApplyMany(requests: [PhotoMetadataApplyRequest]) async throws -> Data {
        try requireAccess()
        do {
            return try PhotoMetadataAutomation.apply(requests: requests)
        } catch {
            throw PhotoLibraryError.metadataFailed(error.localizedDescription)
        }
    }

    private func libraryIndexRow(
        _ asset: PHAsset,
        index: Int,
        cloudIdentifier: String
    ) -> [String: Any] {
        let resources = PHAssetResource.assetResources(for: asset)
        let preferred = preferredOriginalResource(for: asset)
        let acceptedSource = preferredAcceptedStillResource(for: asset)
        let renderedJPEG = preferredRenderedJPEGResource(for: asset)
        let displayResource = renderedJPEG ?? acceptedSource ?? preferred
        let assetIdentifier = cloudIdentifier.isEmpty ? asset.localIdentifier : cloudIdentifier
        let formats = resources.map(resourceFormat)
        let distinctFormats = formats.reduce(into: [String]()) { result, format in
            if !result.contains(format) { result.append(format) }
        }
        let formatCounts = formats.reduce(into: [String: Int]()) { counts, format in
            counts[format, default: 0] += 1
        }
        let eligible = acceptedSource != nil
        var row: [String: Any] = [
            "index": index,
            "assetId": assetIdentifier,
            "cloudIdentifier": cloudIdentifier,
            "localIdentifier": asset.localIdentifier,
            "sourceAnchor": cloudIdentifier.isEmpty
                ? "apple-photos://\(asset.localIdentifier)"
                : "apple-photos-cloud://\(cloudIdentifier)",
            "localSourceAnchor": "apple-photos://\(asset.localIdentifier)",
            "filename": eligible
                ? renderedJPEGFilename(renderedJPEG ?? acceptedSource, index: index)
                : displayResource?.originalFilename ?? asset.localIdentifier,
            "mediaType": "photo",
            "creationDate": photoLibraryISODate(asset.creationDate),
            "modificationDate": photoLibraryISODate(asset.modificationDate),
            "pixelWidth": asset.pixelWidth,
            "pixelHeight": asset.pixelHeight,
            "duration": asset.duration,
            "favorite": asset.isFavorite,
            "hidden": asset.isHidden,
            "mediaSubtypeRaw": Int(asset.mediaSubtypes.rawValue),
            "resources": resourceRows(resources),
            "resourceFormat": distinctFormats.isEmpty ? "Unknown" : distinctFormats.joined(separator: "+"),
            "resourceFormats": distinctFormats,
            "resourceFormatCounts": formatCounts,
            "preferredResourceFilename": acceptedSource?.originalFilename
                ?? preferred?.originalFilename
                ?? "",
            "preferredResourceFormat": acceptedSource.map(resourceFormat)
                ?? preferred.map(resourceFormat)
                ?? "",
            "fallbackResourceFilename": renderedJPEG?.originalFilename ?? "",
            "fallbackResourceFormat": renderedJPEG.map(resourceFormat) ?? "",
            "localJPEGFallbackAvailable": renderedJPEG != nil,
            "eligible": eligible,
            "exportStrategy": eligible ? "rendered_jpeg" : "unsupported",
            "status": eligible ? "candidate" : "unsupported",
            "reason": eligible
                ? "Photos still image will import as the current rendered JPG from Photos."
                : "Photos asset has no JPEG or HEIC resource; PBB/PBE source intake excludes it.",
        ]
        if let location = locationRow(asset) {
            row["location"] = location
        }
        let photosMetadata = photosMetadataRow(asset)
        if !photosMetadata.isEmpty {
            row["applePhotosMetadata"] = photosMetadata
            if let title = photosMetadata["title"] as? String, !title.isEmpty {
                row["applePhotosTitle"] = title
            }
            if let keywords = photosMetadata["keywords"] as? [String], !keywords.isEmpty {
                row["applePhotosKeywords"] = keywords
            }
        }
        return row
    }

    private func resourceRows(_ resources: [PHAssetResource]) -> [[String: Any]] {
        resources.map { resource in
            var row: [String: Any] = [
                "type": Int(resource.type.rawValue),
                "uniformTypeIdentifier": resource.uniformTypeIdentifier,
                "originalFilename": resource.originalFilename,
                "format": resourceFormat(resource),
                "jpegFallbackCompatible": isJPEGConvertibleImageResource(resource),
            ]
            let ext = URL(fileURLWithPath: resource.originalFilename).pathExtension
            if !ext.isEmpty {
                row["fileExtension"] = ext.uppercased()
            }
            return row
        }
    }

    private func locationRow(_ asset: PHAsset) -> [String: Any]? {
        guard let location = asset.location else { return nil }
        var row: [String: Any] = [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "timestamp": photoLibraryISODate(location.timestamp),
        ]
        if location.altitude.isFinite { row["altitude"] = location.altitude }
        if location.horizontalAccuracy >= 0 { row["horizontalAccuracy"] = location.horizontalAccuracy }
        if location.verticalAccuracy >= 0 { row["verticalAccuracy"] = location.verticalAccuracy }
        return row
    }

    private func photosMetadataRow(_ asset: PHAsset) -> [String: Any] {
        var row: [String: Any] = [:]
        let title = firstAssetString(asset, selectors: ["title", "localizedTitle"])
        let keywords = assetStringArray(asset, selectors: ["keywordTitles", "keywords"])
        if !title.isEmpty { row["title"] = title }
        if !keywords.isEmpty { row["keywords"] = keywords }
        return row
    }

    private func firstAssetString(_ asset: PHAsset, selectors: [String]) -> String {
        for selector in selectors {
            guard asset.responds(to: NSSelectorFromString(selector)) else { continue }
            let value = String(describing: asset.value(forKey: selector) ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { return value }
        }
        return ""
    }

    private func assetStringArray(_ asset: PHAsset, selectors: [String]) -> [String] {
        for selector in selectors {
            guard asset.responds(to: NSSelectorFromString(selector)),
                  let value = asset.value(forKey: selector) else { continue }
            if let strings = value as? [String] {
                let cleaned = strings.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                if !cleaned.isEmpty { return cleaned }
            }
            if let array = value as? NSArray {
                let cleaned = array.compactMap { item -> String? in
                    let text = String(describing: item).trimmingCharacters(in: .whitespacesAndNewlines)
                    return text.isEmpty ? nil : text
                }
                if !cleaned.isEmpty { return cleaned }
            }
            let text = String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                return text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
            }
        }
        return []
    }

    private func cloudIdentifiers(for localIdentifiers: [String]) -> [String: String] {
        guard #available(macOS 12.0, *) else { return [:] }
        var resolved: [String: String] = [:]
        // PhotoKit accepts a collection and is markedly faster in bounded
        // batches than one request per asset. Keep the batch below the IPC
        // page ceiling so this remains a predictable metadata-only read.
        for start in stride(from: 0, to: localIdentifiers.count, by: 500) {
            let end = min(start + 500, localIdentifiers.count)
            let batch = Array(localIdentifiers[start..<end])
            let mappings = PHPhotoLibrary.shared().cloudIdentifierMappings(
                forLocalIdentifiers: batch
            )
            for localIdentifier in batch {
                guard let result = mappings[localIdentifier],
                      case .success(let identifier) = result else { continue }
                resolved[localIdentifier] = identifier.stringValue
            }
        }
        return resolved
    }

    private func resourceFormat(_ resource: PHAssetResource) -> String {
        let filename = resource.originalFilename.lowercased()
        let uti = resource.uniformTypeIdentifier.lowercased()
        if ["raw", "dng", "nef", "cr2", "cr3", "arw", "raf", "rw2", "orf", "pef", "srw"]
            .contains(URL(fileURLWithPath: filename).pathExtension)
            || uti.contains("raw") || uti.contains("digital-camera-raw") { return "RAW" }
        if ["heic", "heif", "hif"].contains(URL(fileURLWithPath: filename).pathExtension)
            || uti.contains("heic") || uti.contains("heif") { return "HEIC" }
        if ["jpg", "jpeg", "jpe"].contains(URL(fileURLWithPath: filename).pathExtension)
            || uti.contains("jpeg") || uti.contains("jpg") { return "JPEG" }
        if URL(fileURLWithPath: filename).pathExtension == "png" || uti.contains("png") { return "PNG" }
        if ["tif", "tiff"].contains(URL(fileURLWithPath: filename).pathExtension) || uti.contains("tiff") { return "TIFF" }
        if ["mov", "mp4", "m4v"].contains(URL(fileURLWithPath: filename).pathExtension)
            || uti.contains("movie") || uti.contains("video") || uti.contains("mpeg-4") { return "MOV" }
        let ext = URL(fileURLWithPath: filename).pathExtension
        return ext.isEmpty ? (uti.isEmpty ? "Unknown" : uti) : ext.uppercased()
    }

    private func isJPEGConvertibleImageResource(_ resource: PHAssetResource) -> Bool {
        switch resourceFormat(resource) {
        case "HEIC", "JPEG": return true
        default: return false
        }
    }

    private func preferredAcceptedStillResource(for asset: PHAsset) -> PHAssetResource? {
        let resources = PHAssetResource.assetResources(for: asset)
        for format in ["JPEG", "HEIC"] {
            if let resource = resources
                .filter({ resourceFormat($0) == format })
                .sorted(by: { lhs, rhs in
                    let lhsPriority = imageResourceTypePriority(lhs)
                    let rhsPriority = imageResourceTypePriority(rhs)
                    if lhsPriority != rhsPriority { return lhsPriority < rhsPriority }
                    return lhs.originalFilename < rhs.originalFilename
                })
                .first {
                return resource
            }
        }
        return nil
    }

    private func preferredRenderedJPEGResource(for asset: PHAsset) -> PHAssetResource? {
        PHAssetResource.assetResources(for: asset)
            .filter { resourceFormat($0) == "JPEG" }
            .sorted { lhs, rhs in
                let lhsPriority = imageResourceTypePriority(lhs)
                let rhsPriority = imageResourceTypePriority(rhs)
                if lhsPriority != rhsPriority { return lhsPriority < rhsPriority }
                return lhs.originalFilename < rhs.originalFilename
            }
            .first
    }

    private func imageResourceTypePriority(_ resource: PHAssetResource) -> Int {
        switch resource.type {
        case .fullSizePhoto: return 0
        case .photo: return 1
        case .alternatePhoto: return 2
        case .adjustmentBasePhoto: return 3
        default: return 9
        }
    }

    private func renderedJPEGFilename(_ resource: PHAssetResource?, index: Int) -> String {
        let fallback = "apple-photos-\(index)"
        let source = resource?.originalFilename ?? fallback
        let stem = URL(fileURLWithPath: source).deletingPathExtension().lastPathComponent
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(stem.isEmpty ? fallback : stem).jpg"
    }

    private func requireAccess() throws {
        guard [.authorized, .limited].contains(authorization()) else {
            throw PhotoLibraryError.accessDenied
        }
    }

    private func asset(_ identifier: String) throws -> PHAsset {
        let asset: PHAsset
        if let localAsset = fetchAsset(localIdentifier: identifier) {
            asset = localAsset
        } else if #available(macOS 12.0, *),
                  let cloudValue = PhotoLibraryIdentifier.cloudValue(from: identifier) {
            // Fixture IDs are stable across Macs while PhotoKit local
            // identifiers are library-local. Resolve the canonical cloud ID
            // when the connector does not provide a local Photos ID.
            let cloudIdentifier = PHCloudIdentifier(stringValue: cloudValue)
            let mappings = PHPhotoLibrary.shared().localIdentifierMappings(for: [cloudIdentifier])
            guard let result = mappings[cloudIdentifier],
                  case .success(let localIdentifier) = result,
                  let mappedAsset = fetchAsset(localIdentifier: localIdentifier) else {
                throw PhotoLibraryError.assetNotFound(identifier)
            }
            asset = mappedAsset
        } else {
            throw PhotoLibraryError.assetNotFound(identifier)
        }

        guard asset.mediaType == .image else {
            throw PhotoLibraryError.unsupportedMediaType(
                "Backstage source workflows accept still photos only."
            )
        }
        return asset
    }

    private func fetchAsset(localIdentifier: String) -> PHAsset? {
        PHAsset.fetchAssets(
            withLocalIdentifiers: [localIdentifier],
            options: nil
        ).firstObject
    }

    private func preferredOriginalResource(for asset: PHAsset) -> PHAssetResource? {
        let resources = PHAssetResource.assetResources(for: asset)
        let priorities: [PHAssetResourceType] = [.fullSizePhoto, .photo, .alternatePhoto]
        for type in priorities {
            if let resource = resources.first(where: { $0.type == type }) {
                return resource
            }
        }
        return resources.first
    }

    private func uniqueDestination(directory: URL, filename: String) -> URL {
        let base = directory.appendingPathComponent(filename)
        guard FileManager.default.fileExists(atPath: base.path) else { return base }
        let stem = base.deletingPathExtension().lastPathComponent
        let ext = base.pathExtension
        for suffix in 2...9_999 {
            let candidate = directory
                .appendingPathComponent("\(stem)-\(suffix)")
                .appendingPathExtension(ext)
            if !FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
        }
        return directory
            .appendingPathComponent("\(stem)-\(UUID().uuidString)")
            .appendingPathExtension(ext)
    }

    private func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

/// Completes one PhotoKit preview request exactly once, including the case
/// where PhotoKit never calls its result handler for a cloud-backed asset.
private final class PhotoKitPreviewResultGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<PhotoPreview, Error>?
    private var requestID: PHImageRequestID?
    private weak var manager: PHImageManager?
    private var timeoutTask: Task<Void, Never>?
    private var finished = false

    func installContinuation(_ continuation: CheckedContinuation<PhotoPreview, Error>) {
        lock.lock()
        if finished {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        self.continuation = continuation
        lock.unlock()
    }

    func installRequest(_ requestID: PHImageRequestID, manager: PHImageManager) {
        lock.lock()
        if finished {
            lock.unlock()
            manager.cancelImageRequest(requestID)
            return
        }
        self.requestID = requestID
        self.manager = manager
        lock.unlock()
    }

    func installTimeout(_ task: Task<Void, Never>) {
        lock.lock()
        if finished {
            lock.unlock()
            task.cancel()
            return
        }
        timeoutTask = task
        lock.unlock()
    }

    func resume(with result: Result<PhotoPreview, Error>) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        let continuation = self.continuation
        self.continuation = nil
        let timeoutTask = self.timeoutTask
        self.timeoutTask = nil
        let requestID = self.requestID
        let manager = self.manager
        lock.unlock()

        timeoutTask?.cancel()
        if let requestID, let manager {
            manager.cancelImageRequest(requestID)
        }
        continuation?.resume(with: result)
    }

    func cancel() {
        resume(with: .failure(CancellationError()))
    }
}

/// Completes one JPEG resource request exactly once and cancels it when the
/// Culling idle-upgrade task leaves the viewport or times out.
private final class PhotoKitResourcePreviewResultGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<PhotoPreview, Error>?
    private var requestID: PHAssetResourceDataRequestID?
    private weak var manager: PHAssetResourceManager?
    private var timeoutTask: Task<Void, Never>?
    private var data = Data()
    private var finished = false

    func installContinuation(_ continuation: CheckedContinuation<PhotoPreview, Error>) {
        lock.lock()
        if finished {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        self.continuation = continuation
        lock.unlock()
    }

    func append(_ chunk: Data) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        data.append(chunk)
        lock.unlock()
    }

    func dataSnapshot() -> Data {
        lock.lock()
        let snapshot = data
        lock.unlock()
        return snapshot
    }

    func installRequest(_ requestID: PHAssetResourceDataRequestID, manager: PHAssetResourceManager) {
        lock.lock()
        if finished {
            lock.unlock()
            manager.cancelDataRequest(requestID)
            return
        }
        self.requestID = requestID
        self.manager = manager
        lock.unlock()
    }

    func installTimeout(_ task: Task<Void, Never>) {
        lock.lock()
        if finished {
            lock.unlock()
            task.cancel()
            return
        }
        timeoutTask = task
        lock.unlock()
    }

    func resume(with result: Result<PhotoPreview, Error>) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        let continuation = self.continuation
        self.continuation = nil
        let timeoutTask = self.timeoutTask
        self.timeoutTask = nil
        let requestID = self.requestID
        let manager = self.manager
        lock.unlock()

        timeoutTask?.cancel()
        if let requestID, let manager {
            manager.cancelDataRequest(requestID)
        }
        continuation?.resume(with: result)
    }

    func cancel() {
        resume(with: .failure(CancellationError()))
    }
}

private func photoLibraryISODate(_ date: Date?) -> String {
    guard let date else { return "" }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
}

private func map(_ status: PHAuthorizationStatus) -> PhotoLibraryAccess {
    switch status {
    case .authorized: return .authorized
    case .limited: return .limited
    case .denied, .restricted: return .denied
    case .notDetermined: return .notDetermined
    @unknown default: return .denied
    }
}
