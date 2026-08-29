import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("Owner equipment backfill")
struct OwnerEquipmentBackfillServiceTests {
    @Test("Batching is resumable, idempotent, and fixture-neutral")
    func resumableBackfill() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("equipment-backfill-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try createDatabase(at: databaseURL)

        let store = OwnerEquipmentBackfillSQLiteStore(databaseURL: databaseURL)
        let cache = OwnerCurrentEquipmentSQLiteStore(databaseURL: databaseURL)
        let library = EquipmentBackfillPhotoLibrary()
        let service = OwnerEquipmentBackfillService(
            store: store,
            cache: cache,
            photoLibrary: library
        )

        let first = try await service.runBatch(limit: 2)
        #expect(first.eligible == 5)
        #expect(first.processedThisPass == 2)
        #expect(first.updated == 2)
        #expect(first.remaining == 3)

        let second = try await service.runBatch(limit: 10)
        #expect(second.eligible == 5)
        #expect(second.processedThisPass == 3)
        #expect(second.updated == 2)
        #expect(second.skipped == 1)
        #expect(second.unavailable == 1)
        #expect(second.failed == 1)
        #expect(second.remaining == 0)

        let third = try await service.runBatch(limit: 10)
        #expect(third == OwnerEquipmentBackfillReport(
            eligible: 5,
            updated: 2,
            skipped: 1,
            unavailable: 1,
            failed: 1,
            remaining: 0,
            processedThisPass: 0
        ))

        try store.requeueUnavailableAndFailed()
        #expect(Set(try store.nextCandidates(limit: 10).map(\.assetID)) == ["asset-3", "asset-5"])
        #expect(try store.report().remaining == 2)

        let learned = try cache.values(assetIDs: ["asset-1", "asset-2", "known"])
        #expect(learned["asset-1"]?.cameraBody == "Canon PowerShot ELPH 300 HS")
        #expect(learned["asset-2"]?.cameraBody == "Apple iPhone 16 Plus")
        #expect(learned["known"] == OwnerCurrentEquipment(
            cameraBody: "Known Camera",
            lens: "Known Lens",
            focalLength: "50 mm"
        ))
        #expect(try scalar(databaseURL, sql: "SELECT placement_state FROM fixture_asset_decisions WHERE asset_id = 'asset-1'") == "hidden")
        #expect(try scalar(databaseURL, sql: "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "unreviewed")
        #expect(try scalar(databaseURL, sql: "SELECT photos_title FROM sidecar_assets WHERE asset_id = 'asset-1'") == "Original title")
    }

    @Test("Candidate enrollment resolves cloud and local PhotoKit identity")
    func candidateIdentity() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("equipment-identities-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try createDatabase(at: databaseURL)
        let store = OwnerEquipmentBackfillSQLiteStore(databaseURL: databaseURL)

        try store.enrollCurrentCandidates(now: Date(timeIntervalSince1970: 2_000_000_000))
        let candidates = try store.nextCandidates(limit: 10)
        #expect(candidates.contains(OwnerEquipmentBackfillCandidate(
            assetID: "asset-1",
            photoLibraryIdentifier: "11111111-1111-1111-1111-111111111111:001:AAAAAAAAAAAAAAAAAAAA"
        )))
        #expect(candidates.contains(OwnerEquipmentBackfillCandidate(
            assetID: "asset-2",
            photoLibraryIdentifier: "local-asset-2/L0/001"
        )))
        #expect(!candidates.contains(where: { $0.assetID == "known" }))
        #expect(!candidates.contains(where: { $0.assetID == "owner-placeholder" }))
        #expect(try scalar(
            databaseURL,
            sql: "SELECT count(*) FROM asset_equipment_backfill_state WHERE asset_id = 'owner-placeholder'"
        ) == "0")
    }

    @Test("Continuous backfill checkpoints, cancels, and resumes without replay")
    func continuousCancellationAndResume() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("equipment-continuous-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try createDatabase(at: databaseURL)
        let store = OwnerEquipmentBackfillSQLiteStore(databaseURL: databaseURL)
        let service = OwnerEquipmentBackfillService(
            store: store,
            cache: OwnerCurrentEquipmentSQLiteStore(databaseURL: databaseURL),
            photoLibrary: EquipmentBackfillPhotoLibrary()
        )
        let firstRun = EquipmentCheckpointRecorder(cancelAfter: 1)

        await #expect(throws: CancellationError.self) {
            _ = try await service.runUntilComplete(batchLimit: 2) { report in
                try await firstRun.record(report)
            }
        }
        #expect(await firstRun.processed == [2])
        #expect(try store.report().remaining == 3)

        let resumed = EquipmentCheckpointRecorder()
        let final = try await service.runUntilComplete(batchLimit: 2) { report in
            try await resumed.record(report)
        }
        #expect(await resumed.processed == [2, 1])
        #expect(final.processedThisPass == 1)
        #expect(final.remaining == 0)
        #expect(final.updated == 2)
        #expect(final.skipped == 1)
        #expect(final.unavailable == 1)
        #expect(final.failed == 1)
    }

    private func createDatabase(at url: URL) throws {
        var database: OpaquePointer?
        #expect(sqlite3_open(url.path, &database) == SQLITE_OK)
        defer { sqlite3_close_v2(database) }
        let sql = #"""
        CREATE TABLE sidecar_assets (
          asset_id TEXT PRIMARY KEY,
          source_anchor TEXT NOT NULL,
          media_type TEXT,
          captured_at TEXT,
          photos_title TEXT,
          missing_at TEXT,
          raw_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE fixture_asset_decisions (
          fixture_id TEXT,
          asset_id TEXT,
          placement_state TEXT,
          eligibility_state TEXT
        );
        CREATE TABLE asset_editorial_state (
          asset_id TEXT PRIMARY KEY,
          editorial_state TEXT
        );
        CREATE TABLE asset_current_equipment (
          asset_id TEXT PRIMARY KEY NOT NULL,
          camera_body TEXT NOT NULL DEFAULT '',
          lens TEXT NOT NULL DEFAULT '',
          focal_length TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
        INSERT INTO sidecar_assets VALUES
          ('asset-1', 'apple-photos-cloud://11111111-1111-1111-1111-111111111111:001:AAAAAAAAAAAAAAAAAAAA', 'photo', '2020-01-01', 'Original title', '', '{}'),
          ('asset-2', 'apple-photos://local-asset-2/L0/001', 'photo', '2020-01-02', '', '', '{"localIdentifier":"local-asset-2/L0/001"}'),
          ('asset-3', 'apple-photos://missing', 'photo', '2020-01-03', '', '', '{"localIdentifier":"missing"}'),
          ('asset-4', 'apple-photos://empty', 'photo', '2020-01-04', '', '', '{"localIdentifier":"empty"}'),
          ('asset-5', 'apple-photos://failed', 'photo', '2020-01-05', '', '', '{"localIdentifier":"failed"}'),
          ('known', 'apple-photos://known', 'photo', '2020-01-06', '', '', '{"localIdentifier":"known"}'),
          ('missing-source', 'apple-photos://gone', 'photo', '2020-01-07', '', '2026-01-01', '{"localIdentifier":"gone"}'),
          ('video', 'apple-photos://video', 'video', '2020-01-08', '', '', '{"localIdentifier":"video"}'),
          ('owner-placeholder', 'owner://asset/owner-placeholder', 'photo', '2020-01-09', '', '', '{}');
        INSERT INTO asset_current_equipment VALUES
          ('known', 'Known Camera', 'Known Lens', '50 mm', '2026-01-01');
        INSERT INTO fixture_asset_decisions VALUES ('expo', 'asset-1', 'hidden', 'active');
        INSERT INTO asset_editorial_state VALUES ('asset-1', 'unreviewed');
        CREATE TABLE asset_equipment_backfill_state (
          asset_id TEXT PRIMARY KEY NOT NULL,
          photo_library_identifier TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO asset_equipment_backfill_state VALUES
          ('owner-placeholder', 'owner://asset/owner-placeholder', 'unavailable', 1, 'stale', '2026-01-01', '2026-01-01');
        """#
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw TestDatabaseError.message(String(cString: sqlite3_errmsg(database)))
        }
    }

    private func scalar(_ url: URL, sql: String) throws -> String {
        var database: OpaquePointer?
        guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK,
              let database else { throw TestDatabaseError.message("open failed") }
        defer { sqlite3_close_v2(database) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement,
              sqlite3_step(statement) == SQLITE_ROW else {
            throw TestDatabaseError.message("query failed")
        }
        defer { sqlite3_finalize(statement) }
        return sqlite3_column_text(statement, 0).map(String.init(cString:)) ?? ""
    }
}

private struct EquipmentBackfillPhotoLibrary: PhotoLibraryServing {
    func authorization() -> PhotoLibraryAccess { .authorized }
    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }
    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }
    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        throw PhotoLibraryError.previewUnavailable(localIdentifier)
    }
    func equipmentMetadata(
        localIdentifier: String,
        allowICloudDownloads: Bool
    ) async throws -> OwnerCurrentEquipment {
        switch localIdentifier {
        case "11111111-1111-1111-1111-111111111111:001:AAAAAAAAAAAAAAAAAAAA":
            return OwnerCurrentEquipment(
                cameraBody: "Canon PowerShot ELPH 300 HS",
                lens: "Canon compact lens",
                focalLength: "4.3 mm / 24 mm equivalent"
            )
        case "local-asset-2/L0/001":
            return OwnerCurrentEquipment(cameraBody: "Apple iPhone 16 Plus")
        case "missing":
            throw PhotoLibraryError.assetNotFound(localIdentifier)
        case "empty":
            return OwnerCurrentEquipment()
        default:
            throw PhotoLibraryError.metadataFailed("Synthetic failure")
        }
    }
    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.exportFailed(localIdentifier)
    }
    func metadataReadMany(assetIDs: [String]) async throws -> Data { Data() }
    func metadataApplyMany(requests: [PhotoMetadataApplyRequest]) async throws -> Data { Data() }
}

private actor EquipmentCheckpointRecorder {
    private(set) var processed: [Int] = []
    private let cancelAfter: Int?

    init(cancelAfter: Int? = nil) {
        self.cancelAfter = cancelAfter
    }

    func record(_ report: OwnerEquipmentBackfillReport) throws {
        processed.append(report.processedThisPass)
        if processed.count == cancelAfter {
            throw CancellationError()
        }
    }
}

private enum TestDatabaseError: Error {
    case message(String)
}
