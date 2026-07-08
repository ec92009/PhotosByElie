#!/usr/bin/env swift
import AppKit
import CoreLocation
import Foundation
import ImageIO
import Photos

struct BridgeError: Error {
    let code: String
    let message: String
}

extension BridgeError: LocalizedError {
    var errorDescription: String? { message }
}

func jsonData(_ value: Any) -> Data {
    return try! JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
}

func printJSON(_ value: Any) {
    FileHandle.standardOutput.write(jsonData(value))
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func writeResultJSON(_ value: Any) {
    guard let resultDestination = argValue("--result-destination") else { return }
    let resultURL = URL(fileURLWithPath: resultDestination)
    do {
        try FileManager.default.createDirectory(at: resultURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try jsonData(value).write(to: resultURL, options: .atomic)
    } catch {
        // stdout remains the fallback for direct development runs.
    }
}

func outputJSON(_ value: Any) {
    writeResultJSON(value)
    printJSON(value)
}

let progressOutputLock = NSLock()

func emitProgress(_ event: String, _ payload: [String: Any]) {
    var body = payload
    body["event"] = event
    body["ts"] = isoDate(Date())
    guard JSONSerialization.isValidJSONObject(body),
          let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else {
        return
    }
    progressOutputLock.lock()
    defer { progressOutputLock.unlock() }
    FileHandle.standardError.write("PBE_APPLE_PHOTOS_PROGRESS ".data(using: .utf8)!)
    FileHandle.standardError.write(data)
    FileHandle.standardError.write("\n".data(using: .utf8)!)
}

func normalizedProgress(_ progress: Double) -> Double {
    return min(1.0, max(0.0, progress))
}

typealias AssetProgressHandler = (_ progress: Double, _ status: String, _ elapsedSeconds: Double?) -> Void

func fail(_ code: String, _ message: String, status: Int32 = 1) -> Never {
    outputJSON(["ok": false, "code": code, "error": message])
    exit(status)
}

func errorMessage(_ error: Error) -> String {
    if let bridgeError = error as? BridgeError {
        return bridgeError.message
    }
    return error.localizedDescription
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

func boolArg(_ name: String) -> Bool {
    return CommandLine.arguments.contains(name)
}

func requirePhotosAccess() {
    let status = PHPhotoLibrary.authorizationStatus()
    if status == .authorized || status == .limited {
        return
    }
    if status == .denied || status == .restricted {
        fail("permission_denied", "macOS is blocking Apple Photos access for this helper. Enable Photos access for PhotosByElie Photos Bridge in System Settings > Privacy & Security > Photos, then retry.")
    }
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    PHPhotoLibrary.requestAuthorization { nextStatus in
        granted = nextStatus == .authorized || nextStatus == .limited
        semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 120)
    if !granted {
        fail("permission_missing", "Apple Photos permission was not granted. Enable Photos access for PhotosByElie Photos Bridge in System Settings > Privacy & Security > Photos, then retry.")
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

func collectionKind(_ collection: PHAssetCollection) -> String {
    switch collection.assetCollectionType {
    case .album:
        return "album"
    case .smartAlbum:
        return "smart"
    default:
        return "other"
    }
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

func parseISODateArg(_ value: String?) -> Date? {
    guard let value, !value.isEmpty else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) {
        return date
    }
    formatter.formatOptions = [.withInternetDateTime]
    if let date = formatter.date(from: value) {
        return date
    }
    let dayFormatter = DateFormatter()
    dayFormatter.locale = Locale(identifier: "en_US_POSIX")
    dayFormatter.timeZone = TimeZone(secondsFromGMT: 0)
    dayFormatter.dateFormat = "yyyy-MM-dd"
    return dayFormatter.date(from: value)
}

let rawFileExtensions: Set<String> = [
    ".raw", ".dng", ".nef", ".cr2", ".cr3", ".arw", ".raf", ".rw2", ".orf", ".pef", ".srw",
]
let heicFileExtensions: Set<String> = [".heic", ".heif", ".hif"]
let jpegFileExtensions: Set<String> = [".jpg", ".jpeg", ".jpe"]
let pngFileExtensions: Set<String> = [".png"]
let tiffFileExtensions: Set<String> = [".tif", ".tiff"]
let videoFileExtensions: Set<String> = [".mov", ".mp4", ".m4v"]
let localJPEGConvertibleImageExtensions: Set<String> = heicFileExtensions
    .union(jpegFileExtensions)
    .union(pngFileExtensions)
    .union(tiffFileExtensions)
    .union(rawFileExtensions)

func fileExtension(_ filename: String) -> String {
    return URL(fileURLWithPath: filename).pathExtension.lowercased()
}

func hasExtension(_ filename: String, in extensions: Set<String>) -> Bool {
    let ext = fileExtension(filename)
    return !ext.isEmpty && extensions.contains(".\(ext)")
}

func resourceUTI(_ resource: PHAssetResource) -> String {
    return resource.uniformTypeIdentifier.lowercased()
}

func resourceFormat(_ resource: PHAssetResource) -> String {
    let uti = resourceUTI(resource)
    if hasExtension(resource.originalFilename, in: rawFileExtensions)
        || uti.contains("raw")
        || uti.contains("digital-camera-raw") {
        return "RAW"
    }
    if hasExtension(resource.originalFilename, in: heicFileExtensions)
        || uti.contains("heic")
        || uti.contains("heif") {
        return "HEIC"
    }
    if hasExtension(resource.originalFilename, in: jpegFileExtensions)
        || uti.contains("jpeg")
        || uti.contains("jpg") {
        return "JPEG"
    }
    if hasExtension(resource.originalFilename, in: pngFileExtensions)
        || uti.contains("png") {
        return "PNG"
    }
    if hasExtension(resource.originalFilename, in: tiffFileExtensions)
        || uti.contains("tiff") {
        return "TIFF"
    }
    if hasExtension(resource.originalFilename, in: videoFileExtensions)
        || uti.contains("movie")
        || uti.contains("video")
        || uti.contains("mpeg-4") {
        return "MOV"
    }
    let ext = fileExtension(resource.originalFilename)
    if !ext.isEmpty {
        return ext.uppercased()
    }
    return uti.isEmpty ? "Unknown" : uti
}

func isJPEGConvertibleImageResource(_ resource: PHAssetResource) -> Bool {
    let format = resourceFormat(resource)
    if format == "MOV" {
        return false
    }
    if hasExtension(resource.originalFilename, in: localJPEGConvertibleImageExtensions) {
        return true
    }
    let uti = resourceUTI(resource)
    return uti.contains("heic")
        || uti.contains("heif")
        || uti.contains("jpeg")
        || uti.contains("jpg")
        || uti.contains("png")
        || uti.contains("tiff")
        || uti.contains("raw")
        || uti.contains("digital-camera-raw")
}

func imageFallbackResourceTypePriority(_ resource: PHAssetResource) -> Int {
    switch resource.type {
    case .fullSizePhoto:
        return 0
    case .photo:
        return 1
    case .alternatePhoto:
        return 2
    case .adjustmentBasePhoto:
        return 3
    default:
        return 9
    }
}

func imageFallbackResourceFormatPriority(_ resource: PHAssetResource) -> Int {
    let format = resourceFormat(resource)
    if format == "JPEG" { return 0 }
    if format == "HEIC" { return 1 }
    if format == "PNG" || format == "TIFF" { return 2 }
    if format == "RAW" { return 3 }
    return 9
}

func imageFallbackResourceCandidates(_ asset: PHAsset) -> [PHAssetResource] {
    guard asset.mediaType == .image else { return [] }
    return PHAssetResource.assetResources(for: asset)
        .filter(isJPEGConvertibleImageResource)
        .sorted { lhs, rhs in
            let lhsType = imageFallbackResourceTypePriority(lhs)
            let rhsType = imageFallbackResourceTypePriority(rhs)
            if lhsType != rhsType { return lhsType < rhsType }
            let lhsFormat = imageFallbackResourceFormatPriority(lhs)
            let rhsFormat = imageFallbackResourceFormatPriority(rhs)
            if lhsFormat != rhsFormat { return lhsFormat < rhsFormat }
            return lhs.originalFilename < rhs.originalFilename
        }
}

func resourceFormatSummary(_ resources: [PHAssetResource]) -> [String: Any] {
    var formats: [String] = []
    var counts: [String: Int] = [:]
    for resource in resources {
        let format = resourceFormat(resource)
        if !formats.contains(format) {
            formats.append(format)
        }
        counts[format] = (counts[format] ?? 0) + 1
    }
    let label = formats.isEmpty ? "Unknown" : formats.joined(separator: "+")
    return [
        "label": label,
        "formats": formats,
        "counts": counts,
    ]
}

func resourceRows(_ asset: PHAsset) -> [[String: Any]] {
    return PHAssetResource.assetResources(for: asset).map { resource in
        let ext = fileExtension(resource.originalFilename)
        var row: [String: Any] = [
            "type": resource.type.rawValue,
            "uniformTypeIdentifier": resource.uniformTypeIdentifier,
            "originalFilename": resource.originalFilename,
            "format": resourceFormat(resource),
            "jpegFallbackCompatible": isJPEGConvertibleImageResource(resource),
        ]
        if !ext.isEmpty {
            row["fileExtension"] = ext.uppercased()
        }
        return row
    }
}

func assetLocationRow(_ asset: PHAsset) -> [String: Any]? {
    guard let location = asset.location else { return nil }
    var row: [String: Any] = [
        "latitude": location.coordinate.latitude,
        "longitude": location.coordinate.longitude,
        "timestamp": isoDate(location.timestamp),
    ]
    if location.altitude.isFinite {
        row["altitude"] = location.altitude
    }
    if location.horizontalAccuracy >= 0 {
        row["horizontalAccuracy"] = location.horizontalAccuracy
    }
    if location.verticalAccuracy >= 0 {
        row["verticalAccuracy"] = location.verticalAccuracy
    }
    return row
}

func compactString(_ value: Any?) -> String {
    guard let value else { return "" }
    return String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
}

func selectorValue(_ asset: PHAsset, _ selectorName: String) -> Any? {
    let selector = NSSelectorFromString(selectorName)
    guard asset.responds(to: selector) else { return nil }
    return asset.value(forKey: selectorName)
}

func firstAssetString(_ asset: PHAsset, selectors: [String]) -> String {
    for selector in selectors {
        let value = compactString(selectorValue(asset, selector))
        if !value.isEmpty {
            return value
        }
    }
    return ""
}

func assetStringArray(_ asset: PHAsset, selectors: [String]) -> [String] {
    for selector in selectors {
        guard let value = selectorValue(asset, selector) else { continue }
        if let strings = value as? [String] {
            let cleaned = strings.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            if !cleaned.isEmpty { return cleaned }
        }
        if let array = value as? NSArray {
            let cleaned = array.compactMap { item -> String? in
                let text = compactString(item)
                return text.isEmpty ? nil : text
            }
            if !cleaned.isEmpty { return cleaned }
        }
        let text = compactString(value)
        if !text.isEmpty {
            return text
                .split(separator: ",")
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        }
    }
    return []
}

func assetPhotosMetadata(_ asset: PHAsset) -> [String: Any] {
    var row: [String: Any] = [:]
    let title = firstAssetString(asset, selectors: ["title", "localizedTitle"])
    let keywords = assetStringArray(asset, selectors: ["keywordTitles", "keywords"])
    if !title.isEmpty {
        row["title"] = title
    }
    if !keywords.isEmpty {
        row["keywords"] = keywords
    }
    return row
}

struct AssetPlan {
    let asset: PHAsset
    let index: Int
    var row: [String: Any]
}

func preferredResource(_ asset: PHAsset) -> PHAssetResource? {
    let resources = PHAssetResource.assetResources(for: asset)
    let preferredTypes: [PHAssetResourceType]
    if asset.mediaType == .video {
        preferredTypes = [.fullSizeVideo, .video]
    } else if asset.mediaType == .image {
        preferredTypes = [.fullSizePhoto, .photo]
        for type in preferredTypes {
            if let found = resources.first(where: { $0.type == type && !hasExtension($0.originalFilename, in: rawFileExtensions) }) {
                return found
            }
        }
    } else {
        return nil
    }
    for type in preferredTypes {
        if let found = resources.first(where: { $0.type == type }) {
            return found
        }
    }
    return nil
}

func exportStrategy(_ asset: PHAsset) -> String {
    if asset.mediaType == .image {
        return "rendered_jpeg"
    }
    if preferredResource(asset) != nil && asset.mediaType == .video {
        return "resource"
    }
    return "unsupported"
}

func assetRow(_ asset: PHAsset, index: Int) -> [String: Any] {
    let resources = PHAssetResource.assetResources(for: asset)
    let fallbackResource = imageFallbackResourceCandidates(asset).first
    let resource = preferredResource(asset)
    let displayResource = fallbackResource ?? resource
    let strategy = exportStrategy(asset)
    let mediaType = asset.mediaType == .video ? "video" : asset.mediaType == .image ? "photo" : "unsupported"
    let eligible = strategy == "resource" || strategy == "rendered_jpeg"
    let filename = strategy == "rendered_jpeg"
        ? renderedJPEGFilename(asset: asset, index: index, resource: displayResource)
        : resource?.originalFilename ?? ""
    let summary = resourceFormatSummary(resources)
    let reason = eligible
        ? (mediaType == "photo" ? "Photos still image will import as the current rendered JPG from Photos." : "")
        : "No supported photo/video resource found."
    var row: [String: Any] = [
        "index": index,
        "localIdentifier": asset.localIdentifier,
        "sourceAnchor": "apple-photos://\(asset.localIdentifier)",
        "filename": filename,
        "mediaType": mediaType,
        "creationDate": isoDate(asset.creationDate),
        "modificationDate": isoDate(asset.modificationDate),
        "pixelWidth": asset.pixelWidth,
        "pixelHeight": asset.pixelHeight,
        "duration": asset.duration,
        "favorite": asset.isFavorite,
        "hidden": asset.isHidden,
        "mediaSubtypeRaw": asset.mediaSubtypes.rawValue,
        "resources": resourceRows(asset),
        "resourceFormat": summary["label"] as? String ?? "Unknown",
        "resourceFormats": summary["formats"] as? [String] ?? [],
        "resourceFormatCounts": summary["counts"] as? [String: Int] ?? [:],
        "preferredResourceFilename": resource?.originalFilename ?? "",
        "preferredResourceFormat": resource.map(resourceFormat) ?? "",
        "fallbackResourceFilename": fallbackResource?.originalFilename ?? "",
        "fallbackResourceFormat": fallbackResource.map(resourceFormat) ?? "",
        "localJPEGFallbackAvailable": fallbackResource != nil,
        "eligible": eligible,
        "exportStrategy": strategy,
        "status": eligible ? "candidate" : "unsupported",
        "reason": reason,
    ]
    if let location = assetLocationRow(asset) {
        row["location"] = location
    }
    let photosMetadata = assetPhotosMetadata(asset)
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

func libraryFetchOptions(limit: Int, offset: Int, dateFrom: Date?, dateTo: Date?) -> PHFetchOptions {
    let options = PHFetchOptions()
    options.sortDescriptors = [
        NSSortDescriptor(key: "creationDate", ascending: false),
    ]
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
    if limit > 0 {
        options.fetchLimit = max(0, offset) + limit
    }
    return options
}

func libraryIndex(limit: Int, offset: Int, dateFrom: Date?, dateTo: Date?) -> [String: Any] {
    let safeOffset = max(0, offset)
    let safeLimit = limit > 0 ? min(limit, 1000) : 120
    let options = libraryFetchOptions(limit: safeLimit, offset: safeOffset, dateFrom: dateFrom, dateTo: dateTo)
    let assets = PHAsset.fetchAssets(with: options)
    var rows: [[String: Any]] = []
    var skipped = 0
    assets.enumerateObjects { asset, index, stop in
        if index < safeOffset {
            skipped += 1
            return
        }
        if rows.count >= safeLimit {
            stop.pointee = true
            return
        }
        rows.append(assetRow(asset, index: index + 1))
    }
    return [
        "ok": true,
        "mode": "library-index",
        "limit": safeLimit,
        "offset": safeOffset,
        "count": rows.count,
        "fetchedCount": assets.count,
        "skippedCount": skipped,
        "dateFrom": isoDate(dateFrom),
        "dateTo": isoDate(dateTo),
        "items": rows,
        "notes": [
            "Uses PhotoKit metadata only; does not read .photoslibrary package internals.",
            "Sidecar culling decisions are local-first. Photos keyword/title write-back is staged separately.",
        ],
    ]
}

func writeLibraryIndexFile(destination: URL, dateFrom: Date?, dateTo: Date?, progressEvery: Int) throws -> [String: Any] {
    let safeProgressEvery = max(1, progressEvery)
    let options = libraryFetchOptions(limit: 0, offset: 0, dateFrom: dateFrom, dateTo: dateTo)
    let assets = PHAsset.fetchAssets(with: options)
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: destination.path, contents: nil)
    let handle = try FileHandle(forWritingTo: destination)
    defer { handle.closeFile() }

    let totalCount = assets.count
    emitProgress("library_index_start", [
        "destination": destination.path,
        "totalCount": totalCount,
        "dateFrom": isoDate(dateFrom),
        "dateTo": isoDate(dateTo),
    ])

    var indexedCount = 0
    var writeError: Error?
    assets.enumerateObjects { asset, index, stop in
        let row = assetRow(asset, index: index + 1)
        guard JSONSerialization.isValidJSONObject(row),
              let data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]) else {
            writeError = BridgeError(code: "index_row_invalid", message: "Apple Photos asset metadata could not be encoded for local indexing.")
            stop.pointee = true
            return
        }
        handle.write(data)
        handle.write("\n".data(using: .utf8)!)
        indexedCount += 1
        if indexedCount == 1 || indexedCount == totalCount || indexedCount % safeProgressEvery == 0 {
            emitProgress("library_index_progress", [
                "destination": destination.path,
                "indexedCount": indexedCount,
                "totalCount": totalCount,
                "progress": totalCount > 0 ? Double(indexedCount) / Double(totalCount) : 1.0,
            ])
        }
    }
    if let writeError {
        throw writeError
    }
    emitProgress("library_index_done", [
        "destination": destination.path,
        "indexedCount": indexedCount,
        "totalCount": totalCount,
        "dateFrom": isoDate(dateFrom),
        "dateTo": isoDate(dateTo),
    ])
    return [
        "ok": true,
        "mode": "library-index-file",
        "destination": destination.path,
        "count": indexedCount,
        "totalCount": totalCount,
        "dateFrom": isoDate(dateFrom),
        "dateTo": isoDate(dateTo),
        "notes": [
            "Metadata-only index scan; previews, videos, originals, and iCloud downloads are not requested.",
            "Uses PhotoKit metadata only; does not read .photoslibrary package internals.",
        ],
    ]
}

func findAsset(id: String?) throws -> PHAsset {
    guard let id, !id.isEmpty else {
        throw BridgeError(code: "missing_asset_id", message: "Missing Apple Photos asset identifier.")
    }
    let result = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil)
    guard let asset = result.firstObject else {
        throw BridgeError(code: "asset_not_found", message: "Apple Photos asset not found.")
    }
    return asset
}

func writePreviewJPEG(asset: PHAsset, destination: URL, maxPixel: Int) throws -> [String: Any] {
    guard asset.mediaType == .image || asset.mediaType == .video else {
        throw BridgeError(code: "preview_unsupported", message: "Sidecar preview export currently supports still images and video poster frames.")
    }
    let pixel = max(256, min(maxPixel, 1800))
    let target = CGSize(width: pixel, height: pixel)
    let options = PHImageRequestOptions()
    options.isNetworkAccessAllowed = false
    options.deliveryMode = .opportunistic
    options.resizeMode = .fast
    options.version = .current
    let semaphore = DispatchSemaphore(value: 0)
    var capturedImage: NSImage?
    var capturedInfo: [AnyHashable: Any] = [:]
    let requestId = PHImageManager.default().requestImage(
        for: asset,
        targetSize: target,
        contentMode: .aspectFit,
        options: options
    ) { image, info in
        if let info {
            capturedInfo = info
        }
        if let image {
            capturedImage = image
        }
        semaphore.signal()
    }
    var photoKitFailure: Error?
    if semaphore.wait(timeout: .now() + 6) == .timedOut {
        PHImageManager.default().cancelImageRequest(requestId)
        photoKitFailure = BridgeError(code: "preview_timeout", message: "Timed out while asking Photos for a local preview.")
    } else if capturedInfo[PHImageResultIsInCloudKey] as? Bool == true && capturedImage == nil {
        photoKitFailure = BridgeError(code: "preview_needs_icloud", message: "Photos reports this preview is only available from iCloud; Sidecar preview did not download it.")
    }
    var smallPhotoKitPreview: (data: Data, bitmap: NSBitmapImageRep)?
    if let image = capturedImage,
       let tiff = image.tiffRepresentation,
       let bitmap = NSBitmapImageRep(data: tiff),
       let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.86]) {
        let minimumUsefulPixel = min(256, max(128, pixel / 2))
        if max(bitmap.pixelsWide, bitmap.pixelsHigh) < minimumUsefulPixel {
            smallPhotoKitPreview = (data: data, bitmap: bitmap)
        } else {
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: destination, options: .atomic)
            return [
                "ok": true,
                "mode": "preview",
                "localIdentifier": asset.localIdentifier,
                "destination": destination.path,
                "bytes": data.count,
                "pixelWidth": bitmap.pixelsWide,
                "pixelHeight": bitmap.pixelsHigh,
                "networkAccessAllowed": false,
                "previewSource": asset.mediaType == .video ? "photokit_video_poster" : "photokit_render",
            ]
        }
    }

    let fallbackReason = photoKitFailure.map(errorMessage)
        ?? (smallPhotoKitPreview == nil
            ? "Photos did not provide a local preview image."
            : "Photos only provided a tiny degraded preview image.")
    if asset.mediaType == .video {
        if let smallPhotoKitPreview {
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try smallPhotoKitPreview.data.write(to: destination, options: .atomic)
            let bitmap = smallPhotoKitPreview.bitmap
            return [
                "ok": true,
                "mode": "preview",
                "localIdentifier": asset.localIdentifier,
                "destination": destination.path,
                "bytes": smallPhotoKitPreview.data.count,
                "pixelWidth": bitmap.pixelsWide,
                "pixelHeight": bitmap.pixelsHigh,
                "networkAccessAllowed": false,
                "previewSource": "photokit_degraded_video_poster",
            ]
        }
        throw BridgeError(code: "preview_unavailable", message: "\(fallbackReason) Sidecar did not download the video from iCloud.")
    }
    switch writeLocalImageResourcePreviewJPEG(asset, to: destination, maxPixel: pixel) {
    case .success(var payload):
        payload["photoKitFallbackReason"] = fallbackReason
        return payload
    case .failure(let fallbackError):
        if let smallPhotoKitPreview {
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try smallPhotoKitPreview.data.write(to: destination, options: .atomic)
            let bitmap = smallPhotoKitPreview.bitmap
            return [
                "ok": true,
                "mode": "preview",
                "localIdentifier": asset.localIdentifier,
                "destination": destination.path,
                "bytes": smallPhotoKitPreview.data.count,
                "pixelWidth": bitmap.pixelsWide,
                "pixelHeight": bitmap.pixelsHigh,
                "networkAccessAllowed": false,
                "previewSource": "photokit_degraded",
                "localPreviewFallbackError": errorMessage(fallbackError),
            ]
        }
        throw BridgeError(
            code: "preview_unavailable",
            message: "\(fallbackReason) Local preview fallback also failed: \(errorMessage(fallbackError))"
        )
    }
}

