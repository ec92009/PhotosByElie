import Foundation

public enum BackstagePreviewIPCConstants {
    public static let schemaVersion = 1
    public static let operation = "photos.preview"
    public static let libraryIndexOperation = "photos.library-index"
    public static let minimumMaxPixel = 256
    public static let maximumMaxPixel = 1_800
    public static let minimumLibraryLimit = 1
    public static let maximumLibraryLimit = 1_000
    public static let maximumLibraryOffset = 1_000_000
    public static let maximumRequestBytes = 16_384
    public static let maximumPreviewBytes = 8 * 1_024 * 1_024
    public static let maximumResponseBytes = 12 * 1_024 * 1_024
    public static let maximumAssetIDBytes = 2_048
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

    public init(
        maximumRequestBytes: Int = BackstagePreviewIPCConstants.maximumRequestBytes,
        maximumPreviewBytes: Int = BackstagePreviewIPCConstants.maximumPreviewBytes,
        maximumResponseBytes: Int = BackstagePreviewIPCConstants.maximumResponseBytes,
        operationTimeout: Duration = .seconds(55)
    ) {
        self.maximumRequestBytes = maximumRequestBytes
        self.maximumPreviewBytes = maximumPreviewBytes
        self.maximumResponseBytes = maximumResponseBytes
        self.operationTimeout = operationTimeout
    }
}

public struct BackstagePreviewIPCProcessor: Sendable {
    private let photoLibrary: any PhotoLibraryServing
    private let bearerToken: String
    private let limits: BackstagePreviewIPCLimits

    public init(
        photoLibrary: any PhotoLibraryServing,
        bearerToken: String,
        limits: BackstagePreviewIPCLimits = BackstagePreviewIPCLimits()
    ) {
        self.photoLibrary = photoLibrary
        self.bearerToken = bearerToken
        self.limits = limits
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
            || request.operation == BackstagePreviewIPCConstants.libraryIndexOperation else {
            return encodeError(requestID: request.requestID, code: "unsupported_operation", message: "The requested IPC operation is not supported.")
        }
        guard [.authorized, .limited].contains(photoLibrary.authorization()) else {
            return encodeError(requestID: request.requestID, code: "photos_access_denied", message: "Backstage does not have Photos access.")
        }

        if request.operation == BackstagePreviewIPCConstants.libraryIndexOperation {
            return await processLibraryIndex(request)
        }

        guard let assetID = request.assetID, validAssetID(assetID) else {
            return encodeError(requestID: request.requestID, code: "invalid_asset_id", message: "The Photos asset ID is missing or exceeds the allowed size.")
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
        let operationTimeout = limits.operationTimeout
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
        case .exportFailed: "preview_failed"
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

    enum CodingKeys: String, CodingKey {
        case requestID = "requestId"
        case operation, authorization
        case assetID = "assetId"
        case maxPixel
        case limit, offset
        case dateFrom, dateTo
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

private struct PreviewError: Encodable {
    var code: String
    var message: String
}

private struct PreviewTimeoutError: Error {}

private struct LibraryDateArgumentError: Error {
    var field: String
}

private struct LibraryIndexTimeoutError: Error {}

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
