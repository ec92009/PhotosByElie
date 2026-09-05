import CryptoKit
import Foundation
import Testing
@testable import OwnerCore

func signedPhotosJobRequest(_ raw: Data, credential: BackstagePhotosJobCredential) throws -> Data {
    let key = SymmetricKey(data: try #require(Data(base64Encoded: credential.secret)))
    let signature = Data(HMAC<SHA256>.authenticationCode(for: raw, using: key))
    return try JSONSerialization.data(withJSONObject: ["jobID": credential.jobID,
        "request": raw.base64EncodedString(), "signature": signature.base64EncodedString()])
}

@Suite("Private Backstage Photos jobs")
struct BackstagePhotosJobAuthorityTests {
    private func session() -> OwnerAuthenticationSnapshot {
        .init(phase: .authenticated, deviceId: "test-owner", accessExpiresAt: Date().addingTimeInterval(300))
    }
    private func raw(_ operation: String = "photos.preview", fields: [String: Any] = [:]) throws -> Data {
        var body: [String: Any] = ["requestId": UUID().uuidString, "operation": operation,
            "assetId": "allowed", "maxPixel": 900]
        body.merge(fields) { _, new in new }
        return try JSONSerialization.data(withJSONObject: body)
    }
    private func issue(_ authority: BackstagePhotosJobAuthority, _ plan: BackstagePhotosJobPlan) async throws -> BackstagePhotosJobCredential {
        let snapshot = session()
        return try await authority.issue(plan: plan, session: snapshot, checkSession: { snapshot })
    }

    @Test("Nightly schedule is opt-in, Madrid-local, and once per day")
    func schedule() throws {
        let now = try #require(ISO8601DateFormatter().date(from: "2026-09-05T00:02:00Z"))
        #expect(BackstageAIJobSchedule.dueDay(now: now, enabled: false, lastAttemptDay: nil) == nil)
        #expect(BackstageAIJobSchedule.dueDay(now: now, enabled: true, lastAttemptDay: nil) == "2026-09-05")
        #expect(BackstageAIJobSchedule.dueDay(now: now, enabled: true, lastAttemptDay: "2026-09-05") == nil)
        #expect(BackstageAIJobSchedule.dueDay(now: now.addingTimeInterval(600), enabled: true, lastAttemptDay: nil) == nil)
    }

    @Test("Photos launch failures surface without waiting for the action timeout")
    func launchFailure() async throws {
        let action = OwnerAction(id: "owner-action-failed-job", actionKind: "sidecar-photos-index-sync", target: "max", state: .queued)
        let runner = OwnerActionRunner(api: PendingPhotosJobAPI(action: action), waker: FailingPhotosJobWaker(),
            pollInterval: .milliseconds(1), timeout: .seconds(1))
        await #expect(throws: OwnerActionRunError.failed("Photos job rejected")) {
            try await runner.awaitCompletion(of: action)
        }
    }

    @Test("Descriptor and arbitrary signed requests cannot grant authority")
    func rejectedScopes() async throws {
        let authority = BackstagePhotosJobAuthority()
        let credential = try await issue(authority, .init(operations: ["photos.preview"], assetIDs: ["allowed"]))
        #expect(await authority.consume(try raw()) == nil)
        for operation in ["photos.library-index", "photos.export-original", "photos.metadata-apply-many", "photos.identity-map"] {
            #expect(await authority.consume(try signedPhotosJobRequest(raw(operation), credential: credential)) == nil)
        }
        for fields: [String: Any] in [["assetId": "other"], ["maxPixel": 1801], ["maxPixel": 0]] {
            #expect(await authority.consume(try signedPhotosJobRequest(raw(fields: fields), credential: credential)) == nil)
        }
        let valid = try signedPhotosJobRequest(raw(), credential: credential)
        var tampered = try #require(JSONSerialization.jsonObject(with: valid) as? [String: Any])
        tampered["request"] = try raw(fields: ["assetId": "other"]).base64EncodedString()
        #expect(await authority.consume(try JSONSerialization.data(withJSONObject: tampered)) == nil)
        #expect(await authority.consume(Data(repeating: 0, count: 24_001)) == nil)
        #expect(await authority.consume(valid) != nil)
    }

    @Test("Concurrent replay executes once and revoked or expired jobs fail closed")
    func lifecycle() async throws {
        let authority = BackstagePhotosJobAuthority()
        let credential = try await issue(authority, .init(operations: ["photos.preview"], assetIDs: ["allowed"]))
        let request = try signedPhotosJobRequest(raw(), credential: credential)
        let successes = await withTaskGroup(of: Bool.self) { group in
            for _ in 0..<20 { group.addTask { await authority.consume(request) != nil } }
            var count = 0
            for await success in group where success { count += 1 }
            return count
        }
        #expect(successes == 1)
        #expect(await authority.consume(try signedPhotosJobRequest(raw(), credential: credential), now: Date().addingTimeInterval(1000)) == nil)
        await authority.revoke(credential.jobID)
        #expect(await authority.consume(try signedPhotosJobRequest(raw(), credential: credential)) == nil)
    }

    @Test("Signing out or changing Owner identity invalidates a job")
    func ownerBoundary() async throws {
        let authority = BackstagePhotosJobAuthority()
        for changed in [OwnerAuthenticationSnapshot(phase: .signedOut),
                        OwnerAuthenticationSnapshot(phase: .authenticated, deviceId: "other", accessExpiresAt: Date().addingTimeInterval(300))] {
            let credential = try await authority.issue(plan: .init(operations: ["photos.preview"], assetIDs: ["allowed"]),
                session: session(), checkSession: { changed })
            #expect(await authority.consume(try signedPhotosJobRequest(raw(), credential: credential)) == nil)
        }
    }

    @Test("Library pages retain frozen dates and advance only after a receipt")
    func libraryScope() async throws {
        let authority = BackstagePhotosJobAuthority()
        let credential = try await issue(authority, .init(operations: ["photos.library-index"], dateFrom: "2026-01-01"))
        let fields: [String: Any] = ["dateFrom": "2026-01-01", "offset": 0, "limit": 1000]
        let first = try raw("photos.library-index", fields: fields)
        let envelope = try signedPhotosJobRequest(first, credential: credential)
        #expect(await authority.consume(envelope) != nil)
        #expect(await authority.consume(try signedPhotosJobRequest(raw("photos.library-index", fields: fields), credential: credential)) == nil)
        await authority.recordResponse(envelopeData: envelope, requestData: first, response: Data(#"{"ok":true}"#.utf8))
        #expect(await authority.consume(try signedPhotosJobRequest(raw("photos.library-index", fields: fields), credential: credential)) == nil)
        #expect(await authority.consume(try signedPhotosJobRequest(raw("photos.library-index", fields: ["dateFrom":"2026-01-01", "offset":1000,"limit":1000]), credential: credential)) != nil)
    }

    @Test("Metadata writes match approved values and preserve tombstone metadata")
    func metadataScope() async throws {
        let authority = BackstagePhotosJobAuthority()
        let expected = PhotoMetadataApplyRequest(assetID: "allowed", title: "Approved title", keywords: ["one"], managedKeywords: ["PBE:Approved"])
        let credential = try await issue(authority, .init(operations: ["photos.metadata-read-many", "photos.metadata-apply-many"],
            assetIDs: ["allowed", "tombstone"], writes: [expected], preserveMetadataIDs: ["tombstone"]))
        let row = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(expected)) as? [String: Any])
        #expect(await authority.consume(try signedPhotosJobRequest(raw("photos.metadata-apply-many", fields: ["requests": [row]]), credential: credential)) != nil)
        var wrong = row; wrong["title"] = "Changed"
        #expect(await authority.consume(try signedPhotosJobRequest(raw("photos.metadata-apply-many", fields: ["requests": [wrong]]), credential: credential)) == nil)
        let tombstone: [String: Any] = ["assetId":"tombstone", "title":"Keep title", "caption":"Keep caption", "keywords":["family"], "managedKeywords":["PBE:Tombstone"]]
        let apply = try raw("photos.metadata-apply-many", fields: ["requests": [tombstone]])
        #expect(await authority.consume(try signedPhotosJobRequest(apply, credential: credential)) == nil)
        let read = try raw("photos.metadata-read-many", fields: ["requests": [["assetId":"tombstone"]]])
        let readEnvelope = try signedPhotosJobRequest(read, credential: credential)
        #expect(await authority.consume(readEnvelope) != nil)
        let response = try JSONSerialization.data(withJSONObject: ["ok":true, "items":[["assetId":"tombstone", "title":"Keep title", "caption":"Keep caption", "keywords":["family", "PBE:Approved", "PBE:Rating:4"]]]])
        await authority.recordResponse(envelopeData: readEnvelope, requestData: read, response: response)
        #expect(await authority.consume(try signedPhotosJobRequest(apply, credential: credential)) != nil)
        #expect(await authority.consume(try signedPhotosJobRequest(raw("photos.metadata-read-many", fields: ["requests": Array(repeating: ["assetId":"allowed"], count:65)]), credential: credential)) == nil)
    }
}

private struct PendingPhotosJobAPI: OwnerActionServing {
    let action: OwnerAction
    func createAction(_ action: OwnerActionCreate, idempotencyKey: String) async throws -> OwnerActionEnvelope {
        .init(action: self.action, idempotencyReplayed: false)
    }
    func getAction(id: String) async throws -> OwnerAction { action }
}
private struct FailingPhotosJobWaker: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? {
        throw OwnerActionRunError.failed("Photos job rejected")
    }
}
