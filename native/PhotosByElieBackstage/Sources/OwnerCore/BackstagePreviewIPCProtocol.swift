import Foundation

public enum BackstagePreviewIPCConstants {
    public static let schemaVersion = 1
    public static let operation = "photos.preview"
    public static let libraryIndexOperation = "photos.library-index"
    public static let exportOriginalOperation = "photos.export-original"
    public static let metadataReadManyOperation = "photos.metadata-read-many"
    public static let metadataApplyManyOperation = "photos.metadata-apply-many"
    public static let minimumMaxPixel = 256
    public static let maximumMaxPixel = 1_800
    public static let minimumLibraryLimit = 1
    public static let maximumLibraryLimit = 1_000
    public static let maximumLibraryOffset = 1_000_000
    public static let maximumRequestBytes = 16_384
    public static let maximumPreviewBytes = 8 * 1_024 * 1_024
    public static let maximumResponseBytes = 12 * 1_024 * 1_024
    public static let maximumAssetIDBytes = 2_048
    public static let maximumMetadataItems = 64
    public static let maximumMetadataTextBytes = 8 * 1_024
    public static let maximumMetadataKeywords = 512

    public static func defaultExportDirectory() -> URL {
        let applicationSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support", isDirectory: true)
        return applicationSupport
            .appendingPathComponent("PhotosByElie Backstage", isDirectory: true)
            .appendingPathComponent("exports", isDirectory: true)
    }
}

public struct BackstagePreviewIPCDescriptor: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var host: String
    public var port: UInt16
    public var pid: Int32
    public var bearerToken: String
    public var startedAtEpoch: TimeInterval

    public init(
        schemaVersion: Int = BackstagePreviewIPCConstants.schemaVersion,
        host: String,
        port: UInt16,
        pid: Int32,
        bearerToken: String,
        startedAtEpoch: TimeInterval
    ) {
        self.schemaVersion = schemaVersion
        self.host = host
        self.port = port
        self.pid = pid
        self.bearerToken = bearerToken
        self.startedAtEpoch = startedAtEpoch
    }
}

public struct BackstagePreviewIPCLimits: Sendable {
    public var maximumRequestBytes: Int
    public var maximumPreviewBytes: Int
    public var maximumResponseBytes: Int
    public var operationTimeout: Duration
    public var libraryIndexOperationTimeout: Duration
    public var exportOperationTimeout: Duration
    public var metadataOperationTimeout: Duration

    public init(
        maximumRequestBytes: Int = BackstagePreviewIPCConstants.maximumRequestBytes,
        maximumPreviewBytes: Int = BackstagePreviewIPCConstants.maximumPreviewBytes,
        maximumResponseBytes: Int = BackstagePreviewIPCConstants.maximumResponseBytes,
        operationTimeout: Duration = .seconds(55),
        libraryIndexOperationTimeout: Duration = .seconds(300),
        exportOperationTimeout: Duration = .seconds(1_800),
        metadataOperationTimeout: Duration = .seconds(300)
    ) {
        self.maximumRequestBytes = maximumRequestBytes
        self.maximumPreviewBytes = maximumPreviewBytes
        self.maximumResponseBytes = maximumResponseBytes
        self.operationTimeout = operationTimeout
        self.libraryIndexOperationTimeout = libraryIndexOperationTimeout
        self.exportOperationTimeout = exportOperationTimeout
        self.metadataOperationTimeout = metadataOperationTimeout
    }
}

public struct BackstagePreviewIPCProcessor: Sendable {
    private let photoLibrary: any PhotoLibraryServing
    private let bearerToken: String
    private let limits: BackstagePreviewIPCLimits
    private let exportDirectory: URL

    public init(
        photoLibrary: any PhotoLibraryServing,
        bearerToken: String,
        limits: BackstagePreviewIPCLimits = BackstagePreviewIPCLimits(),
        exportDirectory: URL = BackstagePreviewIPCConstants.defaultExportDirectory()
    ) {
        self.photoLibrary = photoLibrary
        self.bearerToken = bearerToken
        self.limits = limits
        self.exportDirectory = exportDirectory
    }

