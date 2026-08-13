import Foundation

public protocol OwnerAPITransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionOwnerTransport: OwnerAPITransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        return (data, http)
    }
}

public struct PBEOwnerHostReadiness: Codable, Sendable, Equatable {
    public var ready: Bool
    public var sourceIdentity: String
    public var catalogIdentity: String
    public var readinessIdentity: String
    public var lifecycleWriter: String
    public var capabilities: [String]
}

public struct PBEOwnerSessionContract: Codable, Sendable, Equatable {
    public var id: String
    public var state: String
    public var fixtureId: String
    public var fixtureBreadcrumb: String
    public var sourceIdentity: String
    public var catalogIdentity: String
    public var readinessIdentity: String
    public var capabilities: [String]
    public var lifecycleWriter: String
    public var createdAt: Date?
    public var expiresAt: Date
    public var closedAt: String?
    public var leaseExpiresAt: Date?
}

public struct PBEOwnerSessionMintRequest: Codable, Sendable, Equatable {
    public var fixtureId: String
    public var fixtureBreadcrumb: String
    public var sourceIdentity: String
    public var catalogIdentity: String
    public var readinessIdentity: String

    public init(
        fixtureId: String,
        fixtureBreadcrumb: String,
        sourceIdentity: String,
        catalogIdentity: String,
        readinessIdentity: String
    ) {
        self.fixtureId = fixtureId
        self.fixtureBreadcrumb = fixtureBreadcrumb
        self.sourceIdentity = sourceIdentity
        self.catalogIdentity = catalogIdentity
        self.readinessIdentity = readinessIdentity
    }
}

public struct PBEOwnerSessionMintEnvelope: Codable, Sendable, Equatable {
    public var ok: Bool
    public var tokenType: String
    public var sessionToken: String
    public var session: PBEOwnerSessionContract
}

public struct PBEOwnerHostSessionEnvelope: Codable, Sendable, Equatable {
    public var ok: Bool
    public var session: PBEOwnerSessionContract
    public var launchUrl: URL?
}

