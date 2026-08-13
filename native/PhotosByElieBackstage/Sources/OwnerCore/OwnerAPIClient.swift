import CryptoKit
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
    public var fixtureRevision: String
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
    public var fixtureRevision: String
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
    public var fixtureRevision: String

    public init(
        fixtureId: String,
        fixtureBreadcrumb: String,
        sourceIdentity: String,
        catalogIdentity: String,
        readinessIdentity: String,
        fixtureRevision: String
    ) {
        self.fixtureId = fixtureId
        self.fixtureBreadcrumb = fixtureBreadcrumb
        self.sourceIdentity = sourceIdentity
        self.catalogIdentity = catalogIdentity
        self.readinessIdentity = readinessIdentity
        self.fixtureRevision = fixtureRevision
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
    func ensureReadiness(fixtureID: String) async throws -> PBEOwnerHostReadiness
    func attach(sessionToken: String, fixtureID: String) async throws -> PBEOwnerHostSessionEnvelope
    func status(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope
    func heartbeat(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope
    func close(sessionToken: String) async throws
    func stopIfLaunched() async
}

enum PBEOwnerCheckoutIdentity {
    private static let scopeManifest = "scripts/pbe_owner_host_tracked_paths.txt"
    private static let requiredPaths = [
        scopeManifest,
        "scripts/local_server.py",
        "scripts/pbe_owner_session.py",
        "scripts/waste_basket_gateway.py",
    ]

    static func verified(repositoryRoot: URL) throws -> String {
        let root = repositoryRoot.standardizedFileURL.resolvingSymlinksInPath()
        let pathspecs = try hostPathspecs(repositoryRoot: root)
        do {
            let topLevel = try git(root, ["rev-parse", "--show-toplevel"]).text
            guard URL(fileURLWithPath: topLevel, isDirectory: true)
                .standardizedFileURL.resolvingSymlinksInPath() == root else {
                throw VerificationFailure.invalidRepository
            }
            let revision = try git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).text.lowercased()
            guard revision.range(of: "^[0-9a-f]{40,64}$", options: .regularExpression) != nil else {
                throw VerificationFailure.invalidRepository
            }

            let tracked = Set(try git(root, ["ls-files", "-z", "--"] + pathspecs).nulStrings)
            guard Set(requiredPaths).isSubset(of: tracked) else {
                throw VerificationFailure.invalidRepository
            }
            let status = try git(root, [
                "status", "--porcelain=v1", "-z", "--untracked-files=no", "--",
            ] + pathspecs).data
            guard status.isEmpty else {
                throw APIErrorEnvelope(error: .init(
                    code: "pbe_owner_checkout_dirty",
                    message: "PBE Owner requires a clean tracked host checkout."
                ))
            }

            let tree = try git(root, ["ls-tree", "-r", "-z", "HEAD", "--"] + tracked.sorted()).nulStrings
            var entries: [String: (mode: String, objectID: String)] = [:]
            for entry in tree {
                let fields = entry.split(separator: "\t", maxSplits: 1).map(String.init)
                guard fields.count == 2 else { throw VerificationFailure.invalidRepository }
                let metadata = fields[0].split(separator: " ", maxSplits: 2).map(String.init)
                guard metadata.count == 3, metadata[1] == "blob" else {
                    throw VerificationFailure.invalidRepository
                }
                entries[fields[1]] = (metadata[0], metadata[2])
            }
            guard Set(requiredPaths).isSubset(of: Set(entries.keys)) else {
                throw VerificationFailure.invalidRepository
            }
            let paths = entries.keys.sorted()
            let actualHashes = try git(root, ["hash-object", "--"] + paths).textLines
            guard actualHashes.count == paths.count else {
                throw VerificationFailure.invalidRepository
            }
            for (path, actualHash) in zip(paths, actualHashes) {
                guard entries[path]?.objectID == actualHash.lowercased() else {
                    throw APIErrorEnvelope(error: .init(
                        code: "pbe_owner_checkout_content_mismatch",
                        message: "PBE Owner host files do not match the verified commit."
                    ))
                }
            }

            var hasher = SHA256()
            for path in paths {
                guard let entry = entries[path] else { throw VerificationFailure.invalidRepository }
                hasher.update(data: Data(path.utf8))
                hasher.update(data: Data([0]))
                hasher.update(data: Data(entry.mode.utf8))
                hasher.update(data: Data([0]))
                hasher.update(data: Data(entry.objectID.utf8))
                hasher.update(data: Data([10]))
            }
            let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
            return "git:\(revision):pbe-host-sha256:\(digest)"
        } catch let error as APIErrorEnvelope {
            throw error
        } catch {
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_checkout_identity_unavailable",
                message: "Backstage could not verify the tracked PBE Owner host checkout."
            ))
        }
    }

    private static func hostPathspecs(repositoryRoot: URL) throws -> [String] {
        let manifest = repositoryRoot.appendingPathComponent(scopeManifest)
        let contents = try String(contentsOf: manifest, encoding: .utf8)
        var pathspecs = requiredPaths
        for line in contents.split(whereSeparator: { $0.isNewline }) {
            let value = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty, !value.hasPrefix("#"), !pathspecs.contains(value) {
                pathspecs.append(value)
            }
        }
        return pathspecs
    }

    private static func git(_ root: URL, _ arguments: [String]) throws -> GitOutput {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-C", root.path] + arguments
        process.standardOutput = output
        process.standardError = FileHandle(forWritingAtPath: "/dev/null")
        try process.run()
        process.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0 else { throw VerificationFailure.gitFailed }
        return GitOutput(data: data)
    }

    private struct GitOutput {
        var data: Data
        var text: String {
            String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        var textLines: [String] {
            text.split(whereSeparator: { $0.isNewline }).map(String.init)
        }
        var nulStrings: [String] {
            data.split(separator: 0).map { String(decoding: $0, as: UTF8.self) }
        }
    }

    private enum VerificationFailure: Error {
        case gitFailed
        case invalidRepository
    }
}

