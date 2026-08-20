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

    @Test("Culling read parity applies fixture scope, filters, search, and pagination")
    func cullingWindowReadsCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-window-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        try execute(
            databaseURL,
            """
            UPDATE sidecar_assets
               SET source_anchor = 'apple-photos-cloud://cloud-asset-1',
                   raw_json = '{"resourceFormat":"jpeg","originalByteCount":101}',
                   filename = 'A.JPG',
                   captured_at = '2026-01-01T01:00:00Z',
                   photos_title = 'First photo',
                   photos_keywords_json = '["Madrid"]',
                   location_label = 'Madrid, Spain',
                   location_keywords_json = '["Madrid","Spain"]',
                   pixel_width = 1200,
                   pixel_height = 800
             WHERE asset_id = 'asset-1';
            UPDATE sidecar_assets
               SET source_anchor = 'apple-photos://local-asset-2',
                   raw_json = '{"resourceFormat":"mov","originalByteCount":202}',
                   filename = 'B.MOV',
                   media_type = 'video',
                   captured_at = '2026-01-01T02:00:00Z',
                   photos_title = 'Second video',
                   location_label = 'Paris, France'
             WHERE asset_id = 'asset-2';
            UPDATE sidecar_decisions
               SET rating = 4, color = 'red', title = 'Decision video', keywords_json = '["night"]'
             WHERE asset_id = 'asset-2';
            INSERT INTO sidecar_upload_bridge_run_items(
              run_item_id, asset_id, upload_keys_json, updated_at
            ) VALUES (
              'run-item-1', 'asset-1', '[{"kind":"private-master","bytes":1001}]',
              '2026-01-01T07:00:00Z'
            );
            INSERT INTO sidecar_assets(
              asset_id, source_anchor, raw_json, filename, captured_at,
              photos_title, photos_keywords_json, location_label,
              location_keywords_json
            ) VALUES (
              'asset-3', 'apple-photos://local-asset-3',
              '{"resourceFormat":"jpeg"}', 'C.JPG', '2026-01-01T03:00:00Z',
              'Palace facade', '["Granada"]', 'Alhambrá, Granada, Spain',
              '["Alhambrá","Granada","Spain"]'
            );
            INSERT INTO sidecar_decisions(asset_id, title, keywords_json)
              VALUES ('asset-3', '', '[]');
            INSERT INTO sidecar_assets(asset_id, filename, captured_at)
              VALUES ('asset-missing', 'Missing.JPG', '2026-01-01T04:00:00Z'),
                     ('asset-tombstone', 'Tombstone.JPG', '2026-01-01T05:00:00Z');
            INSERT INTO sidecar_decisions(asset_id) VALUES ('asset-missing'), ('asset-tombstone');
            INSERT INTO fixture_asset_decisions(
              fixture_id, asset_id, placement_state, eligibility_state, created_at, updated_at
            ) VALUES
              ('fixture-expo', 'asset-3', 'undecided', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
              ('fixture-expo', 'asset-missing', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
              ('fixture-expo', 'asset-tombstone', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            UPDATE sidecar_assets SET missing_at = '2026-01-01T06:00:00Z' WHERE asset_id = 'asset-missing';
            INSERT INTO sidecar_tombstones(asset_id, tombstone_state)
              VALUES ('asset-tombstone', 'active');
            """
        )
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)

        let page = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            limit: 2
        )
        #expect(page.summary.universe == 3)
        #expect(page.summary.undecided == 1)
        #expect(page.summary.picked == 1)
        #expect(page.summary.hidden == 1)
        #expect(page.items.map(\.id) == ["asset-3", "asset-2"])
        #expect(page.nextOffset == 2)
        #expect(page.hasNext)

        let picked = try store.cullingWindow(fixtureID: "fixture-expo", view: .picked)
        #expect(picked.items.map(\.id) == ["asset-1"])
        #expect(picked.items.first?.photoLibraryIdentifier == "cloud-asset-1")
        #expect(picked.items.first?.originalByteCount == 1001)

        let redVideo = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            mediaTypes: ["videos"],
            ratings: [4],
            colors: ["red"]
        )
        #expect(redVideo.items.map(\.id) == ["asset-2"])

        let searched = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .undecided,
            search: "Alhambra"
        )
        #expect(searched.items.map(\.id) == ["asset-3"])
        #expect(searched.items.first?.title == "Palace facade")

        let child = try store.cullingWindow(fixtureID: "fixture-child", view: .allActive)
        #expect(child.items.map(\.id) == ["asset-1"])
    }

    @Test("Fixture workflow uses native Culling reads without an Owner action")
    func cullingWorkflowUsesNativeRead() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-workflow-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)

        let localService = LocalFixtureReviewService(
            endpoints: [],
            nativeDatabaseURL: databaseURL
        )
        let workflow = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: FailingCullingOwnerActionService(),
                waker: FailingCullingOwnerActionWaker()
            ),
            localReviewService: localService
        )

        let window = try await workflow.cullingWindow(
            fixtureID: "fixture-expo",
            view: .picked,
            limit: 1
        )
        #expect(window.items.map(\.id) == ["asset-1"])
    }
}

private struct FailingCullingOwnerActionService: OwnerActionServing {
    func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String
    ) async throws -> OwnerActionEnvelope {
        throw OwnerActionRunError.failed("native Culling read unexpectedly crossed the Owner action boundary")
    }

    func getAction(id: String) async throws -> OwnerAction {
        throw OwnerActionRunError.failed("native Culling read unexpectedly polled an Owner action")
    }
}

private struct FailingCullingOwnerActionWaker: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? {
        throw OwnerActionRunError.failed("native Culling read unexpectedly woke the connector")
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
      candidate_mode TEXT NOT NULL DEFAULT 'inherited',
      archived_at TEXT
    );
    CREATE TABLE sidecar_assets (
      asset_id TEXT PRIMARY KEY,
      source_anchor TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      filename TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'photo',
      captured_at TEXT NOT NULL DEFAULT '',
      pixel_width INTEGER NOT NULL DEFAULT 0,
      pixel_height INTEGER NOT NULL DEFAULT 0,
      photos_title TEXT NOT NULL DEFAULT '',
      photos_keywords_json TEXT NOT NULL DEFAULT '[]',
      location_label TEXT NOT NULL DEFAULT '',
      location_keywords_json TEXT NOT NULL DEFAULT '[]',
      missing_at TEXT
    );
    CREATE TABLE sidecar_decisions (
      asset_id TEXT PRIMARY KEY,
      rating INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '',
      pick_state TEXT NOT NULL DEFAULT 'undecided',
      metadata_state TEXT NOT NULL DEFAULT 'unreviewed',
      title TEXT NOT NULL DEFAULT '',
      keywords_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE sidecar_tombstones (
      asset_id TEXT PRIMARY KEY,
      tombstone_state TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE sidecar_upload_bridge_run_items (
      run_item_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      upload_keys_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT ''
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