    public func process(_ requestData: Data) async -> Data {
        guard !requestData.isEmpty, requestData.count <= limits.maximumRequestBytes else {
            return encodeError(requestID: "", code: "request_oversized", message: "The IPC request exceeds the allowed size.")
        }

        let request: PreviewRequest
        do {
            request = try JSONDecoder().decode(PreviewRequest.self, from: requestData)
        } catch {
            return encodeError(requestID: "", code: "invalid_request", message: "The IPC request is not valid JSON.")
        }

        guard UUID(uuidString: request.requestID) != nil else {
            return encodeError(requestID: "", code: "invalid_request_id", message: "The request ID must be a UUID.")
        }

        let expectedAuthorization = "Bearer \(bearerToken)"
        guard constantTimeEqual(request.authorization, expectedAuthorization) else {
            return encodeError(requestID: request.requestID, code: "authentication_failed", message: "The IPC bearer token was rejected.")
        }
        guard request.operation == BackstagePreviewIPCConstants.operation
            || request.operation == BackstagePreviewIPCConstants.libraryIndexOperation
            || request.operation == BackstagePreviewIPCConstants.exportOriginalOperation
            || request.operation == BackstagePreviewIPCConstants.metadataReadManyOperation
            || request.operation == BackstagePreviewIPCConstants.metadataApplyManyOperation else {
            return encodeError(requestID: request.requestID, code: "unsupported_operation", message: "The requested IPC operation is not supported.")
        }
        guard [.authorized, .limited].contains(photoLibrary.authorization()) else {
            return encodeError(requestID: request.requestID, code: "photos_access_denied", message: "Backstage does not have Photos access.")
        }

        if request.operation == BackstagePreviewIPCConstants.libraryIndexOperation {
            return await processLibraryIndex(request)
        }
        if request.operation == BackstagePreviewIPCConstants.metadataReadManyOperation {
            return await processMetadata(request, apply: false)
        }
        if request.operation == BackstagePreviewIPCConstants.metadataApplyManyOperation {
            return await processMetadata(request, apply: true)
        }

        guard let assetID = request.assetID, validAssetID(assetID) else {
            return encodeError(requestID: request.requestID, code: "invalid_asset_id", message: "The Photos asset ID is missing or exceeds the allowed size.")
        }
        if request.operation == BackstagePreviewIPCConstants.exportOriginalOperation {
            return await processExportOriginal(request, assetID: assetID)
        }
        guard let maxPixel = request.maxPixel,
              (BackstagePreviewIPCConstants.minimumMaxPixel...BackstagePreviewIPCConstants.maximumMaxPixel)
                .contains(maxPixel) else {
            return encodeError(
                requestID: request.requestID,
                code: "invalid_max_pixel",
                message: "maxPixel must be between 256 and 1800."
            )
        }

        do {
            let preview = try await previewWithTimeout(
                assetID: assetID,
                maxPixel: maxPixel
            )
            guard preview.assetID == assetID,
                  preview.pixelWidth > 0,
                  preview.pixelHeight > 0,
                  preview.pixelWidth <= maxPixel,
                  preview.pixelHeight <= maxPixel,
                  isJPEG(preview.jpegData) else {
                return encodeError(requestID: request.requestID, code: "invalid_preview", message: "Backstage returned malformed preview data.")
            }
            guard preview.jpegData.count <= limits.maximumPreviewBytes else {
                return encodeError(requestID: request.requestID, code: "response_oversized", message: "The preview exceeds the allowed response size.")
            }
            let response = PreviewResponse(
                ok: true,
                requestID: request.requestID,
                mode: "preview",
                assetID: preview.assetID,
                bytes: preview.jpegData.count,
                pixelWidth: preview.pixelWidth,
                pixelHeight: preview.pixelHeight,
                mimeType: "image/jpeg",
                dataBase64: preview.jpegData.base64EncodedString(),
                error: nil
            )
            let encoded = encode(response)
            guard encoded.count <= limits.maximumResponseBytes else {
                return encodeError(requestID: request.requestID, code: "response_oversized", message: "The preview response exceeds the allowed size.")
            }
            return encoded
        } catch is PreviewTimeoutError {
            return encodeError(requestID: request.requestID, code: "preview_timeout", message: "Backstage timed out while preparing the preview.")
        } catch let error as PhotoLibraryError {
            return encodeError(
                requestID: request.requestID,
                code: errorCode(error),
                message: error.localizedDescription
            )
        } catch {
            return encodeError(requestID: request.requestID, code: "preview_failed", message: "Backstage could not prepare the preview.")
        }
    }

