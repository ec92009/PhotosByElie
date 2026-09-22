import CryptoKit
import Foundation

/// The migration creates these tables atomically. Legacy databases remain
/// readable until migration; a migrated fixture never falls back to global approval.
extension ReviewSQLiteConnection {
    var hasFixtureEditions: Bool {
        get throws {
            try queryOne("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_asset_editions'") != nil
        }
    }

    func fixtureEdition(_ assetID: String) throws -> [String: JSONValue]? {
        guard let fixtureID, try hasFixtureEditions else { return nil }
        return try queryOne("SELECT * FROM fixture_asset_editions WHERE fixture_id=? AND asset_id=?",
                            bindings: [.string(fixtureID), .string(assetID)])
    }

    /// Initialize only new memberships. Shared original metadata is a starting
    /// draft; an approval in any other fixture is never copied.
    func seedFixtureEditions() throws {
        guard let fixtureID, try hasFixtureEditions else { return }
        let sourceColumns = try tableColumns("asset_source_versions")
        if sourceColumns.contains("rendered_fingerprint") {
            let originals = try query("""
                SELECT DISTINCT a.asset_id FROM sidecar_assets a JOIN fixture_asset_decisions p USING(asset_id)
                WHERE p.fixture_id=? AND COALESCE(a.missing_at,'')=''
                  AND NOT EXISTS (SELECT 1 FROM asset_source_versions v WHERE v.asset_id=a.asset_id)
                """, bindings: [.string(fixtureID)])
            for original in originals {
                let assetID = original["asset_id"]?.stringValue ?? ""
                let digest = SHA256.hash(data: Data(assetID.utf8)).map { String(format: "%02x", $0) }.joined()
                try execute("""
                    INSERT OR IGNORE INTO asset_source_versions
                    (version_id,asset_id,metadata_fingerprint,rendered_fingerprint,source_exists,state,created_at)
                    VALUES (?,?,'',?,1,'candidate',strftime('%Y-%m-%dT%H:%M:%SZ','now'))
                    """, bindings: [.string("srcv-original-" + digest.prefix(32)),.string(assetID),.string("camera-original:" + assetID)])
            }
        }
        let hasReturns = try queryOne("SELECT 1 FROM sqlite_master WHERE name='external_edit_returns'") != nil
        let originalOnly = hasReturns ? "AND NOT EXISTS (SELECT 1 FROM external_edit_returns r WHERE r.source_version_id=v.version_id)" : ""
        try execute("""
            INSERT OR IGNORE INTO fixture_asset_editions
              (fixture_id,asset_id,title,keywords_json,source_version_id,created_at,updated_at)
            SELECT d.fixture_id,d.asset_id,COALESCE(a.photos_title,''),COALESCE(a.photos_keywords_json,'[]'),
              COALESCE((SELECT version_id FROM asset_source_versions v WHERE v.asset_id=d.asset_id
                AND v.source_exists=1 \(originalOnly) ORDER BY v.created_at DESC,v.version_id DESC LIMIT 1),''),
              strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
            FROM fixture_asset_decisions d JOIN sidecar_assets a USING(asset_id)
            WHERE d.fixture_id=?
            """, bindings: [.string(fixtureID)])
        try execute("""
            UPDATE fixture_asset_editions SET source_version_id=COALESCE((SELECT version_id FROM asset_source_versions v
              WHERE v.asset_id=fixture_asset_editions.asset_id AND v.source_exists=1
              \(originalOnly) ORDER BY v.created_at,v.version_id LIMIT 1),'')
            WHERE fixture_id=? AND source_version_id='' AND editorial_state!='approved'
            """, bindings: [.string(fixtureID)])
    }

    func editionSnapshot(_ assetID: String) throws -> JSONValue? {
        guard let fixtureID, let edition = try fixtureEdition(assetID) else { return nil }
        let placement = try query("SELECT * FROM fixture_asset_decisions WHERE fixture_id=? AND asset_id=?",
                                  bindings: [.string(fixtureID), .string(assetID)])
        let proposals = try query("SELECT * FROM asset_ai_proposals WHERE fixture_id=? AND asset_id=? ORDER BY proposal_id",
                                  bindings: [.string(fixtureID), .string(assetID)])
        return .object(["assetId": .string(assetID), "edition": .object(edition),
                        "fixtureDecisions": .array(placement.map(JSONValue.object)),
                        "proposals": .array(proposals.map(JSONValue.object))])
    }

