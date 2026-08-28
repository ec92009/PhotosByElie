import Foundation
import SQLite3
import Testing
@testable import OwnerCore

private actor RejectingFixtureActionAPI: OwnerActionServing {
    private var createCount = 0

    func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String
    ) async throws -> OwnerActionEnvelope {
        createCount += 1
        throw APIErrorEnvelope(error: .init(
            code: "unexpected_cloud_action",
            message: "The native fixture tree must not create a cloud action."
        ))
    }

    func getAction(id: String) async throws -> OwnerAction {
        throw APIErrorEnvelope(error: .init(
            code: "unexpected_cloud_action",
            message: "The native fixture tree must not poll a cloud action."
        ))
    }

    func createdActions() -> Int { createCount }
}

private struct RejectingFixtureWaker: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? {
        throw APIErrorEnvelope(error: .init(
            code: "unexpected_connector_wake",
            message: "The native fixture tree must not wake the connector."
        ))
    }
}

@Suite("Native fixture tree")
struct OwnerFixtureSQLiteStoreTests {
    @Test("Fixture hierarchy reads directly from Owner SQLite")
    func fixtureHierarchyUsesNativeSQLite() async throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pbe-native-fixtures-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: temporary,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: temporary) }
        let databaseURL = temporary.appendingPathComponent("Owner.sqlite")
        try createFixtureDatabase(at: databaseURL)

        let api = RejectingFixtureActionAPI()
        let service = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: api,
                waker: RejectingFixtureWaker(),
                pollInterval: .milliseconds(1),
                timeout: .milliseconds(10)
            ),
            localReviewService: LocalFixtureReviewService(
                nativeDatabaseURL: databaseURL
            )
        )

        let tree = try await service.tree(includeArchived: true)

        #expect(tree.map(\.id) == ["fixture-expo", "fixture-travel"])
        #expect(tree[0].name == "Expo")
        #expect(tree[0].templateKey == "expo")
        #expect(tree[0].tags == ["public"])
        #expect(tree[1].children.map(\.id) == ["fixture-paris"])
        #expect(tree[1].children[0].state == "archived")
        #expect(await api.createdActions() == 0)

        let activeTree = try await service.tree(includeArchived: false)
        #expect(activeTree[1].children.isEmpty)
        #expect(await api.createdActions() == 0)
    }

    private func createFixtureDatabase(at url: URL) throws {
        var database: OpaquePointer?
        guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else {
            throw APIErrorEnvelope(error: .init(
                code: "test_database_unavailable",
                message: "Could not create the fixture test database."
            ))
        }
        defer { sqlite3_close(database) }
        let sql = """
        CREATE TABLE fixtures (
          fixture_id TEXT PRIMARY KEY,
          parent_fixture_id TEXT,
          name TEXT NOT NULL,
          template_key TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          archived_at TEXT
        );
        INSERT INTO fixtures VALUES
          ('fixture-travel', NULL, 'Travel', NULL, '[]', NULL),
          ('fixture-paris', 'fixture-travel', 'Paris', NULL, '["travel"]', '2026-08-22T00:00:00Z'),
          ('fixture-expo', NULL, 'Expo', 'expo', '["public"]', NULL);
        """
        var errorMessage: UnsafeMutablePointer<CChar>?
        let result = sqlite3_exec(database, sql, nil, nil, &errorMessage)
        guard result == SQLITE_OK else {
            let message = errorMessage.map { String(cString: $0) } ?? "SQLite setup failed."
            sqlite3_free(errorMessage)
            throw APIErrorEnvelope(error: .init(
                code: "test_database_unavailable",
                message: message
            ))
        }
    }
}
