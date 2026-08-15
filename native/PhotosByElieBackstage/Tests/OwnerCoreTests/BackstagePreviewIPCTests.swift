import Darwin
import CryptoKit
import Foundation
import Testing
@testable import OwnerCore

@Suite("Backstage-owned Photos preview IPC")
struct BackstagePreviewIPCTests {
    @Test("Authenticated preview requests return bounded JPEG bytes without a destination path")
    func authenticatedPreviewSucceeds() async throws {
        let jpeg = Data([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9])
        let library = PreviewIPCTestLibrary(
            outcome: .success(PhotoPreview(
                assetID: "asset-1",
                jpegData: jpeg,
                pixelWidth: 640,
                pixelHeight: 480
            ))
        )
        let response = try await process(
            library: library,
            request: request(assetID: "asset-1")
        )

        #expect(response["ok"] as? Bool == true)
        #expect(response["mode"] as? String == "preview")
        #expect(response["assetId"] as? String == "asset-1")
        #expect(response["bytes"] as? Int == jpeg.count)
        #expect(response["dataBase64"] as? String == jpeg.base64EncodedString())
        #expect(response["destination"] == nil)
        #expect(library.previewCount == 1)
    }

    @Test("Authenticated library-index requests return a bounded PhotoKit page")
    func authenticatedLibraryIndexSucceeds() async throws {
        let payload = try JSONSerialization.data(withJSONObject: [
            "ok": true,
            "mode": "library-index",
            "limit": 2,
            "offset": 4,
            "count": 1,
            "fetchedCount": 5,
            "skippedCount": 4,
            "items": [["assetId": "asset-1", "mediaType": "photo", "filename": "one.jpg"]],
        ])
        let library = PreviewIPCTestLibrary(
            outcome: .failure(.assetNotFound("asset-1")),
            libraryPayload: payload
        )
        let response = try await process(
            library: library,
            request: libraryRequest(limit: 2, offset: 4)
        )

        #expect(response["ok"] as? Bool == true)
        #expect(response["mode"] as? String == "library-index")
        #expect(response["requestId"] as? String != nil)
        #expect(response["count"] as? Int == 1)
        #expect(library.libraryIndexCount == 1)
    }

