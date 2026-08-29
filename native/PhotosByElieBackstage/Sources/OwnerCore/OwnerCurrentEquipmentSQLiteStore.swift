import Foundation
import SQLite3

public struct OwnerCurrentEquipment: Sendable, Equatable {
    public var cameraBody: String
    public var lens: String
    public var focalLength: String

    public init(cameraBody: String = "", lens: String = "", focalLength: String = "") {
        self.cameraBody = cameraBody
        self.lens = lens
        self.focalLength = focalLength
    }

    var isEmpty: Bool {
        cameraBody.isEmpty && lens.isEmpty && focalLength.isEmpty
    }
}

public protocol OwnerCurrentEquipmentCaching: Sendable {
    func values(assetIDs: [String]) throws -> [String: OwnerCurrentEquipment]
    func upsert(_ values: [String: OwnerCurrentEquipment], updatedAt: Date) throws
}

/// A mutable cache of equipment learned from complete current-image data
/// already delivered by Apple Photos. It remains separate from immutable
/// original-source metadata in `sidecar_assets.raw_json`.
public struct OwnerCurrentEquipmentSQLiteStore: OwnerCurrentEquipmentCaching, Sendable {
    private let databaseURL: URL
    private let busyTimeoutMilliseconds: Int32

    public init(databaseURL: URL, busyTimeoutMilliseconds: Int32 = 1_000) {
        self.databaseURL = databaseURL.standardizedFileURL
        self.busyTimeoutMilliseconds = busyTimeoutMilliseconds
    }

    public func values(assetIDs: [String]) throws -> [String: OwnerCurrentEquipment] {
        let ids = normalizedIDs(assetIDs)
        guard !ids.isEmpty else { return [:] }
        let database = try open(flags: SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX)
        defer { sqlite3_close_v2(database) }
        guard try tableExists(database) else { return [:] }

        let placeholders = Array(repeating: "?", count: ids.count).joined(separator: ",")
        let sql = """
        SELECT asset_id, camera_body, lens, focal_length
        FROM asset_current_equipment
        WHERE asset_id IN (\(placeholders))
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw error(database, "Could not prepare the current-equipment lookup.")
        }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (index, id) in ids.enumerated() {
            _ = id.withCString {
                sqlite3_bind_text(statement, Int32(index + 1), $0, -1, transient)
            }
        }

        var result: [String: OwnerCurrentEquipment] = [:]
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                let assetID = string(statement, column: 0)
                let equipment = OwnerCurrentEquipment(
                    cameraBody: string(statement, column: 1),
                    lens: string(statement, column: 2),
                    focalLength: string(statement, column: 3)
                )
                if !assetID.isEmpty, !equipment.isEmpty {
                    result[assetID] = equipment
                }
            case SQLITE_DONE:
                return result
            default:
                throw error(database, "Could not read current equipment.")
            }
        }
    }

    public func upsert(
        _ values: [String: OwnerCurrentEquipment],
        updatedAt: Date = Date()
    ) throws {
        let validValues = Dictionary(uniqueKeysWithValues: values.compactMap { assetID, equipment in
            let id = normalize(assetID)
            let normalized = OwnerCurrentEquipment(
                cameraBody: normalize(equipment.cameraBody),
                lens: normalize(equipment.lens),
                focalLength: normalize(equipment.focalLength)
            )
            return id.isEmpty || normalized.isEmpty ? nil : (id, normalized)
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
            CREATE TABLE IF NOT EXISTS asset_current_equipment (
              asset_id TEXT PRIMARY KEY NOT NULL,
              camera_body TEXT NOT NULL DEFAULT '',
              lens TEXT NOT NULL DEFAULT '',
              focal_length TEXT NOT NULL DEFAULT '',
              updated_at TEXT NOT NULL
            )
            """,
            on: database
        )
        var statement: OpaquePointer?
        let sql = """
        INSERT INTO asset_current_equipment(asset_id, camera_body, lens, focal_length, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          camera_body = CASE
            WHEN trim(excluded.camera_body) <> '' THEN excluded.camera_body
            ELSE asset_current_equipment.camera_body
          END,
          lens = CASE
            WHEN trim(excluded.lens) <> '' THEN excluded.lens
            ELSE asset_current_equipment.lens
          END,
          focal_length = CASE
            WHEN trim(excluded.focal_length) <> '' THEN excluded.focal_length
            ELSE asset_current_equipment.focal_length
          END,
          updated_at = excluded.updated_at
        """
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw error(database, "Could not prepare the current-equipment update.")
        }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        let timestamp = ISO8601DateFormatter().string(from: updatedAt)
        for (assetID, equipment) in validValues.sorted(by: { $0.key < $1.key }) {
            sqlite3_reset(statement)
            sqlite3_clear_bindings(statement)
            bind(assetID, to: 1, in: statement, transient: transient)
            bind(equipment.cameraBody, to: 2, in: statement, transient: transient)
            bind(equipment.lens, to: 3, in: statement, transient: transient)
            bind(equipment.focalLength, to: 4, in: statement, transient: transient)
            bind(timestamp, to: 5, in: statement, transient: transient)
            guard sqlite3_step(statement) == SQLITE_DONE else {
                throw error(database, "Could not update current equipment.")
            }
        }
        try execute("COMMIT", on: database)
        transactionOpen = false
    }

    private func normalizedIDs(_ values: [String]) -> [String] {
        Array(Set(values.map(normalize).filter { !$0.isEmpty })).sorted()
    }

    private func normalize(_ value: String) -> String {
        value.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    private func string(_ statement: OpaquePointer, column: Int32) -> String {
        sqlite3_column_text(statement, column).map(String.init(cString:)) ?? ""
    }

    private func bind(
        _ value: String,
        to index: Int32,
        in statement: OpaquePointer,
        transient: sqlite3_destructor_type
    ) {
        _ = value.withCString { sqlite3_bind_text(statement, index, $0, -1, transient) }
    }

    private func open(flags: Int32) throws -> OpaquePointer {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw OwnerDatabaseError.unavailable("Owner.sqlite is unavailable for current equipment.")
        }
        var database: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &database, flags, nil) == SQLITE_OK,
              let database else {
            if let database { sqlite3_close_v2(database) }
            throw OwnerDatabaseError.unavailable("Could not open Owner.sqlite for current equipment.")
        }
        sqlite3_busy_timeout(database, busyTimeoutMilliseconds)
        return database
    }

    private func tableExists(_ database: OpaquePointer) throws -> Bool {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(
            database,
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'asset_current_equipment'",
            -1,
            &statement,
            nil
        ) == SQLITE_OK, let statement else {
            throw error(database, "Could not inspect the current-equipment cache.")
        }
        defer { sqlite3_finalize(statement) }
        return sqlite3_step(statement) == SQLITE_ROW
    }

    private func execute(_ sql: String, on database: OpaquePointer) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw error(database, "Could not update the current-equipment cache.")
        }
    }

    private func error(_ database: OpaquePointer?, _ fallback: String) -> OwnerDatabaseError {
        guard let database else { return .unavailable(fallback) }
        let message = String(cString: sqlite3_errmsg(database))
        return .unavailable(message.isEmpty ? fallback : message)
    }
}