func videoMimeType(_ resource: PHAssetResource) -> String {
    let ext = fileExtension(resource.originalFilename)
    if ext == "mp4" || ext == "m4v" {
        return "video/mp4"
    }
    return "video/quicktime"
}

func videoDestinationURL(base destination: URL, resource: PHAssetResource) -> URL {
    let ext = fileExtension(resource.originalFilename)
    let safeExt = ext.isEmpty ? "mov" : ext
    if destination.pathExtension.isEmpty {
        return destination.appendingPathExtension(safeExt)
    }
    return destination
}

func writeVideoResource(asset: PHAsset, destination: URL) throws -> [String: Any] {
    guard asset.mediaType == .video else {
        throw BridgeError(code: "video_unsupported", message: "Selected Apple Photos asset is not a video.")
    }
    guard let resource = preferredResource(asset) else {
        throw BridgeError(code: "video_resource_unavailable", message: "Photos did not expose a local video resource for this asset.")
    }
    let outputURL = videoDestinationURL(base: destination, resource: resource)
    try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    switch writeResource(resource, to: outputURL, allowIcloudDownloads: false, timeoutSeconds: 90) {
    case .success:
        return [
            "ok": true,
            "mode": "video",
            "localIdentifier": asset.localIdentifier,
            "destination": outputURL.path,
            "bytes": (try? Data(contentsOf: outputURL).count) ?? 0,
            "networkAccessAllowed": false,
            "resourceFilename": resource.originalFilename,
            "resourceFormat": resourceFormat(resource),
            "mimeType": videoMimeType(resource),
        ]
    case .failure(let error):
        throw BridgeError(code: "video_unavailable", message: "Sidecar could not export a local video preview without iCloud downloads: \(errorMessage(error))")
    }
}

