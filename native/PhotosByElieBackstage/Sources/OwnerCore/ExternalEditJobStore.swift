import CryptoKit
import Foundation
import SQLite3

public enum ExternalEditKind: String, Codable, Sendable {
    case edit
    case create
}

public enum ExternalEditJobState: String, Codable, Sendable {
    case preparing
    case editing
    case returned
    case cancelled
    case failed

    public var isActive: Bool { self == .preparing || self == .editing }
}

public struct ExternalEditorProfile: Codable, Identifiable, Sendable, Equatable {
    public var id: String { bundleIdentifier.isEmpty ? applicationURL.path : bundleIdentifier }
    public var name: String
    public var bundleIdentifier: String
    public var applicationURL: URL

    public init(name: String, bundleIdentifier: String = "", applicationURL: URL) {
        self.name = name
        self.bundleIdentifier = bundleIdentifier
        self.applicationURL = applicationURL.standardizedFileURL
    }
}

public struct ExternalEditSource: Codable, Identifiable, Sendable, Equatable {
    public var id: String { assetID }
    public var position: Int
    public var assetID: String
    public var sourceVersionID: String
    public var photoLibraryIdentifier: String
    public var originalFilename: String
    public var exportedRelativePath: String
    public var checksumSHA256: String

    public init(
        position: Int,
        assetID: String,
        sourceVersionID: String = "",
        photoLibraryIdentifier: String,
        originalFilename: String,
        exportedRelativePath: String = "",
        checksumSHA256: String = ""
    ) {
        self.position = position
        self.assetID = assetID
        self.sourceVersionID = sourceVersionID
        self.photoLibraryIdentifier = photoLibraryIdentifier
        self.originalFilename = originalFilename
        self.exportedRelativePath = exportedRelativePath
        self.checksumSHA256 = checksumSHA256
    }
}

public struct ExternalEditJob: Codable, Identifiable, Sendable, Equatable {
    public var id: String
    public var fixtureID: String
    public var kind: ExternalEditKind
    public var state: ExternalEditJobState
    public var editor: ExternalEditorProfile
    public var workingDirectory: URL
    public var sources: [ExternalEditSource]
    public var destinationAssetID: String
    public var returnedFileURL: URL?
    public var returnedSourceVersionID: String
    public var errorMessage: String
    public var createdAt: Date
    public var updatedAt: Date

    public var inputDirectory: URL {
        workingDirectory.appendingPathComponent("Inputs", isDirectory: true)
    }

    public var returnDirectory: URL {
        workingDirectory.appendingPathComponent("Return", isDirectory: true)
    }
}

public struct ExternalEditReturnReceipt: Codable, Identifiable, Sendable, Equatable {
    public var id: String
    public var jobID: String
    public var destinationAssetID: String
    public var sourceVersionID: String
    public var fileURL: URL
    public var checksumSHA256: String
    public var byteCount: Int64
    public var derivedAsset: Bool
}

/// The exact accepted external-edit file backing an asset's current source
/// version. UI and export callers use this instead of silently falling back to
/// the older Apple Photos rendition.
public struct ExternalEditReturnedSource: Sendable, Equatable {
    public var assetID: String
    public var sourceVersionID: String
    public var fileURL: URL
    public var checksumSHA256: String
    public var byteCount: Int64

    public init(
        assetID: String,
        sourceVersionID: String,
        fileURL: URL,
        checksumSHA256: String,
        byteCount: Int64
    ) {
        self.assetID = assetID
        self.sourceVersionID = sourceVersionID
        self.fileURL = fileURL.standardizedFileURL
        self.checksumSHA256 = checksumSHA256
        self.byteCount = byteCount
    }
}

public enum ExternalEditJobError: LocalizedError, Equatable {
    case databaseUnavailable
    case activeJobExists
    case jobNotFound
    case invalidState
    case invalidSources
    case invalidReturnedFile
    case database(String)

    public var errorDescription: String? {
        switch self {
        case .databaseUnavailable: "Owner.sqlite is unavailable for external editing."
        case .activeJobExists: "Finish or cancel the current external edit before starting another."
        case .jobNotFound: "The external edit job no longer exists."
        case .invalidState: "This external edit job cannot accept that action in its current state."
        case .invalidSources: "Select one or more still photos before opening an external editor."
        case .invalidReturnedFile: "Choose a readable JPG, JPEG, TIFF, PNG, or HEIC result file."
        case let .database(message): message
        }
    }
}

public protocol ExternalEditJobStoring: Sendable {
    func resolveSources(assetIDs: [String]) throws -> [ExternalEditSource]
    func createJob(
        fixtureID: String,
        kind: ExternalEditKind,
        editor: ExternalEditorProfile,
        sources: [ExternalEditSource],
        now: Date
    ) throws -> ExternalEditJob
    func recordPrepared(jobID: String, receipts: [PhotoExportReceipt], now: Date) throws -> ExternalEditJob
    func recordLaunched(jobID: String, now: Date) throws -> ExternalEditJob
    func acceptReturnedFile(jobID: String, sourceURL: URL, now: Date) throws -> ExternalEditReturnReceipt
    func currentReturnedSource(assetID: String) throws -> ExternalEditReturnedSource?
    func cancel(jobID: String, now: Date) throws
    func fail(jobID: String, message: String, now: Date) throws
    func activeJob() throws -> ExternalEditJob?
    func recoverInterruptedPreparation(now: Date) throws -> Int
}

