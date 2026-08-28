import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("Owner workflow recovery SQLite")
struct OwnerWorkflowRecoverySQLiteStoreTests {
    @Test("Legacy rows need review and verified dead workers become terminal")
    func reconcilesOnlyStaleNonterminalRows() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-workflow-recovery-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try seedWorkflowDatabase(at: databaseURL)
        let now = try #require(ISO8601DateFormatter().date(from: "2026-08-21T12:00:00Z"))
        let store = OwnerWorkflowRecoverySQLiteStore(
            databaseURL: databaseURL,
            processIsAlive: { $0 == 777 }
        )

        let report = try store.reconcile(now: now, staleAfter: 60 * 60)

        #expect(report.photosNeedsReview == 1)
        #expect(report.photosRecovered == 1)
        #expect(report.uploadsNeedsReview == 1)
        #expect(report.uploadsRecovered == 1)
        #expect(report.skipped == 2)
        #expect(report.changed == 4)

        var database: OpaquePointer?
        #expect(sqlite3_open(databaseURL.path, &database) == SQLITE_OK)
        let opened = try #require(database)
        defer { sqlite3_close(opened) }
        #expect(try scalar(opened, "SELECT recovery_state FROM photos_sync_runs WHERE run_id='photos-legacy'") == "needs-review")
        #expect(try scalar(opened, "SELECT status || ':' || recovery_state FROM photos_sync_runs WHERE run_id='photos-dead'") == "failed:recovered")
        #expect(try scalar(opened, "SELECT status || ':' || recovery_state FROM photos_sync_runs WHERE run_id='photos-live'") == "running:")
        #expect(try scalar(opened, "SELECT status || ':' || recovery_state FROM photos_sync_runs WHERE run_id='photos-fresh'") == "running:")
        #expect(try scalar(opened, "SELECT recovery_state FROM sidecar_upload_bridge_runs WHERE run_id='upload-legacy'") == "needs-review")
        #expect(try scalar(opened, "SELECT status || ':' || recovery_state FROM sidecar_upload_bridge_runs WHERE run_id='upload-dead'") == "interrupted:recovered")

        let second = try store.reconcile(now: now, staleAfter: 60 * 60)
        #expect(second.changed == 0)
    }

    @Test("Missing workflow database fails closed")
    func missingDatabaseFailsClosed() {
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent("missing-workflows-\(UUID().uuidString).sqlite")
        #expect(throws: APIErrorEnvelope.self) {
            try OwnerWorkflowRecoverySQLiteStore(databaseURL: missing).reconcile()
        }
    }
}

private func seedWorkflowDatabase(at url: URL) throws {
    var database: OpaquePointer?
    guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else {
        throw OwnerDatabaseError.unavailable("test database unavailable")
    }
    defer { sqlite3_close(database) }
    let schema = #"""
    CREATE TABLE photos_sync_runs(
      run_id TEXT PRIMARY KEY, status TEXT, stage TEXT, error_text TEXT,
      created_at TEXT, updated_at TEXT, completed_at TEXT,
      worker_pid INTEGER, worker_token TEXT, lease_expires_at TEXT,
      recovery_state TEXT NOT NULL DEFAULT '', recovery_reason TEXT NOT NULL DEFAULT '',
      recovery_checked_at TEXT
    );
    CREATE TABLE sidecar_upload_bridge_runs(
      run_id TEXT PRIMARY KEY, status TEXT, mode TEXT, error_text TEXT,
      created_at TEXT, updated_at TEXT, completed_at TEXT,
      worker_pid INTEGER, worker_token TEXT, lease_expires_at TEXT,
      recovery_state TEXT NOT NULL DEFAULT '', recovery_reason TEXT NOT NULL DEFAULT '',
      recovery_checked_at TEXT
    );
    INSERT INTO photos_sync_runs(run_id,status,stage,created_at,updated_at,worker_pid,worker_token) VALUES
      ('photos-legacy','running','Queued','2026-08-21T08:00:00Z','2026-08-21T08:00:00Z',0,''),
      ('photos-dead','running','Working','2026-08-21T08:00:00Z','2026-08-21T08:00:00Z',778,'dead-token'),
      ('photos-live','running','Working','2026-08-21T08:00:00Z','2026-08-21T08:00:00Z',777,'live-token'),
      ('photos-fresh','running','Queued','2026-08-21T11:45:00Z','2026-08-21T11:45:00Z',0,'');
    INSERT INTO sidecar_upload_bridge_runs(run_id,status,mode,created_at,updated_at,worker_pid,worker_token) VALUES
      ('upload-legacy','running','execute','2026-08-21T08:00:00Z','2026-08-21T08:00:00Z',0,''),
      ('upload-dead','running','execute','2026-08-21T08:00:00Z','2026-08-21T08:00:00Z',778,'dead-token'),
      ('upload-live','running','execute','2026-08-21T08:00:00Z','2026-08-21T08:00:00Z',777,'live-token');
    """#
    guard sqlite3_exec(database, schema, nil, nil, nil) == SQLITE_OK else {
        throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
    }
}

private func scalar(_ database: OpaquePointer, _ sql: String) throws -> String {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
          let statement else {
        throw OwnerDatabaseError.unavailable("test query unavailable")
    }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW,
          let value = sqlite3_column_text(statement, 0) else {
        throw OwnerDatabaseError.unavailable("test row unavailable")
    }
    return String(cString: value)
}
