import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("External editor round trips")
struct ExternalEditJobStoreTests {
    @Test("One selected source returns as a candidate version of the same asset")
    func singleSourceRoundTrip() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let store = fixture.store
        var job = try store.createJob(
            fixtureID: "fixture-expo",
            kind: .edit,
            editor: fixture.editor,
            sources: [fixture.source(position: 0, assetID: "asset-1")],
            now: fixture.date
        )
        #expect(try store.activeJob()?.id == job.id)

        let input = job.inputDirectory.appendingPathComponent("IMG_0001.DNG")
        try Data("raw-one".utf8).write(to: input)
        job = try store.recordPrepared(
            jobID: job.id,
            receipts: [PhotoExportReceipt(
                assetID: "photos-1",
                filename: "IMG_0001.DNG",
                destination: input,
                uniformTypeIdentifier: "com.adobe.raw-image",
                byteCount: 7,
                checksumSHA256: "source-checksum"
            )],
            now: fixture.date
        )
        job = try store.recordLaunched(jobID: job.id, now: fixture.date)
        #expect(job.state == .editing)

        let returned = fixture.root.appendingPathComponent("finished.tif")
        try Data("developed-one".utf8).write(to: returned)
        let receipt = try store.acceptReturnedFile(
            jobID: job.id,
            sourceURL: returned,
            now: fixture.date
        )

        #expect(receipt.destinationAssetID == "asset-1")
        #expect(!receipt.derivedAsset)
        #expect(try store.activeJob() == nil)
        #expect(try fixture.scalar("SELECT state FROM asset_source_versions WHERE version_id = '\(receipt.sourceVersionID)'") == "candidate")
        #expect(try fixture.scalar("SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "unreviewed")
        #expect(try fixture.scalar("SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'") == "not-ready")
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_lineage WHERE child_source_version_id = '\(receipt.sourceVersionID)'") == "1")
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_asset_locks") == "0")
        #expect(FileManager.default.fileExists(atPath: receipt.fileURL.path))
        #expect(FileManager.default.fileExists(atPath: job.workingDirectory.appendingPathComponent("manifest.json").path))
    }

    @Test("Several selected sources return as one derived asset with ordered lineage")
    func multipleSourceRoundTrip() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let store = fixture.store
        let job = try store.createJob(
            fixtureID: "fixture-expo",
            kind: .create,
            editor: fixture.editor,
            sources: [
                fixture.source(position: 0, assetID: "asset-1"),
                fixture.source(position: 1, assetID: "asset-2"),
            ],
            now: fixture.date
        )
        let inputs = try job.sources.map { source -> PhotoExportReceipt in
            let url = job.inputDirectory.appendingPathComponent("\(source.assetID).dng")
            let data = Data(source.assetID.utf8)
            try data.write(to: url)
            return PhotoExportReceipt(
                assetID: source.photoLibraryIdentifier,
                filename: url.lastPathComponent,
                destination: url,
                uniformTypeIdentifier: "com.adobe.raw-image",
                byteCount: Int64(data.count),
                checksumSHA256: "checksum-\(source.position)"
            )
        }
        _ = try store.recordPrepared(jobID: job.id, receipts: inputs, now: fixture.date)
        _ = try store.recordLaunched(jobID: job.id, now: fixture.date)
        let returned = fixture.root.appendingPathComponent("panorama.jpg")
        try Data("wide-panorama".utf8).write(to: returned)
        let receipt = try store.acceptReturnedFile(jobID: job.id, sourceURL: returned, now: fixture.date)

        #expect(receipt.derivedAsset)
        #expect(receipt.destinationAssetID.hasPrefix("derived-"))
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_lineage WHERE child_source_version_id = '\(receipt.sourceVersionID)'") == "2")
        #expect(try fixture.scalar("SELECT group_concat(parent_asset_id, ',') FROM external_edit_lineage WHERE child_source_version_id = '\(receipt.sourceVersionID)' ORDER BY parent_position") == "asset-1,asset-2")
        #expect(try fixture.scalar("SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = '\(receipt.destinationAssetID)'") == "picked")
        #expect(try fixture.scalar("SELECT metadata_state FROM sidecar_decisions WHERE asset_id = '\(receipt.destinationAssetID)'") == "unreviewed")
    }

    @Test("Only one active job exists and interrupted preparation recovers explicitly")
    func activeJobAndRecovery() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let store = fixture.store
        _ = try store.createJob(
            fixtureID: "fixture-expo",
            kind: .edit,
            editor: fixture.editor,
            sources: [fixture.source(position: 0, assetID: "asset-1")],
            now: fixture.date
        )
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_asset_locks") == "1")
        #expect(throws: ExternalEditJobError.self) {
            try store.createJob(
                fixtureID: "fixture-expo",
                kind: .edit,
                editor: fixture.editor,
                sources: [fixture.source(position: 0, assetID: "asset-2")],
                now: fixture.date
            )
        }
        #expect(try store.recoverInterruptedPreparation(now: fixture.date) == 1)
        #expect(try store.activeJob() == nil)
        #expect(try fixture.scalar("SELECT state FROM external_edit_jobs") == "failed")
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_asset_locks") == "0")
    }
}

private struct Fixture {
    let root: URL
    let databaseURL: URL
    let jobsRoot: URL
    let date = Date(timeIntervalSince1970: 1_800_000_000)

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("external-edit-\(UUID().uuidString)", isDirectory: true)
        databaseURL = root.appendingPathComponent("Owner.sqlite")
        jobsRoot = root.appendingPathComponent("Jobs", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var database: OpaquePointer?
        guard sqlite3_open(databaseURL.path, &database) == SQLITE_OK, let database else {
            throw ExternalEditJobError.databaseUnavailable
        }
        defer { sqlite3_close_v2(database) }
        guard sqlite3_exec(database, Self.schema, nil, nil, nil) == SQLITE_OK else {
            throw ExternalEditJobError.database(String(cString: sqlite3_errmsg(database)))
        }
    }