func burstSurvivorPositions(size: Int) -> Set<Int> {
    if size <= 1 {
        return [1]
    }
    if size <= 5 {
        return [2]
    }
    return Set(stride(from: 2, through: size, by: 4))
}

func isStandardBurstFilterPhoto(_ plan: AssetPlan) -> Bool {
    guard (plan.row["eligible"] as? Bool) == true, assetMediaType(plan.asset) == "photo" else {
        return false
    }
    if plan.asset.creationDate == nil {
        return false
    }
    let width = Double(plan.asset.pixelWidth)
    let height = Double(plan.asset.pixelHeight)
    if width > 0 && height > 0 && max(width / height, height / width) >= 2.0 {
        return false
    }
    return true
}

func assetMediaType(_ asset: PHAsset) -> String {
    return asset.mediaType == .video ? "video" : asset.mediaType == .image ? "photo" : "unsupported"
}

func applyBurstFilter(_ plans: inout [AssetPlan], enabled: Bool) -> [String: Any] {
    var summary: [String: Any] = [
        "enabled": enabled,
        "mode": "conservative-preconversion",
        "burstGroups": 0,
        "survivorCount": 0,
        "nonBurstKept": 0,
        "skippedCount": 0,
    ]
    guard enabled else {
        return summary
    }
    var candidates: [(planIndex: Int, date: Date)] = []
    for (planIndex, plan) in plans.enumerated() {
        if isStandardBurstFilterPhoto(plan), let date = plan.asset.creationDate {
            candidates.append((planIndex, date))
        }
    }
    candidates.sort { lhs, rhs in
        if lhs.date == rhs.date {
            return plans[lhs.planIndex].index < plans[rhs.planIndex].index
        }
        return lhs.date < rhs.date
    }

    var groups: [[(planIndex: Int, date: Date)]] = []
    var current: [(planIndex: Int, date: Date)] = []
    var previous: (planIndex: Int, date: Date)?
    for candidate in candidates {
        if let previous, candidate.date.timeIntervalSince(previous.date) < 1 {
            current.append(candidate)
        } else {
            if !current.isEmpty {
                groups.append(current)
            }
            current = [candidate]
        }
        previous = candidate
    }
    if !current.isEmpty {
        groups.append(current)
    }

    var burstGroups = 0
    var survivorCount = 0
    var nonBurstKept = 0
    var skippedCount = 0
    for group in groups {
        if group.count == 1 {
            let planIndex = group[0].planIndex
            plans[planIndex].row["burstFilterOutcome"] = "non-burst-keep"
            nonBurstKept += 1
            continue
        }
        burstGroups += 1
        let burstId = String(format: "burst-%05d", burstGroups)
        let survivors = burstSurvivorPositions(size: group.count)
        for (offset, candidate) in group.enumerated() {
            let position = offset + 1
            let planIndex = candidate.planIndex
            plans[planIndex].row["burstFilterId"] = burstId
            plans[planIndex].row["burstFilterPosition"] = position
            plans[planIndex].row["burstFilterSize"] = group.count
            if survivors.contains(position) {
                plans[planIndex].row["burstFilterOutcome"] = "survivor-keep"
                survivorCount += 1
            } else {
                plans[planIndex].row["eligible"] = false
                plans[planIndex].row["status"] = "blocked_by_policy"
                plans[planIndex].row["reason"] = "Burst filter skipped this near-duplicate before conversion."
                plans[planIndex].row["burstFilterOutcome"] = "waste-basket"
                skippedCount += 1
            }
        }
    }

    summary["burstGroups"] = burstGroups
    summary["survivorCount"] = survivorCount
    summary["nonBurstKept"] = nonBurstKept
    summary["skippedCount"] = skippedCount
    return summary
}

