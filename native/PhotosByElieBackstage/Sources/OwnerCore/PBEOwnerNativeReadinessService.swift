import CryptoKit
import Foundation
import SQLite3

public struct PBEOwnerNativeReadinessService: Sendable {
    public let ownerDatabaseURL: URL
    public let catalogDatabaseURL: URL
    public let busyTimeoutMilliseconds: Int32

    public init(
        ownerDatabaseURL: URL,
        catalogDatabaseURL: URL,
        busyTimeoutMilliseconds: Int32 = 2_000
    ) {
        self.ownerDatabaseURL = ownerDatabaseURL.standardizedFileURL.resolvingSymlinksInPath()
        self.catalogDatabaseURL = catalogDatabaseURL.standardizedFileURL.resolvingSymlinksInPath()
        self.busyTimeoutMilliseconds = max(0, busyTimeoutMilliseconds)
    }

    public init(dataRoot: URL, busyTimeoutMilliseconds: Int32 = 2_000) {
        self.init(
            ownerDatabaseURL: dataRoot.appendingPathComponent(
                "assets/owner-actions/Owner.sqlite",
                isDirectory: false
            ),
            catalogDatabaseURL: dataRoot.appendingPathComponent(
                "assets/catalog/photosbyelie.sqlite",
                isDirectory: false
            ),
            busyTimeoutMilliseconds: busyTimeoutMilliseconds
        )
    }

    public func readiness(fixtureID: String) async throws -> PBEOwnerHostReadiness {
        let service = self
        return try await Task.detached(priority: .userInitiated) {
            try service.readinessSynchronously(fixtureID: fixtureID)
        }.value
    }

    public func provider() -> @Sendable (String) async throws -> PBEOwnerHostReadiness {
        { fixtureID in try await self.readiness(fixtureID: fixtureID) }
    }

    private func readinessSynchronously(fixtureID: String) throws -> PBEOwnerHostReadiness {
        let fixtureID = clean(fixtureID)
        guard !fixtureID.isEmpty else {
            throw failure(
                "pbe_owner_fixture_required",
                400,
                "PBE Owner readiness requires an explicit fixture."
            )
        }
        let owner = try NativeReadinessSQLiteConnection(
            url: ownerDatabaseURL,
            busyTimeoutMilliseconds: busyTimeoutMilliseconds
        )
        let catalog = try NativeReadinessSQLiteConnection(
            url: catalogDatabaseURL,
            busyTimeoutMilliseconds: busyTimeoutMilliseconds
        )

        let sourceIdentity = "owner-sqlite:sha256:" + (try sqliteIdentity(
            connection: owner,
            url: ownerDatabaseURL,
            requiredTables: ["media_lifecycle", "owner_settings"],
            bindFileObject: true
        ))
        let catalogIdentity = "catalog-sqlite:sha256:" + (try sqliteIdentity(
            connection: catalog,
            url: catalogDatabaseURL,
            requiredTables: ["collections", "media_items"],
            bindFileObject: false
        ))
        let fixtureRevision = try fixtureRevision(connection: owner, fixtureID: fixtureID)
        let readinessIdentity = "pbe-readiness:sha256:" + hash(Data(
            "\(sourceIdentity)\n\(catalogIdentity)\n\(fixtureRevision)".utf8
        ))
        return PBEOwnerHostReadiness(
            ready: true,
            sourceIdentity: sourceIdentity,
            catalogIdentity: catalogIdentity,
            readinessIdentity: readinessIdentity,
            fixtureRevision: fixtureRevision,
            lifecycleWriter: "pbb-79-waste-basket",
            capabilities: ["gallery.read", "waste-basket.x", "waste-basket.restore"]
        )
    }

    private func sqliteIdentity(
        connection: NativeReadinessSQLiteConnection,
        url: URL,
        requiredTables: [String],
        bindFileObject: Bool
    ) throws -> String {
        let placeholders = Array(repeating: "?", count: requiredTables.count)
            .joined(separator: ",")
        let rows = try connection.query(
            """
            SELECT name, COALESCE(sql, '') AS sql
            FROM sqlite_master
            WHERE type = 'table' AND name IN (\(placeholders))
            ORDER BY name
            """,
            bindings: requiredTables
        )
        guard Set(rows.compactMap { $0["name"] as? String }) == Set(requiredTables) else {
            throw failure(
                "pbe_owner_host_not_ready",
                503,
                "PBE Owner host is unavailable because a required SQLite schema is incomplete."
            )
        }
        var payload: [String: Any] = [
            "path": url.path,
            "schema": rows,
        ]
        if bindFileObject {
            let attributes: [FileAttributeKey: Any]
            do {
                attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            } catch {
                throw failure(
                    "pbe_owner_host_not_ready",
                    503,
                    "PBE Owner host is unavailable because a required SQLite source is unreadable."
                )
            }
            guard let device = attributes[.systemNumber] as? NSNumber,
                  let inode = attributes[.systemFileNumber] as? NSNumber else {
                throw failure(
                    "pbe_owner_host_not_ready",
                    503,
                    "PBE Owner host cannot identify its Owner SQLite file object."
                )
            }
            payload["device"] = device
            payload["inode"] = inode
        }
        return hash(try canonicalData(payload))
    }

