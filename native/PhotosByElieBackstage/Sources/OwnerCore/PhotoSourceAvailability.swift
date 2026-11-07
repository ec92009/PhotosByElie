import Foundation
import Photos

public extension PhotoKitLibraryService {
    func sourceAvailability(identifiers: [String]) async throws -> [String: Bool] {
        let access = authorization()
        guard access == .authorized || access == .limited else {
            throw PhotoLibraryError.accessDenied
        }
        let ids = Array(Set(identifiers.filter { !$0.isEmpty })).sorted()
        guard ids.count <= 500 else {
            throw PhotoLibraryError.metadataFailed("Source availability checks accept at most 500 photos.")
        }
        let task = Task.detached(priority: .userInitiated) {
            try Task.checkCancellation()
            let clouds = ids.compactMap { id -> PHCloudIdentifier? in
                PhotoLibraryIdentifier.cloudValue(from: id).map(PHCloudIdentifier.init(stringValue:))
            }
            let mappings = PHPhotoLibrary.shared().localIdentifierMappings(for: clouds)
            var localByIdentifier: [String: String] = [:]
            for id in ids {
                if let cloud = PhotoLibraryIdentifier.cloudValue(from: id) {
                    if let mapping = mappings[PHCloudIdentifier(stringValue: cloud)],
                       case .success(let localID) = mapping {
                        localByIdentifier[id] = localID
                    }
                } else {
                    localByIdentifier[id] = id
                }
            }
            let options = PHFetchOptions()
            options.includeHiddenAssets = true
            options.includeAllBurstAssets = true
            let assets = PHAsset.fetchAssets(
                withLocalIdentifiers: Array(Set(localByIdentifier.values)), options: options
            )
            var found: Set<String> = []
            assets.enumerateObjects { asset, _, _ in found.insert(asset.localIdentifier) }
            var result: [String: Bool] = [:]
            for id in ids {
                try Task.checkCancellation()
                if let localID = localByIdentifier[id], found.contains(localID) {
                    result[id] = true
                } else {
                    // Limited access can hide an existing asset. Only a full
                    // library grant permits a definitive negative observation.
                    if access == .authorized { result[id] = false }
                }
            }
            // A permission change during the check must not turn into deletion.
            return self.authorization() == .authorized ? result : result.filter { $0.value }
        }
        return try await withTaskCancellationHandler {
            try await task.value
        } onCancel: {
            task.cancel()
        }
    }
}

/// Updates availability only for explicitly checked identities. Never prunes
/// an incremental discovery subset or changes culling, publication or sales.
public struct OwnerPhotoAvailabilitySQLiteStore: Sendable {
    public let databaseURL: URL

    public init(databaseURL: URL) { self.databaseURL = databaseURL }

    @discardableResult
    public func reconcile(_ availability: [String: Bool], observedAt: Date = Date()) throws -> Int {
        guard !availability.isEmpty else { return 0 }
        guard availability.count <= 500 else {
            throw OwnerCullingSQLiteError.invalid("Source availability checks accept at most 500 photos.")
        }
        let connection = try CullingSQLiteConnection(
            databaseURL: databaseURL, busyTimeoutMilliseconds: 2_000
        )
        let timestamp = ISO8601DateFormatter().string(from: observedAt)
        return try connection.transaction {
            var changed = 0
            for (assetID, available) in availability.sorted(by: { $0.key < $1.key }) {
                try connection.execute(
                    """
                    UPDATE sidecar_assets SET missing_at = ?
                    WHERE asset_id = ? AND
                      CASE WHEN COALESCE(missing_at, '') = '' THEN 1 ELSE 0 END != CAST(? AS INTEGER)
                    """,
                    bindings: [.string(available ? "" : timestamp), .string(assetID), .string(available ? "1" : "0")]
                )
                changed += try connection.queryOne("SELECT changes() AS count")?["count"]?.intValue ?? 0
            }
            return changed
        }
    }
}
