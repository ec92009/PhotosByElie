import Foundation
import SQLite3

/// Native parity for the fixture-local Culling placement writer.
///
/// This store is deliberately not wired into Backstage yet. It exercises the
/// current fixture-state contract against a copied Owner.sqlite before the
/// connector boundary is removed. The transaction owns placement changes,
/// inherited eligibility recomputation, and the durable placement event.
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

private enum CullingSQLiteBinding {
    case string(String)
}

private final class CullingSQLiteConnection {
    private let database: OpaquePointer

    init(databaseURL: URL, busyTimeoutMilliseconds: Int32) throws {
        var pointer: OpaquePointer?
        let result = sqlite3_open_v2(
            databaseURL.path,
            &pointer,
            SQLITE_OPEN_READWRITE,
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
