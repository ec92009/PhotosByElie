import Foundation
import SQLite3

/// Reads the legacy Metadata proposal table directly from authoritative
/// Owner.sqlite. Proposal decisions deliberately remain Worker-authorized
/// actions; this store owns no write path.
public struct MetadataProposalSQLiteStore: Sendable {
    private let databaseURL: URL

    public init(databaseURL: URL) {
        self.databaseURL = databaseURL.standardizedFileURL
    }

    public func proposals() throws -> MetadataProposalQueue {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else {
            throw APIErrorEnvelope(error: .init(
                code: "native_metadata_database_missing",
                message: "Backstage could not find the native Metadata database."
            ))
        }

        var database: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &database,
            SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let database else {
            if let database {
                sqlite3_close_v2(database)
            }
            throw sqliteError(database, code: "native_metadata_database_open_failed")
        }
        defer { sqlite3_close_v2(database) }
        sqlite3_busy_timeout(database, 1_000)

        try execute("BEGIN DEFERRED TRANSACTION", on: database)
        var transactionOpen = true
        defer {
            if transactionOpen {
                sqlite3_exec(database, "ROLLBACK", nil, nil, nil)
            }
        }

        let modelLadder = readModelLadder(from: database)
        let proposals = try readProposals(from: database)
        try execute("COMMIT", on: database)
        transactionOpen = false

        return MetadataProposalQueue(
            batchId: proposals.isEmpty ? "" : "all-pending",
            photos: proposals,
            modelLadder: modelLadder,
            modelCatalog: MetadataModelLadderRung.catalog
        )
    }

    private func readProposals(from database: OpaquePointer) throws -> [MetadataProposal] {
        let sql = """
        SELECT q.media_id,
               COALESCE(q.latest_proposed_batch_id, ''),
               q.latest_attempt,
               COALESCE(p.previous_title, ''),
               COALESCE(p.previous_keywords, ''),
               COALESCE(p.proposed_title, ''),
               COALESCE(p.proposed_keywords, ''),
               COALESCE(p.confidence, ''),
               COALESCE(p.proposal_reason, ''),
               COALESCE(p.generator_model, ''),
               COALESCE(p.requested_generator_model, ''),
               COALESCE(p.resolved_model, ''),
               COALESCE(p.reasoning_effort, ''),
               p.vision,
               p.generator_model_level,
               p.generator_model_maxed,
               COALESCE(p.model_ladder, '[]')
        FROM title_keyword_queue AS q
        JOIN title_keyword_proposals AS p
          ON p.media_id = q.media_id
         AND p.attempt = q.latest_attempt
        WHERE q.review_state = 'proposed'
        ORDER BY q.latest_proposed_at DESC, q.media_id
        """

        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw sqliteError(database, code: "native_metadata_query_failed")
        }
        defer { sqlite3_finalize(statement) }

        var proposals: [MetadataProposal] = []
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                let photoID = text(statement, 0)
                let batchID = text(statement, 1)
                let attempt = Int(sqlite3_column_int64(statement, 2))
                let previousTitle = text(statement, 3)
                let previousKeywords = textList(text(statement, 4))
                let proposedTitle = text(statement, 5)
                let proposedKeywords = textList(text(statement, 6))
                let confidence = optionalText(statement, 7)
                let reason = optionalText(statement, 8)
                let generatorModel = text(statement, 9)
                let requestedGeneratorModel = text(statement, 10)
                let resolvedModel = text(statement, 11)
                let reasoningEffort = text(statement, 12)
                let vision = sqlite3_column_int64(statement, 13) != 0
                let modelLevel = sqlite3_column_type(statement, 14) == SQLITE_NULL
                    ? nil
                    : Int(sqlite3_column_int64(statement, 14))
                let modelMaxed = sqlite3_column_int64(statement, 15) != 0
                let modelLadder = textList(text(statement, 16))

                let generator = MetadataProposalGenerator(
                    model: generatorModel,
                    modelLevel: modelLevel,
                    modelMaxed: modelMaxed,
                    modelLadder: modelLadder,
                    resolvedModel: resolvedModel.isEmpty ? nil : resolvedModel,
                    reasoningEffort: reasoningEffort.isEmpty ? nil : reasoningEffort,
                    vision: vision
                )
                let requestedGenerator = requestedGeneratorModel.isEmpty
                    ? nil
                    : MetadataProposalGenerator(
                        model: requestedGeneratorModel,
                        modelLevel: modelLevel,
                        modelMaxed: modelMaxed,
                        modelLadder: modelLadder,
                        resolvedModel: resolvedModel.isEmpty ? nil : resolvedModel,
                        reasoningEffort: reasoningEffort.isEmpty ? nil : reasoningEffort,
                        vision: vision
                    )

                proposals.append(MetadataProposal(
                    photoID: photoID,
                    batchID: batchID,
                    current: .init(
                        title: previousTitle.isEmpty ? photoID : previousTitle,
                        keywords: previousKeywords
                    ),
                    proposed: .init(
                        title: proposedTitle.isEmpty ? previousTitle : proposedTitle,
                        keywords: proposedKeywords,
                        reason: reason,
                        confidence: confidence,
                        generator: generator
                    ),
                    state: MetadataProposalState(
                        proposalAttempt: attempt,
                        reworkRequested: attempt > 1,
                        requestedGenerator: requestedGenerator,
                        previousGenerator: nil,
                        modelAttempts: attempt,
                        modelPreviewPath: nil
                    )
                ))
            case SQLITE_DONE:
                return proposals
            default:
                throw sqliteError(database, code: "native_metadata_query_failed")
            }
        }
    }

    private func readModelLadder(from database: OpaquePointer) -> [MetadataModelLadderRung] {
        let sql = """
        SELECT setting_value
        FROM owner_settings
        WHERE setting_key = 'title_keyword_model_ladder_json'
        LIMIT 1
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            return MetadataModelLadderRung.defaultLadder
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else {
            return MetadataModelLadderRung.defaultLadder
        }
        let value = text(statement, 0)
        guard let data = value.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([MetadataModelLadderRung].self, from: data),
              !decoded.isEmpty else {
            return MetadataModelLadderRung.defaultLadder
        }
        return decoded
    }

    private func execute(_ sql: String, on database: OpaquePointer) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw sqliteError(database, code: "native_metadata_transaction_failed")
        }
    }

    private func sqliteError(_ database: OpaquePointer?, code: String) -> APIErrorEnvelope {
        APIErrorEnvelope(error: .init(
            code: code,
            message: database.map { String(cString: sqlite3_errmsg($0)) }
                ?? "Backstage could not read Owner.sqlite."
        ))
    }

    private func text(_ statement: OpaquePointer, _ index: Int32) -> String {
        guard let value = sqlite3_column_text(statement, index) else { return "" }
        return String(cString: value)
    }

    private func optionalText(_ statement: OpaquePointer, _ index: Int32) -> String? {
        let value = text(statement, index).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private func textList(_ value: String) -> [String] {
        if let data = value.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([String].self, from: data) {
            return normalized(decoded)
        }
        return normalized(value.components(separatedBy: CharacterSet(charactersIn: ",;\n")))
    }

    private func normalized(_ values: [String]) -> [String] {
        var seen: Set<String> = []
        return values.compactMap { value in
            let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !clean.isEmpty else { return nil }
            let key = clean.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            guard seen.insert(key).inserted else { return nil }
            return clean
        }
    }
}
