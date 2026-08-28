import Foundation
import SQLite3

public protocol OwnerCurrentImageSizeCaching: Sendable {
    func values(assetIDs: [String]) throws -> [String: Int64]
    func upsert(_ values: [String: Int64], updatedAt: Date) throws
}

/// A mutable cache of byte counts learned from complete current-image data
/// already delivered by Apple Photos. It is intentionally separate from the
/// immutable original-source metadata in `sidecar_assets.raw_json`.
public struct OwnerCurrentImageSizeSQLiteStore: OwnerCurrentImageSizeCaching, Sendable {
    private let databaseURL: URL
    private let busyTimeoutMilliseconds: Int32

    public init(databaseURL: URL, busyTimeoutMilliseconds: Int32 = 1_000) {
        self.databaseURL = databaseURL.standardizedFileURL
        self.busyTimeoutMilliseconds = busyTimeoutMilliseconds
    }

    public func values(assetIDs: [String]) throws -> [String: Int64] {
        let ids = normalizedIDs(assetIDs)
        guard !ids.isEmpty else { return [:] }
        let database = try open(flags: SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX)
        defer { sqlite3_close_v2(database) }
        guard try tableExists(database) else { return [:] }

        let placeholders = Array(repeating: "?", count: ids.count).joined(separator: ",")
        let sql = """
        SELECT asset_id, current_image_byte_count
        FROM asset_current_image_sizes
        WHERE asset_id IN (\(placeholders))
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw error(database, "Could not prepare the current-image size lookup.")
        }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (index, id) in ids.enumerated() {
            _ = id.withCString {
                sqlite3_bind_text(statement, Int32(index + 1), $0, -1, transient)
            }
        }

        var result: [String: Int64] = [:]
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                let assetID = sqlite3_column_text(statement, 0).map(String.init(cString:)) ?? ""
                let byteCount = sqlite3_column_int64(statement, 1)
                if !assetID.isEmpty, byteCount > 0 {
                    result[assetID] = byteCount
                }
            case SQLITE_DONE:
                return result
            default:
                throw error(database, "Could not read current-image sizes.")
            }
        }
    }

    public func upsert(_ values: [String: Int64], updatedAt: Date = Date()) throws {
        let validValues = Dictionary(uniqueKeysWithValues: values.compactMap { assetID, byteCount in
            let id = assetID.trimmingCharacters(in: .whitespacesAndNewlines)
            return id.isEmpty || byteCount <= 0 ? nil : (id, byteCount)
        })
        guard !validValues.isEmpty else { return }
        let database = try open(flags: SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX)
        defer { sqlite3_close_v2(database) }

        try execute("BEGIN IMMEDIATE TRANSACTION", on: database)
        var transactionOpen = true
        defer {
            if transactionOpen { sqlite3_exec(database, "ROLLBACK", nil, nil, nil) }
        }
        try execute(
            """
            CREATE TABLE IF NOT EXISTS asset_current_image_sizes (
              asset_id TEXT PRIMARY KEY NOT NULL,
              current_image_byte_count INTEGER NOT NULL CHECK(current_image_byte_count > 0),
              updated_at TEXT NOT NULL
            )
            """,
            on: database
        )
        var statement: OpaquePointer?
        let sql = """
        INSERT INTO asset_current_image_sizes(asset_id, current_image_byte_count, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          current_image_byte_count = excluded.current_image_byte_count,
          updated_at = excluded.updated_at
        """
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw error(database, "Could not prepare the current-image size update.")
        }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        let timestamp = ISO8601DateFormatter().string(from: updatedAt)
        for (assetID, byteCount) in validValues.sorted(by: { $0.key < $1.key }) {
            sqlite3_reset(statement)
            sqlite3_clear_bindings(statement)
            _ = assetID.withCString { sqlite3_bind_text(statement, 1, $0, -1, transient) }
            sqlite3_bind_int64(statement, 2, byteCount)
            _ = timestamp.withCString { sqlite3_bind_text(statement, 3, $0, -1, transient) }
            guard sqlite3_step(statement) == SQLITE_DONE else {
                throw error(database, "Could not update a current-image size.")
            }
        }
        try execute("COMMIT", on: database)
        transactionOpen = false
    }

    private func normalizedIDs(_ values: [String]) -> [String] {
        Array(Set(values.map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty })).sorted()
    }

    private func open(flags: Int32) throws -> OpaquePointer {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw OwnerDatabaseError.unavailable("Owner.sqlite is unavailable for current-image sizes.")
        }
        var database: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &database, flags, nil) == SQLITE_OK,
              let database else {
            if let database { sqlite3_close_v2(database) }
            throw OwnerDatabaseError.unavailable("Could not open Owner.sqlite for current-image sizes.")
        }
        sqlite3_busy_timeout(database, busyTimeoutMilliseconds)
        return database
    }

    private func tableExists(_ database: OpaquePointer) throws -> Bool {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(
            database,
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'asset_current_image_sizes'",
            -1,
            &statement,
            nil
        ) == SQLITE_OK, let statement else {
            throw error(database, "Could not inspect the current-image size cache.")
        }
        defer { sqlite3_finalize(statement) }
        return sqlite3_step(statement) == SQLITE_ROW
    }

    private func execute(_ sql: String, on database: OpaquePointer) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw error(database, "Could not update the current-image size cache.")
        }
    }

    private func error(_ database: OpaquePointer?, _ fallback: String) -> OwnerDatabaseError {
        guard let database else { return .unavailable(fallback) }
        let message = String(cString: sqlite3_errmsg(database))
        return .unavailable(message.isEmpty ? fallback : message)
    }
}
