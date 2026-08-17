import Foundation

public struct LifecycleItem: Identifiable, Sendable, Equatable {
    public var id: String { mediaID }
    public var mediaID: String
    public var state: String
    public var title: String
    public var filename: String
    public var capturedAt: String
    public var mediaType: String
    public var sourceSlug: String
    public var updatedAt: String

    init(json: [String: JSONValue]) {
        mediaID = json["mediaId"]?.stringValue ?? ""
        state = json["state"]?.stringValue ?? ""
        title = json["title"]?.stringValue ?? ""
        filename = json["filename"]?.stringValue ?? ""
        capturedAt = json["capturedAt"]?.stringValue ?? ""
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
    case emptyRequiresConfirmation
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
        return try await submitModeration(
            operation: "waste-basket-restore",
            mediaIDs: ids,
            source: "backstage-waste-basket"
        )
    }

    public func moveToWasteBasket(
        mediaIDs: [String],
        fixtureID: String = "",
        galleryID: String = "",
        source: String = "backstage-culling"
    ) async throws -> OwnerAction {
        let ids = clean(mediaIDs)
        guard !ids.isEmpty else { throw LifecycleServiceError.emptySelection }
        return try await submitModeration(
            operation: "waste-basket-x",
            mediaIDs: ids,
            source: source,
            fixtureID: fixtureID,
            galleryID: galleryID
        )
    }

    public func emptyWasteBasket(
        mediaIDs: [String] = [],
        confirmed: Bool,
        confirmationToken: String = "EMPTY_WASTE_BASKET"
    ) async throws -> OwnerAction {
        guard confirmed, confirmationToken == "EMPTY_WASTE_BASKET" else {
            throw LifecycleServiceError.emptyRequiresConfirmation
        }
        return try await submitModeration(
            operation: "waste-basket-empty",
            mediaIDs: mediaIDs,
            source: "backstage-waste-basket",
            confirmed: true,
            confirmationToken: confirmationToken
        )
    }

    public func restoreTombstone(mediaIDs: [String]) async throws -> OwnerAction {
        let ids = clean(mediaIDs)
        guard !ids.isEmpty else { throw LifecycleServiceError.emptySelection }
        return try await submitModeration(
            operation: "waste-basket-tombstone-restore",
            mediaIDs: ids,
            source: "backstage-waste-basket",
            explicitTombstoneRestore: true
        )
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

    private func submitModeration(
        operation: String,
        mediaIDs: [String],
        source: String,
        fixtureID: String = "",
        galleryID: String = "",
        confirmed: Bool = false,
        confirmationToken: String = "",
        explicitTombstoneRestore: Bool = false
    ) async throws -> OwnerAction {
        let requestKey = "native-lifecycle:\(operation):\(UUID().uuidString)"
        var payload: [String: JSONValue] = [
            "operation": .string(operation),
            "photoIds": .array(mediaIDs.map(JSONValue.string)),
            "source": .string(source),
            "actor": .string("backstage"),
            "requestKey": .string(requestKey),
            "requestedConnector": .string(connectorID),
        ]
        if !fixtureID.isEmpty { payload["fixtureId"] = .string(fixtureID) }
        if !galleryID.isEmpty { payload["galleryId"] = .string(galleryID) }
        if confirmed { payload["confirmed"] = .bool(true) }
        if !confirmationToken.isEmpty { payload["confirmationToken"] = .string(confirmationToken) }
        if explicitTombstoneRestore { payload["explicitTombstoneRestore"] = .bool(true) }
        let request = OwnerActionCreate(
            actionKind: "photo-moderation",
            target: connectorID,
            payload: payload
        )
        return try await runner.submit(
            request,
            idempotencyKey: requestKey
        )
    }
}
