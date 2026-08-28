import Foundation
import SQLite3

public struct OwnerFixtureSQLiteStore: Sendable {
    private struct Row: Sendable {
        var id: String
        var parentID: String
        var name: String
        var state: String
        var templateKey: String
        var tags: [String]
    }

    private let databaseURL: URL
    private let busyTimeoutMilliseconds: Int32

    public init(
        databaseURL: URL,
        busyTimeoutMilliseconds: Int32 = 1_000
    ) {
        self.databaseURL = databaseURL.standardizedFileURL
        self.busyTimeoutMilliseconds = busyTimeoutMilliseconds
    }

    public func tree(includeArchived: Bool = true) throws -> [FixtureNode] {
        let rows = try readRows(includeArchived: includeArchived)
        var rowsByParent: [String: [Row]] = [:]
        for row in rows {
            rowsByParent[row.parentID, default: []].append(row)
        }

        func attach(_ row: Row, ancestors: Set<String>) throws -> FixtureNode {
            guard !ancestors.contains(row.id) else {
                throw databaseError("The fixture tree contains a cycle.")
            }
            var nextAncestors = ancestors
            nextAncestors.insert(row.id)
            return FixtureNode(
                id: row.id,
                name: row.name,
                parentID: row.parentID.isEmpty ? nil : row.parentID,
                state: row.state,
                templateKey: row.templateKey,
                tags: row.tags,
                children: try rowsByParent[row.id, default: []].map {
                    try attach($0, ancestors: nextAncestors)
                }
            )
        }

        return try rowsByParent["", default: []].map {
            try attach($0, ancestors: [])
        }
    }

    private func readRows(includeArchived: Bool) throws -> [Row] {
        var database: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &database,
            SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let database else {
            throw databaseError(String(cString: sqlite3_errstr(openResult)))
        }
        defer { sqlite3_close(database) }
        sqlite3_busy_timeout(database, busyTimeoutMilliseconds)

        let archivedPredicate = includeArchived ? "" : "WHERE archived_at IS NULL"
        let sql = """
        SELECT fixture_id, parent_fixture_id, name, template_key, tags_json, archived_at
        FROM fixtures
        \(archivedPredicate)
        ORDER BY name COLLATE NOCASE
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw databaseError(String(cString: sqlite3_errmsg(database)))
        }
        defer { sqlite3_finalize(statement) }

        var rows: [Row] = []
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                let id = text(statement, column: 0)
                let name = text(statement, column: 2)
                guard !id.isEmpty, !name.isEmpty else {
                    throw databaseError("The fixture tree contains an invalid row.")
                }
                let tagsData = Data(text(statement, column: 4).utf8)
                guard let tags = try JSONSerialization.jsonObject(with: tagsData) as? [String] else {
                    throw databaseError("The fixture tree contains invalid tags.")
                }
                rows.append(Row(
                    id: id,
                    parentID: text(statement, column: 1),
                    name: name,
                    state: text(statement, column: 5).isEmpty ? "active" : "archived",
                    templateKey: text(statement, column: 3),
                    tags: tags
                ))
            case SQLITE_DONE:
                return rows
            default:
                throw databaseError(String(cString: sqlite3_errmsg(database)))
            }
        }
    }

    private func text(_ statement: OpaquePointer, column: Int32) -> String {
        guard let value = sqlite3_column_text(statement, column) else { return "" }
        return String(cString: value)
    }

    private func databaseError(_ message: String) -> APIErrorEnvelope {
        APIErrorEnvelope(error: .init(
            code: "native_fixture_database_unavailable",
            message: message
        ))
    }
}
