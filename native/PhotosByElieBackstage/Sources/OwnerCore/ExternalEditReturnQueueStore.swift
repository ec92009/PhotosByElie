import CryptoKit
import Foundation
import SQLite3

/// Durable staging and decision store for files returned by external editors.
///
/// Receiving a file records only a pending comparison. Asset identity, source
/// versions, editorial state, and upload eligibility change only after one of
/// the explicit decisions is committed.
struct ExternalEditReturnQueueSQLiteStore: Sendable {
    private let databaseURL: URL
    private let jobsRoot: URL
    private let busyTimeoutMilliseconds: Int32

    init(databaseURL: URL, jobsRoot: URL, busyTimeoutMilliseconds: Int32) {
        self.databaseURL = databaseURL
        self.jobsRoot = jobsRoot
        self.busyTimeoutMilliseconds = busyTimeoutMilliseconds
    }

    func stage(
        job: ExternalEditJob,
        sourceURL: URL,
        now: Date
    ) throws -> ExternalEditReturnCandidate {
        let sourceURL = sourceURL.standardizedFileURL
        let staged = try copyReturnedFile(job: job, sourceURL: sourceURL)
        let timestamp = Self.timestamp(now)
        do {
            try persistPendingReturn(job: job, staged: staged, timestamp: timestamp)
        } catch {
            try? FileManager.default.removeItem(at: staged.url)
            throw error
        }
        return ExternalEditReturnCandidate(
            id: staged.id,
            jobID: job.id,
            fixtureID: job.fixtureID,
            kind: job.kind,
            editor: job.editor,
            sources: job.sources,
            originalFileURLs: originalFileURLs(for: job),
            returnedFileURL: staged.url,
            checksumSHA256: staged.checksum,
            byteCount: staged.byteCount,
            createdAt: now,
            errorMessage: ""
        )
    }