public extension ExternalEditJobStoring {
    func currentReturnedSource(assetID: String) throws -> ExternalEditReturnedSource? { nil }
}

public struct ExternalEditJobSQLiteStore: ExternalEditJobStoring, Sendable {
    private let databaseURL: URL
    private let jobsRoot: URL
    private let busyTimeoutMilliseconds: Int32

    public init(
        databaseURL: URL,
        jobsRoot: URL? = nil,
        busyTimeoutMilliseconds: Int32 = 2_000
    ) {
        self.databaseURL = databaseURL.standardizedFileURL
        self.jobsRoot = (jobsRoot ?? Self.defaultJobsRoot()).standardizedFileURL
        self.busyTimeoutMilliseconds = busyTimeoutMilliseconds
    }

    public func createJob(
        fixtureID: String,
        kind: ExternalEditKind,
        editor: ExternalEditorProfile,
        sources: [ExternalEditSource],
        now: Date = Date()
    ) throws -> ExternalEditJob {
        let cleanSources = sources
            .sorted { $0.position < $1.position }
            .filter { !$0.assetID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !cleanSources.isEmpty,
              kind == .create || cleanSources.count == 1,
              cleanSources.allSatisfy({ !$0.photoLibraryIdentifier.isEmpty }) else {
            throw ExternalEditJobError.invalidSources
        }
        let database = try openWritable()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        if try scalarInt(
            database,
            "SELECT COUNT(*) FROM external_edit_jobs WHERE state IN ('preparing', 'editing')"
        ) > 0 {
            throw ExternalEditJobError.activeJobExists
        }

        let jobID = "edit-\(UUID().uuidString.lowercased())"
        let directory = jobsRoot.appendingPathComponent(jobID, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory.appendingPathComponent("Inputs", isDirectory: true),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.createDirectory(
            at: directory.appendingPathComponent("Return", isDirectory: true),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let timestamp = Self.timestamp(now)
        do {
            try transaction(database) {
                try execute(
                    database,
                    """
                    INSERT INTO external_edit_jobs(
                      job_id, fixture_id, kind, state, editor_name, editor_bundle_id,
                      editor_application_path, working_directory, destination_asset_id,
                      returned_file_path, returned_source_version_id, error_text,
                      created_at, updated_at
                    ) VALUES (?, ?, ?, 'preparing', ?, ?, ?, ?, '', '', '', '', ?, ?)
                    """,
                    [
                        jobID, fixtureID, kind.rawValue, editor.name,
                        editor.bundleIdentifier, editor.applicationURL.path,
                        directory.path, timestamp, timestamp,
                    ]
                )
                for source in cleanSources {
                    try execute(
                        database,
                        """
                        INSERT INTO external_edit_job_sources(
                          job_id, position, asset_id, source_version_id,
                          photo_library_identifier, original_filename,
                          exported_relative_path, checksum_sha256
                        ) VALUES (?, ?, ?, ?, ?, ?, '', '')
                        """,
                        [
                            jobID, String(source.position), source.assetID,
                            source.sourceVersionID, source.photoLibraryIdentifier,
                            source.originalFilename,
                        ]
                    )
                    try execute(
                        database,
                        """
                        INSERT INTO external_edit_asset_locks(asset_id, job_id, role, acquired_at)
                        VALUES (?, ?, 'source', ?)
                        """,
                        [source.assetID, jobID, timestamp]
                    )
                }
            }
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
        let job = ExternalEditJob(
            id: jobID,
            fixtureID: fixtureID,
            kind: kind,
            state: .preparing,
            editor: editor,
            workingDirectory: directory,
            sources: cleanSources,
            destinationAssetID: "",
            returnedFileURL: nil,
            returnedSourceVersionID: "",
            errorMessage: "",
            createdAt: now,
            updatedAt: now
        )
        try writeManifest(job)
        return job
    }

    public func recordPrepared(
        jobID: String,
        receipts: [PhotoExportReceipt],
        now: Date = Date()
    ) throws -> ExternalEditJob {
        let database = try openWritable()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        guard var job = try readJob(database, id: jobID) else { throw ExternalEditJobError.jobNotFound }
        guard job.state == .preparing, receipts.count == job.sources.count else {
            throw ExternalEditJobError.invalidState
        }
        try transaction(database) {
            for (source, receipt) in zip(job.sources, receipts) {
                let relative = relativePath(receipt.destination, under: job.workingDirectory)
                guard !relative.isEmpty else { throw ExternalEditJobError.invalidSources }
                try execute(
                    database,
                    """
                    UPDATE external_edit_job_sources
                    SET original_filename = ?, exported_relative_path = ?, checksum_sha256 = ?
                    WHERE job_id = ? AND position = ? AND asset_id = ?
                    """,
                    [
                        receipt.filename, relative, receipt.checksumSHA256,
                        jobID, String(source.position), source.assetID,
                    ]
                )
            }
            try execute(
                database,
                "UPDATE external_edit_jobs SET updated_at = ? WHERE job_id = ? AND state = 'preparing'",
                [Self.timestamp(now), jobID]
            )
        }
        job = try requireJob(database, id: jobID)
        try writeManifest(job)
        return job
    }

    public func recordLaunched(jobID: String, now: Date = Date()) throws -> ExternalEditJob {
        let database = try openWritable()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        let changed = try execute(
            database,
            "UPDATE external_edit_jobs SET state = 'editing', updated_at = ? WHERE job_id = ? AND state = 'preparing'",
            [Self.timestamp(now), jobID]
        )
        guard changed == 1 else { throw ExternalEditJobError.invalidState }
        let job = try requireJob(database, id: jobID)
        try writeManifest(job)
        return job
    }

    public func acceptReturnedFile(
        jobID: String,
        sourceURL: URL,
        now: Date = Date()
    ) throws -> ExternalEditReturnReceipt {
        let sourceURL = sourceURL.standardizedFileURL
        let allowedExtensions = Set(["jpg", "jpeg", "tif", "tiff", "png", "heic"])
        let values = try? sourceURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values?.isRegularFile == true,
              values?.isSymbolicLink != true,
              allowedExtensions.contains(sourceURL.pathExtension.lowercased()),
              let byteCount = values?.fileSize,
              byteCount > 0 else {
            throw ExternalEditJobError.invalidReturnedFile
        }

        let database = try openWritable()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        let job = try requireJob(database, id: jobID)
        guard job.state == .editing || job.state == .preparing else {
            throw ExternalEditJobError.invalidState
        }
        let checksum = try Self.sha256(sourceURL)
        let returnID = "return-\(UUID().uuidString.lowercased())"
        let acceptedDirectory = job.returnDirectory.appendingPathComponent("Accepted", isDirectory: true)
        try FileManager.default.createDirectory(
            at: acceptedDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let target = acceptedDirectory
            .appendingPathComponent(returnID)
            .appendingPathExtension(sourceURL.pathExtension.lowercased())
        try FileManager.default.copyItem(at: sourceURL, to: target)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)

        let timestamp = Self.timestamp(now)
        let destinationAssetID: String
        let derived: Bool
        if job.kind == .edit {
            guard let source = job.sources.first else { throw ExternalEditJobError.invalidSources }
            destinationAssetID = source.assetID
            derived = false
        } else {
            destinationAssetID = "derived-\(UUID().uuidString.lowercased())"
            derived = true
        }
        let sourceVersionID = Self.sourceVersionID(assetID: destinationAssetID, checksum: checksum)
        do {
            try transaction(database) {
                if derived {
                    try insertDerivedAsset(
                        database,
                        assetID: destinationAssetID,
                        fixtureID: job.fixtureID,
                        filename: sourceURL.lastPathComponent,
                        sourceCount: job.sources.count,
                        timestamp: timestamp
                    )
                }
                try execute(
                    database,
                    """
                    INSERT INTO fixture_asset_decisions(
                      fixture_id, asset_id, placement_state, eligibility_state,
                      source, last_action, created_at, updated_at
                    ) VALUES (?, ?, 'picked', 'active', 'native', 'external-edit-return', ?, ?)
                    ON CONFLICT(fixture_id, asset_id) DO UPDATE SET
                      placement_state = 'picked', eligibility_state = 'active',
                      source = excluded.source, last_action = excluded.last_action,
                      updated_at = excluded.updated_at
                    """,
                    [job.fixtureID, destinationAssetID, timestamp, timestamp]
                )
                try execute(
                    database,
                    "UPDATE asset_source_versions SET state = 'superseded', superseded_at = ? WHERE asset_id = ? AND state = 'candidate'",
                    [timestamp, destinationAssetID]
                )
                try execute(
                    database,
                    """
                    INSERT INTO asset_source_versions(
                      version_id, asset_id, metadata_fingerprint, rendered_fingerprint,
                      source_exists, state, created_at
                    ) VALUES (?, ?, '', ?, 1, 'candidate', ?)
                    """,
                    [sourceVersionID, destinationAssetID, checksum, timestamp]
                )
                try execute(
                    database,
                    """
                    INSERT INTO external_edit_returns(
                      return_id, job_id, destination_asset_id, source_version_id,
                      file_path, checksum_sha256, byte_count, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        returnID, jobID, destinationAssetID, sourceVersionID,
                        target.path, checksum, String(byteCount), timestamp,
                    ]
                )
                try execute(
                    database,
                    """
                    UPDATE asset_editorial_state
                    SET editorial_state = 'unreviewed', ai_reasons_json = '[]', ai_note = '',
                        requested_at = NULL, approved_at = NULL, updated_at = ?
                    WHERE asset_id = ?
                    """,
                    [timestamp, destinationAssetID]
                )
                try execute(
                    database,
                    """
                    UPDATE sidecar_decisions
                    SET metadata_state = 'unreviewed', last_action = 'external-edit-return', updated_at = ?
                    WHERE asset_id = ?
                    """,
                    [timestamp, destinationAssetID]
                )
                try execute(
                    database,
                    """
                    INSERT INTO asset_delivery_state(asset_id, delivery_state, source_version_hash, last_error, created_at, updated_at)
                    VALUES (?, 'not-ready', ?, '', ?, ?)
                    ON CONFLICT(asset_id) DO UPDATE SET
                      delivery_state = CASE
                        WHEN asset_delivery_state.delivery_state = 'live' THEN 'live'
                        ELSE 'not-ready'
                      END,
                      source_version_hash = CASE
                        WHEN asset_delivery_state.delivery_state = 'live'
                          THEN asset_delivery_state.source_version_hash
                        ELSE excluded.source_version_hash
                      END,
                      last_error = '', updated_at = excluded.updated_at
                    """,
                    [destinationAssetID, sourceVersionID, timestamp, timestamp]
                )
                for source in job.sources {
                    try execute(
                        database,
                        """
                        INSERT INTO external_edit_lineage(
                          child_source_version_id, parent_position, parent_asset_id,
                          parent_source_version_id, job_id, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        [
                            sourceVersionID, String(source.position), source.assetID,
                            source.sourceVersionID, jobID, timestamp,
                        ]
                    )
                }
                try execute(
                    database,
                    """
                    UPDATE external_edit_jobs
                    SET state = 'returned', destination_asset_id = ?, returned_file_path = ?,
                        returned_source_version_id = ?, error_text = '', updated_at = ?
                    WHERE job_id = ? AND state IN ('preparing', 'editing')
                    """,
                    [destinationAssetID, target.path, sourceVersionID, timestamp, jobID]
                )
                try execute(
                    database,
                    "DELETE FROM external_edit_asset_locks WHERE job_id = ?",
                    [jobID]
                )
            }
        } catch {
            try? FileManager.default.removeItem(at: target)
            throw error
        }
        let updated = try requireJob(database, id: jobID)
        try writeManifest(updated)
        return ExternalEditReturnReceipt(
            id: returnID,
            jobID: jobID,
            destinationAssetID: destinationAssetID,
            sourceVersionID: sourceVersionID,
            fileURL: target,
            checksumSHA256: checksum,
            byteCount: Int64(byteCount),
            derivedAsset: derived
        )
    }

    public func cancel(jobID: String, now: Date = Date()) throws {
        try finish(jobID: jobID, state: .cancelled, message: "", now: now)
    }

    public func fail(jobID: String, message: String, now: Date = Date()) throws {
        try finish(jobID: jobID, state: .failed, message: message, now: now)
    }

    public func activeJob() throws -> ExternalEditJob? {
        let database = try openReadable()
        defer { sqlite3_close_v2(database) }
        guard try tableExists(database, name: "external_edit_jobs") else { return nil }
        return try readJob(
            database,
            whereClause: "state IN ('preparing', 'editing') ORDER BY created_at DESC LIMIT 1",
            bindings: []
        )
    }

    public func currentReturnedSource(assetID: String) throws -> ExternalEditReturnedSource? {
        let assetID = assetID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !assetID.isEmpty else { return nil }
        let database = try openReadable()
        defer { sqlite3_close_v2(database) }
        guard try tableExists(database, name: "external_edit_returns") else { return nil }

        var statement: OpaquePointer?
        let sql = """
        SELECT returned.source_version_id, returned.file_path,
               returned.checksum_sha256, returned.byte_count
        FROM external_edit_returns AS returned
        JOIN asset_source_versions AS source
          ON source.version_id = returned.source_version_id
         AND source.asset_id = returned.destination_asset_id
        WHERE returned.destination_asset_id = ?
          AND source.source_exists = 1
          AND source.state IN ('candidate', 'approved', 'live')
          AND source.version_id = (
            SELECT latest.version_id
            FROM asset_source_versions AS latest
            WHERE latest.asset_id = returned.destination_asset_id
              AND latest.source_exists = 1
              AND latest.state IN ('candidate', 'approved', 'live')
            ORDER BY latest.created_at DESC, latest.version_id DESC
            LIMIT 1
          )
        LIMIT 1
        """
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else { throw databaseError(database) }
        defer { sqlite3_finalize(statement) }
        bind([assetID], to: statement)
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }

        let sourceVersionID = text(statement, 0)
        let fileURL = URL(fileURLWithPath: text(statement, 1)).standardizedFileURL
        let checksum = text(statement, 2)
        let byteCount = sqlite3_column_int64(statement, 3)
        let values = try? fileURL.resourceValues(
            forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]
        )
        let rootPath = jobsRoot.standardizedFileURL.path + "/"
        guard fileURL.path.hasPrefix(rootPath),
              fileURL.path.contains("/Return/Accepted/"),
              values?.isRegularFile == true,
              values?.isSymbolicLink != true,
              Int64(values?.fileSize ?? 0) == byteCount,
              byteCount > 0,
              try Self.sha256(fileURL) == checksum else {
            throw ExternalEditJobError.invalidReturnedFile
        }
        return ExternalEditReturnedSource(
            assetID: assetID,
            sourceVersionID: sourceVersionID,
            fileURL: fileURL,
            checksumSHA256: checksum,
            byteCount: byteCount
        )
    }

    /// Resolve editor inputs from durable Owner state so every screen can use
    /// the same exact current-source contract.
    public func resolveSources(assetIDs: [String]) throws -> [ExternalEditSource] {
        let orderedIDs = assetIDs.reduce(into: [String]()) { result, id in
            let clean = id.trimmingCharacters(in: .whitespacesAndNewlines)
            if !clean.isEmpty, !result.contains(clean) { result.append(clean) }
        }
        guard !orderedIDs.isEmpty else { throw ExternalEditJobError.invalidSources }
        let database = try openReadable()
        defer { sqlite3_close_v2(database) }

        var resolved: [ExternalEditSource] = []
        for (position, assetID) in orderedIDs.enumerated() {
            var statement: OpaquePointer?
            let sql = """
            SELECT COALESCE((
                     SELECT version_id
                     FROM asset_source_versions
                     WHERE asset_id = asset.asset_id AND source_exists = 1
                     ORDER BY created_at DESC, version_id DESC LIMIT 1
                   ), '') AS source_version_id,
                   COALESCE(
                     NULLIF(json_extract(asset.raw_json, '$.localIdentifier'), ''),
                     NULLIF(json_extract(asset.raw_json, '$.cloudIdentifier'), ''),
                     NULLIF(json_extract(asset.raw_json, '$.phCloudIdentifier'), ''),
                     NULLIF(replace(replace(asset.source_anchor, 'apple-photos://', ''), 'apple-photos-cloud://', ''), ''),
                     asset.asset_id
                   ) AS photo_library_identifier,
                   COALESCE(asset.filename, '') AS filename
            FROM sidecar_assets AS asset
            WHERE asset.asset_id = ?
              AND lower(COALESCE(asset.media_type, 'photo')) != 'video'
              AND COALESCE(asset.missing_at, '') = ''
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS tombstone
                WHERE tombstone.asset_id = asset.asset_id
                  AND tombstone.tombstone_state = 'active'
              )
            """
            guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
                  let statement else { throw databaseError(database) }
            defer { sqlite3_finalize(statement) }
            bind([assetID], to: statement)
            guard sqlite3_step(statement) == SQLITE_ROW else {
                throw ExternalEditJobError.invalidSources
            }
            resolved.append(ExternalEditSource(
                position: position,
                assetID: assetID,
                sourceVersionID: text(statement, 0),
                photoLibraryIdentifier: text(statement, 1),
                originalFilename: text(statement, 2)
            ))
        }
        return resolved
    }

    public func recoverInterruptedPreparation(now: Date = Date()) throws -> Int {
        let database = try openWritable()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        var changed = 0
        try transaction(database) {
            changed = try execute(
                database,
                """
                UPDATE external_edit_jobs
                SET state = 'failed', error_text = 'Backstage closed while preparing editor files.', updated_at = ?
                WHERE state = 'preparing'
                """,
                [Self.timestamp(now)]
            )
            try execute(
                database,
                """
                DELETE FROM external_edit_asset_locks
                WHERE job_id IN (SELECT job_id FROM external_edit_jobs WHERE state = 'failed')
                """,
                []
            )
        }
        return changed
    }

    private func finish(
        jobID: String,
        state: ExternalEditJobState,
        message: String,
        now: Date
    ) throws {
        let database = try openWritable()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        var changed = 0
        try transaction(database) {
            changed = try execute(
                database,
                """
                UPDATE external_edit_jobs SET state = ?, error_text = ?, updated_at = ?
                WHERE job_id = ? AND state IN ('preparing', 'editing')
                """,
                [state.rawValue, message, Self.timestamp(now), jobID]
            )
            if changed == 1 {
                try execute(
                    database,
                    "DELETE FROM external_edit_asset_locks WHERE job_id = ?",
                    [jobID]
                )
            }
        }
        guard changed == 1 else { throw ExternalEditJobError.invalidState }
        try writeManifest(try requireJob(database, id: jobID))
    }

    private func insertDerivedAsset(
        _ database: OpaquePointer,
        assetID: String,
        fixtureID: String,
        filename: String,
        sourceCount: Int,
        timestamp: String
    ) throws {
        let sourceAnchor = "external-edit://\(assetID)"
        let title = sourceCount == 1 ? "Edited photo" : "Composite from \(sourceCount) photos"
        try execute(
            database,
            """
            INSERT INTO sidecar_assets(
              asset_id, source_anchor, media_type, filename, photos_title,
              photos_keywords_json, location_keywords_json, metadata_seed_keywords_json,
              raw_json, indexed_at, updated_at
            ) VALUES (?, ?, 'photo', ?, ?, '[]', '[]', '[]', '{}', ?, ?)
            """,
            [assetID, sourceAnchor, filename, title, timestamp, timestamp]
        )
        try execute(
            database,
            """
            INSERT INTO sidecar_decisions(
              asset_id, rating, color, pick_state, metadata_state, title,
              keywords_json, last_action, created_at, updated_at
            ) VALUES (?, 0, '', 'picked', 'unreviewed', ?, '[]', 'external-edit-create', ?, ?)
            """,
            [assetID, title, timestamp, timestamp]
        )
        try execute(
            database,
            """
            INSERT INTO asset_editorial_state(
              asset_id, editorial_state, ai_reasons_json, ai_note,
              ai_attempt_count, ai_last_error, created_at, updated_at
            ) VALUES (?, 'unreviewed', '[]', '', 0, '', ?, ?)
            """,
            [assetID, timestamp, timestamp]
        )
        try execute(
            database,
            """
            INSERT INTO fixture_asset_placements(
              placement_id, fixture_id, asset_id, state, placed_at, updated_at
            ) VALUES (?, ?, ?, 'active', ?, ?)
            """,
            ["placement-\(UUID().uuidString.lowercased())", fixtureID, assetID, timestamp, timestamp]
        )
        try execute(
            database,
            """
            INSERT INTO fixture_asset_decisions(
              fixture_id, asset_id, placement_state, eligibility_state,
              source, last_action, created_at, updated_at
            ) VALUES (?, ?, 'picked', 'active', 'external-edit', 'external-edit-create', ?, ?)
            """,
            [fixtureID, assetID, timestamp, timestamp]
        )
        try execute(
            database,
            """
            INSERT INTO sidecar_mock_uploads(asset_id, mock_state, uploaded_at, updated_at)
            VALUES (?, 'active', ?, ?)
            """,
            [assetID, timestamp, timestamp]
        )
    }

    private func openReadable() throws -> OpaquePointer {
        try open(flags: SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX)
    }

    private func openWritable() throws -> OpaquePointer {
        try open(flags: SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX)
    }

    private func open(flags: Int32) throws -> OpaquePointer {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw ExternalEditJobError.databaseUnavailable
        }
        var database: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &database, flags, nil) == SQLITE_OK,
              let database else {
            if let database { sqlite3_close_v2(database) }
            throw ExternalEditJobError.databaseUnavailable
        }
        sqlite3_busy_timeout(database, busyTimeoutMilliseconds)
        sqlite3_exec(database, "PRAGMA foreign_keys = ON", nil, nil, nil)
        return database
    }