public protocol PBEOwnerHostServing: Sendable {
    func ensureReadiness() async throws -> PBEOwnerHostReadiness
    func attach(sessionToken: String, fixtureID: String) async throws -> PBEOwnerHostSessionEnvelope
    func status(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope
    func heartbeat(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope
    func close(sessionToken: String) async throws
    func stopIfLaunched() async
}

public actor PBEOwnerLocalHostService: PBEOwnerHostServing {
    private struct ReadinessEnvelope: Codable {
        var ok: Bool
        var ready: Bool
        var sourceIdentity: String
        var catalogIdentity: String
        var readinessIdentity: String
        var lifecycleWriter: String
        var capabilities: [String]
    }

    private struct FixtureRequest: Codable { var fixtureId: String }

    private let baseURL: URL
    private let transport: OwnerAPITransport
    private let decoder = JSONDecoder.ownerAPI
    private let encoder = JSONEncoder.ownerAPI
    private let repositoryRoot: URL?
    private var launchedProcess: Process?

    public init(
        baseURL: URL = URL(string: "http://127.0.0.1:8000/__photosbyelie/pbe-owner")!,
        transport: OwnerAPITransport = URLSessionOwnerTransport(),
        repositoryRoot: URL? = nil
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.repositoryRoot = repositoryRoot ?? Self.defaultRepositoryRoot()
    }

    public func ensureReadiness() async throws -> PBEOwnerHostReadiness {
        if let readiness = try? await readiness() { return readiness }
        try launchHost()
        for _ in 0..<12 {
            try await Task.sleep(for: .milliseconds(250))
            if let readiness = try? await readiness() { return readiness }
        }
        throw APIErrorEnvelope(error: .init(
            code: "pbe_owner_host_unavailable",
            message: "Backstage could not attach to the local PBE host. Verify the PhotosByElie checkout and Owner.sqlite on this Mac."
        ))
    }

    public func attach(sessionToken: String, fixtureID: String) async throws -> PBEOwnerHostSessionEnvelope {
        try await send(
            path: "/session/start",
            method: "POST",
            token: sessionToken,
            body: FixtureRequest(fixtureId: fixtureID)
        )
    }

    public func status(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope {
        try await send(path: "/session", method: "GET", token: sessionToken, body: Optional<String>.none)
    }

    public func heartbeat(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope {
        try await send(path: "/session/heartbeat", method: "POST", token: sessionToken, body: Optional<String>.none)
    }

    public func close(sessionToken: String) async throws {
        let _: PBEOwnerHostSessionEnvelope = try await send(
            path: "/session/close",
            method: "POST",
            token: sessionToken,
            body: Optional<String>.none
        )
    }

    public func stopIfLaunched() async {
        guard let launchedProcess else { return }
        if launchedProcess.isRunning { launchedProcess.terminate() }
        self.launchedProcess = nil
    }

    private func readiness() async throws -> PBEOwnerHostReadiness {
        let envelope: ReadinessEnvelope = try await send(
            path: "/readiness",
            method: "GET",
            token: "",
            body: Optional<String>.none
        )
        guard envelope.ok, envelope.ready,
              !envelope.sourceIdentity.isEmpty,
              !envelope.catalogIdentity.isEmpty,
              !envelope.readinessIdentity.isEmpty,
              envelope.lifecycleWriter == "pbb-79-waste-basket",
              Set(envelope.capabilities).isSuperset(
                of: ["gallery.read", "waste-basket.x", "waste-basket.restore"]
              )
        else {
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_host_not_ready",
                message: "The local PBE host did not provide the required source, catalog, readiness, and Waste Basket contract."
            ))
        }
        return PBEOwnerHostReadiness(
            ready: envelope.ready,
            sourceIdentity: envelope.sourceIdentity,
            catalogIdentity: envelope.catalogIdentity,
            readinessIdentity: envelope.readinessIdentity,
            lifecycleWriter: envelope.lifecycleWriter,
            capabilities: envelope.capabilities
        )
    }

    private func launchHost() throws {
        if launchedProcess?.isRunning == true { return }
        guard let repositoryRoot,
              FileManager.default.fileExists(
                atPath: repositoryRoot.appendingPathComponent("scripts/local_server.py").path
              ) else {
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_checkout_missing",
                message: "Backstage cannot find a PhotosByElie checkout on this Mac. Set PBE_REPO_ROOT to its path."
            ))
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["python3", "scripts/local_server.py", "8000", "--bind", "127.0.0.1"]
        process.currentDirectoryURL = repositoryRoot
        process.standardOutput = FileHandle(forWritingAtPath: "/dev/null")
        process.standardError = FileHandle(forWritingAtPath: "/dev/null")
        try process.run()
        launchedProcess = process
    }

    private func send<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        token: String,
        body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await transport.data(for: request)
        guard (200..<300).contains(response.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_host_error",
                message: "The local PBE host returned HTTP \(response.statusCode)."
            ))
        }
        return try decoder.decode(Response.self, from: data)
    }

    private static func defaultRepositoryRoot() -> URL? {
        let environment = ProcessInfo.processInfo.environment
        let fileManager = FileManager.default
        let candidates = [
            environment["PBE_REPO_ROOT"].map { URL(fileURLWithPath: $0, isDirectory: true) },
            URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Dev/PhotosByElie", isDirectory: true),
            URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("MDev/PhotosByElie", isDirectory: true),
        ].compactMap { $0 }
        return candidates.first(where: {
            fileManager.fileExists(atPath: $0.appendingPathComponent("scripts/local_server.py").path)
        })
    }
}

