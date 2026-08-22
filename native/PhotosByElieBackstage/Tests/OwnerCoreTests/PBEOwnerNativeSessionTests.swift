import Foundation
import Testing
@testable import OwnerCore

@Suite("PBE Owner native session authority")
struct PBEOwnerNativeSessionTests {
    @Test("Cloud verifier sends only the bearer to the fixed session endpoint")
    func cloudVerifierRequest() async throws {
        let session = fixtureSession(expiresAt: Date(timeIntervalSince1970: 2_000_000_600))
        let body = try JSONEncoder.ownerAPI.encode(PBEOwnerTestSessionEnvelope(session: session))
        let transport = PBEOwnerVerifierTransport(status: 200, body: body)
        let endpoint = URL(string: "https://auth.example.invalid/api/v1/pbe-owner/session")!
        let verifier = PBEOwnerCloudSessionVerifier(
            endpoint: endpoint,
            transport: transport,
            timeout: 5
        )

        let verified = try await verifier.verify(token: " cloud-token-one ")
        #expect(verified == session)
        let request = await transport.lastRequest()
        #expect(request?.url == endpoint)
        #expect(request?.httpMethod == "GET")
        #expect(request?.timeoutInterval == 5)
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer cloud-token-one")
        #expect(request?.value(forHTTPHeaderField: "User-Agent") == PBEOwnerCloudSessionVerifier.userAgent)
        #expect(request?.httpBody == nil)
    }

