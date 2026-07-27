import Foundation

public protocol OwnerConnectorIdentifying: Sendable {
    func connectorID() async -> String
}

public struct StaticOwnerConnectorIdentity: OwnerConnectorIdentifying {
    private let value: String

    public init(_ value: String) {
        self.value = Self.clean(value) ?? "max"
    }

    public func connectorID() async -> String {
        value
    }

    fileprivate static func clean(_ value: String) -> String? {
        let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !candidate.isEmpty, candidate.count <= 64 else { return nil }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789_-")
        guard candidate.unicodeScalars.allSatisfy(allowed.contains) else { return nil }
        return candidate
    }
}

public actor LocalOwnerConnectorIdentity: OwnerConnectorIdentifying {
    private struct Status: Decodable {
        var ok: Bool
        var connectorId: String
    }

    private let endpoints: [URL]
    private let session: URLSession
    private let fallback: String
    private var cachedConnectorID: String?

    public init(
        endpoints: [URL] = [
            URL(string: "http://127.0.0.1:8766/photosbyelie/connector-status")!,
            URL(string: "http://localhost:8766/photosbyelie/connector-status")!,
        ],
        fallback: String = "max",
        timeout: TimeInterval = 2
    ) {
        self.endpoints = endpoints
        self.fallback = StaticOwnerConnectorIdentity.clean(fallback) ?? "max"
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.waitsForConnectivity = false
        self.session = URLSession(configuration: configuration)
    }

    public func connectorID() async -> String {
        if let cachedConnectorID {
            return cachedConnectorID
        }
        for endpoint in endpoints {
            do {
                var request = URLRequest(url: endpoint)
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                let (data, response) = try await session.data(for: request)
                guard let response = response as? HTTPURLResponse,
                      (200..<300).contains(response.statusCode) else { continue }
                let status = try JSONDecoder().decode(Status.self, from: data)
                guard status.ok,
                      let connectorID = StaticOwnerConnectorIdentity.clean(status.connectorId)
                else { continue }
                cachedConnectorID = connectorID
                return connectorID
            } catch {
                continue
            }
        }
        return fallback
    }
}
