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
            expectedCurrentVersion: 1
        )
        #expect(FileManager.default.fileExists(atPath: backup.path))
        #expect(try gate.inspect().schemaVersion == 2)
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
