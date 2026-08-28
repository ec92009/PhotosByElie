import Foundation
import Network

public struct PBEOwnerNativeHostServerConfiguration: Sendable {
    public var connectionTimeout: TimeInterval
    public var maximumResponseBytes: Int
    public var parser: PBEOwnerHTTPRequestParser

    public init(
        connectionTimeout: TimeInterval = 15,
        maximumResponseBytes: Int = 25 * 1024 * 1024,
        parser: PBEOwnerHTTPRequestParser = PBEOwnerHTTPRequestParser()
    ) {
        self.connectionTimeout = connectionTimeout
        self.maximumResponseBytes = maximumResponseBytes
        self.parser = parser
    }
}

public enum PBEOwnerNativeHostServerError: Error, LocalizedError {
    case alreadyRunning
    case listenerFailed(String)
    case missingPort

    public var errorDescription: String? {
        switch self {
        case .alreadyRunning: "The native PBE Owner host is already starting."
        case .listenerFailed(let message): "The native PBE Owner host could not listen: \(message)"
        case .missingPort: "The native PBE Owner host started without a loopback port."
        }
    }
}

/// A one-request-per-connection HTTP/1.1 listener. It binds only to IPv4
/// loopback and delegates every accepted route to the explicit PBB-114
/// dispatcher; it never serves arbitrary repository files.
public final class PBEOwnerNativeHostServer: @unchecked Sendable {
    private let configuration: PBEOwnerNativeHostServerConfiguration
    private let webBundle: PBEOwnerWebBundle?
    private let handler: PBEOwnerNativeHostDispatcher.Handler
    private let queue = DispatchQueue(label: "com.photosbyelie.backstage.pbe-owner-host")
    private let stateLock = NSLock()
    private var listener: NWListener?
    private var boundPort: UInt16?

    public init(
        configuration: PBEOwnerNativeHostServerConfiguration = .init(),
        webBundle: PBEOwnerWebBundle? = nil,
        handler: @escaping PBEOwnerNativeHostDispatcher.Handler
    ) {
        self.configuration = configuration
        self.webBundle = webBundle
        self.handler = handler
    }

    deinit { stop() }

    public func start() async throws -> UInt16 {
        switch try prepareStart() {
        case .alreadyReady(let boundPort):
            return boundPort
        case .newListener(let newListener):
            return try await awaitReadiness(of: newListener)
        }
    }

