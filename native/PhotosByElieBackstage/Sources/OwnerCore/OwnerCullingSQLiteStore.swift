import Foundation
import SQLite3

/// Native parity for the fixture-local Culling placement writer.
///
/// This store is wired through LocalFixtureReviewService only when the
/// app-level resolver identifies Owner-private SQLite. Callers without that
/// database continue through the existing audited connector path. The
/// transaction owns placement changes, inherited eligibility recomputation,
/// and the durable placement event.
public enum OwnerCullingSQLiteError: Error, Equatable, LocalizedError {
    case unavailable(String)
    case invalid(String)
    case conflict(String)

    public var errorDescription: String? {
        switch self {
        case let .unavailable(message), let .invalid(message), let .conflict(message):
            message
        }
    }
}

public struct OwnerCullingSQLiteStore: Sendable {
    public let databaseURL: URL
    public let busyTimeoutMilliseconds: Int32

    public init(
        databaseURL: URL,
        busyTimeoutMilliseconds: Int32 = 2_000
    ) {
        self.databaseURL = databaseURL
        self.busyTimeoutMilliseconds = busyTimeoutMilliseconds
    }

    /// Reads the effective fixture Culling universe from SQLite without
    /// materializing a connector action or an ID-list transport payload.
    /// Filters are applied before the bounded page is returned, while the
    /// summary still reflects the complete filtered universe.
    public func cullingWindow(
        fixtureID: String,
        view: FixtureCullingView = .undecided,
        views: [FixtureCullingView] = [],
        offset: Int = 0,
        limit: Int = 200,
        search: String = "",
        mediaTypes: [String] = [],
        ratings: [Int] = [],
        colors: [String] = [],
        editorialFilters: [GalleryEditorialFilter] = [],
        deliveryFilters: [GalleryDeliveryFilter] = [],
        sourceFilters: [GallerySourceFilter] = [.available],
        burstsOnly: Bool = false
    ) throws -> FixtureCullingWindow {
        let cleanFixtureID = fixtureID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanFixtureID.isEmpty else {
            throw OwnerCullingSQLiteError.invalid("fixture ID is required")
        }
        let safeOffset = max(0, offset)
        let safeLimit = min(500, max(1, limit))
        let selectableViews = Set(FixtureCullingView.selectableCases.map(\.rawValue))
        let selectedViews = Set(views.map(\.rawValue)).intersection(selectableViews)
        let effectiveViews: Set<String>
        if selectedViews.isEmpty {
            effectiveViews = view == .allActive
                ? selectableViews
                : Set([view.rawValue])
        } else {
            effectiveViews = selectedViews
        }
        let selectedMedia = Set(mediaTypes.compactMap(cullingMediaType))
        let selectedRatings = Set(ratings.filter { (0...5).contains($0) })
        let selectedColors = Set(colors.map(cullingColorValue)).intersection(
            ["", "red", "yellow", "green", "blue", "purple"]
        )
        let selectedEditorial = Set(editorialFilters)
        let selectedDelivery = Set(deliveryFilters)
        let selectedSources = Set(sourceFilters)
        let needsUnavailableIdentityFallback = selectedSources.isEmpty
            || selectedSources.contains(.unavailable)

        let connection = try CullingSQLiteConnection(
            databaseURL: databaseURL,
            busyTimeoutMilliseconds: busyTimeoutMilliseconds,
            readOnly: true
        )
        guard let fixture = try connection.queryOne(
            "SELECT fixture_id, parent_fixture_id, candidate_mode FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL",
            bindings: [.string(cleanFixtureID)]
        ) else {
            throw OwnerCullingSQLiteError.invalid("fixture does not exist or is archived")
        }

        let parentFixtureID = fixture["parent_fixture_id"]?.stringValue
        var fromSQL = "sidecar_assets AS asset\n"
        var bindings: [CullingSQLiteBinding] = []
        if let parentFixtureID, !parentFixtureID.isEmpty {
            fromSQL += """
                JOIN fixture_asset_decisions AS parent_decision
                  ON parent_decision.asset_id = asset.asset_id
                 AND parent_decision.fixture_id = ?
                 AND parent_decision.placement_state = 'picked'
                 AND parent_decision.eligibility_state = 'active'
                """
            bindings.append(.string(parentFixtureID))
        }
        fromSQL += """
            LEFT JOIN fixture_asset_decisions AS current_decision
              ON current_decision.asset_id = asset.asset_id
             AND current_decision.fixture_id = ?
            LEFT JOIN sidecar_decisions AS global_decision
              ON global_decision.asset_id = asset.asset_id
            LEFT JOIN asset_editorial_state AS editorial
              ON editorial.asset_id = asset.asset_id
            LEFT JOIN asset_delivery_state AS delivery
              ON delivery.asset_id = asset.asset_id
            LEFT JOIN asset_source_versions AS latest_source
              ON latest_source.version_id = (
                SELECT source_version.version_id
                FROM asset_source_versions AS source_version
                WHERE source_version.asset_id = asset.asset_id
                ORDER BY source_version.created_at DESC, source_version.version_id DESC
                LIMIT 1
              )
            """
        if needsUnavailableIdentityFallback {
            fromSQL += """
                LEFT JOIN exact_identity_cloud_fallbacks AS exact_identity
                  ON COALESCE(asset.missing_at, '') <> ''
                 AND exact_identity.local_identifier = json_extract(asset.raw_json, '$.localIdentifier')
                """
        }
        bindings.append(.string(cleanFixtureID))

        let exactIdentityCTE = needsUnavailableIdentityFallback
            ? """
              WITH exact_identity_cloud_fallbacks AS (
                SELECT local_identifier, MAX(cloud_identifier) AS cloud_identifier
                FROM (
                  SELECT json_extract(raw_json, '$.localIdentifier') AS local_identifier,
                         CASE
                           WHEN source_anchor LIKE 'apple-photos-cloud://%'
                             THEN substr(source_anchor, length('apple-photos-cloud://') + 1)
                           ELSE COALESCE(
                             json_extract(raw_json, '$.cloudIdentifier'),
                             json_extract(raw_json, '$.phCloudIdentifier'),
                             json_extract(raw_json, '$.cloudIdentifierString'),
                             ''
                           )
                         END AS cloud_identifier
                  FROM sidecar_assets
                  WHERE COALESCE(missing_at, '') = ''
                )
                WHERE trim(COALESCE(local_identifier, '')) <> ''
                  AND trim(COALESCE(cloud_identifier, '')) <> ''
                GROUP BY local_identifier
                HAVING COUNT(DISTINCT cloud_identifier) = 1
              )
              """
            : ""
        let exactIdentitySelection = needsUnavailableIdentityFallback
            ? "COALESCE(exact_identity.cloud_identifier, '')"
            : "''"
        let rows = try connection.query(
            """
            \(exactIdentityCTE)
            SELECT asset.asset_id,
                   COALESCE(asset.source_anchor, '') AS source_anchor,
                   COALESCE(asset.raw_json, '{}') AS raw_json,
                   COALESCE(asset.filename, '') AS filename,
                   COALESCE(asset.media_type, 'photo') AS media_type,
                   COALESCE(asset.captured_at, '') AS captured_at,
                   COALESCE(asset.photos_title, '') AS photos_title,
                   COALESCE(asset.photos_keywords_json, '[]') AS photos_keywords_json,
                   COALESCE(asset.location_label, '') AS location_label,
                   COALESCE(asset.location_keywords_json, '[]') AS location_keywords_json,
                   COALESCE(asset.pixel_width, 0) AS pixel_width,
                   COALESCE(asset.pixel_height, 0) AS pixel_height,
                   COALESCE(global_decision.title, '') AS decision_title,
                   COALESCE(global_decision.keywords_json, '[]') AS decision_keywords_json,
                   COALESCE(current_decision.placement_state, 'undecided') AS placement_state,
                   COALESCE(current_decision.eligibility_state, 'active') AS eligibility_state,
                   COALESCE(global_decision.rating, 0) AS rating,
                   COALESCE(global_decision.color, '') AS color,
                   COALESCE(editorial.editorial_state, global_decision.metadata_state, 'unreviewed') AS editorial_state,
                   CASE WHEN EXISTS (
                     SELECT 1
                     FROM asset_ai_proposals AS proposal
                     WHERE proposal.asset_id = asset.asset_id
                       AND proposal.status IN ('ready', 'loaded')
                   ) THEN 1 ELSE 0 END AS proposal_available,
                   COALESCE(delivery.delivery_state, 'not-ready') AS delivery_state,
                   CASE
                     WHEN COALESCE(asset.missing_at, '') <> '' THEN 0
                     WHEN COALESCE(latest_source.source_exists, 1) = 0 THEN 0
                     WHEN COALESCE(latest_source.state, '') = 'source-missing' THEN 0
                     ELSE 1
                   END AS source_available,
                   \(exactIdentitySelection) AS exact_identity_cloud_fallback,
                   COALESCE((
                     SELECT CAST(COALESCE(
                       json_extract(upload.value, '$.bytes'),
                       json_extract(upload.value, '$.existing.bytes')
                     ) AS INTEGER)
                     FROM sidecar_upload_bridge_run_items AS run_item,
                          json_each(COALESCE(run_item.upload_keys_json, '[]')) AS upload
                     WHERE run_item.asset_id = asset.asset_id
                       AND json_extract(upload.value, '$.kind') = 'private-master'
                       AND CAST(COALESCE(
                         json_extract(upload.value, '$.bytes'),
                         json_extract(upload.value, '$.existing.bytes'),
                         0
                       ) AS INTEGER) > 0
                     ORDER BY run_item.updated_at DESC
                     LIMIT 1
                   ), CAST(COALESCE(
                     json_extract(asset.raw_json, '$.originalByteCount'),
                     json_extract(asset.raw_json, '$.original_byte_count'),
                     0
                   ) AS INTEGER)) AS original_byte_count
            FROM \(fromSQL)
            WHERE NOT EXISTS (
                SELECT 1
                FROM sidecar_tombstones AS tombstone
                WHERE tombstone.asset_id = asset.asset_id
                  AND tombstone.tombstone_state = 'active'
              )
              AND COALESCE(global_decision.pick_state, '') <> 'hidden'
            ORDER BY asset.captured_at DESC, asset.asset_id
            """,
            bindings: bindings
        )

        let searchTerms = cullingSearchTerms(search)
        let searchableEquipment: [String: OwnerAssetSourceMetadata]
        let exactAssetIDSearch = searchTerms.count == 1 && rows.contains {
            cullingFold($0["asset_id"]?.stringValue ?? "") == searchTerms[0]
        }
        if searchTerms.isEmpty || exactAssetIDSearch {
            searchableEquipment = [:]
        } else {
            searchableEquipment = (try? OwnerAssetSourceSQLiteStore(databaseURL: databaseURL)
                .metadata(assetIDs: rows.compactMap { $0["asset_id"]?.stringValue })) ?? [:]
        }
        let burstAssetIDs = burstsOnly
            ? Set(cullingBurstRows(rows).compactMap { $0["asset_id"]?.stringValue })
            : []
        let filteredRows = rows.filter { row in
            if burstsOnly,
               !burstAssetIDs.contains(row["asset_id"]?.stringValue ?? "") {
                return false
            }
            let media = cullingMediaType(row["media_type"]?.stringValue ?? "photo") ?? "photo"
            guard selectedMedia.isEmpty || selectedMedia.count == 2 || selectedMedia.contains(media) else {
                return false
            }
            let rating = row["rating"]?.intValue ?? 0
            guard selectedRatings.isEmpty || selectedRatings.count == 6 || selectedRatings.contains(rating) else {
                return false
            }
            let color = row["color"]?.stringValue ?? ""
            guard selectedColors.isEmpty || selectedColors.count == 6 || selectedColors.contains(color) else {
                return false
            }
            guard cullingEditorialMatches(row, filters: selectedEditorial) else {
                return false
            }
            let delivery = GalleryDeliveryFilter(
                rawValue: row["delivery_state"]?.stringValue ?? "not-ready"
            )
            guard selectedDelivery.isEmpty || delivery.map(selectedDelivery.contains) == true else {
                return false
            }
            let source = ((row["source_available"]?.intValue ?? 1) != 0)
                ? GallerySourceFilter.available
                : GallerySourceFilter.unavailable
            guard selectedSources.isEmpty || selectedSources.contains(source) else {
                return false
            }
            return cullingSearchMatches(
                row,
                equipment: row["asset_id"]?.stringValue.flatMap { searchableEquipment[$0] },
                terms: searchTerms
            )
        }
        let viewRows = filteredRows.filter {
            effectiveViews.contains($0["placement_state"]?.stringValue ?? "undecided")
        }
        let pageStart = min(safeOffset, viewRows.count)
        let pageEnd = min(viewRows.count, pageStart + safeLimit)
        let page = Array(viewRows[pageStart..<pageEnd])
        let summary = FixtureCullingSummary(json: [
            "filtered": .number(Double(viewRows.count)),
            "universe": .number(Double(filteredRows.count)),
            "undecided": .number(Double(filteredRows.filter {
                ($0["placement_state"]?.stringValue ?? "undecided") == "undecided"
            }.count)),
            "picked": .number(Double(filteredRows.filter {
                ($0["placement_state"]?.stringValue ?? "") == "picked"
            }.count)),
            "hidden": .number(Double(filteredRows.filter {
                ($0["placement_state"]?.stringValue ?? "") == "hidden"
            }.count)),
        ])
        let outputView = effectiveViews.count == 1
            ? (FixtureCullingView(rawValue: effectiveViews.first ?? "") ?? .allActive).rawValue
            : FixtureCullingView.allActive.rawValue
        return FixtureCullingWindow(json: [
            "fixtureId": .string(cleanFixtureID),
            "candidateMode": fixture["candidate_mode"] ?? .string("inherited"),
            "view": .string(outputView),
            "offset": .number(Double(safeOffset)),
            "limit": .number(Double(safeLimit)),
            "nextOffset": .number(Double(safeOffset + page.count)),
            "hasNext": .bool(safeOffset + page.count < viewRows.count),
            "summary": .object(summaryJSON(summary)),
            "items": .array(page.map(cullingAssetJSON)),
        ])
    }