    @Test("Cloud verifier preserves bounded rejection details and fails invalid replies closed")
    func cloudVerifierFailures() async throws {
        let rejection = PBEOwnerVerifierTransport(
            status: 403,
            body: Data(#"{"error":{"code":"pbe_owner_session_inactive","message":"Session closed."}}"#.utf8)
        )
        let rejectedVerifier = PBEOwnerCloudSessionVerifier(transport: rejection)
        await expectFailure(code: "pbe_owner_session_inactive") {
            _ = try await rejectedVerifier.verify(token: "cloud-token-one")
        }

        let invalid = PBEOwnerVerifierTransport(status: 200, body: Data(#"{"ok":true}"#.utf8))
        let invalidVerifier = PBEOwnerCloudSessionVerifier(transport: invalid)
        await expectFailure(code: "pbe_owner_session_invalid") {
            _ = try await invalidVerifier.verify(token: "cloud-token-one")
        }

        let unavailable = PBEOwnerVerifierTransport(error: URLError(.timedOut))
        let unavailableVerifier = PBEOwnerCloudSessionVerifier(transport: unavailable)
        await expectFailure(code: "pbe_owner_auth_unavailable") {
            _ = try await unavailableVerifier.verify(token: "cloud-token-one")
        }

        await expectFailure(code: "pbe_owner_session_required") {
            _ = try await unavailableVerifier.verify(token: " \n ")
        }
    }

    @Test("One fixture-frozen lease exchanges a single-use browser handoff")
    func browserHandoff() async throws {
        let clock = PBEOwnerTestClock()
        let store = PBEOwnerNativeSessionStore(leaseDuration: 90, now: clock.now)
        let readiness = fixtureReadiness()
        let session = fixtureSession(expiresAt: clock.now().addingTimeInterval(600))
        let started = try await store.start(
            token: "cloud-token-one",
            cloudSession: session,
            readiness: readiness
        )
        #expect(started.fixtureId == "expo")

        let ticket = try await store.issueBrowserHandoff(token: "cloud-token-one")
        let browser = try await store.bootstrapBrowser(ticket: ticket, readiness: readiness)
        #expect(browser.browserSession != ticket)
        #expect(browser.session.fixtureRevision == "fixture-revision-one")
        let authorized = try await store.authorizeBrowser(
            browserSession: browser.browserSession,
            readiness: readiness
        )
        #expect(authorized.id == "session-one")

        await expectFailure(code: "pbe_owner_browser_handoff_invalid") {
            _ = try await store.bootstrapBrowser(ticket: ticket, readiness: readiness)
        }
    }

    @Test("Readiness drift fails closed and closing clears every authority")
    func driftAndClose() async throws {
        let clock = PBEOwnerTestClock()
        let store = PBEOwnerNativeSessionStore(now: clock.now)
        let readiness = fixtureReadiness()
        let session = fixtureSession(expiresAt: clock.now().addingTimeInterval(600))
        _ = try await store.start(token: "cloud-token-one", cloudSession: session, readiness: readiness)
        let ticket = try await store.issueBrowserHandoff(token: "cloud-token-one")
        let browser = try await store.bootstrapBrowser(ticket: ticket, readiness: readiness)
        var drifted = readiness
        drifted.fixtureRevision = "fixture-revision-two"
        await expectFailure(code: "pbe_owner_identity_mismatch") {
            _ = try await store.authorizeBrowser(
                browserSession: browser.browserSession,
                readiness: drifted
            )
        }
        let closed = try await store.closeHost(token: "cloud-token-one")
        #expect(closed.state == "closed")
        #expect(await store.activeFixtureID().isEmpty)
        await expectFailure(code: "pbe_owner_session_inactive") {
            _ = try await store.authorizeBrowser(
                browserSession: browser.browserSession,
                readiness: readiness
            )
        }
    }

    @Test("Verified host heartbeat renews only within cloud expiry")
    func heartbeatAndExpiry() async throws {
        let clock = PBEOwnerTestClock()
        let store = PBEOwnerNativeSessionStore(leaseDuration: 30, now: clock.now)
        let readiness = fixtureReadiness()
        let session = fixtureSession(expiresAt: clock.now().addingTimeInterval(60))
        _ = try await store.start(token: "cloud-token-one", cloudSession: session, readiness: readiness)

        clock.advance(20)
        let heartbeat = try await store.authorizeHost(
            token: "cloud-token-one",
            cloudSession: session,
            readiness: readiness,
            heartbeat: true
        )
        #expect(heartbeat.leaseExpiresAt == clock.now().addingTimeInterval(30))

        clock.advance(31)
        await expectFailure(code: "pbe_owner_session_expired") {
            _ = try await store.authorizeHost(
                token: "cloud-token-one",
                cloudSession: session,
                readiness: readiness
            )
        }
    }

    @Test("Browser heartbeat renews the local lease only within cloud expiry")
    func browserHeartbeatAndExpiry() async throws {
        let clock = PBEOwnerTestClock()
        let store = PBEOwnerNativeSessionStore(leaseDuration: 30, now: clock.now)
        let readiness = fixtureReadiness()
        let session = fixtureSession(expiresAt: clock.now().addingTimeInterval(60))
        _ = try await store.start(token: "cloud-token-one", cloudSession: session, readiness: readiness)
        let ticket = try await store.issueBrowserHandoff(token: "cloud-token-one")
        let browser = try await store.bootstrapBrowser(ticket: ticket, readiness: readiness)

        clock.advance(20)
        let heartbeat = try await store.authorizeBrowser(
            browserSession: browser.browserSession,
            readiness: readiness,
            heartbeat: true
        )
        #expect(heartbeat.leaseExpiresAt == clock.now().addingTimeInterval(30))

        clock.advance(31)
        await expectFailure(code: "pbe_owner_session_expired") {
            _ = try await store.authorizeBrowser(
                browserSession: browser.browserSession,
                readiness: readiness
            )
        }
    }

    @Test("Session inputs normalize while unready local state fails closed")
    func normalizedInputsAndUnreadyState() async throws {
        let clock = PBEOwnerTestClock()
        let store = PBEOwnerNativeSessionStore(now: clock.now)
        var readiness = fixtureReadiness()
        readiness.sourceIdentity = "  source-one\n"
        readiness.capabilities.append(" gallery.read ")
        var session = fixtureSession(expiresAt: clock.now().addingTimeInterval(600))
        session.sourceIdentity = " source-one "
        session.capabilities.append("gallery.read")

        let started = try await store.start(
            token: " cloud-token-one ",
            cloudSession: session,
            readiness: readiness
        )
        #expect(started.sourceIdentity == "source-one")
        #expect(started.capabilities == [
            "gallery.read", "waste-basket.restore", "waste-basket.x",
        ])

        let ticket = try await store.issueBrowserHandoff(token: "cloud-token-one")
        let browser = try await store.bootstrapBrowser(ticket: ticket, readiness: readiness)
        readiness.ready = false
        await expectFailure(code: "pbe_owner_identity_mismatch") {
            _ = try await store.authorizeBrowser(
                browserSession: browser.browserSession,
                readiness: readiness
            )
        }
    }

    private func fixtureReadiness() -> PBEOwnerHostReadiness {
        PBEOwnerHostReadiness(
            ready: true,
            sourceIdentity: "source-one",
            catalogIdentity: "catalog-one",
            readinessIdentity: "readiness-one",
            fixtureRevision: "fixture-revision-one",
            lifecycleWriter: "pbb-79-waste-basket",
            capabilities: ["gallery.read", "waste-basket.restore", "waste-basket.x"]
        )
    }

    private func fixtureSession(expiresAt: Date) -> PBEOwnerSessionContract {
        PBEOwnerSessionContract(
            id: "session-one",
            state: "ready",
            fixtureId: "expo",
            fixtureBreadcrumb: "Expo",
            sourceIdentity: "source-one",
            catalogIdentity: "catalog-one",
            readinessIdentity: "readiness-one",
            fixtureRevision: "fixture-revision-one",
            capabilities: ["waste-basket.x", "gallery.read", "waste-basket.restore"],
            lifecycleWriter: "pbb-79-waste-basket",
            createdAt: nil,
            expiresAt: expiresAt,
            closedAt: nil,
            leaseExpiresAt: nil
        )
    }

    private func expectFailure(
        code: String,
        operation: () async throws -> Void
    ) async {
        do {
            try await operation()
            Issue.record("Expected native session failure \(code)")
        } catch let failure as PBEOwnerNativeSessionFailure {
            #expect(failure.code == code)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }
}

private struct PBEOwnerTestSessionEnvelope: Encodable {
    var session: PBEOwnerSessionContract
}

private actor PBEOwnerVerifierTransport: OwnerAPITransport {
    private let status: Int
    private let body: Data
    private let error: URLError?
    private var request: URLRequest?

    init(status: Int, body: Data) {
        self.status = status
        self.body = body
        self.error = nil
    }

    init(error: URLError) {
        self.status = 0
        self.body = Data()
        self.error = error
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        self.request = request
        if let error { throw error }
        return (
            body,
            HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
        )
    }

    func lastRequest() -> URLRequest? { request }
}

private final class PBEOwnerTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var date = Date(timeIntervalSince1970: 2_000_000_000)

    func now() -> Date { lock.withLock { date } }
    func advance(_ seconds: TimeInterval) {
        lock.withLock { date = date.addingTimeInterval(seconds) }
    }
}
