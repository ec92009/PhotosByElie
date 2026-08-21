import Foundation
import SQLite3

public struct OwnerAssetSourceMetadata: Sendable, Equatable {
    public var mediaType: String
    public var pixelWidth: Int
    public var pixelHeight: Int
    public var originalByteCount: Int64

    public init(
        mediaType: String = "photo",
        pixelWidth: Int = 0,
        pixelHeight: Int = 0,
        originalByteCount: Int64 = 0
    ) {
        self.mediaType = mediaType
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.originalByteCount = originalByteCount
    }
}

/// Reads immutable source characteristics directly from authoritative
/// Owner.sqlite. It deliberately owns no write path and never inspects a
/// temporary Quick Look export.
public struct OwnerAssetSourceSQLiteStore: Sendable {
    private let databaseURL: URL

    public init(databaseURL: URL) {
        self.databaseURL = databaseURL.standardizedFileURL
    }

    public func metadata(assetIDs: [String]) throws -> [String: OwnerAssetSourceMetadata] {
        let ids = Array(Set(assetIDs.map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty })).sorted()
        guard !ids.isEmpty else { return [:] }
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw OwnerDatabaseError.unavailable("Owner.sqlite is unavailable for source metadata.")
        }

        var database: OpaquePointer?
        guard sqlite3_open_v2(
            databaseURL.path,
            &database,
            SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX,
            nil
        ) == SQLITE_OK, let database else {
            if let database { sqlite3_close_v2(database) }
            throw OwnerDatabaseError.unavailable("Could not open Owner.sqlite for source metadata.")
        }
        defer { sqlite3_close_v2(database) }
        sqlite3_busy_timeout(database, 1_000)

        let placeholders = Array(repeating: "?", count: ids.count).joined(separator: ",")
        let sql = """
        SELECT asset_id,
               COALESCE(media_type, 'photo'),
               COALESCE(pixel_width, 0),
               COALESCE(pixel_height, 0),
               CAST(COALESCE(
                 json_extract(raw_json, '$.originalByteCount'),
                 json_extract(raw_json, '$.original_byte_count'),
                 0
        ) AS INTEGER)
        FROM sidecar_assets
        WHERE asset_id IN (
        """ + placeholders + ")"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
        }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (index, id) in ids.enumerated() {
            _ = id.withCString { pointer in
                sqlite3_bind_text(statement, Int32(index + 1), pointer, -1, transient)
            }
        }

        var result: [String: OwnerAssetSourceMetadata] = [:]
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                let assetID = sqlite3_column_text(statement, 0).map(String.init(cString:)) ?? ""
                let mediaType = sqlite3_column_text(statement, 1).map(String.init(cString:)) ?? "photo"
                result[assetID] = OwnerAssetSourceMetadata(
                    mediaType: mediaType,
                    pixelWidth: Int(sqlite3_column_int64(statement, 2)),
                    pixelHeight: Int(sqlite3_column_int64(statement, 3)),
                    originalByteCount: sqlite3_column_int64(statement, 4)
                )
            case SQLITE_DONE:
                return result
            default:
                throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
            }
        }
    }
}
