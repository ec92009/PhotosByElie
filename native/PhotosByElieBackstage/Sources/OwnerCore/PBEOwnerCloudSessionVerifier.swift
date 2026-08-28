import Foundation

public protocol PBEOwnerCloudSessionVerifying: Sendable {
    func verify(token: String) async throws -> PBEOwnerSessionContract
}

public struct PBEOwnerCloudSessionVerifier: PBEOwnerCloudSessionVerifying, Sendable {
    public static let productionEndpoint = URL(
        string: "https://auth.photos-by-elie.com/api/v1/pbe-owner/session"
    )!
    public static let userAgent = "PhotosByElie-PBE-Owner-Host/1.0"

    private struct SessionEnvelope: Decodable { var session: PBEOwnerSessionContract }

    private let endpoint: URL
    private let transport: any OwnerAPITransport
    private let timeout: TimeInterval

    public init(
        endpoint: URL = Self.productionEndpoint,
        transport: any OwnerAPITransport = URLSessionOwnerTransport(),
        timeout: TimeInterval = 5
    ) {
        self.endpoint = endpoint
        self.transport = transport
        self.timeout = min(15, max(1, timeout))
    }

    public func verify(token: String) async throws -> PBEOwnerSessionContract {
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else {
            throw failure(
                "pbe_owner_session_required",
                401,
                "A Backstage-minted PBE Owner session is required."
            )
        }
        guard endpoint.scheme?.lowercased() == "https",
              endpoint.host?.isEmpty == false,
              endpoint.user == nil,
              endpoint.password == nil,
              endpoint.fragment == nil else {
            throw failure(
                "pbe_owner_auth_unavailable",
                503,
                "PBE Owner authentication is unavailable; actions are disabled."
            )
        }

        var request = URLRequest(
            url: endpoint,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: timeout
        )
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")

        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch {
            throw failure(
                "pbe_owner_auth_unavailable",
                503,
                "PBE Owner authentication is unavailable; actions are disabled."
            )
        }
        guard data.count <= 128 * 1_024 else {
            throw failure(
                "pbe_owner_session_invalid",
                502,
                "PBE Owner authentication returned an invalid session contract."
            )
        }

        let decoder = JSONDecoder.ownerAPI
        guard (200..<300).contains(response.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) {
                let code = safeErrorCode(envelope.error.code)
                let message = safeErrorMessage(envelope.error.message)
                throw failure(
                    code.isEmpty ? "pbe_owner_session_rejected" : code,
                    response.statusCode,
                    message.isEmpty ? "The PBE Owner session was rejected." : message
                )
            }
            throw failure(
                "pbe_owner_session_rejected",
                response.statusCode,
                "The PBE Owner session was rejected."
            )
        }
        do {
            return try decoder.decode(SessionEnvelope.self, from: data).session
        } catch {
            throw failure(
                "pbe_owner_session_invalid",
                502,
                "PBE Owner authentication returned an invalid session contract."
            )
        }
    }

    private func safeErrorCode(_ value: String) -> String {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count <= 64,
              value.unicodeScalars.allSatisfy({
                  CharacterSet.alphanumerics.contains($0) || "_.-".unicodeScalars.contains($0)
              }) else { return "" }
        return value
    }

    private func safeErrorMessage(_ value: String) -> String {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count <= 512,
              value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
            return ""
        }
        return value
    }

    private func failure(
        _ code: String,
        _ statusCode: Int,
        _ message: String
    ) -> PBEOwnerNativeSessionFailure {
        PBEOwnerNativeSessionFailure(
            code: code,
            statusCode: statusCode,
            message: message
        )
    }
}
