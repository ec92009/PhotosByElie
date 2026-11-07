import Foundation
import Photos

public extension PhotoKitLibraryService {
    func libraryChangesPage(sessionID: String, checkpoint: String?, limit: Int, offset: Int) async throws -> Data {
        try await PhotoLibraryChangeReader.shared.page(
            reader: self, sessionID: sessionID, checkpoint: checkpoint, limit: limit, offset: offset
        )
    }
}

/// One immutable fetch per accepted helper job, rather than a resource census
/// of the whole library on every page. This cache is transport only: the durable
/// consumer cursor belongs to PBB's Owner database, never to Apple Photos.
actor PhotoLibraryChangeReader {
    static let shared = PhotoLibraryChangeReader()
    struct Snapshot {
        var assets: PHFetchResult<PHAsset>
        var removed: [String]
        var token: String
        var baseline: Bool
        var inputCheckpoint: String?
        var createdAt = Date()
    }
    private var snapshots: [String: Snapshot] = [:]

    func page(reader: PhotoKitLibraryService, sessionID: String, checkpoint: String?, limit: Int, offset: Int) throws -> Data {
        guard reader.authorization() == .authorized else { throw PhotoLibraryError.accessDenied }
        guard UUID(uuidString: sessionID) != nil, (1...1000).contains(limit), offset >= 0 else {
            throw PhotoLibraryError.metadataFailed("Invalid Photos sync page.")
        }
        snapshots = snapshots.filter { Date().timeIntervalSince($0.value.createdAt) < 900 }
        if offset == 0, snapshots[sessionID] == nil {
            guard snapshots.count < 3 else { throw PhotoLibraryError.metadataFailed("A Photos sync is already active. Retry shortly.") }
            snapshots[sessionID] = try snapshot(checkpoint: checkpoint)
        }
        guard let state = snapshots[sessionID], state.inputCheckpoint == checkpoint else {
            throw PhotoLibraryError.metadataFailed("Photos sync snapshot expired. Restart sync; the saved checkpoint is unchanged.")
        }
        let total = state.assets.count + state.removed.count
        guard offset <= total else { throw PhotoLibraryError.metadataFailed("Invalid Photos sync offset.") }
        let end = min(offset + limit, total)
        let assets = (min(offset, state.assets.count)..<min(end, state.assets.count)).map { state.assets.object(at: $0) }
        let recovery = RawRecoveryBatchRegistry.snapshot()
        var rows: [[String: Any]] = []
        var removed = Array(state.removed[max(0, offset - state.assets.count)..<max(0, end - state.assets.count)])
        var supported: [(PHAsset, RawRecoveryResolvedDerivative?)] = []
        for asset in assets {
            try Task.checkCancellation()
            let recovered = recovery?.resolvedDerivative(localIdentifier: asset.localIdentifier)
            if reader.isLibraryIndexEligible(asset, recovered: recovered != nil) {
                supported.append((asset, recovered))
            } else { removed.append(asset.localIdentifier) }
        }
        let clouds = reader.cloudIdentifiers(for: supported.map { $0.0.localIdentifier })
        for (asset, recovered) in supported {
            try Task.checkCancellation()
            rows.append(reader.libraryIndexRow(asset, index: offset + rows.count + 1,
                cloudIdentifier: clouds[asset.localIdentifier] ?? "",
                recovered: recovered))
        }
        // Revoked/limited access must never certify a complete inventory.
        guard reader.authorization() == .authorized else { throw PhotoLibraryError.accessDenied }
        if end == total { snapshots.removeValue(forKey: sessionID) }
        return try JSONSerialization.data(withJSONObject: [
            "ok": true, "mode": "library-index", "limit": limit, "offset": offset,
            "count": rows.count, "items": rows, "syncSession": sessionID,
            "nextOffset": end, "hasMore": end < total, "scannedCount": end,
            "totalCount": total, "syncBaseline": state.baseline,
            "nextChangeToken": state.token, "removedLocalIdentifiers": removed,
        ], options: [.sortedKeys])
    }

    private func snapshot(checkpoint: String?) throws -> Snapshot {
        let library = PHPhotoLibrary.shared()
        let options = PHFetchOptions()
        options.includeHiddenAssets = true
        options.includeAllBurstAssets = true
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        if let checkpoint, let data = Data(base64Encoded: checkpoint),
           let token = try? NSKeyedUnarchiver.unarchivedObject(ofClass: PHPersistentChangeToken.self, from: data) {
            do {
                var changed: Set<String> = [], removed: Set<String> = []
                var next = token
                for change in try library.fetchPersistentChanges(since: token) {
                    try Task.checkCancellation()
                    let details = try change.changeDetails(for: .asset)
                    changed.formUnion(details.insertedLocalIdentifiers)
                    changed.formUnion(details.updatedLocalIdentifiers)
                    removed.formUnion(details.deletedLocalIdentifiers)
                    next = change.changeToken
                }
                // Resolve final state, including a delete followed by restore.
                let ids = changed.union(removed)
                let assets = PHAsset.fetchAssets(withLocalIdentifiers: Array(ids), options: options)
                var found: Set<String> = []
                assets.enumerateObjects { asset, _, _ in found.insert(asset.localIdentifier) }
                return try Snapshot(assets: assets, removed: Array(ids.subtracting(found)).sorted(),
                    token: archive(next), baseline: false, inputCheckpoint: checkpoint)
            } catch is CancellationError { throw CancellationError() }
            catch {
                // Unavailable history cannot prove "no changes". A complete
                // inventory is the safe recovery, with no cursor advance yet.
            }
        }
        try Task.checkCancellation()
        // Capture BEFORE inventory: changes during the scan must replay on the
        // next pass. Taking a token at the end could silently skip those edits.
        let token = try archive(library.currentChangeToken)
        return Snapshot(assets: PHAsset.fetchAssets(with: options), removed: [],
            token: token, baseline: true, inputCheckpoint: checkpoint)
    }

    private func archive(_ token: PHPersistentChangeToken) throws -> String {
        try NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true).base64EncodedString()
    }
}