    var store: ExternalEditJobSQLiteStore {
        ExternalEditJobSQLiteStore(databaseURL: databaseURL, jobsRoot: jobsRoot)
    }

    var editor: ExternalEditorProfile {
        ExternalEditorProfile(
            name: "Fixture Editor",
            bundleIdentifier: "test.editor",
            applicationURL: URL(fileURLWithPath: "/Applications/Fixture Editor.app")
        )
    }

    func source(position: Int, assetID: String) -> ExternalEditSource {
        ExternalEditSource(
            position: position,
            assetID: assetID,
            sourceVersionID: "source-\(assetID)",
            photoLibraryIdentifier: "photos-\(assetID)",
            originalFilename: "\(assetID).dng"
        )
    }

    func scalar(_ sql: String) throws -> String {
        var database: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK,
              let database else { throw ExternalEditJobError.databaseUnavailable }
        defer { sqlite3_close_v2(database) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else { throw ExternalEditJobError.databaseUnavailable }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { return "" }
        return sqlite3_column_text(statement, 0).map(String.init(cString:)) ?? String(sqlite3_column_int64(statement, 0))
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    private static let schema = """
    PRAGMA foreign_keys = ON;
    CREATE TABLE fixtures(fixture_id TEXT PRIMARY KEY);
    INSERT INTO fixtures VALUES ('fixture-expo');
    CREATE TABLE sidecar_assets(
      asset_id TEXT PRIMARY KEY, source_anchor TEXT NOT NULL, media_type TEXT,
      filename TEXT, photos_title TEXT, photos_keywords_json TEXT NOT NULL DEFAULT '[]',
      location_keywords_json TEXT NOT NULL DEFAULT '[]', metadata_seed_keywords_json TEXT NOT NULL DEFAULT '[]',
      raw_json TEXT NOT NULL DEFAULT '{}', indexed_at TEXT, updated_at TEXT
    );
    INSERT INTO sidecar_assets(asset_id, source_anchor, media_type, filename) VALUES
      ('asset-1', 'apple-photos://asset-1', 'photo', 'one.dng'),
      ('asset-2', 'apple-photos://asset-2', 'photo', 'two.dng');
    CREATE TABLE sidecar_decisions(
      asset_id TEXT PRIMARY KEY, rating INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '',
      pick_state TEXT NOT NULL DEFAULT 'picked', metadata_state TEXT NOT NULL DEFAULT 'unreviewed',
      title TEXT, keywords_json TEXT NOT NULL DEFAULT '[]', last_action TEXT, created_at TEXT, updated_at TEXT,
      FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    INSERT INTO sidecar_decisions(asset_id, title) VALUES ('asset-1', 'One'), ('asset-2', 'Two');
    CREATE TABLE asset_editorial_state(
      asset_id TEXT PRIMARY KEY, editorial_state TEXT NOT NULL, ai_reasons_json TEXT NOT NULL DEFAULT '[]',
      ai_note TEXT NOT NULL DEFAULT '', ai_attempt_count INTEGER NOT NULL DEFAULT 0,
      ai_last_error TEXT NOT NULL DEFAULT '', requested_at TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT,
      FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    INSERT INTO asset_editorial_state(asset_id, editorial_state) VALUES ('asset-1', 'unreviewed'), ('asset-2', 'unreviewed');
    CREATE TABLE asset_delivery_state(
      asset_id TEXT PRIMARY KEY, delivery_state TEXT NOT NULL, source_version_hash TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT,
      FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    INSERT INTO asset_delivery_state(asset_id, delivery_state) VALUES ('asset-1', 'not-ready'), ('asset-2', 'not-ready');
    CREATE TABLE asset_source_versions(
      version_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, metadata_fingerprint TEXT NOT NULL DEFAULT '',
      rendered_fingerprint TEXT NOT NULL DEFAULT '', source_exists INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'candidate', created_at TEXT NOT NULL, approved_at TEXT, live_at TEXT, superseded_at TEXT,
      FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    INSERT INTO asset_source_versions(version_id, asset_id, state, created_at) VALUES
      ('source-asset-1', 'asset-1', 'candidate', '2026-01-01T00:00:00Z'),
      ('source-asset-2', 'asset-2', 'candidate', '2026-01-01T00:00:00Z');
    CREATE TABLE fixture_asset_placements(
      placement_id TEXT PRIMARY KEY, fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL,
      state TEXT NOT NULL, placed_at TEXT, updated_at TEXT,
      FOREIGN KEY(fixture_id) REFERENCES fixtures(fixture_id), FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    CREATE TABLE fixture_asset_decisions(
      fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL, placement_state TEXT NOT NULL,
      eligibility_state TEXT NOT NULL, source TEXT NOT NULL, last_action TEXT NOT NULL,
      created_at TEXT, updated_at TEXT, PRIMARY KEY(fixture_id, asset_id),
      FOREIGN KEY(fixture_id) REFERENCES fixtures(fixture_id), FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    INSERT INTO fixture_asset_decisions VALUES
      ('fixture-expo', 'asset-1', 'picked', 'active', 'native', '', '', ''),
      ('fixture-expo', 'asset-2', 'picked', 'active', 'native', '', '', '');
    CREATE TABLE sidecar_mock_uploads(
      asset_id TEXT PRIMARY KEY, mock_state TEXT NOT NULL, mock_run_id TEXT,
      uploaded_at TEXT, updated_at TEXT,
      FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    """
}
