import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("Customer photo publication links")
struct CustomerPhotoLinkSQLiteStoreTests {
    @Test("Only the published media identity reaches the customer URL; reads leave the ledger unchanged")
    func verifiedLinkIsReadOnly() throws {
        let fixture = try CustomerLinkDatabase()
        defer { fixture.remove() }
        let before = try Data(contentsOf: fixture.url)
        let link = try fixture.store.resolve(assetID: "private-photos-id", fixtureID: "expo")
        #expect(link.url.absoluteString == "https://photos-by-elie.com/photo.html?id=public-123")
        #expect(try Data(contentsOf: fixture.url) == before)
        #expect(try FileManager.default.contentsOfDirectory(atPath: fixture.root.path) == ["Owner.sqlite"])
    }

    @Test("Uploaded, pending, failed, and mismatched source versions are not public evidence", arguments: [
        "UPDATE public_catalog_publications SET state = 'local'",
        "UPDATE public_catalog_publications SET state = 'pending'",
        "UPDATE public_catalog_publications SET state = 'failed'",
        "UPDATE public_catalog_publications SET source_version_hash = 'other'",
        "UPDATE asset_publications SET state = 'withdrawn'",
        "UPDATE asset_publications SET state = 'superseded'",
        "UPDATE asset_publications SET withdrawn_at = '2026-08-27T07:00:00Z'",
        "UPDATE fixtures SET archived_at = '2026-08-27T07:00:00Z'",
        "INSERT INTO sidecar_tombstones VALUES ('private-photos-id', 'active')",
        "INSERT INTO media_lifecycle VALUES ('public-123', 'hidden')",
        "INSERT INTO media_lifecycle VALUES ('public-123', 'discarded')"
    ])
    func rejectsNonPublicState(sql: String) throws {
        let fixture = try CustomerLinkDatabase()
        defer { fixture.remove() }
        try fixture.execute(sql)
        #expect(throws: CustomerPhotoLinkError.noVerifiedPublication) {
            try fixture.store.resolve(assetID: "private-photos-id", fixtureID: "expo")
        }
    }

    @Test("Incomplete or untrusted receipt fields fail closed", arguments: [
        "UPDATE public_catalog_publications SET verified_at = NULL",
        "UPDATE public_catalog_publications SET verified_at = 'not-a-date'",
        "UPDATE public_catalog_publications SET catalog_sha256 = ''",
        "UPDATE public_catalog_publications SET catalog_sha256 = 'not-a-digest'",
        "UPDATE public_catalog_publications SET public_url = 'https://example.test/catalog.sqlite'",
        "UPDATE public_catalog_publications SET public_url = 'http://photos-by-elie.com/assets/catalog/photosbyelie.sqlite'",
        "UPDATE public_catalog_publications SET public_url = 'https://photos-by-elie.com/owner.html?token=private'",
        "UPDATE public_catalog_publications SET media_id = ''",
        "UPDATE public_catalog_publications SET media_id = 'public-123' || char(0) || 'extra'"
    ])
    func rejectsInvalidReceipt(sql: String) throws {
        let fixture = try CustomerLinkDatabase()
        defer { fixture.remove() }
        try fixture.execute(sql)
        #expect(throws: CustomerPhotoLinkError.noVerifiedPublication) {
            try fixture.store.resolve(assetID: "private-photos-id", fixtureID: "expo")
        }
    }

    @Test("No filename, source-ID, or other-fixture fallback", arguments: [
        ("private-photos-id", "private-fixture"), ("IMG_123.jpg", "expo"),
        ("unknown", "expo"), ("' OR 1=1 --", "expo"), ("", "expo"), ("private-photos-id", ""),
        ("private-photos-id\u{0000}extra", "expo"), ("private-photos-id", "expo\u{0000}extra")
    ])
    func rejectsUnknownIdentity(identity: (String, String)) throws {
        let fixture = try CustomerLinkDatabase()
        defer { fixture.remove() }
        #expect(throws: CustomerPhotoLinkError.noVerifiedPublication) {
            try fixture.store.resolve(assetID: identity.0, fixtureID: identity.1)
        }
    }

    @Test("A newer local editorial version does not hide the previous verified live rendition")
    func retainsOldLiveVersion() throws {
        let fixture = try CustomerLinkDatabase()
        defer { fixture.remove() }
        try fixture.execute("""
            INSERT INTO public_catalog_publications
            SELECT asset_id, 'v2', 'public-456', 'local', public_url, catalog_sha256, NULL
            FROM public_catalog_publications;
            """)
        #expect(try fixture.store.resolve(assetID: "private-photos-id", fixtureID: "expo")
            .url.absoluteString.hasSuffix("id=public-123"))
        try fixture.execute("""
            INSERT INTO asset_publications VALUES ('private-photos-id', 'expo', 'v2', 'live', NULL);
            UPDATE public_catalog_publications SET state = 'live', verified_at = '2026-08-27T07:00:00Z';
            """)
        #expect(throws: CustomerPhotoLinkError.ambiguousPublication) {
            try fixture.store.resolve(assetID: "private-photos-id", fixtureID: "expo")
        }
    }

    @Test("Missing or older databases are not created or migrated")
    func failsClosedWithoutSchema() throws {
        let fixture = try CustomerLinkDatabase()
        defer { fixture.remove() }
        let missing = fixture.root.appendingPathComponent("missing.sqlite")
        #expect(throws: CustomerPhotoLinkError.unavailable) {
            try CustomerPhotoLinkSQLiteStore(databaseURL: missing).resolve(assetID: "a", fixtureID: "f")
        }
        #expect(!FileManager.default.fileExists(atPath: missing.path))
        try fixture.execute("DROP TABLE public_catalog_publications")
        let before = try Data(contentsOf: fixture.url)
        #expect(throws: CustomerPhotoLinkError.unavailable) {
            try fixture.store.resolve(assetID: "private-photos-id", fixtureID: "expo")
        }
        #expect(try Data(contentsOf: fixture.url) == before)
    }

    @Test("Published IDs are encoded as one query value, never interpreted as authority", arguments: [
        "public+id", "x&gallery=pbe-owner#secret", "https://example.test/?token=x", "写真/1 %value"
    ])
    func queryEncoding(mediaID: String) throws {
        let link = try CustomerPhotoLink(publishedMediaID: mediaID)
        let parts = try #require(URLComponents(url: link.url, resolvingAgainstBaseURL: false))
        #expect(parts.scheme == "https")
        #expect(parts.host == "photos-by-elie.com")
        #expect(parts.path == "/photo.html")
        #expect(parts.fragment == nil && parts.user == nil && parts.password == nil)
        #expect(parts.queryItems == [URLQueryItem(name: "id", value: mediaID)])
        #expect(!link.url.absoluteString.contains("+"))
    }
}

