import Foundation
import SQLite3

public struct OwnerAssetSourceMetadata: Sendable, Equatable {
    public var mediaType: String
    public var pixelWidth: Int
    public var pixelHeight: Int
    public var originalByteCount: Int64
    public var cameraBody: String
    public var lens: String
    public var focalLength: String

    public init(
        mediaType: String = "photo",
        pixelWidth: Int = 0,
        pixelHeight: Int = 0,
        originalByteCount: Int64 = 0,
        cameraBody: String = "",
        lens: String = "",
        focalLength: String = ""
    ) {
        self.mediaType = mediaType
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.originalByteCount = originalByteCount
        self.cameraBody = cameraBody
        self.lens = lens
        self.focalLength = focalLength
    }
}

/// Reads immutable source characteristics from authoritative Owner.sqlite and
/// joins read-only equipment fields from its projected public catalog and the
/// separate current-equipment cache learned from Apple Photos. Exact
/// publication identity wins; legacy filename fallback is accepted only when
/// that filename is unique in both databases. This store owns no write path
/// and never inspects a temporary Quick Look export.
public struct OwnerAssetSourceSQLiteStore: Sendable {
    private let databaseURL: URL
    private let catalogURL: URL?

    public init(databaseURL: URL, catalogURL: URL? = nil) {
        self.databaseURL = databaseURL.standardizedFileURL
        if let catalogURL {
            self.catalogURL = catalogURL.standardizedFileURL
        } else if databaseURL.deletingLastPathComponent().lastPathComponent == "owner-actions" {
            self.catalogURL = databaseURL
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("catalog/photosbyelie.sqlite")
                .standardizedFileURL
        } else {
            self.catalogURL = nil
        }
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

        var result: [String: OwnerAssetSourceMetadata] = [:]
        for batch in metadataBatches(ids) {
            let placeholders = Array(repeating: "?", count: batch.count).joined(separator: ",")
            let sql = """
            SELECT asset_id,
                   COALESCE(media_type, 'photo'),
                   COALESCE(pixel_width, 0),
                   COALESCE(pixel_height, 0),
                   CAST(COALESCE(
                     json_extract(raw_json, '$.originalByteCount'),
                     json_extract(raw_json, '$.original_byte_count'),
                     0
                   ) AS INTEGER),
                   COALESCE(
                     json_extract(raw_json, '$.cameraMetadata.model'),
                     json_extract(raw_json, '$.cameraMetadata.name'),
                     json_extract(raw_json, '$.camera.model'),
                     json_extract(raw_json, '$.camera.name'),
                     json_extract(raw_json, '$.cameraBody'),
                     ''
                   ),
                   COALESCE(
                     json_extract(raw_json, '$.lensMetadata.model'),
                     json_extract(raw_json, '$.lensMetadata.name'),
                     json_extract(raw_json, '$.lens.model'),
                     json_extract(raw_json, '$.lens.name'),
                     json_extract(raw_json, '$.cameraMetadata.lensModel'),
                     json_extract(raw_json, '$.camera.lensModel'),
                     ''
                   ),
                   COALESCE(
                     json_extract(raw_json, '$.focalLength'),
                     json_extract(raw_json, '$.cameraMetadata.focalLength'),
                     json_extract(raw_json, '$.camera.focalLength'),
                     ''
                   )
            FROM sidecar_assets
            WHERE asset_id IN (
            """ + placeholders + ")"
            guard let statement = prepared(database: database, sql: sql, values: batch) else {
                throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
            }
            defer { sqlite3_finalize(statement) }
            readRows: while true {
                switch sqlite3_step(statement) {
                case SQLITE_ROW:
                    let assetID = sqlite3_column_text(statement, 0).map(String.init(cString:)) ?? ""
                    let mediaType = sqlite3_column_text(statement, 1).map(String.init(cString:)) ?? "photo"
                    result[assetID] = OwnerAssetSourceMetadata(
                        mediaType: mediaType,
                        pixelWidth: Int(sqlite3_column_int64(statement, 2)),
                        pixelHeight: Int(sqlite3_column_int64(statement, 3)),
                        originalByteCount: sqlite3_column_int64(statement, 4),
                        cameraBody: sqlite3_column_text(statement, 5).map(String.init(cString:)) ?? "",
                        lens: sqlite3_column_text(statement, 6).map(String.init(cString:)) ?? "",
                        focalLength: sqlite3_column_text(statement, 7).map(String.init(cString:)) ?? ""
                    )
                case SQLITE_DONE:
                    break readRows
                default:
                    throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
                }
            }
        }
        let mediaIDs = publicationMediaIDs(database: database, assetIDs: ids)
        let filenames = uniqueSourceFilenames(database: database, assetIDs: ids)
        let catalogResult = catalogEquipment(
            assetIDs: ids,
            publicationMediaIDs: mediaIDs,
            uniqueFilenames: filenames,
            mergingInto: result
        )
        return currentEquipment(assetIDs: ids, mergingInto: catalogResult)
    }

