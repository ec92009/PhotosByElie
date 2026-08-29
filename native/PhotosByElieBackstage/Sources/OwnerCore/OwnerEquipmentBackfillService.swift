import Foundation
import SQLite3

public struct OwnerEquipmentBackfillCandidate: Sendable, Equatable {
    public var assetID: String
    public var photoLibraryIdentifier: String

    public init(assetID: String, photoLibraryIdentifier: String) {
        self.assetID = assetID
        self.photoLibraryIdentifier = photoLibraryIdentifier
    }
}

public struct OwnerEquipmentBackfillReport: Sendable, Equatable {
    public var eligible: Int
    public var updated: Int
    public var skipped: Int
    public var unavailable: Int
    public var failed: Int
    public var remaining: Int
    public var processedThisPass: Int

    public init(
        eligible: Int = 0,
        updated: Int = 0,
        skipped: Int = 0,
        unavailable: Int = 0,
        failed: Int = 0,
        remaining: Int = 0,
        processedThisPass: Int = 0
    ) {
        self.eligible = eligible
        self.updated = updated
        self.skipped = skipped
        self.unavailable = unavailable
        self.failed = failed
        self.remaining = remaining
        self.processedThisPass = processedThisPass
    }
}

/// Durable, fixture-neutral progress for the native PhotoKit equipment backfill.
///
/// Candidate enrollment and result checkpoints live only in Owner.sqlite. The
/// workflow never changes fixture placement, editorial, delivery, or public
/// catalog state.
public struct OwnerEquipmentBackfillSQLiteStore: Sendable {
    private let databaseURL: URL
    private let busyTimeoutMilliseconds: Int32

    public init(databaseURL: URL, busyTimeoutMilliseconds: Int32 = 1_000) {
        self.databaseURL = databaseURL.standardizedFileURL
        self.busyTimeoutMilliseconds = busyTimeoutMilliseconds
    }

