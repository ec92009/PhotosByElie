#!/usr/bin/env swift
import Foundation
import Photos

struct BridgeError: Error {
    let code: String
    let message: String
}

func jsonData(_ value: Any) -> Data {
    return try! JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
}

func printJSON(_ value: Any) {
    FileHandle.standardOutput.write(jsonData(value))
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func fail(_ code: String, _ message: String, status: Int32 = 1) -> Never {
    printJSON(["ok": false, "code": code, "error": message])
    exit(status)
}

func argValue(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}

func intArg(_ name: String, default defaultValue: Int = 0) -> Int {
    guard let value = argValue(name), let parsed = Int(value) else { return defaultValue }
    return parsed
}

func requirePhotosAccess() {
    let status = PHPhotoLibrary.authorizationStatus()
    if status == .authorized || status == .limited {
        return
    }
    if status == .denied || status == .restricted {
        fail("permission_denied", "Apple Photos access is not allowed for this helper. Enable Photos access for Terminal, Python, or the Owner launcher in System Settings > Privacy & Security > Photos.")
    }
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    PHPhotoLibrary.requestAuthorization { nextStatus in
        granted = nextStatus == .authorized || nextStatus == .limited
        semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 120)
    if !granted {
        fail("permission_missing", "Apple Photos permission was not granted. Re-run from the local Owner helper after approving the macOS Photos privacy prompt.")
    }
}

func collectionMatches(_ collection: PHAssetCollection, id: String?, name: String?) -> Bool {
    if let id, !id.isEmpty, collection.localIdentifier == id { return true }
    if let name, !name.isEmpty, collection.localizedTitle == name { return true }
    return false
}

func fetchAlbums() -> [PHAssetCollection] {
    var albums: [PHAssetCollection] = []
    let options = PHFetchOptions()
    let userAlbums = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: options)
    userAlbums.enumerateObjects { collection, _, _ in albums.append(collection) }
    let smartAlbums = PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: .any, options: options)
    smartAlbums.enumerateObjects { collection, _, _ in albums.append(collection) }
    return albums.sorted { ($0.localizedTitle ?? "") < ($1.localizedTitle ?? "") }
}

func findAlbum(id: String?, name: String?) throws -> PHAssetCollection {
    let matches = fetchAlbums().filter { collectionMatches($0, id: id, name: name) }
    if matches.isEmpty {
        throw BridgeError(code: "album_not_found", message: "Apple Photos album not found.")
    }
    if matches.count > 1 && (id ?? "").isEmpty {
        throw BridgeError(code: "ambiguous_album", message: "Multiple Apple Photos albums have that name. Choose the album identifier.")
    }
    return matches[0]
}

func assetFetchOptions(limit: Int) -> PHFetchOptions {
    let options = PHFetchOptions()
    options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
    if limit > 0 { options.fetchLimit = limit }
    return options
}

func isoDate(_ date: Date?) -> String {
    guard let date else { return "" }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
}

func resourceRows(_ asset: PHAsset) -> [[String: Any]] {
    return PHAssetResource.assetResources(for: asset).map { resource in
        [
            "type": resource.type.rawValue,
            "uniformTypeIdentifier": resource.uniformTypeIdentifier,
            "originalFilename": resource.originalFilename,
        ]
    }
}

func preferredResource(_ asset: PHAsset) -> PHAssetResource? {
    let resources = PHAssetResource.assetResources(for: asset)
    let preferredTypes: [PHAssetResourceType] = asset.mediaType == .video
        ? [.fullSizeVideo, .video]
        : [.fullSizePhoto, .photo]
    for type in preferredTypes {
        if let found = resources.first(where: { $0.type == type }) {
            return found
        }
    }
    return nil
}

func isRawOnly(_ asset: PHAsset) -> Bool {
    let resources = PHAssetResource.assetResources(for: asset)
    let filenames = resources.map { $0.originalFilename.lowercased() }
    let hasDeveloped = filenames.contains { name in
        name.hasSuffix(".jpg") || name.hasSuffix(".jpeg") || name.hasSuffix(".heic") || name.hasSuffix(".heif") || name.hasSuffix(".tif") || name.hasSuffix(".tiff") || name.hasSuffix(".png") || name.hasSuffix(".mov") || name.hasSuffix(".mp4") || name.hasSuffix(".m4v")
    }
    let hasRaw = filenames.contains { name in
        name.hasSuffix(".raw") || name.hasSuffix(".dng") || name.hasSuffix(".nef") || name.hasSuffix(".cr2") || name.hasSuffix(".cr3") || name.hasSuffix(".arw") || name.hasSuffix(".raf")
    }
    return hasRaw && !hasDeveloped
}

func assetRow(_ asset: PHAsset, index: Int) -> [String: Any] {
    let resource = preferredResource(asset)
    let rawOnly = isRawOnly(asset)
    let mediaType = asset.mediaType == .video ? "video" : asset.mediaType == .image ? "photo" : "unsupported"
    let eligible = resource != nil && !rawOnly && (asset.mediaType == .image || asset.mediaType == .video)
    return [
        "index": index,
        "localIdentifier": asset.localIdentifier,
        "sourceAnchor": "apple-photos://\(asset.localIdentifier)",
        "filename": resource?.originalFilename ?? "",
        "mediaType": mediaType,
        "creationDate": isoDate(asset.creationDate),
        "modificationDate": isoDate(asset.modificationDate),
        "pixelWidth": asset.pixelWidth,
        "pixelHeight": asset.pixelHeight,
        "resources": resourceRows(asset),
        "eligible": eligible,
        "status": eligible ? "candidate" : (rawOnly ? "blocked_by_policy" : "unsupported"),
        "reason": eligible ? "" : (rawOnly ? "RAW-only Photos asset; PBE does not publish RAW masters from direct Photos import." : "No supported photo/video resource found."),
    ]
}