    private func currentEquipment(
        assetIDs: [String],
        mergingInto source: [String: OwnerAssetSourceMetadata]
    ) -> [String: OwnerAssetSourceMetadata] {
        guard let learned = try? OwnerCurrentEquipmentSQLiteStore(databaseURL: databaseURL)
            .values(assetIDs: assetIDs),
              !learned.isEmpty
        else { return source }
        var result = source
        for (assetID, equipment) in learned {
            guard var metadata = result[assetID] else { continue }
            if !equipment.cameraBody.isEmpty { metadata.cameraBody = equipment.cameraBody }
            if !equipment.lens.isEmpty { metadata.lens = equipment.lens }
            if !equipment.focalLength.isEmpty { metadata.focalLength = equipment.focalLength }
            result[assetID] = metadata
        }
        return result
    }

    private func catalogEquipment(
        assetIDs: [String],
        publicationMediaIDs: [String: String],
        uniqueFilenames: [String: String],
        mergingInto source: [String: OwnerAssetSourceMetadata]
    ) -> [String: OwnerAssetSourceMetadata] {
        guard let catalogURL,
              FileManager.default.fileExists(atPath: catalogURL.path)
        else { return source }

        var catalog: OpaquePointer?
        guard sqlite3_open_v2(
            catalogURL.path,
            &catalog,
            SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX,
            nil
        ) == SQLITE_OK, let catalog else {
            if let catalog { sqlite3_close_v2(catalog) }
            return source
        }
        defer { sqlite3_close_v2(catalog) }
        sqlite3_busy_timeout(catalog, 1_000)

        let mediaIDByAssetID = Dictionary(uniqueKeysWithValues: assetIDs.map {
            ($0, publicationMediaIDs[$0] ?? $0)
        })
        var assetIDByMediaID: [String: String] = [:]
        for (assetID, mediaID) in mediaIDByAssetID
        where assetIDByMediaID[mediaID] == nil {
            assetIDByMediaID[mediaID] = assetID
        }
        var result = source
        for batch in metadataBatches(assetIDByMediaID.keys.sorted()) {
            let placeholders = Array(repeating: "?", count: batch.count).joined(separator: ",")
            let sql = """
            SELECT media.media_id,
                   COALESCE(camera.name, ''),
                   COALESCE(lens.name, ''),
                   COALESCE(media.focal_length, '')
            FROM media_items AS media
            LEFT JOIN cameras AS camera ON camera.camera_id = media.camera_id
            LEFT JOIN lenses AS lens ON lens.lens_id = media.lens_id
            WHERE media.media_id IN (
            """ + placeholders + ")"
            guard let statement = prepared(database: catalog, sql: sql, values: batch) else {
                continue
            }
            defer { sqlite3_finalize(statement) }
            while sqlite3_step(statement) == SQLITE_ROW {
                let mediaID = sqlite3_column_text(statement, 0).map(String.init(cString:)) ?? ""
                guard let assetID = assetIDByMediaID[mediaID],
                      var metadata = result[assetID]
                else { continue }
                metadata.cameraBody = sqlite3_column_text(statement, 1).map(String.init(cString:)) ?? ""
                metadata.lens = sqlite3_column_text(statement, 2).map(String.init(cString:)) ?? ""
                metadata.focalLength = sqlite3_column_text(statement, 3).map(String.init(cString:)) ?? ""
                result[assetID] = metadata
            }
        }
        mergeUniqueFilenameEquipment(
            catalog: catalog,
            filenamesByAssetID: uniqueFilenames,
            result: &result
        )
        return result
    }

    private func publicationMediaIDs(
        database: OpaquePointer,
        assetIDs: [String]
    ) -> [String: String] {
        var result: [String: String] = [:]
        for batch in metadataBatches(assetIDs) {
            let placeholders = Array(repeating: "?", count: batch.count).joined(separator: ",")
            let sql = """
            SELECT publication.asset_id, publication.media_id
            FROM public_catalog_publications AS publication
            WHERE publication.asset_id IN (
            """ + placeholders + """
            )
              AND trim(COALESCE(publication.media_id, '')) <> ''
              AND publication.updated_at = (
                SELECT MAX(candidate.updated_at)
                FROM public_catalog_publications AS candidate
                WHERE candidate.asset_id = publication.asset_id
              )
            """
            guard let statement = prepared(database: database, sql: sql, values: batch) else {
                continue
            }
            defer { sqlite3_finalize(statement) }
            while sqlite3_step(statement) == SQLITE_ROW {
                let assetID = sqlite3_column_text(statement, 0).map(String.init(cString:)) ?? ""
                let mediaID = sqlite3_column_text(statement, 1).map(String.init(cString:)) ?? ""
                if !assetID.isEmpty, !mediaID.isEmpty {
                    result[assetID] = mediaID
                }
            }
        }
        return result
    }