    private func processLibraryIndex(_ request: PreviewRequest) async -> Data {
        guard let limit = request.limit,
              (BackstagePreviewIPCConstants.minimumLibraryLimit...BackstagePreviewIPCConstants.maximumLibraryLimit)
                .contains(limit) else {
            return encodeError(
                requestID: request.requestID,
                mode: "library-index",
                code: "invalid_library_limit",
                message: "Library limit must be between 1 and 1000."
            )
        }
        guard let offset = request.offset,
              (0...BackstagePreviewIPCConstants.maximumLibraryOffset).contains(offset) else {
            return encodeError(
                requestID: request.requestID,
                mode: "library-index",
                code: "invalid_library_offset",
                message: "Library offset must be between 0 and 1000000."
            )
        }

        do {
            let dateFrom = try parseDate(request.dateFrom, field: "dateFrom")
            let dateTo = try parseDate(request.dateTo, field: "dateTo")
            let payloadData = try await libraryIndexWithTimeout(
                limit: limit,
                offset: offset,
                dateFrom: dateFrom,
                dateTo: dateTo
            )
            guard var payload = try JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
                  payload["ok"] as? Bool == true,
                  payload["mode"] as? String == "library-index",
                  payload["limit"] as? Int == limit,
                  payload["offset"] as? Int == offset,
                  let items = payload["items"] as? [[String: Any]],
                  let count = payload["count"] as? Int,
                  count == items.count,
                  count <= limit else {
                return encodeError(
                    requestID: request.requestID,
                    mode: "library-index",
                    code: "invalid_library_response",
                    message: "Backstage returned malformed library-index data."
                )
            }
            payload["requestId"] = request.requestID
            let encoded = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            guard encoded.count <= limits.maximumResponseBytes else {
                return encodeError(
                    requestID: request.requestID,
                    mode: "library-index",
                    code: "response_oversized",
                    message: "The library-index response exceeds the allowed size."
                )
            }
            return encoded
        } catch is LibraryDateArgumentError {
            return encodeError(
                requestID: request.requestID,
                mode: "library-index",
                code: "invalid_library_date",
                message: "The library date range is invalid."
            )
        } catch is LibraryIndexTimeoutError {
            return encodeError(
                requestID: request.requestID,
                mode: "library-index",
                code: "library_index_timeout",
                message: "Backstage timed out while indexing the Photos library."
            )
        } catch let error as PhotoLibraryError {
            return encodeError(
                requestID: request.requestID,
                mode: "library-index",
                code: errorCode(error),
                message: error.localizedDescription
            )
        } catch {
            return encodeError(
                requestID: request.requestID,
                mode: "library-index",
                code: "library_index_failed",
                message: "Backstage could not index the Photos library."
            )
        }
    }

