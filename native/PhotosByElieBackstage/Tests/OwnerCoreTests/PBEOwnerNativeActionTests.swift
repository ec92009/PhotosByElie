import Foundation
import Testing
@testable import OwnerCore

@Suite("PBE Owner native action bridge")
struct PBEOwnerNativeActionTests {
    @Test("X submits one trusted durable Worker action and resumes it while active")
    func trustedSubmissionAndResume() async throws {
        let api = PBEOwnerNativeActionAPIStub()
        let service = actionService(api: api)
        let payload: [String: JSONValue] = [
            "action": "waste-basket-x",
            "photo_id": "asset-one",
            "actor": "browser-spoof",
            "ownerAuthorized": true,
        ]

        let queued = try await service.submit(
            session: actionSession(),
            payload: payload,
            idempotencyKey: "browser-key-one"
        )
        #expect(queued["state"]?.stringValue == "queued")
        let requestID = try #require(queued["requestId"]?.stringValue)

        let recorded = try #require(await api.requests().first)
        #expect(recorded.request.actionKind == "photo-moderation")
        #expect(recorded.request.target == "max")
        #expect(recorded.key == "browser-key-one")
        #expect(recorded.request.payload["operation"]?.stringValue == "waste-basket-x")
        #expect(recorded.request.payload["photoIds"]?.arrayValue?.compactMap(\.stringValue) == ["asset-one"])
        #expect(recorded.request.payload["fixtureId"]?.stringValue == "expo")
        #expect(recorded.request.payload["galleryId"]?.stringValue == "expo")
        #expect(recorded.request.payload["actor"]?.stringValue == "backstage-pbe:session-one")
        #expect(recorded.request.payload["ownerAuthorized"] == nil)
        #expect(recorded.request.payload["requestKey"] == nil)

        let resumed = try await service.submit(
            session: actionSession(),
            payload: payload,
            idempotencyKey: "browser-key-two"
        )
        #expect(resumed["requestId"]?.stringValue == requestID)
        #expect(resumed["resumed"]?.boolValue == true)
        #expect(await api.requests().count == 1)
    }

    @Test("Completed X status enables only its same-session restore")
    func completedStatusAndRestore() async throws {
        let api = PBEOwnerNativeActionAPIStub()
        let service = actionService(api: api)
        let session = actionSession()
        let queued = try await service.submit(
            session: session,
            payload: ["action": "waste-basket-x", "photo_id": "asset-one"],
            idempotencyKey: "browser-key-x"
        )
        let requestID = try #require(queued["requestId"]?.stringValue)
        await api.complete(
            id: requestID,
            result: [
                "result": [
                    "authoritative_committed": true,
                    "projection": ["state": "applied", "retryable": false],
                    "catalog_publish_pending": true,
                ],
            ]
        )

        let completed = try await service.status(
            session: session,
            requestID: requestID
        )
        #expect(completed["state"]?.stringValue == "completed")
        #expect(completed["authoritative_committed"]?.boolValue == true)
        #expect(completed["projection"]?.objectValue?["state"]?.stringValue == "applied")

        let restored = try await service.submit(
            session: session,
            payload: ["action": "waste-basket-restore", "photo_id": "asset-one"],
            idempotencyKey: "browser-key-restore"
        )
        #expect(restored["state"]?.stringValue == "queued")
        #expect(await api.requests().count == 2)
        #expect(await api.requests().last?.request.payload["operation"]?.stringValue == "waste-basket-restore")
    }

    @Test("Out-of-window X and unrelated restore fail before Worker submission")
    func scopeFailures() async {
        let api = PBEOwnerNativeActionAPIStub()
        let service = actionService(api: api)

        await expectActionFailure(code: "pbe_owner_fixture_mismatch") {
            _ = try await service.submit(
                session: actionSession(),
                payload: ["action": "waste-basket-x", "photo_id": "asset-two"],
                idempotencyKey: "browser-key-outside"
            )
        }
        await expectActionFailure(code: "pbe_owner_fixture_mismatch") {
            _ = try await service.submit(
                session: actionSession(),
                payload: ["action": "waste-basket-restore", "photo_id": "asset-one"],
                idempotencyKey: "browser-key-unrelated-restore"
            )
        }
        #expect(await api.requests().isEmpty)
    }