    /// Applies a fixture-local placement state in one bounded SQLite
    /// transaction. Global Sidecar rating, color, and tombstone state are not
    /// touched by this slice.
    public func applyState(
        _ state: FixturePlacementState,
        fixtureID: String,
        assetIDs: [String],
        actor: String = "owner",
        reason: String = "",
        now: Date = Date()
    ) throws -> [FixtureAssetState] {
        let cleanFixtureID = fixtureID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanFixtureID.isEmpty else {
            throw OwnerCullingSQLiteError.invalid("fixture ID is required")
        }
        let cleanIDs = unique(assetIDs)
        let timestamp = ISO8601DateFormatter().string(from: now)
        let connection = try CullingSQLiteConnection(
            databaseURL: databaseURL,
            busyTimeoutMilliseconds: busyTimeoutMilliseconds
        )

        return try connection.transaction {
            try requireActiveFixture(connection, fixtureID: cleanFixtureID)
            var before: [String: (placement: String, eligibility: String)] = [:]
            for assetID in cleanIDs {
                guard try connection.queryOne(
                    "SELECT asset_id FROM sidecar_assets WHERE asset_id = ?",
                    bindings: [.string(assetID)]
                ) != nil else {
                    throw OwnerCullingSQLiteError.invalid("asset is not indexed: \(assetID)")
                }
                let existing = try connection.queryOne(
                    """
                    SELECT placement_state, eligibility_state
                    FROM fixture_asset_decisions
                    WHERE fixture_id = ? AND asset_id = ?
                    """,
                    bindings: [.string(cleanFixtureID), .string(assetID)]
                )
                before[assetID] = (
                    existing?["placement_state"]?.stringValue ?? FixturePlacementState.undecided.rawValue,
                    existing?["eligibility_state"]?.stringValue ?? "active"
                )
                try setPlacement(
                    connection,
                    fixtureID: cleanFixtureID,
                    assetID: assetID,
                    state: state,
                    timestamp: timestamp
                )
            }

            try recomputeEligibility(connection)
            return try recordResults(
                connection,
                fixtureID: cleanFixtureID,
                assetIDs: cleanIDs,
                before: before,
                actor: actor,
                reason: reason,
                timestamp: timestamp
            )
        }
    }