    @Test("Authenticated original export stages a private receipt without exposing an absolute path")
    func authenticatedOriginalExportSucceeds() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("BackstageExportIPCTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let original = Data("owner-only-original".utf8)
        let library = PreviewIPCTestLibrary(
            outcome: .failure(.assetNotFound("asset-1")),
            exportData: original
        )
        var exportRequest = request(assetID: "asset-1")
        exportRequest["operation"] = BackstagePreviewIPCConstants.exportOriginalOperation
        exportRequest.removeValue(forKey: "maxPixel")
        exportRequest["allowICloudDownloads"] = false

        let response = try await process(
            library: library,
            request: exportRequest,
            exportDirectory: root
        )

        #expect(response["ok"] as? Bool == true)
        #expect(response["mode"] as? String == "export-original")
        #expect(response["assetId"] as? String == "asset-1")
        #expect(response["relativePath"] as? String != nil)
        #expect((response["relativePath"] as? String)?.hasPrefix("/") == false)
        #expect(response["bytes"] as? Int == original.count)
        #expect(response["checksumSHA256"] as? String == SHA256.hash(data: original).map { String(format: "%02x", $0) }.joined())
        #expect(library.exportCount == 1)
        #expect(library.lastAllowICloudDownloads == false)

        let relativePath = try #require(response["relativePath"] as? String)
        let destination = root.appendingPathComponent(relativePath)
        let exportedData = try Data(contentsOf: destination)
        #expect(exportedData == original)
        let attributes = try FileManager.default.attributesOfItem(atPath: destination.path)
        #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    }

    @Test("Authentication and unsupported operations fail before Photos is called")
    func invalidAuthorizationFailsClosed() async throws {
        let library = PreviewIPCTestLibrary(
            outcome: .failure(.assetNotFound("asset-1"))
        )
        var unauthorized = request(assetID: "asset-1")
        unauthorized["authorization"] = "Bearer wrong-token"
        let authResponse = try await process(library: library, request: unauthorized)

        #expect(errorCode(authResponse) == "authentication_failed")
        #expect(library.previewCount == 0)

        var paddedAuthorization = request(assetID: "asset-1")
        paddedAuthorization["authorization"] = "Bearer test-token" + String(
            repeating: "\u{0000}",
            count: 256
        )
        let paddedResponse = try await process(
            library: library,
            request: paddedAuthorization
        )
        #expect(errorCode(paddedResponse) == "authentication_failed")
        #expect(library.previewCount == 0)

        var unsupported = request(assetID: "asset-1")
        unsupported["operation"] = "photos.export"
        let operationResponse = try await process(library: library, request: unsupported)

        #expect(errorCode(operationResponse) == "unsupported_operation")
        #expect(library.previewCount == 0)
    }

    @Test("Malformed bounds and denied Photos access fail closed")
    func invalidInputsFailClosed() async throws {
        let deniedLibrary = PreviewIPCTestLibrary(
            access: .denied,
            outcome: .failure(.accessDenied)
        )
        let denied = try await process(
            library: deniedLibrary,
            request: request(assetID: "asset-1")
        )
        #expect(errorCode(denied) == "photos_access_denied")
        #expect(deniedLibrary.previewCount == 0)

        let authorizedLibrary = PreviewIPCTestLibrary(
            outcome: .failure(.assetNotFound("asset-1"))
        )
        var invalidPixel = request(assetID: "asset-1")
        invalidPixel["maxPixel"] = BackstagePreviewIPCConstants.maximumMaxPixel + 1
        let pixelResponse = try await process(
            library: authorizedLibrary,
            request: invalidPixel
        )
        #expect(errorCode(pixelResponse) == "invalid_max_pixel")

        let controlResponse = try await process(
            library: authorizedLibrary,
            request: request(assetID: "asset\u{0001}")
        )
        #expect(errorCode(controlResponse) == "invalid_asset_id")
        #expect(authorizedLibrary.previewCount == 0)

        let invalidLibrary = try await process(
            library: authorizedLibrary,
            request: libraryRequest(limit: 0, offset: 0)
        )
        #expect(errorCode(invalidLibrary) == "invalid_library_limit")
        #expect(authorizedLibrary.libraryIndexCount == 0)
    }

    @Test("Preview timeout returns without waiting for a non-cancellable Photos continuation")
    func timeoutReturnsPromptly() async throws {
        let library = PreviewIPCTestLibrary(
            delay: .milliseconds(400),
            outcome: .failure(.previewUnavailable("slow"))
        )
        let limits = BackstagePreviewIPCLimits(operationTimeout: .milliseconds(20))
        let clock = ContinuousClock()
        let started = clock.now
        let response = try await process(
            library: library,
            request: request(assetID: "asset-1"),
            limits: limits
        )
        let elapsed = started.duration(to: clock.now)

        #expect(errorCode(response) == "preview_timeout")
        #expect(elapsed < .milliseconds(200))
        #expect(library.previewCount == 1)
    }

    @Test("Server publishes one owner-only descriptor and removes it on stop")
    func descriptorLifecycleIsOwnerOnly() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("BackstagePreviewIPCTests-\(UUID().uuidString)", isDirectory: true)
        let descriptorURL = root.appendingPathComponent("photos-preview-ipc.json")
        defer { try? FileManager.default.removeItem(at: root) }

        let server = BackstagePreviewIPCServer(
            photoLibrary: PreviewIPCTestLibrary(
                outcome: .success(PhotoPreview(
                    assetID: "asset-transport",
                    jpegData: Data([0xff, 0xd8, 0x03, 0x04, 0xff, 0xd9]),
                    pixelWidth: 800,
                    pixelHeight: 533
                ))
            ),
            configuration: BackstagePreviewIPCServerConfiguration(
                descriptorURL: descriptorURL,
                connectionTimeout: 0.2
            )
        )
        try server.start()
        defer { server.stop() }

        for _ in 0..<200 where !FileManager.default.fileExists(atPath: descriptorURL.path) {
            try await Task.sleep(for: .milliseconds(5))
        }
        let descriptorData = try Data(contentsOf: descriptorURL)
        let descriptor = try JSONDecoder().decode(
            BackstagePreviewIPCDescriptor.self,
            from: descriptorData
        )
        let attributes = try FileManager.default.attributesOfItem(atPath: descriptorURL.path)
        let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue

        #expect(descriptor.host == "127.0.0.1")
        #expect(descriptor.pid == getpid())
        #expect(descriptor.bearerToken.count == 64)
        #expect(permissions == 0o600)

        let transportRequest: [String: Any] = [
            "requestId": UUID().uuidString,
            "operation": BackstagePreviewIPCConstants.operation,
            "authorization": "Bearer \(descriptor.bearerToken)",
            "assetId": "asset-transport",
            "maxPixel": 900,
        ]
        let transportData = try JSONSerialization.data(withJSONObject: transportRequest)
        let responseData = try await Task.detached {
            try socketRoundTrip(descriptor: descriptor, requestData: transportData)
        }.value
        let transportResponse = try #require(
            JSONSerialization.jsonObject(with: responseData) as? [String: Any]
        )
        #expect(transportResponse["ok"] as? Bool == true)
        #expect(transportResponse["assetId"] as? String == "asset-transport")

