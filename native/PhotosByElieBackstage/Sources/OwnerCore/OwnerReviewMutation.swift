import Foundation

/// Per-asset Review writes on the caller's connection and outer transaction.
/// This type never opens, commits or rolls back a connection of its own.
struct ReviewMutationContext {
    let connection: ReviewSQLiteConnection
    let fixtureID: String
    let timestamp: String
    let actor: String
    let sourceVersionsAvailable: Bool
    let beforeReview: [String: JSONValue]

    typealias Placement = (assetID: String, state: String, eligibility: String)

    func apply(
        _ action: FixtureReviewAction,
        to assetID: String,
        metadata: ReviewMutationMetadata,
        activeProposal: [String: JSONValue]?,
        aiRequest: ReviewMutationAIRequest,
        anchorAssetID: String
    ) throws -> Placement? {
        switch action {
        case .hide:
            return try hide(assetID)
        case .returnToReview:
            try returnToReview(assetID)
        case .requestAI:
            return try requestAI(assetID, request: aiRequest)
        case .editMetadata:
            try editMetadata(assetID, metadata: metadata)
        case .propagateCountry, .propagateTitle, .propagateKeywords:
            try propagate(assetID, action: action, metadata: metadata)
        case .approve:
            try approve(assetID, metadata: metadata, activeProposal: activeProposal, isAnchor: assetID == anchorAssetID)
        }
        return nil
    }

    private func hide(_ assetID: String) throws -> Placement {
        let existingPlacement = try connection.queryOne(
            """
            SELECT placement_state, eligibility_state
            FROM fixture_asset_decisions
            WHERE fixture_id = ? AND asset_id = ?
            """,
            bindings: [.string(fixtureID), .string(assetID)]
        )
        let beforePlacement = existingPlacement?["placement_state"]?.stringValue ?? "undecided"
        let beforeEligibility = existingPlacement?["eligibility_state"]?.stringValue ?? "active"
        try connection.execute(
            """
            INSERT INTO fixture_asset_decisions (
              fixture_id, asset_id, placement_state, eligibility_state,
              source, last_action, created_at, updated_at
            ) VALUES (?, ?, 'hidden', 'dormant', 'native', 'review-hidden', ?, ?)
            ON CONFLICT(fixture_id, asset_id) DO UPDATE SET
              placement_state = 'hidden',
              source = 'native',
              last_action = 'review-hidden',
              updated_at = excluded.updated_at
            """,
            bindings: [
                .string(fixtureID), .string(assetID),
                .string(timestamp), .string(timestamp),
            ]
        )

        try connection.execute(
            """
            UPDATE asset_ai_proposals
            SET status = 'superseded', decided_at = ?
            WHERE asset_id = ? AND status IN ('ready', 'loaded')
            """,
            bindings: [.string(timestamp), .string(assetID)]
        )
        try connection.execute(
            """
            UPDATE asset_editorial_state
            SET editorial_state = 'unreviewed', ai_reasons_json = '[]', ai_note = '',
                requested_at = NULL, updated_at = ?
            WHERE asset_id = ?
            """,
            bindings: [.string(timestamp), .string(assetID)]
        )
        return (assetID, beforePlacement, beforeEligibility)
    }

