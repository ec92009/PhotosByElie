import Foundation

public struct LifecycleItem: Identifiable, Sendable, Equatable {
    public var id: String { mediaID }
    public var mediaID: String
    public var state: String
    public var title: String
    public var filename: String
    public var capturedAt: String
    public var photoLibraryIdentifier: String
    public var mediaType: String
    public var sourceSlug: String
    public var updatedAt: String

    init(json: [String: JSONValue]) {
        mediaID = json["mediaId"]?.stringValue ?? ""
        state = json["state"]?.stringValue ?? ""
        title = json["title"]?.stringValue ?? ""
        filename = json["filename"]?.stringValue ?? ""
        capturedAt = json["capturedAt"]?.stringValue ?? ""
        photoLibraryIdentifier = json["photoLibraryIdentifier"]?.stringValue
            ?? json["photo_library_identifier"]?.stringValue
            ?? ""
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

public struct LifecycleActionReceipt: Sendable, Equatable {
    public var affected: Int
    public var skipped: Int
    public var failed: Int

    public init(affected: Int, skipped: Int, failed: Int) {
        self.affected = max(0, affected)
        self.skipped = max(0, skipped)
        self.failed = max(0, failed)
    }

    public static func summarize(_ action: OwnerAction, requestedCount: Int) -> Self {
        let requested = max(0, requestedCount)
        let topLevel = action.result ?? [:]
        let payload = topLevel["result"]?.objectValue ?? topLevel
        let items = payload["items"]?.arrayValue?.compactMap(\.objectValue) ?? []
        guard !items.isEmpty else {
            return action.state == .completed
                ? Self(affected: requested, skipped: 0, failed: 0)
                : Self(affected: 0, skipped: 0, failed: requested)
        }

        var affected = 0
        var skipped = 0
        var failed = 0
        for item in items {
            switch item["status"]?.stringValue?.lowercased() ?? "" {
            case "already-applied", "already-recoverable", "skipped":
                skipped += 1
            case "failed", "error", "conflict":
                failed += 1
            default:
                affected += 1
            }
        }
        let accounted = affected + skipped + failed
        if accounted < requested {
            failed += requested - accounted
        }
        return Self(affected: affected, skipped: skipped, failed: failed)
    }

    public var statusSummary: String {
        "Affected \(affected.formatted()) • skipped \(skipped.formatted()) • failed \(failed.formatted())"
    }
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

    /// Queue an X transition and return before the connector drains the
    /// lifecycle outbox. The caller owns terminal-state monitoring.
    public func enqueueMoveToWasteBasket(
        mediaIDs: [String],
        fixtureID: String = "",
        galleryID: String = "",
        source: String = "backstage-culling"
    ) async throws -> OwnerAction {
        let ids = clean(mediaIDs)
        guard !ids.isEmpty else { throw LifecycleServiceError.emptySelection }
        return try await enqueueModeration(
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
            mediaIDs: clean(mediaIDs),
            source: "backstage-waste-basket",
            confirmed: true,
            confirmationToken: confirmationToken
        )
    }

    /// Queue a scoped or global Empty Waste Basket transition and return
    /// before local reconciliation and remote acknowledgement finish.
    public func enqueueEmptyWasteBasket(
        mediaIDs: [String] = [],
        confirmed: Bool,
        confirmationToken: String = "EMPTY_WASTE_BASKET"
    ) async throws -> OwnerAction {
        guard confirmed, confirmationToken == "EMPTY_WASTE_BASKET" else {
            throw LifecycleServiceError.emptyRequiresConfirmation
        }
        return try await enqueueModeration(
            operation: "waste-basket-empty",
            mediaIDs: clean(mediaIDs),
            source: "backstage-waste-basket",
            confirmed: true,
            confirmationToken: confirmationToken
        )
    }

    public func awaitCompletion(
        of action: OwnerAction,
        completionTimeout: Duration? = nil,
        onUpdate: (@Sendable (OwnerAction) -> Void)? = nil
    ) async throws -> OwnerAction {
        try await runner.awaitCompletion(
            of: action,
            completionTimeout: completionTimeout,
            onUpdate: onUpdate
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
        let (request, requestKey) = moderationRequest(
            operation: operation,
            mediaIDs: mediaIDs,
            source: source,
            fixtureID: fixtureID,
            galleryID: galleryID,
            confirmed: confirmed,
            confirmationToken: confirmationToken,
            explicitTombstoneRestore: explicitTombstoneRestore
        )
        return try await runner.submit(
            request,
            idempotencyKey: requestKey
        )
    }

    private func enqueueModeration(
        operation: String,
        mediaIDs: [String],
        source: String,
        fixtureID: String = "",
        galleryID: String = "",
        confirmed: Bool = false,
        confirmationToken: String = "",
        explicitTombstoneRestore: Bool = false
    ) async throws -> OwnerAction {
        let (request, requestKey) = moderationRequest(
            operation: operation,
            mediaIDs: mediaIDs,
            source: source,
            fixtureID: fixtureID,
            galleryID: galleryID,
            confirmed: confirmed,
            confirmationToken: confirmationToken,
            explicitTombstoneRestore: explicitTombstoneRestore
        )
        return try await runner.enqueue(
            request,
            idempotencyKey: requestKey
        )
    }

    private func moderationRequest(
        operation: String,
        mediaIDs: [String],
        source: String,
        fixtureID: String = "",
        galleryID: String = "",
        confirmed: Bool = false,
        confirmationToken: String = "",
        explicitTombstoneRestore: Bool = false
    ) -> (OwnerActionCreate, String) {
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
        return (request, requestKey)
    }
}
