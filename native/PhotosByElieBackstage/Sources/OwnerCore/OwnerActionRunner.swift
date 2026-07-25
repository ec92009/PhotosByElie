import Foundation

public protocol OwnerActionServing: Sendable {
    func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String
    ) async throws -> OwnerActionEnvelope
    func getAction(id: String) async throws -> OwnerAction
}

extension OwnerAPIClient: OwnerActionServing {}

public protocol OwnerActionWaking: Sendable {
    func wake(actionID: String) async throws -> OwnerAction?
}

public struct LocalOwnerActionWaker: OwnerActionWaking {
    private let endpoints: [URL]
    private let session: URLSession
    private let decoder = JSONDecoder.ownerAPI

    public init(
        endpoints: [URL] = [
            URL(string: "http://127.0.0.1:8766/photosbyelie/wake-owner-action")!,
            URL(string: "http://localhost:8766/photosbyelie/wake-owner-action")!,
        ],
        timeout: TimeInterval = 0.9
    ) {
        self.endpoints = endpoints
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.waitsForConnectivity = false
        self.session = URLSession(configuration: configuration)
    }

    public func wake(actionID: String) async throws -> OwnerAction? {
        struct RequestBody: Encodable { let actionId: String }
        struct ResponseBody: Decodable { let action: OwnerAction? }

        guard actionID.hasPrefix("owner-action-"), actionID.count <= 96 else {
            throw OwnerActionRunError.invalidActionID
        }
        var lastError: Error = URLError(.cannotConnectToHost)
        for endpoint in endpoints {
            do {
                var request = URLRequest(url: endpoint)
                request.httpMethod = "POST"
                request.httpBody = try JSONEncoder.ownerAPI.encode(RequestBody(actionId: actionID))
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                // The connector applies the same allowlist used by the public
                // Owner page. It still receives only the opaque action ID.
                request.setValue("https://photos-by-elie.com", forHTTPHeaderField: "Origin")
                let (data, response) = try await session.data(for: request)
                guard let response = response as? HTTPURLResponse,
                      (200..<300).contains(response.statusCode) else {
                    throw URLError(.badServerResponse)
                }
                return try decoder.decode(ResponseBody.self, from: data).action
            } catch {
                lastError = error
            }
        }
        throw lastError
    }
}

public enum OwnerActionRunError: Error, Sendable, Equatable {
    case invalidActionID
    case failed(String)
    case cancelled
    case timedOut
}

public actor OwnerActionRunner {
    private let api: any OwnerActionServing
    private let waker: any OwnerActionWaking
    private let pollInterval: Duration
    private let timeout: Duration
    private let clock = ContinuousClock()

    public init(
        api: any OwnerActionServing,
        waker: any OwnerActionWaking = LocalOwnerActionWaker(),
        pollInterval: Duration = .milliseconds(500),
        timeout: Duration = .seconds(15 * 60)
    ) {
        self.api = api
        self.waker = waker
        self.pollInterval = pollInterval
        self.timeout = timeout
    }

    public func submit(
        _ request: OwnerActionCreate,
        idempotencyKey: String = UUID().uuidString
    ) async throws -> OwnerAction {
        let envelope = try await api.createAction(request, idempotencyKey: idempotencyKey)
        return try await awaitCompletion(of: envelope.action)
    }

    public func awaitCompletion(of queued: OwnerAction) async throws -> OwnerAction {
        let deadline = clock.now.advanced(by: timeout)
        var action = queued

        // Fast path: the local connector fetches and validates this exact
        // Worker-created action. Failure or timeout is intentionally ignored;
        // its durable poller remains the fallback.
        if let awakened = try? await waker.wake(actionID: action.id) {
            action = awakened
        }

        while true {
            try Task.checkCancellation()
            switch action.state {
            case .completed:
                return action
            case .failed:
                let message = action.error?["message"]?.stringValue
                    ?? action.error?["code"]?.stringValue
                    ?? "Owner action failed."
                throw OwnerActionRunError.failed(message)
            case .cancelled:
                throw OwnerActionRunError.cancelled
            case .queued, .claimed, .running:
                break
            }
            guard clock.now < deadline else {
                throw OwnerActionRunError.timedOut
            }
            try await clock.sleep(for: pollInterval)
            action = try await api.getAction(id: action.id)
        }
    }
}
