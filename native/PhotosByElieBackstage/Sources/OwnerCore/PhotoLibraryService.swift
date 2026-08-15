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

    public init(
        assetID: String,
        jpegData: Data,
        pixelWidth: Int,
        pixelHeight: Int
    ) {
        self.assetID = assetID
        self.jpegData = jpegData
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
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
        }
    }
}

public protocol PhotoLibraryServing: Sendable {
    func authorization() -> PhotoLibraryAccess
    func requestAuthorization() async -> PhotoLibraryAccess
    func fetch(limit: Int) async -> [PhotoLibraryItem]
    func libraryIndex(limit: Int, offset: Int, dateFrom: Date?, dateTo: Date?) async throws -> Data
    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview
    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt
    func exportOriginal(
        localIdentifier: String,
        to directory: URL,
        allowICloudDownloads: Bool
    ) async throws -> PhotoExportReceipt
}

public extension PhotoLibraryServing {
    func exportOriginal(
        localIdentifier: String,
        to directory: URL,
        allowICloudDownloads: Bool
    ) async throws -> PhotoExportReceipt {
        try await exportOriginal(localIdentifier: localIdentifier, to: directory)
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
        options.fetchLimit = max(1, min(5_000, limit))
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        // Backstage source intake is still-photo only. Real-estate videos are
        // generated deliverables built from approved stills and do not belong
        // in the PhotoKit culling/preview universe.
        let result = PHAsset.fetchAssets(with: .image, options: options)
        var items: [PhotoLibraryItem] = []
        result.enumerateObjects { asset, _, stop in
            let resources = PHAssetResource.assetResources(for: asset)
            items.append(PhotoLibraryItem(
                id: asset.localIdentifier,
                filename: resources.first?.originalFilename ?? asset.localIdentifier,
                creationDate: asset.creationDate,
                mediaType: asset.mediaType == .video ? "video" : "photo"
            ))
            if items.count >= limit { stop.pointee = true }
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
        options.fetchLimit = safeOffset + safeLimit

        // Backstage source intake is still-photo only. Generated real-estate
        // videos are downstream deliverables and never enter this index.
        let assets = PHAsset.fetchAssets(with: .image, options: options)
        var selected: [PHAsset] = []
        assets.enumerateObjects { asset, index, stop in
            if index < safeOffset { return }
            guard selected.count < safeLimit else {
                stop.pointee = true
                return
            }
            selected.append(asset)
        }
        let rows = selected.enumerated().map { index, asset in
            libraryIndexRow(asset, index: safeOffset + index + 1)
        }
        let payload: [String: Any] = [
            "ok": true,
            "mode": "library-index",
            "limit": safeLimit,
            "offset": safeOffset,
            "count": rows.count,
            "fetchedCount": assets.count,
            "skippedCount": min(safeOffset, assets.count),
            "dateFrom": photoLibraryISODate(dateFrom),
            "dateTo": photoLibraryISODate(dateTo),
            "items": rows,
            "notes": [
                "Uses PhotoKit metadata only; does not read .photoslibrary package internals.",
                "Sidecar culling decisions are local-first. Photos keyword/title write-back is staged separately.",
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
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .highQualityFormat
        options.version = .current

        let sourceData: Data = try await withCheckedThrowingContinuation { continuation in
            PHImageManager.default().requestImageDataAndOrientation(
                for: asset,
                options: options
            ) { data, _, _, info in
                if let error = info?[PHImageErrorKey] as? Error {
                    continuation.resume(throwing: PhotoLibraryError.previewUnavailable(error.localizedDescription))
                } else if let data {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: PhotoLibraryError.previewUnavailable(localIdentifier))
                }
            }
        }
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
            pixelHeight: thumbnail.height
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

    private func libraryIndexRow(_ asset: PHAsset, index: Int) -> [String: Any] {
        let resources = PHAssetResource.assetResources(for: asset)
        let preferred = preferredOriginalResource(for: asset)
        let fallback = resources.first(where: isJPEGConvertibleImageResource)
        let displayResource = fallback ?? preferred
        let cloudIdentifier = cloudIdentifier(for: asset.localIdentifier)
        let assetIdentifier = cloudIdentifier.isEmpty ? asset.localIdentifier : cloudIdentifier
        let formats = resources.map(resourceFormat)
        let distinctFormats = formats.reduce(into: [String]()) { result, format in
            if !result.contains(format) { result.append(format) }
        }
        let formatCounts = formats.reduce(into: [String: Int]()) { counts, format in
            counts[format, default: 0] += 1
        }
        let eligible = true
        var row: [String: Any] = [
            "index": index,
            "assetId": assetIdentifier,
            "cloudIdentifier": cloudIdentifier,
            "localIdentifier": asset.localIdentifier,
            "sourceAnchor": cloudIdentifier.isEmpty
                ? "apple-photos://\(asset.localIdentifier)"
                : "apple-photos-cloud://\(cloudIdentifier)",
            "localSourceAnchor": "apple-photos://\(asset.localIdentifier)",
            "filename": renderedJPEGFilename(displayResource, index: index),
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
            "preferredResourceFilename": preferred?.originalFilename ?? "",
            "preferredResourceFormat": preferred.map(resourceFormat) ?? "",
            "fallbackResourceFilename": fallback?.originalFilename ?? "",
            "fallbackResourceFormat": fallback.map(resourceFormat) ?? "",
            "localJPEGFallbackAvailable": fallback != nil,
            "eligible": eligible,
            "exportStrategy": "rendered_jpeg",
            "status": "candidate",
            "reason": "Photos still image will import as the current rendered JPG from Photos.",
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

    private func cloudIdentifier(for localIdentifier: String) -> String {
        guard #available(macOS 12.0, *) else { return "" }
        let mappings = PHPhotoLibrary.shared().cloudIdentifierMappings(forLocalIdentifiers: [localIdentifier])
        guard let result = mappings[localIdentifier] else { return "" }
        if case .success(let identifier) = result {
            return identifier.stringValue
        }
        return ""
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
        case "RAW", "HEIC", "JPEG", "PNG", "TIFF": return true
        default: return false
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
        } else if #available(macOS 12.0, *) {
            // Fixture IDs are stable across Macs while PhotoKit local
            // identifiers are library-local. Resolve the canonical cloud ID
            // when the connector does not provide a local Photos ID.
            let cloudValue = identifier.hasPrefix("apple-photos-cloud://")
                ? String(identifier.dropFirst("apple-photos-cloud://".count))
                : identifier
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
