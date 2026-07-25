import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("OwnerCore contract")
struct OwnerCoreTests {
    @Test("Decodes the published action page fixture")
    func decodesActionPage() throws {
        let url = try #require(Bundle.module.url(forResource: "action-page", withExtension: "json", subdirectory: "Fixtures"))
        let page = try JSONDecoder.ownerAPI.decode(OwnerActionPage.self, from: Data(contentsOf: url))
        #expect(page.actions.count == 1)
        #expect(page.actions[0].actionKind == "fixture-operation")
        #expect(page.actions[0].progress?.total == 20)
        #expect(page.page.hasMore)
    }

    @Test("Decodes legacy queued actions without canonical v1 aliases")
    func decodesLegacyActionPage() throws {
        let page = try JSONDecoder.ownerAPI.decode(
            OwnerActionPage.self,
            from: Data("""
            {
              "actions":[{
                "id":"legacy-action-1",
                "type":"photo-moderation",
                "state":"completed",
                "payload":{"requestedConnector":"max"}
              }],
              "page":{"hasMore":false}
            }
            """.utf8)
        )

        #expect(page.actions[0].actionKind == "photo-moderation")
        #expect(page.actions[0].target == "max")
        #expect(page.actions[0].state == .completed)
    }

    @Test("Generated endpoints and examples match the published contract")
    func generatedContractAndExamples() throws {
        #expect(OwnerContract.endpoints[.createAction]?.method == "POST")
        #expect(OwnerContract.endpoints[.listActions]?.path == "/actions")
        #expect(OwnerContract.endpoints[.refreshOwnerTokens]?.path == "/auth/refresh")
        #expect(OwnerContract.schemaNames.contains("ErrorEnvelope"))
        #expect(Set(OwnerContract.exampleSections) == [
            "authentication", "pagination", "error", "idempotency", "progress",
        ])

        let url = try #require(Bundle.module.url(
            forResource: "owner-api-examples",
            withExtension: "json",
            subdirectory: "Fixtures"
        ))
        let payload = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        #expect(payload?["authentication"] != nil)
        #expect(payload?["pagination"] != nil)
        #expect(payload?["error"] != nil)
        #expect(payload?["idempotency"] != nil)
        #expect(payload?["progress"] != nil)
    }

    @Test("Dense selection preserves anchor for shift click and keyboard ranges")
    func denseSelectionRanges() {
        var selection = OwnerSelectionModel(orderedIDs: ["a", "b", "c", "d", "e"])
        selection.click("b", extending: false, toggling: false)
        selection.click("d", extending: true, toggling: false)
        #expect(selection.selectedIDs == ["b", "c", "d"])
        #expect(selection.anchorID == "b")

        selection.move(.next, extending: true)
        #expect(selection.selectedIDs == ["b", "c", "d", "e"])
        #expect(selection.anchorID == "b")

        selection.click("c", extending: false, toggling: true)
        #expect(selection.selectedIDs == ["b", "d", "e"])
    }

    @Test("Creates canonical v1 requests with actor token and idempotency")
    func createsCanonicalRequest() async throws {
        let transport = RecordingTransport(response: """
        {"action":{"id":"owner-action-1","actionKind":"fixture-operation","target":"max","state":"queued"}}
        """)
        let client = OwnerAPIClient(baseURL: URL(string: "https://example.test/api/v1")!, transport: transport)
        await client.setAccessToken("short-lived")
        _ = try await client.createAction(
            OwnerActionCreate(actionKind: "fixture-operation", target: "max"),
            idempotencyKey: "fixture-create-1234"
        )
        let request = try #require(await transport.lastRequest())
        #expect(request.url?.path == "/api/v1/actions")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer short-lived")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "fixture-create-1234")
    }

    @Test("Inspects read-only Owner SQLite and backs up before migration")
    func databaseGateBackupAndMigration() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-core-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        var database: OpaquePointer?
        #expect(sqlite3_open(databaseURL.path, &database) == SQLITE_OK)
        #expect(sqlite3_exec(database, "CREATE TABLE sample(id TEXT PRIMARY KEY); PRAGMA user_version = 1;", nil, nil, nil) == SQLITE_OK)
        sqlite3_close(database)

        let gate = OwnerDatabaseGate(databaseURL: databaseURL)
        let before = try gate.inspect()
        #expect(before.readOnly)
        #expect(before.schemaVersion == 1)
        let backup = try gate.migrate(
            to: 2,
            statements: ["ALTER TABLE sample ADD COLUMN title TEXT NOT NULL DEFAULT '';"],
            expectedCurrentVersion: 1,
            identifier: "add-sample-title"
        )
        #expect(FileManager.default.fileExists(atPath: backup.path))
        #expect(try gate.inspect().schemaVersion == 2)
        #expect(try scalar(databaseURL, "SELECT COUNT(*) FROM grdb_migrations WHERE identifier = 'add-sample-title'") == "1")
        #expect(try scalar(backup, "PRAGMA integrity_check") == "ok")
    }

    @Test("A failed migration rolls back schema and migration history")
    func failedMigrationRollsBack() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-core-rollback-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        var database: OpaquePointer?
        #expect(sqlite3_open(databaseURL.path, &database) == SQLITE_OK)
        #expect(sqlite3_exec(database, "CREATE TABLE sample(id TEXT PRIMARY KEY); PRAGMA user_version = 1;", nil, nil, nil) == SQLITE_OK)
        sqlite3_close(database)

        let gate = OwnerDatabaseGate(databaseURL: databaseURL)
        #expect(throws: OwnerDatabaseError.self) {
            try gate.migrate(
                to: 2,
                statements: ["ALTER TABLE missing ADD COLUMN title TEXT;"],
                expectedCurrentVersion: 1,
                identifier: "will-fail"
            )
        }
        #expect(try gate.inspect().schemaVersion == 1)
        #expect(try scalar(databaseURL, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'grdb_migrations'") == "0")
    }

    @Test("Credential session round trips and clears device-only state")
    func credentialSessionRoundTrip() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        let credentials = OwnerCredentialSet(
            deviceId: "max-native",
            deviceCredential: "one-time-device-secret",
            accessToken: "short-lived",
            accessExpiresAt: Date(timeIntervalSince1970: 1_800_000_000),
            refreshToken: "rotating",
            refreshExpiresAt: Date(timeIntervalSince1970: 1_802_592_000)
        )
        try await session.save(credentials)
        #expect(try await session.load() == credentials)
        try await session.clear()
        #expect(try await session.load() == nil)
    }

    @Test("One-time enrollment exchanges the device secret and persists rotating tokens")
    func credentialEnrollment() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        let transport = RoutingTransport(responses: [
            "/api/v1/auth/tokens": """
            {
              "tokenType":"Bearer",
              "accessToken":"access-one",
              "expiresIn":900,
              "accessExpiresAt":"2026-07-25T10:15:00Z",
              "refreshToken":"refresh-one",
              "refreshExpiresAt":"2026-08-24T10:00:00Z"
            }
            """,
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)
        let enrollment = OwnerEnrollmentCode(
            deviceId: "owner-device-max",
            deviceCredential: String(repeating: "s", count: 48)
        )
        let encoded = try JSONEncoder.ownerAPI.encode(enrollment)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        let snapshot = try await service.enroll(code: encoded)
        #expect(snapshot.phase == .authenticated)
        #expect(snapshot.deviceId == "owner-device-max")
        let saved = try #require(try await session.load())
        #expect(saved.deviceCredential == String(repeating: "s", count: 48))
        #expect(saved.accessToken == "access-one")
        #expect(saved.refreshToken == "refresh-one")
        let request = try #require(await transport.requests().first)
        #expect(request.url?.path == "/api/v1/auth/tokens")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test("Launch bootstrap rotates an expiring Keychain session")
    func credentialBootstrapRefresh() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        try await session.save(OwnerCredentialSet(
            deviceId: "owner-device-max",
            deviceCredential: String(repeating: "d", count: 48),
            accessToken: "expired-access",
            accessExpiresAt: Date(timeIntervalSince1970: 1_700_000_000),
            refreshToken: "refresh-old",
            refreshExpiresAt: Date(timeIntervalSince1970: 1_900_000_000)
        ))
        let transport = RoutingTransport(responses: [
            "/api/v1/auth/refresh": """
            {
              "tokenType":"Bearer",
              "accessToken":"access-two",
              "expiresIn":900,
              "accessExpiresAt":"2026-07-25T10:15:00Z",
              "refreshToken":"refresh-two",
              "refreshExpiresAt":"2026-08-24T10:00:00Z"
            }
            """,
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        let snapshot = await service.bootstrap(now: Date(timeIntervalSince1970: 1_800_000_000))
        #expect(snapshot.phase == .authenticated)
        let saved = try #require(try await session.load())
        #expect(saved.accessToken == "access-two")
        #expect(saved.refreshToken == "refresh-two")
        #expect(await transport.requests().map(\.url?.path) == ["/api/v1/auth/refresh"])
    }

    @Test("Metadata give-back uses Worker action, dry-run gate, and verified receipts")
    func metadataGiveBackDryRun() async throws {
        let completed = OwnerAction(
            id: "owner-action-1",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "photosWriteback": [
                    "mode": "dry-run",
                    "count": 2,
                    "blockedCount": 1,
                    "items": [],
                    "blocked": [[
                        "fixtureId": "fixture-family",
                        "assetId": "asset-3",
                        "reason": "same-version R2 delivery is not verified",
                    ]],
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [completed])
        let runner = OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        )
        let service = MetadataGiveBackService(runner: runner)

        let report = try await service.plan(fixtureID: "fixture-family")

        #expect(report.isDryRun)
        #expect(report.readyCount == 2)
        #expect(report.blocked.map(\.assetID) == ["asset-3"])
        let request = try #require(await api.requests().first)
        #expect(request.actionKind == "sidecar-culling-review")
        #expect(request.target == "max")
        #expect(request.payload["requestedConnector"]?.stringValue == "max")
        #expect(
            request.payload["manifest"]?.objectValue?["mode"]?.stringValue
                == "fixture-photos-writeback-plan"
        )
        #expect(
            request.payload["manifest"]?.objectValue?["includePreviews"]?.boolValue
                == false
        )
    }

    @Test("Metadata give-back retries only independently failed asset IDs")
    func metadataGiveBackRetriesFailuresOnly() async throws {
        let first = OwnerAction(
            id: "owner-action-1",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "photosWriteback": [
                    "mode": "commit",
                    "writtenCount": 1,
                    "failedCount": 1,
                    "written": [[
                        "assetId": "asset-ok",
                        "fixtureIds": ["fixture-family"],
                        "checksumSha256": "abc123",
                    ]],
                    "failed": [[
                        "assetId": "asset-retry",
                        "error": "Photos verification failed",
                    ]],
                    "blocked": [],
                ],
            ]
        )
        let second = OwnerAction(
            id: "owner-action-2",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "photosWriteback": [
                    "mode": "commit",
                    "writtenCount": 1,
                    "failedCount": 0,
                    "written": [[
                        "assetId": "asset-retry",
                        "fixtureIds": ["fixture-family"],
                        "checksumSha256": "def456",
                    ]],
                    "failed": [],
                    "blocked": [],
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [first, second])
        let runner = OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        )
        let service = MetadataGiveBackService(runner: runner)

        let initial = try await service.commit(fixtureID: "fixture-family")
        #expect(initial.verifiedCount == 1)
        #expect(initial.failedAssetIDs == ["asset-retry"])
        let retried = try await service.retryFailures(
            from: initial,
            fixtureID: "fixture-family"
        )
        #expect(retried.verifiedCount == 1)
        #expect(retried.failed.isEmpty)

        let requests = await api.requests()
        #expect(requests.count == 2)
        let retryManifest = requests[1].payload["manifest"]?.objectValue
        #expect(
            retryManifest?["assetIds"]?.arrayValue?.compactMap(\.stringValue)
                == ["asset-retry"]
        )
    }

    @Test("Native ACS saves normalized people with inherited groups")
    func nativeAccessControlSave() async throws {
        let transport = RecordingTransport(response: """
        {"user":{"email":"avery@example.test","displayName":"Avery","roles":["user"],"groupIds":["family"]}}
        """)
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = AccessControlService(api: client)

        let saved = try await service.save(person: AccessPerson(
            email: "AVERY@EXAMPLE.TEST",
            displayName: "Avery",
            groupIds: ["family"]
        ))

        #expect(saved.email == "avery@example.test")
        #expect(saved.groupIds == ["family"])
        let request = try #require(await transport.lastRequest())
        #expect(request.url?.path == "/api/v1/acs/people")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key")?.hasPrefix("person-avery@example.test-") == true)
    }

    @Test("Native ACS accepts structured role and capability catalogs")
    func nativeAccessControlLoadStructuredOptions() async throws {
        let transport = RecordingTransport(response: """
        {
          "people":[{"email":"avery@example.test","displayName":"Avery","roles":["user"],"groupIds":["family"]}],
          "audienceGroups":[{"id":"family","label":"Family","kind":"family","capabilities":["view_gallery"]}],
          "roles":[{"id":"user","label":"User","capabilities":["view_public"]}],
          "capabilities":[{"id":"manage_access","label":"Manage access"}],
          "fixtureEvents":[],
          "auditEvents":[]
        }
        """)
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let state = try await AccessControlService(api: client).load()

        #expect(state.allPeople.map(\.email) == ["avery@example.test"])
        #expect(state.allGroups.map(\.id) == ["family"])
        #expect(state.roles?.first?.objectValue?["id"]?.stringValue == "user")
        #expect(state.capabilities?.first?.objectValue?["id"]?.stringValue == "manage_access")
    }

    @Test("Native fixture creation stays behind an opaque audited action")
    func nativeFixtureCreation() async throws {
        let terminal = OwnerAction(
            id: "owner-action-fixture",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "fixtures": [[
                    "fixtureId": "fixture-family",
                    "name": "Family",
                    "state": "active",
                    "children": [[
                        "fixtureId": "fixture-blood",
                        "name": "Blood",
                        "parentFixtureId": "fixture-family",
                        "state": "active",
                        "children": [],
                    ]],
                ]],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let tree = try await service.create(
            name: "Blood",
            parentID: "fixture-family",
            templateKey: "family"
        )

        #expect(tree.flatMap(\.flattened).map(\.id) == ["fixture-family", "fixture-blood"])
        let request = try #require(await api.requests().first)
        #expect(request.actionKind == "sidecar-culling-review")
        #expect(request.target == "max")
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-create")
        #expect(manifest?["parentFixtureId"]?.stringValue == "fixture-family")
        #expect(manifest?["destinationDefaults"]?.arrayValue?.compactMap(\.stringValue) == ["r2", "apple_photos"])
    }

    @Test("Native culling batches decisions through the canonical API")
    func nativeCullingBatch() async throws {
        let transport = RecordingTransport(response: """
        {"ok":true,"appliedCount":2}
        """)
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = SidecarDecisionService(api: client)

        _ = try await service.apply([
            .pick("asset-1", action: .pick),
            .pick("asset-2", action: .reject),
            .rating("asset-3", value: 5),
        ], idempotencyKey: "culling-batch-1")

        let request = try #require(await transport.lastRequest())
        #expect(request.url?.path == "/api/v1/sidecar/decisions/apply-batch")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "culling-batch-1")
        let body = try #require(request.httpBody)
        let payload = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        let decisions = try #require(payload?["decisions"] as? [[String: Any]])
        #expect(decisions.map { $0["action"] as? String } == ["pick", "reject", "rating"])
        #expect(decisions.last?["rating"] as? Int == 5)
    }

    @Test("Native metadata edits retain the Worker and Max authority gate")
    func nativeMetadataEdit() async throws {
        let terminal = OwnerAction(
            id: "owner-action-metadata",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: ["ok": true]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = MetadataReviewService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        _ = try await service.update(
            assetID: "asset-1",
            title: "Verified title",
            caption: "Morning at the museum",
            keywords: ["Paris", "paris", "museum"]
        )

        let request = try #require(await api.requests().first)
        #expect(request.actionKind == "photo-moderation")
        #expect(request.target == "max")
        #expect(request.payload["operation"]?.stringValue == "update-photo-metadata")
        #expect(request.payload["photo_id"]?.stringValue == "asset-1")
        #expect(request.payload["caption"]?.stringValue == "Morning at the museum")
        #expect(request.payload["keywords"]?.arrayValue?.compactMap(\.stringValue) == ["Paris", "museum"])
    }

    @Test("Native fixture placements stay reversible and audited")
    func nativeFixturePlacements() async throws {
        let terminal = OwnerAction(
            id: "owner-action-placement",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "ledger": .object([
                    "items": .array([.object([
                        "placementId": "placement-1",
                        "assetId": "asset-1",
                        "fixtureId": "fixture-family",
                        "breadcrumbLabel": "Friends / Family",
                        "state": "active",
                    ])]),
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let placements = try await service.place(
            assetIDs: ["asset-1"],
            fixtureIDs: ["fixture-family"]
        )

        #expect(placements.map(\.id) == ["placement-1"])
        #expect(placements.first?.breadcrumbLabel == "Friends / Family")
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-place-multi")
        #expect(manifest?["assetIds"]?.arrayValue?.compactMap(\.stringValue) == ["asset-1"])
    }

    @Test("Native AI proposal decisions use the audited review action")
    func nativeProposalDecision() async throws {
        let terminal = OwnerAction(
            id: "owner-action-proposal",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: ["ok": true]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = MetadataReviewService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))
        let proposal = MetadataProposal(
            photoID: "asset-1",
            batchID: "batch-1",
            current: .init(title: "Old", keywords: ["Paris"]),
            proposed: .init(title: "New", keywords: ["Paris", "Museum"])
        )

        _ = try await service.decide(proposal, disposition: .approve)

        let request = try #require(await api.requests().first)
        #expect(request.payload["operation"]?.stringValue == "save-title-keyword-review-approvals")
        let approval = request.payload["approvals"]?.arrayValue?.first?.objectValue
        #expect(approval?["photo_id"]?.stringValue == "asset-1")
        #expect(approval?["approved"]?.boolValue == true)
        #expect(approval?["title"]?.stringValue == "New")
    }

    @Test("Native lifecycle loads private titles and restores through moderation")
    func nativeLifecycleRestore() async throws {
        let ledger = OwnerAction(
            id: "owner-action-lifecycle-list",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "lifecycle": [
                    "hiddenCount": 1,
                    "discardedCount": 1,
                    "items": [[
                        "mediaId": "photo-hidden",
                        "state": "hidden",
                        "title": "Private saved title",
                        "mediaType": "photo",
                        "sourceSlug": "france",
                        "updatedAt": "2026-07-25T00:00:00Z",
                    ]],
                ],
            ]
        )
        let restored = OwnerAction(
            id: "owner-action-lifecycle-restore",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: ["ok": true]
        )
        let api = ScriptedOwnerActionAPI(completed: [ledger, restored])
        let service = LifecycleService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let state = try await service.ledger()
        #expect(state.items.map(\.title) == ["Private saved title"])
        _ = try await service.restore(mediaIDs: ["photo-hidden"])

        let requests = await api.requests()
        #expect(requests[0].payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-lifecycle-list")
        #expect(
            requests[0].payload["manifest"]?.objectValue?["states"]?.arrayValue?.compactMap(\.stringValue)
                == ["hidden"]
        )
        #expect(requests[1].actionKind == "photo-moderation")
        #expect(requests[1].payload["operation"]?.stringValue == "undo-hide-many")
        #expect(requests[1].payload["photoIds"]?.arrayValue?.compactMap(\.stringValue) == ["photo-hidden"])
    }

    @Test("Native delivery keeps fixture upload and publication as separate actions")
    func nativeFixtureDeliveryAndPublication() async throws {
        let deliveryPlan = OwnerAction(
            id: "owner-action-delivery-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "delivery": [
                    "fixtureId": "fixture-expo",
                    "approvedCount": 1,
                    "completeCount": 0,
                    "items": [[
                        "assetId": "asset-1",
                        "approved": true,
                        "complete": false,
                        "destinations": ["r2", "apple_photos"],
                        "receipts": [
                            "r2": ["status": "pending"],
                            "apple_photos": ["status": "pending"],
                        ],
                    ]],
                ],
            ]
        )
        let delivered = OwnerAction(
            id: "owner-action-delivery",
            actionKind: "sidecar-upload-publish",
            target: "max",
            state: .completed,
            result: [
                "result": [
                    "ok": true,
                    "status": "completed",
                    "summary": ["processedCount": 1, "failedCount": 0],
                ],
            ]
        )
        let publication = OwnerAction(
            id: "owner-action-publication-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "publication": [
                    "fixtureId": "fixture-expo",
                    "eligible": [["assetId": "asset-1"]],
                    "blocked": [],
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [deliveryPlan, delivered, publication])
        let service = FixtureDeliveryService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let plan = try await service.plan(fixtureID: "fixture-expo")
        #expect(plan.retryableIDs == ["asset-1"])
        let report = try await service.deliver(
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"]
        )
        #expect(report.ok)
        let gate = try await service.publicationPlan(
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"]
        )
        #expect(gate.eligibleIDs == ["asset-1"])

        let requests = await api.requests()
        #expect(requests[0].payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-delivery-plan")
        #expect(requests[1].actionKind == "sidecar-upload-publish")
        #expect(requests[1].payload["workflow"]?.stringValue == "fixture-delivery")
        #expect(requests[2].payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-publication-plan")
    }

    @Test("Native upload recovery previews queue health before exact run adoption")
    func nativeFixtureUploadRecovery() async throws {
        let health = OwnerAction(
            id: "owner-action-upload-health",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "uploadHealth": [
                    "fixtureId": "fixture-expo",
                    "activeAssetCount": 3,
                    "bridgeQueuedCount": 2,
                    "uploadableItemCount": 1,
                    "fullyCoveredItemCount": 1,
                    "partiallyCoveredItemCount": 0,
                    "metadataBlockedQueuedCount": 0,
                ],
            ]
        )
        let adoption = OwnerAction(
            id: "owner-action-adoption-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "uploadRunAdoption": [
                    "runId": "ub-1",
                    "fixtureId": "fixture-expo",
                    "items": [["assetId": "asset-1"]],
                    "blocked": [["assetId": "asset-2", "reason": "editorial state changed"]],
                    "applied": false,
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [health, adoption])
        let service = FixtureDeliveryService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let queue = try await service.uploadHealth(fixtureID: "fixture-expo")
        #expect(queue.uploadableCount == 1)
        #expect(queue.coveredCount == 1)
        let plan = try await service.adoptionPlan(
            runID: "ub-1",
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1", "asset-2"]
        )
        #expect(plan.eligibleIDs == ["asset-1"])
        #expect(plan.blocked["asset-2"] == "editorial state changed")
        #expect(!plan.applied)

        let requests = await api.requests()
        #expect(requests[0].payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-upload-health")
        #expect(requests[1].payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-upload-run-adoption-plan")
    }
}