private struct CustomerLinkDatabase {
    let root: URL
    var url: URL { root.appendingPathComponent("Owner.sqlite") }
    var store: CustomerPhotoLinkSQLiteStore { .init(databaseURL: url) }

    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("customer-link-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        do {
            try execute("""
                CREATE TABLE fixtures (fixture_id TEXT PRIMARY KEY, archived_at TEXT);
                CREATE TABLE asset_publications (
                    asset_id TEXT, fixture_id TEXT, source_version_hash TEXT, state TEXT, withdrawn_at TEXT
                );
                CREATE TABLE public_catalog_publications (
                    asset_id TEXT, source_version_hash TEXT, media_id TEXT, state TEXT,
                    public_url TEXT, catalog_sha256 TEXT, verified_at TEXT
                );
                CREATE TABLE sidecar_tombstones (asset_id TEXT, tombstone_state TEXT);
                CREATE TABLE media_lifecycle (media_id TEXT, lifecycle_state TEXT);
                INSERT INTO fixtures VALUES ('expo', NULL);
                INSERT INTO asset_publications VALUES ('private-photos-id', 'expo', 'v1', 'live', NULL);
                INSERT INTO public_catalog_publications VALUES (
                    'private-photos-id', 'v1', 'public-123', 'live',
                    'https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite',
                    '\(String(repeating: "a", count: 64))', '2026-08-27T07:00:00.000Z'
                );
                """)
        } catch {
            remove()
            throw error
        }
    }

    func remove() { try? FileManager.default.removeItem(at: root) }

    func execute(_ sql: String) throws {
        var database: OpaquePointer?
        guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else {
            if let database { sqlite3_close(database) }
            throw CustomerPhotoLinkError.unavailable
        }
        defer { sqlite3_close(database) }
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
        }
    }
}