func plannedAssets(album: PHAssetCollection, limit: Int, filterBursts: Bool) -> ([AssetPlan], [String: Any]) {
    let assets = PHAsset.fetchAssets(in: album, options: assetFetchOptions(limit: limit))
    var plans: [AssetPlan] = []
    assets.enumerateObjects { asset, index, _ in
        plans.append(AssetPlan(asset: asset, index: index + 1, row: assetRow(asset, index: index + 1)))
    }
    let burstFilter = applyBurstFilter(&plans, enabled: filterBursts)
    return (plans, burstFilter)
}

func albumSummary(_ collection: PHAssetCollection) -> [String: Any] {
    let assets = PHAsset.fetchAssets(in: collection, options: nil)
    return [
        "localIdentifier": collection.localIdentifier,
        "title": collection.localizedTitle ?? "(Untitled)",
        "assetCount": assets.count,
        "kind": collectionKind(collection),
        "type": collection.assetCollectionType.rawValue,
        "subtype": collection.assetCollectionSubtype.rawValue,
    ]
}

func preflight(album: PHAssetCollection, limit: Int, filterBursts: Bool, allowIcloudDownloads: Bool) -> [String: Any] {
    let (plans, burstFilter) = plannedAssets(album: album, limit: limit, filterBursts: filterBursts)
    let rows = plans.map { $0.row }
    let candidateCount = rows.filter { ($0["eligible"] as? Bool) == true }.count
    let blockedCount = rows.filter { ($0["eligible"] as? Bool) != true }.count
    var formatCounts: [String: Int] = [:]
    var fallbackCount = 0
    for row in rows {
        let format = row["resourceFormat"] as? String ?? "Unknown"
        formatCounts[format] = (formatCounts[format] ?? 0) + 1
        if row["localJPEGFallbackAvailable"] as? Bool == true {
            fallbackCount += 1
        }
    }
    return [
        "ok": true,
        "mode": "preflight",
        "album": albumSummary(album),
        "limit": limit,
        "count": rows.count,
        "candidateCount": candidateCount,
        "blockedCount": blockedCount,
        "resourceFormatCounts": formatCounts,
        "localJPEGFallbackCount": fallbackCount,
        "burstFilter": burstFilter,
        "icloudDownloads": [
            "enabled": allowIcloudDownloads,
        ],
        "items": rows,
        "notes": [
            "Uses PhotoKit/Photos automation only; does not read .photoslibrary package internals.",
            allowIcloudDownloads
                ? "Export/import has not run yet. Materialization may ask Photos to download missing originals or rendered JPGs from iCloud."
                : "Export/import has not run yet. iCloud-only originals or rendered JPGs are detected during materialization with network access disabled.",
        ],
    ]
}

func safeFilename(_ name: String, fallback: String) -> String {
    let cleaned = name.replacingOccurrences(of: "/", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty ? fallback : cleaned
}

func filenameStem(_ name: String, fallback: String) -> String {
    let safe = safeFilename(name, fallback: fallback)
    let url = URL(fileURLWithPath: safe)
    let stem = url.deletingPathExtension().lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
    return stem.isEmpty ? fallback : stem
}

func renderedJPEGFilename(asset: PHAsset, index: Int, resource: PHAssetResource?) -> String {
    let fallback = "apple-photos-\(index)"
    let sourceName = resource?.originalFilename ?? fallback
    return "\(filenameStem(sourceName, fallback: fallback)).jpg"
}

func localImageResourceForJPEGFallback(_ asset: PHAsset) -> PHAssetResource? {
    return imageFallbackResourceCandidates(asset).first
}

func temporaryResourceURL(for outputURL: URL, resource: PHAssetResource) -> URL {
    let fallback = outputURL.deletingPathExtension().lastPathComponent
    let safeSource = safeFilename(resource.originalFilename, fallback: "\(fallback)-source")
    let sourceURL = URL(fileURLWithPath: safeSource)
    let ext = sourceURL.pathExtension.isEmpty ? "img" : sourceURL.pathExtension
    return outputURL.deletingLastPathComponent().appendingPathComponent(
        ".\(fallback)-source-\(UUID().uuidString).\(ext)"
    )
}

func convertImageResourceToJPEG(sourceURL: URL, destinationURL: URL) -> Result<Void, Error> {
    guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) else {
        return .failure(BridgeError(code: "source_image_unreadable", message: "Could not read the local image resource for JPEG conversion."))
    }
    guard CGImageSourceGetCount(source) > 0 else {
        return .failure(BridgeError(code: "source_image_empty", message: "The local image resource did not contain an image frame."))
    }
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
    let width = properties[kCGImagePropertyPixelWidth] as? Int ?? 0
    let height = properties[kCGImagePropertyPixelHeight] as? Int ?? 0
    let maxPixel = max(width, height, 256)
    let thumbnailOptions: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixel,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions as CFDictionary) else {
        return .failure(BridgeError(code: "jpeg_conversion_failed", message: "Could not apply the local image orientation transform."))
    }
    guard let destination = CGImageDestinationCreateWithURL(destinationURL as CFURL, "public.jpeg" as CFString, 1, nil) else {
        return .failure(BridgeError(code: "jpeg_destination_failed", message: "Could not create the temporary JPEG destination."))
    }
    let destinationProperties: [CFString: Any] = [
        kCGImageDestinationLossyCompressionQuality: 0.95,
    ]
    CGImageDestinationAddImage(destination, image, destinationProperties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
        return .failure(BridgeError(code: "jpeg_conversion_failed", message: "Could not convert the local image resource to JPEG."))
    }
    return .success(())
}

func convertImageResourceToPreviewJPEG(sourceURL: URL, destinationURL: URL, maxPixel: Int) -> Result<[String: Int], Error> {
    guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) else {
        return .failure(BridgeError(code: "source_image_unreadable", message: "Could not read the local image resource for preview conversion."))
    }
    guard CGImageSourceGetCount(source) > 0 else {
        return .failure(BridgeError(code: "source_image_empty", message: "The local image resource did not contain an image frame for preview conversion."))
    }
    let pixel = max(256, min(maxPixel, 1800))
    let thumbnailOptions: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: pixel,
    ]
    guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions as CFDictionary) else {
        return .failure(BridgeError(code: "preview_thumbnail_failed", message: "Could not downsample the local image resource for preview."))
    }
    do {
        try FileManager.default.createDirectory(at: destinationURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    } catch {
        return .failure(error)
    }
    guard let destination = CGImageDestinationCreateWithURL(destinationURL as CFURL, "public.jpeg" as CFString, 1, nil) else {
        return .failure(BridgeError(code: "jpeg_destination_failed", message: "Could not create the preview JPEG destination."))
    }
    let properties: [CFString: Any] = [
        kCGImageDestinationLossyCompressionQuality: 0.86,
    ]
    CGImageDestinationAddImage(destination, thumbnail, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
        return .failure(BridgeError(code: "preview_conversion_failed", message: "Could not write the preview JPEG."))
    }
    return .success([
        "pixelWidth": thumbnail.width,
        "pixelHeight": thumbnail.height,
    ])
}

