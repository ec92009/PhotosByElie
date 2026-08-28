import Foundation
import SQLite3

/// Reads only the saved AI model ladder from authoritative Owner.sqlite.
/// Historical proposal rows remain retained in SQLite but are no longer a
/// user-facing Metadata workflow.
public struct MetadataModelLadderSQLiteStore: Sendable {
    private let databaseURL: URL

    public init(databaseURL: URL) {
        self.databaseURL = databaseURL.standardizedFileURL
    }

    public func modelLadder() throws -> [MetadataModelLadderRung] {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw APIErrorEnvelope(error: .init(
                code: "native_metadata_database_missing",
                message: "Backstage could not find the native Metadata database."
            ))
        }

        var database: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &database,
            SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let database else {
            if let database {
                sqlite3_close_v2(database)
            }
            throw sqliteError(database, code: "native_metadata_database_open_failed")
        }
        defer { sqlite3_close_v2(database) }
        sqlite3_busy_timeout(database, 1_000)

        let sql = """
        SELECT setting_value
        FROM owner_settings
        WHERE setting_key = 'title_keyword_model_ladder_json'
        LIMIT 1
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw sqliteError(database, code: "native_metadata_ladder_query_failed")
        }
        defer { sqlite3_finalize(statement) }

        let stepResult = sqlite3_step(statement)
        if stepResult == SQLITE_DONE {
            return MetadataModelLadderRung.defaultLadder
        }
        guard stepResult == SQLITE_ROW else {
            throw sqliteError(database, code: "native_metadata_ladder_query_failed")
        }
        guard let value = sqlite3_column_text(statement, 0),
              let data = String(cString: value).data(using: .utf8),
              let ladder = try? JSONDecoder().decode([MetadataModelLadderRung].self, from: data),
              !ladder.isEmpty else {
            return MetadataModelLadderRung.defaultLadder
        }
        return ladder
    }

    private func sqliteError(_ database: OpaquePointer?, code: String) -> APIErrorEnvelope {
        APIErrorEnvelope(error: .init(
            code: code,
            message: database.map { String(cString: sqlite3_errmsg($0)) }
                ?? "Backstage could not read Owner.sqlite."
        ))
    }
}