    private func actionService(
        api: PBEOwnerNativeActionAPIStub
    ) -> PBEOwnerNativeActionService {
        PBEOwnerNativeActionService(
            api: api,
            runner: OwnerActionRunner(
                api: api,
                waker: PBEOwnerNativeActionNoopWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            connectorID: "max",
            galleryProvider: { _ in actionGallery() }
        )
    }

    private func expectActionFailure(
        code: String,
        operation: () async throws -> Void
    ) async {
        do {
            try await operation()
            Issue.record("Expected action failure \(code)")
        } catch let failure as PBEOwnerNativeSessionFailure {
            #expect(failure.code == code)
            #expect(!failure.message.contains("asset-one"))
        } catch {
            Issue.record("Unexpected action error: \(error)")
        }
    }
}

private func actionSession() -> PBEOwnerSessionContract {
    PBEOwnerSessionContract(
        id: "session-one",
        state: "ready",
        fixtureId: "expo",
        fixtureBreadcrumb: "Root / Expo",
        sourceIdentity: "source-one",
        catalogIdentity: "catalog-one",
        readinessIdentity: "readiness-one",
        fixtureRevision: "revision-one",
        capabilities: ["gallery.read", "waste-basket.x", "waste-basket.restore"],
        lifecycleWriter: "pbb-79-waste-basket",
        createdAt: nil,
        expiresAt: Date().addingTimeInterval(300),
        closedAt: nil,
        leaseExpiresAt: nil
    )
}

private func actionGallery() -> PBEOwnerNativeGallery {
    PBEOwnerNativeGallery(
        ok: true,
        readOnly: true,
        fixtureId: "expo",
        fixtureBreadcrumb: "Root / Expo",
        candidateMode: "curated",
        view: "picked",
        offset: 0,
        limit: 500,
        count: 1,
        nextOffset: 1,
        hasNext: false,
        truncated: false,
        summary: .init(filtered: 1, universe: 1, undecided: 0, picked: 1, hidden: 0),
        mediaAvailability: .init(photos: 1, videos: 0),
        items: [
            PBEOwnerNativeGalleryItem(
                assetId: "asset-one",
                photoLibraryIdentifier: "photos-one",
                title: "One",
                filename: "one.jpg",
                mediaType: "photo",
                capturedAt: "",
                locationLabel: "",
                pixelWidth: 1_200,
                pixelHeight: 800,
                resourceFormat: "JPEG",
                originalByteCount: 1_024,
                placementState: "picked",
                eligibilityState: "active",
                rating: 0,
                color: "",
                editorialState: "unreviewed",
                keywords: []
            ),
        ]
    )
}

private actor PBEOwnerNativeActionAPIStub: OwnerActionServing {
    struct Recorded: Sendable {
        var request: OwnerActionCreate
        var key: String
    }

    private var recorded: [Recorded] = []
    private var actions: [String: OwnerAction] = [:]

    func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String
    ) async throws -> OwnerActionEnvelope {
        let id = "owner-action-\(recorded.count + 1)"
        let queued = OwnerAction(
            id: id,
            actionKind: action.actionKind,
            target: action.target,
            state: .queued,
            payload: action.payload
        )
        recorded.append(.init(request: action, key: idempotencyKey))
        actions[id] = queued
        return OwnerActionEnvelope(action: queued, idempotencyReplayed: false)
    }

    func getAction(id: String) async throws -> OwnerAction {
        guard let action = actions[id] else {
            throw APIErrorEnvelope(error: .init(
                code: "not_found",
                message: "Synthetic action unavailable."
            ))
        }
        return action
    }

    func complete(id: String, result: [String: JSONValue]) {
        guard var action = actions[id] else { return }
        action.state = .completed
        action.result = result
        actions[id] = action
    }

    func requests() -> [Recorded] { recorded }
}

private struct PBEOwnerNativeActionNoopWaker: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? {
        _ = actionID
        return nil
    }
}