    private func ensureSchema(_ database: OpaquePointer) throws {
        try execScript(
            database,
            """
            CREATE TABLE IF NOT EXISTS external_edit_jobs (
              job_id TEXT PRIMARY KEY,
              fixture_id TEXT NOT NULL,
              kind TEXT NOT NULL CHECK(kind IN ('edit', 'create')),
              state TEXT NOT NULL CHECK(state IN ('preparing', 'editing', 'returned', 'cancelled', 'failed')),
              editor_name TEXT NOT NULL,
              editor_bundle_id TEXT NOT NULL DEFAULT '',
              editor_application_path TEXT NOT NULL,
              working_directory TEXT NOT NULL,
              destination_asset_id TEXT NOT NULL DEFAULT '',
              returned_file_path TEXT NOT NULL DEFAULT '',
              returned_source_version_id TEXT NOT NULL DEFAULT '',
              error_text TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_external_edit_one_active
              ON external_edit_jobs((1)) WHERE state IN ('preparing', 'editing');
            CREATE TABLE IF NOT EXISTS external_edit_job_sources (
              job_id TEXT NOT NULL,
              position INTEGER NOT NULL,
              asset_id TEXT NOT NULL,
              source_version_id TEXT NOT NULL DEFAULT '',
              photo_library_identifier TEXT NOT NULL,
              original_filename TEXT NOT NULL DEFAULT '',
              exported_relative_path TEXT NOT NULL DEFAULT '',
              checksum_sha256 TEXT NOT NULL DEFAULT '',
              PRIMARY KEY(job_id, position),
              FOREIGN KEY(job_id) REFERENCES external_edit_jobs(job_id) ON DELETE CASCADE,
              FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE IF NOT EXISTS external_edit_asset_locks (
              asset_id TEXT PRIMARY KEY,
              job_id TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('source', 'destination')),
              acquired_at TEXT NOT NULL,
              FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id),
              FOREIGN KEY(job_id) REFERENCES external_edit_jobs(job_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_external_edit_asset_locks_job
              ON external_edit_asset_locks(job_id, asset_id);
            CREATE TABLE IF NOT EXISTS external_edit_returns (
              return_id TEXT PRIMARY KEY,
              job_id TEXT NOT NULL UNIQUE,
              destination_asset_id TEXT NOT NULL,
              source_version_id TEXT NOT NULL UNIQUE,
              file_path TEXT NOT NULL,
              checksum_sha256 TEXT NOT NULL,
              byte_count INTEGER NOT NULL CHECK(byte_count > 0),
              created_at TEXT NOT NULL,
              FOREIGN KEY(job_id) REFERENCES external_edit_jobs(job_id),
              FOREIGN KEY(destination_asset_id) REFERENCES sidecar_assets(asset_id),
              FOREIGN KEY(source_version_id) REFERENCES asset_source_versions(version_id)
            );
            CREATE TABLE IF NOT EXISTS external_edit_lineage (
              child_source_version_id TEXT NOT NULL,
              parent_position INTEGER NOT NULL,
              parent_asset_id TEXT NOT NULL,
              parent_source_version_id TEXT NOT NULL DEFAULT '',
              job_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              PRIMARY KEY(child_source_version_id, parent_position),
              FOREIGN KEY(child_source_version_id) REFERENCES asset_source_versions(version_id),
              FOREIGN KEY(parent_asset_id) REFERENCES sidecar_assets(asset_id),
              FOREIGN KEY(job_id) REFERENCES external_edit_jobs(job_id)
            );
            """
        )
        try migrateLegacyLineageSchemaIfNeeded(database)
    }

