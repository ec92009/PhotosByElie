import Darwin
import Foundation
import Network
import Security

public struct BackstagePreviewIPCServerConfiguration: Sendable {
    public var descriptorURL: URL
    public var connectionTimeout: TimeInterval
    public var limits: BackstagePreviewIPCLimits

    public init(
        descriptorURL: URL = Self.defaultDescriptorURL,
        connectionTimeout: TimeInterval = 60,
        limits: BackstagePreviewIPCLimits = BackstagePreviewIPCLimits()
    ) {
        self.descriptorURL = descriptorURL
        self.connectionTimeout = connectionTimeout
        self.limits = limits
    }

    public static var defaultDescriptorURL: URL {
        let applicationSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support", isDirectory: true)
        return applicationSupport
            .appendingPathComponent("PhotosByElie Backstage", isDirectory: true)
            .appendingPathComponent("photos-preview-ipc.json", isDirectory: false)
    }
}

public enum BackstagePreviewIPCServerError: Error, LocalizedError {
    case alreadyRunning
    case randomTokenFailed(OSStatus)
    case unsafeDescriptorDirectory(String)
    case unsafeDescriptor(String)
    case descriptorWriteFailed(String)
    case listenerFailed(String)

    public var errorDescription: String? {
        switch self {
        case .alreadyRunning: "The Backstage preview IPC server is already running."
        case .randomTokenFailed(let code): "Backstage could not create an IPC token (Security error \(code))."
        case .unsafeDescriptorDirectory(let message): "The Backstage IPC descriptor directory is unsafe: \(message)"
        case .unsafeDescriptor(let message): "The Backstage IPC descriptor is unsafe: \(message)"
        case .descriptorWriteFailed(let message): "Backstage could not publish its IPC descriptor: \(message)"
        case .listenerFailed(let message): "Backstage could not start its loopback IPC listener: \(message)"
        }
    }
}

/// A Backstage-owned, loopback-only preview endpoint.
///
/// The server returns bytes only. The Python client owns the destination path
/// and atomic write, so this process never accepts arbitrary filesystem paths.
public final class BackstagePreviewIPCServer: @unchecked Sendable {
    private let configuration: BackstagePreviewIPCServerConfiguration
    private let photoLibrary: any PhotoLibraryServing
    private let queue = DispatchQueue(label: "com.photosbyelie.backstage.preview-ipc")
    private let stateLock = NSLock()
    private var listener: NWListener?
    private var bearerToken = ""

    public init(
        photoLibrary: any PhotoLibraryServing,
        configuration: BackstagePreviewIPCServerConfiguration = BackstagePreviewIPCServerConfiguration()
    ) {
        self.photoLibrary = photoLibrary
        self.configuration = configuration
    }

    deinit {
        stop()
    }

    public func start() throws {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard listener == nil else { return }

        try prepareDescriptorLocation()
        let token = try makeBearerToken()
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = false
        parameters.requiredLocalEndpoint = .hostPort(
            host: NWEndpoint.Host("127.0.0.1"),
            port: NWEndpoint.Port(rawValue: 0)!
        )
        let newListener: NWListener
        do {
            newListener = try NWListener(using: parameters)
        } catch {
            throw BackstagePreviewIPCServerError.listenerFailed(error.localizedDescription)
        }

        bearerToken = token
        listener = newListener
        newListener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        newListener.stateUpdateHandler = { [weak self, weak newListener] state in
            guard let self, let newListener else { return }
            switch state {
            case .ready:
                guard let port = newListener.port?.rawValue else {
                    newListener.cancel()
                    return
                }
                do {
                    try self.publishDescriptor(port: port, token: token)
                } catch {
                    newListener.cancel()
                }
            case .failed:
                newListener.cancel()
                self.listenerDidTerminate(newListener, token: token)
            case .cancelled:
                self.listenerDidTerminate(newListener, token: token)
            default:
                break
            }
        }
        newListener.start(queue: queue)
    }

    public func stop() {
        stateLock.lock()
        let currentListener = listener
        let token = bearerToken
        listener = nil
        bearerToken = ""
        stateLock.unlock()
        currentListener?.cancel()
        removeDescriptorIfOwned(token: token)
    }

