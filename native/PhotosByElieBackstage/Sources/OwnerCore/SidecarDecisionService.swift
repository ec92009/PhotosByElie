import Foundation

public enum SidecarDecisionState: String, Codable, Sendable, CaseIterable {
    case picked, rejected, approved, blocked, clear
}

public struct SidecarDecision: Codable, Identifiable, Sendable, Equatable {
    public var assetId: String
    public var decision: String
    public var fixtureId: String?
    public var reason: String?
    public var updatedAt: String?

    public var id: String { assetId }

    public init(assetID: String, state: SidecarDecisionState, fixtureID: String? = nil, reason: String = "") {
        assetId = assetID
        decision = state.rawValue
        fixtureId = fixtureID
        self.reason = reason
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