func writeLocalImageResourcePreviewJPEG(_ asset: PHAsset, to url: URL, maxPixel: Int) -> Result<[String: Any], Error> {
    guard let resource = localImageResourceForJPEGFallback(asset) else {
        return .failure(BridgeError(
            code: "local_preview_resource_unavailable",
            message: "Photos did not expose a local image resource that Sidecar can convert for preview."
        ))
    }
    let tempURL = temporaryResourceURL(for: url, resource: resource)
    defer { try? FileManager.default.removeItem(at: tempURL) }
    do {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    } catch {
        return .failure(error)
    }
    switch writeResource(resource, to: tempURL, allowIcloudDownloads: false, timeoutSeconds: 8) {
    case .success:
        switch convertImageResourceToPreviewJPEG(sourceURL: tempURL, destinationURL: url, maxPixel: maxPixel) {
        case .success(let dimensions):
            return .success([
                "ok": true,
                "mode": "preview",
                "localIdentifier": asset.localIdentifier,
                "destination": url.path,
                "bytes": (try? Data(contentsOf: url).count) ?? 0,
                "pixelWidth": dimensions["pixelWidth"] ?? 0,
                "pixelHeight": dimensions["pixelHeight"] ?? 0,
                "networkAccessAllowed": false,
                "previewSource": "local_resource",
                "fallbackResourceFilename": resource.originalFilename,
                "fallbackResourceFormat": resourceFormat(resource),
            ])
        case .failure(let error):
            return .failure(error)
        }
    case .failure(let error):
        return .failure(error)
    }
}

func writeLocalImageResourceAsJPEG(_ asset: PHAsset, to url: URL, allowIcloudDownloads: Bool, progressHandler: AssetProgressHandler? = nil) -> Result<Void, Error> {
    guard let resource = localImageResourceForJPEGFallback(asset) else {
        return .failure(BridgeError(
            code: "local_image_resource_unavailable",
            message: "Photos did not expose a local JPEG/HEIC/RAW image resource that Owner can convert after the rendered JPEG stalled."
        ))
    }
    let tempURL = temporaryResourceURL(for: url, resource: resource)
    defer { try? FileManager.default.removeItem(at: tempURL) }
    progressHandler?(0.0, "exporting_local_resource", nil)
    let resourceResult = writeResource(resource, to: tempURL, allowIcloudDownloads: allowIcloudDownloads) { progress, status, elapsedSeconds in
        let mappedStatus: String
        if status == "waiting_for_file" {
            mappedStatus = "waiting_for_local_resource"
        } else if status == "downloading" || status == "exporting_resource" {
            mappedStatus = "exporting_local_resource"
        } else {
            mappedStatus = status
        }
        progressHandler?(progress, mappedStatus, elapsedSeconds)
    }
    switch resourceResult {
    case .success:
        progressHandler?(1.0, "converting_local_jpeg", nil)
        let conversionResult = convertImageResourceToJPEG(sourceURL: tempURL, destinationURL: url)
        if case .success = conversionResult {
            progressHandler?(1.0, "writing_file", nil)
        }
        return conversionResult
    case .failure(let error):
        return .failure(error)
    }
}

func writeRenderedJPEG(_ asset: PHAsset, to url: URL, allowIcloudDownloads: Bool, progressHandler: AssetProgressHandler? = nil) -> Result<Void, Error> {
    let renderOverallTimeoutSeconds: TimeInterval = 240
    let localFallbackAvailable = localImageResourceForJPEGFallback(asset) != nil
    let renderAfterPhotoKitCompleteTimeoutSeconds: TimeInterval = localFallbackAvailable ? 6 : 45
    let renderBeforeLocalFallbackTimeoutSeconds: TimeInterval = 10
    let heartbeatSeconds: TimeInterval = 5
    let progressStateLock = NSLock()
    var lastPhotoKitProgress = 0.0
    var photoKitCompleteAt: Date?
    let options = PHImageRequestOptions()
    options.version = .current
    options.deliveryMode = .highQualityFormat
    options.resizeMode = .none
    options.isNetworkAccessAllowed = allowIcloudDownloads
    options.isSynchronous = false
    options.progressHandler = { progress, _, _, _ in
        let normalized = normalizedProgress(progress)
        progressStateLock.lock()
        lastPhotoKitProgress = max(lastPhotoKitProgress, normalized)
        if normalized >= 0.999 && photoKitCompleteAt == nil {
            photoKitCompleteAt = Date()
        }
        progressStateLock.unlock()
        progressHandler?(normalized, "downloading", nil)
    }

    let semaphore = DispatchSemaphore(value: 0)
    var renderedImage: NSImage?
    var requestInfo: [AnyHashable: Any] = [:]

    let startedAt = Date()
    var lastHeartbeatAt = Date.distantPast
    let requestId = PHImageManager.default().requestImage(
        for: asset,
        targetSize: PHImageManagerMaximumSize,
        contentMode: .aspectFit,
        options: options
    ) { image, info in
        requestInfo = info ?? [:]
        let degraded = requestInfo[PHImageResultIsDegradedKey] as? Bool ?? false
        if degraded {
            return
        }
        renderedImage = image
        semaphore.signal()
    }

    while semaphore.wait(timeout: .now() + 1) == .timedOut {
        let now = Date()
        let elapsed = now.timeIntervalSince(startedAt)
        progressStateLock.lock()
        let observedProgress = lastPhotoKitProgress
        let completedFor = photoKitCompleteAt.map { now.timeIntervalSince($0) }
        progressStateLock.unlock()
        if now.timeIntervalSince(lastHeartbeatAt) >= heartbeatSeconds {
            let status = observedProgress >= 0.999 ? "waiting_for_render" : "waiting_for_photos"
            progressHandler?(observedProgress, status, elapsed)
            lastHeartbeatAt = now
        }
        if let completedFor, completedFor >= renderAfterPhotoKitCompleteTimeoutSeconds {
            PHImageManager.default().cancelImageRequest(requestId)
            let localFallbackSuffix = localFallbackAvailable ? " Owner will try the local image-source fallback next." : ""
            return .failure(BridgeError(
                code: "render_completion_timeout",
                message: "Photos reported the rendered asset at 100% but did not provide the JPEG callback after \(Int(renderAfterPhotoKitCompleteTimeoutSeconds)) seconds.\(localFallbackSuffix)"
            ))
        }
        if localFallbackAvailable && elapsed >= renderBeforeLocalFallbackTimeoutSeconds {
            PHImageManager.default().cancelImageRequest(requestId)
            return .failure(BridgeError(
                code: "render_local_fallback_timeout",
                message: "Photos did not provide a rendered JPEG within \(Int(renderBeforeLocalFallbackTimeoutSeconds)) seconds. Owner will try the local image-source fallback next."
            ))
        }
        if elapsed >= renderOverallTimeoutSeconds {
            PHImageManager.default().cancelImageRequest(requestId)
            let message = allowIcloudDownloads
                ? "Timed out while Photos was downloading or rendering an asset. Open the asset in Photos, confirm it downloads, then retry."
                : "Timed out while rendering a Photos asset. Confirm the rendered version is local in Photos and retry."
            return .failure(BridgeError(code: "render_timeout", message: message))
        }
    }
    if let error = requestInfo[PHImageErrorKey] as? Error {
        return .failure(error)
    }
    if requestInfo[PHImageCancelledKey] as? Bool == true {
        return .failure(BridgeError(code: "render_cancelled", message: "Photos cancelled the rendered JPG export."))
    }
    if renderedImage == nil && requestInfo[PHImageResultIsInCloudKey] as? Bool == true {
        let message = allowIcloudDownloads
            ? "Photos could not download or provide the current rendered version from iCloud."
            : "The current rendered version is in iCloud and is not local."
        return .failure(BridgeError(code: "render_in_icloud", message: message))
    }
    guard let image = renderedImage,
          let tiffData = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let jpegData = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.95]) else {
        return .failure(BridgeError(code: "render_failed", message: "Photos did not provide a renderable image for JPG export."))
    }
    progressHandler?(1.0, "encoding_jpeg", Date().timeIntervalSince(startedAt))
    do {
        progressHandler?(1.0, "writing_file", Date().timeIntervalSince(startedAt))
        try jpegData.write(to: url, options: .atomic)
        return .success(())
    } catch {
        return .failure(error)
    }
}

func writeResource(_ resource: PHAssetResource, to url: URL, allowIcloudDownloads: Bool, timeoutSeconds: TimeInterval = 600, progressHandler: AssetProgressHandler? = nil) -> Result<Void, Error> {
    let heartbeatSeconds: TimeInterval = 5
    let progressStateLock = NSLock()
    var lastPhotoKitProgress = 0.0
    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = allowIcloudDownloads
    options.progressHandler = { progress in
        let normalized = normalizedProgress(progress)
        progressStateLock.lock()
        lastPhotoKitProgress = max(lastPhotoKitProgress, normalized)
        progressStateLock.unlock()
        progressHandler?(normalized, "downloading", nil)
    }
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<Void, Error> = .success(())
    PHAssetResourceManager.default().writeData(for: resource, toFile: url, options: options) { error in
        if let error {
            result = .failure(error)
        }
        semaphore.signal()
    }
    let startedAt = Date()
    var lastHeartbeatAt = Date.distantPast
    while semaphore.wait(timeout: .now() + 1) == .timedOut {
        let now = Date()
        let elapsed = now.timeIntervalSince(startedAt)
        progressStateLock.lock()
        let observedProgress = lastPhotoKitProgress
        progressStateLock.unlock()
        if now.timeIntervalSince(lastHeartbeatAt) >= heartbeatSeconds {
            let status = observedProgress >= 0.999 ? "waiting_for_file" : "exporting_resource"
            progressHandler?(observedProgress, status, elapsed)
            lastHeartbeatAt = now
        }
        if elapsed >= timeoutSeconds {
            let message = allowIcloudDownloads
                ? "Timed out while Photos was downloading or exporting the original resource. Open the asset in Photos, confirm it downloads, then retry."
                : "Timed out while exporting a Photos resource. Confirm the original is local in Photos and retry."
            return .failure(BridgeError(code: "resource_timeout", message: message))
        }
    }
    return result
}

