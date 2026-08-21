import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("Metadata proposal SQLite reads")
struct MetadataProposalSQLiteStoreTests {
    @Test("Pending Metadata proposals and model ladder come from Owner.sqlite")
    func readsPendingProposalQueue() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("metadata-proposal-sqlite-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try seedMetadataProposalDatabase(at: databaseURL)

        let queue = try MetadataProposalSQLiteStore(databaseURL: databaseURL).proposals()

        #expect(queue.batchId == "all-pending")
        #expect(queue.photos.count == 1)
        let proposal = try #require(queue.photos.first)
        #expect(proposal.photoId == "asset-proposed")
        #expect(proposal.batchId == "batch-2")
        #expect(proposal.current.title == "Before")
        #expect(proposal.current.keywords == ["Madrid"])
        #expect(proposal.proposed.title == "After")
        #expect(proposal.proposed.keywords == ["Madrid", "Museum"])
        #expect(proposal.proposed.reason == "More specific")
        #expect(proposal.proposed.generator?.model == "gpt-5.4-mini")
        #expect(proposal.proposed.generator?.reasoningEffort == "low")
        #expect(proposal.proposed.generator?.vision == true)
        #expect(proposal.state?.proposalAttempt == 2)
        #expect(proposal.state?.reworkRequested == true)
        #expect(queue.modelLadder == [
            MetadataModelLadderRung(model: "gpt-5.4-mini", effort: "low"),
            MetadataModelLadderRung(model: "gpt-5.6-sol", effort: "high"),
        ])
        #expect(queue.modelCatalog == MetadataModelLadderRung.catalog)
    }

    @Test("Missing Metadata database fails closed")
    func missingDatabaseFailsClosed() {
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent("missing-metadata-\(UUID().uuidString).sqlite")
        #expect(throws: APIErrorEnvelope.self) {
            try MetadataProposalSQLiteStore(databaseURL: missing).proposals()
        }
    }
}

private func seedMetadataProposalDatabase(at url: URL) throws {
    var database: OpaquePointer?
    guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else {
        throw OwnerDatabaseError.unavailable("test database unavailable")
    }
    defer { sqlite3_close(database) }
    let schema = #"""
    CREATE TABLE owner_settings(
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL
    );
    CREATE TABLE title_keyword_queue(
      media_id TEXT PRIMARY KEY,
      review_state TEXT NOT NULL,
      latest_attempt INTEGER NOT NULL,
      latest_proposed_batch_id TEXT,
      latest_proposed_at TEXT,
      owner_comment TEXT
    );
    CREATE TABLE title_keyword_proposals(
      media_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      previous_title TEXT,
      previous_keywords TEXT,
      proposed_title TEXT,
      proposed_keywords TEXT,
      confidence TEXT,
      proposal_reason TEXT,
      generator_model TEXT,
      requested_generator_model TEXT,
      resolved_model TEXT,
      reasoning_effort TEXT,
      vision INTEGER NOT NULL DEFAULT 1,
      generator_model_level INTEGER,
      generator_model_maxed INTEGER NOT NULL DEFAULT 0,
      model_ladder TEXT,
      PRIMARY KEY(media_id, attempt)
    );
    INSERT INTO owner_settings(setting_key, setting_value) VALUES(
      'title_keyword_model_ladder',
      '[{"model":"gpt-5.4-mini","effort":"low","vision":true},{"model":"gpt-5.6-sol","effort":"high","vision":true}]'
    );
    INSERT INTO title_keyword_queue(
      media_id, review_state, latest_attempt, latest_proposed_batch_id, latest_proposed_at, owner_comment
    ) VALUES
      ('asset-proposed', 'proposed', 2, 'batch-2', '2026-08-21T10:00:00Z', ''),
      ('asset-approved', 'approved', 1, 'batch-1', '2026-08-20T10:00:00Z', '');
    INSERT INTO title_keyword_proposals(
      media_id, attempt, previous_title, previous_keywords, proposed_title,
      proposed_keywords, confidence, proposal_reason, generator_model,
      requested_generator_model, resolved_model, reasoning_effort, vision,
      generator_model_level, generator_model_maxed, model_ladder
    ) VALUES
      ('asset-proposed', 2, 'Before', '["Madrid"]', 'After',
       '["Madrid","Museum"]', 'high', 'More specific', 'gpt-5.4-mini',
       'gpt-5.4-mini', 'gpt-5.4-mini', 'low', 1, 0, 0,
       '["gpt-5.4-mini","gpt-5.6-sol"]'),
      ('asset-approved', 1, 'Old', '[]', 'Approved',
       '["Done"]', 'high', '', 'gpt-5.4-mini',
       'gpt-5.4-mini', 'gpt-5.4-mini', 'low', 1, 0, 0,
       '["gpt-5.4-mini"]');
    """#
    guard sqlite3_exec(database, schema, nil, nil, nil) == SQLITE_OK else {
        throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
    }
}
