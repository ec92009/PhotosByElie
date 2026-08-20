import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("Owner Review SQLite parity")
struct OwnerReviewSQLiteStoreTests {
    @Test("Hide and exact Undo stay inside one Swift SQLite transaction")
    func hideAndUndoCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-sqlite-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)

        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)
        let applied = try store.applyReview(
            .hide,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1", "asset-2", "asset-1"],
            anchorAssetID: "asset-2",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        #expect(applied.action == .hide)
        #expect(applied.fixtureID == "fixture-expo")
        #expect(applied.anchorAssetID == "asset-2")
        #expect(applied.changes.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(applied.changes.first?.review["placementState"]?.stringValue == "hidden")
        #expect(applied.changes.first?.review["proposalReady"]?.boolValue == false)
        #expect(applied.timing["localTransaction"]?.objectValue?["durationMs"] != nil)
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "hidden")
        #expect(try scalar(databaseURL, "SELECT eligibility_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "active")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "superseded")
        #expect(try scalar(databaseURL, "SELECT state FROM fixture_review_operations WHERE operation_id = '\(applied.operationID)'") == "applied")

        let undone = try store.undoReview(
            operationID: applied.operationID,
            now: Date(timeIntervalSince1970: 1_800_000_001)
        )
        #expect(!undone.alreadyUndone)
        #expect(undone.changes.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(undone.changes.first?.review["placementState"]?.stringValue == "picked")
        #expect(undone.changes.first?.review["proposalReady"]?.boolValue == true)
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "ready")
        #expect(try scalar(databaseURL, "SELECT state FROM fixture_review_operations WHERE operation_id = '\(applied.operationID)'") == "undone")

        let replay = try store.undoReview(operationID: applied.operationID)
        #expect(replay.alreadyUndone)
        #expect(replay.changes.isEmpty)
    }

    @Test("Approve accepts the visible proposal and exact Undo restores it")
    func approveAndUndoCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-approve-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)

        let applied = try store.applyReview(
            .approve,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"],
            anchorAssetID: "asset-1",
            proposalID: "proposal-1",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        #expect(applied.action == .approve)
        #expect(applied.changes.first?.review["editorialState"]?.stringValue == "approved")
        #expect(applied.changes.first?.review["title"]?.stringValue == "Proposed title")
        #expect(applied.changes.first?.review["deliveryState"]?.stringValue == "needs-upload")
        #expect(applied.changes.first?.review["proposalReady"]?.boolValue == false)
        #expect(try scalar(databaseURL, "SELECT metadata_state FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "approved")
        #expect(try scalar(databaseURL, "SELECT title FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "Proposed title")
        #expect(try scalar(databaseURL, "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'") == "needs-upload")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "accepted")

        let undone = try store.undoReview(
            operationID: applied.operationID,
            now: Date(timeIntervalSince1970: 1_800_000_001)
        )
        #expect(!undone.alreadyUndone)
        #expect(undone.action == .approve)
        #expect(undone.changes.first?.review["editorialState"]?.stringValue == "unreviewed")
        #expect(undone.changes.first?.review["title"]?.stringValue == "Decision title")
        #expect(undone.changes.first?.review["deliveryState"]?.stringValue == "not-ready")
        #expect(undone.changes.first?.review["proposalReady"]?.boolValue == true)
        #expect(try scalar(databaseURL, "SELECT metadata_state FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "unreviewed")
        #expect(try scalar(databaseURL, "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'") == "not-ready")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "ready")
    }

    @Test("Approve refuses a superseded visible proposal")
    func approveProposalConflictIsFailClosed() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-approve-conflict-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)
        try execute(
            databaseURL,
            "UPDATE asset_ai_proposals SET status = 'superseded' WHERE proposal_id = 'proposal-1'"
        )

        #expect(throws: OwnerReviewSQLiteError.self) {
            try store.applyReview(
                .approve,
                fixtureID: "fixture-expo",
                assetIDs: ["asset-1"],
                anchorAssetID: "asset-1",
                proposalID: "proposal-1"
            )
        }
        #expect(try scalar(databaseURL, "SELECT metadata_state FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "unreviewed")
    }

    @Test("Request AI records reasons and exact Undo restores the prior proposal")
    func requestAIAndUndoCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-request-ai-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)

        let applied = try store.applyReview(
            .requestAI,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1", "asset-2", "asset-1"],
            anchorAssetID: "asset-1",
            aiReasons: ["better title", "better title", "location"],
            aiNote: "  Resolve the location and title.  ",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        #expect(applied.action == .requestAI)
        #expect(applied.changes.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(applied.changes.first?.review["editorialState"]?.stringValue == "requesting-ai")
        #expect(applied.changes.first?.review["aiReasons"]?.arrayValue?.map(\.stringValue) == ["better title", "location"])
        #expect(applied.changes.first?.review["aiNote"]?.stringValue == "Resolve the location and title.")
        #expect(applied.changes.first?.review["placementState"]?.stringValue == "picked")
        #expect(applied.changes.first?.review["proposalReady"]?.boolValue == false)
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "superseded")
        #expect(try scalar(databaseURL, "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "requesting-ai")

        let undone = try store.undoReview(
            operationID: applied.operationID,
            now: Date(timeIntervalSince1970: 1_800_000_001)
        )

        #expect(!undone.alreadyUndone)
        #expect(undone.action == .requestAI)
        #expect(undone.changes.first?.review["editorialState"]?.stringValue == "unreviewed")
        #expect(undone.changes.first?.review["aiReasons"]?.arrayValue?.isEmpty == true)
        #expect(undone.changes.first?.review["aiNote"]?.stringValue == "")
        #expect(undone.changes.first?.review["proposalReady"]?.boolValue == true)
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "ready")
        #expect(try scalar(databaseURL, "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "unreviewed")
    }

    @Test("Undo refuses a later mutation instead of overwriting it")
    func undoConflictIsFailClosed() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-conflict-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)
        let applied = try store.applyReview(
            .hide,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"],
            anchorAssetID: "asset-1"
        )
        try execute(
            databaseURL,
            "UPDATE sidecar_decisions SET title = 'changed-after-hide' WHERE asset_id = 'asset-1'"
        )

        #expect(throws: OwnerReviewSQLiteError.self) {
            try store.undoReview(operationID: applied.operationID)
        }
        #expect(try scalar(databaseURL, "SELECT state FROM fixture_review_operations WHERE operation_id = '\(applied.operationID)'") == "applied")
        #expect(try scalar(databaseURL, "SELECT title FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "changed-after-hide")
    }
}

