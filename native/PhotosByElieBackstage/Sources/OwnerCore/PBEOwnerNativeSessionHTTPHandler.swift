import CryptoKit
import Foundation
import Security

public actor PBEOwnerNativeSessionHTTPHandler {
    public typealias ReadinessProvider = @Sendable (String) async throws -> PBEOwnerHostReadiness
    public typealias GalleryProvider = @Sendable (
        PBEOwnerSessionContract
    ) async throws -> PBEOwnerNativeGallery
    public typealias PreviewProvider = @Sendable (
        PBEOwnerSessionContract,
        String,
        Int
    ) async throws -> PBEOwnerNativePreview
    public typealias ActionSubmitProvider = @Sendable (
        PBEOwnerSessionContract,
        [String: JSONValue],
        String
    ) async throws -> [String: JSONValue]
    public typealias ActionStatusProvider = @Sendable (
        PBEOwnerSessionContract,
        String?
    ) async throws -> [String: JSONValue]

    private struct HostBootstrapRequest: Decodable { var expectedCheckoutIdentity: String }
    private struct HostBootstrapEnvelope: Encodable {
        var ok = true
        var checkoutIdentity: String
        var hostAuthorization: String
    }
    private struct SessionStartRequest: Decodable { var fixtureId: String? }
    private struct BrowserBootstrapRequest: Decodable { var ticket: String }
    private struct SessionEnvelope: Encodable {
        var ok = true
        var session: PBEOwnerSessionContract
        var launchUrl: URL?
    }
    private struct SessionStatusEnvelope: Encodable {
        var ok = true
        var session: PBEOwnerSessionContract
        var latestAction: JSONValue = .null
    }
    private struct ErrorEnvelope: Encodable {
        var ok = false
        var error: APIErrorEnvelope.Detail
    }
    private struct ReadinessEnvelope: Encodable {
        var ok = true
        var ready: Bool
        var sourceIdentity: String
        var catalogIdentity: String
        var readinessIdentity: String
        var fixtureRevision: String
        var lifecycleWriter: String
        var capabilities: [String]

        init(_ readiness: PBEOwnerHostReadiness) {
            ready = readiness.ready
            sourceIdentity = readiness.sourceIdentity
            catalogIdentity = readiness.catalogIdentity
            readinessIdentity = readiness.readinessIdentity
            fixtureRevision = readiness.fixtureRevision
            lifecycleWriter = readiness.lifecycleWriter
            capabilities = readiness.capabilities
        }
    }
    private struct GalleryEnvelope: Encodable {
        var ok = true
        var gallery: PBEOwnerNativeGallery
    }

    // Version the cookie name when its path changes. Otherwise Safari can send
    // both the retained legacy cookie and the new cookie on Owner routes, and
    // the fail-closed duplicate-cookie guard correctly rejects the session.
    private static let browserCookie = "pbe_owner_browser_v2"
    // The authenticated browser session serves both the Owner JSON routes and
    // the sibling PhotoKit preview route. Keep the cookie under the smallest
    // shared private prefix so browsers send it to both route families.
    private static let cookiePath = "/__photosbyelie/"
    private static let sourcePreviewPath = "/__photosbyelie/source-preview/"

    private let checkoutIdentity: String
    private let sessionStore: PBEOwnerNativeSessionStore
    private let verifier: any PBEOwnerCloudSessionVerifying
    private let readinessProvider: ReadinessProvider
    private let galleryProvider: GalleryProvider?
    private let previewProvider: PreviewProvider?
    private let actionSubmitProvider: ActionSubmitProvider?
    private let actionStatusProvider: ActionStatusProvider?
    private var bootstrapHash: String
    private var hostAuthorizationHash = ""

    public init(
        bootstrapSecret: String,
        checkoutIdentity: String,
        sessionStore: PBEOwnerNativeSessionStore = .init(),
        verifier: any PBEOwnerCloudSessionVerifying = PBEOwnerCloudSessionVerifier(),
        galleryProvider: GalleryProvider? = nil,
        previewProvider: PreviewProvider? = nil,
        actionSubmitProvider: ActionSubmitProvider? = nil,
        actionStatusProvider: ActionStatusProvider? = nil,
        readinessProvider: @escaping ReadinessProvider
    ) {
        let bootstrapSecret = Self.clean(bootstrapSecret)
        self.checkoutIdentity = Self.clean(checkoutIdentity)
        self.sessionStore = sessionStore
        self.verifier = verifier
        self.galleryProvider = galleryProvider
        self.previewProvider = previewProvider
        self.actionSubmitProvider = actionSubmitProvider
        self.actionStatusProvider = actionStatusProvider
        self.readinessProvider = readinessProvider
        self.bootstrapHash = bootstrapSecret.isEmpty ? "" : Self.hash(bootstrapSecret)
    }

    public nonisolated func handler() -> PBEOwnerNativeHostDispatcher.Handler {
        { [weak self] request, route in
            guard let self else {
                return Self.error(
                    "pbe_owner_host_unavailable",
                    statusCode: 503,
                    message: "The native PBE Owner host is unavailable."
                )
            }
            return await self.handle(request, route: route)
        }
    }

    public func handle(
        _ request: PBEOwnerHTTPRequest,
        route: PBEOwnerNativeHostRoute
    ) async -> PBEOwnerHTTPResponse {
        do {
            switch (request.method, request.path) {
            case ("POST", "/__photosbyelie/pbe-owner/host/bootstrap"):
                return try bootstrap(request)
            case ("GET", "/__photosbyelie/pbe-owner/readiness"):
                try authorizeHost(request)
                let fixtureID = queryValue("fixtureId", request: request)
                return try Self.response(ReadinessEnvelope(
                    try await readinessProvider(fixtureID)
                ))
            case ("POST", "/__photosbyelie/pbe-owner/session/start"):
                return try await startSession(request)
            case ("POST", "/__photosbyelie/pbe-owner/browser/bootstrap"):
                return try await bootstrapBrowser(request)
            case ("GET", "/__photosbyelie/pbe-owner/session"):
                return try await sessionStatus(request, heartbeat: true)
            case ("POST", "/__photosbyelie/pbe-owner/session/heartbeat"):
                return try await sessionStatus(request, heartbeat: true)
            case ("POST", "/__photosbyelie/pbe-owner/session/close"):
                return try await closeSession(request)
            case ("GET", "/__photosbyelie/pbe-owner/gallery"):
                return try await gallery(request)
            case ("GET", let path) where path.hasPrefix(Self.sourcePreviewPath):
                return try await sourcePreview(request)
            case ("POST", "/__photosbyelie/pbe-owner/action"):
                return try await submitAction(request)
            case ("GET", "/__photosbyelie/pbe-owner/action/status"):
                return try await actionStatus(request)
            default:
                return await unsupportedRoute(request, route: route)
            }
        } catch let failure as PBEOwnerNativeSessionFailure {
            return Self.error(
                failure.code,
                statusCode: failure.statusCode,
                message: failure.message
            )
        } catch is DecodingError {
            return Self.error(
                "invalid_json",
                statusCode: 400,
                message: "The PBE Owner request body is invalid."
            )
        } catch {
            return Self.error(
                "pbe_owner_host_failed",
                statusCode: 500,
                message: "The native PBE Owner host could not complete the request."
            )
        }
    }

    private func bootstrap(_ request: PBEOwnerHTTPRequest) throws -> PBEOwnerHTTPResponse {
        let payload = try Self.decoder.decode(HostBootstrapRequest.self, from: request.body)
        let supplied = Self.clean(request.headers["x-pbe-host-bootstrap"] ?? "")
        guard !bootstrapHash.isEmpty,
              Self.constantTimeEqual(bootstrapHash, Self.hash(supplied)) else {
            throw Self.failure(
                "pbe_owner_host_bootstrap_invalid",
                401,
                "The Backstage host bootstrap secret is invalid or already consumed."
            )
        }
        guard !checkoutIdentity.isEmpty,
              Self.constantTimeEqual(
                  checkoutIdentity,
                  Self.clean(payload.expectedCheckoutIdentity)
              ) else {
            throw Self.failure(
                "pbe_owner_checkout_identity_mismatch",
                409,
                "The launched PBE host checkout does not match Backstage."
            )
        }
        let hostAuthorization = try Self.randomSecret()
        bootstrapHash = ""
        hostAuthorizationHash = Self.hash(hostAuthorization)
        return try Self.response(
            HostBootstrapEnvelope(
                checkoutIdentity: checkoutIdentity,
                hostAuthorization: hostAuthorization
            ),
            statusCode: 201,
            reasonPhrase: "Created"
        )
    }

    private func startSession(_ request: PBEOwnerHTTPRequest) async throws -> PBEOwnerHTTPResponse {
        try authorizeHost(request)
        let token = try bearerToken(request)
        let requested = try Self.decoder.decode(SessionStartRequest.self, from: request.body)
        let cloudSession = try await verifier.verify(token: token)
        let requestedFixture = Self.clean(requested.fixtureId ?? "")
        guard requestedFixture.isEmpty || requestedFixture == Self.clean(cloudSession.fixtureId) else {
            throw Self.failure(
                "pbe_owner_session_mismatch",
                409,
                "Backstage requested a fixture that does not match the minted PBE Owner lease."
            )
        }
        let readiness = try await readinessProvider(Self.clean(cloudSession.fixtureId))
        let session = try await sessionStore.start(
            token: token,
            cloudSession: cloudSession,
            readiness: readiness
        )
        let ticket = try await sessionStore.issueBrowserHandoff(token: token)
        guard let host = request.headers["host"],
              let escapedTicket = ticket.addingPercentEncoding(
                  withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "#&="))
              ),
              let launchURL = URL(
                  string: "http://\(host)/gallery.html?gallery=pbe-owner#pbe_owner_ticket=\(escapedTicket)"
              ) else {
            throw Self.failure(
                "pbe_owner_launch_url_invalid",
                500,
                "The native PBE Owner host could not prepare its browser handoff."
            )
        }
        return try Self.response(
            SessionEnvelope(session: session, launchUrl: launchURL),
            statusCode: 201,
            reasonPhrase: "Created"
        )
    }

    private func bootstrapBrowser(
        _ request: PBEOwnerHTTPRequest
    ) async throws -> PBEOwnerHTTPResponse {
        let payload = try Self.decoder.decode(BrowserBootstrapRequest.self, from: request.body)
        let ticket = Self.clean(payload.ticket)
        let fixtureID = try await sessionStore.requiredBrowserHandoffFixtureID(ticket: ticket)
        let readiness = try await readinessProvider(fixtureID)
        let browser = try await sessionStore.bootstrapBrowser(
            ticket: ticket,
            readiness: readiness
        )
        var response = try Self.response(
            SessionEnvelope(session: browser.session, launchUrl: nil),
            statusCode: 201,
            reasonPhrase: "Created"
        )
        response.headers["Set-Cookie"] = Self.cookieHeader(browser.browserSession)
        return response
    }

    private func sessionStatus(
        _ request: PBEOwnerHTTPRequest,
        heartbeat: Bool
    ) async throws -> PBEOwnerHTTPResponse {
        let session: PBEOwnerSessionContract
        if !Self.clean(request.headers["authorization"] ?? "").isEmpty {
            try authorizeHost(request)
            let token = try bearerToken(request)
            let cloudSession = try await verifier.verify(token: token)
            let readiness = try await readinessProvider(Self.clean(cloudSession.fixtureId))
            session = try await sessionStore.authorizeHost(
                token: token,
                cloudSession: cloudSession,
                readiness: readiness,
                heartbeat: heartbeat
            )
        } else {
            session = try await authorizeBrowser(request, heartbeat: heartbeat)
        }
        return try Self.response(SessionStatusEnvelope(session: session))
    }

    private func closeSession(_ request: PBEOwnerHTTPRequest) async throws -> PBEOwnerHTTPResponse {
        let session: PBEOwnerSessionContract
        if !Self.clean(request.headers["authorization"] ?? "").isEmpty {
            try authorizeHost(request)
            session = try await sessionStore.closeHost(token: try bearerToken(request))
        } else {
            session = try await sessionStore.closeBrowser(
                browserSession: try browserCookie(request)
            )
        }
        var response = try Self.response(SessionEnvelope(session: session, launchUrl: nil))
        response.headers["Set-Cookie"] = Self.cookieHeader("", clear: true)
        return response
    }

    private func gallery(_ request: PBEOwnerHTTPRequest) async throws -> PBEOwnerHTTPResponse {
        guard let galleryProvider else {
            throw Self.failure(
                "pbe_owner_route_not_implemented",
                501,
                "The native PBE Owner gallery reader is not configured."
            )
        }
        let session = try await authorizeBrowser(request)
        let gallery = try await galleryProvider(session)
        guard Self.clean(gallery.fixtureId) == Self.clean(session.fixtureId) else {
            throw Self.failure(
                "pbe_owner_session_mismatch",
                409,
                "The hosted gallery does not match the frozen Backstage fixture."
            )
        }
        return try Self.response(GalleryEnvelope(gallery: gallery))
    }

    private func authorizeBrowser(
        _ request: PBEOwnerHTTPRequest,
        heartbeat: Bool = false
    ) async throws -> PBEOwnerSessionContract {
        let cookie = try browserCookie(request)
        let fixtureID = try await sessionStore.requiredBrowserFixtureID(
            browserSession: cookie
        )
        let readiness = try await readinessProvider(fixtureID)
        return try await sessionStore.authorizeBrowser(
            browserSession: cookie,
            readiness: readiness,
            heartbeat: heartbeat
        )
    }

    private func sourcePreview(
        _ request: PBEOwnerHTTPRequest
    ) async throws -> PBEOwnerHTTPResponse {
        guard let previewProvider else {
            throw Self.failure(
                "pbe_owner_route_not_implemented",
                501,
                "The native PBE Owner source preview reader is not configured."
            )
        }
        let session = try await authorizeBrowser(request)
        guard let components = URLComponents(
            string: "http://127.0.0.1\(request.target)"
        ) else {
            throw Self.failure(
                "pbe_owner_preview_asset_invalid",
                400,
                "The requested PBE Owner preview asset is invalid."
            )
        }
        let encodedPath = components.percentEncodedPath
        let encodedPrefix = Self.sourcePreviewPath
        let encodedAssetID = String(encodedPath.dropFirst(encodedPrefix.count))
        let assetID = encodedAssetID.removingPercentEncoding ?? ""
        guard !assetID.isEmpty,
              encodedPath.hasPrefix(encodedPrefix),
              !encodedAssetID.contains("/"),
              !encodedAssetID.contains("\\"),
              assetID == Self.clean(assetID),
              !assetID.contains("\\"),
              assetID.utf8.count <= BackstagePreviewIPCConstants.maximumAssetIDBytes,
              assetID.unicodeScalars.allSatisfy({
                  !CharacterSet.controlCharacters.contains($0)
              }) else {
            throw Self.failure(
                "pbe_owner_preview_asset_invalid",
                400,
                "The requested PBE Owner preview asset is invalid."
            )
        }
        let requestedSize = queryValue("size", request: request) == "detail"
            ? BackstagePreviewIPCConstants.maximumMaxPixel
            : 900
        let preview = try await previewProvider(session, assetID, requestedSize)
        guard preview.assetId == assetID else {
            throw Self.failure(
                "pbe_owner_session_mismatch",
                409,
                "The source preview does not match the frozen Backstage fixture."
            )
        }
        return PBEOwnerHTTPResponse(
            statusCode: 200,
            reasonPhrase: "OK",
            headers: [
                "Content-Type": "image/jpeg",
                "X-Content-Type-Options": "nosniff",
            ],
            body: preview.jpegData
        )
    }

    private func submitAction(
        _ request: PBEOwnerHTTPRequest
    ) async throws -> PBEOwnerHTTPResponse {
        guard let actionSubmitProvider else {
            throw Self.failure(
                "pbe_owner_route_not_implemented",
                501,
                "The native PBE Owner action bridge is not configured."
            )
        }
        let session = try await authorizeBrowser(request)
        let key = Self.clean(request.headers["idempotency-key"] ?? "")
        guard !key.isEmpty else {
            throw Self.failure(
                "pbe_owner_idempotency_required",
                400,
                "Hosted PBE Owner actions require an Idempotency-Key."
            )
        }
        let payload = try Self.decoder.decode(
            [String: JSONValue].self,
            from: request.body
        )
        return try Self.response(
            try await actionSubmitProvider(session, payload, key),
            statusCode: 202,
            reasonPhrase: "Accepted"
        )
    }

    private func actionStatus(
        _ request: PBEOwnerHTTPRequest
    ) async throws -> PBEOwnerHTTPResponse {
        guard let actionStatusProvider else {
            throw Self.failure(
                "pbe_owner_route_not_implemented",
                501,
                "The native PBE Owner action status reader is not configured."
            )
        }
        let session = try await authorizeBrowser(request)
        let requestID = Self.clean(queryValue("requestId", request: request))
        return try Self.response(try await actionStatusProvider(
            session,
            requestID.isEmpty ? nil : requestID
        ))
    }

    private func unsupportedRoute(
        _ request: PBEOwnerHTTPRequest,
        route: PBEOwnerNativeHostRoute
    ) async -> PBEOwnerHTTPResponse {
        _ = request
        _ = route
        return Self.error(
            "pbe_owner_route_not_implemented",
            statusCode: 501,
            message: "This native PBE Owner route has not been wired yet."
        )
    }

    private func authorizeHost(_ request: PBEOwnerHTTPRequest) throws {
        let supplied = Self.clean(request.headers["x-pbe-host-authorization"] ?? "")
        guard !hostAuthorizationHash.isEmpty,
              Self.constantTimeEqual(hostAuthorizationHash, Self.hash(supplied)) else {
            throw Self.failure(
                "pbe_owner_host_authorization_required",
                401,
                "This PBE host was not authenticated by Backstage."
            )
        }
    }

    private func bearerToken(_ request: PBEOwnerHTTPRequest) throws -> String {
        let authorization = Self.clean(request.headers["authorization"] ?? "")
        let parts = authorization.split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
        guard parts.count == 2,
              parts[0].lowercased() == "bearer",
              !Self.clean(String(parts[1])).isEmpty else {
            throw Self.failure(
                "pbe_owner_session_required",
                401,
                "A Backstage-minted PBE Owner session is required."
            )
        }
        return Self.clean(String(parts[1]))
    }

    private func browserCookie(_ request: PBEOwnerHTTPRequest) throws -> String {
        let values = (request.headers["cookie"] ?? "")
            .split(separator: ";")
            .compactMap { component -> String? in
                let pair = component.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                guard pair.count == 2,
                      Self.clean(String(pair[0])) == Self.browserCookie else { return nil }
                return Self.clean(String(pair[1]))
            }
        guard values.count == 1, let value = values.first, !value.isEmpty else {
            throw Self.failure(
                "pbe_owner_session_required",
                401,
                "A Backstage-launched PBE Owner browser session is required."
            )
        }
        return value
    }

    private func queryValue(_ name: String, request: PBEOwnerHTTPRequest) -> String {
        guard let components = URLComponents(string: "http://127.0.0.1\(request.target)") else {
            return ""
        }
        return Self.clean(components.queryItems?.first(where: { $0.name == name })?.value ?? "")
    }

    private static func cookieHeader(_ value: String, clear: Bool = false) -> String {
        var attributes = [
            "\(browserCookie)=\(value)",
            "Path=\(cookiePath)",
            "HttpOnly",
            "SameSite=Strict",
        ]
        if clear {
            attributes.append("Max-Age=0")
            attributes.append("Expires=Thu, 01 Jan 1970 00:00:00 GMT")
        }
        return attributes.joined(separator: "; ")
    }

    private static var decoder: JSONDecoder { .ownerAPI }

    private static func response<Body: Encodable>(
        _ body: Body,
        statusCode: Int = 200,
        reasonPhrase: String = "OK"
    ) throws -> PBEOwnerHTTPResponse {
        .json(
            statusCode: statusCode,
            reasonPhrase: reasonPhrase,
            body: try JSONEncoder.ownerAPI.encode(body)
        )
    }

    private static func error(
        _ code: String,
        statusCode: Int,
        message: String
    ) -> PBEOwnerHTTPResponse {
        let body = ErrorEnvelope(error: .init(code: code, message: message))
        return .json(
            statusCode: statusCode,
            reasonPhrase: reasonPhrase(statusCode),
            body: (try? JSONEncoder.ownerAPI.encode(body)) ?? Data()
        )
    }

    private static func reasonPhrase(_ statusCode: Int) -> String {
        switch statusCode {
        case 200: "OK"
        case 201: "Created"
        case 400: "Bad Request"
        case 401: "Unauthorized"
        case 403: "Forbidden"
        case 404: "Not Found"
        case 409: "Conflict"
        case 415: "Unsupported Media Type"
        case 501: "Not Implemented"
        case 502: "Bad Gateway"
        case 503: "Service Unavailable"
        default: "Internal Server Error"
        }
    }

    private static func clean(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func hash(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func constantTimeEqual(_ lhs: String, _ rhs: String) -> Bool {
        let left = Array(lhs.utf8), right = Array(rhs.utf8)
        guard left.count == right.count else { return false }
        return zip(left, right).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }

    private static func randomSecret() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw failure(
                "pbe_owner_secret_unavailable",
                503,
                "The native PBE Owner host could not create a session secret."
            )
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func failure(
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