public actor PBEOwnerLocalHostService: PBEOwnerHostServing {
    private struct ReadinessEnvelope: Codable {
        var ok: Bool
        var ready: Bool
        var sourceIdentity: String
        var catalogIdentity: String
        var readinessIdentity: String
        var fixtureRevision: String
        var lifecycleWriter: String
        var capabilities: [String]
    }

    private struct FixtureRequest: Codable { var fixtureId: String }

    private struct HostDescriptor: Codable {
        var port: Int
        var checkoutIdentity: String
        var protocolVersion: Int
    }

    private struct HostBootstrapRequest: Codable { var expectedCheckoutIdentity: String }
    private struct HostBootstrapEnvelope: Codable {
        var ok: Bool
        var checkoutIdentity: String
        var hostAuthorization: String
    }

    private var baseURL: URL
    private let transport: OwnerAPITransport
    private let decoder = JSONDecoder.ownerAPI
    private let encoder = JSONEncoder.ownerAPI
    private let repositoryRoot: URL?
    private var launchedProcess: Process?
    private var hostAuthorization: String
    private var bootstrapDescriptorURL: URL?

    public init(
        baseURL: URL? = nil,
        transport: OwnerAPITransport = URLSessionOwnerTransport(),
        repositoryRoot: URL? = nil,
        hostAuthorization: String = ""
    ) {
        self.baseURL = baseURL ?? URL(string: "http://127.0.0.1:0/__photosbyelie/pbe-owner")!
        self.transport = transport
        self.repositoryRoot = repositoryRoot ?? Self.defaultRepositoryRoot()
        self.hostAuthorization = hostAuthorization
    }

    public func ensureReadiness(fixtureID: String) async throws -> PBEOwnerHostReadiness {
        if hostAuthorization.isEmpty {
            try await launchHostAndBootstrap()
        }
        for _ in 0..<12 {
            if let readiness = try? await readiness(fixtureID: fixtureID) { return readiness }
            try await Task.sleep(for: .milliseconds(250))
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
        if let bootstrapDescriptorURL {
            try? FileManager.default.removeItem(at: bootstrapDescriptorURL)
        }
        self.bootstrapDescriptorURL = nil
        hostAuthorization = ""
    }

    private func readiness(fixtureID: String) async throws -> PBEOwnerHostReadiness {
        let envelope: ReadinessEnvelope = try await send(
            path: "/readiness",
            method: "GET",
            token: "",
            body: Optional<String>.none,
            query: [URLQueryItem(name: "fixtureId", value: fixtureID)]
        )
        guard envelope.ok, envelope.ready,
              !envelope.sourceIdentity.isEmpty,
              !envelope.catalogIdentity.isEmpty,
              !envelope.readinessIdentity.isEmpty,
              !envelope.fixtureRevision.isEmpty,
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
            fixtureRevision: envelope.fixtureRevision,
            lifecycleWriter: envelope.lifecycleWriter,
            capabilities: envelope.capabilities
        )
    }

    private func launchHostAndBootstrap() async throws {
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
        let expectedCheckoutIdentity = try PBEOwnerCheckoutIdentity.verified(repositoryRoot: repositoryRoot)
        let bootstrapSecret = "\(UUID().uuidString)\(UUID().uuidString)"
        let descriptorURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-owner-host-\(UUID().uuidString).json")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [
            "python3", "scripts/local_server.py", "0", "--bind", "127.0.0.1",
            "--backstage-bootstrap-file", descriptorURL.path,
        ]
        process.currentDirectoryURL = repositoryRoot
        var environment = ProcessInfo.processInfo.environment
        environment["PBE_BACKSTAGE_BOOTSTRAP_SECRET"] = bootstrapSecret
        process.environment = environment
        process.standardOutput = FileHandle(forWritingAtPath: "/dev/null")
        process.standardError = FileHandle(forWritingAtPath: "/dev/null")
        do {
            try process.run()
            launchedProcess = process
            bootstrapDescriptorURL = descriptorURL
            var descriptor: HostDescriptor?
            for _ in 0..<30 {
                if let data = try? Data(contentsOf: descriptorURL),
                   let decoded = try? decoder.decode(HostDescriptor.self, from: data) {
                    descriptor = decoded
                    break
                }
                if !process.isRunning { break }
                try await Task.sleep(for: .milliseconds(100))
            }
            guard let descriptor,
                  descriptor.protocolVersion == 1,
                  (1...65_535).contains(descriptor.port),
                  descriptor.checkoutIdentity == expectedCheckoutIdentity else {
                throw APIErrorEnvelope(error: .init(
                    code: "pbe_owner_host_identity_mismatch",
                    message: "The launched PBE host did not prove the expected checkout identity."
                ))
            }
            baseURL = URL(string: "http://127.0.0.1:\(descriptor.port)/__photosbyelie/pbe-owner")!
            let bootstrap: HostBootstrapEnvelope = try await sendBootstrap(
                secret: bootstrapSecret,
                expectedCheckoutIdentity: expectedCheckoutIdentity
            )
            guard bootstrap.ok,
                  bootstrap.checkoutIdentity == expectedCheckoutIdentity,
                  !bootstrap.hostAuthorization.isEmpty else {
                throw APIErrorEnvelope(error: .init(
                    code: "pbe_owner_host_bootstrap_invalid",
                    message: "The launched PBE host bootstrap contract was invalid."
                ))
            }
            hostAuthorization = bootstrap.hostAuthorization
            try? FileManager.default.removeItem(at: descriptorURL)
            bootstrapDescriptorURL = nil
        } catch {
            if process.isRunning { process.terminate() }
            launchedProcess = nil
            try? FileManager.default.removeItem(at: descriptorURL)
            bootstrapDescriptorURL = nil
            throw error
        }
    }

    private func sendBootstrap(
        secret: String,
        expectedCheckoutIdentity: String
    ) async throws -> HostBootstrapEnvelope {
        let endpoint = baseURL.appendingPathComponent("host/bootstrap")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(secret, forHTTPHeaderField: "X-PBE-Host-Bootstrap")
        request.httpBody = try encoder.encode(HostBootstrapRequest(
            expectedCheckoutIdentity: expectedCheckoutIdentity
        ))
        let (data, response) = try await transport.data(for: request)
        guard (200..<300).contains(response.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_host_bootstrap_failed",
                message: "Backstage could not authenticate the launched PBE host."
            ))
        }
        return try decoder.decode(HostBootstrapEnvelope.self, from: data)
    }

    private func send<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        token: String,
        body: Body?,
        query: [URLQueryItem] = []
    ) async throws -> Response {
        let endpoint = baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.queryItems = query.isEmpty ? nil : query
        guard let requestURL = components?.url else { throw URLError(.badURL) }
        var request = URLRequest(url: requestURL)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !hostAuthorization.isEmpty {
            request.setValue(hostAuthorization, forHTTPHeaderField: "X-PBE-Host-Authorization")
        }
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else if method == "POST" {
            request.httpBody = Data("{}".utf8)
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

    public func logout() async throws {
        struct Logout: Codable {}
        let _: EmptyResponse = try await send(
            path: "/auth/logout",
            method: "POST",
            body: Logout(),
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
