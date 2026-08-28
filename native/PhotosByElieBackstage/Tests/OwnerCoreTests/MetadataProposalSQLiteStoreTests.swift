import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("Metadata model ladder SQLite reads")
struct MetadataModelLadderSQLiteStoreTests {
    @Test("Saved Metadata model ladder comes from Owner.sqlite")
    func readsSavedModelLadder() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("metadata-ladder-sqlite-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try seedMetadataModelLadderDatabase(at: databaseURL, value: #"[{"model":"gpt-5.4-mini","effort":"low","vision":true},{"model":"gpt-5.6-sol","effort":"high","vision":true}]"#)

        let ladder = try MetadataModelLadderSQLiteStore(databaseURL: databaseURL).modelLadder()

        #expect(ladder == [
            MetadataModelLadderRung(model: "gpt-5.4-mini", effort: "low"),
            MetadataModelLadderRung(model: "gpt-5.6-sol", effort: "high"),
        ])
    }

    @Test("Missing or malformed saved ladder uses the supported default")
    func invalidSavedLadderUsesDefault() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("metadata-ladder-default-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try seedMetadataModelLadderDatabase(at: databaseURL, value: "not-json")

        let ladder = try MetadataModelLadderSQLiteStore(databaseURL: databaseURL).modelLadder()

        #expect(ladder == MetadataModelLadderRung.defaultLadder)
    }

    @Test("Missing Metadata database fails closed")
    func missingDatabaseFailsClosed() {
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent("missing-metadata-\(UUID().uuidString).sqlite")
        #expect(throws: APIErrorEnvelope.self) {
            try MetadataModelLadderSQLiteStore(databaseURL: missing).modelLadder()
        }
    }

    @Test("Loading the ladder preserves historical proposal rows")
    func preservesHistoricalProposalRows() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("metadata-ladder-history-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try seedMetadataModelLadderDatabase(
            at: databaseURL,
            value: #"[{"model":"gpt-5.4-mini","effort":"low","vision":true}]"#
        )
        try execute(
            """
            CREATE TABLE title_keyword_queue(
              media_id TEXT PRIMARY KEY,
              review_state TEXT NOT NULL,
              latest_attempt INTEGER NOT NULL
            );
            CREATE TABLE title_keyword_proposals(
              media_id TEXT NOT NULL,
              attempt INTEGER NOT NULL,
              proposed_title TEXT,
              PRIMARY KEY(media_id, attempt)
            );
            INSERT INTO title_keyword_queue(media_id, review_state, latest_attempt)
            VALUES('historical-asset', 'rejected', 3);
            INSERT INTO title_keyword_proposals(media_id, attempt, proposed_title)
            VALUES('historical-asset', 3, 'Retained proposal');
            """,
            at: databaseURL
        )
        let before = try Data(contentsOf: databaseURL)

        _ = try MetadataModelLadderSQLiteStore(databaseURL: databaseURL).modelLadder()

        #expect(try Data(contentsOf: databaseURL) == before)
    }
}

private func execute(_ sql: String, at url: URL) throws {
    var database: OpaquePointer?
    guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else {
        throw OwnerDatabaseError.unavailable("test database unavailable")
    }
    defer { sqlite3_close(database) }
    guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
        throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
    }
}

private func seedMetadataModelLadderDatabase(at url: URL, value: String) throws {
    var database: OpaquePointer?
    guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else {
        throw OwnerDatabaseError.unavailable("test database unavailable")
    }
    defer { sqlite3_close(database) }
    guard sqlite3_exec(
        database,
        "CREATE TABLE owner_settings(setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)",
        nil,
        nil,
        nil
    ) == SQLITE_OK else {
        throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
    }

    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(
        database,
        "INSERT INTO owner_settings(setting_key, setting_value) VALUES('title_keyword_model_ladder_json', ?)",
        -1,
        &statement,
        nil
    ) == SQLITE_OK, let statement else {
        throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
    }
    defer { sqlite3_finalize(statement) }
    let result = value.withCString { pointer in
        sqlite3_bind_text(statement, 1, pointer, -1, nil)
        return sqlite3_step(statement)
    }
    guard result == SQLITE_DONE else {
        throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
    }
}