private func scalar(_ databaseURL: URL, _ sql: String) throws -> String {
    var database: OpaquePointer?
    guard sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK,
          let database else {
        throw OwnerDatabaseError.unavailable("test database unavailable")
    }
    defer { sqlite3_close(database) }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
          let statement else {
        throw OwnerDatabaseError.unavailable("test statement unavailable")
    }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW else {
        throw OwnerDatabaseError.unavailable("test scalar unavailable")
    }
    return String(cString: sqlite3_column_text(statement, 0))
}

private final class MemoryCredentialVault: CredentialVault, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]

    func read(account: String) throws -> Data? {
        lock.withLock { values[account] }
    }

    func write(_ data: Data, account: String) throws {
        lock.withLock { values[account] = data }
    }

    func delete(account: String) throws {
        lock.withLock { _ = values.removeValue(forKey: account) }
    }
}

private actor RecordingTransport: OwnerAPITransport {
    private var request: URLRequest?
    private let responseData: Data

    init(response: String) {
        responseData = Data(response.utf8)
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        self.request = request
        return (
            responseData,
            HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        )
    }

    func lastRequest() -> URLRequest? { request }
}

private actor RoutingTransport: OwnerAPITransport {
    private let responses: [String: Data]
    private var recorded: [URLRequest] = []

    init(responses: [String: String]) {
        self.responses = responses.mapValues { Data($0.utf8) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        recorded.append(request)
        let path = request.url?.path ?? ""
        guard let data = responses[path] else {
            throw URLError(.resourceUnavailable)
        }
        return (
            data,
            HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        )
    }

    func requests() -> [URLRequest] { recorded }
}

private struct UnavailableWaker: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? {
        throw URLError(.cannotConnectToHost)
    }
}

private actor ScriptedOwnerActionAPI: OwnerActionServing {
    private var completed: [OwnerAction]
    private var created: [OwnerActionCreate] = []

    init(completed: [OwnerAction]) {
        self.completed = completed
    }

    func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String
    ) async throws -> OwnerActionEnvelope {
        created.append(action)
        let index = created.count - 1
        let terminal = completed[index]
        return OwnerActionEnvelope(
            action: OwnerAction(
                id: terminal.id,
                actionKind: action.actionKind,
                target: action.target,
                state: .queued
            ),
            idempotencyReplayed: false
        )
    }

    func getAction(id: String) async throws -> OwnerAction {
        guard let action = completed.first(where: { $0.id == id }) else {
            throw URLError(.resourceUnavailable)
        }
        return action
    }

    func requests() -> [OwnerActionCreate] { created }
}