    /// Restores the placement states returned by `applyState`, but refuses to
    /// overwrite a later Culling mutation. This mirrors the explicit Undo
    /// contract without involving the connector or a JSON side channel.
    public func undoState(
        _ applied: [FixtureAssetState],
        actor: String = "owner",
        reason: String = "Undo Culling",
        now: Date = Date()
    ) throws -> [FixtureAssetState] {
        guard !applied.isEmpty else { return [] }
        let timestamp = ISO8601DateFormatter().string(from: now)
        let connection = try CullingSQLiteConnection(
            databaseURL: databaseURL,
            busyTimeoutMilliseconds: busyTimeoutMilliseconds
        )

        return try connection.transaction {
            var before: [String: (placement: String, eligibility: String)] = [:]
            for item in applied {
                let fixtureID = item.fixtureID.trimmingCharacters(in: .whitespacesAndNewlines)
                let assetID = item.assetID.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !fixtureID.isEmpty, !assetID.isEmpty else {
                    throw OwnerCullingSQLiteError.invalid("Culling Undo item is incomplete")
                }
                try requireActiveFixture(connection, fixtureID: fixtureID)
                guard let current = try connection.queryOne(
                    """
                    SELECT placement_state, eligibility_state, updated_at
                    FROM fixture_asset_decisions
                    WHERE fixture_id = ? AND asset_id = ?
                    """,
                    bindings: [.string(fixtureID), .string(assetID)]
                ) else {
                    throw OwnerCullingSQLiteError.conflict(
                        "Culling state changed after this operation; reload before undoing"
                    )
                }
                let currentPlacement = current["placement_state"]?.stringValue ?? "undecided"
                let currentEligibility = current["eligibility_state"]?.stringValue ?? "active"
                let expectedTimestamp = item.updatedAt
                guard currentPlacement == item.placementState.rawValue,
                      currentEligibility == item.eligibilityState,
                      expectedTimestamp.isEmpty || current["updated_at"]?.stringValue == expectedTimestamp else {
                    throw OwnerCullingSQLiteError.conflict(
                        "Culling state changed after this operation; reload before undoing"
                    )
                }
                before["\(fixtureID):\(assetID)"] = (currentPlacement, currentEligibility)
                try setPlacement(
                    connection,
                    fixtureID: fixtureID,
                    assetID: assetID,
                    state: item.beforePlacementState,
                    timestamp: timestamp
                )
            }

            try recomputeEligibility(connection)
            return try applied.map { item in
                let key = "\(item.fixtureID):\(item.assetID)"
                let prior = before[key] ?? (item.placementState.rawValue, item.eligibilityState)
                let row = try connection.queryOne(
                    """
                    SELECT placement_state, eligibility_state, source, updated_at
                    FROM fixture_asset_decisions
                    WHERE fixture_id = ? AND asset_id = ?
                    """,
                    bindings: [.string(item.fixtureID), .string(item.assetID)]
                )
                let restoredState = FixturePlacementState(
                    rawValue: row?["placement_state"]?.stringValue ?? "undecided"
                ) ?? .undecided
                let restoredEligibility = row?["eligibility_state"]?.stringValue ?? "active"
                try connection.execute(
                    """
                    INSERT INTO fixture_asset_decision_events (
                      event_id, fixture_id, asset_id, before_state, after_state,
                      before_eligibility, after_eligibility, action, actor, reason, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    bindings: [
                        .string(eventID()), .string(item.fixtureID), .string(item.assetID),
                        .string(prior.placement), .string(restoredState.rawValue),
                        .string(prior.eligibility), .string(restoredEligibility),
                        .string(restoredState.rawValue), .string(actor),
                        .string(reason), .string(timestamp),
                    ]
                )
                return FixtureAssetState(json: [
                    "fixture_id": .string(item.fixtureID),
                    "asset_id": .string(item.assetID),
                    "placement_state": .string(restoredState.rawValue),
                    "eligibility_state": .string(restoredEligibility),
                    "source": row?["source"] ?? .string("native"),
                    "updated_at": row?["updated_at"] ?? .string(timestamp),
                    "before_placement_state": .string(prior.placement),
                    "before_eligibility_state": .string(prior.eligibility),
                ])
            }
        }
    }

    private func requireActiveFixture(
        _ connection: CullingSQLiteConnection,
        fixtureID: String
    ) throws {
        guard try connection.queryOne(
            "SELECT fixture_id FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL",
            bindings: [.string(fixtureID)]
        ) != nil else {
            throw OwnerCullingSQLiteError.invalid("fixture does not exist or is archived")
        }
    }

    private func setPlacement(
        _ connection: CullingSQLiteConnection,
        fixtureID: String,
        assetID: String,
        state: FixturePlacementState,
        timestamp: String
    ) throws {
        try connection.execute(
            """
            INSERT INTO fixture_asset_decisions (
              fixture_id, asset_id, placement_state, eligibility_state,
              source, last_action, created_at, updated_at
            ) VALUES (?, ?, ?, 'dormant', 'native', ?, ?, ?)
            ON CONFLICT(fixture_id, asset_id) DO UPDATE SET
              placement_state = excluded.placement_state,
              source = 'native',
              last_action = excluded.last_action,
              updated_at = excluded.updated_at
            """,
            bindings: [
                .string(fixtureID), .string(assetID), .string(state.rawValue),
                .string(state.rawValue), .string(timestamp), .string(timestamp),
            ]
        )
    }

    private func recomputeEligibility(_ connection: CullingSQLiteConnection) throws {
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

    private func recordResults(
        _ connection: CullingSQLiteConnection,
        fixtureID: String,
        assetIDs: [String],
        before: [String: (placement: String, eligibility: String)],
        actor: String,
        reason: String,
        timestamp: String
    ) throws -> [FixtureAssetState] {
        try assetIDs.sorted().map { assetID in
            guard let row = try connection.queryOne(
                """
                SELECT placement_state, eligibility_state, source, updated_at
                FROM fixture_asset_decisions
                WHERE fixture_id = ? AND asset_id = ?
                """,
                bindings: [.string(fixtureID), .string(assetID)]
            ) else {
                throw OwnerCullingSQLiteError.unavailable("fixture state disappeared during transaction")
            }
            let afterPlacement = row["placement_state"]?.stringValue ?? "undecided"
            let afterEligibility = row["eligibility_state"]?.stringValue ?? "active"
            let prior = before[assetID] ?? ("undecided", "active")
            try connection.execute(
                """
                INSERT INTO fixture_asset_decision_events (
                  event_id, fixture_id, asset_id, before_state, after_state,
                  before_eligibility, after_eligibility, action, actor, reason, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                bindings: [
                    .string(eventID()), .string(fixtureID), .string(assetID),
                    .string(prior.placement), .string(afterPlacement),
                    .string(prior.eligibility), .string(afterEligibility),
                    .string(afterPlacement), .string(actor), .string(reason),
                    .string(timestamp),
                ]
            )
            return FixtureAssetState(json: [
                "fixture_id": .string(fixtureID),
                "asset_id": .string(assetID),
                "placement_state": .string(afterPlacement),
                "eligibility_state": .string(afterEligibility),
                "source": row["source"] ?? .string("native"),
                "updated_at": row["updated_at"] ?? .string(timestamp),
                "before_placement_state": .string(prior.placement),
                "before_eligibility_state": .string(prior.eligibility),
            ])
        }
    }
}

private func cullingBurstRows(
    _ rows: [[String: JSONValue]],
    maximumGap: TimeInterval = 2
) -> [[String: JSONValue]] {
    var included = Set<String>()
    var group: [[String: JSONValue]] = []

    func flush() {
        if group.count > 1 {
            included.formUnion(group.compactMap { $0["asset_id"]?.stringValue })
        }
        group.removeAll(keepingCapacity: true)
    }

    for row in rows {
        guard let value = row["captured_at"]?.stringValue,
              let capturedAt = CullingWorkspace.captureDate(value) else {
            flush()
            continue
        }
        if let previousValue = group.last?["captured_at"]?.stringValue,
           let previous = CullingWorkspace.captureDate(previousValue),
           abs(capturedAt.timeIntervalSince(previous)) > maximumGap {
            flush()
        }
        group.append(row)
    }
    flush()
    return rows.filter { included.contains($0["asset_id"]?.stringValue ?? "") }
}

private func cullingEditorialMatches(
    _ row: [String: JSONValue],
    filters: Set<GalleryEditorialFilter>
) -> Bool {
    guard !filters.isEmpty else { return true }
    let state = row["editorial_state"]?.stringValue ?? "unreviewed"
    let proposalAvailable = (row["proposal_available"]?.intValue ?? 0) != 0
    return filters.contains { filter in
        switch filter {
        case .needsReview: state == "unreviewed"
        case .aiRequested: state == "requesting-ai"
        case .proposalAvailable: proposalAvailable || state == "proposed"
        case .approved: state == "approved"
        }
    }
}

private func cullingMediaType(_ value: String) -> String? {
    switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "photo", "photos": return "photo"
    case "video", "videos": return "video"
    default: return nil
    }
}

private func cullingColorValue(_ value: String) -> String {
    let clean = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return clean == "none" ? "" : clean
}

private func cullingSearchTerms(_ search: String) -> [String] {
    search
        .components(separatedBy: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ",;")))
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .prefix(8)
        .map(cullingFold)
}

