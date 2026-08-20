import Foundation
import SQLite3

/// The first native parity slice for the latency-sensitive Review path.
///
/// This store is deliberately not wired into Backstage yet. It mirrors the
/// existing Python Hide/Undo transaction against a copied Owner.sqlite so the
/// migration can be verified before the live service changes process
/// boundaries. The database remains the source of truth; no JSON IPC or
/// connector process is involved here.
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

    /// Applies the copied-fixture Review parity actions that are safe to prove
    /// before the live writer changes. Other Review actions remain on the
    /// existing connector until their individual parity slices land.
    public func applyReview(
        _ action: FixtureReviewAction,
        fixtureID: String,
        assetIDs: [String],
        anchorAssetID: String = "",
        title: String? = nil,
        keywords: [String]? = nil,
        proposalID: String? = nil,
        actor: String = "owner",
        now: Date = Date()
    ) throws -> FixtureReviewResult {
        guard action == .hide || action == .approve else {
            throw OwnerReviewSQLiteError.unsupportedAction(action.rawValue)
        }
        let cleanIDs = unique(assetIDs)
        let cleanAnchor = anchorAssetID.trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty ? (cleanIDs.last ?? "") : anchorAssetID
        guard !cleanIDs.isEmpty, !cleanAnchor.isEmpty else {
            throw OwnerReviewSQLiteError.invalid("at least one Review asset is required")
        }

        let timestamp = ISO8601DateFormatter().string(from: now)
        let operationID = "reviewop-\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(20))"
        let started = Date()
        let connection = try ReviewSQLiteConnection(
            databaseURL: databaseURL,
            busyTimeoutMilliseconds: busyTimeoutMilliseconds
        )

        return try connection.transaction {
            guard try connection.queryOne(
                "SELECT fixture_id FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL",
                bindings: [.string(fixtureID)]
            ) != nil else {
                throw OwnerReviewSQLiteError.invalid("fixture does not exist or is archived")
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
                        SELECT proposal_id, proposed_title, proposed_keywords_json
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
            var pendingPlacements: [(assetID: String, state: String, eligibility: String)] = []

            for assetID in cleanIDs {
                if action == .hide {
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
                    pendingPlacements.append((assetID, beforePlacement, beforeEligibility))

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
                } else {
                    let decision = try connection.queryOne(
                        "SELECT title, keywords_json FROM sidecar_decisions WHERE asset_id = ?",
                        bindings: [.string(assetID)]
                    ) ?? [:]
                    let activeProposal = activeProposals[assetID]
                    let approvedTitle: String
                    if assetID == cleanAnchor, let explicitTitle {
                        approvedTitle = explicitTitle
                    } else if let activeProposal {
                        approvedTitle = activeProposal["proposed_title"]?.stringValue ?? ""
                    } else {
                        approvedTitle = decision["title"]?.stringValue ?? ""
                    }
                    let approvedKeywords: JSONValue
                    if assetID == cleanAnchor, let explicitKeywords {
                        approvedKeywords = .array(explicitKeywords)
                    } else if let activeProposal {
                        approvedKeywords = jsonArray(activeProposal["proposed_keywords_json"])
                    } else {
                        approvedKeywords = jsonArray(decision["keywords_json"])
                    }
                    try connection.execute(
                        """
                        UPDATE sidecar_decisions
                        SET metadata_state = 'approved', title = ?, keywords_json = ?,
                            last_action = 'approve', updated_at = ?
                        WHERE asset_id = ?
                        """,
                        bindings: [
                            .string(approvedTitle), .string(try encodeJSON(approvedKeywords)),
                            .string(timestamp), .string(assetID),
                        ]
                    )
                    if let activeProposalID = activeProposal?["proposal_id"]?.stringValue {
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
                    try connection.execute(
                        """
                        UPDATE asset_editorial_state
                        SET editorial_state = 'approved', ai_reasons_json = '[]', ai_note = '',
                            requested_at = NULL, approved_at = ?, updated_at = ?
                        WHERE asset_id = ?
                        """,
                        bindings: [.string(timestamp), .string(timestamp), .string(assetID)]
                    )
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

            try recomputeFixtureEligibility(connection)
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
                    ) VALUES (?, ?, ?, ?, 'hidden', ?, ?, 'hidden', ?, 'native review hide', ?)
                    """,
                    bindings: [
                        .string(eventID(prefix: "fde")), .string(fixtureID), .string(placement.assetID),
                        .string(placement.state), .string(placement.eligibility),
                        .string(afterEligibility), .string(actor), .string(timestamp),
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
                ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'applied', ?, ?)
                """,
                bindings: [
                    .string(operationID), .string(fixtureID), .string(action.rawValue),
                    .string(cleanAnchor), .string(try encodeJSON(.array(cleanIDs.map { .string($0) }))),
                    .string(try encodeJSON(.array(beforeSnapshots))),
                    .string(try encodeJSON(.array(afterSnapshots))),
                    .string(actor), .string(timestamp),
                ]
            )

            return FixtureReviewResult(json: [
                "operationId": .string(operationID),
                "fixtureId": .string(fixtureID),
                "action": .string(action.rawValue),
                "anchorAssetId": .string(cleanAnchor),
                "propagated": .bool(false),
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

private enum ReviewSQLiteBinding {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
}

private final class ReviewSQLiteConnection {
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
    case .object, .array: .string(try encodeJSON(value))
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

private func encodeJSON(_ value: JSONValue) throws -> String {
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
    return .object([
        "assetId": .string(assetID),
        "decision": decision.map(JSONValue.object) ?? .null,
        "editorial": editorial.map(JSONValue.object) ?? .null,
        "delivery": delivery.map(JSONValue.object) ?? .null,
        "fixtureDecisions": .array(fixtureDecisions.map(JSONValue.object)),
        "proposals": .array(proposals.map(JSONValue.object)),
    ])
}

private func jsonArray(_ value: JSONValue?) -> JSONValue {
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
    let keywords = jsonArray(decision["keywords_json"])
    let fallbackKeywords = jsonArray(asset?["photos_keywords_json"])
    let hasKeywords = keywords.arrayValue?.isEmpty == false
    return (title.isEmpty ? fallbackTitle : title, hasKeywords ? keywords : fallbackKeywords)
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
    return .object([
        "title": .string(metadata.title),
        "caption": decision["caption"] ?? .string(""),
        "keywords": metadata.keywords,
        "rating": decision["rating"] ?? .number(0),
        "color": decision["color"] ?? .string(""),
        "placementState": fixtureDecision["placement_state"] ?? .string("undecided"),
        "editorialState": editorial["editorial_state"] ?? .string("unreviewed"),
        "aiReasons": jsonArray(editorial["ai_reasons_json"]),
        "aiNote": editorial["ai_note"] ?? .string(""),
        "aiAttemptCount": editorial["ai_attempt_count"] ?? .number(0),
        "aiLastError": editorial["ai_last_error"] ?? .string(""),
        "proposalReady": .bool(proposalStatus == "ready" || proposalStatus == "loaded"),
        "proposalContextAvailable": .bool(proposal != nil),
        "proposalId": proposal?["proposal_id"] ?? .string(""),
        "proposedTitle": proposal?["proposed_title"] ?? .string(""),
        "proposedKeywords": jsonArray(proposal?["proposed_keywords_json"]),
        "proposalReason": proposal?["reason"] ?? .string(""),
        "proposalStatus": .string(proposalStatus),
        "requestedGeneratorModel": proposal?["requested_generator_model"] ?? .string(""),
        "resolvedModel": proposal?["resolved_model"] ?? proposal?["generator_model"] ?? .string(""),
        "reasoningEffort": proposal?["reasoning_effort"] ?? .string(""),
        "vision": .bool(proposalVision),
        "modelLadder": jsonArray(proposal?["model_ladder"]),
        "deliveryState": delivery["delivery_state"] ?? .string("not-ready"),
    ])
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
            .string(try encodeJSON(before)), .string(try encodeJSON(after)),
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
