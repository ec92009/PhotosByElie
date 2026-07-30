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
    case resourceNotFound(String)
    case previewUnavailable(String)
    case exportFailed(String)
}

public protocol PhotoLibraryServing: Sendable {
    func authorization() -> PhotoLibraryAccess
    func requestAuthorization() async -> PhotoLibraryAccess
    func fetch(limit: Int) async -> [PhotoLibraryItem]
    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview
    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt
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
        let result = PHAsset.fetchAssets(with: options)
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
        options.isNetworkAccessAllowed = true
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

    private func requireAccess() throws {
        guard [.authorized, .limited].contains(authorization()) else {
            throw PhotoLibraryError.accessDenied
        }
    }

    private func asset(_ localIdentifier: String) throws -> PHAsset {
        guard let asset = PHAsset.fetchAssets(
            withLocalIdentifiers: [localIdentifier],
            options: nil
        ).firstObject else {
            throw PhotoLibraryError.assetNotFound(localIdentifier)
        }
        return asset
    }

    private func preferredOriginalResource(for asset: PHAsset) -> PHAssetResource? {
        let resources = PHAssetResource.assetResources(for: asset)
        let priorities: [PHAssetResourceType] = asset.mediaType == .video
            ? [.fullSizeVideo, .video, .pairedVideo]
            : [.fullSizePhoto, .photo, .alternatePhoto]
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

private func map(_ status: PHAuthorizationStatus) -> PhotoLibraryAccess {
    switch status {
    case .authorized: return .authorized
    case .limited: return .limited
    case .denied, .restricted: return .denied
    case .notDetermined: return .notDetermined
    @unknown default: return .denied
    }
}