private func makeCopiedFixtureDatabase(at url: URL) throws {
    var database: OpaquePointer?
    guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else {
        throw OwnerDatabaseError.unavailable("could not create copied fixture database")
    }
    defer { sqlite3_close(database) }
    let schema = """
    PRAGMA foreign_keys = ON;
    CREATE TABLE fixtures (
      fixture_id TEXT PRIMARY KEY,
      parent_fixture_id TEXT,
      archived_at TEXT
    );
    CREATE TABLE sidecar_assets (
      asset_id TEXT PRIMARY KEY,
      photos_title TEXT,
      photos_keywords_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE sidecar_decisions (
      asset_id TEXT PRIMARY KEY,
      rating INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '',
      pick_state TEXT NOT NULL DEFAULT 'undecided',
      metadata_state TEXT NOT NULL DEFAULT 'unreviewed',
      title TEXT,
      caption TEXT,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      last_action TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE asset_editorial_state (
      asset_id TEXT PRIMARY KEY,
      editorial_state TEXT NOT NULL DEFAULT 'unreviewed',
      ai_reasons_json TEXT NOT NULL DEFAULT '[]',
      ai_note TEXT NOT NULL DEFAULT '',
      ai_attempt_count INTEGER NOT NULL DEFAULT 0,
      ai_last_error TEXT NOT NULL DEFAULT '',
      requested_at TEXT,
      proposed_at TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE asset_delivery_state (
      asset_id TEXT PRIMARY KEY,
      delivery_state TEXT NOT NULL DEFAULT 'not-ready',
      source_version_hash TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE fixture_asset_decisions (
      fixture_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      placement_state TEXT NOT NULL DEFAULT 'undecided',
      eligibility_state TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'native',
      last_action TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (fixture_id, asset_id)
    );
    CREATE TABLE fixture_asset_decision_events (
      event_id TEXT PRIMARY KEY,
      fixture_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      before_state TEXT NOT NULL,
      after_state TEXT NOT NULL,
      before_eligibility TEXT NOT NULL,
      after_eligibility TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE asset_editorial_events (
      event_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      fixture_id TEXT,
      action TEXT NOT NULL,
      before_state TEXT NOT NULL,
      after_state TEXT NOT NULL,
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE fixture_review_operations (
      operation_id TEXT PRIMARY KEY,
      fixture_id TEXT NOT NULL,
      action TEXT NOT NULL,
      anchor_asset_id TEXT NOT NULL,
      propagated INTEGER NOT NULL DEFAULT 0,
      asset_ids_json TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'applied',
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      undone_at TEXT
    );
    CREATE TABLE asset_ai_proposals (
      proposal_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      previous_title TEXT NOT NULL DEFAULT '',
      previous_keywords_json TEXT NOT NULL DEFAULT '[]',
      proposed_title TEXT NOT NULL,
      proposed_keywords_json TEXT NOT NULL DEFAULT '[]',
      confidence TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    INSERT INTO fixtures(fixture_id, parent_fixture_id, archived_at)
      VALUES ('fixture-expo', NULL, NULL);
    INSERT INTO sidecar_assets(asset_id, photos_title, photos_keywords_json)
      VALUES ('asset-1', 'Original title', '["Original"]'),
             ('asset-2', 'Second title', '["Second"]');
    INSERT INTO sidecar_decisions(asset_id, title, keywords_json, created_at, updated_at)
      VALUES ('asset-1', 'Decision title', '["Decision"]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO asset_editorial_state(asset_id, created_at, updated_at)
      VALUES ('asset-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             ('asset-2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO asset_delivery_state(asset_id, created_at, updated_at)
      VALUES ('asset-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             ('asset-2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO fixture_asset_decisions(
      fixture_id, asset_id, placement_state, eligibility_state, created_at, updated_at
    ) VALUES ('fixture-expo', 'asset-1', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             ('fixture-expo', 'asset-2', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO asset_ai_proposals(
      proposal_id, asset_id, run_id, attempt, status, proposed_title, created_at
    ) VALUES ('proposal-1', 'asset-1', 'run-1', 1, 'ready', 'Proposed title', '2026-01-01T00:00:00Z');
    """
    guard sqlite3_exec(database, schema, nil, nil, nil) == SQLITE_OK else {
        throw OwnerDatabaseError.unavailable("could not seed copied fixture database")
    }
}

private func execute(_ databaseURL: URL, _ sql: String) throws {
    var database: OpaquePointer?
    guard sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK,
          let database else {
        throw OwnerDatabaseError.unavailable("test database unavailable")
    }
    defer { sqlite3_close(database) }
    guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
        throw OwnerDatabaseError.unavailable("test SQL failed")
    }
}

private func scalar(_ databaseURL: URL, _ sql: String) throws -> String {
    var database: OpaquePointer?
    guard sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK,
          let database else {
        throw OwnerDatabaseError.unavailable("test database unavailable")
    }
    defer { sqlite3_close(database) }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
          let statement else {
        throw OwnerDatabaseError.unavailable("test statement unavailable")
    }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW,
          let text = sqlite3_column_text(statement, 0) else {
        throw OwnerDatabaseError.unavailable("test scalar unavailable")
    }
    return String(cString: text)
}
