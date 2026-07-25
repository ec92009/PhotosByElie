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

public actor OwnerAPIClient {
    public static let productionBaseURL = URL(string: "https://auth.photos-by-elie.com/api/v1")!

    private let baseURL: URL
    private let transport: OwnerAPITransport
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var accessToken: String?

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

    public func logout(refreshToken: String?) async throws {
        struct Logout: Codable { let refreshToken: String? }
        let _: EmptyResponse = try await send(
            path: "/auth/logout",
            method: "POST",
            body: Logout(refreshToken: refreshToken)
        )
        accessToken = nil
    }

    private func send<Response: Decodable>(
        path: String,
        query: [URLQueryItem] = [],
        authenticated: Bool = true
    ) async throws -> Response {
        try await send(path: path, method: "GET", query: query, body: Optional<String>.none, authenticated: authenticated)
    }

    private func send<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        query: [URLQueryItem] = [],
        body: Body?,
        idempotencyKey: String? = nil,
        authenticated: Bool = true
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
        if authenticated, let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await transport.data(for: request)
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

