import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("Owner Culling SQLite parity")
struct OwnerCullingSQLiteStoreTests {
    @Test("Fixture placement stays local and recomputes inherited eligibility")
    func appliesFixtureStateAndUndo() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-sqlite-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)

        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)
        let applied = try store.applyState(
            .hidden,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-2", "asset-1", "asset-2"],
            actor: "test-owner",
            reason: "manual exclude",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        #expect(applied.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(applied.first?.beforePlacementState == .picked)
        #expect(applied.first?.placementState == .hidden)
        #expect(applied.first?.eligibilityState == "active")
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "hidden")
        #expect(try scalar(databaseURL, "SELECT pick_state FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT eligibility_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-child' AND asset_id = 'asset-1'") == "dormant")
        #expect(try scalar(databaseURL, "SELECT count(*) FROM fixture_asset_decision_events") == "2")

        let undone = try store.undoState(
            applied,
            actor: "test-owner",
            now: Date(timeIntervalSince1970: 1_800_000_001)
        )
        #expect(undone.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(undone.first?.beforePlacementState == .hidden)
        #expect(undone.first?.placementState == .picked)
        #expect(undone.first?.eligibilityState == "active")
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT eligibility_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-child' AND asset_id = 'asset-1'") == "active")
        #expect(try scalar(databaseURL, "SELECT count(*) FROM fixture_asset_decision_events") == "4")
    }

    @Test("Culling Undo fails closed after a later mutation")
    func undoConflictIsFailClosed() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-conflict-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)
        let applied = try store.applyState(.hidden, fixtureID: "fixture-expo", assetIDs: ["asset-1"])
        try execute(
            databaseURL,
            "UPDATE fixture_asset_decisions SET placement_state = 'picked', updated_at = 'later' WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'"
        )

        #expect(throws: OwnerCullingSQLiteError.self) {
            try store.undoState(applied)
        }
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT count(*) FROM fixture_asset_decision_events") == "1")
    }

    @Test("Culling apply is atomic when one requested asset is invalid")
    func invalidAssetRollsBackAllChanges() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-rollback-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)

        #expect(throws: OwnerCullingSQLiteError.self) {
            try store.applyState(
                .picked,
                fixtureID: "fixture-expo",
                assetIDs: ["asset-1", "missing-asset"]
            )
        }
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT count(*) FROM fixture_asset_decision_events") == "0")
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
      asset_id TEXT PRIMARY KEY
    );
    CREATE TABLE sidecar_decisions (
      asset_id TEXT PRIMARY KEY,
      pick_state TEXT NOT NULL DEFAULT 'undecided'
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
    INSERT INTO fixtures(fixture_id, parent_fixture_id, archived_at)
      VALUES ('fixture-expo', NULL, NULL), ('fixture-child', 'fixture-expo', NULL);
    INSERT INTO sidecar_assets(asset_id)
      VALUES ('asset-1'), ('asset-2');
    INSERT INTO sidecar_decisions(asset_id, pick_state)
      VALUES ('asset-1', 'picked'), ('asset-2', 'undecided');
    INSERT INTO fixture_asset_decisions(
      fixture_id, asset_id, placement_state, eligibility_state, created_at, updated_at
    ) VALUES
      ('fixture-expo', 'asset-1', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('fixture-expo', 'asset-2', 'hidden', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('fixture-child', 'asset-1', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
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