func assetProgressPayload(
    albumInfo: [String: Any],
    asset: PHAsset,
    plan: AssetPlan,
    row: [String: Any],
    filename: String,
    strategy: String,
    status: String,
    totalCount: Int,
    candidateCount: Int,
    attemptedCount: Int,
    materializedCount: Int,
    progress: Double? = nil,
    elapsedSeconds: Double? = nil
) -> [String: Any] {
    var payload: [String: Any] = [
        "album": albumInfo,
        "index": plan.index,
        "totalCount": totalCount,
        "candidateCount": candidateCount,
        "attemptedCount": attemptedCount,
        "materializedCount": materializedCount,
        "localIdentifier": asset.localIdentifier,
        "filename": filename,
        "mediaType": row["mediaType"] as? String ?? "photo",
        "exportStrategy": strategy,
        "resourceFormat": row["resourceFormat"] as? String ?? "",
        "resourceFormats": row["resourceFormats"] as? [String] ?? [],
        "preferredResourceFilename": row["preferredResourceFilename"] as? String ?? "",
        "preferredResourceFormat": row["preferredResourceFormat"] as? String ?? "",
        "fallbackResourceFilename": row["fallbackResourceFilename"] as? String ?? "",
        "fallbackResourceFormat": row["fallbackResourceFormat"] as? String ?? "",
        "localJPEGFallbackAvailable": row["localJPEGFallbackAvailable"] as? Bool ?? false,
        "status": status,
    ]
    if let progress {
        let normalized = normalizedProgress(progress)
        payload["progress"] = normalized
        payload["progressPercent"] = Int((normalized * 100).rounded())
    }
    if let elapsedSeconds {
        payload["elapsedSeconds"] = Int(elapsedSeconds.rounded())
    }
    return payload
}