private func cullingSearchMatches(
    _ row: [String: JSONValue],
    equipment: OwnerAssetSourceMetadata?,
    terms: [String]
) -> Bool {
    guard !terms.isEmpty else { return true }
    let exactAssetID = cullingFold(row["asset_id"]?.stringValue ?? "")
    if terms.count == 1, terms[0] == exactAssetID {
        return true
    }
    let searchable = [
        row["filename"]?.stringValue ?? "",
        row["photos_title"]?.stringValue ?? "",
        row["photos_keywords_json"]?.stringValue ?? "",
        row["location_label"]?.stringValue ?? "",
        row["location_keywords_json"]?.stringValue ?? "",
        row["decision_title"]?.stringValue ?? "",
        row["decision_keywords_json"]?.stringValue ?? "",
    ].map(cullingFold).joined(separator: "\n")
    let searchableEquipment = [
        equipment?.cameraBody ?? "",
        equipment?.lens ?? "",
        equipment?.focalLength ?? "",
    ].map(cullingFold).joined(separator: "\n")
    return terms.allSatisfy { term in
        searchable.contains(term)
            || searchableEquipment.contains(term)
            || (term == "elf" && searchableEquipment.contains("elph"))
    }
}

private func cullingFold(_ value: String) -> String {
    value.folding(
        options: [.caseInsensitive, .diacriticInsensitive],
        locale: .current
    )
}