    func restoreEditionSnapshot(_ snapshot: [String: JSONValue]) throws -> Bool {
        guard let edition = snapshot["edition"]?.objectValue,
              edition["fixture_id"]?.stringValue == fixtureID,
              let assetID = edition["asset_id"]?.stringValue else { return false }
        try upsert("fixture_asset_editions", row: edition, conflict: ["fixture_id", "asset_id"])
        for placement in snapshot["fixtureDecisions"]?.arrayValue ?? [] {
            guard let row = placement.objectValue, row["fixture_id"]?.stringValue == fixtureID else { continue }
            try upsert("fixture_asset_decisions", row: row, conflict: ["fixture_id", "asset_id"])
        }
        try execute("DELETE FROM asset_ai_proposals WHERE fixture_id=? AND asset_id=?",
                    bindings: [.string(fixtureID ?? ""), .string(assetID)])
        for proposal in snapshot["proposals"]?.arrayValue ?? [] {
            if let row = proposal.objectValue {
                try upsert("asset_ai_proposals", row: row, conflict: ["proposal_id"])
            }
        }
        return true
    }
}

enum FixtureEditionRevision {
    static func hash(_ row: [String: JSONValue]) throws -> String {
        let payload: [String: JSONValue] = [
            "fixture_id": row["fixture_id"] ?? .string(""),
            "source_version_id": row["source_version_id"] ?? .string(""),
            "title": row["title"] ?? .string(""),
            "country": row["country"] ?? .string(""),
            "keywords": reviewJSONArray(row["keywords_json"]),
        ]
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return SHA256.hash(data: try encoder.encode(payload)).map { String(format: "%02x", $0) }.joined()
    }
}

