import Darwin
import Foundation
import SQLite3

public struct OwnerWorkflowRecoveryReport: Sendable, Equatable {
    public var photosRecovered: Int
    public var photosNeedsReview: Int
    public var uploadsRecovered: Int
    public var uploadsNeedsReview: Int
    public var skipped: Int

    public var changed: Int {
        photosRecovered + photosNeedsReview + uploadsRecovered + uploadsNeedsReview
    }
}

/// Reconciles stale workflow bookkeeping directly in authoritative Owner.sqlite.
/// It never guesses that a legacy row completed: rows without durable worker
/// identity stay nonterminal and receive an explicit needs-review marker.
public struct OwnerWorkflowRecoverySQLiteStore: Sendable {
    private let databaseURL: URL
    private let processIsAlive: @Sendable (Int32) -> Bool

    public init(databaseURL: URL) {
        self.databaseURL = databaseURL.standardizedFileURL
        self.processIsAlive = Self.defaultProcessIsAlive
    }

    init(
        databaseURL: URL,
        processIsAlive: @escaping @Sendable (Int32) -> Bool
    ) {
        self.databaseURL = databaseURL.standardizedFileURL
        self.processIsAlive = processIsAlive
    }

    public func reconcile(
        now: Date = Date(),
        staleAfter: TimeInterval = 60 * 60
    ) throws -> OwnerWorkflowRecoveryReport {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw APIErrorEnvelope(error: .init(
                code: "owner_workflow_database_missing",
                message: "Backstage could not find Owner.sqlite for workflow recovery."
            ))
        }

        var database: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &database,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let database else {
            if let database { sqlite3_close_v2(database) }
            throw sqliteError(database, code: "owner_workflow_database_open_failed")
        }
        defer { sqlite3_close_v2(database) }
        sqlite3_busy_timeout(database, 1_000)

        try execute("BEGIN IMMEDIATE TRANSACTION", on: database)
        var transactionOpen = true
        defer {
            if transactionOpen {
                sqlite3_exec(database, "ROLLBACK", nil, nil, nil)
            }
        }