private func cullingJSONObject(_ value: String) -> [String: JSONValue] {
    guard let data = value.data(using: .utf8),
          let object = try? JSONDecoder.ownerAPI.decode([String: JSONValue].self, from: data) else {
        return [:]
    }
    return object
}

private func cullingStringArray(_ value: String) -> [String] {
    guard let data = value.data(using: .utf8),
          let array = try? JSONDecoder.ownerAPI.decode([String].self, from: data) else {
        return []
    }
    return array
}

private func summaryJSON(_ summary: FixtureCullingSummary) -> [String: JSONValue] {
    [
        "filtered": .number(Double(summary.filtered)),
        "universe": .number(Double(summary.universe)),
        "undecided": .number(Double(summary.undecided)),
        "picked": .number(Double(summary.picked)),
        "hidden": .number(Double(summary.hidden)),
    ]
}

private func cullingAssetJSON(_ row: [String: JSONValue]) -> JSONValue {
    let raw = cullingJSONObject(row["raw_json"]?.stringValue ?? "{}")
    let sourceAnchor = row["source_anchor"]?.stringValue ?? ""
    let sourceAvailable = (row["source_available"]?.intValue ?? 1) != 0
    let cloudIdentifier = sourceAnchor.hasPrefix("apple-photos-cloud://")
        ? String(sourceAnchor.dropFirst("apple-photos-cloud://".count))
        : ""
    let exactIdentityCloudFallback = row["exact_identity_cloud_fallback"]?.stringValue ?? ""
    let photoLibraryIdentifier = cloudIdentifier.isEmpty
        ? raw["cloudIdentifier"]?.stringValue
            ?? raw["phCloudIdentifier"]?.stringValue
            ?? raw["cloudIdentifierString"]?.stringValue
            ?? (!sourceAvailable && !exactIdentityCloudFallback.isEmpty
                ? exactIdentityCloudFallback
                : nil)
            ?? raw["localIdentifier"]?.stringValue
            ?? sourceAnchor.replacingOccurrences(of: "apple-photos://", with: "")
        : cloudIdentifier
    let photosTitle = row["photos_title"]?.stringValue ?? ""
    let decisionTitle = row["decision_title"]?.stringValue ?? ""
    let editorialState = row["editorial_state"]?.stringValue ?? "unreviewed"
    let keywordsJSON = editorialState == "unreviewed"
        ? row["photos_keywords_json"]?.stringValue ?? "[]"
        : row["decision_keywords_json"]?.stringValue ?? "[]"
    let keywords = cullingStringArray(keywordsJSON)
    let rawResourceFormat = raw["resourceFormat"]?.stringValue
        ?? raw["preferredResourceFormat"]?.stringValue
        ?? ""
    return .object([
        "assetId": row["asset_id"] ?? .string(""),
        "photoLibraryIdentifier": .string(photoLibraryIdentifier),
        "title": .string(photosTitle.isEmpty ? decisionTitle : photosTitle),
        "filename": row["filename"] ?? .string(""),
        "mediaType": row["media_type"] ?? .string("photo"),
        "capturedAt": row["captured_at"] ?? .string(""),
        "pixelWidth": row["pixel_width"] ?? .number(0),
        "pixelHeight": row["pixel_height"] ?? .number(0),
        "resourceFormat": .string(rawResourceFormat),
        "originalByteCount": row["original_byte_count"] ?? raw["originalByteCount"] ?? .number(0),
        "placementState": row["placement_state"] ?? .string("undecided"),
        "eligibilityState": row["eligibility_state"] ?? .string("active"),
        "rating": row["rating"] ?? .number(0),
        "color": row["color"] ?? .string(""),
        "editorialState": .string(editorialState),
        "proposalAvailable": .bool((row["proposal_available"]?.intValue ?? 0) != 0),
        "deliveryState": row["delivery_state"] ?? .string("not-ready"),
        "sourceAvailable": .bool(sourceAvailable),
        "keywords": .array(keywords.map(JSONValue.string)),
        "locationLabel": row["location_label"] ?? .string(""),
        "locationKeywords": .array(
            cullingStringArray(row["location_keywords_json"]?.stringValue ?? "[]")
                .map(JSONValue.string)
        ),
    ])
}

