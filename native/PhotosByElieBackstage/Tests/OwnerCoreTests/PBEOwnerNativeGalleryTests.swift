import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("PBE Owner native gallery")
struct PBEOwnerNativeGalleryTests {
    @Test("Gallery is a bounded read-only picked and hidden photo window for the frozen fixture")
    func pickedFixtureWindow() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pbe-native-gallery-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = root.appendingPathComponent("Owner.sqlite")
        try createOwnerDatabase(at: owner)

        let gallery = try await PBEOwnerNativeGalleryService(
            ownerDatabaseURL: owner
        ).gallery(session: session())

        #expect(gallery.ok)
        #expect(gallery.readOnly)
        #expect(gallery.fixtureId == "expo")
        #expect(gallery.fixtureBreadcrumb == "Root / Expo")
        #expect(gallery.view == "all-active")
        #expect(gallery.count == 3)
        #expect(gallery.summary.filtered == 3)
        #expect(gallery.summary.universe == 4)
        #expect(gallery.summary.undecided == 1)
        #expect(gallery.summary.picked == 2)
        #expect(gallery.summary.hidden == 1)
        #expect(gallery.items.map(\.assetId) == ["picked-photo", "picked-unreviewed", "fixture-hidden"])
        #expect(gallery.items.first?.keywords == ["Approved", "Expo"])
        #expect(gallery.items[1].keywords == ["Photos"])
        #expect(gallery.items.last?.placementState == "hidden")
        #expect(!gallery.truncated)
    }

    @Test("Missing and archived fixture galleries fail closed without paths")
    func galleryFailures() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pbe-native-gallery-failure-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = root.appendingPathComponent("Owner.sqlite")
        let service = PBEOwnerNativeGalleryService(ownerDatabaseURL: owner)

        await expectFailure(code: "pbe_owner_fixture_unavailable", root: root) {
            _ = try await service.gallery(session: session())
        }
        try createOwnerDatabase(at: owner)
        try execute(at: owner, sql: "UPDATE fixtures SET archived_at = 'now' WHERE fixture_id = 'expo'")
        await expectFailure(code: "pbe_owner_fixture_unavailable", root: root) {
            _ = try await service.gallery(session: session())
        }
    }

    @Test("Frozen session reuses one gallery snapshot across browser consumers")
    func frozenSessionGalleryCache() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pbe-native-gallery-cache-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = root.appendingPathComponent("Owner.sqlite")
        try createOwnerDatabase(at: owner)
        let service = PBEOwnerNativeGalleryService(ownerDatabaseURL: owner)

        let first = try await service.gallery(session: session())
        try execute(
            at: owner,
            sql: "DELETE FROM fixture_asset_decisions WHERE asset_id = 'picked-photo'"
        )
        let sameFrozenSession = try await service.gallery(session: session())
        var nextSession = session()
        nextSession.id = "session-two"
        nextSession.fixtureRevision = "revision-two"
        let refreshedSession = try await service.gallery(session: nextSession)

        #expect(first.items.map(\.assetId) == ["picked-photo", "picked-unreviewed", "fixture-hidden"])
        #expect(sameFrozenSession == first)
        #expect(refreshedSession.items.map(\.assetId) == ["picked-unreviewed", "fixture-hidden"])
    }

    private func session() -> PBEOwnerSessionContract {
        PBEOwnerSessionContract(
            id: "session-one",
            state: "ready",
            fixtureId: "expo",
            fixtureBreadcrumb: "Root / Expo",
            sourceIdentity: "source-one",
            catalogIdentity: "catalog-one",
            readinessIdentity: "readiness-one",
            fixtureRevision: "revision-one",
            capabilities: ["gallery.read", "waste-basket.x", "waste-basket.restore"],
            lifecycleWriter: "pbb-79-waste-basket",
            createdAt: nil,
            expiresAt: Date().addingTimeInterval(300),
            closedAt: nil,
            leaseExpiresAt: nil
        )
    }

    private func expectFailure(
        code: String,
        root: URL,
        operation: () async throws -> Void
    ) async {
        do {
            try await operation()
            Issue.record("Expected gallery failure \(code)")
        } catch let failure as PBEOwnerNativeSessionFailure {
            #expect(failure.code == code)
            #expect(!failure.message.contains(root.path))
        } catch {
            Issue.record("Unexpected gallery error: \(error)")
        }
    }

    private func createOwnerDatabase(at url: URL) throws {
        try execute(
            at: url,
            sql: """
            CREATE TABLE fixtures (
              fixture_id TEXT PRIMARY KEY, parent_fixture_id TEXT,
              candidate_mode TEXT, archived_at TEXT
            );
            CREATE TABLE sidecar_assets (
              asset_id TEXT PRIMARY KEY, source_anchor TEXT, raw_json TEXT,
              filename TEXT, media_type TEXT, captured_at TEXT,
              photos_title TEXT, photos_keywords_json TEXT,
              location_label TEXT, location_keywords_json TEXT,
              pixel_width INTEGER, pixel_height INTEGER, missing_at TEXT
            );
            CREATE TABLE fixture_asset_decisions (
              fixture_id TEXT, asset_id TEXT, placement_state TEXT,
              eligibility_state TEXT
            );
            CREATE TABLE sidecar_decisions (
              asset_id TEXT PRIMARY KEY, title TEXT, keywords_json TEXT,
              rating INTEGER, color TEXT, metadata_state TEXT, pick_state TEXT
            );
            CREATE TABLE sidecar_tombstones (asset_id TEXT, tombstone_state TEXT);
            CREATE TABLE sidecar_upload_bridge_run_items (
              asset_id TEXT, upload_keys_json TEXT, updated_at TEXT
            );
            INSERT INTO fixtures VALUES ('expo', NULL, 'curated', NULL);

            INSERT INTO sidecar_assets VALUES
              ('picked-photo', 'apple-photos://picked-photo', '{}', 'picked.jpg', 'photo',
               '2026-08-22T10:00:00Z', 'Picked', '["Photos"]', 'Madrid', '[]', 6000, 4000, NULL),
              ('picked-unreviewed', 'apple-photos://picked-unreviewed', '{}', 'unreviewed-picked.jpg', 'photo',
               '2026-08-22T09:30:00Z', 'Unreviewed picked', '["Photos"]', '', '[]', 4000, 3000, NULL),
              ('undecided-photo', 'apple-photos://undecided-photo', '{}', 'undecided.jpg', 'photo',
               '2026-08-22T09:00:00Z', 'Undecided', '[]', '', '[]', 4000, 3000, NULL),
              ('fixture-hidden', 'apple-photos://fixture-hidden', '{}', 'fixture-hidden.jpg', 'photo',
               '2026-08-22T08:30:00Z', 'Fixture hidden', '[]', '', '[]', 4000, 3000, NULL),
              ('global-hidden', 'apple-photos://global-hidden', '{}', 'hidden.jpg', 'photo',
               '2026-08-22T08:00:00Z', 'Hidden', '[]', '', '[]', 4000, 3000, NULL),
              ('picked-video', 'apple-photos://picked-video', '{}', 'video.mov', 'video',
               '2026-08-22T07:00:00Z', 'Video', '[]', '', '[]', 1920, 1080, NULL),
              ('tombstoned-photo', 'apple-photos://tombstoned-photo', '{}', 'trash.jpg', 'photo',
               '2026-08-22T06:00:00Z', 'Trash', '[]', '', '[]', 4000, 3000, NULL),
              ('missing-photo', 'apple-photos://missing-photo', '{}', 'missing.jpg', 'photo',
               '2026-08-22T05:00:00Z', 'Missing', '[]', '', '[]', 4000, 3000, 'now');

            INSERT INTO fixture_asset_decisions VALUES
              ('expo', 'picked-photo', 'picked', 'active'),
              ('expo', 'picked-unreviewed', 'picked', 'active'),
              ('expo', 'fixture-hidden', 'hidden', 'active'),
              ('expo', 'global-hidden', 'picked', 'active'),
              ('expo', 'picked-video', 'picked', 'active'),
              ('expo', 'tombstoned-photo', 'picked', 'active'),
              ('expo', 'missing-photo', 'picked', 'active');
            INSERT INTO sidecar_decisions VALUES
              ('picked-photo', 'Approved title', '["Approved","Expo"]', 4, 'red', 'approved', 'picked'),
              ('picked-unreviewed', 'Stale title', '["Stale"]', 0, '', 'unreviewed', 'picked'),
              ('global-hidden', '', '[]', 0, '', 'unreviewed', 'hidden');
            INSERT INTO sidecar_tombstones VALUES ('tombstoned-photo', 'active');
            """
        )
    }

    private func execute(at url: URL, sql: String) throws {
        var database: OpaquePointer?
        guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else {
            throw NSError(domain: "PBEOwnerNativeGalleryTests", code: 1)
        }
        defer { sqlite3_close(database) }
        var message: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(database, sql, nil, nil, &message) == SQLITE_OK else {
            let detail = message.map { String(cString: $0) } ?? "SQLite test setup failed"
            sqlite3_free(message)
            throw NSError(
                domain: "PBEOwnerNativeGalleryTests",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: detail]
            )
        }
    }
}
