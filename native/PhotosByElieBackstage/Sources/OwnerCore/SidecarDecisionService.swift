import Foundation

public enum SidecarPickAction: String, Codable, Sendable, CaseIterable {
    case pick, reject, unpick

    public var label: String {
        switch self {
        case .pick: "Pick"
        case .reject: "Reject"
        case .unpick: "Clear pick"
        }
    }
}

public enum SidecarColor: String, Codable, Sendable, CaseIterable {
    case none = ""
    case red, yellow, green, blue, purple

    public var label: String {
        self == .none ? "No color" : rawValue.capitalized
    }
}

public struct SidecarDecisionState: Codable, Sendable, Equatable {
    public var assetId: String
    public var rating: Int
    public var color: String
    public var pickState: String
    public var metadataState: String
    public var title: String
    public var keywords: [String]
    public var tombstoneState: String
    public var updatedAt: String

    public init(
        assetId: String,
        rating: Int = 0,
        color: String = "",
        pickState: String = "undecided",
        metadataState: String = "unreviewed",
        title: String = "",
        keywords: [String] = [],
        tombstoneState: String = "",
        updatedAt: String = ""
    ) {
        self.assetId = assetId
        self.rating = rating
        self.color = color
        self.pickState = pickState
        self.metadataState = metadataState
        self.title = title
        self.keywords = keywords
        self.tombstoneState = tombstoneState
        self.updatedAt = updatedAt
    }
}

public struct SidecarDecisionChange: Sendable, Equatable {
    public var assetID: String
    public var state: SidecarDecisionState
    public var before: SidecarDecisionState
    public var changedFamilies: [String]
}

public protocol SidecarDecisionServing: Sendable {
    func applyDetailed(
        _ decisions: [SidecarDecision],
        idempotencyKey: String
    ) async throws -> [SidecarDecisionChange]
}

/// Canonical Sidecar decision payload. This deliberately mirrors the web
/// Sidecar ledger rather than inventing a second native decision vocabulary.
public struct SidecarDecision: Codable, Identifiable, Sendable, Equatable {
    public var assetId: String
    public var action: String
    public var rating: Int?
    public var title: String?
    public var caption: String?
    public var keywords: [String]?
    public var metadataState: String?
    public var reason: String?
    public var color: String?

    public var id: String { "\(assetId):\(action)" }

    public static func pick(_ assetID: String, action: SidecarPickAction) -> Self {
        Self(assetId: assetID, action: action.rawValue)
    }

    public static func rating(_ assetID: String, value: Int) -> Self {
        Self(assetId: assetID, action: "rating", rating: min(5, max(0, value)))
    }

    public static func color(_ assetID: String, value: SidecarColor) -> Self {
        Self(assetId: assetID, action: "color", color: value.rawValue)
    }

    /// Legacy PBB-78/repair compatibility primitive. Normal Owner actions use
    /// LifecycleService and the Waste Basket gateway instead.
    public static func tombstone(_ assetID: String, reason: String = "") -> Self {
        Self(assetId: assetID, action: "tombstone", reason: reason)
    }

    public static func restore(_ assetID: String) -> Self {
        Self(assetId: assetID, action: "restore")
    }

    public static func metadata(
        _ assetID: String,
        title: String,
        caption: String,
        keywords: [String],
        state: String
    ) -> Self {
        Self(
            assetId: assetID,
            action: "metadata",
            title: title,
            caption: caption,
            keywords: keywords,
            metadataState: state
        )
    }
}

private struct DecisionQuery: Codable { let assetIds: [String] }
private struct DecisionBatch: Codable { let decisions: [SidecarDecision] }

public actor SidecarDecisionService: SidecarDecisionServing {
    private let api: OwnerAPIClient

    public init(api: OwnerAPIClient) {
        self.api = api
    }

    public func apply(
        _ decisions: [SidecarDecision],
        idempotencyKey: String = UUID().uuidString
    ) async throws -> [String: JSONValue] {
        guard !decisions.isEmpty else { return [:] }
        let path = decisions.count == 1
            ? "/sidecar/decisions/apply"
            : "/sidecar/decisions/apply-batch"
        let body: JSONValue = decisions.count == 1
            ? .object(try encodeObject(decisions[0]))
            : .object(try encodeObject(DecisionBatch(decisions: decisions)))
        return try await api.request(
            path: path,
            body: body,
            idempotencyKey: idempotencyKey
        )
    }

    public func query(assetIDs: [String]) async throws -> [String: JSONValue] {
        try await api.request(
            path: "/sidecar/decisions/query",
            body: DecisionQuery(assetIds: assetIDs)
        )
    }

    public func applyDetailed(
        _ decisions: [SidecarDecision],
        idempotencyKey: String = UUID().uuidString
    ) async throws -> [SidecarDecisionChange] {
        try parseChanges(try await apply(decisions, idempotencyKey: idempotencyKey))
    }

    public func queryStates(assetIDs: [String]) async throws -> [String: SidecarDecisionState] {
        let response = try await query(assetIDs: assetIDs)
        guard let decisions = response["decisions"]?.objectValue else { return [:] }
        return try decisions.reduce(into: [:]) { result, item in
            result[item.key] = try decode(SidecarDecisionState.self, from: item.value)
        }
    }

    private func parseChanges(_ response: [String: JSONValue]) throws -> [SidecarDecisionChange] {
        if let items = response["items"]?.arrayValue {
            return try items.compactMap { try parseChange($0.objectValue) }
        }
        if let change = try parseChange(response) {
            return [change]
        }
        return []
    }

    private func parseChange(_ object: [String: JSONValue]?) throws -> SidecarDecisionChange? {
        guard let object,
              let assetID = object["assetId"]?.stringValue,
              let stateValue = object["state"],
              let beforeValue = object["before"] else {
            return nil
        }
        return SidecarDecisionChange(
            assetID: assetID,
            state: try decode(SidecarDecisionState.self, from: stateValue),
            before: try decode(SidecarDecisionState.self, from: beforeValue),
            changedFamilies: object["changedFamilies"]?.arrayValue?.compactMap(\.stringValue) ?? []
        )
    }

    private func decode<T: Decodable>(_ type: T.Type, from value: JSONValue) throws -> T {
        try JSONDecoder.ownerAPI.decode(type, from: JSONEncoder.ownerAPI.encode(value))
    }

    private func encodeObject<T: Encodable>(_ value: T) throws -> [String: JSONValue] {
        let data = try JSONEncoder.ownerAPI.encode(value)
        return try JSONDecoder.ownerAPI.decode([String: JSONValue].self, from: data)
    }
}
