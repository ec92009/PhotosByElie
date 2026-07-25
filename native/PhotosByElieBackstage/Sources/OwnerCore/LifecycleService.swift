import Foundation

public struct LifecycleItem: Identifiable, Sendable, Equatable {
    public var id: String { mediaID }
    public var mediaID: String
    public var state: String
    public var title: String
    public var mediaType: String
    public var sourceSlug: String
    public var updatedAt: String

    init(json: [String: JSONValue]) {
        mediaID = json["mediaId"]?.stringValue ?? ""
        state = json["state"]?.stringValue ?? ""
        title = json["title"]?.stringValue ?? ""
        mediaType = json["mediaType"]?.stringValue ?? ""
        sourceSlug = json["sourceSlug"]?.stringValue ?? ""
        updatedAt = json["updatedAt"]?.stringValue ?? ""
    }
}

public struct LifecycleLedger: Sendable, Equatable {
    public var items: [LifecycleItem]
    public var hiddenCount: Int
    public var discardedCount: Int
}

public enum LifecycleServiceError: Error, Sendable, Equatable {
    case missingResult
    case emptySelection
    case discardRequiresOneItem
}

public actor LifecycleService {
    private let runner: OwnerActionRunner
    private let connectorID: String

    public init(runner: OwnerActionRunner, connectorID: String = "max") {
        self.runner = runner
        self.connectorID = connectorID
    }

    public func ledger() async throws -> LifecycleLedger {
        let action = try await submitFixtureMode("fixture-lifecycle-list")
        guard let lifecycle = action.result?["lifecycle"]?.objectValue else {
            throw LifecycleServiceError.missingResult
        }
        let items = (lifecycle["items"]?.arrayValue ?? []).compactMap { value -> LifecycleItem? in
            guard let object = value.objectValue else { return nil }
            return LifecycleItem(json: object)
        }
        return LifecycleLedger(
            items: items,
            hiddenCount: lifecycle["hiddenCount"]?.intValue ?? items.filter { $0.state == "hidden" }.count,
            discardedCount: lifecycle["discardedCount"]?.intValue ?? items.filter { $0.state == "discarded" }.count
        )
    }

    public func restore(mediaIDs: [String]) async throws -> OwnerAction {
        let ids = clean(mediaIDs)
        guard !ids.isEmpty else { throw LifecycleServiceError.emptySelection }
        return try await submitModeration(operation: "undo-hide-many", mediaIDs: ids)
    }

    public func discard(mediaID: String) async throws -> OwnerAction {
        let ids = clean([mediaID])
        guard ids.count == 1 else { throw LifecycleServiceError.discardRequiresOneItem }
        return try await submitModeration(operation: "discard", mediaIDs: ids)
    }

    private func clean(_ values: [String]) -> [String] {
        Array(Set(values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }))
            .filter { !$0.isEmpty }
            .sorted()
    }

    private func submitFixtureMode(_ mode: String) async throws -> OwnerAction {
        let request = OwnerActionCreate(
            actionKind: "sidecar-culling-review",
            target: connectorID,
            payload: [
                "workflow": "universal-fixture-pipeline",
                "manifest": [
                    "mode": .string(mode),
                    "states": .array([.string("hidden")]),
                ],
                "requestedConnector": .string(connectorID),
                "queuedAt": .string(ISO8601DateFormatter().string(from: Date())),
            ]
        )
        return try await runner.submit(
            request,
            idempotencyKey: "native-lifecycle:\(mode):\(UUID().uuidString)"
        )
    }

    private func submitModeration(operation: String, mediaIDs: [String]) async throws -> OwnerAction {
        let request = OwnerActionCreate(
            actionKind: "photo-moderation",
            target: connectorID,
            payload: [
                "operation": .string(operation),
                "photoIds": .array(mediaIDs.map(JSONValue.string)),
                "requestedConnector": .string(connectorID),
            ]
        )
        return try await runner.submit(
            request,
            idempotencyKey: [
                "native-lifecycle",
                operation,
                mediaIDs.joined(separator: ","),
                UUID().uuidString,
            ].joined(separator: ":")
        )
    }
}