    private func uniqueSourceFilenames(
        database: OpaquePointer,
        assetIDs: [String]
    ) -> [String: String] {
        var result: [String: String] = [:]
        for batch in metadataBatches(assetIDs) {
            let placeholders = Array(repeating: "?", count: batch.count).joined(separator: ",")
            let sql = """
            SELECT requested.asset_id, requested.filename
            FROM sidecar_assets AS requested
            JOIN (
              SELECT filename
              FROM sidecar_assets
              WHERE trim(COALESCE(filename, '')) <> ''
              GROUP BY filename
              HAVING COUNT(*) = 1
            ) AS unique_filename ON unique_filename.filename = requested.filename
            WHERE requested.asset_id IN (
            """ + placeholders + ")"
            guard let statement = prepared(database: database, sql: sql, values: batch) else {
                continue
            }
            defer { sqlite3_finalize(statement) }
            while sqlite3_step(statement) == SQLITE_ROW {
                let assetID = sqlite3_column_text(statement, 0).map(String.init(cString:)) ?? ""
                let filename = sqlite3_column_text(statement, 1).map(String.init(cString:)) ?? ""
                if !assetID.isEmpty, !filename.isEmpty {
                    result[assetID] = filename
                }
            }
        }
        return result
    }

    private func mergeUniqueFilenameEquipment(
        catalog: OpaquePointer,
        filenamesByAssetID: [String: String],
        result: inout [String: OwnerAssetSourceMetadata]
    ) {
        let unresolved = filenamesByAssetID.filter {
            guard let metadata = result[$0.key] else { return false }
            return metadata.cameraBody.isEmpty
                && metadata.lens.isEmpty
                && metadata.focalLength.isEmpty
        }
        guard !unresolved.isEmpty else { return }
        var assetIDByFilename: [String: String] = [:]
        for (assetID, filename) in unresolved
        where assetIDByFilename[filename] == nil {
            assetIDByFilename[filename] = assetID
        }
        for batch in metadataBatches(assetIDByFilename.keys.sorted()) {
            let placeholders = Array(repeating: "?", count: batch.count).joined(separator: ",")
            let sql = """
            SELECT source.filename,
                   COALESCE(camera.name, ''),
                   COALESCE(lens.name, ''),
                   COALESCE(media.focal_length, '')
            FROM source_files AS source
            JOIN media_items AS media ON media.source_file_id = source.source_file_id
            LEFT JOIN cameras AS camera ON camera.camera_id = media.camera_id
            LEFT JOIN lenses AS lens ON lens.lens_id = media.lens_id
            JOIN (
              SELECT candidate_source.filename
              FROM source_files AS candidate_source
              JOIN media_items AS candidate_media
                ON candidate_media.source_file_id = candidate_source.source_file_id
              GROUP BY candidate_source.filename
              HAVING COUNT(*) = 1
            ) AS unique_filename ON unique_filename.filename = source.filename
            WHERE source.filename IN (
            """ + placeholders + ")"
            guard let statement = prepared(database: catalog, sql: sql, values: batch) else {
                continue
            }
            defer { sqlite3_finalize(statement) }
            while sqlite3_step(statement) == SQLITE_ROW {
                let filename = sqlite3_column_text(statement, 0).map(String.init(cString:)) ?? ""
                guard let assetID = assetIDByFilename[filename],
                      var metadata = result[assetID]
                else { continue }
                metadata.cameraBody = sqlite3_column_text(statement, 1).map(String.init(cString:)) ?? ""
                metadata.lens = sqlite3_column_text(statement, 2).map(String.init(cString:)) ?? ""
                metadata.focalLength = sqlite3_column_text(statement, 3).map(String.init(cString:)) ?? ""
                result[assetID] = metadata
            }
        }
    }

    private func prepared(
        database: OpaquePointer,
        sql: String,
        values: [String]
    ) -> OpaquePointer? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            return nil
        }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (index, value) in values.enumerated() {
            _ = value.withCString { pointer in
                sqlite3_bind_text(statement, Int32(index + 1), pointer, -1, transient)
            }
        }
        return statement
    }
}

private func metadataBatches(_ values: [String], size: Int = 400) -> [[String]] {
    stride(from: 0, to: values.count, by: size).map { start in
        Array(values[start..<min(values.count, start + size)])
    }
}