        server.stop()
        for _ in 0..<100 where FileManager.default.fileExists(atPath: descriptorURL.path) {
            try await Task.sleep(for: .milliseconds(5))
        }
        #expect(!FileManager.default.fileExists(atPath: descriptorURL.path))
    }

    private func process(
        library: PreviewIPCTestLibrary,
        request: [String: Any],
        limits: BackstagePreviewIPCLimits = BackstagePreviewIPCLimits(),
        exportDirectory: URL? = nil
    ) async throws -> [String: Any] {
        let requestData = try JSONSerialization.data(withJSONObject: request)
        let processor = BackstagePreviewIPCProcessor(
            photoLibrary: library,
            bearerToken: "test-token",
            limits: limits,
            exportDirectory: exportDirectory ?? BackstagePreviewIPCConstants.defaultExportDirectory()
        )
        let responseData = await processor.process(requestData)
        guard let response = try JSONSerialization.jsonObject(with: responseData) as? [String: Any] else {
            throw BackstagePreviewIPCTestError.invalidResponse
        }
        return response
    }

    private func request(assetID: String) -> [String: Any] {
        [
            "requestId": UUID().uuidString,
            "operation": BackstagePreviewIPCConstants.operation,
            "authorization": "Bearer test-token",
            "assetId": assetID,
            "maxPixel": 900,
        ]
    }

    private func libraryRequest(limit: Int, offset: Int) -> [String: Any] {
        [
            "requestId": UUID().uuidString,
            "operation": BackstagePreviewIPCConstants.libraryIndexOperation,
            "authorization": "Bearer test-token",
            "limit": limit,
            "offset": offset,
        ]
    }

    private func errorCode(_ response: [String: Any]) -> String? {
        (response["error"] as? [String: Any])?["code"] as? String
    }
}

private enum BackstagePreviewIPCTestError: Error {
    case invalidResponse
    case socketFailure(String)
}

private func socketRoundTrip(
    descriptor: BackstagePreviewIPCDescriptor,
    requestData: Data
) throws -> Data {
    let fileDescriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard fileDescriptor >= 0 else {
        throw BackstagePreviewIPCTestError.socketFailure(String(cString: strerror(errno)))
    }
    defer { Darwin.close(fileDescriptor) }

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = descriptor.port.bigEndian
    guard inet_pton(AF_INET, descriptor.host, &address.sin_addr) == 1 else {
        throw BackstagePreviewIPCTestError.socketFailure("invalid loopback address")
    }
    let connected = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.connect(
                fileDescriptor,
                $0,
                socklen_t(MemoryLayout<sockaddr_in>.size)
            )
        }
    }
    guard connected == 0 else {
        throw BackstagePreviewIPCTestError.socketFailure(String(cString: strerror(errno)))
    }

    var requestLength = UInt32(requestData.count).bigEndian
    var frame = withUnsafeBytes(of: &requestLength) { Data($0) }
    frame.append(requestData)
    try writeAll(frame, to: fileDescriptor)
    let responseHeader = try readExactly(4, from: fileDescriptor)
    let responseLength = responseHeader.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    guard responseLength > 0,
          responseLength <= BackstagePreviewIPCConstants.maximumResponseBytes else {
        throw BackstagePreviewIPCTestError.socketFailure("invalid response size")
    }
    return try readExactly(Int(responseLength), from: fileDescriptor)
}

