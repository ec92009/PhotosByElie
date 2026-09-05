import Foundation
import SQLite3

/// Native Review transactions and read-only windows over canonical Owner SQLite.
/// LocalFixtureReviewService uses this store; copied-database parity tests verify
/// metadata, placement, independent AI request scopes and atomic Undo.
public enum OwnerReviewSQLiteError: Error, Equatable, LocalizedError {
    case unavailable(String)
    case invalid(String)
    case conflict(String)
    case unsupportedAction(String)

    public var errorDescription: String? {
        switch self {
        case let .unavailable(message), let .invalid(message),
             let .conflict(message), let .unsupportedAction(message):
            message
        }
    }
}

public struct OwnerReviewSQLiteStore: Sendable {
    public let databaseURL: URL
    public let busyTimeoutMilliseconds: Int32

    public init(
        databaseURL: URL,
        busyTimeoutMilliseconds: Int32 = 2_000
    ) {
        self.databaseURL = databaseURL
        self.busyTimeoutMilliseconds = busyTimeoutMilliseconds
    }

    /// Reads a bounded copied-fixture Review window without crossing the
    /// connector boundary. This mirrors the Python reference contract before
    /// the live Review service is moved to OwnerCore.
    public func reviewWindow(
        fixtureID: String,
        mode: FixtureReviewMode = .backfill,
        stateFilters: [String]? = ["picked"],
        proposalAvailableOnly: Bool = false,
        rawBackingOnly: Bool = false,
        mediaFilters: [String] = ["photos", "videos"],
        offset: Int = 0,
        limit: Int = 200,
        search: String = ""
    ) throws -> FixtureReviewWindow {
        let cleanFixtureID = fixtureID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanFixtureID.isEmpty else {
            throw OwnerReviewSQLiteError.invalid("fixture ID is required")
        }
        let safeOffset = max(0, offset)
        let safeLimit = min(500, max(1, limit))
        let selectedStates = normalizedReviewFilters(stateFilters)
        let effectiveStates = stateFilters == nil
            ? (mode == .full ? ["picked", "approved", "hidden"] : ["picked"])
            : selectedStates
        let includeApproved = stateFilters != nil || mode == .full
        let includeHidden = effectiveStates.contains("hidden") || effectiveStates.contains("uploaded")
        let selectedMedia = Set(mediaFilters.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
            .intersection(["photos", "videos"])
        let connection = try ReviewSQLiteConnection(
            databaseURL: databaseURL,
            busyTimeoutMilliseconds: busyTimeoutMilliseconds
        )
        let visualRequestSelect = try ReviewMutationContext.visualRequestSelect(connection)
        let countryCapability = try countryWriteCapability(connection)
        let proposalColumns = try connection.tableColumns("asset_ai_proposals")
        let sourceVersionsAvailable = !(try connection.tableColumns("asset_source_versions")).isEmpty
        let sourceVersionSelect = sourceVersionsAvailable
            ? "COALESCE(latest_source_version.version_id, '') AS source_version_id"
            : "'' AS source_version_id"
        let sourceVersionJoin = sourceVersionsAvailable
            ? """
              LEFT JOIN asset_source_versions AS latest_source_version
                ON latest_source_version.version_id = (
                  SELECT source_version.version_id
                  FROM asset_source_versions AS source_version
                  WHERE source_version.asset_id = asset.asset_id
                    AND source_version.source_exists = 1
                  ORDER BY source_version.created_at DESC, source_version.version_id DESC
                  LIMIT 1
                )
              """
            : ""
        let proposalCountrySelect = proposalColumns.contains("proposed_country")
            ? "COALESCE(available_proposal.proposed_country, '') AS proposal_country, COALESCE(available_proposal.country_source, '') AS proposal_country_source"
            : "'' AS proposal_country, '' AS proposal_country_source"

        guard try connection.queryOne(
            "SELECT fixture_id FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL",
            bindings: [.string(cleanFixtureID)]
        ) != nil else {
            throw OwnerReviewSQLiteError.invalid("fixture does not exist or is archived")
        }

        var predicates = [
            "COALESCE(decision.pick_state, '') <> 'hidden'",
            "(asset.missing_at IS NULL OR asset.missing_at = '')",
            """
            NOT EXISTS (
              SELECT 1
              FROM sidecar_tombstones AS tombstone
              WHERE tombstone.asset_id = asset.asset_id
                AND tombstone.tombstone_state = 'active'
            )
            """,
            effectiveStates.contains("uploaded") ? "1 = 1" : "current_decision.placement_state IN ('picked'\(includeHidden ? ", 'hidden'" : ""))",
        ]
        let bindings: [ReviewSQLiteBinding] = [.string(cleanFixtureID)]

        if !includeApproved {
            predicates.append("editorial.editorial_state != 'approved'")
        }
        if stateFilters != nil {
            let statePredicates = effectiveStates.compactMap(reviewStatusPredicate)
            predicates.append(
                statePredicates.isEmpty ? "0 = 1" : "(" + statePredicates.joined(separator: " OR ") + ")"
            )
        }
        if proposalAvailableOnly {
            predicates.append(
                """
                EXISTS (
                  SELECT 1
                  FROM asset_ai_proposals AS available_proposal
                  WHERE available_proposal.asset_id = asset.asset_id
                    AND available_proposal.status IN ('ready', 'loaded')
                )
                """
            )
        }
        if rawBackingOnly {
            predicates.append(
                """
                (
                  upper(COALESCE(json_extract(asset.raw_json, '$.resourceFormat'), '')) = 'RAW'
                  OR upper(COALESCE(json_extract(asset.raw_json, '$.preferredResourceFormat'), '')) = 'RAW'
                  OR EXISTS (
                    SELECT 1
                    FROM json_each(COALESCE(json_extract(asset.raw_json, '$.resourceFormats'), '[]')) AS format
                    WHERE upper(trim(format.value)) = 'RAW'
                  )
                  OR EXISTS (
                    SELECT 1
                    FROM json_each(COALESCE(json_extract(asset.raw_json, '$.resources'), '[]')) AS resource
                    WHERE upper(trim(json_extract(resource.value, '$.format'))) = 'RAW'
                  )
                )
                """
            )
        }
        if selectedMedia != ["photos", "videos"] {
            if selectedMedia.isEmpty {
                predicates.append("0 = 1")
            } else if selectedMedia == ["videos"] {
                predicates.append("lower(COALESCE(asset.media_type, 'photo')) = 'video'")
            } else {
                predicates.append("lower(COALESCE(asset.media_type, 'photo')) != 'video'")
            }
        }

        let rows = try connection.query(
            """
            SELECT asset.asset_id,
                   COALESCE(asset.source_anchor, '') AS source_anchor,
                   COALESCE(asset.raw_json, '{}') AS raw_json,
                   COALESCE(asset.filename, '') AS filename,
                   COALESCE(asset.media_type, 'photo') AS media_type,
                   COALESCE(asset.captured_at, '') AS captured_at,
                   COALESCE(asset.pixel_width, 0) AS pixel_width,
                   COALESCE(asset.pixel_height, 0) AS pixel_height,
                   COALESCE(asset.photos_title, '') AS photos_title,
                   COALESCE(asset.photos_keywords_json, '[]') AS photos_keywords_json,
                   COALESCE(asset.location_label, '') AS location_label,
                   COALESCE(asset.location_keywords_json, '[]') AS location_keywords_json,
                   \(sourceVersionSelect),
                   current_decision.placement_state AS placement_state,
                   COALESCE(decision.title, '') AS decision_title,
                   COALESCE(decision.caption, '') AS decision_caption,
                   COALESCE(decision.keywords_json, '[]') AS decision_keywords_json,
                   COALESCE(decision.rating, 0) AS rating,
                   COALESCE(decision.color, '') AS color,
                   editorial.editorial_state AS editorial_state,
                   \(visualRequestSelect),
                   COALESCE(editorial.ai_reasons_json, '[]') AS ai_reasons_json,
                   COALESCE(editorial.ai_note, '') AS ai_note,
                   COALESCE(editorial.ai_attempt_count, 0) AS ai_attempt_count,
                   COALESCE(editorial.ai_last_error, '') AS ai_last_error,
                   COALESCE(editorial.ai_preview_path, '') AS ai_preview_path,
                   available_proposal.proposal_id,
                   COALESCE(available_proposal.proposed_title, '') AS proposal_title,
                   COALESCE(available_proposal.proposed_keywords_json, '[]') AS proposal_keywords_json,
                   \(proposalCountrySelect),
                   COALESCE(available_proposal.reason, '') AS proposal_reason,
                   COALESCE(available_proposal.status, '') AS proposal_status,
                   COALESCE(available_proposal.requested_generator_model, '') AS proposal_requested_generator_model,
                   COALESCE(available_proposal.resolved_model, '') AS proposal_resolved_model,
                   COALESCE(available_proposal.reasoning_effort, '') AS proposal_reasoning_effort,
                   COALESCE(available_proposal.vision, 0) AS proposal_vision,
                   COALESCE(available_proposal.model_ladder, '[]') AS proposal_model_ladder,
                   COALESCE(delivery.delivery_state, 'not-ready') AS delivery_state,
                   CAST(COALESCE(
                     json_extract(asset.raw_json, '$.originalByteCount'),
                     json_extract(asset.raw_json, '$.original_byte_count'),
                     0
                   ) AS INTEGER) AS original_byte_count
            FROM sidecar_assets AS asset
            JOIN fixture_asset_decisions AS current_decision
              ON current_decision.asset_id = asset.asset_id
             AND current_decision.fixture_id = ?
             AND current_decision.eligibility_state = 'active'
            LEFT JOIN sidecar_decisions AS decision
              ON decision.asset_id = asset.asset_id
            JOIN asset_editorial_state AS editorial
              ON editorial.asset_id = asset.asset_id
            JOIN asset_delivery_state AS delivery
              ON delivery.asset_id = asset.asset_id
            \(sourceVersionJoin)
            LEFT JOIN asset_ai_proposals AS available_proposal
              ON available_proposal.proposal_id = (
                SELECT latest_proposal.proposal_id
                FROM asset_ai_proposals AS latest_proposal
                WHERE latest_proposal.asset_id = asset.asset_id
                  AND (
                    latest_proposal.status IN ('ready', 'loaded')
                    OR (
                      editorial.editorial_state = 'requesting-ai'
                      AND latest_proposal.status = 'superseded'
                      AND latest_proposal.decided_at = editorial.requested_at
                    )
                  )
                ORDER BY
                  CASE
                    WHEN latest_proposal.status IN ('ready', 'loaded') THEN 0
                    ELSE 1
                  END,
                  latest_proposal.attempt DESC,
                  latest_proposal.created_at DESC,
                  latest_proposal.proposal_id DESC
                LIMIT 1
              )
            WHERE \(predicates.joined(separator: " AND "))
            ORDER BY COALESCE(asset.captured_at, ''), asset.asset_id
            """,
            bindings: bindings
        )
        let searchedRows = rows.filter { reviewWindowSearchMatches($0, search: search) }
        var items = searchedRows.map(reviewWindowItem)
        for index in items.indices {
            let context = try countryContext(connection, assetID: items[index].id)
            items[index].country = context.country
            items[index].suggestedCountry = context.suggested
            items[index].countrySuggestionSource = context.source
        }
        let pageStart = min(safeOffset, items.count)
        let pageEnd = min(items.count, pageStart + safeLimit)
        let page = Array(items[pageStart..<pageEnd])
        let summary = FixtureReviewSummary(
            total: items.count,
            unreviewed: items.filter { $0.workflowStage == .awaitingReview }.count,
            requestingAI: items.filter { $0.workflowStage == .aiRequested }.count,
            proposed: items.filter { $0.workflowStage == .proposalReady }.count,
            approved: items.filter {
                switch $0.workflowStage {
                case .approved, .needsUpload, .uploading, .fullResolutionUploaded,
                     .publishing, .live, .sold:
                    true
                default:
                    false
                }
            }.count,
            hidden: items.filter { $0.workflowStage == .hiddenFromFixture }.count,
            countryMissing: items.filter { $0.country.isEmpty }.count
        )
        let outputStates = stateFilters ?? (mode == .full ? ["picked", "approved", "hidden"] : ["picked"])
        return FixtureReviewWindow(
            fixtureID: cleanFixtureID,
            mode: mode,
            reviewStateFilters: outputStates,
            proposalAvailableOnly: proposalAvailableOnly,
            rawBackingOnly: rawBackingOnly,
            mediaFilters: mediaFilters,
            offset: safeOffset,
            limit: safeLimit,
            nextOffset: safeOffset + page.count,
            hasNext: safeOffset + page.count < items.count,
            countryWriteEnabled: countryCapability.enabled,
            countryWriteBlockReason: countryCapability.reason,
            summary: summary,
            items: page
        )
    }

    /// Applies the copied-fixture Review parity actions that are safe to prove
    /// before the live writer changes. Other Review actions remain on the
    /// existing connector until their individual parity slices land.
    public func applyReview(
        _ action: FixtureReviewAction,
        fixtureID: String,
        assetIDs: [String],
        anchorAssetID: String = "",
        propagate: Bool = false,
        title: String? = nil,
        keywords: [String]? = nil,
        country: String? = nil,
        proposalID: String? = nil,
        aiReasons: [String] = [],
        aiNote: String = "",
        visualAIReasons: [String] = [],
        actor: String = "owner",
        now: Date = Date()
    ) throws -> FixtureReviewResult {
        guard action == .hide || action == .approve || action == .returnToReview || action == .requestAI
            || action == .editMetadata || action == .propagateTitle
            || action == .propagateKeywords || action == .propagateCountry else {
            throw OwnerReviewSQLiteError.unsupportedAction(action.rawValue)
        }
        var cleanIDs = unique(assetIDs)
        let cleanAnchor = anchorAssetID.trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty ? (cleanIDs.last ?? "") : anchorAssetID
        guard !cleanIDs.isEmpty, !cleanAnchor.isEmpty else {
            throw OwnerReviewSQLiteError.invalid("at least one Review asset is required")
        }
        guard cleanIDs.contains(cleanAnchor) else {
            throw OwnerReviewSQLiteError.invalid("the Review anchor must be one of the selected assets")
        }
        let shouldPropagate = propagate || action == .propagateCountry
            || action == .propagateTitle || action == .propagateKeywords
        let includePropagationAnchor = action != .propagateCountry
            && action != .propagateTitle && action != .propagateKeywords

        let timestamp = ISO8601DateFormatter().string(from: now)
        let operationID = "reviewop-\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(20))"
        let started = Date()
        let connection = try ReviewSQLiteConnection(
            databaseURL: databaseURL,
            busyTimeoutMilliseconds: busyTimeoutMilliseconds
        )
        let proposalColumns = try connection.tableColumns("asset_ai_proposals")
        let externalEditLocksAvailable = !(try connection.tableColumns("external_edit_asset_locks")).isEmpty
        let sourceVersionsAvailable = !(try connection.tableColumns("asset_source_versions")).isEmpty
        let proposedCountrySelect = proposalColumns.contains("proposed_country")
            ? "proposed_country"
            : "'' AS proposed_country"

        return try connection.transaction {
            try ReviewMutationContext.prepareSchema(connection)
            guard try connection.queryOne(
                "SELECT fixture_id FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL",
                bindings: [.string(fixtureID)]
            ) != nil else {
                throw OwnerReviewSQLiteError.invalid("fixture does not exist or is archived")
            }
            if shouldPropagate {
                let propagatedIDs = try propagatedAssetIDs(
                    connection,
                    fixtureID: fixtureID,
                    anchorAssetID: cleanAnchor,
                    includeAnchor: includePropagationAnchor
                )
                cleanIDs = unique([cleanIDs, propagatedIDs].flatMap { $0 })
            }
            guard !cleanIDs.isEmpty else {
                throw OwnerReviewSQLiteError.invalid("review action has no eligible targets")
            }

            if externalEditLocksAvailable {
                for assetID in cleanIDs {
                    if try connection.queryOne(
                        "SELECT asset_id FROM external_edit_asset_locks WHERE asset_id = ?",
                        bindings: [.string(assetID)]
                    ) != nil {
                        throw OwnerReviewSQLiteError.conflict(
                            "Finish or cancel the active external edit before changing this photo."
                        )
                    }
                }
            }

            for assetID in cleanIDs {
                guard try connection.queryOne(
                    "SELECT asset_id FROM sidecar_assets WHERE asset_id = ?",
                    bindings: [.string(assetID)]
                ) != nil else {
                    throw OwnerReviewSQLiteError.invalid("asset is not indexed: \(assetID)")
                }
                guard try connection.queryOne(
                    "SELECT asset_id FROM asset_editorial_state WHERE asset_id = ?",
                    bindings: [.string(assetID)]
                ) != nil else {
                    throw OwnerReviewSQLiteError.invalid("editorial state is missing: \(assetID)")
                }
                try connection.execute(
                    """
                    INSERT OR IGNORE INTO sidecar_decisions (asset_id, created_at, updated_at)
                    VALUES (?, ?, ?)
                    """,
                    bindings: [.string(assetID), .string(timestamp), .string(timestamp)]
                )
            }

            let beforeSnapshots = try cleanIDs.map {
                try snapshot(connection, assetID: $0)
            }
            let beforeReview = try Dictionary(uniqueKeysWithValues: cleanIDs.map {
                ($0, try reviewState(connection, fixtureID: fixtureID, assetID: $0))
            })
            var activeProposals: [String: [String: JSONValue]] = [:]
            if action == .approve {
                for assetID in cleanIDs {
                    if let proposal = try connection.queryOne(
                        """
                        SELECT proposal_id, proposed_title, proposed_keywords_json,
                               \(proposedCountrySelect)
                        FROM asset_ai_proposals
                        WHERE asset_id = ? AND status IN ('ready', 'loaded')
                        ORDER BY attempt DESC, created_at DESC, proposal_id DESC
                        LIMIT 1
                        """,
                        bindings: [.string(assetID)]
                    ) {
                        activeProposals[assetID] = proposal
                    }
                }
                let expectedProposalID = proposalID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if !expectedProposalID.isEmpty,
                   activeProposals[cleanAnchor]?["proposal_id"]?.stringValue != expectedProposalID {
                    throw OwnerReviewSQLiteError.conflict(
                        "the visible AI proposal was superseded or is no longer active; refresh Review before approving"
                    )
                }
            }
            let explicitTitle = title.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            let explicitKeywords = keywords.map { unique($0).map(JSONValue.string) }
            let explicitCountry = country.map {
                $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            }
            let sourceDecision = try connection.queryOne(
                "SELECT title, keywords_json FROM sidecar_decisions WHERE asset_id = ?",
                bindings: [.string(cleanAnchor)]
            ) ?? [:]
            let sourceMetadata = try effectiveMetadata(
                connection,
                assetID: cleanAnchor,
                decision: sourceDecision
            )
            let sourceTitle = explicitTitle ?? sourceMetadata.title
            let sourceKeywords = explicitKeywords.map(JSONValue.array) ?? sourceMetadata.keywords
            let sourceCountry = try explicitCountry
                ?? countryContext(connection, assetID: cleanAnchor).country
            let cleanAIReasons = unique(aiReasons)
            let cleanAINote = aiNote.trimmingCharacters(in: .whitespacesAndNewlines)
            var pendingPlacements: [(assetID: String, state: String, eligibility: String)] = []

            let mutation = ReviewMutationContext(
                connection: connection, fixtureID: fixtureID, timestamp: timestamp,
                actor: actor, sourceVersionsAvailable: sourceVersionsAvailable,
                beforeReview: beforeReview
            )
            let metadata = ReviewMutationMetadata(
                explicitTitle: explicitTitle, explicitKeywords: explicitKeywords,
                explicitCountry: explicitCountry, sourceTitle: sourceTitle,
                sourceKeywords: sourceKeywords, sourceCountry: sourceCountry
            )
            let aiRequest = ReviewMutationAIRequest(reasons: cleanAIReasons, note: cleanAINote, visualReasons: visualAIReasons)
            for assetID in cleanIDs {
                if let placement = try mutation.apply(
                    action, to: assetID, metadata: metadata,
                    activeProposal: activeProposals[assetID], aiRequest: aiRequest,
                    anchorAssetID: cleanAnchor
                ) {
                    pendingPlacements.append(placement)
                }
            }

            try recomputeFixtureEligibility(connection)
            let placementState = action == .requestAI ? "picked" : "hidden"
            let placementReason = action == .requestAI
                ? "native review AI request"
                : "native review hide"
            for placement in pendingPlacements {
                let afterEligibility = try connection.queryOne(
                    """
                    SELECT eligibility_state
                    FROM fixture_asset_decisions
                    WHERE fixture_id = ? AND asset_id = ?
                    """,
                    bindings: [.string(fixtureID), .string(placement.assetID)]
                )?["eligibility_state"]?.stringValue ?? "active"
                try connection.execute(
                    """
                    INSERT INTO fixture_asset_decision_events (
                      event_id, fixture_id, asset_id, before_state, after_state,
                      before_eligibility, after_eligibility, action, actor, reason, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    bindings: [
                        .string(eventID(prefix: "fde")), .string(fixtureID), .string(placement.assetID),
                        .string(placement.state), .string(placementState),
                        .string(placement.eligibility), .string(afterEligibility),
                        .string(placementState), .string(actor), .string(placementReason),
                        .string(timestamp),
                    ]
                )
            }

            let afterSnapshots = try cleanIDs.map {
                try snapshot(connection, assetID: $0)
            }
            var items: [JSONValue] = []
            for assetID in cleanIDs {
                let after = try reviewState(connection, fixtureID: fixtureID, assetID: assetID)
                try insertEditorialEvent(
                    connection,
                    assetID: assetID,
                    fixtureID: fixtureID,
                    action: action.rawValue,
                    before: beforeReview[assetID] ?? .object([:]),
                    after: after,
                    actor: actor,
                    timestamp: timestamp
                )
                items.append(.object([
                    "assetId": .string(assetID),
                    "before": beforeReview[assetID] ?? .object([:]),
                    "after": after,
                    "review": after,
                ]))
            }

            try connection.execute(
                """
                INSERT INTO fixture_review_operations (
                  operation_id, fixture_id, action, anchor_asset_id, propagated,
                  asset_ids_json, before_json, after_json, state, actor, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?)
                """,
                bindings: [
                    .string(operationID), .string(fixtureID), .string(action.rawValue),
                    .string(cleanAnchor), .number(shouldPropagate ? 1 : 0),
                    .string(try encodeReviewJSON(.array(cleanIDs.map { .string($0) }))),
                    .string(try encodeReviewJSON(.array(beforeSnapshots))),
                    .string(try encodeReviewJSON(.array(afterSnapshots))),
                    .string(actor), .string(timestamp),
                ]
            )

            return FixtureReviewResult(json: [
                "operationId": .string(operationID),
                "fixtureId": .string(fixtureID),
                "action": .string(action.rawValue),
                "anchorAssetId": .string(cleanAnchor),
                "propagated": .bool(shouldPropagate),
                "items": .array(items),
                "timing": timing(started: started),
            ])
        }
    }

    /// Restores the exact snapshots produced by `applyReview`, but only if no
    /// later mutation has changed any captured row.
    public func undoReview(
        operationID: String,
        actor: String = "owner",
        now: Date = Date()
    ) throws -> FixtureReviewUndoResult {
        let cleanOperationID = operationID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanOperationID.isEmpty else {
            throw OwnerReviewSQLiteError.invalid("Review operation ID is required")
        }
        let timestamp = ISO8601DateFormatter().string(from: now)
        let started = Date()
        let connection = try ReviewSQLiteConnection(
            databaseURL: databaseURL,
            busyTimeoutMilliseconds: busyTimeoutMilliseconds
        )

        return try connection.transaction {
            guard let operation = try connection.queryOne(
                "SELECT * FROM fixture_review_operations WHERE operation_id = ?",
                bindings: [.string(cleanOperationID)]
            ) else {
                throw OwnerReviewSQLiteError.invalid("review operation does not exist")
            }
            let fixtureID = operation["fixture_id"]?.stringValue ?? ""
            let action = operation["action"]?.stringValue ?? FixtureReviewAction.hide.rawValue
            let beforeSnapshots = try decodeSnapshotArray(operation["before_json"])
            let afterSnapshots = try decodeSnapshotArray(operation["after_json"])
            guard operation["state"]?.stringValue == "applied" else {
                return FixtureReviewUndoResult(json: [
                    "operationId": .string(cleanOperationID),
                    "fixtureId": .string(fixtureID),
                    "action": .string(action),
                    "alreadyUndone": .bool(true),
                    "items": .array([]),
                ])
            }
            guard beforeSnapshots.count == afterSnapshots.count else {
                throw OwnerReviewSQLiteError.invalid("review operation snapshot is invalid")
            }

            let currentSnapshots = try afterSnapshots.map { snapshotValue in
                let assetID = try snapshotAssetID(snapshotValue)
                return try snapshot(connection, assetID: assetID)
            }
            guard currentSnapshots == afterSnapshots else {
                throw OwnerReviewSQLiteError.conflict(
                    "review state changed after this operation; reload before undoing"
                )
            }

            var items: [JSONValue] = []
            for (beforeSnapshot, currentSnapshot) in zip(beforeSnapshots, currentSnapshots) {
                let assetID = try snapshotAssetID(beforeSnapshot)
                let currentEditorial = rowObject(
                    currentSnapshot,
                    key: "editorial"
                )
                try restoreSnapshot(connection, snapshot: beforeSnapshot)
                let restoredSnapshot = try snapshot(connection, assetID: assetID)
                let restoredEditorial = rowObject(restoredSnapshot, key: "editorial")
                try insertEditorialEvent(
                    connection,
                    assetID: assetID,
                    fixtureID: fixtureID,
                    action: "undo-\(action)",
                    before: currentSnapshot,
                    after: restoredSnapshot,
                    actor: actor,
                    timestamp: timestamp,
                    beforeState: currentEditorial["editorial_state"]?.stringValue ?? "",
                    afterState: restoredEditorial["editorial_state"]?.stringValue ?? ""
                )
                try insertPlacementUndoEvents(
                    connection,
                    assetID: assetID,
                    currentSnapshot: currentSnapshot,
                    restoredSnapshot: restoredSnapshot,
                    actor: actor,
                    operationID: cleanOperationID,
                    timestamp: timestamp,
                    action: action
                )
                items.append(.object([
                    "assetId": .string(assetID),
                    "before": currentSnapshot,
                    "after": restoredSnapshot,
                    "review": try reviewState(connection, fixtureID: fixtureID, assetID: assetID),
                ]))
            }

            try connection.execute(
                """
                UPDATE fixture_review_operations
                SET state = 'undone', undone_at = ?
                WHERE operation_id = ? AND state = 'applied'
                """,
                bindings: [.string(timestamp), .string(cleanOperationID)]
            )
            return FixtureReviewUndoResult(json: [
                "operationId": .string(cleanOperationID),
                "fixtureId": .string(fixtureID),
                "action": .string(action),
                "alreadyUndone": .bool(false),
                "items": .array(items),
                "timing": timing(started: started),
            ])
        }
    }
}

enum ReviewSQLiteBinding {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
}

final class ReviewSQLiteConnection {
    private let database: OpaquePointer

    init(databaseURL: URL, busyTimeoutMilliseconds: Int32) throws {
        var pointer: OpaquePointer?
        let result = sqlite3_open_v2(
            databaseURL.path,
            &pointer,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
            nil
        )
        guard result == SQLITE_OK, let pointer else {
            throw OwnerReviewSQLiteError.unavailable(String(cString: sqlite3_errstr(result)))
        }
        database = pointer
        sqlite3_busy_timeout(database, busyTimeoutMilliseconds)
        try execute("PRAGMA foreign_keys = ON")
    }

    deinit {
        sqlite3_close(database)
    }

    func transaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do {
            let result = try body()
            try execute("COMMIT")
            return result
        } catch {
            _ = try? execute("ROLLBACK")
            throw error
        }
    }

    func execute(_ sql: String, bindings: [ReviewSQLiteBinding] = []) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw OwnerReviewSQLiteError.unavailable(message())
        }
        defer { sqlite3_finalize(statement) }
        try bind(bindings, to: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw OwnerReviewSQLiteError.unavailable(message())
        }
    }

    func query(
        _ sql: String,
        bindings: [ReviewSQLiteBinding] = []
    ) throws -> [[String: JSONValue]] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw OwnerReviewSQLiteError.unavailable(message())
        }
        defer { sqlite3_finalize(statement) }
        try bind(bindings, to: statement)
        var rows: [[String: JSONValue]] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { return rows }
            guard result == SQLITE_ROW else {
                throw OwnerReviewSQLiteError.unavailable(message())
            }
            var row: [String: JSONValue] = [:]
            for index in 0..<sqlite3_column_count(statement) {
                guard let name = sqlite3_column_name(statement, index) else { continue }
                row[String(cString: name)] = try value(statement, index: index)
            }
            rows.append(row)
        }
    }

    func queryOne(
        _ sql: String,
        bindings: [ReviewSQLiteBinding] = []
    ) throws -> [String: JSONValue]? {
        try query(sql, bindings: bindings).first
    }

    func tableColumns(_ table: String) throws -> Set<String> {
        guard Self.allowedTables.contains(table) else {
            throw OwnerReviewSQLiteError.invalid("review snapshot table is invalid")
        }
        let rows = try query("PRAGMA table_info(\(table))")
        return Set(rows.compactMap { $0["name"]?.stringValue })
    }

    func upsert(_ table: String, row: [String: JSONValue], conflict: [String]) throws {
        let columns = try tableColumns(table)
        let usable = row.keys.filter { columns.contains($0) }.sorted()
        guard !usable.isEmpty, conflict.allSatisfy(usable.contains) else {
            throw OwnerReviewSQLiteError.invalid("review snapshot is invalid for \(table)")
        }
        let updates = usable.filter { !conflict.contains($0) }
        let conflictSQL = conflict.joined(separator: ", ")
        let updateSQL = updates.isEmpty
            ? "DO NOTHING"
            : "DO UPDATE SET " + updates.map { "\($0) = excluded.\($0)" }.joined(separator: ", ")
        let sql = """
            INSERT INTO \(table) (\(usable.joined(separator: ", ")))
            VALUES (\(usable.map { _ in "?" }.joined(separator: ", ")))
            ON CONFLICT(\(conflictSQL)) \(updateSQL)
            """
        try execute(sql, bindings: try usable.map { try binding(row[$0] ?? .null) })
    }

    private static let allowedTables: Set<String> = [
        "sidecar_decisions",
        "asset_editorial_state",
        "asset_delivery_state",
        "fixture_asset_decisions",
        "asset_ai_proposals",
        "country_assignments",
        "asset_source_versions",
        "external_edit_asset_locks",
    ]

    private func bind(_ values: [ReviewSQLiteBinding], to statement: OpaquePointer) throws {
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            let result: Int32
            switch value {
            case let .string(text):
                result = text.withCString {
                    sqlite3_bind_text(statement, index, $0, -1, sqliteTransient)
                }
            case let .number(number):
                result = sqlite3_bind_double(statement, index, number)
            case let .bool(boolean):
                result = sqlite3_bind_int(statement, index, boolean ? 1 : 0)
            case .null:
                result = sqlite3_bind_null(statement, index)
            }
            guard result == SQLITE_OK else {
                throw OwnerReviewSQLiteError.unavailable(message())
            }
        }
    }

    private func value(_ statement: OpaquePointer, index: Int32) throws -> JSONValue {
        switch sqlite3_column_type(statement, index) {
        case SQLITE_INTEGER:
            return .number(Double(sqlite3_column_int64(statement, index)))
        case SQLITE_FLOAT:
            return .number(sqlite3_column_double(statement, index))
        case SQLITE_TEXT:
            guard let text = sqlite3_column_text(statement, index) else { return .null }
            return .string(String(cString: text))
        case SQLITE_NULL:
            return .null
        default:
            throw OwnerReviewSQLiteError.unavailable("SQLite BLOB values are not supported in Review snapshots")
        }
    }

    private func message() -> String {
        String(cString: sqlite3_errmsg(database))
    }
}

private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

private func binding(_ value: JSONValue) throws -> ReviewSQLiteBinding {
    switch value {
    case let .string(value): .string(value)
    case let .number(value): .number(value)
    case let .bool(value): .bool(value)
    case .null: .null
    case .object, .array: .string(try encodeReviewJSON(value))
    }
}

private func unique(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.compactMap { value in
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, seen.insert(clean).inserted else { return nil }
        return clean
    }
}

private func eventID(prefix: String) -> String {
    "\(prefix)-\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16))"
}

func encodeReviewJSON(_ value: JSONValue) throws -> String {
    let data = try JSONEncoder().encode(value)
    guard let string = String(data: data, encoding: .utf8) else {
        throw OwnerReviewSQLiteError.invalid("could not encode Review JSON")
    }
    return string
}

private func decodeJSON(_ value: JSONValue?) throws -> JSONValue {
    guard let text = value?.stringValue,
          let data = text.data(using: .utf8) else {
        throw OwnerReviewSQLiteError.invalid("Review JSON is missing")
    }
    return try JSONDecoder().decode(JSONValue.self, from: data)
}

private func decodeSnapshotArray(_ value: JSONValue?) throws -> [JSONValue] {
    guard case let .array(items) = try decodeJSON(value) else {
        throw OwnerReviewSQLiteError.invalid("review operation snapshot is invalid")
    }
    return items
}

private func snapshotAssetID(_ snapshot: JSONValue) throws -> String {
    guard let assetID = snapshot.objectValue?["assetId"]?.stringValue,
          !assetID.isEmpty else {
        throw OwnerReviewSQLiteError.invalid("review snapshot asset is missing")
    }
    return assetID
}

private func rowObject(_ snapshot: JSONValue, key: String) -> [String: JSONValue] {
    snapshot.objectValue?[key]?.objectValue ?? [:]
}

private struct CountryWriteCapability {
    var enabled: Bool
    var reason: String
    var migrationID: String
}

private let supportedReviewCountries: Set<String> = [
    "france", "italy", "mexico", "portugal", "slovakia", "spain", "usa",
]

private let reviewCountryLocationAliases: [String: String] = [
    "fr": "france", "france": "france",
    "it": "italy", "italia": "italy", "italy": "italy",
    "mexico": "mexico", "mx": "mexico",
    "portugal": "portugal", "pt": "portugal",
    "eslovaquia": "slovakia", "sk": "slovakia", "slovakia": "slovakia",
    "es": "spain", "espana": "spain", "spain": "spain",
    "estados unidos": "usa", "us": "usa", "usa": "usa",
    "united states": "usa", "united states of america": "usa",
]

private func countryWriteCapability(
    _ connection: ReviewSQLiteConnection
) throws -> CountryWriteCapability {
    let columns = try connection.tableColumns("country_assignments")
    guard columns.isSuperset(of: [
        "assignment_id", "asset_id", "media_id", "country_slug",
        "identity_status", "migration_id",
    ]) else {
        return .init(
            enabled: false,
            reason: "Country writes await the reviewed PBE-154 identity migration.",
            migrationID: ""
        )
    }
    let requiredTables = [
        "country_assignment_identity_migrations",
        "country_assignment_identity_migration_rows",
    ]
    for table in requiredTables {
        guard try connection.queryOne(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            bindings: [.string(table)]
        ) != nil else {
            return .init(
                enabled: false,
                reason: "Country writes await a complete PBE-154 migration receipt.",
                migrationID: ""
            )
        }
    }
    guard let receipt = try connection.queryOne(
        """
        SELECT migration_id, source_count, mapped_count, unmapped_count
        FROM country_assignment_identity_migrations
        ORDER BY applied_at DESC, migration_id DESC
        LIMIT 1
        """
    ) else {
        return .init(
            enabled: false,
            reason: "Country writes await a reviewed PBE-154 apply receipt.",
            migrationID: ""
        )
    }
    let migrationID = receipt["migration_id"]?.stringValue ?? ""
    let source = receipt["source_count"]?.intValue ?? 0
    let mapped = receipt["mapped_count"]?.intValue ?? 0
    let unmapped = receipt["unmapped_count"]?.intValue ?? 0
    let migrated = try connection.queryOne(
        """
        SELECT count(*) AS total,
               sum(CASE WHEN identity_status = 'mapped' THEN 1 ELSE 0 END) AS mapped,
               sum(CASE WHEN identity_status = 'unmapped' THEN 1 ELSE 0 END) AS unmapped
        FROM country_assignments
        WHERE migration_id = ?
        """,
        bindings: [.string(migrationID)]
    ) ?? [:]
    let audit = try connection.queryOne(
        """
        SELECT count(*) AS total
        FROM country_assignment_identity_migration_rows
        WHERE migration_id = ?
        """,
        bindings: [.string(migrationID)]
    )?["total"]?.intValue ?? 0
    let migratedTotal = migrated["total"]?.intValue ?? 0
    let migratedMapped = migrated["mapped"]?.intValue ?? 0
    let migratedUnmapped = migrated["unmapped"]?.intValue ?? 0
    guard source == mapped + unmapped,
          migratedTotal == source,
          migratedMapped == mapped,
          migratedUnmapped == unmapped,
          audit == source else {
        return .init(
            enabled: false,
            reason: "Country writes are locked because the PBE-154 receipt does not match its audit rows.",
            migrationID: migrationID
        )
    }
    return .init(enabled: true, reason: "", migrationID: migrationID)
}

private func countryContext(
    _ connection: ReviewSQLiteConnection,
    assetID: String
) throws -> (country: String, suggested: String, source: String) {
    let columns = try connection.tableColumns("country_assignments")
    let country = columns.contains("asset_id")
        ? try connection.queryOne(
            """
            SELECT country_slug FROM country_assignments
            WHERE asset_id = ? AND identity_status = 'mapped'
            LIMIT 1
            """,
            bindings: [.string(assetID)]
        )?["country_slug"]?.stringValue ?? ""
        : ""
    let resolutionTable = try connection.queryOne(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'catalog_collection_resolutions'"
    ) != nil
    let candidate = resolutionTable
        ? try connection.queryOne(
            """
            SELECT collection_slug FROM catalog_collection_resolutions
            WHERE asset_id = ? AND collection_slug != 'unknown'
            ORDER BY resolved_at DESC, source_version_hash DESC
            LIMIT 1
            """,
            bindings: [.string(assetID)]
        )?["collection_slug"]?.stringValue ?? ""
        : ""
    var suggested = supportedReviewCountries.contains(candidate) ? candidate : ""
    let locationRow = try connection.queryOne(
        """
        SELECT location_label, location_keywords_json, raw_json
        FROM sidecar_assets
        WHERE asset_id = ?
        LIMIT 1
        """,
        bindings: [.string(assetID)]
    )
    let location = locationCountryEvidence(locationRow)
    if !country.isEmpty {
        return (country, "", "accepted assignment")
    }
    if !suggested.isEmpty, !location.country.isEmpty, suggested != location.country {
        return (country, "", "conflicting catalog and Apple Photos location")
    }
    if !suggested.isEmpty, !location.country.isEmpty {
        return (country, suggested, "catalog resolver + Apple Photos location")
    }
    if !suggested.isEmpty {
        return (country, suggested, "catalog resolver")
    }
    suggested = location.country
    return (country, suggested, location.source)
}

private func normalizedCountryEvidence(_ value: String) -> String {
    value
        .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        .lowercased()
        .components(separatedBy: CharacterSet.alphanumerics.inverted)
        .filter { !$0.isEmpty }
        .joined(separator: " ")
}

private func locationCountryEvidence(
    _ row: [String: JSONValue]?
) -> (country: String, source: String) {
    guard let row else { return ("", "") }
    var values = [row["location_label"]?.stringValue ?? ""]
    if let encoded = row["location_keywords_json"]?.stringValue,
       let data = encoded.data(using: .utf8),
       let keywords = try? JSONSerialization.jsonObject(with: data) as? [String] {
        values.append(contentsOf: keywords)
    }
    if let encoded = row["raw_json"]?.stringValue,
       let data = encoded.data(using: .utf8),
       let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        values.append(raw["locationCountry"] as? String ?? "")
        values.append(raw["country"] as? String ?? "")
        if let location = raw["location"] as? [String: Any] {
            values.append(location["country"] as? String ?? "")
            values.append(location["countryCode"] as? String ?? "")
        }
    }
    let matches = Set(values.compactMap {
        reviewCountryLocationAliases[normalizedCountryEvidence($0)]
    })
    if matches.count == 1, let country = matches.first {
        return (country, "Apple Photos location")
    }
    if matches.count > 1 {
        return ("", "conflicting Apple Photos location")
    }
    return ("", "")
}

func setReviewCountry(
    _ connection: ReviewSQLiteConnection,
    assetID: String,
    country: String,
    actor: String,
    timestamp: String
) throws {
    let capability = try countryWriteCapability(connection)
    guard capability.enabled else {
        throw OwnerReviewSQLiteError.conflict(capability.reason)
    }
    let clean = country.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard clean.isEmpty || supportedReviewCountries.contains(clean) else {
        throw OwnerReviewSQLiteError.invalid("Country must be Unknown or a supported gallery country.")
    }
    try connection.execute(
        "DELETE FROM country_assignments WHERE asset_id = ?",
        bindings: [.string(assetID)]
    )
    guard !clean.isEmpty else { return }
    try connection.execute(
        """
        INSERT INTO country_assignments (
          assignment_id, asset_id, media_id, country_slug, source_slug, batch_id,
          assigned_at, updated_at, identity_status, identity_source,
          identity_evidence_json, migration_id, migrated_at
        ) VALUES (?, ?, NULL, ?, '', '', ?, ?, 'mapped', ?, '[]', ?, ?)
        """,
        bindings: [
            .string("asset:\(assetID)"), .string(assetID), .string(clean),
            .string(timestamp), .string(timestamp), .string("native-review:\(actor)"),
            .string("native-review:\(capability.migrationID)"), .string(timestamp),
        ]
    )
}

private func snapshot(
    _ connection: ReviewSQLiteConnection,
    assetID: String
) throws -> JSONValue {
    let decision = try connection.queryOne(
        "SELECT * FROM sidecar_decisions WHERE asset_id = ?",
        bindings: [.string(assetID)]
    )
    let editorial = try connection.queryOne(
        "SELECT * FROM asset_editorial_state WHERE asset_id = ?",
        bindings: [.string(assetID)]
    )
    let delivery = try connection.queryOne(
        "SELECT * FROM asset_delivery_state WHERE asset_id = ?",
        bindings: [.string(assetID)]
    )
    let fixtureDecisions = try connection.query(
        "SELECT * FROM fixture_asset_decisions WHERE asset_id = ? ORDER BY fixture_id",
        bindings: [.string(assetID)]
    )
    let proposals = try connection.query(
        "SELECT * FROM asset_ai_proposals WHERE asset_id = ? ORDER BY proposal_id",
        bindings: [.string(assetID)]
    )
    let countryAssignment = try connection.tableColumns("country_assignments").contains("asset_id")
        ? connection.queryOne(
            "SELECT * FROM country_assignments WHERE asset_id = ?",
            bindings: [.string(assetID)]
        )
        : nil
    return .object([
        "assetId": .string(assetID),
        "decision": decision.map(JSONValue.object) ?? .null,
        "editorial": editorial.map(JSONValue.object) ?? .null,
        "delivery": delivery.map(JSONValue.object) ?? .null,
        "fixtureDecisions": .array(fixtureDecisions.map(JSONValue.object)),
        "proposals": .array(proposals.map(JSONValue.object)),
        "countryAssignment": countryAssignment.map(JSONValue.object) ?? .null,
    ])
}

func reviewJSONArray(_ value: JSONValue?) -> JSONValue {
    guard let text = value?.stringValue,
          let data = text.data(using: .utf8),
          let decoded = try? JSONDecoder().decode(JSONValue.self, from: data),
          case .array = decoded else {
        return .array([])
    }
    return decoded
}

private func effectiveMetadata(
    _ connection: ReviewSQLiteConnection,
    assetID: String,
    decision: [String: JSONValue]
) throws -> (title: String, keywords: JSONValue) {
    let asset = try connection.queryOne(
        "SELECT photos_title, photos_keywords_json FROM sidecar_assets WHERE asset_id = ?",
        bindings: [.string(assetID)]
    )
    let title = decision["title"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let fallbackTitle = asset?["photos_title"]?.stringValue ?? ""
    let keywords = reviewJSONArray(decision["keywords_json"])
    let fallbackKeywords = reviewJSONArray(asset?["photos_keywords_json"])
    let hasKeywords = keywords.arrayValue?.isEmpty == false
    return (title.isEmpty ? fallbackTitle : title, hasKeywords ? keywords : fallbackKeywords)
}

private func propagatedAssetIDs(
    _ connection: ReviewSQLiteConnection,
    fixtureID: String,
    anchorAssetID: String,
    includeAnchor: Bool
) throws -> [String] {
    guard let anchor = try connection.queryOne(
        "SELECT captured_at FROM sidecar_assets WHERE asset_id = ?",
        bindings: [.string(anchorAssetID)]
    ), let capturedAt = anchor["captured_at"]?.stringValue,
    !capturedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return includeAnchor ? [anchorAssetID] : []
    }
    let comparator = includeAnchor ? ">=" : ">"
    let rows = try connection.query(
        """
        SELECT asset.asset_id
        FROM sidecar_assets AS asset
        JOIN fixture_asset_decisions AS current_decision
          ON current_decision.asset_id = asset.asset_id
         AND current_decision.fixture_id = ?
         AND current_decision.placement_state = 'picked'
         AND current_decision.eligibility_state = 'active'
        JOIN asset_editorial_state AS editorial
          ON editorial.asset_id = asset.asset_id
        WHERE (asset.missing_at IS NULL OR asset.missing_at = '')
          AND editorial.editorial_state != 'approved'
          AND NOT EXISTS (
            SELECT 1
            FROM sidecar_tombstones AS tombstone
            WHERE tombstone.asset_id = asset.asset_id
              AND tombstone.tombstone_state = 'active'
          )
          AND datetime(asset.captured_at) \(comparator) datetime(?)
          AND datetime(asset.captured_at) <= datetime(?, '+2 hours')
        ORDER BY datetime(asset.captured_at), asset.asset_id
        """,
        bindings: [
            .string(fixtureID), .string(capturedAt), .string(capturedAt),
        ]
    )
    return rows.compactMap { $0["asset_id"]?.stringValue }
}

private func reviewState(
    _ connection: ReviewSQLiteConnection,
    fixtureID: String,
    assetID: String
) throws -> JSONValue {
    let decision = try connection.queryOne(
        "SELECT * FROM sidecar_decisions WHERE asset_id = ?",
        bindings: [.string(assetID)]
    ) ?? [:]
    let editorial = try connection.queryOne(
        "SELECT * FROM asset_editorial_state WHERE asset_id = ?",
        bindings: [.string(assetID)]
    ) ?? [:]
    let fixtureDecision = try connection.queryOne(
        """
        SELECT * FROM fixture_asset_decisions
        WHERE fixture_id = ? AND asset_id = ?
        """,
        bindings: [.string(fixtureID), .string(assetID)]
    ) ?? [:]
    let delivery = try connection.queryOne(
        "SELECT * FROM asset_delivery_state WHERE asset_id = ?",
        bindings: [.string(assetID)]
    ) ?? [:]
    let proposals = try connection.query(
        """
        SELECT * FROM asset_ai_proposals
        WHERE asset_id = ? AND status IN ('ready', 'loaded')
        ORDER BY attempt DESC, created_at DESC, proposal_id DESC
        """,
        bindings: [.string(assetID)]
    )
    let metadata = try effectiveMetadata(connection, assetID: assetID, decision: decision)
    let proposal = proposals.first
    let proposalStatus = proposal?["status"]?.stringValue ?? ""
    let proposalVision = proposal?["vision"]?.boolValue
        ?? ((proposal?["vision"]?.intValue ?? 0) == 1)
    let country = try countryContext(connection, assetID: assetID).country
    return .object([
        "title": .string(metadata.title),
        "caption": decision["caption"] ?? .string(""),
        "keywords": metadata.keywords,
        "rating": decision["rating"] ?? .number(0),
        "color": decision["color"] ?? .string(""),
        "placementState": fixtureDecision["placement_state"] ?? .string("undecided"),
        "editorialState": editorial["editorial_state"] ?? .string("unreviewed"),
        "visualAIRequest": .object(reviewWindowObject(editorial["visual_ai_request_json"])),
        "aiReasons": reviewJSONArray(editorial["ai_reasons_json"]),
        "aiNote": editorial["ai_note"] ?? .string(""),
        "aiAttemptCount": editorial["ai_attempt_count"] ?? .number(0),
        "aiLastError": editorial["ai_last_error"] ?? .string(""),
        "proposalReady": .bool(proposalStatus == "ready" || proposalStatus == "loaded"),
        "proposalContextAvailable": .bool(proposal != nil),
        "proposalId": proposal?["proposal_id"] ?? .string(""),
        "proposedTitle": proposal?["proposed_title"] ?? .string(""),
        "proposedKeywords": reviewJSONArray(proposal?["proposed_keywords_json"]),
        "proposedCountry": proposal?["proposed_country"] ?? .string(""),
        "countryProposalSource": proposal?["country_source"] ?? .string(""),
        "proposalReason": proposal?["reason"] ?? .string(""),
        "proposalStatus": .string(proposalStatus),
        "requestedGeneratorModel": proposal?["requested_generator_model"] ?? .string(""),
        "resolvedModel": proposal?["resolved_model"] ?? proposal?["generator_model"] ?? .string(""),
        "reasoningEffort": proposal?["reasoning_effort"] ?? .string(""),
        "vision": .bool(proposalVision),
        "modelLadder": reviewJSONArray(proposal?["model_ladder"]),
        "deliveryState": delivery["delivery_state"] ?? .string("not-ready"),
        "country": .string(country),
    ])
}

private func normalizedReviewFilters(_ values: [String]?) -> [String] {
    guard let values else { return [] }
    var seen = Set<String>()
    return values.compactMap { value in
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !clean.isEmpty, seen.insert(clean).inserted else { return nil }
        return clean
    }
}

private func reviewWindowItem(_ row: [String: JSONValue]) -> FixtureReviewItem {
    let assetID = row["asset_id"]?.stringValue ?? ""
    let decisionTitle = row["decision_title"]?.stringValue ?? ""
    let photosTitle = row["photos_title"]?.stringValue ?? ""
    let decisionKeywords = reviewJSONArray(row["decision_keywords_json"])
    let photosKeywords = reviewJSONArray(row["photos_keywords_json"])
    let keywordValue = decisionKeywords.arrayValue?.isEmpty == false
        ? decisionKeywords
        : photosKeywords
    let keywords = keywordValue.arrayValue?.compactMap(\.stringValue) ?? []
    let proposalStatus = row["proposal_status"]?.stringValue ?? ""
    let proposalID = row["proposal_id"]?.stringValue ?? ""
    let proposalVision = row["proposal_vision"]?.boolValue
        ?? ((row["proposal_vision"]?.intValue ?? 0) == 1)
    let raw = reviewWindowObject(row["raw_json"])
    let aiReasons = reviewJSONArray(row["ai_reasons_json"]).arrayValue?.compactMap(\.stringValue) ?? []
    let proposedKeywords = reviewJSONArray(row["proposal_keywords_json"]).arrayValue?.compactMap(\.stringValue) ?? []
    let modelLadder = reviewJSONArray(row["proposal_model_ladder"]).arrayValue?.compactMap(\.stringValue) ?? []
    let locationKeywords = reviewJSONArray(row["location_keywords_json"]).arrayValue?.compactMap(\.stringValue) ?? []
    let photoLibraryIdentifier = reviewWindowPhotoLibraryIdentifier(
        sourceAnchor: row["source_anchor"]?.stringValue ?? "",
        raw: raw,
        assetID: assetID
    )
    let title = decisionTitle.isEmpty ? photosTitle : decisionTitle
    let caption = row["decision_caption"]?.stringValue ?? ""
    let filename = row["filename"]?.stringValue ?? ""
    let mediaType = row["media_type"]?.stringValue ?? "photo"
    let capturedAt = row["captured_at"]?.stringValue ?? ""
    let pixelWidth = row["pixel_width"]?.intValue ?? 0
    let pixelHeight = row["pixel_height"]?.intValue ?? 0
    let originalByteCount = Int64(row["original_byte_count"]?.intValue ?? 0)
    let rating = row["rating"]?.intValue ?? 0
    let color = row["color"]?.stringValue ?? ""
    let placementState = row["placement_state"]?.stringValue ?? "picked"
    let editorialState = row["editorial_state"]?.stringValue ?? "unreviewed"
    let aiNote = row["ai_note"]?.stringValue ?? ""
    let aiAttemptCount = row["ai_attempt_count"]?.intValue ?? 0
    let aiLastError = row["ai_last_error"]?.stringValue ?? ""
    let proposalReason = row["proposal_reason"]?.stringValue ?? ""
    let requestedGeneratorModel = row["proposal_requested_generator_model"]?.stringValue ?? ""
    let resolvedModel = row["proposal_resolved_model"]?.stringValue ?? ""
    let reasoningEffort = row["proposal_reasoning_effort"]?.stringValue ?? ""
    let deliveryState = row["delivery_state"]?.stringValue ?? "not-ready"
    let locationLabel = row["location_label"]?.stringValue ?? ""
    return FixtureReviewItem(
        id: assetID,
        photoLibraryIdentifier: photoLibraryIdentifier,
        sourceVersionID: row["source_version_id"]?.stringValue ?? "",
        title: title,
        caption: caption,
        keywords: keywords,
        filename: filename,
        mediaType: mediaType,
        capturedAt: capturedAt,
        pixelWidth: pixelWidth,
        pixelHeight: pixelHeight,
        originalByteCount: originalByteCount,
        rating: rating,
        color: color,
        placementState: placementState,
        editorialState: editorialState,
        visualAIRequest: reviewWindowObject(row["visual_ai_request_json"]),
        aiReasons: aiReasons,
        aiNote: aiNote,
        aiAttemptCount: aiAttemptCount,
        aiLastError: aiLastError,
        proposalReady: proposalStatus == "ready" || proposalStatus == "loaded",
        proposalContextAvailable: !proposalID.isEmpty,
        proposalID: proposalID,
        proposedTitle: row["proposal_title"]?.stringValue ?? "",
        proposedKeywords: proposedKeywords,
        proposedCountry: row["proposal_country"]?.stringValue ?? "",
        countryProposalSource: row["proposal_country_source"]?.stringValue ?? "",
        proposalReason: proposalReason,
        proposalStatus: proposalStatus,
        requestedGeneratorModel: requestedGeneratorModel,
        resolvedModel: resolvedModel,
        reasoningEffort: reasoningEffort,
        vision: proposalVision,
        modelLadder: modelLadder,
        deliveryState: deliveryState,
        locationLabel: locationLabel,
        locationKeywords: locationKeywords
    )
}

private func reviewWindowSearchMatches(
    _ row: [String: JSONValue],
    search: String
) -> Bool {
    let terms = search
        .split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == ";" })
        .prefix(8)
        .map { foldReviewSearch(String($0)) }
        .filter { !$0.isEmpty }
    guard !terms.isEmpty else { return true }
    let searchable = [
        row["asset_id"]?.stringValue ?? "",
        row["filename"]?.stringValue ?? "",
        row["photos_title"]?.stringValue ?? "",
        row["photos_keywords_json"]?.stringValue ?? "",
        row["location_label"]?.stringValue ?? "",
        row["location_keywords_json"]?.stringValue ?? "",
        row["decision_title"]?.stringValue ?? "",
        row["decision_keywords_json"]?.stringValue ?? "",
    ].map(foldReviewSearch).joined(separator: " ")
    return terms.allSatisfy(searchable.contains)
}

private func foldReviewSearch(_ value: String) -> String {
    value.folding(
        options: [.diacriticInsensitive, .caseInsensitive],
        locale: Locale(identifier: "en_US_POSIX")
    ).lowercased()
}

private func reviewWindowObject(_ value: JSONValue?) -> [String: JSONValue] {
    guard let value,
          let encoded = value.stringValue?.data(using: .utf8),
          let decoded = try? JSONDecoder().decode(JSONValue.self, from: encoded) else {
        return [:]
    }
    return decoded.objectValue ?? [:]
}

private func reviewWindowPhotoLibraryIdentifier(
    sourceAnchor: String,
    raw: [String: JSONValue],
    assetID: String
) -> String {
    if sourceAnchor.hasPrefix("apple-photos-cloud://") {
        let cloudID = String(sourceAnchor.dropFirst("apple-photos-cloud://".count))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !cloudID.isEmpty { return cloudID }
    }
    for key in ["cloudIdentifier", "phCloudIdentifier", "cloudIdentifierString"] {
        if let cloudID = raw[key]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
           !cloudID.isEmpty {
            return cloudID
        }
    }
    if let localID = raw["localIdentifier"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
       !localID.isEmpty {
        return localID
    }
    if sourceAnchor.hasPrefix("apple-photos://") {
        return String(sourceAnchor.dropFirst("apple-photos://".count))
    }
    return sourceAnchor.isEmpty ? assetID : sourceAnchor
}

private func recomputeFixtureEligibility(_ connection: ReviewSQLiteConnection) throws {
    try connection.execute(
        """
        UPDATE fixture_asset_decisions
        SET eligibility_state = CASE
          WHEN (SELECT parent_fixture_id FROM fixtures WHERE fixture_id = fixture_asset_decisions.fixture_id) IS NULL
            THEN 'active'
          ELSE 'dormant'
        END
        """
    )
    while true {
        let before = try connection.queryOne("SELECT total_changes()")?["total_changes()"]?.intValue ?? 0
        try connection.execute(
            """
            UPDATE fixture_asset_decisions AS child
            SET eligibility_state = 'active'
            WHERE child.eligibility_state = 'dormant'
              AND EXISTS (
                SELECT 1
                FROM fixtures AS fixture
                JOIN fixture_asset_decisions AS parent
                  ON parent.fixture_id = fixture.parent_fixture_id
                 AND parent.asset_id = child.asset_id
                WHERE fixture.fixture_id = child.fixture_id
                  AND parent.placement_state = 'picked'
                  AND parent.eligibility_state = 'active'
              )
            """
        )
        let after = try connection.queryOne("SELECT total_changes()")?["total_changes()"]?.intValue ?? before
        if after == before { break }
    }
}

private func insertEditorialEvent(
    _ connection: ReviewSQLiteConnection,
    assetID: String,
    fixtureID: String,
    action: String,
    before: JSONValue,
    after: JSONValue,
    actor: String,
    timestamp: String,
    beforeState: String? = nil,
    afterState: String? = nil
) throws {
    let resolvedBefore = beforeState ?? before.objectValue?["editorialState"]?.stringValue ?? ""
    let resolvedAfter = afterState ?? after.objectValue?["editorialState"]?.stringValue ?? ""
    try connection.execute(
        """
        INSERT INTO asset_editorial_events (
          event_id, asset_id, fixture_id, action, before_state, after_state,
          before_json, after_json, actor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        bindings: [
            .string(eventID(prefix: "aee")), .string(assetID), .string(fixtureID),
            .string(action), .string(resolvedBefore), .string(resolvedAfter),
            .string(try encodeReviewJSON(before)), .string(try encodeReviewJSON(after)),
            .string(actor), .string(timestamp),
        ]
    )
}

private func restoreSnapshot(
    _ connection: ReviewSQLiteConnection,
    snapshot: JSONValue
) throws {
    let assetID = try snapshotAssetID(snapshot)
    let object = snapshot.objectValue ?? [:]
    guard let decision = object["decision"]?.objectValue,
          let editorial = object["editorial"]?.objectValue else {
        throw OwnerReviewSQLiteError.invalid("review snapshot is incomplete: \(assetID)")
    }
    try connection.upsert("sidecar_decisions", row: decision, conflict: ["asset_id"])
    try connection.upsert("asset_editorial_state", row: editorial, conflict: ["asset_id"])
    if let delivery = object["delivery"]?.objectValue {
        try connection.upsert("asset_delivery_state", row: delivery, conflict: ["asset_id"])
    } else {
        try connection.execute(
            "DELETE FROM asset_delivery_state WHERE asset_id = ?",
            bindings: [.string(assetID)]
        )
    }
    try connection.execute(
        "DELETE FROM fixture_asset_decisions WHERE asset_id = ?",
        bindings: [.string(assetID)]
    )
    for value in object["fixtureDecisions"]?.arrayValue ?? [] {
        guard let row = value.objectValue else {
            throw OwnerReviewSQLiteError.invalid("review fixture snapshot is invalid: \(assetID)")
        }
        try connection.upsert(
            "fixture_asset_decisions",
            row: row,
            conflict: ["fixture_id", "asset_id"]
        )
    }
    try connection.execute(
        "DELETE FROM asset_ai_proposals WHERE asset_id = ?",
        bindings: [.string(assetID)]
    )
    for value in object["proposals"]?.arrayValue ?? [] {
        guard let row = value.objectValue else {
            throw OwnerReviewSQLiteError.invalid("review proposal snapshot is invalid: \(assetID)")
        }
        try connection.upsert("asset_ai_proposals", row: row, conflict: ["proposal_id"])
    }
    if try connection.tableColumns("country_assignments").contains("asset_id") {
        try connection.execute(
            "DELETE FROM country_assignments WHERE asset_id = ?",
            bindings: [.string(assetID)]
        )
        if let countryAssignment = object["countryAssignment"]?.objectValue {
            try connection.upsert(
                "country_assignments",
                row: countryAssignment,
                conflict: ["assignment_id"]
            )
        }
    }
}

private func fixtureDecisionMap(_ snapshot: JSONValue) -> [String: [String: JSONValue]] {
    Dictionary(
        uniqueKeysWithValues: (snapshot.objectValue?["fixtureDecisions"]?.arrayValue ?? [])
            .compactMap { value in
                guard let row = value.objectValue,
                      let fixtureID = row["fixture_id"]?.stringValue else { return nil }
                return (fixtureID, row)
            }
    )
}

private func insertPlacementUndoEvents(
    _ connection: ReviewSQLiteConnection,
    assetID: String,
    currentSnapshot: JSONValue,
    restoredSnapshot: JSONValue,
    actor: String,
    operationID: String,
    timestamp: String,
    action: String
) throws {
    let current = fixtureDecisionMap(currentSnapshot)
    let restored = fixtureDecisionMap(restoredSnapshot)
    for fixtureID in Set(current.keys).union(restored.keys).sorted() {
        let currentRow = current[fixtureID] ?? [:]
        let restoredRow = restored[fixtureID] ?? [:]
        guard currentRow != restoredRow else { continue }
        try connection.execute(
            """
            INSERT INTO fixture_asset_decision_events (
              event_id, fixture_id, asset_id, before_state, after_state,
              before_eligibility, after_eligibility, action, actor, reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            bindings: [
                .string(eventID(prefix: "fde")), .string(fixtureID), .string(assetID),
                .string(currentRow["placement_state"]?.stringValue ?? "undecided"),
                .string(restoredRow["placement_state"]?.stringValue ?? "undecided"),
                .string(currentRow["eligibility_state"]?.stringValue ?? "active"),
                .string(restoredRow["eligibility_state"]?.stringValue ?? "active"),
                .string("undo-\(action)"), .string(actor),
                .string("undo Review operation \(operationID)"), .string(timestamp),
            ]
        )
    }
}

private func timing(started: Date) -> JSONValue {
    .object(["localTransaction": .object([
        "durationMs": .number(max(0, Date().timeIntervalSince(started) * 1_000)),
    ])])
}

private func reviewStatusPredicate(_ state: String) -> String? {
    switch state {
    case "picked":
        return "(current_decision.placement_state = 'picked' AND editorial.editorial_state != 'approved')"
    case "approved":
        return "(current_decision.placement_state = 'picked' AND editorial.editorial_state = 'approved')"
    case "uploaded":
        return "delivery.delivery_state = 'live'"
    case "hidden":
        return "current_decision.placement_state = 'hidden'"
    default:
        return nil
    }
}