    private func processMetadata(_ request: PreviewRequest, apply: Bool) async -> Data {
        let mode = apply
            ? BackstagePreviewIPCConstants.metadataApplyManyOperation
            : BackstagePreviewIPCConstants.metadataReadManyOperation
        guard let requests = request.requests,
              !requests.isEmpty,
              requests.count <= BackstagePreviewIPCConstants.maximumMetadataItems else {
            return encodeError(
                requestID: request.requestID,
                mode: mode,
                code: "invalid_metadata_requests",
                message: "Backstage metadata requests must contain 1 to 64 items."
            )
        }
        guard requests.allSatisfy(validMetadataRequest) else {
            return encodeError(
                requestID: request.requestID,
                mode: mode,
                code: "invalid_metadata_request",
                message: "Backstage metadata requests contain an invalid asset ID or field."
            )
        }

        do {
            let payloadData = try await metadataWithTimeout(requests: requests, apply: apply)
            guard var payload = try JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
                  payload["ok"] as? Bool == true,
                  payload["mode"] as? String == mode,
                  let items = payload["items"] as? [[String: Any]],
                  payload["count"] as? Int == items.count,
                  items.count == requests.count,
                  items.compactMap({ $0["assetId"] as? String }) == requests.map(\.assetID) else {
                return encodeError(
                    requestID: request.requestID,
                    mode: mode,
                    code: "invalid_metadata_response",
                    message: "Backstage returned malformed Photos metadata data."
                )
            }
            payload["requestId"] = request.requestID
            let encoded = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            guard encoded.count <= limits.maximumResponseBytes else {
                return encodeError(
                    requestID: request.requestID,
                    mode: mode,
                    code: "response_oversized",
                    message: "The metadata response exceeds the allowed size."
                )
            }
            return encoded
        } catch is LibraryIndexTimeoutError {
            return encodeError(
                requestID: request.requestID,
                mode: mode,
                code: "metadata_timeout",
                message: "Backstage timed out while reading or applying Photos metadata."
            )
        } catch let error as PhotoLibraryError {
            return encodeError(
                requestID: request.requestID,
                mode: mode,
                code: errorCode(error),
                message: error.localizedDescription
            )
        } catch {
            return encodeError(
                requestID: request.requestID,
                mode: mode,
                code: "metadata_failed",
                message: "Backstage could not read or apply Photos metadata."
            )
        }
    }

    private func processExportOriginal(_ request: PreviewRequest, assetID: String) async -> Data {
        let requestDirectory = exportDirectory
            .appendingPathComponent(request.requestID, isDirectory: true)
        var completed = false
        defer {
            if !completed { try? FileManager.default.removeItem(at: requestDirectory) }
        }

        do {
            try FileManager.default.createDirectory(
                at: requestDirectory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            let receipt = try await exportWithTimeout(
                assetID: assetID,
                directory: requestDirectory,
                allowICloudDownloads: request.allowICloudDownloads ?? true
            )
            let destination = receipt.destination.standardizedFileURL
            let requestRoot = requestDirectory.standardizedFileURL
            let exportRoot = exportDirectory.standardizedFileURL
            guard destination.path.hasPrefix(requestRoot.path + "/"),
                  destination.path.hasPrefix(exportRoot.path + "/"),
                  FileManager.default.fileExists(atPath: destination.path) else {
                return encodeExportError(
                    requestID: request.requestID,
                    code: "unsafe_export_destination",
                    message: "Backstage returned an export outside its owner-only staging directory."
                )
            }
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: destination.path
            )
            let relativePath = String(destination.path.dropFirst(exportRoot.path.count + 1))
            let response = ExportResponse(
                ok: true,
                requestID: request.requestID,
                mode: "export-original",
                assetID: receipt.assetID,
                filename: destination.lastPathComponent,
                originalFilename: receipt.filename,
                relativePath: relativePath,
                uniformTypeIdentifier: receipt.uniformTypeIdentifier,
                bytes: receipt.byteCount,
                checksumSHA256: receipt.checksumSHA256,
                error: nil
            )
            let encoded = encode(response)
            guard encoded.count <= limits.maximumResponseBytes else {
                return encodeExportError(
                    requestID: request.requestID,
                    code: "response_oversized",
                    message: "The export receipt exceeds the allowed response size."
                )
            }
            completed = true
            return encoded
        } catch is ExportTimeoutError {
            return encodeExportError(
                requestID: request.requestID,
                code: "export_timeout",
                message: "Backstage timed out while materializing the Photos original."
            )
        } catch let error as PhotoLibraryError {
            return encodeExportError(
                requestID: request.requestID,
                code: errorCode(error),
                message: error.localizedDescription
            )
        } catch {
            return encodeExportError(
                requestID: request.requestID,
                code: "export_failed",
                message: "Backstage could not materialize the Photos original."
            )
        }
    }

