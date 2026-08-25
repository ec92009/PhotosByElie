import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("PBE Owner native readiness")
struct PBEOwnerNativeReadinessTests {
    @Test("Readiness binds file identity and fixture content without lifecycle churn")
    func identityAndFixtureRevision() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pbe-native-readiness-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = root.appendingPathComponent("Owner.sqlite")
        let catalog = root.appendingPathComponent("photosbyelie.sqlite")
        try createOwnerDatabase(at: owner)
        try createCatalogDatabase(at: catalog)
        let service = PBEOwnerNativeReadinessService(
            ownerDatabaseURL: owner,
            catalogDatabaseURL: catalog
        )

        let initial = try await service.readiness(fixtureID: " expo ")
        #expect(initial.ready)
        #expect(matchesOpaqueIdentity(initial.sourceIdentity, prefix: "owner-sqlite:sha256:"))
        #expect(matchesOpaqueIdentity(initial.catalogIdentity, prefix: "catalog-sqlite:sha256:"))
        #expect(matchesOpaqueIdentity(initial.readinessIdentity, prefix: "pbe-readiness:sha256:"))
        #expect(matchesOpaqueIdentity(initial.fixtureRevision, prefix: "fixture-revision:sha256:"))
        #expect(!String(describing: initial).contains(root.path))