func materialize(album: PHAssetCollection, destination: URL, limit: Int, filterBursts: Bool, allowIcloudDownloads: Bool) throws -> [String: Any] {
    try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
    let (plans, burstFilter) = plannedAssets(album: album, limit: limit, filterBursts: filterBursts)
    let albumInfo = albumSummary(album)
    let candidateCount = plans.filter { ($0.row["eligible"] as? Bool) == true }.count
    var attemptedCount = 0
    var materializedCount = 0
    var sidecarRows: [[String: Any]] = []
    var itemRows: [[String: Any]] = []
    emitProgress("materialize_start", [
        "album": albumInfo,
        "destination": destination.path,
        "totalCount": plans.count,
        "candidateCount": candidateCount,
        "attemptedCount": attemptedCount,
        "materializedCount": materializedCount,
        "burstFilter": burstFilter,
        "icloudDownloads": [
            "enabled": allowIcloudDownloads,
        ],
    ])
    for plan in plans {
        let asset = plan.asset
        let index = plan.index - 1
        var row = plan.row
        row["album"] = albumInfo
        guard (row["eligible"] as? Bool) == true else {
            itemRows.append(row)
            continue
        }
        let strategy = row["exportStrategy"] as? String ?? "unsupported"
        if strategy == "rendered_jpeg" {
            let filename = safeFilename(row["filename"] as? String ?? "", fallback: "apple-photos-\(index + 1).jpg")
            let outputURL = destination.appendingPathComponent(String(format: "%04d-%@", index + 1, filename))
            attemptedCount += 1
            let progressLock = NSLock()
            var lastProgressPercent = -1
            var lastProgressStatus = ""
            let emitAssetProgress = { (rawProgress: Double, status: String, elapsedSeconds: Double?) in
                let normalized = normalizedProgress(rawProgress)
                let percent = Int((normalized * 100).rounded())
                progressLock.lock()
                defer { progressLock.unlock() }
                let statusChanged = status != lastProgressStatus
                let isHeartbeat = elapsedSeconds != nil
                if lastProgressPercent >= 0 {
                    if !statusChanged && !isHeartbeat && percent == lastProgressPercent { return }
                    if !statusChanged && !isHeartbeat && percent < 100 && percent - lastProgressPercent < 5 { return }
                }
                lastProgressPercent = statusChanged ? percent : max(lastProgressPercent, percent)
                lastProgressStatus = status
                emitProgress("asset_progress", assetProgressPayload(
                    albumInfo: albumInfo,
                    asset: asset,
                    plan: plan,
                    row: row,
                    filename: filename,
                    strategy: strategy,
                    status: status,
                    totalCount: plans.count,
                    candidateCount: candidateCount,
                    attemptedCount: attemptedCount,
                    materializedCount: materializedCount,
                    progress: normalized,
                    elapsedSeconds: elapsedSeconds
                ))
            }
            emitProgress("asset_start", [
                "album": albumInfo,
                "index": plan.index,
                "totalCount": plans.count,
                "candidateCount": candidateCount,
                "attemptedCount": attemptedCount,
                "materializedCount": materializedCount,
                "localIdentifier": asset.localIdentifier,
                "filename": filename,
                "mediaType": row["mediaType"] as? String ?? "photo",
                "exportStrategy": strategy,
                "resourceFormat": row["resourceFormat"] as? String ?? "",
                "resourceFormats": row["resourceFormats"] as? [String] ?? [],
                "preferredResourceFilename": row["preferredResourceFilename"] as? String ?? "",
                "preferredResourceFormat": row["preferredResourceFormat"] as? String ?? "",
                "fallbackResourceFilename": row["fallbackResourceFilename"] as? String ?? "",
                "fallbackResourceFormat": row["fallbackResourceFormat"] as? String ?? "",
                "localJPEGFallbackAvailable": row["localJPEGFallbackAvailable"] as? Bool ?? false,
                "status": "materializing",
            ])
            var sourceAnchorVersion = "current-rendered-jpeg"
            let materializeResult: Result<Void, Error>
            switch writeRenderedJPEG(asset, to: outputURL, allowIcloudDownloads: allowIcloudDownloads, progressHandler: emitAssetProgress) {
            case .success:
                materializeResult = .success(())
            case .failure(let renderError):
                try? FileManager.default.removeItem(at: outputURL)
                row["renderAttemptError"] = renderError.localizedDescription
                emitAssetProgress(1.0, "render_fallback", nil)
                switch writeLocalImageResourceAsJPEG(asset, to: outputURL, allowIcloudDownloads: allowIcloudDownloads, progressHandler: emitAssetProgress) {
                case .success:
                    row["renderFallback"] = "local-resource-jpeg"
                    row["renderFallbackReason"] = renderError.localizedDescription
                    sourceAnchorVersion = "local-resource-jpeg"
                    materializeResult = .success(())
                case .failure(let fallbackError):
                    materializeResult = .failure(BridgeError(
                        code: "render_and_local_resource_failed",
                        message: "Photos did not provide the rendered JPG: \(renderError.localizedDescription) Local image-source fallback also failed: \(fallbackError.localizedDescription)"
                    ))
                }
            }
            switch materializeResult {
            case .success:
                let relativePath = outputURL.lastPathComponent
                row["status"] = "materialized"
                row["relative_path"] = relativePath
                row["path"] = outputURL.path
                materializedCount += 1
                sidecarRows.append([
                    "relative_path": relativePath,
                    "album": albumInfo,
                    "source_anchor": [
                        "path": "apple-photos://\(asset.localIdentifier)",
                        "modified_at": isoDate(asset.modificationDate ?? asset.creationDate),
                        "modified_ns": Int64((asset.modificationDate ?? asset.creationDate ?? Date(timeIntervalSince1970: 0)).timeIntervalSince1970 * 1_000_000_000),
                        "filename": filename,
                        "version": sourceAnchorVersion,
                    ],
                    "apple_photos": row,
                ])
                emitProgress("asset_done", [
                    "album": albumInfo,
                    "index": plan.index,
                    "totalCount": plans.count,
                    "candidateCount": candidateCount,
                    "attemptedCount": attemptedCount,
                    "materializedCount": materializedCount,
                    "localIdentifier": asset.localIdentifier,
                    "filename": filename,
                    "relativePath": relativePath,
                    "path": outputURL.path,
                    "mediaType": row["mediaType"] as? String ?? "photo",
                    "exportStrategy": strategy,
                    "resourceFormat": row["resourceFormat"] as? String ?? "",
                    "resourceFormats": row["resourceFormats"] as? [String] ?? [],
                    "preferredResourceFilename": row["preferredResourceFilename"] as? String ?? "",
                    "preferredResourceFormat": row["preferredResourceFormat"] as? String ?? "",
                    "fallbackResourceFilename": row["fallbackResourceFilename"] as? String ?? "",
                    "fallbackResourceFormat": row["fallbackResourceFormat"] as? String ?? "",
                    "localJPEGFallbackAvailable": row["localJPEGFallbackAvailable"] as? Bool ?? false,
                    "status": "materialized",
                ])
            case .failure(let error):
                row["eligible"] = false
                row["status"] = "photos_export_failed"
                row["reason"] = "Photos could not provide a rendered JPG, and the local image-source fallback could not create one: \(error.localizedDescription)"
                emitProgress("asset_failed", [
                    "album": albumInfo,
                    "index": plan.index,
                    "totalCount": plans.count,
                    "candidateCount": candidateCount,
                    "attemptedCount": attemptedCount,
                    "materializedCount": materializedCount,
                    "localIdentifier": asset.localIdentifier,
                    "filename": filename,
                    "mediaType": row["mediaType"] as? String ?? "photo",
                    "exportStrategy": strategy,
                    "resourceFormat": row["resourceFormat"] as? String ?? "",
                    "resourceFormats": row["resourceFormats"] as? [String] ?? [],
                    "preferredResourceFilename": row["preferredResourceFilename"] as? String ?? "",
                    "preferredResourceFormat": row["preferredResourceFormat"] as? String ?? "",
                    "fallbackResourceFilename": row["fallbackResourceFilename"] as? String ?? "",
                    "fallbackResourceFormat": row["fallbackResourceFormat"] as? String ?? "",
                    "localJPEGFallbackAvailable": row["localJPEGFallbackAvailable"] as? Bool ?? false,
                    "status": row["status"] as? String ?? "photos_export_failed",
                    "reason": row["reason"] as? String ?? error.localizedDescription,
                ])
            }
            itemRows.append(row)
            continue
        }
        guard let resource = preferredResource(asset), !hasExtension(resource.originalFilename, in: rawFileExtensions) else {
            row["eligible"] = false
            row["status"] = "unsupported"
            row["reason"] = "No supported developed photo/video resource found."
            itemRows.append(row)
            continue
        }
        let filename = safeFilename(resource.originalFilename, fallback: "apple-photos-\(index + 1)")
        let outputURL = destination.appendingPathComponent(String(format: "%04d-%@", index + 1, filename))
        attemptedCount += 1
        let progressLock = NSLock()
        var lastProgressPercent = -1
        var lastProgressStatus = ""
        let emitAssetProgress = { (rawProgress: Double, status: String, elapsedSeconds: Double?) in
            let normalized = normalizedProgress(rawProgress)
            let percent = Int((normalized * 100).rounded())
            progressLock.lock()
            defer { progressLock.unlock() }
            let statusChanged = status != lastProgressStatus
            let isHeartbeat = elapsedSeconds != nil
            if lastProgressPercent >= 0 {
                if !statusChanged && !isHeartbeat && percent == lastProgressPercent { return }
                if !statusChanged && !isHeartbeat && percent < 100 && percent - lastProgressPercent < 5 { return }
            }
            lastProgressPercent = statusChanged ? percent : max(lastProgressPercent, percent)
            lastProgressStatus = status
            emitProgress("asset_progress", assetProgressPayload(
                albumInfo: albumInfo,
                asset: asset,
                plan: plan,
                row: row,
                filename: filename,
                strategy: strategy,
                status: status,
                totalCount: plans.count,
                candidateCount: candidateCount,
                attemptedCount: attemptedCount,
                materializedCount: materializedCount,
                progress: normalized,
                elapsedSeconds: elapsedSeconds
            ))
        }
        emitProgress("asset_start", [
            "album": albumInfo,
            "index": plan.index,
            "totalCount": plans.count,
            "candidateCount": candidateCount,
            "attemptedCount": attemptedCount,
            "materializedCount": materializedCount,
            "localIdentifier": asset.localIdentifier,
            "filename": filename,
            "mediaType": row["mediaType"] as? String ?? "photo",
            "exportStrategy": strategy,
            "resourceFormat": row["resourceFormat"] as? String ?? "",
            "resourceFormats": row["resourceFormats"] as? [String] ?? [],
            "preferredResourceFilename": row["preferredResourceFilename"] as? String ?? "",
            "preferredResourceFormat": row["preferredResourceFormat"] as? String ?? "",
            "fallbackResourceFilename": row["fallbackResourceFilename"] as? String ?? "",
            "fallbackResourceFormat": row["fallbackResourceFormat"] as? String ?? "",
            "localJPEGFallbackAvailable": row["localJPEGFallbackAvailable"] as? Bool ?? false,
            "status": "materializing",
        ])
        switch writeResource(resource, to: outputURL, allowIcloudDownloads: allowIcloudDownloads, progressHandler: emitAssetProgress) {
        case .success:
            let relativePath = outputURL.lastPathComponent
            row["status"] = "materialized"
            row["relative_path"] = relativePath
            row["path"] = outputURL.path
            materializedCount += 1
            sidecarRows.append([
                "relative_path": relativePath,
                "album": albumInfo,
                "source_anchor": [
                    "path": "apple-photos://\(asset.localIdentifier)",
                    "modified_at": isoDate(asset.modificationDate ?? asset.creationDate),
                    "modified_ns": Int64((asset.modificationDate ?? asset.creationDate ?? Date(timeIntervalSince1970: 0)).timeIntervalSince1970 * 1_000_000_000),
                    "filename": filename,
                    "version": "current",
                ],
                "apple_photos": row,
            ])
            emitProgress("asset_done", [
                "album": albumInfo,
                "index": plan.index,
                "totalCount": plans.count,
                "candidateCount": candidateCount,
                "attemptedCount": attemptedCount,
                "materializedCount": materializedCount,
                "localIdentifier": asset.localIdentifier,
                "filename": filename,
                "relativePath": relativePath,
                "path": outputURL.path,
                "mediaType": row["mediaType"] as? String ?? "photo",
                "exportStrategy": strategy,
                "resourceFormat": row["resourceFormat"] as? String ?? "",
                "resourceFormats": row["resourceFormats"] as? [String] ?? [],
                "preferredResourceFilename": row["preferredResourceFilename"] as? String ?? "",
                "preferredResourceFormat": row["preferredResourceFormat"] as? String ?? "",
                "fallbackResourceFilename": row["fallbackResourceFilename"] as? String ?? "",
                "fallbackResourceFormat": row["fallbackResourceFormat"] as? String ?? "",
                "localJPEGFallbackAvailable": row["localJPEGFallbackAvailable"] as? Bool ?? false,
                "status": "materialized",
            ])
        case .failure(let error):
            row["eligible"] = false
            row["status"] = "unavailable_from_icloud"
            row["reason"] = allowIcloudDownloads
                ? "Photos could not download or provide the original resource for Owner import: \(error.localizedDescription)"
                : "Original resource is not available locally and network download is disabled for Owner import safety: \(error.localizedDescription)"
            emitProgress("asset_failed", [
                "album": albumInfo,
                "index": plan.index,
                "totalCount": plans.count,
                "candidateCount": candidateCount,
                "attemptedCount": attemptedCount,
                "materializedCount": materializedCount,
                "localIdentifier": asset.localIdentifier,
                "filename": filename,
                "mediaType": row["mediaType"] as? String ?? "photo",
                "exportStrategy": strategy,
                "resourceFormat": row["resourceFormat"] as? String ?? "",
                "resourceFormats": row["resourceFormats"] as? [String] ?? [],
                "preferredResourceFilename": row["preferredResourceFilename"] as? String ?? "",
                "preferredResourceFormat": row["preferredResourceFormat"] as? String ?? "",
                "fallbackResourceFilename": row["fallbackResourceFilename"] as? String ?? "",
                "fallbackResourceFormat": row["fallbackResourceFormat"] as? String ?? "",
                "localJPEGFallbackAvailable": row["localJPEGFallbackAvailable"] as? Bool ?? false,
                "status": row["status"] as? String ?? "unavailable_from_icloud",
                "reason": row["reason"] as? String ?? error.localizedDescription,
            ])
        }
        itemRows.append(row)
    }
    emitProgress("materialize_done", [
        "album": albumInfo,
        "destination": destination.path,
        "totalCount": plans.count,
        "candidateCount": candidateCount,
        "attemptedCount": attemptedCount,
        "materializedCount": sidecarRows.count,
        "burstFilter": burstFilter,
        "icloudDownloads": [
            "enabled": allowIcloudDownloads,
        ],
    ])
    let sidecar: [String: Any] = [
        "schema": "photosbyelie.apple-photos-source-anchors.v1",
        "created_at": isoDate(Date()),
        "album": albumInfo,
        "icloudDownloads": [
            "enabled": allowIcloudDownloads,
        ],
        "assets": sidecarRows,
    ]
    let sidecarURL = destination.appendingPathComponent(".pbe-apple-photos-assets.json")
    try jsonData(sidecar).write(to: sidecarURL, options: .atomic)
    return [
        "ok": true,
        "mode": "materialize",
        "album": albumInfo,
        "destination": destination.path,
        "sidecar": sidecarURL.path,
        "count": itemRows.count,
        "materializedCount": sidecarRows.count,
        "burstFilter": burstFilter,
        "icloudDownloads": [
            "enabled": allowIcloudDownloads,
        ],
        "items": itemRows,
    ]
}