    private func returnToReview(_ assetID: String) throws {
        let editorial = try connection.queryOne(
            "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = ?",
            bindings: [.string(assetID)]
        )
        guard editorial?["editorial_state"]?.stringValue == "approved" else {
            throw OwnerReviewSQLiteError.invalid("asset is not approved: \(assetID)")
        }
        let delivery = try connection.queryOne(
            "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = ?",
            bindings: [.string(assetID)]
        )
        let preservesLiveRendition = delivery?["delivery_state"]?.stringValue == "live"
        try connection.execute(
            """
            UPDATE sidecar_decisions
            SET metadata_state = 'unreviewed', last_action = 'return-to-review',
                updated_at = ?
            WHERE asset_id = ?
            """,
            bindings: [.string(timestamp), .string(assetID)]
        )
        if !preservesLiveRendition {
            try connection.execute(
                """
                INSERT INTO asset_delivery_state (asset_id, delivery_state, created_at, updated_at)
                VALUES (?, 'not-ready', ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  delivery_state = 'not-ready', updated_at = excluded.updated_at
                """,
                bindings: [.string(assetID), .string(timestamp), .string(timestamp)]
            )
        }
        try connection.execute(
            """
            UPDATE asset_editorial_state
            SET editorial_state = 'unreviewed', ai_reasons_json = '[]', ai_note = '',
                requested_at = NULL, approved_at = NULL, updated_at = ?
            WHERE asset_id = ?
            """,
            bindings: [.string(timestamp), .string(assetID)]
        )
    }

    private func requestAI(_ assetID: String, request: ReviewMutationAIRequest) throws -> Placement {
        let cleanAIReasons = request.reasons
        let cleanAINote = request.note
        let existingPlacement = try connection.queryOne(
            """
            SELECT placement_state, eligibility_state
            FROM fixture_asset_decisions
            WHERE fixture_id = ? AND asset_id = ?
            """,
            bindings: [.string(fixtureID), .string(assetID)]
        )
        let beforePlacement = existingPlacement?["placement_state"]?.stringValue ?? "undecided"
        let beforeEligibility = existingPlacement?["eligibility_state"]?.stringValue ?? "active"
        try connection.execute(
            """
            INSERT INTO fixture_asset_decisions (
              fixture_id, asset_id, placement_state, eligibility_state,
              source, last_action, created_at, updated_at
            ) VALUES (?, ?, 'picked', 'dormant', 'native', 'review-picked', ?, ?)
            ON CONFLICT(fixture_id, asset_id) DO UPDATE SET
              placement_state = 'picked',
              source = 'native',
              last_action = 'review-picked',
              updated_at = excluded.updated_at
            """,
            bindings: [
                .string(fixtureID), .string(assetID),
                .string(timestamp), .string(timestamp),
            ]
        )

        try connection.execute(
            """
            UPDATE asset_ai_proposals
            SET status = 'superseded', decided_at = ?
            WHERE asset_id = ? AND status IN ('ready', 'loaded')
            """,
            bindings: [.string(timestamp), .string(assetID)]
        )
        let hasAIRequest = !cleanAIReasons.isEmpty || !cleanAINote.isEmpty
        try connection.execute(
            """
            UPDATE asset_editorial_state
            SET editorial_state = ?, ai_reasons_json = ?, ai_note = ?,
                requested_at = ?, updated_at = ?
            WHERE asset_id = ?
            """,
            bindings: [
                .string(hasAIRequest ? "requesting-ai" : "unreviewed"),
                .string(try encodeReviewJSON(.array(cleanAIReasons.map(JSONValue.string)))),
                .string(hasAIRequest ? cleanAINote : ""),
                hasAIRequest ? .string(timestamp) : .null,
                .string(timestamp), .string(assetID),
            ]
        )
        return (assetID, beforePlacement, beforeEligibility)
    }

    private func writeExplicitMetadata(_ assetID: String, metadata: ReviewMutationMetadata) throws {
        let explicitTitle = metadata.explicitTitle
        let explicitKeywords = metadata.explicitKeywords
        let explicitCountry = metadata.explicitCountry
        if let explicitTitle {
            try connection.execute(
                """
                UPDATE sidecar_decisions
                SET title = ?, last_action = 'metadata', updated_at = ?
                WHERE asset_id = ?
                """,
                bindings: [.string(explicitTitle), .string(timestamp), .string(assetID)]
            )
        }
        if let explicitKeywords {
            try connection.execute(
                """
                UPDATE sidecar_decisions
                SET keywords_json = ?, last_action = 'metadata', updated_at = ?
                WHERE asset_id = ?
                """,
                bindings: [
                    .string(try encodeReviewJSON(.array(explicitKeywords))),
                    .string(timestamp), .string(assetID),
                ]
            )
        }
        if let explicitCountry {
            try setReviewCountry(
                connection,
                assetID: assetID,
                country: explicitCountry,
                actor: actor,
                timestamp: timestamp
            )
        }

    }