    /// Early PBB-158 builds created lineage rows against a destination asset.
    /// Returned edits are versioned, so current lineage belongs to the returned
    /// source version instead. Upgrade that empty/legacy table in place before
    /// accepting a return from an edit job created by an earlier build.
    private func migrateLegacyLineageSchemaIfNeeded(_ database: OpaquePointer) throws {
        guard try tableExists(database, name: "external_edit_lineage"),
              try tableHasColumn(database, table: "external_edit_lineage", column: "destination_asset_id"),
              try !tableHasColumn(database, table: "external_edit_lineage", column: "child_source_version_id") else {
            return
        }
        try transaction(database) {
            try execScript(
                database,
                """
                ALTER TABLE external_edit_lineage RENAME TO external_edit_lineage_legacy;
                CREATE TABLE external_edit_lineage (
                  child_source_version_id TEXT NOT NULL,
                  parent_position INTEGER NOT NULL,
                  parent_asset_id TEXT NOT NULL,
                  parent_source_version_id TEXT NOT NULL DEFAULT '',
                  job_id TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(child_source_version_id, parent_position),
                  FOREIGN KEY(child_source_version_id) REFERENCES asset_source_versions(version_id),
                  FOREIGN KEY(parent_asset_id) REFERENCES sidecar_assets(asset_id),
                  FOREIGN KEY(job_id) REFERENCES external_edit_jobs(job_id)
                );
                INSERT OR IGNORE INTO external_edit_lineage(
                  child_source_version_id, parent_position, parent_asset_id,
                  parent_source_version_id, job_id, created_at
                )
                SELECT
                  COALESCE(NULLIF(job.returned_source_version_id, ''), returned.source_version_id),
                  legacy.parent_position, legacy.parent_asset_id,
                  legacy.parent_source_version_id, legacy.job_id, legacy.created_at
                FROM external_edit_lineage_legacy AS legacy
                JOIN external_edit_jobs AS job ON job.job_id = legacy.job_id
                LEFT JOIN external_edit_returns AS returned ON returned.job_id = legacy.job_id
                WHERE COALESCE(NULLIF(job.returned_source_version_id, ''), returned.source_version_id) IS NOT NULL
                  AND COALESCE(NULLIF(job.returned_source_version_id, ''), returned.source_version_id) <> ''
                  AND EXISTS (
                    SELECT 1 FROM asset_source_versions AS version
                    WHERE version.version_id = COALESCE(
                      NULLIF(job.returned_source_version_id, ''), returned.source_version_id
                    )
                  );
                DROP TABLE external_edit_lineage_legacy;
                """
            )
        }
    }