    private func prepareStart() throws -> PBEOwnerNativeHostStart {
        try stateLock.withLock {
            if let boundPort { return .alreadyReady(boundPort) }
            guard listener == nil else {
                throw PBEOwnerNativeHostServerError.alreadyRunning
            }
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
                throw PBEOwnerNativeHostServerError.listenerFailed(error.localizedDescription)
            }
            listener = newListener
            return .newListener(newListener)
        }
    }

    private func awaitReadiness(of newListener: NWListener) async throws -> UInt16 {
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let gate = PBEOwnerNativeHostStartGate(continuation)
                newListener.newConnectionHandler = { [weak self] connection in
                    self?.accept(connection)
                }
                newListener.stateUpdateHandler = { [weak self, weak newListener] state in
                    guard let self, let newListener else { return }
                    switch state {
                    case .ready:
                        guard let port = newListener.port?.rawValue else {
                            gate.fail(PBEOwnerNativeHostServerError.missingPort)
                            newListener.cancel()
                            return
                        }
                        self.stateLock.lock()
                        if self.listener === newListener { self.boundPort = port }
                        self.stateLock.unlock()
                        gate.succeed(port)
                    case .failed(let error):
                        gate.fail(PBEOwnerNativeHostServerError.listenerFailed(error.localizedDescription))
                        self.listenerDidTerminate(newListener)
                    case .cancelled:
                        gate.fail(CancellationError())
                        self.listenerDidTerminate(newListener)
                    default:
                        break
                    }
                }
                newListener.start(queue: queue)
            }
        } onCancel: {
            newListener.cancel()
        }
    }

    public func stop() {
        stateLock.lock()
        let current = listener
        listener = nil
        boundPort = nil
        stateLock.unlock()
        current?.cancel()
    }

    private func listenerDidTerminate(_ candidate: NWListener) {
        stateLock.lock()
        if listener === candidate {
            listener = nil
            boundPort = nil
        }
        stateLock.unlock()
    }

    private func accept(_ connection: NWConnection) {
        guard isLoopback(connection.endpoint) else {
            connection.cancel()
            return
        }
        stateLock.lock()
        let port = boundPort
        let running = listener != nil
        stateLock.unlock()
        guard running, let port else {
            connection.cancel()
            return
        }
        connection.start(queue: queue)
        let deadline = PBEOwnerNativeHostDeadline()
        queue.asyncAfter(deadline: .now() + max(0.1, configuration.connectionTimeout)) {
            deadline.fire(connection)
        }
        receive(from: connection, port: port, deadline: deadline)
    }

    private func receive(
        from connection: NWConnection,
        port: UInt16,
        deadline: PBEOwnerNativeHostDeadline,
        accumulated: Data = Data()
    ) {
        let maximumRequestBytes = configuration.parser.maximumHeadBytes
            + 4 + configuration.parser.maximumBodyBytes
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
            [weak self] data, _, isComplete, error in
            guard let self, error == nil else {
                deadline.disarm()
                connection.cancel()
                return
            }
            var requestData = accumulated
            if let data { requestData.append(data) }
            guard requestData.count <= maximumRequestBytes else {
                self.send(
                    PBEOwnerNativeHostDispatcher.parserError(.bodyTooLarge),
                    on: connection,
                    deadline: deadline
                )
                return
            }
            do {
                let request = try self.configuration.parser.parse(requestData)
                let dispatcher = PBEOwnerNativeHostDispatcher(
                    expectedHost: "127.0.0.1:\(port)",
                    webBundle: self.webBundle,
                    handler: self.handler
                )
                Task {
                    let response = await dispatcher.dispatch(request)
                    self.queue.async {
                        self.send(response, on: connection, deadline: deadline)
                    }
                }
            } catch PBEOwnerHTTPRequestParserError.incomplete where !isComplete {
                self.receive(
                    from: connection,
                    port: port,
                    deadline: deadline,
                    accumulated: requestData
                )
            } catch let parserError as PBEOwnerHTTPRequestParserError {
                self.send(
                    PBEOwnerNativeHostDispatcher.parserError(parserError),
                    on: connection,
                    deadline: deadline
                )
            } catch {
                self.send(
                    PBEOwnerNativeHostDispatcher.parserError(.malformed),
                    on: connection,
                    deadline: deadline
                )
            }
        }
    }

    private func send(
        _ response: PBEOwnerHTTPResponse,
        on connection: NWConnection,
        deadline: PBEOwnerNativeHostDeadline
    ) {
        let data = response.serialized()
        guard data.count <= configuration.maximumResponseBytes else {
            deadline.disarm()
            connection.cancel()
            return
        }
        connection.send(content: data, completion: .contentProcessed { _ in
            deadline.disarm()
            connection.cancel()
        })
    }

    private func isLoopback(_ endpoint: NWEndpoint) -> Bool {
        guard case .hostPort(let host, _) = endpoint else { return false }
        let value = String(describing: host).lowercased()
        return value == "127.0.0.1" || value == "::1" || value == "localhost"
    }
}

private enum PBEOwnerNativeHostStart {
    case alreadyReady(UInt16)
    case newListener(NWListener)
}

private final class PBEOwnerNativeHostStartGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<UInt16, any Error>?

    init(_ continuation: CheckedContinuation<UInt16, any Error>) {
        self.continuation = continuation
    }

    func succeed(_ port: UInt16) { resolve(.success(port)) }
    func fail(_ error: any Error) { resolve(.failure(error)) }

    private func resolve(_ result: Result<UInt16, any Error>) {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(with: result)
    }
}

private final class PBEOwnerNativeHostDeadline: @unchecked Sendable {
    private let lock = NSLock()
    private var armed = true

    func disarm() {
        lock.lock()
        armed = false
        lock.unlock()
    }

    func fire(_ connection: NWConnection) {
        lock.lock()
        let shouldCancel = armed
        armed = false
        lock.unlock()
        if shouldCancel { connection.cancel() }
    }
}