extension ReviewMutationContext {
    /// Mutate a fixture edition through the same outer transaction and Review
    /// operation audit. No global editorial, metadata or delivery row is written.
    func applyToEdition(_ action: FixtureReviewAction, assetID: String,
                        metadata: ReviewMutationMetadata, proposal: [String: JSONValue]?,
                        request: ReviewMutationAIRequest, anchorAssetID: String) throws -> Placement? {
        guard var row = try connection.fixtureEdition(assetID) else {
            throw OwnerReviewSQLiteError.invalid("The fixture edition is missing; refresh Review.")
        }
        let beforeHash = try FixtureEditionRevision.hash(row)
        let anchor = assetID == anchorAssetID
        switch action {
        case .approve, .editMetadata:
            if anchor, let title = metadata.explicitTitle { row["title"] = .string(title) }
            else if action == .approve, let title = proposal?["proposed_title"] { row["title"] = title }
            if anchor, let keywords = metadata.explicitKeywords {
                row["keywords_json"] = .string(try encodeReviewJSON(.array(keywords)))
            } else if action == .approve, let keywords = proposal?["proposed_keywords_json"] {
                row["keywords_json"] = keywords
            }
            if anchor, let country = metadata.explicitCountry { row["country"] = .string(country) }
            else if action == .approve, let country = proposal?["proposed_country"]?.stringValue, !country.isEmpty {
                row["country"] = .string(country)
            }
        case .propagateTitle: row["title"] = .string(metadata.sourceTitle)
        case .propagateKeywords: row["keywords_json"] = .string(try encodeReviewJSON(metadata.sourceKeywords))
        case .propagateCountry: row["country"] = .string(metadata.sourceCountry)
        default: break
        }
        let hash = try FixtureEditionRevision.hash(row)
        if beforeHash != hash || action == .returnToReview || action == .hide || action == .requestAI {
            row["editorial_state"] = .string("unreviewed")
            row["approved_at"] = .null
            row["approved_revision_hash"] = .string("")
        }
        row["updated_at"] = .string(timestamp)
        if action == .requestAI {
            guard request.visualReasons.allSatisfy({ VisualRepairDefectCategory(rawValue: $0) != nil }) else {
                throw OwnerReviewSQLiteError.invalid("unknown visual AI reason")
            }
            let requested = !request.reasons.isEmpty || !request.note.isEmpty
            row["editorial_state"] = .string(requested ? "requesting-ai" : "unreviewed")
            row["ai_reasons_json"] = .string(try encodeReviewJSON(.array(request.reasons.map(JSONValue.string))))
            row["ai_note"] = .string(request.note)
            row["ai_preview_path"] = .string("")
            row["ai_preview_sha256"] = .string("")
            row["requested_at"] = requested ? .string(timestamp) : .null
            row["visual_ai_request_json"] = .string(try encodeReviewJSON(.object([
                "reasons": .array(request.visualReasons.sorted().map(JSONValue.string)),
                "fixtureId": .string(fixtureID), "requestedAt": .string(timestamp),
                "sourceVersionId": row["source_version_id"] ?? .string(""),
                "note": .string(request.note),
            ])))
        }
        if action == .approve {
            let source = row["source_version_id"]?.stringValue ?? ""
            guard try connection.queryOne("SELECT 1 FROM asset_source_versions WHERE asset_id=? AND version_id=? AND source_exists=1",
                bindings: [.string(assetID), .string(source)]) != nil else {
                throw OwnerReviewSQLiteError.conflict("The fixture's selected image version is unavailable.")
            }
            row["editorial_state"] = .string("approved")
            row["approved_revision_hash"] = .string(hash)
            row["approved_at"] = .string(timestamp)
            row["visual_ai_request_json"] = .string("{}")
            try connection.execute("""
                INSERT OR IGNORE INTO fixture_edition_versions
                (fixture_id,asset_id,revision_hash,source_version_id,title,keywords_json,country,approved_at,actor)
                VALUES (?,?,?,?,?,?,?,?,?)
                """, bindings: [.string(fixtureID), .string(assetID), .string(hash), .string(source),
                    .string(row["title"]?.stringValue ?? ""), .string(row["keywords_json"]?.stringValue ?? "[]"),
                    .string(row["country"]?.stringValue ?? ""), .string(timestamp), .string(actor)])
        }
        if action == .approve {
            try connection.execute("""
                INSERT OR IGNORE INTO fixture_edition_delivery
                (fixture_id,asset_id,revision_hash,source_version_hash,created_at,updated_at)
                VALUES (?,?,?,?,?,?)
                """, bindings: [.string(fixtureID), .string(assetID), .string(hash),
                    .string(row["source_version_id"]?.stringValue ?? ""), .string(timestamp), .string(timestamp)])
        }
        try connection.upsert("fixture_asset_editions", row: row, conflict: ["fixture_id", "asset_id"])
        if action == .approve || action == .requestAI || action == .hide {
            try connection.execute("""
                UPDATE asset_ai_proposals SET status=?,decided_at=?
                WHERE fixture_id=? AND asset_id=? AND status IN ('ready','loaded')
                """, bindings: [.string(action == .approve ? "accepted" : "superseded"),
                    .string(timestamp), .string(fixtureID), .string(assetID)])
        }
        if action == .hide || action == .requestAI {
            let prior = try connection.queryOne("SELECT placement_state,eligibility_state FROM fixture_asset_decisions WHERE fixture_id=? AND asset_id=?",
                bindings: [.string(fixtureID), .string(assetID)]) ?? [:]
            try connection.execute("""
                UPDATE fixture_asset_decisions SET placement_state=?,last_action=?,updated_at=?
                WHERE fixture_id=? AND asset_id=?
                """, bindings: [.string(action == .hide ? "hidden" : "picked"), .string(action.rawValue),
                    .string(timestamp), .string(fixtureID), .string(assetID)])
            return (assetID, prior["placement_state"]?.stringValue ?? "undecided", prior["eligibility_state"]?.stringValue ?? "active")
        }
        return nil
    }
}