    private func copyReturnedFile(job: ExternalEditJob, sourceURL: URL) throws -> StagedFile {
        let file = try validateInputFile(sourceURL)
        let returnID = "return-\(UUID().uuidString.lowercased())"
        let directory = job.returnDirectory.appendingPathComponent("Accepted", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let target = directory.appendingPathComponent(returnID)
            .appendingPathExtension(sourceURL.pathExtension.lowercased())
        try FileManager.default.copyItem(at: sourceURL, to: target)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
        return StagedFile(
            id: returnID,
            url: target,
            checksum: try sha256(target),
            byteCount: file.byteCount
        )
    }

    private func persistPendingReturn(
        job: ExternalEditJob,
        staged: StagedFile,
        timestamp: String
    ) throws {
        let database = try openWritable()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        try transaction(database) {
            try insertPendingQueueRow(database, job: job, staged: staged, timestamp: timestamp)
            let changed = try markJobReturned(database, jobID: job.id, staged: staged, timestamp: timestamp)
            guard changed == 1 else { throw ExternalEditJobError.invalidState }
            try execute(database, "DELETE FROM external_edit_asset_locks WHERE job_id = ?", [job.id])
        }
    }

    private func insertPendingQueueRow(
        _ database: OpaquePointer,
        job: ExternalEditJob,
        staged: StagedFile,
        timestamp: String
    ) throws {
        try execute(
            database,
            """
            INSERT INTO external_edit_return_queue(
              return_id, job_id, fixture_id, kind, file_path,
              checksum_sha256, byte_count, state, decision,
              destination_asset_id, source_version_id, error_text,
              created_at, decided_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '', '', '', '', ?, NULL, ?)
            """,
            [
                staged.id, job.id, job.fixtureID, job.kind.rawValue, staged.url.path,
                staged.checksum, String(staged.byteCount), timestamp, timestamp,
            ]
        )
    }

    private func markJobReturned(
        _ database: OpaquePointer,
        jobID: String,
        staged: StagedFile,
        timestamp: String
    ) throws -> Int {
        try execute(
            database,
            """
            UPDATE external_edit_jobs
            SET state = 'returned', destination_asset_id = '',
                returned_file_path = ?, returned_source_version_id = '',
                error_text = '', updated_at = ?
            WHERE job_id = ? AND state IN ('preparing', 'editing')
            """,
            [staged.url.path, timestamp, jobID]
        )
    }

    func pending(fixtureID: String) throws -> [ExternalEditReturnCandidate] {
        let database = try openWritable()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        let rows = try readRows(
            database,
            whereClause: "queue.fixture_id = ? AND queue.state = 'pending'",
            bindings: [fixtureID]
        )
        return try rows.map { try candidate(from: $0, database: database) }
    }

    func resolve(
        returnID: String,
        decision: ExternalEditReturnDecision,
        now: Date
    ) throws -> ExternalEditReturnResolution {
        let database = try openWritable()
        defer { sqlite3_close_v2(database) }
        try ensureSchema(database)
        guard let row = try readRows(
            database,
            whereClause: "queue.return_id = ?",
            bindings: [returnID]
        ).first else {
            throw ExternalEditJobError.jobNotFound
        }
        if row.state == "resolved" {
            guard row.decision == decision.rawValue else { throw ExternalEditJobError.invalidState }
            return resolution(from: row, decision: decision)
        }
        guard row.state == "pending" else { throw ExternalEditJobError.invalidState }
        let sources = try readSources(database, jobID: row.jobID)
        if decision == .replaceOriginal, sources.count != 1 || row.kind != .edit {
            try recordError(database, returnID: returnID, message: "Replace original requires one edited source.", now: now)
            throw ExternalEditJobError.invalidSources
        }
        do {
            try validateStagedFile(row)
            return try commit(
                row: row,
                sources: sources,
                decision: decision,
                now: now,
                database: database
            )
        } catch {
            try? recordError(
                database,
                returnID: returnID,
                message: error.localizedDescription,
                now: now
            )
            throw error
        }
    }

    private func commit(
        row: QueueRow,
        sources: [ExternalEditSource],
        decision: ExternalEditReturnDecision,
        now: Date,
        database: OpaquePointer
    ) throws -> ExternalEditReturnResolution {
        let timestamp = Self.timestamp(now)
        let derived = decision == .keepBoth
        let destinationAssetID = decisionDestination(
            decision: decision,
            sources: sources
        )
        let sourceVersionID = destinationAssetID.isEmpty
            ? ""
            : Self.sourceVersionID(assetID: destinationAssetID, checksum: row.checksumSHA256)

        let record = DecisionRecord(
            decision: decision,
            destinationAssetID: destinationAssetID,
            sourceVersionID: sourceVersionID,
            timestamp: timestamp
        )
        try transaction(database) {
            try commitDecisionRecords(
                database,
                row: row,
                sources: sources,
                record: record
            )
        }
        return ExternalEditReturnResolution(
            returnID: row.returnID,
            decision: decision,
            destinationAssetID: destinationAssetID,
            sourceVersionID: sourceVersionID,
            fileURL: row.fileURL,
            derivedAsset: derived
        )
    }

    private func decisionDestination(
        decision: ExternalEditReturnDecision,
        sources: [ExternalEditSource]
    ) -> String {
        if decision == .replaceOriginal { return sources[0].assetID }
        if decision == .keepBoth { return "derived-\(UUID().uuidString.lowercased())" }
        return ""
    }

    private func commitDecisionRecords(
        _ database: OpaquePointer,
        row: QueueRow,
        sources: [ExternalEditSource],
        record: DecisionRecord
    ) throws {
        if record.decision == .keepBoth {
            try insertDerivedAsset(
                database,
                assetID: record.destinationAssetID,
                fixtureID: row.fixtureID,
                filename: row.fileURL.lastPathComponent,
                sourceCount: sources.count,
                timestamp: record.timestamp
            )
        }
        if !record.destinationAssetID.isEmpty {
            try acceptStagedReturn(
                database,
                row: row,
                sources: sources,
                destinationAssetID: record.destinationAssetID,
                sourceVersionID: record.sourceVersionID,
                timestamp: record.timestamp
            )
        }
        try resolveQueueRow(database, row: row, record: record)
        try updateResolvedJob(database, row: row, record: record)
        try insertDecisionEvent(database, row: row, record: record)
    }

    private func resolveQueueRow(
        _ database: OpaquePointer,
        row: QueueRow,
        record: DecisionRecord
    ) throws {
        try execute(
            database,
            """
            UPDATE external_edit_return_queue
            SET state = 'resolved', decision = ?, destination_asset_id = ?,
                source_version_id = ?, error_text = '', decided_at = ?, updated_at = ?
            WHERE return_id = ? AND state = 'pending'
            """,
            [record.decision.rawValue, record.destinationAssetID, record.sourceVersionID, record.timestamp, record.timestamp, row.returnID]
        )
    }

    private func updateResolvedJob(
        _ database: OpaquePointer,
        row: QueueRow,
        record: DecisionRecord
    ) throws {
        try execute(
            database,
            """
            UPDATE external_edit_jobs
            SET destination_asset_id = ?, returned_source_version_id = ?, updated_at = ?
            WHERE job_id = ? AND state = 'returned'
            """,
            [record.destinationAssetID, record.sourceVersionID, record.timestamp, row.jobID]
        )
    }

    private func insertDecisionEvent(
        _ database: OpaquePointer,
        row: QueueRow,
        record: DecisionRecord
    ) throws {
        try execute(
            database,
            """
            INSERT INTO external_edit_return_events(
              event_id, return_id, action, destination_asset_id,
              source_version_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                "editevent-\(UUID().uuidString.lowercased())", row.returnID,
                record.decision.rawValue, record.destinationAssetID,
                record.sourceVersionID, record.timestamp,
            ]
        )
    }

    private func acceptStagedReturn(
        _ database: OpaquePointer,
        row: QueueRow,
        sources: [ExternalEditSource],
        destinationAssetID: String,
        sourceVersionID: String,
        timestamp: String
    ) throws {
        try ensureReviewState(
            database,
            fixtureID: row.fixtureID,
            assetID: destinationAssetID,
            timestamp: timestamp
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
            [sourceVersionID, destinationAssetID, row.checksumSHA256, timestamp]
        )
        try insertAcceptedReturn(
            database,
            row: row,
            destinationAssetID: destinationAssetID,
            sourceVersionID: sourceVersionID
        )
        try resetEditorialAndDelivery(
            database,
            assetID: destinationAssetID,
            sourceVersionID: sourceVersionID,
            timestamp: timestamp
        )
        try insertLineage(
            database,
            row: row,
            sources: sources,
            sourceVersionID: sourceVersionID,
            timestamp: timestamp
        )
    }

    private func insertAcceptedReturn(
        _ database: OpaquePointer,
        row: QueueRow,
        destinationAssetID: String,
        sourceVersionID: String
    ) throws {
        try execute(
            database,
            """
            INSERT INTO external_edit_returns(
              return_id, job_id, destination_asset_id, source_version_id,
              file_path, checksum_sha256, byte_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                row.returnID, row.jobID, destinationAssetID, sourceVersionID,
                row.fileURL.path, row.checksumSHA256, String(row.byteCount), row.createdAt,
            ]
        )
    }

    private func insertLineage(
        _ database: OpaquePointer,
        row: QueueRow,
        sources: [ExternalEditSource],
        sourceVersionID: String,
        timestamp: String
    ) throws {
        for source in sources {
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
                    source.sourceVersionID, row.jobID, timestamp,
                ]
            )
        }
    }

    private func ensureReviewState(
        _ database: OpaquePointer,
        fixtureID: String,
        assetID: String,
        timestamp: String
    ) throws {
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
            [fixtureID, assetID, timestamp, timestamp]
        )
    }

    private func resetEditorialAndDelivery(
        _ database: OpaquePointer,
        assetID: String,
        sourceVersionID: String,
        timestamp: String
    ) throws {
        try execute(
            database,
            """
            UPDATE asset_editorial_state
            SET editorial_state = 'unreviewed', ai_reasons_json = '[]', ai_note = '',
                requested_at = NULL, approved_at = NULL, updated_at = ?
            WHERE asset_id = ?
            """,
            [timestamp, assetID]
        )
        try execute(
            database,
            """
            UPDATE sidecar_decisions
            SET pick_state = 'picked', metadata_state = 'unreviewed',
                last_action = 'external-edit-return', updated_at = ?
            WHERE asset_id = ?
            """,
            [timestamp, assetID]
        )
        try execute(
            database,
            """
            INSERT INTO asset_delivery_state(
              asset_id, delivery_state, source_version_hash, last_error, created_at, updated_at
            ) VALUES (?, 'not-ready', ?, '', ?, ?)
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
            [assetID, sourceVersionID, timestamp, timestamp]
        )
    }

    private func insertDerivedAsset(
        _ database: OpaquePointer,
        assetID: String,
        fixtureID: String,
        filename: String,
        sourceCount: Int,
        timestamp: String
    ) throws {
        let title = sourceCount == 1 ? "Edited photo" : "Composite from \(sourceCount) photos"
        try insertDerivedIdentity(
            database,
            assetID: assetID,
            filename: filename,
            title: title,
            timestamp: timestamp
        )
        try insertDerivedFixtureState(
            database,
            assetID: assetID,
            fixtureID: fixtureID,
            timestamp: timestamp
        )
    }

    private func insertDerivedIdentity(
        _ database: OpaquePointer,
        assetID: String,
        filename: String,
        title: String,
        timestamp: String
    ) throws {
        try execute(
            database,
            """
            INSERT INTO sidecar_assets(
              asset_id, source_anchor, media_type, filename, photos_title,
              photos_keywords_json, location_keywords_json, metadata_seed_keywords_json,
              raw_json, indexed_at, updated_at
            ) VALUES (?, ?, 'photo', ?, ?, '[]', '[]', '[]', '{}', ?, ?)
            """,
            [assetID, "external-edit://\(assetID)", filename, title, timestamp, timestamp]
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
    }

    private func insertDerivedFixtureState(
        _ database: OpaquePointer,
        assetID: String,
        fixtureID: String,
        timestamp: String
    ) throws {
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

    private func readRows(
        _ database: OpaquePointer,
        whereClause: String,
        bindings: [String]
    ) throws -> [QueueRow] {
        var statement: OpaquePointer?
        let sql = """
        SELECT queue.return_id, queue.job_id, queue.fixture_id, queue.kind,
               job.editor_name, job.editor_bundle_id, job.editor_application_path,
               job.working_directory, queue.file_path, queue.checksum_sha256,
               queue.byte_count, queue.created_at, queue.error_text, queue.state,
               queue.decision, queue.destination_asset_id, queue.source_version_id
        FROM external_edit_return_queue AS queue
        JOIN external_edit_jobs AS job ON job.job_id = queue.job_id
        WHERE \(whereClause)
        ORDER BY queue.created_at, queue.return_id
        """
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else { throw databaseError(database) }
        defer { sqlite3_finalize(statement) }
        bind(bindings, to: statement)
        var rows: [QueueRow] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            rows.append(QueueRow(
                returnID: text(statement, 0),
                jobID: text(statement, 1),
                fixtureID: text(statement, 2),
                kind: ExternalEditKind(rawValue: text(statement, 3)) ?? .edit,
                editor: ExternalEditorProfile(
                    name: text(statement, 4),
                    bundleIdentifier: text(statement, 5),
                    applicationURL: URL(fileURLWithPath: text(statement, 6))
                ),
                workingDirectory: URL(fileURLWithPath: text(statement, 7), isDirectory: true),
                fileURL: URL(fileURLWithPath: text(statement, 8)),
                checksumSHA256: text(statement, 9),
                byteCount: sqlite3_column_int64(statement, 10),
                createdAt: text(statement, 11),
                errorMessage: text(statement, 12),
                state: text(statement, 13),
                decision: text(statement, 14),
                destinationAssetID: text(statement, 15),
                sourceVersionID: text(statement, 16)
            ))
        }
        return rows
    }

    private func candidate(
        from row: QueueRow,
        database: OpaquePointer
    ) throws -> ExternalEditReturnCandidate {
        let sources = try readSources(database, jobID: row.jobID)
        return ExternalEditReturnCandidate(
            id: row.returnID,
            jobID: row.jobID,
            fixtureID: row.fixtureID,
            kind: row.kind,
            editor: row.editor,
            sources: sources,
            originalFileURLs: sources.compactMap {
                let relative = $0.exportedRelativePath.trimmingCharacters(in: .whitespacesAndNewlines)
                return relative.isEmpty ? nil : row.workingDirectory.appendingPathComponent(relative)
            },
            returnedFileURL: row.fileURL,
            checksumSHA256: row.checksumSHA256,
            byteCount: row.byteCount,
            createdAt: Self.parseTimestamp(row.createdAt),
            errorMessage: row.errorMessage
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

    private func originalFileURLs(for job: ExternalEditJob) -> [URL] {
        job.sources.compactMap {
            let relative = $0.exportedRelativePath.trimmingCharacters(in: .whitespacesAndNewlines)
            return relative.isEmpty ? nil : job.workingDirectory.appendingPathComponent(relative)
        }
    }

    private func validateInputFile(_ url: URL) throws -> (byteCount: Int64, extension: String) {
        let allowedExtensions = Set(["jpg", "jpeg", "tif", "tiff", "png", "heic"])
        let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values?.isRegularFile == true,
              values?.isSymbolicLink != true,
              allowedExtensions.contains(url.pathExtension.lowercased()),
              let size = values?.fileSize,
              size > 0 else {
            throw ExternalEditJobError.invalidReturnedFile
        }
        return (Int64(size), url.pathExtension.lowercased())
    }

    private func validateStagedFile(_ row: QueueRow) throws {
        let url = row.fileURL.standardizedFileURL
        let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard url.path.hasPrefix(jobsRoot.standardizedFileURL.path + "/"),
              url.path.contains("/Return/Accepted/"),
              values?.isRegularFile == true,
              values?.isSymbolicLink != true,
              Int64(values?.fileSize ?? 0) == row.byteCount,
              row.byteCount > 0,
              try sha256(url) == row.checksumSHA256 else {
            throw ExternalEditJobError.invalidReturnedFile
        }
    }

    private func resolution(
        from row: QueueRow,
        decision: ExternalEditReturnDecision
    ) -> ExternalEditReturnResolution {
        ExternalEditReturnResolution(
            returnID: row.returnID,
            decision: decision,
            destinationAssetID: row.destinationAssetID,
            sourceVersionID: row.sourceVersionID,
            fileURL: row.fileURL,
            derivedAsset: decision == .keepBoth
        )
    }

    private func recordError(
        _ database: OpaquePointer,
        returnID: String,
        message: String,
        now: Date
    ) throws {
        try execute(
            database,
            """
            UPDATE external_edit_return_queue
            SET error_text = ?, updated_at = ?
            WHERE return_id = ? AND state = 'pending'
            """,
            [message, Self.timestamp(now), returnID]
        )
    }

    private func ensureSchema(_ database: OpaquePointer) throws {
        try execScript(
            database,
            """
            CREATE TABLE IF NOT EXISTS external_edit_return_queue (
              return_id TEXT PRIMARY KEY,
              job_id TEXT NOT NULL UNIQUE,
              fixture_id TEXT NOT NULL,
              kind TEXT NOT NULL CHECK(kind IN ('edit', 'create')),
              file_path TEXT NOT NULL,
              checksum_sha256 TEXT NOT NULL,
              byte_count INTEGER NOT NULL CHECK(byte_count > 0),
              state TEXT NOT NULL CHECK(state IN ('pending', 'resolved')),
              decision TEXT NOT NULL DEFAULT '' CHECK(decision IN ('', 'keep-original', 'replace-original', 'keep-both')),
              destination_asset_id TEXT NOT NULL DEFAULT '',
              source_version_id TEXT NOT NULL DEFAULT '',
              error_text TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              decided_at TEXT,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(job_id) REFERENCES external_edit_jobs(job_id)
            );
            CREATE INDEX IF NOT EXISTS idx_external_edit_return_queue_fixture
              ON external_edit_return_queue(fixture_id, state, created_at, return_id);
            CREATE TABLE IF NOT EXISTS external_edit_return_events (
              event_id TEXT PRIMARY KEY,
              return_id TEXT NOT NULL,
              action TEXT NOT NULL CHECK(action IN ('keep-original', 'replace-original', 'keep-both')),
              destination_asset_id TEXT NOT NULL DEFAULT '',
              source_version_id TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              FOREIGN KEY(return_id) REFERENCES external_edit_return_queue(return_id)
            );
            """
        )
    }

    private func openWritable() throws -> OpaquePointer {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw ExternalEditJobError.databaseUnavailable
        }
        var database: OpaquePointer?
        guard sqlite3_open_v2(
            databaseURL.path,
            &database,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        ) == SQLITE_OK, let database else {
            if let database { sqlite3_close_v2(database) }
            throw ExternalEditJobError.databaseUnavailable
        }
        sqlite3_busy_timeout(database, busyTimeoutMilliseconds)
        sqlite3_exec(database, "PRAGMA foreign_keys = ON", nil, nil, nil)
        return database
    }

    @discardableResult
    private func execute(
        _ database: OpaquePointer,
        _ sql: String,
        _ bindings: [String]
    ) throws -> Int {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else { throw databaseError(database) }
        defer { sqlite3_finalize(statement) }
        bind(bindings, to: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw databaseError(database) }
        return Int(sqlite3_changes(database))
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

    private func bind(_ values: [String], to statement: OpaquePointer) {
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (index, value) in values.enumerated() {
            _ = value.withCString {
                sqlite3_bind_text(statement, Int32(index + 1), $0, -1, transient)
            }
        }
    }

    private func databaseError(_ database: OpaquePointer?) -> ExternalEditJobError {
        .database(database.map { String(cString: sqlite3_errmsg($0)) } ?? "Owner.sqlite is unavailable.")
    }

    private func text(_ statement: OpaquePointer, _ index: Int32) -> String {
        sqlite3_column_text(statement, index).map(String.init(cString:)) ?? ""
    }

    private func sha256(_ url: URL) throws -> String {
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
}

private struct StagedFile {
    var id: String
    var url: URL
    var checksum: String
    var byteCount: Int64
}

private struct DecisionRecord {
    var decision: ExternalEditReturnDecision
    var destinationAssetID: String
    var sourceVersionID: String
    var timestamp: String
}

private struct QueueRow {
    var returnID: String
    var jobID: String
    var fixtureID: String
    var kind: ExternalEditKind
    var editor: ExternalEditorProfile
    var workingDirectory: URL
    var fileURL: URL
    var checksumSHA256: String
    var byteCount: Int64
    var createdAt: String
    var errorMessage: String
    var state: String
    var decision: String
    var destinationAssetID: String
    var sourceVersionID: String
}
