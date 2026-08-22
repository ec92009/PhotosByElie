import CryptoKit
import Foundation
import Security

public struct PBEOwnerNativeSessionFailure: Error, LocalizedError, Sendable, Equatable {
    public var code: String
    public var statusCode: Int
    public var message: String

    public init(code: String, statusCode: Int, message: String) {
        self.code = code
        self.statusCode = statusCode
        self.message = message
    }

    public var errorDescription: String? { message }
}

public actor PBEOwnerNativeSessionStore {
    private struct Lease: Sendable {
        var sessionID: String
        var tokenHash: String
        var fixtureID: String
        var fixtureBreadcrumb: String
        var sourceIdentity: String
        var catalogIdentity: String
        var readinessIdentity: String
        var fixtureRevision: String
        var capabilities: [String]
        var createdAt: Date?
        var cloudExpiresAt: Date
        var leaseExpiresAt: Date
    }

    private static let requiredCapabilities = Set([
        "gallery.read", "waste-basket.x", "waste-basket.restore",
    ])
    private static let lifecycleWriter = "pbb-79-waste-basket"

    private let now: @Sendable () -> Date
    private let leaseDuration: TimeInterval
    private var lease: Lease?
    private var browserTicketHash = ""
    private var browserSessionHash = ""

    public init(
        leaseDuration: TimeInterval = 90,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.leaseDuration = min(300, max(15, leaseDuration))
        self.now = now
    }

    public func start(
        token: String,
        cloudSession: PBEOwnerSessionContract,
        readiness: PBEOwnerHostReadiness
    ) throws -> PBEOwnerSessionContract {
        let token = clean(token)
        guard !token.isEmpty else { throw failure("pbe_owner_session_required", 401) }
        let validated = try validate(cloudSession, readiness: readiness)
        let current = now()
        let candidate = Lease(
            sessionID: clean(validated.id),
            tokenHash: hash(token),
            fixtureID: clean(validated.fixtureId),
            fixtureBreadcrumb: clean(validated.fixtureBreadcrumb),
            sourceIdentity: clean(validated.sourceIdentity),
            catalogIdentity: clean(validated.catalogIdentity),
            readinessIdentity: clean(validated.readinessIdentity),
            fixtureRevision: clean(validated.fixtureRevision),
            capabilities: normalizedCapabilities(validated.capabilities),
            createdAt: validated.createdAt,
            cloudExpiresAt: validated.expiresAt,
            leaseExpiresAt: min(validated.expiresAt, current.addingTimeInterval(leaseDuration))
        )
        if let lease, lease.sessionID != candidate.sessionID, lease.leaseExpiresAt > current {
            throw failure("pbe_owner_session_conflict", 409)
        }
        lease = candidate
        browserTicketHash = ""
        browserSessionHash = ""
        return contract(candidate)
    }

    public func issueBrowserHandoff(token: String) throws -> String {
        let current = try activeLease()
        guard constantTimeEqual(current.tokenHash, hash(clean(token))) else {
            throw failure("pbe_owner_session_inactive", 401)
        }
        let ticket = try randomSecret()
        browserTicketHash = hash(ticket)
        browserSessionHash = ""
        return ticket
    }

    public func bootstrapBrowser(
        ticket: String,
        readiness: PBEOwnerHostReadiness
    ) throws -> (browserSession: String, session: PBEOwnerSessionContract) {
        let current = try activeLease()
        guard !browserTicketHash.isEmpty,
              constantTimeEqual(browserTicketHash, hash(clean(ticket))) else {
            throw failure("pbe_owner_browser_handoff_invalid", 401)
        }
        try assertReadiness(current, readiness: readiness)
        let browserSession = try randomSecret()
        browserTicketHash = ""
        browserSessionHash = hash(browserSession)
        return (browserSession, contract(current))
    }

    public func authorizeBrowser(
        browserSession: String,
        readiness: PBEOwnerHostReadiness,
        heartbeat: Bool = false
    ) throws -> PBEOwnerSessionContract {
        var current = try activeLease()
        guard !browserSessionHash.isEmpty,
              constantTimeEqual(browserSessionHash, hash(clean(browserSession))) else {
            throw failure("pbe_owner_session_inactive", 401)
        }
        try assertReadiness(current, readiness: readiness)
        if heartbeat {
            current.leaseExpiresAt = min(
                current.cloudExpiresAt,
                now().addingTimeInterval(leaseDuration)
            )
            lease = current
        }
        return contract(current)
    }

    /// Authorizes an immutable media read against the already-frozen browser
    /// session. Source previews are additionally constrained by the session's
    /// frozen gallery membership, so recomputing the full SQLite readiness
    /// fingerprint for every image would add no authorization boundary while
    /// serializing hundreds of otherwise independent thumbnail requests.
    public func authorizeFrozenBrowser(
        browserSession: String
    ) throws -> PBEOwnerSessionContract {
        let current = try activeLease()
        guard !browserSessionHash.isEmpty,
              constantTimeEqual(browserSessionHash, hash(clean(browserSession))) else {
            throw failure("pbe_owner_session_inactive", 401)
        }
        return contract(current)
    }

    public func authorizeHost(
        token: String,
        cloudSession: PBEOwnerSessionContract,
        readiness: PBEOwnerHostReadiness,
        heartbeat: Bool = false
    ) throws -> PBEOwnerSessionContract {
        let validated = try validate(cloudSession, readiness: readiness)
        var current = try activeLease()
        guard constantTimeEqual(current.tokenHash, hash(clean(token))),
              current.sessionID == clean(validated.id),
              current.fixtureID == clean(validated.fixtureId),
              current.fixtureBreadcrumb == clean(validated.fixtureBreadcrumb),
              current.capabilities == normalizedCapabilities(validated.capabilities) else {
            throw failure("pbe_owner_session_mismatch", 409)
        }
        if heartbeat {
            current.cloudExpiresAt = validated.expiresAt
            current.leaseExpiresAt = min(
                validated.expiresAt,
                now().addingTimeInterval(leaseDuration)
            )
            lease = current
        }
        return contract(current)
    }

    public func closeHost(token: String) throws -> PBEOwnerSessionContract {
        let current = try activeLease()
        guard constantTimeEqual(current.tokenHash, hash(clean(token))) else {
            throw failure("pbe_owner_session_inactive", 401)
        }
        clear()
        return contract(current, state: "closed")
    }

    public func closeBrowser(browserSession: String) throws -> PBEOwnerSessionContract {
        let current = try activeLease()
        guard !browserSessionHash.isEmpty,
              constantTimeEqual(browserSessionHash, hash(clean(browserSession))) else {
            throw failure("pbe_owner_session_inactive", 401)
        }
        clear()
        return contract(current, state: "closed")
    }

    public func activeFixtureID() -> String { lease?.fixtureID ?? "" }

    public func requiredBrowserHandoffFixtureID(ticket: String) throws -> String {
        let current = try activeLease()
        guard !browserTicketHash.isEmpty,
              constantTimeEqual(browserTicketHash, hash(clean(ticket))) else {
            throw failure("pbe_owner_browser_handoff_invalid", 401)
        }
        return current.fixtureID
    }

    public func requiredBrowserFixtureID(browserSession: String) throws -> String {
        let current = try activeLease()
        guard !browserSessionHash.isEmpty,
              constantTimeEqual(browserSessionHash, hash(clean(browserSession))) else {
            throw failure("pbe_owner_session_inactive", 401)
        }
        return current.fixtureID
    }

    private func validate(
        _ session: PBEOwnerSessionContract,
        readiness: PBEOwnerHostReadiness
    ) throws -> PBEOwnerSessionContract {
        let required = [
            session.id, session.fixtureId, session.fixtureBreadcrumb,
            session.sourceIdentity, session.catalogIdentity,
            session.readinessIdentity, session.fixtureRevision,
        ]
        guard required.allSatisfy({ !clean($0).isEmpty }) else {
            throw failure("pbe_owner_session_invalid", 502)
        }
        guard clean(session.state) == "ready" else {
            throw failure("pbe_owner_session_inactive", 401)
        }
        guard readiness.ready,
              clean(readiness.lifecycleWriter) == Self.lifecycleWriter,
              clean(session.lifecycleWriter) == Self.lifecycleWriter else {
            throw failure("pbe_owner_writer_mismatch", 409)
        }
        guard Set(normalizedCapabilities(session.capabilities)).isSuperset(
            of: Self.requiredCapabilities
        ), Set(normalizedCapabilities(readiness.capabilities)).isSuperset(
            of: Self.requiredCapabilities
        ) else {
            throw failure("pbe_owner_capability_missing", 403)
        }
        guard clean(session.sourceIdentity) == clean(readiness.sourceIdentity),
              clean(session.catalogIdentity) == clean(readiness.catalogIdentity),
              clean(session.readinessIdentity) == clean(readiness.readinessIdentity),
              clean(session.fixtureRevision) == clean(readiness.fixtureRevision) else {
            throw failure("pbe_owner_identity_mismatch", 409)
        }
        guard session.expiresAt > now() else { throw failure("pbe_owner_session_expired", 401) }
        return session
    }

    private func activeLease() throws -> Lease {
        guard let lease else { throw failure("pbe_owner_session_inactive", 401) }
        let current = now()
        guard lease.leaseExpiresAt > current, lease.cloudExpiresAt > current else {
            clear()
            throw failure("pbe_owner_session_expired", 401)
        }
        return lease
    }

    private func assertReadiness(_ lease: Lease, readiness: PBEOwnerHostReadiness) throws {
        guard readiness.ready,
              lease.sourceIdentity == clean(readiness.sourceIdentity),
              lease.catalogIdentity == clean(readiness.catalogIdentity),
              lease.readinessIdentity == clean(readiness.readinessIdentity),
              lease.fixtureRevision == clean(readiness.fixtureRevision),
              clean(readiness.lifecycleWriter) == Self.lifecycleWriter,
              Set(normalizedCapabilities(readiness.capabilities)).isSuperset(
                  of: Self.requiredCapabilities
              ) else {
            throw failure("pbe_owner_identity_mismatch", 409)
        }
    }

    private func contract(_ lease: Lease, state: String = "ready") -> PBEOwnerSessionContract {
        PBEOwnerSessionContract(
            id: lease.sessionID,
            state: state,
            fixtureId: lease.fixtureID,
            fixtureBreadcrumb: lease.fixtureBreadcrumb,
            sourceIdentity: lease.sourceIdentity,
            catalogIdentity: lease.catalogIdentity,
            readinessIdentity: lease.readinessIdentity,
            fixtureRevision: lease.fixtureRevision,
            capabilities: lease.capabilities,
            lifecycleWriter: Self.lifecycleWriter,
            createdAt: lease.createdAt,
            expiresAt: lease.cloudExpiresAt,
            closedAt: state == "closed" ? ISO8601DateFormatter().string(from: now()) : nil,
            leaseExpiresAt: lease.leaseExpiresAt
        )
    }

    private func clear() {
        lease = nil
        browserTicketHash = ""
        browserSessionHash = ""
    }

    private func clean(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
    private func normalizedCapabilities(_ values: [String]) -> [String] {
        Array(Set(values.map(clean).filter { !$0.isEmpty })).sorted()
    }
    private func hash(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func constantTimeEqual(_ lhs: String, _ rhs: String) -> Bool {
        let left = Array(lhs.utf8), right = Array(rhs.utf8)
        guard left.count == right.count else { return false }
        return zip(left, right).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }
    private func randomSecret() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw failure("pbe_owner_secret_unavailable", 503)
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
    private func failure(_ code: String, _ status: Int) -> PBEOwnerNativeSessionFailure {
        PBEOwnerNativeSessionFailure(code: code, statusCode: status, message: code)
    }
}