func materializeOne(asset: PHAsset, destination: URL, allowIcloudDownloads: Bool) throws -> [String: Any] {
    try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
    var row = assetRow(asset, index: 1)
    let strategy = row["exportStrategy"] as? String ?? "unsupported"
    let mediaType = row["mediaType"] as? String ?? "photo"
    var materializedCount = 0
    var sidecarRows: [[String: Any]] = []

    let emitAssetProgress = { (rawProgress: Double, status: String, elapsedSeconds: Double?) in
        let normalized = normalizedProgress(rawProgress)
        var payload: [String: Any] = [
            "index": 1,
            "totalCount": 1,
            "candidateCount": (row["eligible"] as? Bool) == true ? 1 : 0,
            "attemptedCount": 1,
            "materializedCount": materializedCount,
            "localIdentifier": asset.localIdentifier,
            "filename": row["filename"] as? String ?? "",
            "mediaType": mediaType,
            "exportStrategy": strategy,
            "status": status,
            "progress": normalized,
            "progressPercent": Int((normalized * 100).rounded()),
        ]
        if let elapsedSeconds {
            payload["elapsedSeconds"] = Int(elapsedSeconds.rounded())
        }
        emitProgress("asset_progress", payload)
    }

    emitProgress("materialize_one_start", [
        "destination": destination.path,
        "localIdentifier": asset.localIdentifier,
        "filename": row["filename"] as? String ?? "",
        "mediaType": mediaType,
        "exportStrategy": strategy,
        "icloudDownloads": [
            "enabled": allowIcloudDownloads,
        ],
    ])

    if strategy == "rendered_jpeg" {
        let filename = safeFilename(row["filename"] as? String ?? "", fallback: "apple-photos-1.jpg")
        let outputURL = destination.appendingPathComponent("0001-\(filename)")
        var sourceAnchorVersion = "current-rendered-jpeg"
        let materializeResult: Result<Void, Error>
        switch writeRenderedJPEG(asset, to: outputURL, allowIcloudDownloads: allowIcloudDownloads, progressHandler: emitAssetProgress) {
        case .success:
            materializeResult = .success(())
        case .failure(let renderError):
            try? FileManager.default.removeItem(at: outputURL)
            row["renderAttemptError"] = renderError.localizedDescription
            emitAssetProgress(1.0, "render_fallback", nil)
            switch writeLocalImageResourceAsJPEG(asset, to: outputURL, allowIcloudDownloads: allowIcloudDownloads, progressHandler: emitAssetProgress) {
            case .success:
                row["renderFallback"] = "local-resource-jpeg"
                row["renderFallbackReason"] = renderError.localizedDescription
                sourceAnchorVersion = "local-resource-jpeg"
                materializeResult = .success(())
            case .failure(let fallbackError):
                materializeResult = .failure(BridgeError(
                    code: "render_and_local_resource_failed",
                    message: "Photos did not provide the rendered JPG: \(renderError.localizedDescription) Local image-source fallback also failed: \(fallbackError.localizedDescription)"
                ))
            }
        }
        switch materializeResult {
        case .success:
            let relativePath = outputURL.lastPathComponent
            row["status"] = "materialized"
            row["relative_path"] = relativePath
            row["path"] = outputURL.path
            materializedCount = 1
            sidecarRows.append([
                "relative_path": relativePath,
                "source_anchor": [
                    "path": "apple-photos://\(asset.localIdentifier)",
                    "modified_at": isoDate(asset.modificationDate ?? asset.creationDate),
                    "modified_ns": Int64((asset.modificationDate ?? asset.creationDate ?? Date(timeIntervalSince1970: 0)).timeIntervalSince1970 * 1_000_000_000),
                    "filename": filename,
                    "version": sourceAnchorVersion,
                ],
                "apple_photos": row,
            ])
        case .failure(let error):
            row["eligible"] = false
            row["status"] = "photos_export_failed"
            row["reason"] = "Photos could not provide a rendered JPG, and the local image-source fallback could not create one: \(error.localizedDescription)"
        }
    } else if strategy == "resource" {
        if let resource = preferredResource(asset), !hasExtension(resource.originalFilename, in: rawFileExtensions) {
            let filename = safeFilename(resource.originalFilename, fallback: "apple-photos-1")
            let outputURL = destination.appendingPathComponent("0001-\(filename)")
            switch writeResource(resource, to: outputURL, allowIcloudDownloads: allowIcloudDownloads, progressHandler: emitAssetProgress) {
            case .success:
                let relativePath = outputURL.lastPathComponent
                row["status"] = "materialized"
                row["relative_path"] = relativePath
                row["path"] = outputURL.path
                materializedCount = 1
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
                row["reason"] = allowIcloudDownloads
                    ? "Photos could not download or provide the original resource for Owner import: \(error.localizedDescription)"
                    : "Original resource is not available locally and network download is disabled for Owner import safety: \(error.localizedDescription)"
            }
        } else {
            row["eligible"] = false
            row["status"] = "unsupported"
            row["reason"] = "No supported developed photo/video resource found."
        }
    } else {
        row["eligible"] = false
        row["status"] = "unsupported"
        row["reason"] = "No supported developed photo/video resource found."
    }

    let sidecar: [String: Any] = [
        "schema": "photosbyelie.apple-photos-source-anchors.v1",
        "created_at": isoDate(Date()),
        "icloudDownloads": [
            "enabled": allowIcloudDownloads,
        ],
        "assets": sidecarRows,
    ]
    let sidecarURL = destination.appendingPathComponent(".pbe-apple-photos-assets.json")
    try jsonData(sidecar).write(to: sidecarURL, options: .atomic)
    emitProgress("materialize_one_done", [
        "destination": destination.path,
        "localIdentifier": asset.localIdentifier,
        "materializedCount": materializedCount,
        "status": row["status"] as? String ?? "",
    ])
    return [
        "ok": true,
        "mode": "materialize-one",
        "destination": destination.path,
        "sidecar": sidecarURL.path,
        "count": 1,
        "materializedCount": materializedCount,
        "icloudDownloads": [
            "enabled": allowIcloudDownloads,
        ],
        "items": [row],
    ]
}

let command = CommandLine.arguments.dropFirst().first ?? ""
if command.isEmpty || command == "--help" {
    outputJSON(["ok": true, "usage": "apple_photos_bridge.swift albums | library-index [--limit N] [--offset N] [--date-from YYYY-MM-DD] [--date-to YYYY-MM-DD] | library-index-file --destination PATH [--date-from YYYY-MM-DD] [--date-to YYYY-MM-DD] [--progress-every N] | preview --asset-id ID --destination PATH [--max-pixel N] | video --asset-id ID --destination PATH | preflight --album-id ID [--filter-bursts] [--allow-icloud-downloads] | export --album-id ID --destination PATH [--filter-bursts] [--allow-icloud-downloads] | materialize-one --asset-id ID --destination PATH [--allow-icloud-downloads] [--result-destination PATH]"])
    exit(0)
}

requirePhotosAccess()

do {
    switch command {
    case "albums":
        outputJSON(["ok": true, "albums": fetchAlbums().map(albumSummary)])
    case "library-index":
        outputJSON(libraryIndex(
            limit: intArg("--limit", default: 120),
            offset: intArg("--offset", default: 0),
            dateFrom: parseISODateArg(argValue("--date-from")),
            dateTo: parseISODateArg(argValue("--date-to"))
        ))
    case "library-index-file":
        guard let destination = argValue("--destination") else {
            fail("missing_destination", "Missing --destination for Apple Photos library index file.")
        }
        outputJSON(try writeLibraryIndexFile(
            destination: URL(fileURLWithPath: destination),
            dateFrom: parseISODateArg(argValue("--date-from")),
            dateTo: parseISODateArg(argValue("--date-to")),
            progressEvery: intArg("--progress-every", default: 100)
        ))
    case "preview":
        guard let destination = argValue("--destination") else {
            fail("missing_destination", "Missing --destination for Apple Photos preview.")
        }
        let asset = try findAsset(id: argValue("--asset-id"))
        outputJSON(try writePreviewJPEG(
            asset: asset,
            destination: URL(fileURLWithPath: destination),
            maxPixel: intArg("--max-pixel", default: 900)
        ))
    case "video":
        guard let destination = argValue("--destination") else {
            fail("missing_destination", "Missing --destination for Apple Photos video preview.")
        }
        let asset = try findAsset(id: argValue("--asset-id"))
        outputJSON(try writeVideoResource(
            asset: asset,
            destination: URL(fileURLWithPath: destination)
        ))
    case "preflight":
        let album = try findAlbum(id: argValue("--album-id"), name: argValue("--album-name"))
        outputJSON(preflight(album: album, limit: intArg("--limit"), filterBursts: boolArg("--filter-bursts"), allowIcloudDownloads: boolArg("--allow-icloud-downloads")))
    case "export":
        guard let destination = argValue("--destination") else {
            fail("missing_destination", "Missing --destination for Apple Photos export.")
        }
        let album = try findAlbum(id: argValue("--album-id"), name: argValue("--album-name"))
        outputJSON(try materialize(album: album, destination: URL(fileURLWithPath: destination), limit: intArg("--limit"), filterBursts: boolArg("--filter-bursts"), allowIcloudDownloads: boolArg("--allow-icloud-downloads")))
    case "materialize-one":
        guard let destination = argValue("--destination") else {
            fail("missing_destination", "Missing --destination for Apple Photos single-asset materialization.")
        }
        let asset = try findAsset(id: argValue("--asset-id"))
        let payload = try materializeOne(asset: asset, destination: URL(fileURLWithPath: destination), allowIcloudDownloads: boolArg("--allow-icloud-downloads"))
        outputJSON(payload)
    default:
        fail("bad_command", "Unknown Apple Photos bridge command: \(command)", status: 2)
    }
} catch let error as BridgeError {
    fail(error.code, error.message)
} catch {
    fail("photos_bridge_error", error.localizedDescription)
}