    private func listenerDidTerminate(_ candidate: NWListener, token: String) {
        stateLock.lock()
        if listener === candidate {
            listener = nil
            bearerToken = ""
        }
        stateLock.unlock()
        removeDescriptorIfOwned(token: token)
    }

    private func accept(_ connection: NWConnection) {
        guard isLoopback(connection.endpoint) else {
            connection.cancel()
            return
        }
        stateLock.lock()
        let token = bearerToken
        let isRunning = listener != nil
        stateLock.unlock()
        guard isRunning, !token.isEmpty else {
            connection.cancel()
            return
        }
        connection.start(queue: queue)
        let deadline = ConnectionDeadline()
        queue.asyncAfter(deadline: .now() + max(0.1, configuration.connectionTimeout)) {
            deadline.fire(connection)
        }
        receiveExactly(4, from: connection) { [weak self] header in
            guard let self, let header else {
                deadline.disarm()
                connection.cancel()
                return
            }
            let length = Int(header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) })
            guard length > 0, length <= self.configuration.limits.maximumRequestBytes else {
                deadline.disarm()
                connection.cancel()
                return
            }
            self.receiveExactly(length, from: connection) { [weak self] requestData in
                guard let self, let requestData else {
                    deadline.disarm()
                    connection.cancel()
                    return
                }
                let processor = BackstagePreviewIPCProcessor(
                    photoLibrary: self.photoLibrary,
                    bearerToken: token,
                    limits: self.configuration.limits
                )
                Task {
                    let response = await processor.process(requestData)
                    self.queue.async {
                        self.send(response, on: connection, deadline: deadline)
                    }
                }
            }
        }
    }

    private func receiveExactly(
        _ expectedCount: Int,
        from connection: NWConnection,
        accumulated: Data = Data(),
        completion: @escaping @Sendable (Data?) -> Void
    ) {
        connection.receive(
            minimumIncompleteLength: 1,
            maximumLength: expectedCount - accumulated.count
        ) { [weak self] data, _, isComplete, error in
            guard let self, error == nil, let data, !data.isEmpty else {
                completion(nil)
                return
            }
            var received = accumulated
            received.append(data)
            if received.count == expectedCount {
                completion(received)
            } else if received.count < expectedCount, !isComplete {
                self.receiveExactly(
                    expectedCount,
                    from: connection,
                    accumulated: received,
                    completion: completion
                )
            } else {
                completion(nil)
            }
        }
    }

    private func send(
        _ response: Data,
        on connection: NWConnection,
        deadline: ConnectionDeadline
    ) {
        guard response.count <= configuration.limits.maximumResponseBytes,
              let responseLength = UInt32(exactly: response.count) else {
            deadline.disarm()
            connection.cancel()
            return
        }
        var bigEndianLength = responseLength.bigEndian
        var frame = withUnsafeBytes(of: &bigEndianLength) { Data($0) }
        frame.append(response)
        connection.send(content: frame, completion: .contentProcessed { _ in
            deadline.disarm()
            connection.cancel()
        })
    }

    private func isLoopback(_ endpoint: NWEndpoint) -> Bool {
        guard case .hostPort(let host, _) = endpoint else { return false }
        let value = String(describing: host).lowercased()
        return value == "127.0.0.1" || value == "::1" || value == "localhost"
    }

    private func makeBearerToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let result = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard result == errSecSuccess else {
            throw BackstagePreviewIPCServerError.randomTokenFailed(result)
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private func prepareDescriptorLocation() throws {
        let directory = configuration.descriptorURL.deletingLastPathComponent()
        if let fileInfo = try fileInfo(at: directory) {
            guard isDirectory(fileInfo), fileInfo.st_uid == geteuid() else {
                throw BackstagePreviewIPCServerError.unsafeDescriptorDirectory(directory.path)
            }
        } else {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        }
        guard chmod(directory.path, 0o700) == 0,
              let securedDirectory = try fileInfo(at: directory),
              isDirectory(securedDirectory),
              securedDirectory.st_uid == geteuid(),
              securedDirectory.st_mode & 0o077 == 0 else {
            throw BackstagePreviewIPCServerError.unsafeDescriptorDirectory(directory.path)
        }

        guard let descriptorInfo = try fileInfo(at: configuration.descriptorURL) else { return }
        guard isRegularFile(descriptorInfo),
              descriptorInfo.st_uid == geteuid(),
              descriptorInfo.st_nlink == 1,
              descriptorInfo.st_mode & 0o077 == 0 else {
            throw BackstagePreviewIPCServerError.unsafeDescriptor(configuration.descriptorURL.path)
        }
        try FileManager.default.removeItem(at: configuration.descriptorURL)
    }

    private func publishDescriptor(port: UInt16, token: String) throws {
        let descriptor = BackstagePreviewIPCDescriptor(
            host: "127.0.0.1",
            port: port,
            pid: getpid(),
            bearerToken: token,
            startedAtEpoch: Date().timeIntervalSince1970
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(descriptor)
        let destination = configuration.descriptorURL
        let temporary = destination.deletingLastPathComponent()
            .appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString)")
        let descriptorMode = mode_t(S_IRUSR | S_IWUSR)
        let fileDescriptor = Darwin.open(
            temporary.path,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
            descriptorMode
        )
        guard fileDescriptor >= 0 else {
            throw BackstagePreviewIPCServerError.descriptorWriteFailed(String(cString: strerror(errno)))
        }
        var shouldRemoveTemporary = true
        defer {
            Darwin.close(fileDescriptor)
            if shouldRemoveTemporary { try? FileManager.default.removeItem(at: temporary) }
        }
        do {
            try writeAll(data, to: fileDescriptor)
            guard fsync(fileDescriptor) == 0, fchmod(fileDescriptor, descriptorMode) == 0 else {
                throw BackstagePreviewIPCServerError.descriptorWriteFailed(String(cString: strerror(errno)))
            }
            try FileManager.default.moveItem(at: temporary, to: destination)
            shouldRemoveTemporary = false
        } catch let error as BackstagePreviewIPCServerError {
            throw error
        } catch {
            throw BackstagePreviewIPCServerError.descriptorWriteFailed(error.localizedDescription)
        }
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
                    throw BackstagePreviewIPCServerError.descriptorWriteFailed(String(cString: strerror(errno)))
                }
                written += count
            }
        }
    }

    private func removeDescriptorIfOwned(token: String) {
        guard !token.isEmpty,
              let descriptorInfo = try? fileInfo(at: configuration.descriptorURL),
              isRegularFile(descriptorInfo),
              descriptorInfo.st_uid == geteuid(),
              descriptorInfo.st_nlink == 1,
              descriptorInfo.st_mode & 0o077 == 0,
              let data = try? Data(contentsOf: configuration.descriptorURL),
              let descriptor = try? JSONDecoder().decode(BackstagePreviewIPCDescriptor.self, from: data),
              descriptor.pid == getpid(),
              constantTimeTokenMatch(descriptor.bearerToken, token) else { return }
        try? FileManager.default.removeItem(at: configuration.descriptorURL)
    }

    private func fileInfo(at url: URL) throws -> stat? {
        var fileInfo = stat()
        if lstat(url.path, &fileInfo) == 0 { return fileInfo }
        if errno == ENOENT { return nil }
        throw BackstagePreviewIPCServerError.unsafeDescriptor(String(cString: strerror(errno)))
    }

    private func isDirectory(_ fileInfo: stat) -> Bool {
        fileInfo.st_mode & S_IFMT == S_IFDIR
    }

    private func isRegularFile(_ fileInfo: stat) -> Bool {
        fileInfo.st_mode & S_IFMT == S_IFREG
    }
}

private final class ConnectionDeadline: @unchecked Sendable {
    private let lock = NSLock()
    private var isArmed = true

    func disarm() {
        lock.lock()
        isArmed = false
        lock.unlock()
    }

    func fire(_ connection: NWConnection) {
        lock.lock()
        let shouldCancel = isArmed
        isArmed = false
        lock.unlock()
        if shouldCancel { connection.cancel() }
    }
}

private func constantTimeTokenMatch(_ lhs: String, _ rhs: String) -> Bool {
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