public actor OwnerAPIClient {
    public typealias AuthenticationRecoveryHandler = @Sendable () async -> Bool

    public static let productionBaseURL = URL(string: "https://auth.photos-by-elie.com/api/v1")!

    private let baseURL: URL
    private let transport: OwnerAPITransport
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var accessToken: String?
    private var authenticationRecoveryHandler: AuthenticationRecoveryHandler?

    public init(
        baseURL: URL = OwnerAPIClient.productionBaseURL,
        transport: OwnerAPITransport = URLSessionOwnerTransport()
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.encoder = JSONEncoder.ownerAPI
        self.decoder = JSONDecoder.ownerAPI
    }

    public func setAccessToken(_ token: String?) {
        accessToken = token
    }

    public func setAuthenticationRecoveryHandler(
        _ handler: AuthenticationRecoveryHandler?
    ) {
        authenticationRecoveryHandler = handler
    }

    public func listActions(
        limit: Int = 50,
        cursor: String? = nil,
        state: OwnerActionState? = nil
    ) async throws -> OwnerActionPage {
        var query = [URLQueryItem(name: "limit", value: String(max(1, min(200, limit))))]
        if let cursor, !cursor.isEmpty { query.append(.init(name: "cursor", value: cursor)) }
        if let state { query.append(.init(name: "state", value: state.rawValue)) }
        return try await send(path: "/actions", query: query)
    }

    public func getAction(id: String) async throws -> OwnerAction {
        let envelope: OwnerActionEnvelope = try await send(path: "/actions/\(id.urlPathEncoded)")
        return envelope.action
    }

    public func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String = UUID().uuidString
    ) async throws -> OwnerActionEnvelope {
        try await send(
            path: "/actions",
            method: "POST",
            body: action,
            idempotencyKey: idempotencyKey
        )
    }

    public func cancelAction(
        id: String,
        reason: String,
        idempotencyKey: String = UUID().uuidString
    ) async throws -> OwnerAction {
        struct Cancellation: Codable { let reason: String }
        let envelope: OwnerActionEnvelope = try await send(
            path: "/actions/\(id.urlPathEncoded)/cancel",
            method: "POST",
            body: Cancellation(reason: reason),
            idempotencyKey: idempotencyKey
        )
        return envelope.action
    }

    public func refresh(refreshToken: String) async throws -> OwnerTokenBundle {
        struct Refresh: Codable { let refreshToken: String }
        return try await send(
            path: "/auth/refresh",
            method: "POST",
            body: Refresh(refreshToken: refreshToken),
            authenticated: false
        )
    }

    public func exchangeDeviceCredential(
        deviceId: String,
        deviceCredential: String
    ) async throws -> OwnerTokenBundle {
        struct Exchange: Codable {
            let deviceId: String
            let deviceCredential: String
        }
        return try await send(
            path: "/auth/tokens",
            method: "POST",
            body: Exchange(
                deviceId: deviceId,
                deviceCredential: deviceCredential
            ),
            authenticated: false
        )
    }

    public func logout(refreshToken: String?) async throws {
        struct Logout: Codable { let refreshToken: String? }
        let _: EmptyResponse = try await send(
            path: "/auth/logout",
            method: "POST",
            body: Logout(refreshToken: refreshToken),
            authenticated: false
        )
        accessToken = nil
    }

    public func mintPBEOwnerSession(
        _ request: PBEOwnerSessionMintRequest
    ) async throws -> PBEOwnerSessionMintEnvelope {
        try await send(
            path: "/pbe-owner/sessions",
            method: "POST",
            body: request
        )
    }

    public func closePBEOwnerSession(
        id: String,
        sessionToken: String
    ) async throws -> PBEOwnerHostSessionEnvelope {
        try await send(
            path: "/pbe-owner/sessions/\(id.urlPathEncoded)/close",
            method: "POST",
            body: Optional<String>.none,
            authenticated: false,
            authorizationToken: sessionToken
        )
    }

    public func request<Response: Decodable>(
        path: String,
        query: [URLQueryItem] = []
    ) async throws -> Response {
        try await send(path: path, query: query)
    }

    public func request<Body: Encodable, Response: Decodable>(
        path: String,
        method: String = "POST",
        body: Body,
        idempotencyKey: String? = nil
    ) async throws -> Response {
        try await send(
            path: path,
            method: method,
            body: body,
            idempotencyKey: idempotencyKey
        )
    }

    private func send<Response: Decodable>(
        path: String,
        query: [URLQueryItem] = [],
        authenticated: Bool = true,
        authorizationToken: String? = nil
    ) async throws -> Response {
        try await send(
            path: path,
            method: "GET",
            query: query,
            body: Optional<String>.none,
            authenticated: authenticated,
            authorizationToken: authorizationToken
        )
    }

    private func send<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        query: [URLQueryItem] = [],
        body: Body?,
        idempotencyKey: String? = nil,
        authenticated: Bool = true,
        authorizationToken: String? = nil
    ) async throws -> Response {
        var components = URLComponents(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }
        if let authorizationToken, !authorizationToken.isEmpty {
            request.setValue("Bearer \(authorizationToken)", forHTTPHeaderField: "Authorization")
        } else if authenticated, let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        var (data, response) = try await transport.data(for: request)
        if authenticated,
           authorizationToken == nil,
           response.statusCode == 401,
           let authenticationRecoveryHandler,
           await authenticationRecoveryHandler() {
            if let accessToken {
                request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
            } else {
                request.setValue(nil, forHTTPHeaderField: "Authorization")
            }
            (data, response) = try await transport.data(for: request)
        }
        guard (200..<300).contains(response.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) {
                throw envelope
            }
            throw URLError(.badServerResponse)
        }
        if Response.self == EmptyResponse.self && data.isEmpty {
            return EmptyResponse() as! Response
        }
        return try decoder.decode(Response.self, from: data)
    }
}

private struct EmptyResponse: Codable {}

private extension String {
    var urlPathEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? self
    }
}

public extension JSONDecoder {
    static var ownerAPI: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

public extension JSONEncoder {
    static var ownerAPI: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