    private func previewWithTimeout(assetID: String, maxPixel: Int) async throws -> PhotoPreview {
        let photoLibrary = photoLibrary
        let operationTimeout = limits.operationTimeout
        return try await withCheckedThrowingContinuation { continuation in
            let gate = PreviewResultGate(continuation)
            Task {
                do {
                    let preview = try await photoLibrary.preview(
                        localIdentifier: assetID,
                        maxPixelSize: maxPixel
                    )
                    gate.resume(with: .success(preview))
                } catch {
                    gate.resume(with: .failure(error))
                }
            }
            let timeoutTask = Task {
                do {
                    try await Task.sleep(for: operationTimeout)
                } catch {
                    return
                }
                gate.resume(with: .failure(PreviewTimeoutError()))
            }
            gate.installTimeout(timeoutTask)
        }
    }

    private func libraryIndexWithTimeout(
        limit: Int,
        offset: Int,
        dateFrom: Date?,
        dateTo: Date?
    ) async throws -> Data {
        let photoLibrary = photoLibrary
        let operationTimeout = limits.libraryIndexOperationTimeout
        return try await withCheckedThrowingContinuation { continuation in
            let gate = LibraryIndexResultGate(continuation)
            Task {
                do {
                    let data = try await photoLibrary.libraryIndex(
                        limit: limit,
                        offset: offset,
                        dateFrom: dateFrom,
                        dateTo: dateTo
                    )
                    gate.resume(with: .success(data))
                } catch {
                    gate.resume(with: .failure(error))
                }
            }
            let timeoutTask = Task {
                do {
                    try await Task.sleep(for: operationTimeout)
                } catch {
                    return
                }
                gate.resume(with: .failure(LibraryIndexTimeoutError()))
            }
            gate.installTimeout(timeoutTask)
        }
    }

    private func exportWithTimeout(
        assetID: String,
        directory: URL,
        allowICloudDownloads: Bool
    ) async throws -> PhotoExportReceipt {
        let photoLibrary = photoLibrary
        let operationTimeout = limits.exportOperationTimeout
        return try await withCheckedThrowingContinuation { continuation in
            let gate = ExportResultGate(continuation)
            Task {
                do {
                    let receipt = try await photoLibrary.exportOriginal(
                        localIdentifier: assetID,
                        to: directory,
                        allowICloudDownloads: allowICloudDownloads
                    )
                    gate.resume(with: .success(receipt))
                } catch {
                    gate.resume(with: .failure(error))
                }
            }
            let timeoutTask = Task {
                do {
                    try await Task.sleep(for: operationTimeout)
                } catch {
                    return
                }
                gate.resume(with: .failure(ExportTimeoutError()))
            }
            gate.installTimeout(timeoutTask)
        }
    }

    private func metadataWithTimeout(
        requests: [PhotoMetadataApplyRequest],
        apply: Bool
    ) async throws -> Data {
        let photoLibrary = photoLibrary
        let operationTimeout = limits.metadataOperationTimeout
        return try await withCheckedThrowingContinuation { continuation in
            let gate = LibraryIndexResultGate(continuation)
            Task {
                do {
                    let data: Data
                    if apply {
                        data = try await photoLibrary.metadataApplyMany(requests: requests)
                    } else {
                        data = try await photoLibrary.metadataReadMany(
                            assetIDs: requests.map(\.assetID)
                        )
                    }
                    gate.resume(with: .success(data))
                } catch {
                    gate.resume(with: .failure(error))
                }
            }
            let timeoutTask = Task {
                do {
                    try await Task.sleep(for: operationTimeout)
                } catch {
                    return
                }
                gate.resume(with: .failure(LibraryIndexTimeoutError()))
            }
            gate.installTimeout(timeoutTask)
        }
    }