    private func editMetadata(_ assetID: String, metadata: ReviewMutationMetadata) throws {
        let previousReview = beforeReview[assetID]?.objectValue ?? [:]
        var afterState = previousReview["editorialState"]?.stringValue ?? "unreviewed"
        let previousReasons = previousReview["aiReasons"] ?? .array([])
        let previousNote = previousReview["aiNote"]?.stringValue ?? ""
        let previousEditorial = try connection.queryOne(
            "SELECT approved_at FROM asset_editorial_state WHERE asset_id = ?",
            bindings: [.string(assetID)]
        ) ?? [:]

        try writeExplicitMetadata(assetID, metadata: metadata)

        if afterState == "approved" {
            try connection.execute(
                """
                INSERT INTO asset_delivery_state (asset_id, delivery_state, created_at, updated_at)
                VALUES (?, 'needs-upload', ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  delivery_state = 'needs-upload', updated_at = excluded.updated_at
                """,
                bindings: [.string(assetID), .string(timestamp), .string(timestamp)]
            )
        } else if afterState == "proposed" {
            afterState = "unreviewed"
            try connection.execute(
                """
                UPDATE asset_ai_proposals
                SET status = 'accepted', decided_at = ?
                WHERE asset_id = ? AND status IN ('ready', 'loaded')
                """,
                bindings: [.string(timestamp), .string(assetID)]
            )
        }

        let approvedAt: ReviewSQLiteBinding
        if afterState == "approved" {
            approvedAt = .string(timestamp)
        } else if let previousApprovedAt = previousEditorial["approved_at"]?.stringValue {
            approvedAt = .string(previousApprovedAt)
        } else {
            approvedAt = .null
        }
        let requestedAt: ReviewSQLiteBinding = afterState == "requesting-ai"
            ? .string(timestamp)
            : .null
        try connection.execute(
            """
            UPDATE asset_editorial_state
            SET editorial_state = ?, ai_reasons_json = ?, ai_note = ?,
                requested_at = ?, approved_at = ?, updated_at = ?
            WHERE asset_id = ?
            """,
            bindings: [
                .string(afterState), .string(try encodeReviewJSON(previousReasons)),
                .string(previousNote), requestedAt, approvedAt,
                .string(timestamp), .string(assetID),
            ]
        )
    }

    private func writePropagatedMetadata(_ assetID: String, action: FixtureReviewAction, metadata: ReviewMutationMetadata) throws {
        let sourceTitle = metadata.sourceTitle
        let sourceKeywords = metadata.sourceKeywords
        let sourceCountry = metadata.sourceCountry
        if action == .propagateCountry {
            try setReviewCountry(
                connection,
                assetID: assetID,
                country: sourceCountry,
                actor: actor,
                timestamp: timestamp
            )
        } else if action == .propagateTitle {
            try connection.execute(
                """
                UPDATE sidecar_decisions
                SET title = ?, last_action = 'metadata', updated_at = ?
                WHERE asset_id = ?
                """,
                bindings: [.string(sourceTitle), .string(timestamp), .string(assetID)]
            )
        } else {
            try connection.execute(
                """
                UPDATE sidecar_decisions
                SET keywords_json = ?, last_action = 'metadata', updated_at = ?
                WHERE asset_id = ?
                """,
                bindings: [
                    .string(try encodeReviewJSON(sourceKeywords)),
                    .string(timestamp), .string(assetID),
                ]
            )
        }
    }

