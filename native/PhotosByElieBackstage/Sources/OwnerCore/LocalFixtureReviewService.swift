import Foundation

/// The narrow local contract used by Backstage for Review mutations.
///
/// Keeping this contract separate prevents latency-sensitive Review work from
/// being routed through the cloud action ledger while the migration proceeds.
public protocol LocalFixtureReviewServing: Sendable {
    func applyReview(manifest: [String: JSONValue]) async throws -> FixtureReviewResult
    func undoReview(operationID: String) async throws -> FixtureReviewUndoResult
}

/// Native read support for the local Review service.
///
/// The native Backstage path fails closed when Owner.sqlite cannot be resolved;
/// it must not silently fall back to an Owner action or a Python process.
public protocol LocalFixtureReviewReading: Sendable {
    func nativeReviewWindow(
        fixtureID: String,
        mode: FixtureReviewMode,
        stateFilters: [String],
        proposalAvailableOnly: Bool,
        mediaFilters: [String],
        offset: Int,
        limit: Int,
        search: String
    ) async throws -> FixtureReviewWindow?
}

/// Native Culling read support. An unavailable Owner.sqlite is an error rather
/// than a reason to route an interactive read through the connector.
public protocol LocalFixtureCullingReading: Sendable {
    func nativeCullingWindow(
        fixtureID: String,
        view: FixtureCullingView,
        views: [FixtureCullingView],
        offset: Int,
        limit: Int,
        search: String,
        mediaTypes: [String],
        ratings: [Int],
        colors: [String]
    ) async throws -> FixtureCullingWindow?
}

/// Native Culling placement writes. An unavailable Owner.sqlite is an error
/// rather than a reason to route an interactive mutation through the connector.
public protocol LocalFixtureCullingServing: Sendable {
    func nativeApplyCullingState(
        _ state: FixturePlacementState,
        fixtureID: String,
        assetIDs: [String],
        reason: String
    ) async throws -> [FixtureAssetState]?

    func nativeUndoCullingState(
        _ applied: [FixtureAssetState],
        reason: String
    ) async throws -> [FixtureAssetState]?
}

public struct LocalFixtureReviewService: LocalFixtureReviewServing, LocalFixtureReviewReading, LocalFixtureCullingReading, LocalFixtureCullingServing {
    private let nativeDatabaseURL: URL?

    public init(
        nativeDatabaseURL: URL? = OwnerReviewDatabaseLocator().resolve()
    ) {
        self.nativeDatabaseURL = nativeDatabaseURL?.standardizedFileURL
    }

    public func applyReview(manifest: [String: JSONValue]) async throws -> FixtureReviewResult {
        var payload = manifest
        payload["operation"] = .string("apply")
        return try applyViaNativeSQLite(payload)
    }

    public func undoReview(operationID: String) async throws -> FixtureReviewUndoResult {
        try undoViaNativeSQLite(operationID: operationID)
    }

    public func nativeReviewWindow(
        fixtureID: String,
        mode: FixtureReviewMode,
        stateFilters: [String],
        proposalAvailableOnly: Bool,
        mediaFilters: [String],
        offset: Int,
        limit: Int,
        search: String
    ) throws -> FixtureReviewWindow? {
        return try nativeStore().reviewWindow(
            fixtureID: fixtureID,
            mode: mode,
            stateFilters: stateFilters,
            proposalAvailableOnly: proposalAvailableOnly,
            mediaFilters: mediaFilters,
            offset: offset,
            limit: limit,
            search: search
        )
    }

    public func nativeCullingWindow(
        fixtureID: String,
        view: FixtureCullingView,
        views: [FixtureCullingView],
        offset: Int,
        limit: Int,
        search: String,
        mediaTypes: [String],
        ratings: [Int],
        colors: [String]
    ) throws -> FixtureCullingWindow? {
        return try nativeCullingStore().cullingWindow(
            fixtureID: fixtureID,
            view: view,
            views: views,
            offset: offset,
            limit: limit,
            search: search,
            mediaTypes: mediaTypes,
            ratings: ratings,
            colors: colors
        )
    }

    public func nativeApplyCullingState(
        _ state: FixturePlacementState,
        fixtureID: String,
        assetIDs: [String],
        reason: String
    ) throws -> [FixtureAssetState]? {
        return try nativeCullingStore().applyState(
            state,
            fixtureID: fixtureID,
            assetIDs: assetIDs,
            actor: "owner",
            reason: reason
        )
    }

    public func nativeUndoCullingState(
        _ applied: [FixtureAssetState],
        reason: String
    ) throws -> [FixtureAssetState]? {
        return try nativeCullingStore().undoState(
            applied,
            actor: "owner",
            reason: reason
        )
    }