    private func parseDate(_ value: String?, field: String) throws -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        if let date = standard.date(from: value) { return date }
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = TimeZone(secondsFromGMT: 0)
        day.dateFormat = "yyyy-MM-dd"
        if let date = day.date(from: value) { return date }
        throw LibraryDateArgumentError(field: field)
    }

    private func validAssetID(_ assetID: String) -> Bool {
        guard !assetID.isEmpty,
              assetID.utf8.count <= BackstagePreviewIPCConstants.maximumAssetIDBytes,
              assetID == assetID.trimmingCharacters(in: .whitespacesAndNewlines) else { return false }
        return assetID.unicodeScalars.allSatisfy {
            !CharacterSet.controlCharacters.contains($0)
        }
    }

    private func validMetadataRequest(_ request: PhotoMetadataApplyRequest) -> Bool {
        guard validAssetID(request.assetID),
              validMetadataText(request.title),
              validMetadataText(request.caption),
              request.keywords.count <= BackstagePreviewIPCConstants.maximumMetadataKeywords,
              request.managedKeywords.count <= BackstagePreviewIPCConstants.maximumMetadataKeywords else {
            return false
        }
        return request.keywords.allSatisfy(validMetadataText)
            && request.managedKeywords.allSatisfy(validMetadataText)
    }

    private func validMetadataText(_ value: String) -> Bool {
        value.utf8.count <= BackstagePreviewIPCConstants.maximumMetadataTextBytes
            && value.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) }
    }

    private func isJPEG(_ data: Data) -> Bool {
        data.count >= 4
            && data[data.startIndex] == 0xff
            && data[data.index(after: data.startIndex)] == 0xd8
            && data[data.index(data.endIndex, offsetBy: -2)] == 0xff
            && data[data.index(before: data.endIndex)] == 0xd9
    }

    private func errorCode(_ error: PhotoLibraryError) -> String {
        switch error {
        case .accessDenied: "photos_access_denied"
        case .assetNotFound: "asset_not_found"
        case .unsupportedMediaType: "unsupported_media_type"
        case .resourceNotFound: "resource_not_found"
        case .previewUnavailable: "preview_unavailable"
        case .exportFailed: "export_failed"
        case .metadataFailed: "metadata_failed"
        }
    }

    private func encodeError(requestID: String, mode: String = "preview", code: String, message: String) -> Data {
        encode(PreviewResponse(
            ok: false,
            requestID: requestID,
            mode: mode,
            assetID: nil,
            bytes: nil,
            pixelWidth: nil,
            pixelHeight: nil,
            mimeType: nil,
            dataBase64: nil,
            error: PreviewError(code: code, message: message)
        ))
    }

    private func encode(_ response: PreviewResponse) -> Data {
        (try? JSONEncoder().encode(response)) ?? Data(
            #"{"ok":false,"requestId":"","mode":"preview","error":{"code":"encoding_failed","message":"Backstage could not encode the IPC response."}}"#.utf8
        )
    }

    private func encodeExportError(requestID: String, code: String, message: String) -> Data {
        encode(ExportResponse(
            ok: false,
            requestID: requestID,
            mode: "export-original",
            assetID: nil,
            filename: nil,
            originalFilename: nil,
            relativePath: nil,
            uniformTypeIdentifier: nil,
            bytes: nil,
            checksumSHA256: nil,
            error: PreviewError(code: code, message: message)
        ))
    }

    private func encode(_ response: ExportResponse) -> Data {
        (try? JSONEncoder().encode(response)) ?? Data(
            #"{"ok":false,"requestId":"","mode":"export-original","error":{"code":"encoding_failed","message":"Backstage could not encode the export receipt."}}"#.utf8
        )
    }
}

private struct PreviewRequest: Decodable {
    var requestID: String
    var operation: String
    var authorization: String
    var assetID: String?
    var maxPixel: Int?
    var limit: Int?
    var offset: Int?
    var dateFrom: String?
    var dateTo: String?
    var allowICloudDownloads: Bool?
    var requests: [PhotoMetadataApplyRequest]?

    enum CodingKeys: String, CodingKey {
        case requestID = "requestId"
        case operation, authorization
        case assetID = "assetId"
        case maxPixel
        case limit, offset
        case dateFrom, dateTo
        case allowICloudDownloads
        case requests
    }
}

private struct PreviewResponse: Encodable {
    var ok: Bool
    var requestID: String
    var mode: String
    var assetID: String?
    var bytes: Int?
    var pixelWidth: Int?
    var pixelHeight: Int?
    var mimeType: String?
    var dataBase64: String?
    var error: PreviewError?