func albumSummary(_ collection: PHAssetCollection) -> [String: Any] {
    let assets = PHAsset.fetchAssets(in: collection, options: nil)
    return [
        "localIdentifier": collection.localIdentifier,
        "title": collection.localizedTitle ?? "(Untitled)",
        "assetCount": assets.count,
        "type": collection.assetCollectionType.rawValue,
        "subtype": collection.assetCollectionSubtype.rawValue,
    ]
}

func preflight(album: PHAssetCollection, limit: Int) -> [String: Any] {
    let assets = PHAsset.fetchAssets(in: album, options: assetFetchOptions(limit: limit))
    var rows: [[String: Any]] = []
    assets.enumerateObjects { asset, index, _ in rows.append(assetRow(asset, index: index + 1)) }
    let candidateCount = rows.filter { ($0["eligible"] as? Bool) == true }.count
    let blockedCount = rows.filter { ($0["eligible"] as? Bool) != true }.count
    return [
        "ok": true,
        "mode": "preflight",
        "album": albumSummary(album),
        "limit": limit,
        "count": rows.count,
        "candidateCount": candidateCount,
        "blockedCount": blockedCount,
        "items": rows,
        "notes": [
            "Uses PhotoKit/Photos automation only; does not read .photoslibrary package internals.",
            "Export/import has not run yet. iCloud-only originals are detected during materialization with network access disabled.",
        ],
    ]
}

func safeFilename(_ name: String, fallback: String) -> String {
    let cleaned = name.replacingOccurrences(of: "/", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty ? fallback : cleaned
}

func writeResource(_ resource: PHAssetResource, to url: URL) -> Result<Void, Error> {
    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = false
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<Void, Error> = .success(())
    PHAssetResourceManager.default().writeData(for: resource, toFile: url, options: options) { error in
        if let error {
            result = .failure(error)
        }
        semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + 600) == .timedOut {
        return .failure(BridgeError(code: "resource_timeout", message: "Timed out while exporting a Photos resource. Confirm the original is local in Photos and retry."))
    }
    return result
}

func materialize(album: PHAssetCollection, destination: URL, limit: Int) throws -> [String: Any] {
    try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
    let assets = PHAsset.fetchAssets(in: album, options: assetFetchOptions(limit: limit))
    var sidecarRows: [[String: Any]] = []
    var itemRows: [[String: Any]] = []
    assets.enumerateObjects { asset, index, _ in
        var row = assetRow(asset, index: index + 1)
        guard (row["eligible"] as? Bool) == true, let resource = preferredResource(asset) else {
            itemRows.append(row)
            return
        }
        let filename = safeFilename(resource.originalFilename, fallback: "apple-photos-\(index + 1)")
        let outputURL = destination.appendingPathComponent(String(format: "%04d-%@", index + 1, filename))
        switch writeResource(resource, to: outputURL) {
        case .success:
            let relativePath = outputURL.lastPathComponent
            row["status"] = "materialized"
            row["relative_path"] = relativePath
            row["path"] = outputURL.path
            sidecarRows.append([
                "relative_path": relativePath,
                "source_anchor": [
                    "path": "apple-photos://\(asset.localIdentifier)",
                    "modified_at": isoDate(asset.modificationDate ?? asset.creationDate),
                    "modified_ns": Int64((asset.modificationDate ?? asset.creationDate ?? Date(timeIntervalSince1970: 0)).timeIntervalSince1970 * 1_000_000_000),
                    "filename": filename,
                    "version": "current",
                ],
                "apple_photos": row,
            ])
        case .failure(let error):
            row["eligible"] = false
            row["status"] = "unavailable_from_icloud"
            row["reason"] = "Original resource is not available locally and network download is disabled for Owner preflight safety: \(error.localizedDescription)"
        }
        itemRows.append(row)
    }
    let sidecar: [String: Any] = [
        "schema": "photosbyelie.apple-photos-source-anchors.v1",
        "created_at": isoDate(Date()),
        "album": albumSummary(album),
        "assets": sidecarRows,
    ]
    let sidecarURL = destination.appendingPathComponent(".pbe-apple-photos-assets.json")
    try jsonData(sidecar).write(to: sidecarURL, options: .atomic)
    return [
        "ok": true,
        "mode": "materialize",
        "album": albumSummary(album),
        "destination": destination.path,
        "sidecar": sidecarURL.path,
        "count": itemRows.count,
        "materializedCount": sidecarRows.count,
        "items": itemRows,
    ]
}

let command = CommandLine.arguments.dropFirst().first ?? ""
if command.isEmpty || command == "--help" {
    printJSON(["ok": true, "usage": "apple_photos_bridge.swift albums | preflight --album-id ID | export --album-id ID --destination PATH"])
    exit(0)
}

requirePhotosAccess()

do {
    switch command {
    case "albums":
        printJSON(["ok": true, "albums": fetchAlbums().map(albumSummary)])
    case "preflight":
        let album = try findAlbum(id: argValue("--album-id"), name: argValue("--album-name"))
        printJSON(preflight(album: album, limit: intArg("--limit")))
    case "export":
        guard let destination = argValue("--destination") else {
            fail("missing_destination", "Missing --destination for Apple Photos export.")
        }
        let album = try findAlbum(id: argValue("--album-id"), name: argValue("--album-name"))
        printJSON(try materialize(album: album, destination: URL(fileURLWithPath: destination), limit: intArg("--limit")))
    default:
        fail("bad_command", "Unknown Apple Photos bridge command: \(command)", status: 2)
    }
} catch let error as BridgeError {
    fail(error.code, error.message)
} catch {
    fail("photos_bridge_error", error.localizedDescription)
}