    private func propagate(_ assetID: String, action: FixtureReviewAction, metadata: ReviewMutationMetadata) throws {
        let previousReview = beforeReview[assetID]?.objectValue ?? [:]
        let previousReasons = previousReview["aiReasons"] ?? .array([])
        let previousNote = previousReview["aiNote"]?.stringValue ?? ""
        let previousEditorial = try connection.queryOne(
            "SELECT approved_at FROM asset_editorial_state WHERE asset_id = ?",
            bindings: [.string(assetID)]
        ) ?? [:]
        let afterState = previousReview["editorialState"]?.stringValue ?? "unreviewed"

        try writePropagatedMetadata(assetID, action: action, metadata: metadata)
        if afterState == "approved" {
            try connection.execute(
                """
                INSERT INTO asset_delivery_state (asset_id, delivery_state, created_at, updated_at)
                VALUES (?, 'needs-upload', ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  delivery_state = 'needs-upload', updated_at = excluded.updated_at
                """,
                bindings: [.string(assetID), .string(timestamp), .string(timestamp)]
            )
        }
        let approvedAt: ReviewSQLiteBinding
        if afterState == "approved" {
            approvedAt = .string(timestamp)
        } else if let previousApprovedAt = previousEditorial["approved_at"]?.stringValue {
            approvedAt = .string(previousApprovedAt)
        } else {
            approvedAt = .null
        }
        let requestedAt: ReviewSQLiteBinding = afterState == "requesting-ai"
            ? .string(timestamp)
            : .null
        try connection.execute(
            """
            UPDATE asset_editorial_state
            SET editorial_state = ?, ai_reasons_json = ?, ai_note = ?,
                requested_at = ?, approved_at = ?, updated_at = ?
            WHERE asset_id = ?
            """,
            bindings: [
                .string(afterState), .string(try encodeReviewJSON(previousReasons)),
                .string(previousNote), requestedAt, approvedAt,
                .string(timestamp), .string(assetID),
            ]
        )
    }

    private func acceptProposal(_ assetID: String, proposal: [String: JSONValue]?) throws {
        if let activeProposalID = proposal?["proposal_id"]?.stringValue {
            try connection.execute(
                """
                UPDATE asset_ai_proposals
                SET status = 'accepted', decided_at = ?
                WHERE proposal_id = ?
                """,
                bindings: [.string(timestamp), .string(activeProposalID)]
            )
            try connection.execute(
                """
                UPDATE asset_ai_proposals
                SET status = 'superseded', decided_at = ?
                WHERE asset_id = ? AND status IN ('ready', 'loaded')
                  AND proposal_id != ?
                """,
                bindings: [.string(timestamp), .string(assetID), .string(activeProposalID)]
            )
        }
    }

    private func approveSourceAndQueueDelivery(_ assetID: String) throws {
        if sourceVersionsAvailable {
            try connection.execute(
                """
                UPDATE asset_source_versions
                SET state = 'approved', approved_at = ?, superseded_at = NULL
                WHERE version_id = (
                  SELECT version_id FROM asset_source_versions
                  WHERE asset_id = ? AND source_exists = 1
                  ORDER BY created_at DESC, version_id DESC
                  LIMIT 1
                ) AND state = 'candidate'
                """,
                bindings: [.string(timestamp), .string(assetID)]
            )
            try connection.execute(
                """
                INSERT INTO asset_delivery_state (
                  asset_id, delivery_state, source_version_hash, created_at, updated_at
                )
                VALUES (
                  ?, 'needs-upload',
                  COALESCE((
                    SELECT version_id FROM asset_source_versions
                    WHERE asset_id = ? AND source_exists = 1
                    ORDER BY created_at DESC, version_id DESC
                    LIMIT 1
                  ), ''),
                  ?, ?
                )
                ON CONFLICT(asset_id) DO UPDATE SET
                  delivery_state = 'needs-upload',
                  source_version_hash = excluded.source_version_hash,
                  updated_at = excluded.updated_at
                """,
                bindings: [
                    .string(assetID), .string(assetID),
                    .string(timestamp), .string(timestamp),
                ]
            )
        } else {
            try connection.execute(
                """
                INSERT INTO asset_delivery_state (asset_id, delivery_state, created_at, updated_at)
                VALUES (?, 'needs-upload', ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  delivery_state = 'needs-upload', updated_at = excluded.updated_at
                """,
                bindings: [.string(assetID), .string(timestamp), .string(timestamp)]
            )
        }
    }