private func writeAll(_ data: Data, to fileDescriptor: Int32) throws {
    try data.withUnsafeBytes { buffer in
        guard let baseAddress = buffer.baseAddress else { return }
        var written = 0
        while written < buffer.count {
            let count = Darwin.write(
                fileDescriptor,
                baseAddress.advanced(by: written),
                buffer.count - written
            )
            guard count > 0 else {
                throw BackstagePreviewIPCTestError.socketFailure(String(cString: strerror(errno)))
            }
            written += count
        }
    }
}

private func readExactly(_ count: Int, from fileDescriptor: Int32) throws -> Data {
    var data = Data(count: count)
    let bytesRead = try data.withUnsafeMutableBytes { buffer -> Int in
        guard let baseAddress = buffer.baseAddress else { return 0 }
        var received = 0
        while received < count {
            let result = Darwin.read(
                fileDescriptor,
                baseAddress.advanced(by: received),
                count - received
            )
            guard result > 0 else {
                throw BackstagePreviewIPCTestError.socketFailure(
                    result == 0 ? "connection closed" : String(cString: strerror(errno))
                )
            }
            received += result
        }
        return received
    }
    guard bytesRead == count else {
        throw BackstagePreviewIPCTestError.socketFailure("truncated response")
    }
    return data
}

private final class PreviewIPCTestLibrary: PhotoLibraryServing, @unchecked Sendable {
    private let lock = NSLock()
    private let access: PhotoLibraryAccess
    private let delay: Duration
    private let outcome: Result<PhotoPreview, PhotoLibraryError>
    private let libraryPayload: Data?
    private let exportData: Data?
    private var previewCalls = 0
    private var libraryCalls = 0
    private var exportCalls = 0
    private var lastAllowICloudDownloadsValue: Bool?

    init(
        access: PhotoLibraryAccess = .authorized,
        delay: Duration = .zero,
        outcome: Result<PhotoPreview, PhotoLibraryError>,
        libraryPayload: Data? = nil,
        exportData: Data? = nil
    ) {
        self.access = access
        self.delay = delay
        self.outcome = outcome
        self.libraryPayload = libraryPayload
        self.exportData = exportData
    }

    var previewCount: Int {
        lock.withLock { previewCalls }
    }

    var libraryIndexCount: Int {
        lock.withLock { libraryCalls }
    }

    var exportCount: Int {
        lock.withLock { exportCalls }
    }

    var lastAllowICloudDownloads: Bool? {
        lock.withLock { lastAllowICloudDownloadsValue }
    }

    func authorization() -> PhotoLibraryAccess { access }

    func requestAuthorization() async -> PhotoLibraryAccess { access }

    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func libraryIndex(limit: Int, offset: Int, dateFrom: Date?, dateTo: Date?) async throws -> Data {
        lock.withLock { libraryCalls += 1 }
        if let libraryPayload { return libraryPayload }
        return try JSONSerialization.data(withJSONObject: [
            "ok": true,
            "mode": "library-index",
            "limit": limit,
            "offset": offset,
            "count": 0,
            "fetchedCount": 0,
            "skippedCount": 0,
            "items": [],
        ])
    }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        lock.withLock { previewCalls += 1 }
        if delay != .zero {
            try await Task.sleep(for: delay)
        }
        return try outcome.get()
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        try await exportOriginal(
            localIdentifier: localIdentifier,
            to: directory,
            allowICloudDownloads: true
        )
    }

    func exportOriginal(
        localIdentifier: String,
        to directory: URL,
        allowICloudDownloads: Bool
    ) async throws -> PhotoExportReceipt {
        guard let exportData else {
            throw PhotoLibraryError.assetNotFound(localIdentifier)
        }
        lock.withLock {
            exportCalls += 1
            lastAllowICloudDownloadsValue = allowICloudDownloads
        }
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let destination = directory.appendingPathComponent("IMG_0001.JPG")
        try exportData.write(to: destination, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: destination.path
        )
        let checksum = SHA256.hash(data: exportData)
            .map { String(format: "%02x", $0) }
            .joined()
        return PhotoExportReceipt(
            assetID: localIdentifier,
            filename: destination.lastPathComponent,
            destination: destination,
            uniformTypeIdentifier: "public.jpeg",
            byteCount: Int64(exportData.count),
            checksumSHA256: checksum
        )
    }
}