private enum CullingSQLiteBinding {
    case string(String)
}

private final class CullingSQLiteConnection {
    private let database: OpaquePointer

    init(
        databaseURL: URL,
        busyTimeoutMilliseconds: Int32,
        readOnly: Bool = false
    ) throws {
        var pointer: OpaquePointer?
        let result = sqlite3_open_v2(
            databaseURL.path,
            &pointer,
            readOnly ? SQLITE_OPEN_READONLY : SQLITE_OPEN_READWRITE,
            nil
        )
        guard result == SQLITE_OK, let pointer else {
            if let pointer { sqlite3_close(pointer) }
            throw OwnerCullingSQLiteError.unavailable(String(cString: sqlite3_errstr(result)))
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

    func execute(_ sql: String, bindings: [CullingSQLiteBinding] = []) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw OwnerCullingSQLiteError.unavailable(message())
        }
        defer { sqlite3_finalize(statement) }
        try bind(bindings, to: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw OwnerCullingSQLiteError.unavailable(message())
        }
    }

    func query(
        _ sql: String,
        bindings: [CullingSQLiteBinding] = []
    ) throws -> [[String: JSONValue]] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw OwnerCullingSQLiteError.unavailable(message())
        }
        defer { sqlite3_finalize(statement) }
        try bind(bindings, to: statement)
        var rows: [[String: JSONValue]] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { return rows }
            guard result == SQLITE_ROW else {
                throw OwnerCullingSQLiteError.unavailable(message())
            }
            var row: [String: JSONValue] = [:]
            for index in 0..<sqlite3_column_count(statement) {
                guard let name = sqlite3_column_name(statement, index) else { continue }
                row[String(cString: name)] = value(statement, index: index)
            }
            rows.append(row)
        }
    }

    func queryOne(
        _ sql: String,
        bindings: [CullingSQLiteBinding] = []
    ) throws -> [String: JSONValue]? {
        try query(sql, bindings: bindings).first
    }

    private func bind(_ values: [CullingSQLiteBinding], to statement: OpaquePointer) throws {
        for (offset, value) in values.enumerated() {
            let result: Int32
            switch value {
            case let .string(text):
                result = text.withCString {
                    sqlite3_bind_text(statement, Int32(offset + 1), $0, -1, sqliteTransient)
                }
            }
            guard result == SQLITE_OK else {
                throw OwnerCullingSQLiteError.unavailable(message())
            }
        }
    }

    private func value(_ statement: OpaquePointer, index: Int32) -> JSONValue {
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
            return .null
        }
    }

    private func message() -> String {
        String(cString: sqlite3_errmsg(database))
    }
}

private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

private func unique(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.compactMap { value in
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, seen.insert(clean).inserted else { return nil }
        return clean
    }
}

private func eventID() -> String {
    "fde-\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16))"
}
