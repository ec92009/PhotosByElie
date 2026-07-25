import Foundation
import Photos

public enum PhotoLibraryAccess: Sendable, Equatable {
    case notDetermined, denied, limited, authorized
}

public struct PhotoLibraryItem: Identifiable, Sendable, Equatable {
    public var id: String
    public var filename: String
    public var creationDate: Date?
    public var mediaType: String
}

public protocol PhotoLibraryServing: Sendable {
    func authorization() -> PhotoLibraryAccess
    func requestAuthorization() async -> PhotoLibraryAccess
    func fetch(limit: Int) async -> [PhotoLibraryItem]
}

public struct PhotoKitLibraryService: PhotoLibraryServing {
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

