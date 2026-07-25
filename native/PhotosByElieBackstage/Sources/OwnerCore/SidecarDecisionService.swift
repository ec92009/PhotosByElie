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

    public var id: String { "\(assetId):\(action)" }

    public static func pick(_ assetID: String, action: SidecarPickAction) -> Self {
        Self(assetId: assetID, action: action.rawValue)
    }

    public static func rating(_ assetID: String, value: Int) -> Self {
        Self(assetId: assetID, action: "rating", rating: min(5, max(0, value)))
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

public actor SidecarDecisionService {
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

    private func encodeObject<T: Encodable>(_ value: T) throws -> [String: JSONValue] {
        let data = try JSONEncoder.ownerAPI.encode(value)
        return try JSONDecoder.ownerAPI.decode([String: JSONValue].self, from: data)
    }
}