    /// Uses the verified native SQLite parity store. An unresolved database is
    /// reported by `nativeStore()` instead of selecting a second writer.
    private func applyViaNativeSQLite(
        _ payload: [String: JSONValue]
    ) throws -> FixtureReviewResult {
        let action = try requiredAction(from: payload)
        let fixtureID = try requiredString("fixtureId", from: payload)
        let assetIDs = try requiredStringArray("assetIds", from: payload)
        let anchorAssetID = try optionalString("anchorAssetId", from: payload) ?? ""
        let title = try optionalString("title", from: payload)
        let keywords = try optionalStringArray("keywords", from: payload)
        let proposalID = try optionalString("proposalId", from: payload)
        let aiReasons = try optionalStringArray("aiReasons", from: payload) ?? []
        let aiNote = try optionalString("aiNote", from: payload) ?? ""
        let propagate = payload["propagate"]?.boolValue ?? false
        return try nativeStore().applyReview(
            action,
            fixtureID: fixtureID,
            assetIDs: assetIDs,
            anchorAssetID: anchorAssetID,
            propagate: propagate,
            title: title,
            keywords: keywords,
            proposalID: proposalID,
            aiReasons: aiReasons,
            aiNote: aiNote
        )
    }

    private func undoViaNativeSQLite(
        operationID: String
    ) throws -> FixtureReviewUndoResult {
        try nativeStore().undoReview(operationID: operationID)
    }

    private func nativeStore() throws -> OwnerReviewSQLiteStore {
        guard let nativeDatabaseURL else {
            throw APIErrorEnvelope(error: .init(
                code: "native_review_database_missing",
                message: "Backstage could not resolve the native Review database."
            ))
        }
        guard FileManager.default.fileExists(atPath: nativeDatabaseURL.path) else {
            throw APIErrorEnvelope(error: .init(
                code: "native_review_database_missing",
                message: "Backstage could not find the native Review database."
            ))
        }
        return OwnerReviewSQLiteStore(databaseURL: nativeDatabaseURL)
    }

    private func nativeCullingStore() throws -> OwnerCullingSQLiteStore {
        guard let nativeDatabaseURL else {
            throw APIErrorEnvelope(error: .init(
                code: "native_review_database_missing",
                message: "Backstage could not resolve the native Culling database."
            ))
        }
        guard FileManager.default.fileExists(atPath: nativeDatabaseURL.path) else {
            throw APIErrorEnvelope(error: .init(
                code: "native_review_database_missing",
                message: "Backstage could not find the native Culling database."
            ))
        }
        return OwnerCullingSQLiteStore(databaseURL: nativeDatabaseURL)
    }

    private func requiredAction(
        from payload: [String: JSONValue]
    ) throws -> FixtureReviewAction {
        let rawValue = try requiredString("reviewAction", from: payload)
        guard let action = FixtureReviewAction(rawValue: rawValue) else {
            throw invalidManifest("reviewAction is not supported: \(rawValue)")
        }
        return action
    }

    private func requiredString(
        _ key: String,
        from payload: [String: JSONValue]
    ) throws -> String {
        guard let value = payload[key]?.stringValue,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw invalidManifest("\(key) is required")
        }
        return value
    }

    private func requiredStringArray(
        _ key: String,
        from payload: [String: JSONValue]
    ) throws -> [String] {
        guard let value = payload[key], let values = value.arrayValue else {
            throw invalidManifest("\(key) must be an array of strings")
        }
        guard values.allSatisfy({ $0.stringValue != nil }) else {
            throw invalidManifest("\(key) must be an array of strings")
        }
        return values.compactMap(\.stringValue)
    }

    private func optionalString(
        _ key: String,
        from payload: [String: JSONValue]
    ) throws -> String? {
        guard let value = payload[key] else { return nil }
        if case .null = value { return nil }
        guard let string = value.stringValue else {
            throw invalidManifest("\(key) must be a string")
        }
        return string
    }

    private func optionalStringArray(
        _ key: String,
        from payload: [String: JSONValue]
    ) throws -> [String]? {
        guard let value = payload[key] else { return nil }
        if case .null = value { return nil }
        guard let values = value.arrayValue,
              values.allSatisfy({ $0.stringValue != nil }) else {
            throw invalidManifest("\(key) must be an array of strings")
        }
        return values.compactMap(\.stringValue)
    }

    private func invalidManifest(_ message: String) -> APIErrorEnvelope {
        APIErrorEnvelope(error: .init(
            code: "native_review_manifest_invalid",
            message: message
        ))
    }

}