        let extended = try await PBEOwnerNativeReadinessService(
            ownerDatabaseURL: owner,
            catalogDatabaseURL: catalog,
            additionalCapabilities: ["fixture.hide", "fixture.review"]
        ).readiness(fixtureID: "expo")
        #expect(Set(extended.capabilities) == Set(
            initial.capabilities + ["fixture.hide", "fixture.review"]
        ))

        let alias = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pbe-native-readiness-alias-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createSymbolicLink(
            atPath: alias.path,
            withDestinationPath: root.path
        )
        defer { try? FileManager.default.removeItem(at: alias) }
        let aliasReadiness = try await PBEOwnerNativeReadinessService(
            ownerDatabaseURL: alias.appendingPathComponent("Owner.sqlite"),
            catalogDatabaseURL: alias.appendingPathComponent("photosbyelie.sqlite")
        ).readiness(fixtureID: "expo")
        #expect(aliasReadiness == initial)

        try execute(
            at: owner,
            sql: """
            INSERT INTO owner_settings VALUES ('last_action', 'recoverable X');
            INSERT INTO media_lifecycle VALUES ('asset-one', 'hidden');
            """
        )
        let lifecycleChanged = try await service.readiness(fixtureID: "expo")
        #expect(lifecycleChanged.sourceIdentity == initial.sourceIdentity)
        #expect(lifecycleChanged.fixtureRevision == initial.fixtureRevision)
        #expect(lifecycleChanged.readinessIdentity == initial.readinessIdentity)

        try execute(
            at: owner,
            sql: """
            INSERT INTO sidecar_assets VALUES (
              'asset-two', 'apple-photos://asset-two', 'photo', 'two.jpg',
              '2026-08-13T12:01:00Z', '', 4000, 3000, 0, 'Two', '[]',
              '', '[]', 'Two', '[]', NULL
            );
            INSERT INTO fixture_asset_decisions VALUES (
              'expo', 'asset-two', 'picked', 'active', 'native'
            );
            """
        )
        let membershipChanged = try await service.readiness(fixtureID: "expo")
        #expect(membershipChanged.sourceIdentity == initial.sourceIdentity)
        #expect(membershipChanged.fixtureRevision != initial.fixtureRevision)
        #expect(membershipChanged.readinessIdentity != initial.readinessIdentity)

        let replacement = root.appendingPathComponent("Owner.replacement.sqlite")
        try FileManager.default.copyItem(at: owner, to: replacement)
        try FileManager.default.removeItem(at: owner)
        try FileManager.default.moveItem(at: replacement, to: owner)
        let ownerReplaced = try await service.readiness(fixtureID: "expo")
        #expect(ownerReplaced.sourceIdentity != membershipChanged.sourceIdentity)
        #expect(ownerReplaced.catalogIdentity == membershipChanged.catalogIdentity)

        let catalogReplacement = root.appendingPathComponent("catalog.replacement.sqlite")
        try createCatalogDatabase(at: catalogReplacement)
        try FileManager.default.removeItem(at: catalog)
        try FileManager.default.moveItem(at: catalogReplacement, to: catalog)
        let catalogRebuilt = try await service.readiness(fixtureID: "expo")
        #expect(catalogRebuilt.catalogIdentity == ownerReplaced.catalogIdentity)
    }

    @Test("Missing, incomplete, and archived readiness sources fail closed")
    func readinessFailures() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pbe-native-readiness-failure-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = root.appendingPathComponent("Owner.sqlite")
        let catalog = root.appendingPathComponent("photosbyelie.sqlite")
        try createOwnerDatabase(at: owner)
        try createCatalogDatabase(at: catalog)
        let service = PBEOwnerNativeReadinessService(
            ownerDatabaseURL: owner,
            catalogDatabaseURL: catalog
        )

        await expectReadinessFailure(code: "pbe_owner_fixture_required") {
            _ = try await service.readiness(fixtureID: "")
        }
        let incompleteCatalog = root.appendingPathComponent("catalog.incomplete.sqlite")
        try execute(
            at: incompleteCatalog,
            sql: "CREATE TABLE collections (collection_id INTEGER PRIMARY KEY, slug TEXT)"
        )
        try FileManager.default.removeItem(at: catalog)
        try FileManager.default.moveItem(at: incompleteCatalog, to: catalog)
        await expectReadinessFailure(code: "pbe_owner_host_not_ready") {
            _ = try await service.readiness(fixtureID: "expo")
        }
        try FileManager.default.removeItem(at: catalog)
        try createCatalogDatabase(at: catalog)
        try execute(at: owner, sql: "UPDATE fixtures SET archived_at = 'now' WHERE fixture_id = 'expo'")
        await expectReadinessFailure(code: "pbe_owner_fixture_unavailable") {
            _ = try await service.readiness(fixtureID: "expo")
        }
        try FileManager.default.removeItem(at: catalog)
        await expectReadinessFailure(code: "pbe_owner_host_not_ready") {
            _ = try await service.readiness(fixtureID: "expo")
        }
    }

    @Test("Readiness sees a current WAL snapshot without becoming a writer")
    func openWALSnapshot() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pbe-native-readiness-wal-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = root.appendingPathComponent("Owner.sqlite")
        let catalog = root.appendingPathComponent("photosbyelie.sqlite")
        try createOwnerDatabase(at: owner)
        try createCatalogDatabase(at: catalog)

        var writer: OpaquePointer?
        guard sqlite3_open(owner.path, &writer) == SQLITE_OK, let writer else {
            throw NSError(domain: "PBEOwnerNativeReadinessTests", code: 3)
        }
        defer { sqlite3_close(writer) }
        guard sqlite3_exec(
            writer,
            "PRAGMA journal_mode = WAL; INSERT INTO owner_settings VALUES ('fixture', 'expo')",
            nil,
            nil,
            nil
        ) == SQLITE_OK else {
            throw NSError(domain: "PBEOwnerNativeReadinessTests", code: 4)
        }

        let readiness = try await PBEOwnerNativeReadinessService(
            ownerDatabaseURL: owner,
            catalogDatabaseURL: catalog
        ).readiness(fixtureID: "expo")
        #expect(readiness.ready)
        #expect(sqlite3_db_readonly(writer, "main") == 0)
    }

    private func matchesOpaqueIdentity(_ value: String, prefix: String) -> Bool {
        value.range(
            of: "^\(NSRegularExpression.escapedPattern(for: prefix))[0-9a-f]{64}$",
            options: .regularExpression
        ) != nil
    }

    private func expectReadinessFailure(
        code: String,
        operation: () async throws -> Void
    ) async {
        do {
            try await operation()
            Issue.record("Expected readiness failure \(code)")
        } catch let failure as PBEOwnerNativeSessionFailure {
            #expect(failure.code == code)
        } catch {
            Issue.record("Unexpected readiness error: \(error)")
        }
    }

    private func createOwnerDatabase(at url: URL) throws {
        try execute(
            at: url,
            sql: """
            CREATE TABLE owner_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
            CREATE TABLE media_lifecycle (asset_id TEXT PRIMARY KEY, state TEXT);
            CREATE TABLE fixtures (
              fixture_id TEXT PRIMARY KEY, parent_fixture_id TEXT, name TEXT,
              slug TEXT, template_key TEXT, tags_json TEXT,
              destination_defaults_json TEXT, access_gallery_key TEXT,
              archived_at TEXT
            );
            CREATE TABLE sidecar_assets (
              asset_id TEXT PRIMARY KEY, source_anchor TEXT, media_type TEXT,
              filename TEXT, captured_at TEXT, modified_at TEXT,
              pixel_width INTEGER, pixel_height INTEGER, duration REAL,
              photos_title TEXT, photos_keywords_json TEXT, location_label TEXT,
              location_keywords_json TEXT, metadata_seed_title TEXT,
              metadata_seed_keywords_json TEXT, missing_at TEXT
            );
            CREATE TABLE fixture_asset_decisions (
              fixture_id TEXT, asset_id TEXT, placement_state TEXT,
              eligibility_state TEXT, source TEXT
            );
            CREATE TABLE asset_source_versions (
              asset_id TEXT, version_id TEXT, metadata_fingerprint TEXT,
              rendered_fingerprint TEXT, source_exists INTEGER, state TEXT
            );
            INSERT INTO fixtures VALUES (
              'expo', NULL, 'Expo', 'expo', 'gallery', '[]', '{}', 'expo', NULL
            );
            INSERT INTO sidecar_assets VALUES (
              'asset-one', 'apple-photos://asset-one', 'photo', 'one.jpg',
              '2026-08-13T12:00:00Z', '', 6000, 4000, 0, 'One', '["Spain"]',
              'Malaga', '["Spain"]', 'One', '["Spain"]', NULL
            );
            INSERT INTO fixture_asset_decisions VALUES (
              'expo', 'asset-one', 'picked', 'active', 'native'
            );
            INSERT INTO asset_source_versions VALUES (
              'asset-one', 'version-one', 'meta-one', 'render-one', 1, 'live'
            );
            """
        )
    }

    private func createCatalogDatabase(at url: URL) throws {
        try execute(
            at: url,
            sql: """
            CREATE TABLE collections (collection_id INTEGER PRIMARY KEY, slug TEXT);
            CREATE TABLE media_items (media_id TEXT PRIMARY KEY, collection_id INTEGER);
            """
        )
    }

    private func execute(at url: URL, sql: String) throws {
        var database: OpaquePointer?
        guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else {
            throw NSError(domain: "PBEOwnerNativeReadinessTests", code: 1)
        }
        defer { sqlite3_close(database) }
        var message: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(database, sql, nil, nil, &message) == SQLITE_OK else {
            let detail = message.map { String(cString: $0) } ?? "SQLite test setup failed"
            sqlite3_free(message)
            throw NSError(
                domain: "PBEOwnerNativeReadinessTests",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: detail]
            )
        }
    }
}
