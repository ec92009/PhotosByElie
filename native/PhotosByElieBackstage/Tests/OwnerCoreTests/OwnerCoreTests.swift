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

    @Test("Owner action failures remain useful outside OwnerCore")
    func ownerActionFailuresAreLocalized() {
        #expect(
            OwnerActionRunError.failed("The connector rejected this action.").localizedDescription
                == "The connector rejected this action."
        )
        #expect(
            OwnerActionRunError.timedOut.localizedDescription
                == "The audited Owner action is taking longer than expected. It remains durable and can be checked in Activity."
        )
        #expect(
            OwnerActionRunError.invalidActionID.localizedDescription
                == "The audited Owner action did not return a valid action ID."
        )
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

    @Test("Grid movement extends anchored selection by rows")
    func gridSelectionRanges() {
        let ids = (0..<20).map { "asset-\($0)" }
        var selection = OwnerSelectionModel(orderedIDs: ids)
        selection.click("asset-6", extending: false, toggling: false)
        selection.move(by: 5, extending: true)
        #expect(selection.selectedIDs == Set((6...11).map { "asset-\($0)" }))
        #expect(selection.anchorID == "asset-6")
        #expect(selection.focusedID == "asset-11")

        selection.move(by: -5, extending: false)
        #expect(selection.selectedIDs == ["asset-6"])
        #expect(selection.anchorID == "asset-6")
    }

    @Test("Filtered decisions select the next surviving card")
    func filteredDecisionSelectsSuccessor() {
        var selection = OwnerSelectionModel(orderedIDs: ["a", "b", "c", "d"])
        selection.click("b", extending: false, toggling: false)

        let successor = selection.replaceItems(
            ["a", "c", "d"],
            selectingSuccessorAfterRemoving: "b"
        )
        #expect(successor == "c")
        #expect(selection.selectedIDs == ["c"])
        #expect(selection.anchorID == "c")
        #expect(selection.focusedID == "c")

        selection.click("d", extending: false, toggling: false)
        let predecessor = selection.replaceItems(
            ["a", "c"],
            selectingSuccessorAfterRemoving: "d"
        )
        #expect(predecessor == "c")
        #expect(selection.selectedIDs == ["c"])
    }

    @Test("Culling grid keeps 84-point cards and adapts column count")
    func cullingGridLayout() {
        #expect(CullingGridLayout.maximumColumnsThatFit(width: 83) == 1)
        #expect(CullingGridLayout.maximumColumnsThatFit(width: 84) == 1)
        #expect(CullingGridLayout.maximumColumnsThatFit(width: 176) == 2)
        #expect(CullingGridLayout.maximumColumnsThatFit(width: 1_000) == 10)
        #expect(CullingGridLayout.clampedColumnCount(5, width: 360) == 4)
        #expect(CullingGridLayout.clampedColumnCount(3, width: 1_000) == 3)
        #expect(CullingGridLayout.columnWidth(width: 360, columns: 4) == 84)
        #expect(CullingGridLayout.columnWidth(width: 500, columns: 4) == 119)
    }

    @Test("Ten-item culling rehearsal preserves scope and composes filters")
    func tenItemCullingRehearsal() {
        let candidates = (0..<10).map { index in
            CullingCandidate(
                id: "asset-\(index)",
                title: index == 7 ? "Séville Plaza" : "Travel \(index)",
                filename: "IMG_\(index).\(index == 8 ? "MOV" : "JPG")",
                mediaType: index == 8 ? "video" : "photo",
                decision: SidecarDecisionState(
                    assetId: "asset-\(index)",
                    rating: index == 7 ? 4 : 0,
                    color: index == 7 ? "green" : "",
                    pickState: index == 7 || index == 8 ? "picked" : "undecided",
                    keywords: index == 7 ? ["Seville", "Spain"] : []
                )
            )
        }
        let result = CullingWorkspace.evaluate(
            candidates,
            query: CullingQuery(
                search: "seville",
                media: [.photos],
                pick: [.picked],
                ratings: [4],
                colors: [.green]
            )
        )

        #expect(result.items.map(\.id) == ["asset-7"])
        #expect(result.summary.total == 10)
        #expect(result.summary.filtered == 1)
        #expect(result.summary.picked == 2)
        #expect(result.summary.photos == 9)
        #expect(result.summary.videos == 1)
    }

    @Test("Fixture hidden states match the rejected culling filter")
    func fixtureHiddenMatchesRejectedFilter() {
        let candidates = [
            CullingCandidate(
                id: "hidden",
                filename: "hidden.jpg",
                mediaType: "photo",
                decision: SidecarDecisionState(assetId: "hidden", pickState: "hidden")
            ),
            CullingCandidate(
                id: "open",
                filename: "open.jpg",
                mediaType: "photo",
                decision: SidecarDecisionState(assetId: "open", pickState: "undecided")
            ),
        ]

        let rejected = CullingWorkspace.evaluate(
            candidates,
            query: CullingQuery(pick: [.rejected])
        )
        let undecided = CullingWorkspace.evaluate(
            candidates,
            query: CullingQuery(pick: [.undecided])
        )

        #expect(rejected.items.map(\.id) == ["hidden"])
        #expect(undecided.items.map(\.id) == ["open"])
    }

    @Test("Large culling rehearsal uses deterministic bounded windows")
    func largeCullingRehearsal() {
        let candidates = (0..<1_140).map { index in
            CullingCandidate(
                id: "asset-\(index)",
                filename: "IMG_\(index).JPG",
                mediaType: "photo",
                decision: SidecarDecisionState(
                    assetId: "asset-\(index)",
                    pickState: index.isMultiple(of: 3) ? "picked" : "undecided"
                )
            )
        }
        let first = CullingWorkspace.evaluate(
            candidates,
            query: CullingQuery(pick: [.picked]),
            offset: 0,
            limit: 200
        )
        let second = CullingWorkspace.evaluate(
            candidates,
            query: CullingQuery(pick: [.picked]),
            offset: 200,
            limit: 200
        )

        #expect(first.summary.total == 1_140)
        #expect(first.summary.filtered == 380)
        #expect(first.items.count == 200)
        #expect(first.visibleRange == 1...200)
        #expect(first.hasNext)
        #expect(!first.hasPrevious)
        #expect(second.items.count == 180)
        #expect(second.visibleRange == 201...380)
        #expect(!second.hasNext)
        #expect(second.hasPrevious)
        #expect(Set(first.items.map(\.id)).isDisjoint(with: second.items.map(\.id)))
    }

    @Test("Fixture paths preserve the source hierarchy")
    func fixturePaths() {
        let tree = [
            FixtureNode(json: [
                "fixtureId": .string("expo"),
                "name": .string("Expo"),
                "children": .array([]),
            ]),
            FixtureNode(json: [
                "fixtureId": .string("re"),
                "name": .string("RE"),
                "children": .array([
                    .object([
                        "fixtureId": .string("la-concha"),
                        "name": .string("La Concha"),
                        "children": .array([
                            .object([
                                "fixtureId": .string("apartment-1"),
                                "name": .string("Apartment 1"),
                            ]),
                        ]),
                    ]),
                ]),
            ]),
        ]

        #expect(tree.path(to: "apartment-1").map(\.name) == ["RE", "La Concha", "Apartment 1"])
        #expect(tree.path(to: "missing").isEmpty)
    }

    @Test("Burst selection stays contiguous around the focused frame")
    func burstSelection() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let items = [
            CullingTimedItem(id: "a", capturedAt: base),
            CullingTimedItem(id: "b", capturedAt: base.addingTimeInterval(10)),
            CullingTimedItem(id: "c", capturedAt: base.addingTimeInterval(11)),
            CullingTimedItem(id: "d", capturedAt: base.addingTimeInterval(12.5)),
            CullingTimedItem(id: "e", capturedAt: base.addingTimeInterval(30)),
        ]

        #expect(CullingWorkspace.burst(containing: "c", in: items) == ["b", "c", "d"])
        #expect(CullingWorkspace.burst(containing: "missing", in: items).isEmpty)
    }

    @Test("Burst hide candidates keep the second visible frame")
    func burstRejectCandidatesKeepSecondFrame() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let items = [
            CullingTimedItem(id: "first", capturedAt: base),
            CullingTimedItem(id: "keeper", capturedAt: base.addingTimeInterval(1)),
            CullingTimedItem(id: "third", capturedAt: base.addingTimeInterval(20)),
            CullingTimedItem(id: "bridge", capturedAt: base.addingTimeInterval(75)),
            CullingTimedItem(id: "outside", capturedAt: base.addingTimeInterval(150)),
        ]

        #expect(
            CullingWorkspace.burstRejectCandidates(
                containing: "first",
                in: items
            ) == ["first", "third"]
        )
        #expect(
            CullingWorkspace.burstRejectCandidates(
                containing: "outside",
                in: items
            ).isEmpty
        )
    }

    @Test("Visible burst candidates respect capture-time boundaries")
    func visibleBurstRejectCandidatesRespectCaptureTime() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let items = [
            CullingTimedItem(id: "a-first", capturedAt: base),
            CullingTimedItem(id: "a-keeper", capturedAt: base.addingTimeInterval(1)),
            CullingTimedItem(id: "a-third", capturedAt: base.addingTimeInterval(2)),
            CullingTimedItem(id: "standalone", capturedAt: base.addingTimeInterval(30)),
            CullingTimedItem(id: "b-first", capturedAt: base.addingTimeInterval(90)),
            CullingTimedItem(id: "b-keeper", capturedAt: base.addingTimeInterval(91)),
            CullingTimedItem(id: "missing-time", capturedAt: nil),
        ]

        #expect(
            CullingWorkspace.burstRejectCandidates(
                in: items
            ) == ["a-first", "a-third", "b-first"]
        )
        #expect(
            CullingWorkspace.burstRejectCandidates(
                in: [CullingTimedItem(id: "only", capturedAt: base)]
            ).isEmpty
        )
        #expect(CullingWorkspace.burstRejectCandidates(in: []).isEmpty)
    }

    @Test("Burst capture dates parse durable Owner timestamps")
    func burstCaptureDateParsing() throws {
        let standard = try #require(CullingWorkspace.captureDate("2022-12-16T16:44:38Z"))
        let fractional = try #require(CullingWorkspace.captureDate("2022-12-16T16:44:38.125Z"))

        #expect(abs(fractional.timeIntervalSince(standard) - 0.125) < 0.001)
        #expect(CullingWorkspace.captureDate("") == nil)
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

    @Test("Expired native access recovers once and retries the original request")
    func credentialRequestRecovery() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        try await session.save(OwnerCredentialSet(
            deviceId: "owner-device-max",
            deviceCredential: String(repeating: "d", count: 48),
            accessToken: "access-one",
            accessExpiresAt: Date(timeIntervalSince1970: 1_900_000_000),
            refreshToken: "refresh-one",
            refreshExpiresAt: Date(timeIntervalSince1970: 1_900_000_000)
        ))
        let transport = SequencedRoutingTransport(responses: [
            "/api/v1/actions": [
                .init(status: 401, body: """
                {"error":{"code":"google_login_required","message":"Google login has expired."}}
                """),
                .init(status: 200, body: """
                {"actions":[],"page":{"hasMore":false}}
                """),
            ],
            "/api/v1/auth/refresh": [
                .init(status: 200, body: """
                {
                  "tokenType":"Bearer",
                  "accessToken":"access-two",
                  "expiresIn":900,
                  "accessExpiresAt":"2030-03-17T17:46:40Z",
                  "refreshToken":"refresh-two",
                  "refreshExpiresAt":"2030-03-17T17:46:40Z"
                }
                """),
            ],
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        #expect(await service.bootstrap(now: Date(timeIntervalSince1970: 1_800_000_000)).phase == .authenticated)
        let page = try await client.listActions()
        #expect(page.actions.isEmpty)

        let requests = await transport.requests()
        #expect(requests.map(\.url?.path) == [
            "/api/v1/actions",
            "/api/v1/auth/refresh",
            "/api/v1/actions",
        ])
        #expect(requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer access-one")
        #expect(requests[1].value(forHTTPHeaderField: "Authorization") == nil)
        #expect(requests[2].value(forHTTPHeaderField: "Authorization") == "Bearer access-two")
        let saved = try #require(try await session.load())
        #expect(saved.accessToken == "access-two")
        #expect(saved.refreshToken == "refresh-two")
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

        let report = try await service.plan()

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
        #expect(request.payload["manifest"]?.objectValue?["fixtureId"] == nil)
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

    @Test("Native fixture work targets the enrolled local connector")
    func nativeFixtureUsesLocalConnectorIdentity() async throws {
        let terminal = OwnerAction(
            id: "owner-action-local-fixture-tree",
            actionKind: "sidecar-culling-review",
            target: "david",
            state: .completed,
            result: ["fixtures": []]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: api,
                waker: UnavailableWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            connectorIdentity: StaticOwnerConnectorIdentity("David")
        )

        _ = try await service.tree()

        let request = try #require(await api.requests().first)
        #expect(request.target == "david")
        #expect(request.payload["requestedConnector"]?.stringValue == "david")
        #expect(request.payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-tree-list")
    }

    @Test("Native fixture state migration remains an explicit audited action")
    func nativeFixtureStateMigrationPlan() async throws {
        let terminal = OwnerAction(
            id: "owner-action-fixture-migration-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "migration": .object([
                    "migrationId": "fixture-state-v1",
                    "mode": "dry-run",
                    "plannedDecisionInsertCount": 42,
                    "plannedPickedCount": 30,
                    "plannedHiddenCount": 12,
                    "explicitPlacementCount": 7,
                    "ancestorClosureCount": 11,
                    "applied": false,
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

        let report = try await service.fixtureStateMigrationPlan()

        #expect(report.migrationID == "fixture-state-v1")
        #expect(report.mode == "dry-run")
        #expect(report.plannedDecisionInsertCount == 42)
        #expect(report.plannedPickedCount == 30)
        #expect(report.plannedHiddenCount == 12)
        #expect(!report.applied)
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-state-migration-plan")
    }

    @Test("Native fixture policy editor persists independent dimensions")
    func nativeFixturePolicyConfiguration() async throws {
        let terminal = OwnerAction(
            id: "owner-action-fixture-policy",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "configuration": .object([
                    "fixtureId": "fixture-expo",
                    "populationMode": "rule-based",
                    "candidateSource": ["kind": "photos-library"],
                    "savedRule": ["query": "Paris"],
                    "templateKey": "expo",
                    "policy": [
                        "configured": [
                            "visibility": "public",
                            "searchable": true,
                            "retention": "public-preview",
                            "delivery": "public",
                            "download": false,
                            "commerce": "retail",
                        ],
                        "effective": [
                            "visibility": "public",
                            "searchable": true,
                            "retention": "public-preview",
                            "delivery": "public",
                            "download": false,
                            "commerce": "retail",
                        ],
                        "revision": 3,
                    ],
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

        let configuration = try await service.configure(
            fixtureID: "fixture-expo",
            populationMode: "rule-based",
            candidateSource: ["kind": "photos-library"],
            savedRule: ["query": "Paris"],
            policy: FixturePolicyOverrides(
                visibility: "public",
                searchable: true,
                retention: "public-preview",
                delivery: "public",
                download: false,
                commerce: "retail"
            ),
            templateKey: "expo",
            reason: "test"
        )

        #expect(configuration.revision == 3)
        #expect(configuration.effectivePolicy.commerce == "retail")
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-configuration-set")
        #expect(manifest?["populationMode"]?.stringValue == "rule-based")
        #expect(manifest?["policyOverrides"]?.objectValue?["searchable"]?.boolValue == true)
    }

    @Test("Native fixture policy preserves inherited dimensions as unset overrides")
    func nativeFixturePolicyInheritance() async throws {
        let terminal = OwnerAction(
            id: "owner-action-fixture-policy-inheritance",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "configuration": .object([
                    "fixtureId": "fixture-child",
                    "policy": [
                        "configured": ["commerce": "free-sharing"],
                        "effective": [
                            "visibility": "private",
                            "searchable": false,
                            "retention": "private-master",
                            "delivery": "granted",
                            "download": true,
                            "commerce": "free-sharing",
                        ],
                        "revision": 4,
                    ],
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

        let configuration = try await service.configure(
            fixtureID: "fixture-child",
            populationMode: "parent-subset",
            candidateSource: ["kind": "parent-effective"],
            savedRule: [:],
            policy: FixturePolicyOverrides(commerce: "free-sharing"),
            templateKey: "",
            reason: "test inheritance"
        )

        #expect(configuration.configuredPolicy.visibility == nil)
        #expect(configuration.configuredPolicy.delivery == nil)
        #expect(configuration.configuredPolicy.commerce == "free-sharing")
        #expect(configuration.effectivePolicy.delivery == "granted")
        let request = try #require(await api.requests().first)
        let overrides = request.payload["manifest"]?.objectValue?["policyOverrides"]?.objectValue
        #expect(overrides?.count == 1)
        #expect(overrides?["commerce"]?.stringValue == "free-sharing")
    }

    @Test("Native fixture culling requests a bounded full-universe window")
    func nativeFixtureCullingWindow() async throws {
        let terminal = OwnerAction(
            id: "owner-action-fixture-culling-window",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "cullingWindow": .object([
                    "fixtureId": "fixture-expo",
                    "candidateMode": "photos-library",
                    "view": "undecided",
                    "offset": 0,
                    "limit": 200,
                    "nextOffset": 1,
                    "hasNext": true,
                    "summary": .object([
                        "filtered": 1140,
                        "universe": 3551,
                        "undecided": 1140,
                        "picked": 2200,
                        "hidden": 211,
                    ]),
                    "items": .array([.object([
                        "assetId": "asset-newest",
                        "photoLibraryIdentifier": "photos-newest",
                        "title": "Newest",
                        "filename": "NEWEST.HEIC",
                        "mediaType": "photo",
                        "capturedAt": "2026-07-26T12:00:00Z",
                        "pixelWidth": 6000,
                        "pixelHeight": 4000,
                        "resourceFormat": "HEIC",
                        "originalByteCount": 12_345_678,
                        "placementState": "undecided",
                        "eligibilityState": "active",
                        "rating": 4,
                        "color": "green",
                        "editorialState": "unreviewed",
                        "keywords": ["Madrid"],
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

        let window = try await service.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            views: [.undecided, .picked],
            offset: 0,
            limit: 200,
            search: "Madrid",
            mediaTypes: ["photo"],
            ratings: [4],
            colors: ["green"]
        )

        #expect(window.fixtureID == "fixture-expo")
        #expect(window.summary.universe == 3551)
        #expect(window.summary.filtered == 1140)
        #expect(window.items.map(\.id) == ["asset-newest"])
        #expect(window.items.first?.photoLibraryIdentifier == "photos-newest")
        #expect(window.items.first?.placementState == .undecided)
        #expect(window.items.first?.rating == 4)
        #expect(window.items.first?.pixelWidth == 6000)
        #expect(window.items.first?.pixelHeight == 4000)
        #expect(window.items.first?.resourceFormat == "HEIC")
        #expect(window.items.first?.originalByteCount == 12_345_678)
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-culling-window")
        #expect(manifest?["fixtureId"]?.stringValue == "fixture-expo")
        #expect(
            manifest?["views"]?.arrayValue?.compactMap(\.stringValue)
                == ["undecided", "picked"]
        )
        #expect(manifest?["limit"]?.intValue == 200)
        #expect(manifest?["search"]?.stringValue == "Madrid")
    }

    @Test("Native Photos reconciliation uses the enrolled connector and signed full index action")
    func nativePhotosIndexReconciliation() async throws {
        let terminal = OwnerAction(
            id: "owner-action-photos-index",
            actionKind: "sidecar-photos-index-sync",
            target: "david",
            state: .completed,
            result: [
                "job": .object([
                    "status": "done",
                    "stage": "Complete",
                    "indexedCount": 52_400,
                    "importedCount": 52_400,
                    "totalCount": 52_400,
                    "missingMarkedCount": 17,
                    "completedAt": "2026-07-28T12:00:00Z",
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: api,
                waker: UnavailableWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            connectorIdentity: StaticOwnerConnectorIdentity("David")
        )

        let report = try await service.reconcilePhotosIndex(
            dateFrom: "2026-06-13T00:00:00Z",
            dateTo: "2026-07-29T00:00:00Z"
        )

        #expect(report.status == "done")
        #expect(report.indexedCount == 52_400)
        #expect(report.importedCount == 52_400)
        #expect(report.totalCount == 52_400)
        #expect(report.missingMarkedCount == 17)
        let request = try #require(await api.requests().first)
        #expect(request.actionKind == "sidecar-photos-index-sync")
        #expect(request.target == "david")
        #expect(request.payload["requestedConnector"]?.stringValue == "david")
        #expect(request.payload["queuedAt"]?.stringValue?.isEmpty == false)
        #expect(request.payload["dateFrom"]?.stringValue == "2026-06-13T00:00:00Z")
        #expect(request.payload["dateTo"]?.stringValue == "2026-07-29T00:00:00Z")
        #expect(request.payload["manifest"] == nil)
    }

    @Test("Fixture culling keeps H fixture-local and X globally scoped")
    func fixtureCullingActionSemantics() {
        #expect(
            FixtureCullingSemantics.mutation(
                for: .exclude,
                currentFixtureID: ""
            ) == .unavailable
        )
        #expect(
            FixtureCullingSemantics.mutation(
                for: .exclude,
                currentFixtureID: "fixture-root"
            ) == .fixtureState(.hidden)
        )
        #expect(
            FixtureCullingSemantics.mutation(
                for: .exclude,
                currentFixtureID: "fixture-child"
            ) == .fixtureState(.hidden)
        )
        #expect(
            FixtureCullingSemantics.mutation(
                for: .include,
                currentFixtureID: "fixture-child"
            ) == .fixtureState(.picked)
        )
        #expect(
            FixtureCullingSemantics.mutation(
                for: .clear,
                currentFixtureID: "fixture-child"
            ) == .fixtureState(.undecided)
        )
        #expect(
            FixtureCullingSemantics.mutation(
                for: .tombstone,
                currentFixtureID: ""
            ) == .globalTombstone
        )
    }

    @Test("Native fixture Review is chronological and actions stay connector-audited")
    func nativeFixtureReviewWorkflow() async throws {
        let windowAction = OwnerAction(
            id: "owner-action-fixture-review-window",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "reviewWindow": .object([
                    "fixtureId": "fixture-expo",
                    "mode": "full",
                    "offset": 0,
                    "limit": 200,
                    "nextOffset": 1,
                    "hasNext": true,
                    "summary": .object([
                        "total": 420,
                        "unreviewed": 300,
                        "requestingAI": 100,
                        "proposed": 20,
                        "approved": 80,
                    ]),
                    "items": .array([.object([
                        "assetId": "asset-oldest",
                        "photoLibraryIdentifier": "photos-oldest",
                        "title": "Oldest",
                        "caption": "",
                        "keywords": ["Paris"],
                        "filename": "OLDEST.HEIC",
                        "mediaType": "photo",
                        "capturedAt": "2025-01-01T12:00:00Z",
                        "rating": 3,
                        "color": "yellow",
                        "placementState": "picked",
                        "editorialState": "requesting-ai",
                        "aiReasons": ["weak title"],
                        "aiNote": "Name the landmark.",
                        "aiAttemptCount": 1,
                        "aiLastError": "",
                        "proposalReady": true,
                        "proposalContextAvailable": true,
                        "proposalId": "proposal-oldest",
                        "proposedTitle": "A better title",
                        "proposedKeywords": ["Paris", "France"],
                        "proposalReason": "Improve title",
                        "proposalStatus": "ready",
                        "requestedGeneratorModel": "codex-gpt-5.6-luna-max-vision",
                        "resolvedModel": "gpt-5.6-luna",
                        "reasoningEffort": "max",
                        "vision": true,
                        "modelLadder": [
                            "codex-gpt-5.4-mini",
                            "codex-gpt-5.6-luna-max-vision",
                            "codex-gpt-5.6-sol-high-vision",
                        ],
                        "deliveryState": "not-ready",
                    ])]),
                ]),
            ]
        )
        let applyAction = OwnerAction(
            id: "owner-action-fixture-review-apply",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "reviewAction": .object([
                    "operationId": "reviewop-test",
                    "fixtureId": "fixture-expo",
                    "action": "request-ai",
                    "anchorAssetId": "asset-oldest",
                    "propagated": true,
                    "items": .array([.object([
                        "assetId": "asset-oldest",
                        "before": .object(["editorialState": "unreviewed"]),
                        "after": .object(["editorialState": "requesting-ai"]),
                    ])]),
                ]),
            ]
        )
        let undoAction = OwnerAction(
            id: "owner-action-fixture-review-undo",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "reviewUndo": .object([
                    "operationId": "reviewop-test",
                    "fixtureId": "fixture-expo",
                    "action": "request-ai",
                    "alreadyUndone": false,
                    "items": .array([.object([
                        "assetId": "asset-oldest",
                        "before": .object(["editorialState": "requesting-ai"]),
                        "after": .object(["editorialState": "unreviewed"]),
                    ])]),
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [windowAction, applyAction, undoAction])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let window = try await service.reviewWindow(
            fixtureID: "fixture-expo",
            mode: .full,
            stateFilters: ["approved", "hidden", "picked"],
            proposalAvailableOnly: true,
            mediaFilters: ["photos"],
            limit: 200
        )
        #expect(window.mode == .full)
        #expect(window.summary.total == 420)
        #expect(window.summary.approved == 80)
        #expect(window.items.first?.id == "asset-oldest")
        #expect(window.items.first?.placementState == "picked")
        #expect(window.items.first?.aiReasons == ["weak title"])
        #expect(window.items.first?.proposalReady == true)
        #expect(window.items.first?.proposalContextAvailable == true)
        #expect(window.items.first?.proposalID == "proposal-oldest")
        #expect(window.items.first?.proposedTitle == "A better title")
        #expect(window.items.first?.proposedKeywords == ["Paris", "France"])
        #expect(window.items.first?.proposalStatus == "ready")
        #expect(window.items.first?.requestedGeneratorModel == "codex-gpt-5.6-luna-max-vision")
        #expect(window.items.first?.resolvedModel == "gpt-5.6-luna")
        #expect(window.items.first?.reasoningEffort == "max")
        #expect(window.items.first?.vision == true)
        #expect(window.items.first?.modelLadder == [
            "codex-gpt-5.4-mini",
            "codex-gpt-5.6-luna-max-vision",
            "codex-gpt-5.6-sol-high-vision",
        ])

        let result = try await service.applyReview(
            .requestAI,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-oldest"],
            anchorAssetID: "asset-oldest",
            propagate: true,
            aiReasons: ["weak title"],
            aiNote: "Name the landmark."
        )
        #expect(result.action == .requestAI)
        #expect(result.operationID == "reviewop-test")
        #expect(result.propagated)
        #expect(result.changes.map(\.assetID) == ["asset-oldest"])
        let undone = try await service.undoReview(operationID: result.operationID)
        #expect(undone.operationID == "reviewop-test")
        #expect(!undone.alreadyUndone)
        #expect(undone.changes.map(\.assetID) == ["asset-oldest"])
        let requests = await api.requests()
        #expect(requests.count == 3)
        let reviewManifest = requests[0].payload["manifest"]?.objectValue
        #expect(reviewManifest?["mode"]?.stringValue == "fixture-review-window")
        #expect(reviewManifest?["reviewMode"]?.stringValue == "full")
        #expect(
            reviewManifest?["reviewStateFilters"]?.arrayValue?.compactMap(\.stringValue)
                == ["approved", "hidden", "picked"]
        )
        #expect(reviewManifest?["proposalAvailableOnly"]?.boolValue == true)
        #expect(
            reviewManifest?["mediaFilters"]?.arrayValue?.compactMap(\.stringValue)
                == ["photos"]
        )
        #expect(reviewManifest?["includePreviews"]?.boolValue == false)
        #expect(reviewManifest?["launchWorkspace"]?.boolValue == false)
        let applyManifest = requests[1].payload["manifest"]?.objectValue
        #expect(applyManifest?["mode"]?.stringValue == "fixture-review-apply")
        #expect(applyManifest?["reviewAction"]?.stringValue == "request-ai")
        #expect(applyManifest?["propagate"]?.boolValue == true)
        #expect(applyManifest?["includePreviews"]?.boolValue == false)
        #expect(applyManifest?["launchWorkspace"]?.boolValue == false)
        let undoManifest = requests[2].payload["manifest"]?.objectValue
        #expect(undoManifest?["mode"]?.stringValue == "fixture-review-undo")
        #expect(undoManifest?["operationId"]?.stringValue == "reviewop-test")
        #expect(undoManifest?["includePreviews"]?.boolValue == false)
        #expect(undoManifest?["launchWorkspace"]?.boolValue == false)
    }

    @Test("Native requested AI proposals remain draft-only and connector-audited")
    func nativeRequestedAIProposalWorkflow() async throws {
        let statusAction = OwnerAction(
            id: "owner-action-fixture-ai-status",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "ai": .object([
                    "active": false,
                    "requested": 2,
                    "ready": 1,
                    "run": .object([
                        "runId": "airun-1",
                        "trigger": "scheduled",
                        "status": "completed-with-errors",
                        "requested": 2,
                        "processed": 2,
                        "proposed": 1,
                        "skipped": 0,
                        "failed": 1,
                        "remaining": 0,
                        "elapsedSeconds": 8.5,
                    ]),
                ]),
            ]
        )
        let proposalAction = OwnerAction(
            id: "owner-action-fixture-ai-proposals",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "aiProposals": .object([
                    "items": .array([.object([
                        "proposalId": "aip-1",
                        "status": "ready",
                        "assetId": "asset-1",
                        "runId": "airun-1",
                        "attempt": 1,
                        "canonicalTitle": "Manual title",
                        "canonicalKeywords": ["Paris"],
                        "proposedTitle": "Evening in Paris",
                        "proposedKeywords": ["Paris", "Evening"],
                        "confidence": "high",
                        "reason": "Visible city landmark.",
                        "needsOwnerContext": false,
                        "requestReasons": ["weak title"],
                        "requestNote": "Name the landmark.",
                        "requestedGeneratorModel": "codex-gpt-5.6-luna-max-vision",
                        "resolvedModel": "gpt-5.6-luna",
                        "reasoningEffort": "max",
                        "vision": true,
                        "modelLadder": [
                            "codex-gpt-5.4-mini",
                            "codex-gpt-5.6-luna-max-vision",
                            "codex-gpt-5.6-sol-high-vision",
                        ],
                    ])]),
                ]),
            ]
        )
        let loadedAction = OwnerAction(
            id: "owner-action-fixture-ai-load",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "aiProposals": .object([
                    "count": 1,
                    "proposalIds": ["aip-1"],
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [
            statusAction,
            proposalAction,
            loadedAction,
        ])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let status = try await service.aiStatus()
        #expect(!status.active)
        #expect(status.ready == 1)
        #expect(status.run?.failed == 1)
        let proposals = try await service.aiProposals(includeLoaded: true)
        #expect(proposals.count == 1)
        #expect(proposals[0].canonicalTitle == "Manual title")
        #expect(proposals[0].proposedTitle == "Evening in Paris")
        #expect(proposals[0].requestedGeneratorModel == "codex-gpt-5.6-luna-max-vision")
        #expect(proposals[0].resolvedModel == "gpt-5.6-luna")
        #expect(proposals[0].reasoningEffort == "max")
        #expect(proposals[0].vision == true)
        #expect(proposals[0].modelLadder == [
            "codex-gpt-5.4-mini",
            "codex-gpt-5.6-luna-max-vision",
            "codex-gpt-5.6-sol-high-vision",
        ])
        #expect(try await service.markAIProposalsLoaded(["aip-1"]) == 1)

        let requests = await api.requests()
        #expect(requests.count == 3)
        let statusManifest = requests[0].payload["manifest"]?.objectValue
        #expect(statusManifest?["mode"]?.stringValue == "fixture-ai-status")
        let proposalManifest = requests[1].payload["manifest"]?.objectValue
        #expect(proposalManifest?["mode"]?.stringValue == "fixture-ai-proposals-ready")
        #expect(proposalManifest?["includeLoaded"]?.boolValue == true)
        let loadManifest = requests[2].payload["manifest"]?.objectValue
        #expect(loadManifest?["mode"]?.stringValue == "fixture-ai-proposals-load")
        #expect(loadManifest?["proposalIds"]?.arrayValue?.compactMap(\.stringValue) == ["aip-1"])
    }

    @Test("Fixture archive state follows the connector archivedAt contract")
    func nativeFixtureArchiveState() {
        let active = FixtureNode(json: [
            "fixtureId": "fixture-active",
            "name": "Active",
            "archivedAt": "",
        ])
        let archived = FixtureNode(json: [
            "fixtureId": "fixture-archived",
            "name": "Archived",
            "archivedAt": "2026-07-25T15:25:59Z",
        ])

        #expect(!active.isArchived)
        #expect(archived.isArchived)
    }

    @Test("Fixture snapshot preserves its immutable native culling order")
    func nativeFixtureSnapshotOrder() async throws {
        let terminal = OwnerAction(
            id: "owner-action-pool",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "pool": .object([
                    "poolId": "pool-ordered",
                    "fixtureId": "fixture-family",
                    "name": "Family selects",
                    "assetCount": 2,
                    "snapshotHash": "stable-hash",
                    "assets": .array([
                        .object([
                            "assetId": "asset-b",
                            "sourceIdentity": "photos-b",
                            "photoLibraryIdentifier": "photos-b",
                            "sourceKind": "apple_photos",
                            "position": 0,
                            "title": "Second captured, first selected",
                            "filename": "B.JPG",
                            "mediaType": "photo",
                        ]),
                        .object([
                            "assetId": "asset-a",
                            "sourceIdentity": "photos-a",
                            "photoLibraryIdentifier": "photos-a",
                            "sourceKind": "apple_photos",
                            "position": 1,
                            "title": "First captured, second selected",
                            "filename": "A.MOV",
                            "mediaType": "video",
                        ]),
                    ]),
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

        let pool = try await service.snapshot(
            fixtureID: "fixture-family",
            assetIDs: ["asset-b", "asset-a"],
            name: "Family selects"
        )

        #expect(pool.id == "pool-ordered")
        #expect(pool.fixtureID == "fixture-family")
        #expect(pool.snapshotHash == "stable-hash")
        #expect(pool.assets.map(\.id) == ["asset-b", "asset-a"])
        #expect(pool.assets.map(\.position) == [0, 1])
        #expect(pool.assets.map(\.mediaType) == ["photo", "video"])
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["selectedAssetIds"]?.arrayValue?.compactMap(\.stringValue) == ["asset-b", "asset-a"])
    }

    @Test("Native fixtures reopen saved culling snapshots after an app restart")
    func nativeFixtureSavedSnapshots() async throws {
        let listed = OwnerAction(
            id: "owner-action-pool-list",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "pools": .array([
                    .object([
                        "poolId": "pool-recent",
                        "fixtureId": "fixture-expo",
                        "name": "Native selection",
                        "assetCount": 3,
                        "snapshotHash": "snapshot-hash",
                        "state": "active",
                        "createdAt": "2026-07-25T18:00:00Z",
                    ]),
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [listed])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let pools = try await service.pools(fixtureID: "fixture-expo")

        #expect(pools.map(\.id) == ["pool-recent"])
        #expect(pools.first?.assetCount == 3)
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-pool-list")
        #expect(manifest?["fixtureId"]?.stringValue == "fixture-expo")
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

    @Test("Native culling reloads preserved decisions and captures reversible before state")
    func nativeCullingStateAndUndoEvidence() async throws {
        let applyTransport = RecordingTransport(response: """
        {
          "ok": true,
          "items": [{
            "assetId": "asset-1",
            "state": {
              "assetId": "asset-1",
              "rating": 4,
              "color": "purple",
              "pickState": "picked",
              "metadataState": "unreviewed",
              "title": "",
              "keywords": [],
              "tombstoneState": "",
              "updatedAt": "2026-07-25T14:00:00Z"
            },
            "before": {
              "assetId": "asset-1",
              "rating": 0,
              "color": "",
              "pickState": "undecided",
              "metadataState": "unreviewed",
              "title": "",
              "keywords": [],
              "tombstoneState": "",
              "updatedAt": ""
            },
            "changedFamilies": ["color"]
          }]
        }
        """)
        let applyService = SidecarDecisionService(api: OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: applyTransport
        ))

        let changes = try await applyService.applyDetailed([
            .color("asset-1", value: .purple),
        ], idempotencyKey: "native-color")

        #expect(changes.first?.state.color == "purple")
        #expect(changes.first?.before.color == "")
        #expect(changes.first?.changedFamilies == ["color"])
        let applyRequest = try #require(await applyTransport.lastRequest())
        let applyBody = try #require(applyRequest.httpBody)
        let applyPayload = try JSONSerialization.jsonObject(with: applyBody) as? [String: Any]
        #expect(applyPayload?["action"] as? String == "color")
        #expect(applyPayload?["color"] as? String == "purple")

        let queryTransport = RecordingTransport(response: """
        {
          "ok": true,
          "decisions": {
            "asset-1": {
              "assetId": "asset-1",
              "rating": 4,
              "color": "purple",
              "pickState": "picked",
              "metadataState": "unreviewed",
              "title": "",
              "keywords": [],
              "tombstoneState": "",
              "updatedAt": "2026-07-25T14:00:00Z"
            }
          }
        }
        """)
        let queryService = SidecarDecisionService(api: OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: queryTransport
        ))

        let states = try await queryService.queryStates(assetIDs: ["asset-1"])
        #expect(states["asset-1"]?.pickState == "picked")
        #expect(states["asset-1"]?.rating == 4)
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

    @Test("Native metadata edits and blacklist replacements return reversible before state")
    func nativeMetadataHistory() async throws {
        let metadata = OwnerAction(
            id: "owner-action-metadata-history",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: [
                "result": [
                    "previous_metadata": [
                        "photo_id": "asset-1",
                        "title": "Before",
                        "caption": "Original caption",
                        "keywords": ["Paris", "Museum"],
                    ],
                    "metadata": [
                        "photo_id": "asset-1",
                        "title": "After",
                        "caption": "New caption",
                        "keywords": ["Paris", "Architecture"],
                    ],
                ],
            ]
        )
        let blacklist = OwnerAction(
            id: "owner-action-blacklist-history",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: [
                "result": [
                    "previous_keywords": ["AI"],
                    "keywords": ["AI", "Stained"],
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [metadata, blacklist])
        let service = MetadataReviewService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let edit = try await service.updateDetailed(
            assetID: "asset-1",
            title: "After",
            caption: "New caption",
            keywords: ["Paris", "Architecture"]
        )
        #expect(edit.before.title == "Before")
        #expect(edit.before.caption == "Original caption")
        #expect(edit.before.keywords == ["Paris", "Museum"])
        #expect(edit.after.title == "After")

        let terms = try await service.replaceBlacklistDetailed(["AI", "Stained"])
        #expect(terms.before == ["AI"])
        #expect(terms.after == ["AI", "Stained"])
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

    @Test("Native model ladder saves the selected OpenAI order through Max")
    func nativeModelLadderSave() async throws {
        let terminal = OwnerAction(
            id: "owner-action-model-ladder",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: [
                "result": .object([
                    "previous_model_ladder": .array([.string("codex-gpt-5.4-mini")]),
                    "model_ladder": .array([
                        .string("codex-gpt-5.6-sol-high-vision"),
                        .string("codex-gpt-5.4-mini"),
                    ]),
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = MetadataReviewService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))
        let selected = [
            MetadataModelLadderRung.catalog[2],
            MetadataModelLadderRung.catalog[0],
            MetadataModelLadderRung(model: "gpt-custom-one", effort: "medium"),
            MetadataModelLadderRung(model: "gpt-custom-two", effort: "xhigh"),
        ]

        let change = try await service.replaceModelLadderDetailed(selected)

        #expect(change.before == [MetadataModelLadderRung(model: "gpt-5.4-mini", effort: "low")])
        #expect(change.after == [
            MetadataModelLadderRung(model: "gpt-5.6-sol", effort: "high"),
            MetadataModelLadderRung(model: "gpt-5.4-mini", effort: "low"),
        ])
        let request = try #require(await api.requests().first)
        #expect(request.payload["operation"]?.stringValue == "save-title-keyword-model-ladder")
        #expect(request.payload["target"] == nil)
        let payloadRungs = request.payload["model_ladder"]?.arrayValue?.compactMap(\.objectValue) ?? []
        #expect(payloadRungs.map { $0["model"]?.stringValue } == ["gpt-5.6-sol", "gpt-5.4-mini", "gpt-custom-one", "gpt-custom-two"])
        #expect(payloadRungs.map { $0["effort"]?.stringValue } == ["high", "low", "medium", "xhigh"])
        #expect(payloadRungs.allSatisfy { $0["vision"]?.boolValue == true })
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
                            "r2": [
                                "status": "verified",
                                "items": [[
                                    "object_key": "private/fixture-expo/asset-1.jpg",
                                    "checksum_sha256": "1234567890abcdef",
                                    "verified_at": "2026-07-25T10:00:00Z",
                                ]],
                            ],
                            "apple_photos": [
                                "status": "verified",
                                "items": [[
                                    "object_key": "local://asset-1",
                                    "checksum_sha256": "fedcba0987654321",
                                    "verified_at": "2026-07-25T10:00:01Z",
                                ]],
                            ],
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
        #expect(plan.items[0].r2Evidence.contains("private/fixture-expo/asset-1.jpg"))
        #expect(plan.items[0].r2Evidence.contains("sha256:1234567890ab"))
        #expect(plan.items[0].photosEvidence.contains("local://asset-1"))
        #expect(plan.items[0].photosEvidence.contains("verified 2026-07-25T10:00:01Z"))
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

    @Test("Native upload publishes verified assets and exposes reconciliation progress")
    func nativeUploadAndR2Safety() async throws {
        let eligibility = OwnerAction(
            id: "owner-action-upload-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "uploadPlan": [
                    "fixtureId": "fixture-expo",
                    "fixtureName": "Expo",
                    "cloudAllowed": true,
                    "pickedCount": 12,
                    "approvedCount": 9,
                    "needsReviewCount": 3,
                    "needsUploadCount": 2,
                    "liveCount": 7,
                    "offset": 0,
                    "limit": 200,
                    "hasNext": false,
                    "items": [[
                        "assetId": "asset-1",
                        "photoLibraryIdentifier": "photos-asset-1",
                        "title": "One",
                        "filename": "one.jpg",
                        "capturedAt": "2026-07-28T10:00:00Z",
                        "deliveryState": "needs-upload",
                        "errorText": "",
                    ], [
                        "assetId": "asset-2",
                        "photoLibraryIdentifier": "photos-asset-2",
                        "title": "Two",
                        "filename": "two.jpg",
                        "capturedAt": "2026-07-28T09:00:00Z",
                        "deliveryState": "failed",
                        "errorText": "network",
                    ]],
                ],
            ]
        )
        let started = OwnerAction(
            id: "owner-action-upload-start",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "uploadRun": [
                    "runId": "uplrun-1",
                    "status": "queued",
                    "count": 2,
                    "concurrency": 4,
                    "started": true,
                ],
            ]
        )
        let status = OwnerAction(
            id: "owner-action-upload-status",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "uploadRun": [
                    "runId": "uplrun-1",
                    "status": "completed-with-errors",
                    "requested": 2,
                    "processed": 2,
                    "live": 1,
                    "failed": 1,
                    "remaining": 0,
                    "concurrency": 4,
                    "items": [
                        ["asset_id": "asset-1", "status": "live", "error_text": ""],
                        ["asset_id": "asset-2", "status": "failed", "error_text": "network"],
                    ],
                ],
            ]
        )
        let reconciliation = OwnerAction(
            id: "owner-action-r2-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "reconciliation": [
                    "runId": "r2rec-1",
                    "mode": "plan",
                    "scanned": 3,
                    "protected": 1,
                    "quarantined": 1,
                    "restored": 0,
                    "eligibleDelete": 1,
                    "deleted": 0,
                    "actions": [[
                        "bucket": "photosbyelie-private",
                        "key": "masters/sold.jpg",
                        "assetId": "asset-1",
                        "sold": true,
                        "referenced": true,
                        "action": "protected",
                    ]],
                ],
            ]
        )
        let photosSync = OwnerAction(
            id: "owner-action-photos-sync",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "photosSync": [
                    "attached": false,
                    "requested": 25,
                    "scanned": 24,
                    "elapsedSeconds": 2.5,
                    "failures": [["assetId": "asset-failed", "error": "transient"]],
                    "changes": [
                        "baseline": 20,
                        "unchanged": 1,
                        "metadataOnly": 1,
                        "appearance": 1,
                        "sourceMissing": 1,
                        "sourceReturned": 0,
                    ],
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [eligibility, started, status, reconciliation, photosSync])
        let service = FixtureDeliveryService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let plan = try await service.nativeUploadPlan(fixtureID: "fixture-expo")
        #expect(plan.fixtureName == "Expo")
        #expect(plan.needsUploadCount == 2)
        #expect(plan.needsReviewCount == 3)
        #expect(plan.items[0].photoLibraryIdentifier == "photos-asset-1")
        #expect(FixtureReviewAction.returnToReview.rawValue == "return-to-review")
        #expect(plan.items[1].deliveryState == "failed")
        #expect(plan.items[1].errorText == "network")
        let run = try await service.startNativeUpload(
            assetIDs: ["asset-1", "asset-2"],
            limit: 50,
            concurrency: 4
        )
        #expect(run.runID == "uplrun-1")
        #expect(run.requested == 2)
        let completed = try await service.nativeUploadStatus(runID: run.runID)
        #expect(completed.isFinished)
        #expect(completed.live == 1)
        #expect(completed.failed == 1)
        #expect(completed.items[1].errorText == "network")
        let safety = try await service.r2Reconciliation()
        #expect(safety.protected == 1)
        #expect(safety.eligibleDelete == 1)
        #expect(safety.items.first?.sold == true)
        let sync = try await service.syncPhotos(limit: 25)
        #expect(sync.scanned == 24)
        #expect(sync.metadataOnly == 1)
        #expect(sync.appearance == 1)
        #expect(sync.sourceMissing == 1)
        #expect(sync.failed == 1)
        #expect(sync.elapsedSeconds == 2.5)

        let requests = await api.requests()
        #expect(requests[0].payload["manifest"]?.objectValue?["mode"]?.stringValue == "asset-upload-plan")
        #expect(requests[0].payload["manifest"]?.objectValue?["fixtureId"]?.stringValue == "fixture-expo")
        #expect(requests[1].payload["manifest"]?.objectValue?["mode"]?.stringValue == "asset-upload-run-start")
        #expect(requests[2].payload["manifest"]?.objectValue?["mode"]?.stringValue == "asset-upload-run-status")
        #expect(requests[3].payload["manifest"]?.objectValue?["mode"]?.stringValue == "r2-reconciliation-plan")
        #expect(requests[4].payload["manifest"]?.objectValue?["mode"]?.stringValue == "photos-sync-run")
        #expect(requests[4].payload["manifest"]?.objectValue?["limit"]?.intValue == 25)
    }

    @Test("Native long-running publication operations expose checkpointed cancellation")
    func nativePublicationCancellationContracts() async throws {
        func action(_ id: String, _ result: [String: JSONValue]) -> OwnerAction {
            OwnerAction(
                id: id,
                actionKind: "sidecar-culling-review",
                target: "max",
                state: .completed,
                result: result
            )
        }
        let responses: [OwnerAction] = [
            action("upload-cancel", ["uploadRun": [
                "runId": "uplrun-1", "status": "running", "requested": 2,
                "processed": 1, "remaining": 1, "cancelRequested": true,
            ]]),
            action("photos-start", ["photosSync": [
                "runId": "photos-sync-1", "status": "running", "stage": "Reading metadata",
                "requested": 25, "scanned": 0, "remaining": 25,
            ]]),
            action("photos-status", ["photosSync": [
                "runId": "photos-sync-1", "status": "running", "stage": "Classifying changes",
                "requested": 25, "scanned": 12, "remaining": 13,
            ]]),
            action("photos-cancel", ["photosSync": [
                "runId": "photos-sync-1", "status": "cancelled", "stage": "Stopped safely",
                "requested": 25, "scanned": 12, "remaining": 13, "cancelRequested": true,
            ]]),
            action("r2-start", ["reconciliation": [
                "runId": "r2rec-1", "mode": "commit", "status": "running", "stage": "Queued",
                "requested": 10, "scanned": 0, "remaining": 10,
            ]]),
            action("r2-status", ["reconciliation": [
                "runId": "r2rec-1", "mode": "commit", "status": "running", "stage": "Checking object 4 of 10",
                "requested": 10, "scanned": 4, "remaining": 6,
            ]]),
            action("r2-cancel", ["reconciliation": [
                "runId": "r2rec-1", "mode": "commit", "status": "cancelled", "stage": "Stopped safely",
                "requested": 10, "scanned": 4, "remaining": 6, "cancelRequested": true,
            ]]),
        ]
        let api = ScriptedOwnerActionAPI(completed: responses)
        let service = FixtureDeliveryService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let upload = try await service.cancelNativeUpload(runID: "uplrun-1")
        #expect(upload.cancelRequested)
        let photosStart = try await service.startPhotosSync(limit: 25)
        let photosStatus = try await service.photosSyncStatus(runID: photosStart.runID)
        let photosStopped = try await service.cancelPhotosSync(runID: photosStart.runID)
        #expect(photosStatus.stage == "Classifying changes")
        #expect(photosStopped.isFinished)
        #expect(photosStopped.remaining == 13)
        let r2Start = try await service.startR2Reconciliation(commit: true)
        let r2Status = try await service.r2ReconciliationStatus(runID: r2Start.runID)
        let r2Stopped = try await service.cancelR2Reconciliation(runID: r2Start.runID)
        #expect(r2Status.scanned == 4)
        #expect(r2Stopped.isFinished)
        #expect(r2Stopped.cancelRequested)

        let requests = await api.requests()
        let modes = requests.compactMap {
            $0.payload["manifest"]?.objectValue?["mode"]?.stringValue
        }
        #expect(modes == [
            "asset-upload-run-cancel",
            "photos-sync-run-start",
            "photos-sync-run-status",
            "photos-sync-run-cancel",
            "r2-reconciliation-run-start",
            "r2-reconciliation-run-status",
            "r2-reconciliation-run-cancel",
        ])
    }

    @Test("Review AI requests update the loaded editorial summary")
    func reviewSummaryTracksAIRequestTransition() {
        var summary = FixtureReviewSummary(
            total: 10,
            unreviewed: 8,
            requestingAI: 1,
            proposed: 1,
            approved: 0
        )
        summary.applyEditorialStateTransition(
            from: "unreviewed",
            to: "requesting-ai"
        )
        #expect(summary.total == 10)
        #expect(summary.unreviewed == 7)
        #expect(summary.requestingAI == 2)
        #expect(summary.proposed == 1)
        summary.applyEditorialStateTransition(
            from: "requesting-ai",
            to: "requesting-ai"
        )
        #expect(summary.requestingAI == 2)
    }

    @Test("Backstage reports signed Photos helper identity and headless health")
    func signedPhotosBridgeHealth() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-bridge-health-\(UUID().uuidString)")
        let app = root.appendingPathComponent("PhotosByElie Photos Bridge.app")
        let contents = app.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let plist: [String: Any] = [
            "CFBundleIdentifier": "com.photosbyelie.photos-bridge",
            "CFBundleShortVersionString": "148.0",
            "CFBundleVersion": "12",
            "LSUIElement": true,
        ]
        let plistData = try PropertyListSerialization.data(
            fromPropertyList: plist,
            format: .xml,
            options: 0
        )
        try plistData.write(to: contents.appendingPathComponent("Info.plist"))
        let service = PhotosBridgeHealthService(
            appURL: app,
            expectedBundleIdentifier: "com.photosbyelie.photos-bridge",
            expectedVersion: "148.0",
            expectedBuild: "12"
        ) { _, resultURL in
            let result: [String: Any] = [
                "ok": true,
                "headless": true,
                "bundleIdentifier": "com.photosbyelie.photos-bridge",
                "photoAccess": "authorized",
            ]
            let data = try JSONSerialization.data(withJSONObject: result)
            try data.write(to: resultURL)
        }

        let health = await service.probe()
        #expect(health.installed)
        #expect(health.headless)
        #expect(health.bundleIdentifier == "com.photosbyelie.photos-bridge")
        #expect(health.version == "148.0")
        #expect(health.build == "12")
        #expect(health.photoAccess == "authorized")
        #expect(health.compatible)
        #expect(health.message == "Signed helper is compatible and authorized.")
    }

    @Test("Backstage reports a stale Photos helper before mutation")
    func stalePhotosBridgeHealthIsIncompatible() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-bridge-stale-(UUID().uuidString)")
        let app = root.appendingPathComponent("PhotosByElie Photos Bridge.app")
        let contents = app.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let plist: [String: Any] = [
            "CFBundleIdentifier": "com.photosbyelie.photos-bridge",
            "CFBundleShortVersionString": "141.10",
            "CFBundleVersion": "1",
            "LSUIElement": true,
        ]
        let plistData = try PropertyListSerialization.data(
            fromPropertyList: plist,
            format: .xml,
            options: 0
        )
        try plistData.write(to: contents.appendingPathComponent("Info.plist"))
        let service = PhotosBridgeHealthService(
            appURL: app,
            expectedBundleIdentifier: "com.photosbyelie.photos-bridge",
            expectedVersion: "218.0",
            expectedBuild: "75"
        ) { _, resultURL in
            let result: [String: Any] = [
                "ok": true,
                "headless": true,
                "bundleIdentifier": "com.photosbyelie.photos-bridge",
                "photoAccess": "authorized",
            ]
            let data = try JSONSerialization.data(withJSONObject: result)
            try data.write(to: resultURL)
        }

        let health = await service.probe()
        #expect(!health.compatible)
        #expect(health.photoAccess == "authorized")
        #expect(health.message.contains("incompatible"))
    }

    @Test("Backstage control health stays structured and CUA-free")
    func backstageControlHealthIsMachineReadable() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-control-health-\(UUID().uuidString)")
        let app = root.appendingPathComponent("PhotosByElie Photos Bridge.app")
        let contents = app.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let plist: [String: Any] = [
            "CFBundleIdentifier": "com.photosbyelie.photos-bridge",
            "CFBundleShortVersionString": "218.0",
            "CFBundleVersion": "75",
            "LSUIElement": true,
        ]
        let plistData = try PropertyListSerialization.data(
            fromPropertyList: plist,
            format: .xml,
            options: 0
        )
        try plistData.write(to: contents.appendingPathComponent("Info.plist"))
        let bridge = PhotosBridgeHealthService(
            appURL: app,
            expectedBundleIdentifier: "com.photosbyelie.photos-bridge",
            expectedVersion: "218.0",
            expectedBuild: "75"
        ) { _, resultURL in
            let result: [String: Any] = [
                "ok": true,
                "headless": true,
                "bundleIdentifier": "com.photosbyelie.photos-bridge",
                "photoAccess": "authorized",
            ]
            let data = try JSONSerialization.data(withJSONObject: result)
            try data.write(to: resultURL)
        }
        let release = BackstageReleaseIdentity(
            bundleIdentifier: "com.photosbyelie.backstage",
            version: "218.0",
            build: "75",
            helperBundleIdentifier: "com.photosbyelie.photos-bridge",
            helperVersion: "218.0",
            helperBuild: "75"
        )
        let service = BackstageControlService(
            release: release,
            photosBridge: bridge,
            photoLibrary: StaticPhotoLibrary(access: .notDetermined),
            connectorIdentity: StaticOwnerConnectorIdentity("max"),
            authenticationSnapshot: {
                OwnerAuthenticationSnapshot(
                    phase: .authenticated,
                    deviceId: "owner-device-test"
                )
            }
        )

        let health = await service.health(command: "release verify")
        #expect(health.ok)
        #expect(health.command == "release verify")
        #expect(health.release.helperBuild == "75")
        #expect(health.helper.compatible)
        #expect(health.photoLibraryAccess == "not_determined")
        #expect(health.ownerAuthenticated)
        #expect(health.connectorID == "max")
        #expect(health.message == "Backstage release and Photos Bridge helper are compatible.")

        let photosHealth = await service.health(command: "photos health")
        #expect(!photosHealth.ok)
        #expect(photosHealth.message.contains("not_determined"))

        let encoded = try JSONEncoder.ownerAPI.encode(health)
        let decoded = try JSONDecoder.ownerAPI.decode(BackstageControlHealth.self, from: encoded)
        #expect(decoded.schemaVersion == health.schemaVersion)
        #expect(decoded.command == health.command)
        #expect(abs(decoded.checkedAt.timeIntervalSince(health.checkedAt)) < 1)
        #expect(decoded.ok == health.ok)
        #expect(decoded.release == health.release)
        #expect(decoded.helper == health.helper)
        #expect(decoded.photoLibraryAccess == health.photoLibraryAccess)
        #expect(decoded.ownerSession == health.ownerSession)
        #expect(decoded.ownerAuthenticated == health.ownerAuthenticated)
        #expect(decoded.connectorID == health.connectorID)
        #expect(decoded.message == health.message)
    }

    @Test("Backstage CLI runs an Owner-authenticated originals preflight without CUA")
    func backstageControlRunsRealEstateOriginalsPreflight() async throws {
        let itemsURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-originals-preflight-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: itemsURL) }
        let expectedItem = RealEstateOriginalsPreflightRequest.Item(
            photoId: "corine-re-2026-la-concha-1-apt-8ab1-d5h-3043",
            albumSlug: "re-2026-la-concha-1-apt-8ab1",
            sourceFile: "D5H_3043.JPG",
            title: "La Concha 1 Apt 8AB1 - 01",
            sortIndex: 1
        )
        try JSONEncoder.ownerAPI.encode([expectedItem]).write(to: itemsURL)

        let expectedReport = RealEstateOriginalsPreflight(
            checkedAt: "2026-08-07T10:00:00.000Z",
            ok: true,
            galleryKey: "corine-real-estate",
            requestedCount: 1,
            availableCount: 1,
            missingCount: 0,
            totalBytes: 1234,
            items: [.init(
                photoId: expectedItem.photoId,
                name: "001-La-Concha-D5H_3043.JPG",
                contentType: "image/jpeg",
                available: true,
                bytes: 1234
            )],
            message: "Selected originals are available for an authorized download session."
        )
        let service = BackstageControlService(realEstateOriginalsPreflight: { request in
            guard request.galleryKey == "corine-real-estate",
                  request.items == [expectedItem] else {
                throw APIErrorEnvelope(error: .init(
                    code: "unexpected_request",
                    message: "The CLI request did not match the items file."
                ))
            }
            return RealEstateOriginalsPreflightEnvelope(preflight: expectedReport)
        })
        let output = LockedStringOutput()

        let exitCode = await BackstageControlCLI.run(
            arguments: [
                "real-estate", "originals", "preflight",
                "--gallery", "corine-real-estate",
                "--items-file", itemsURL.path,
            ],
            service: service,
            output: { output.append($0) }
        )

        #expect(exitCode == 0)
        let payload = try #require(output.values().last)
        let decoded = try JSONDecoder.ownerAPI.decode(
            RealEstateOriginalsPreflight.self,
            from: Data(payload.utf8)
        )
        #expect(decoded == expectedReport)
        #expect(decoded.mode == "read-only")
    }

    @Test("Backstage CLI uses stable exit codes for unavailable originals and invalid arguments")
    func backstageControlPreflightExitCodesAreStable() async throws {
        let itemsURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-originals-preflight-missing-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: itemsURL) }
        let item = RealEstateOriginalsPreflightRequest.Item(
            photoId: "corine-re-2026-la-concha-missing",
            albumSlug: "re-2026-la-concha-1-apt-8ab1"
        )
        try JSONEncoder.ownerAPI.encode([item]).write(to: itemsURL)
        let report = RealEstateOriginalsPreflight(
            checkedAt: "2026-08-07T10:00:00.000Z",
            ok: false,
            galleryKey: "corine-real-estate",
            requestedCount: 1,
            availableCount: 0,
            missingCount: 1,
            totalBytes: 0,
            items: [.init(
                photoId: item.photoId,
                name: "001-missing.jpg",
                contentType: "image/jpeg",
                available: false
            )],
            message: "1 selected original is not ready in private storage."
        )
        let service = BackstageControlService(realEstateOriginalsPreflight: { _ in
            RealEstateOriginalsPreflightEnvelope(preflight: report)
        })

        let missingExitCode = await BackstageControlCLI.run(
            arguments: [
                "real-estate", "originals", "preflight",
                "--gallery", "corine-real-estate",
                "--items-file", itemsURL.path,
            ],
            service: service,
            output: { _ in }
        )
        #expect(missingExitCode == 2)

        let output = LockedStringOutput()
        let invalidExitCode = await BackstageControlCLI.run(
            arguments: ["real-estate", "originals", "preflight", "--gallery", "corine-real-estate"],
            service: service,
            output: { output.append($0) }
        )
        #expect(invalidExitCode == 64)
        let payload = try #require(output.values().last)
        #expect(payload.contains("invalid_arguments"))
        #expect(payload.contains("--items-file"))
    }
}

private final class LockedStringOutput: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func append(_ value: String) {
        lock.withLock { storage.append(value) }
    }

    func values() -> [String] {
        lock.withLock { storage }
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

private struct StaticPhotoLibrary: PhotoLibraryServing {
    let access: PhotoLibraryAccess

    func authorization() -> PhotoLibraryAccess { access }

    func requestAuthorization() async -> PhotoLibraryAccess { access }

    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }
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

private struct SequencedTransportResponse: Sendable {
    let status: Int
    let body: String
}

private actor SequencedRoutingTransport: OwnerAPITransport {
    private var responses: [String: [SequencedTransportResponse]]
    private var recorded: [URLRequest] = []

    init(responses: [String: [SequencedTransportResponse]]) {
        self.responses = responses
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        recorded.append(request)
        let path = request.url?.path ?? ""
        guard var routeResponses = responses[path], !routeResponses.isEmpty else {
            throw URLError(.resourceUnavailable)
        }
        let response = routeResponses.removeFirst()
        responses[path] = routeResponses
        return (
            Data(response.body.utf8),
            HTTPURLResponse(url: request.url!, statusCode: response.status, httpVersion: nil, headerFields: nil)!
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