    private func readJob(_ database: OpaquePointer, id: String) throws -> ExternalEditJob? {
        try readJob(database, whereClause: "job_id = ?", bindings: [id])
    }

    private func readJob(
        _ database: OpaquePointer,
        whereClause: String,
        bindings: [String]
    ) throws -> ExternalEditJob? {
        var statement: OpaquePointer?
        let sql = """
        SELECT job_id, fixture_id, kind, state, editor_name, editor_bundle_id,
               editor_application_path, working_directory, destination_asset_id,
               returned_file_path, returned_source_version_id, error_text,
               created_at, updated_at
        FROM external_edit_jobs WHERE \(whereClause)
        """
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else { throw databaseError(database) }
        defer { sqlite3_finalize(statement) }
        bind(bindings, to: statement)
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        let jobID = text(statement, 0)
        let sources = try readSources(database, jobID: jobID)
        return ExternalEditJob(
            id: jobID,
            fixtureID: text(statement, 1),
            kind: ExternalEditKind(rawValue: text(statement, 2)) ?? .edit,
            state: ExternalEditJobState(rawValue: text(statement, 3)) ?? .failed,
            editor: ExternalEditorProfile(
                name: text(statement, 4),
                bundleIdentifier: text(statement, 5),
                applicationURL: URL(fileURLWithPath: text(statement, 6))
            ),
            workingDirectory: URL(fileURLWithPath: text(statement, 7), isDirectory: true),
            sources: sources,
            destinationAssetID: text(statement, 8),
            returnedFileURL: text(statement, 9).isEmpty ? nil : URL(fileURLWithPath: text(statement, 9)),
            returnedSourceVersionID: text(statement, 10),
            errorMessage: text(statement, 11),
            createdAt: Self.parseTimestamp(text(statement, 12)),
            updatedAt: Self.parseTimestamp(text(statement, 13))
        )
    }