        var report = OwnerWorkflowRecoveryReport(
            photosRecovered: 0,
            photosNeedsReview: 0,
            uploadsRecovered: 0,
            uploadsNeedsReview: 0,
            skipped: 0
        )
        try reconcilePhotos(
            database,
            now: now,
            staleAfter: staleAfter,
            report: &report
        )
        try reconcileUploads(
            database,
            now: now,
            staleAfter: staleAfter,
            report: &report
        )
        try execute("COMMIT", on: database)
        transactionOpen = false
        return report
    }

    private func reconcilePhotos(
        _ database: OpaquePointer,
        now: Date,
        staleAfter: TimeInterval,
        report: inout OwnerWorkflowRecoveryReport
    ) throws {
        let rows = try runningRows(
            database,
            table: "photos_sync_runs",
            timestampColumn: "COALESCE(updated_at, created_at)"
        )
        for row in rows {
            guard let heartbeat = parseTimestamp(row.updatedAt) else {
                report.skipped += 1
                continue
            }
            let age = max(0, now.timeIntervalSince(heartbeat))
            guard age >= max(0, staleAfter) else { continue }
            if row.workerPID <= 0 || row.workerToken.isEmpty {
                guard row.recoveryState.isEmpty else { continue }
                let changed = try update(
                    database,
                    sql: """
                    UPDATE photos_sync_runs
                    SET recovery_state = 'needs-review', recovery_reason = ?, recovery_checked_at = ?
                    WHERE run_id = ? AND status = 'running' AND COALESCE(recovery_state, '') = ''
                    """,
                    values: [
                        "Legacy Photos sync row has no durable worker PID/token; last heartbeat was \(Int(age)) seconds ago and needs explicit review.",
                        timestamp(now),
                        row.id,
                    ]
                )
                report.photosNeedsReview += changed
            } else if !processIsAlive(row.workerPID) {
                let changed = try update(
                    database,
                    sql: """
                    UPDATE photos_sync_runs
                    SET status = 'failed', stage = 'Recovered after interruption',
                        recovery_state = 'recovered', recovery_reason = ?, recovery_checked_at = ?,
                        error_text = ?, completed_at = ?, updated_at = ?, lease_expires_at = NULL
                    WHERE run_id = ? AND status = 'running' AND worker_pid = ? AND worker_token = ?
                    """,
                    values: [
                        "Recorded Photos sync worker process is no longer alive; last heartbeat was \(Int(age)) seconds ago.",
                        timestamp(now),
                        "Photos sync worker process ended before its terminal receipt was persisted.",
                        timestamp(now),
                        timestamp(now),
                        row.id,
                        String(row.workerPID),
                        row.workerToken,
                    ]
                )
                report.photosRecovered += changed
            } else {
                report.skipped += 1
            }
        }
    }

    private func reconcileUploads(
        _ database: OpaquePointer,
        now: Date,
        staleAfter: TimeInterval,
        report: inout OwnerWorkflowRecoveryReport
    ) throws {
        let rows = try runningRows(
            database,
            table: "sidecar_upload_bridge_runs",
            timestampColumn: "updated_at"
        )
        for row in rows {
            guard let heartbeat = parseTimestamp(row.updatedAt) else {
                report.skipped += 1
                continue
            }
            let age = max(0, now.timeIntervalSince(heartbeat))
            guard age >= max(0, staleAfter) else { continue }
            if row.workerPID <= 0 || row.workerToken.isEmpty {
                guard row.recoveryState.isEmpty else { continue }
                let changed = try update(
                    database,
                    sql: """
                    UPDATE sidecar_upload_bridge_runs
                    SET recovery_state = 'needs-review', recovery_reason = ?, recovery_checked_at = ?
                    WHERE run_id = ? AND status = 'running' AND COALESCE(recovery_state, '') = ''
                    """,
                    values: [
                        "Legacy Upload Bridge run has no durable worker PID/token; last update was \(Int(age)) seconds ago and needs explicit review.",
                        timestamp(now),
                        row.id,
                    ]
                )
                report.uploadsNeedsReview += changed
            } else if !processIsAlive(row.workerPID) {
                let changed = try update(
                    database,
                    sql: """
                    UPDATE sidecar_upload_bridge_runs
                    SET status = 'interrupted',
                        error_text = COALESCE(NULLIF(error_text, ''), ?),
                        completed_at = COALESCE(completed_at, ?), updated_at = ?,
                        lease_expires_at = NULL, recovery_state = 'recovered',
                        recovery_reason = ?, recovery_checked_at = ?
                    WHERE run_id = ? AND status = 'running' AND worker_pid = ? AND worker_token = ?
                    """,
                    values: [
                        "Upload Bridge worker process ended before a terminal receipt was persisted.",
                        timestamp(now),
                        timestamp(now),
                        "Recorded Upload Bridge worker process is no longer alive; last update was \(Int(age)) seconds ago.",
                        timestamp(now),
                        row.id,
                        String(row.workerPID),
                        row.workerToken,
                    ]
                )
                report.uploadsRecovered += changed
            } else {
                report.skipped += 1
            }
        }
    }

    private struct RunningRow {
        var id: String
        var updatedAt: String
        var workerPID: Int32
        var workerToken: String
        var recoveryState: String
    }

    private func runningRows(
        _ database: OpaquePointer,
        table: String,
        timestampColumn: String
    ) throws -> [RunningRow] {
        let sql = """
        SELECT run_id, \(timestampColumn), COALESCE(worker_pid, 0),
               COALESCE(worker_token, ''), COALESCE(recovery_state, '')
        FROM \(table)
        WHERE status = 'running'
        ORDER BY \(timestampColumn), run_id
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw sqliteError(database, code: "owner_workflow_query_failed")
        }
        defer { sqlite3_finalize(statement) }
        var rows: [RunningRow] = []
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                rows.append(RunningRow(
                    id: text(statement, 0),
                    updatedAt: text(statement, 1),
                    workerPID: Int32(sqlite3_column_int(statement, 2)),
                    workerToken: text(statement, 3),
                    recoveryState: text(statement, 4)
                ))
            case SQLITE_DONE:
                return rows
            default:
                throw sqliteError(database, code: "owner_workflow_query_failed")
            }
        }
    }

    private func update(
        _ database: OpaquePointer,
        sql: String,
        values: [String]
    ) throws -> Int {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw sqliteError(database, code: "owner_workflow_update_failed")
        }
        defer { sqlite3_finalize(statement) }
        for (offset, value) in values.enumerated() {
            sqlite3_bind_text(statement, Int32(offset + 1), value, -1, sqliteTransient)
        }
        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw sqliteError(database, code: "owner_workflow_update_failed")
        }
        return Int(sqlite3_changes(database))
    }

    private func execute(_ sql: String, on database: OpaquePointer) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw sqliteError(database, code: "owner_workflow_transaction_failed")
        }
    }

    private func sqliteError(_ database: OpaquePointer?, code: String) -> APIErrorEnvelope {
        APIErrorEnvelope(error: .init(
            code: code,
            message: database.map { String(cString: sqlite3_errmsg($0)) }
                ?? "Backstage could not reconcile Owner workflow state."
        ))
    }

    private func text(_ statement: OpaquePointer, _ index: Int32) -> String {
        guard let value = sqlite3_column_text(statement, index) else { return "" }
        return String(cString: value)
    }

    private func parseTimestamp(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = fractional.date(from: value) { return parsed }
        return ISO8601DateFormatter().date(from: value)
    }

    private func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func defaultProcessIsAlive(_ pid: Int32) -> Bool {
        guard pid > 0 else { return false }
        if Darwin.kill(pid, 0) == 0 { return true }
        return errno == EPERM
    }
}

private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