    public func enrollCurrentCandidates(now: Date = Date()) throws {
        let database = try open()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        try execute(
            """
            DELETE FROM asset_equipment_backfill_state
            WHERE photo_library_identifier LIKE 'owner://asset/%'
            """,
            on: database
        )
        let timestamp = ISO8601DateFormatter().string(from: now)
        let sql = """
        INSERT OR IGNORE INTO asset_equipment_backfill_state(
          asset_id, photo_library_identifier, status, attempt_count,
          last_error, created_at, updated_at
        )
        SELECT asset.asset_id,
               CASE
                 WHEN asset.source_anchor LIKE 'apple-photos-cloud://%'
                   THEN substr(asset.source_anchor, length('apple-photos-cloud://') + 1)
                 ELSE COALESCE(
                   NULLIF(json_extract(asset.raw_json, '$.cloudIdentifier'), ''),
                   NULLIF(json_extract(asset.raw_json, '$.phCloudIdentifier'), ''),
                   NULLIF(json_extract(asset.raw_json, '$.cloudIdentifierString'), ''),
                   NULLIF(json_extract(asset.raw_json, '$.localIdentifier'), ''),
                   CASE
                     WHEN asset.source_anchor LIKE 'apple-photos://%'
                       THEN NULLIF(substr(asset.source_anchor, length('apple-photos://') + 1), '')
                   END
                 )
               END,
               'pending', 0, '', ?, ?
        FROM sidecar_assets AS asset
        LEFT JOIN asset_current_equipment AS current
          ON current.asset_id = asset.asset_id
        WHERE lower(COALESCE(asset.media_type, 'photo')) = 'photo'
          AND trim(COALESCE(asset.missing_at, '')) = ''
          AND trim(CASE
                 WHEN asset.source_anchor LIKE 'apple-photos-cloud://%'
                   THEN substr(asset.source_anchor, length('apple-photos-cloud://') + 1)
                 ELSE COALESCE(
                   NULLIF(json_extract(asset.raw_json, '$.cloudIdentifier'), ''),
                   NULLIF(json_extract(asset.raw_json, '$.phCloudIdentifier'), ''),
                   NULLIF(json_extract(asset.raw_json, '$.cloudIdentifierString'), ''),
                   NULLIF(json_extract(asset.raw_json, '$.localIdentifier'), ''),
                   CASE
                     WHEN asset.source_anchor LIKE 'apple-photos://%'
                       THEN NULLIF(substr(asset.source_anchor, length('apple-photos://') + 1), '')
                   END
                 )
               END) <> ''
          AND (
            trim(COALESCE(
              current.camera_body,
              json_extract(asset.raw_json, '$.cameraMetadata.model'),
              json_extract(asset.raw_json, '$.cameraMetadata.name'),
              json_extract(asset.raw_json, '$.camera.model'),
              json_extract(asset.raw_json, '$.camera.name'),
              json_extract(asset.raw_json, '$.cameraBody'),
              ''
            )) = ''
            OR trim(COALESCE(
              current.lens,
              json_extract(asset.raw_json, '$.lensMetadata.model'),
              json_extract(asset.raw_json, '$.lensMetadata.name'),
              json_extract(asset.raw_json, '$.lens.model'),
              json_extract(asset.raw_json, '$.lens.name'),
              json_extract(asset.raw_json, '$.cameraMetadata.lensModel'),
              json_extract(asset.raw_json, '$.camera.lensModel'),
              ''
            )) = ''
            OR trim(COALESCE(
              current.focal_length,
              json_extract(asset.raw_json, '$.focalLength'),
              json_extract(asset.raw_json, '$.cameraMetadata.focalLength'),
              json_extract(asset.raw_json, '$.camera.focalLength'),
              ''
            )) = ''
          )
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw error(database, "Could not prepare equipment-backfill enrollment.")
        }
        defer { sqlite3_finalize(statement) }
        bind(timestamp, to: 1, in: statement)
        bind(timestamp, to: 2, in: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw error(database, "Could not enroll equipment-backfill candidates.")
        }
    }

    public func nextCandidates(limit: Int) throws -> [OwnerEquipmentBackfillCandidate] {
        let safeLimit = max(1, min(100, limit))
        let database = try open()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        let sql = """
        SELECT state.asset_id, state.photo_library_identifier
        FROM asset_equipment_backfill_state AS state
        JOIN sidecar_assets AS asset ON asset.asset_id = state.asset_id
        WHERE state.status = 'pending'
          AND trim(COALESCE(asset.missing_at, '')) = ''
        ORDER BY COALESCE(asset.captured_at, ''), state.asset_id
        LIMIT ?
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw error(database, "Could not prepare equipment-backfill candidates.")
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int(statement, 1, Int32(safeLimit))
        var result: [OwnerEquipmentBackfillCandidate] = []
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                result.append(OwnerEquipmentBackfillCandidate(
                    assetID: string(statement, column: 0),
                    photoLibraryIdentifier: string(statement, column: 1)
                ))
            case SQLITE_DONE:
                return result
            default:
                throw error(database, "Could not read equipment-backfill candidates.")
            }
        }
    }

    public func requeueUnavailableAndFailed(now: Date = Date()) throws {
        let database = try open()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        let sql = """
        UPDATE asset_equipment_backfill_state
        SET status = 'pending', last_error = '', updated_at = ?
        WHERE status IN ('unavailable', 'failed')
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw error(database, "Could not prepare equipment-backfill retry.")
        }
        defer { sqlite3_finalize(statement) }
        bind(ISO8601DateFormatter().string(from: now), to: 1, in: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw error(database, "Could not requeue equipment-backfill retries.")
        }
    }

    public func record(
        assetID: String,
        status: String,
        errorText: String = "",
        now: Date = Date()
    ) throws {
        let allowed = Set(["updated", "skipped", "unavailable", "failed"])
        guard allowed.contains(status) else {
            throw OwnerDatabaseError.unavailable("Invalid equipment-backfill status: \(status)")
        }
        let database = try open()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        let sql = """
        UPDATE asset_equipment_backfill_state
        SET status = ?,
            attempt_count = attempt_count + 1,
            last_error = ?,
            updated_at = ?
        WHERE asset_id = ?
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw error(database, "Could not prepare equipment-backfill checkpoint.")
        }
        defer { sqlite3_finalize(statement) }
        bind(status, to: 1, in: statement)
        bind(String(errorText.prefix(1_000)), to: 2, in: statement)
        bind(ISO8601DateFormatter().string(from: now), to: 3, in: statement)
        bind(assetID, to: 4, in: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw error(database, "Could not record equipment-backfill checkpoint.")
        }
    }

    public func report(processedThisPass: Int = 0) throws -> OwnerEquipmentBackfillReport {
        let database = try open()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        let sql = """
        SELECT COUNT(*),
               SUM(CASE WHEN status = 'updated' THEN 1 ELSE 0 END),
               SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END),
               SUM(CASE WHEN status = 'unavailable' THEN 1 ELSE 0 END),
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END),
               SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)
        FROM asset_equipment_backfill_state
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement,
              sqlite3_step(statement) == SQLITE_ROW else {
            throw error(database, "Could not read equipment-backfill progress.")
        }
        defer { sqlite3_finalize(statement) }
        return OwnerEquipmentBackfillReport(
            eligible: Int(sqlite3_column_int64(statement, 0)),
            updated: Int(sqlite3_column_int64(statement, 1)),
            skipped: Int(sqlite3_column_int64(statement, 2)),
            unavailable: Int(sqlite3_column_int64(statement, 3)),
            failed: Int(sqlite3_column_int64(statement, 4)),
            remaining: Int(sqlite3_column_int64(statement, 5)),
            processedThisPass: processedThisPass
        )
    }

    private func ensureSchema(_ database: OpaquePointer) throws {
        try execute(
            """
            CREATE TABLE IF NOT EXISTS asset_current_equipment (
              asset_id TEXT PRIMARY KEY NOT NULL,
              camera_body TEXT NOT NULL DEFAULT '',
              lens TEXT NOT NULL DEFAULT '',
              focal_length TEXT NOT NULL DEFAULT '',
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS asset_equipment_backfill_state (
              asset_id TEXT PRIMARY KEY NOT NULL,
              photo_library_identifier TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'updated', 'skipped', 'unavailable', 'failed')),
              attempt_count INTEGER NOT NULL DEFAULT 0,
              last_error TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_asset_equipment_backfill_status
              ON asset_equipment_backfill_state(status, asset_id);
            """,
            on: database
        )
    }

    private func open() throws -> OpaquePointer {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw OwnerDatabaseError.unavailable("Owner.sqlite is unavailable for equipment backfill.")
        }
        var database: OpaquePointer?
        guard sqlite3_open_v2(
            databaseURL.path,
            &database,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        ) == SQLITE_OK, let database else {
            if let database { sqlite3_close_v2(database) }
            throw OwnerDatabaseError.unavailable("Could not open Owner.sqlite for equipment backfill.")
        }
        sqlite3_busy_timeout(database, busyTimeoutMilliseconds)
        return database
    }

    private func execute(_ sql: String, on database: OpaquePointer) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw error(database, "Could not prepare equipment-backfill storage.")
        }
    }

    private func bind(_ value: String, to index: Int32, in statement: OpaquePointer) {
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        _ = value.withCString { sqlite3_bind_text(statement, index, $0, -1, transient) }
    }

    private func string(_ statement: OpaquePointer, column: Int32) -> String {
        sqlite3_column_text(statement, column).map(String.init(cString:)) ?? ""
    }

    private func error(_ database: OpaquePointer?, _ fallback: String) -> OwnerDatabaseError {
        guard let database else { return .unavailable(fallback) }
        let message = String(cString: sqlite3_errmsg(database))
        return .unavailable(message.isEmpty ? fallback : message)
    }
}

public struct OwnerEquipmentBackfillService: Sendable {
    private let store: OwnerEquipmentBackfillSQLiteStore
    private let cache: any OwnerCurrentEquipmentCaching
    private let photoLibrary: any PhotoLibraryServing

    public init(
        store: OwnerEquipmentBackfillSQLiteStore,
        cache: any OwnerCurrentEquipmentCaching,
        photoLibrary: any PhotoLibraryServing
    ) {
        self.store = store
        self.cache = cache
        self.photoLibrary = photoLibrary
    }

    public func runBatch(
        limit: Int = 25,
        allowICloudDownloads: Bool = true,
        retryUnavailableAndFailed: Bool = false
    ) async throws -> OwnerEquipmentBackfillReport {
        try store.enrollCurrentCandidates()
        if retryUnavailableAndFailed {
            try store.requeueUnavailableAndFailed()
        }
        let candidates = try store.nextCandidates(limit: limit)
        var processed = 0
        for candidate in candidates {
            try Task.checkCancellation()
            do {
                let equipment = try await photoLibrary.equipmentMetadata(
                    localIdentifier: candidate.photoLibraryIdentifier,
                    allowICloudDownloads: allowICloudDownloads
                )
                try Task.checkCancellation()
                if equipment.isEmpty {
                    try store.record(assetID: candidate.assetID, status: "skipped")
                } else {
                    try cache.upsert([candidate.assetID: equipment], updatedAt: Date())
                    try store.record(assetID: candidate.assetID, status: "updated")
                }
            } catch is CancellationError {
                throw CancellationError()
            } catch let error as PhotoLibraryError {
                let status: String
                switch error {
                case .assetNotFound, .resourceNotFound:
                    status = "unavailable"
                default:
                    status = "failed"
                }
                try store.record(
                    assetID: candidate.assetID,
                    status: status,
                    errorText: error.localizedDescription
                )
            } catch {
                try store.record(
                    assetID: candidate.assetID,
                    status: "failed",
                    errorText: error.localizedDescription
                )
            }
            processed += 1
        }
        return try store.report(processedThisPass: processed)
    }

    public func runUntilComplete(
        batchLimit: Int = 25,
        allowICloudDownloads: Bool = true,
        retryUnavailableAndFailed: Bool = false,
        onCheckpoint: @escaping @Sendable (OwnerEquipmentBackfillReport) async throws -> Void = { _ in }
    ) async throws -> OwnerEquipmentBackfillReport {
        var retry = retryUnavailableAndFailed
        while true {
            try Task.checkCancellation()
            let report = try await runBatch(
                limit: batchLimit,
                allowICloudDownloads: allowICloudDownloads,
                retryUnavailableAndFailed: retry
            )
            retry = false
            try await onCheckpoint(report)
            if report.remaining == 0 || report.processedThisPass == 0 {
                return report
            }
        }
    }
}