    private func readSources(_ database: OpaquePointer, jobID: String) throws -> [ExternalEditSource] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(
            database,
            """
            SELECT position, asset_id, source_version_id, photo_library_identifier,
                   original_filename, exported_relative_path, checksum_sha256
            FROM external_edit_job_sources WHERE job_id = ? ORDER BY position
            """,
            -1,
            &statement,
            nil
        ) == SQLITE_OK, let statement else { throw databaseError(database) }
        defer { sqlite3_finalize(statement) }
        bind([jobID], to: statement)
        var rows: [ExternalEditSource] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            rows.append(ExternalEditSource(
                position: Int(sqlite3_column_int(statement, 0)),
                assetID: text(statement, 1),
                sourceVersionID: text(statement, 2),
                photoLibraryIdentifier: text(statement, 3),
                originalFilename: text(statement, 4),
                exportedRelativePath: text(statement, 5),
                checksumSHA256: text(statement, 6)
            ))
        }
        return rows
    }

    private func requireJob(_ database: OpaquePointer, id: String) throws -> ExternalEditJob {
        guard let job = try readJob(database, id: id) else { throw ExternalEditJobError.jobNotFound }
        return job
    }

    @discardableResult
    private func execute(_ database: OpaquePointer, _ sql: String, _ bindings: [String]) throws -> Int {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else { throw databaseError(database) }
        defer { sqlite3_finalize(statement) }
        bind(bindings, to: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw databaseError(database) }
        return Int(sqlite3_changes(database))
    }

    private func bind(_ values: [String], to statement: OpaquePointer) {
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (index, value) in values.enumerated() {
            _ = value.withCString {
                sqlite3_bind_text(statement, Int32(index + 1), $0, -1, transient)
            }
        }
    }

    private func transaction(_ database: OpaquePointer, body: () throws -> Void) throws {
        try execScript(database, "BEGIN IMMEDIATE TRANSACTION")
        do {
            try body()
            try execScript(database, "COMMIT")
        } catch {
            sqlite3_exec(database, "ROLLBACK", nil, nil, nil)
            throw error
        }
    }

    private func execScript(_ database: OpaquePointer, _ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw databaseError(database)
        }
    }

    private func scalarInt(_ database: OpaquePointer, _ sql: String) throws -> Int {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else { throw databaseError(database) }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { return 0 }
        return Int(sqlite3_column_int(statement, 0))
    }

    private func tableExists(_ database: OpaquePointer, name: String) throws -> Bool {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(
            database,
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            -1,
            &statement,
            nil
        ) == SQLITE_OK, let statement else { throw databaseError(database) }
        defer { sqlite3_finalize(statement) }
        bind([name], to: statement)
        return sqlite3_step(statement) == SQLITE_ROW
    }

    private func tableHasColumn(
        _ database: OpaquePointer,
        table: String,
        column: String
    ) throws -> Bool {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(
            database,
            "SELECT 1 FROM pragma_table_info(?) WHERE name = ? LIMIT 1",
            -1,
            &statement,
            nil
        ) == SQLITE_OK, let statement else { throw databaseError(database) }
        defer { sqlite3_finalize(statement) }
        bind([table, column], to: statement)
        return sqlite3_step(statement) == SQLITE_ROW
    }

    private func databaseError(_ database: OpaquePointer?) -> ExternalEditJobError {
        let message = database.map { String(cString: sqlite3_errmsg($0)) } ?? "Owner.sqlite is unavailable."
        return .database(message)
    }

    private func text(_ statement: OpaquePointer, _ index: Int32) -> String {
        sqlite3_column_text(statement, index).map(String.init(cString:)) ?? ""
    }

    private func relativePath(_ url: URL, under root: URL) -> String {
        let rootPath = root.standardizedFileURL.path + "/"
        let path = url.standardizedFileURL.path
        return path.hasPrefix(rootPath) ? String(path.dropFirst(rootPath.count)) : ""
    }

    private func writeManifest(_ job: ExternalEditJob) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(job)
        let destination = job.workingDirectory.appendingPathComponent("manifest.json")
        try data.write(to: destination, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
    }

    private static func defaultJobsRoot() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PhotosByElie Backstage/External Edits", isDirectory: true)
    }

    private static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func parseTimestamp(_ value: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value) ?? .distantPast
    }

    private static func sha256(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let data = try handle.read(upToCount: 1_048_576) ?? Data()
            if data.isEmpty { break }
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func sourceVersionID(assetID: String, checksum: String) -> String {
        let material = "\(assetID)\0external-edit\0\(checksum)"
        let digest = SHA256.hash(data: Data(material.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return "srcv-\(digest.prefix(32))"
    }
}