    private func approvalMetadata(
        _ assetID: String, metadata: ReviewMutationMetadata,
        activeProposal: [String: JSONValue]?, isAnchor: Bool
    ) throws -> (String, JSONValue, String?) {
        let explicitTitle = metadata.explicitTitle
        let explicitKeywords = metadata.explicitKeywords
        let explicitCountry = metadata.explicitCountry
        let decision = try connection.queryOne(
            "SELECT title, keywords_json FROM sidecar_decisions WHERE asset_id = ?",
            bindings: [.string(assetID)]
        ) ?? [:]
        let approvedTitle: String
        if isAnchor, let explicitTitle {
            approvedTitle = explicitTitle
        } else if let activeProposal {
            approvedTitle = activeProposal["proposed_title"]?.stringValue ?? ""
        } else {
            approvedTitle = decision["title"]?.stringValue ?? ""
        }
        let approvedKeywords: JSONValue
        if isAnchor, let explicitKeywords {
            approvedKeywords = .array(explicitKeywords)
        } else if let activeProposal {
            approvedKeywords = reviewJSONArray(activeProposal["proposed_keywords_json"])
        } else {
            approvedKeywords = reviewJSONArray(decision["keywords_json"])
        }
        let approvedCountry: String?
        if isAnchor, let explicitCountry {
            approvedCountry = explicitCountry
        } else {
            let proposed = activeProposal?["proposed_country"]?.stringValue ?? ""
            approvedCountry = proposed.isEmpty ? nil : proposed
        }
        return (approvedTitle, approvedKeywords, approvedCountry)
    }

    private func approve(
        _ assetID: String, metadata: ReviewMutationMetadata,
        activeProposal: [String: JSONValue]?, isAnchor: Bool
    ) throws {
        let (approvedTitle, approvedKeywords, approvedCountry) = try approvalMetadata(
            assetID, metadata: metadata, activeProposal: activeProposal, isAnchor: isAnchor
        )
        try connection.execute(
            """
            UPDATE sidecar_decisions
            SET metadata_state = 'approved', title = ?, keywords_json = ?,
                last_action = 'approve', updated_at = ?
            WHERE asset_id = ?
            """,
            bindings: [
                .string(approvedTitle), .string(try encodeReviewJSON(approvedKeywords)),
                .string(timestamp), .string(assetID),
            ]
        )
        if let approvedCountry {
            try setReviewCountry(
                connection,
                assetID: assetID,
                country: approvedCountry,
                actor: actor,
                timestamp: timestamp
            )
        }
        try acceptProposal(assetID, proposal: activeProposal)
        try connection.execute(
            """
            UPDATE asset_editorial_state
            SET editorial_state = 'approved', ai_reasons_json = '[]', ai_note = '',
                requested_at = NULL, approved_at = ?, updated_at = ?
            WHERE asset_id = ?
            """,
            bindings: [.string(timestamp), .string(timestamp), .string(assetID)]
        )
        try approveSourceAndQueueDelivery(assetID)
    }

}

struct ReviewMutationMetadata {
    let explicitTitle: String?
    let explicitKeywords: [JSONValue]?
    let explicitCountry: String?
    let sourceTitle: String
    let sourceKeywords: JSONValue
    let sourceCountry: String
}

struct ReviewMutationAIRequest {
    let reasons: [String]
    let note: String
}