    enum CodingKeys: String, CodingKey {
        case ok, mode, bytes, pixelWidth, pixelHeight, mimeType, dataBase64, error
        case requestID = "requestId"
        case assetID = "assetId"
    }
}

private struct ExportResponse: Encodable {
    var ok: Bool
    var requestID: String
    var mode: String
    var assetID: String?
    var filename: String?
    var originalFilename: String?
    var relativePath: String?
    var uniformTypeIdentifier: String?
    var bytes: Int64?
    var checksumSHA256: String?
    var error: PreviewError?

    enum CodingKeys: String, CodingKey {
        case ok, mode, filename, originalFilename, relativePath
        case uniformTypeIdentifier, bytes, checksumSHA256, error
        case requestID = "requestId"
        case assetID = "assetId"
    }
}

private struct PreviewError: Encodable {
    var code: String
    var message: String
}

private struct PreviewTimeoutError: Error {}

private struct LibraryDateArgumentError: Error {
    var field: String
}

private struct LibraryIndexTimeoutError: Error {}

private struct ExportTimeoutError: Error {}

/// Completes the preview race exactly once without waiting for a PhotoKit
/// continuation that may not support cancellation.
private final class PreviewResultGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<PhotoPreview, Error>?
    private var timeoutTask: Task<Void, Never>?

    init(_ continuation: CheckedContinuation<PhotoPreview, Error>) {
        self.continuation = continuation
    }

    func resume(with result: Result<PhotoPreview, Error>) {
        lock.lock()
        let pending = continuation
        continuation = nil
        let timeout = timeoutTask
        timeoutTask = nil
        lock.unlock()
        timeout?.cancel()
        pending?.resume(with: result)
    }

    func installTimeout(_ task: Task<Void, Never>) {
        lock.lock()
        let isPending = continuation != nil
        if isPending { timeoutTask = task }
        lock.unlock()
        if !isPending { task.cancel() }
    }
}

/// Completes a library-index race exactly once while allowing a slow Photos
/// fetch to finish independently after the bounded IPC response has returned.
private final class LibraryIndexResultGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, Error>?
    private var timeoutTask: Task<Void, Never>?

    init(_ continuation: CheckedContinuation<Data, Error>) {
        self.continuation = continuation
    }

    func resume(with result: Result<Data, Error>) {
        lock.lock()
        let pending = continuation
        continuation = nil
        let timeout = timeoutTask
        timeoutTask = nil
        lock.unlock()
        timeout?.cancel()
        pending?.resume(with: result)
    }

    func installTimeout(_ task: Task<Void, Never>) {
        lock.lock()
        let isPending = continuation != nil
        if isPending { timeoutTask = task }
        lock.unlock()
        if !isPending { task.cancel() }
    }
}

private final class ExportResultGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<PhotoExportReceipt, Error>?
    private var timeoutTask: Task<Void, Never>?

    init(_ continuation: CheckedContinuation<PhotoExportReceipt, Error>) {
        self.continuation = continuation
    }

    func resume(with result: Result<PhotoExportReceipt, Error>) {
        lock.lock()
        let pending = continuation
        continuation = nil
        let timeout = timeoutTask
        timeoutTask = nil
        lock.unlock()
        timeout?.cancel()
        pending?.resume(with: result)
    }

    func installTimeout(_ task: Task<Void, Never>) {
        lock.lock()
        let isPending = continuation != nil
        if isPending { timeoutTask = task }
        lock.unlock()
        if !isPending { task.cancel() }
    }
}

private func constantTimeEqual(_ lhs: String, _ rhs: String) -> Bool {
    let left = Array(lhs.utf8)
    let right = Array(rhs.utf8)
    let count = max(left.count, right.count)
    var difference = UInt64(left.count ^ right.count)
    for index in 0..<count {
        difference |= UInt64(
            (index < left.count ? left[index] : 0)
                ^ (index < right.count ? right[index] : 0)
        )
    }
    return difference == 0
}