    private func fixtureRevision(
        connection: NativeReadinessSQLiteConnection,
        fixtureID: String
    ) throws -> String {
        let fixtures = try connection.query(
            """
            SELECT fixture_id, parent_fixture_id, name, slug, template_key,
                   tags_json, destination_defaults_json, access_gallery_key,
                   archived_at
            FROM fixtures WHERE fixture_id = ?
            """,
            bindings: [fixtureID]
        )
        guard let fixture = fixtures.first,
              clean(fixture["archived_at"] as? String ?? "").isEmpty else {
            throw failure(
                "pbe_owner_fixture_unavailable",
                409,
                "The requested PBE Owner fixture is missing or archived."
            )
        }
        let members = try connection.query(
            """
            SELECT d.asset_id, d.placement_state, d.eligibility_state, d.source,
                   a.source_anchor, a.media_type, a.filename, a.captured_at,
                   a.modified_at, a.pixel_width, a.pixel_height, a.duration,
                   a.photos_title, a.photos_keywords_json, a.location_label,
                   a.location_keywords_json, a.metadata_seed_title,
                   a.metadata_seed_keywords_json, a.missing_at
            FROM fixture_asset_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            WHERE d.fixture_id = ?
            ORDER BY d.asset_id
            """,
            bindings: [fixtureID]
        )
        let versions = try connection.query(
            """
            SELECT v.asset_id, v.version_id, v.metadata_fingerprint,
                   v.rendered_fingerprint, v.source_exists, v.state
            FROM asset_source_versions AS v
            JOIN fixture_asset_decisions AS d ON d.asset_id = v.asset_id
            WHERE d.fixture_id = ?
            ORDER BY v.asset_id, v.version_id
            """,
            bindings: [fixtureID]
        )
        let payload: [String: Any] = [
            "fixture": fixture,
            "members": members,
            "sourceVersions": versions,
        ]
        return "fixture-revision:sha256:" + hash(try canonicalData(payload))
    }

    private func canonicalData(_ payload: Any) throws -> Data {
        guard JSONSerialization.isValidJSONObject(payload) else {
            throw failure(
                "pbe_owner_host_not_ready",
                503,
                "PBE Owner host could not canonicalize its SQLite identity."
            )
        }
        do {
            return try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        } catch {
            throw failure(
                "pbe_owner_host_not_ready",
                503,
                "PBE Owner host could not canonicalize its SQLite identity."
            )
        }
    }

    private func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func clean(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func failure(
        _ code: String,
        _ statusCode: Int,
        _ message: String
    ) -> PBEOwnerNativeSessionFailure {
        PBEOwnerNativeSessionFailure(
            code: code,
            statusCode: statusCode,
            message: message
        )
    }
}

private final class NativeReadinessSQLiteConnection: @unchecked Sendable {
    private var database: OpaquePointer?

    init(url: URL, busyTimeoutMilliseconds: Int32) throws {
        var connection: OpaquePointer?
        let result = sqlite3_open_v2(
            url.path,
            &connection,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard result == SQLITE_OK, let connection else {
            if let connection { sqlite3_close(connection) }
            throw PBEOwnerNativeSessionFailure(
                code: "pbe_owner_host_not_ready",
                statusCode: 503,
                message: "PBE Owner host is unavailable because a required SQLite source is unreadable."
            )
        }
        database = connection
        sqlite3_busy_timeout(connection, busyTimeoutMilliseconds)
        guard sqlite3_exec(connection, "PRAGMA query_only = ON", nil, nil, nil) == SQLITE_OK else {
            sqlite3_close(connection)
            database = nil
            throw PBEOwnerNativeSessionFailure(
                code: "pbe_owner_host_not_ready",
                statusCode: 503,
                message: "PBE Owner host could not enforce query-only SQLite access."
            )
        }
    }

    deinit { if let database { sqlite3_close(database) } }

    func query(_ sql: String, bindings: [String] = []) throws -> [[String: Any]] {
        guard let database else { throw sqliteFailure("SQLite connection is closed.") }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw sqliteFailure(String(cString: sqlite3_errmsg(database)))
        }
        defer { sqlite3_finalize(statement) }
        for (offset, value) in bindings.enumerated() {
            let result = value.withCString { pointer in
                sqlite3_bind_text(
                    statement,
                    Int32(offset + 1),
                    pointer,
                    -1,
                    unsafeBitCast(-1, to: sqlite3_destructor_type.self)
                )
            }
            guard result == SQLITE_OK else {
                throw sqliteFailure(String(cString: sqlite3_errmsg(database)))
            }
        }
        var rows: [[String: Any]] = []
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                var row: [String: Any] = [:]
                for index in 0..<sqlite3_column_count(statement) {
                    let name = String(cString: sqlite3_column_name(statement, index))
                    row[name] = try value(statement, column: index)
                }
                rows.append(row)
            case SQLITE_DONE:
                return rows
            default:
                throw sqliteFailure(String(cString: sqlite3_errmsg(database)))
            }
        }
    }

    private func value(_ statement: OpaquePointer, column: Int32) throws -> Any {
        switch sqlite3_column_type(statement, column) {
        case SQLITE_NULL:
            return NSNull()
        case SQLITE_INTEGER:
            return NSNumber(value: sqlite3_column_int64(statement, column))
        case SQLITE_FLOAT:
            return NSNumber(value: sqlite3_column_double(statement, column))
        case SQLITE_TEXT:
            guard let text = sqlite3_column_text(statement, column) else { return "" }
            return String(cString: text)
        default:
            throw sqliteFailure("PBE Owner readiness does not accept SQLite BLOB identity fields.")
        }
    }

    private func sqliteFailure(_ message: String) -> PBEOwnerNativeSessionFailure {
        _ = message
        return PBEOwnerNativeSessionFailure(
            code: "pbe_owner_host_not_ready",
            statusCode: 503,
            message: "PBE Owner host cannot verify its SQLite sources."
        )
    }
}
