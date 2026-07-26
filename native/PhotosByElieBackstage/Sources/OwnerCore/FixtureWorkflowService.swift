import Foundation

public struct FixtureNode: Identifiable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var parentID: String?
    public var state: String
    public var templateKey: String
    public var children: [FixtureNode]

    public var isArchived: Bool { state == "archived" }
    public var outlineChildren: [FixtureNode]? { children.isEmpty ? nil : children }

    init(json: [String: JSONValue]) {
        id = json["fixtureId"]?.stringValue ?? json["id"]?.stringValue ?? ""
        name = json["name"]?.stringValue ?? id
        parentID = json["parentFixtureId"]?.stringValue
        let archivedAt = json["archivedAt"]?.stringValue?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        state = json["state"]?.stringValue ?? (archivedAt.isEmpty ? "active" : "archived")
        templateKey = json["templateKey"]?.stringValue ?? ""
        children = (json["children"]?.arrayValue ?? []).compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixtureNode(json: object)
        }
    }

    public var flattened: [FixtureNode] {
        [self] + children.flatMap(\.flattened)
    }
}

public struct FixtureAsset: Identifiable, Sendable, Equatable {
    public var id: String
    public var photoLibraryIdentifier: String
    public var title: String
    public var filename: String
    public var mediaType: String
    public var capturedAt: String
    public var placementState: FixturePlacementState
    public var eligibilityState: String
    public var rating: Int
    public var color: String
    public var editorialState: String
    public var keywords: [String]

    public init(
        id: String,
        photoLibraryIdentifier: String = "",
        title: String,
        filename: String,
        mediaType: String,
        capturedAt: String = "",
        placementState: FixturePlacementState = .undecided,
        eligibilityState: String = "active",
        rating: Int = 0,
        color: String = "",
        editorialState: String = "unreviewed",
        keywords: [String] = []
    ) {
        self.id = id
        self.photoLibraryIdentifier = photoLibraryIdentifier.isEmpty ? id : photoLibraryIdentifier
        self.title = title
        self.filename = filename
        self.mediaType = mediaType
        self.capturedAt = capturedAt
        self.placementState = placementState
        self.eligibilityState = eligibilityState
        self.rating = rating
        self.color = color
        self.editorialState = editorialState
        self.keywords = keywords
    }

    init(json: [String: JSONValue]) {
        id = json["assetId"]?.stringValue ?? json["id"]?.stringValue ?? ""
        photoLibraryIdentifier = json["photoLibraryIdentifier"]?.stringValue ?? id
        title = json["title"]?.stringValue ?? ""
        filename = json["filename"]?.stringValue ?? ""
        mediaType = json["mediaType"]?.stringValue ?? json["kind"]?.stringValue ?? ""
        capturedAt = json["capturedAt"]?.stringValue ?? ""
        placementState = FixturePlacementState(
            rawValue: json["placementState"]?.stringValue ?? "undecided"
        ) ?? .undecided
        eligibilityState = json["eligibilityState"]?.stringValue ?? "active"
        rating = json["rating"]?.intValue ?? 0
        color = json["color"]?.stringValue ?? ""
        editorialState = json["editorialState"]?.stringValue ?? "unreviewed"
        keywords = json["keywords"]?.arrayValue?.compactMap(\.stringValue) ?? []
    }
}

public struct FixturePoolAsset: Identifiable, Sendable, Equatable {
    public var id: String
    public var sourceIdentity: String
    public var photoLibraryIdentifier: String
    public var sourceKind: String
    public var position: Int
    public var title: String
    public var filename: String
    public var mediaType: String

    init(json: [String: JSONValue]) {
        id = json["assetId"]?.stringValue ?? ""
        sourceIdentity = json["sourceIdentity"]?.stringValue ?? ""
        photoLibraryIdentifier = json["photoLibraryIdentifier"]?.stringValue ?? ""
        sourceKind = json["sourceKind"]?.stringValue ?? ""
        position = json["position"]?.intValue ?? 0
        title = json["title"]?.stringValue ?? ""
        filename = json["filename"]?.stringValue ?? ""
        mediaType = json["mediaType"]?.stringValue ?? ""
    }
}

public struct FixturePool: Sendable, Equatable {
    public var id: String
    public var name: String
    public var fixtureID: String
    public var assetCount: Int
    public var snapshotHash: String
    public var assets: [FixturePoolAsset]
}

public struct FixturePoolSummary: Identifiable, Sendable, Equatable {
    public var id: String
    public var fixtureID: String
    public var name: String
    public var assetCount: Int
    public var snapshotHash: String
    public var state: String
    public var createdAt: String

    init(json: [String: JSONValue]) {
        id = json["poolId"]?.stringValue ?? ""
        fixtureID = json["fixtureId"]?.stringValue ?? ""
        name = json["name"]?.stringValue ?? id
        assetCount = json["assetCount"]?.intValue ?? 0
        snapshotHash = json["snapshotHash"]?.stringValue ?? ""
        state = json["state"]?.stringValue ?? "active"
        createdAt = json["createdAt"]?.stringValue ?? ""
    }
}

public struct FixturePlacement: Identifiable, Sendable, Equatable {
    public var id: String
    public var assetID: String
    public var fixtureID: String
    public var breadcrumbLabel: String
    public var state: String
    public var sourcePoolID: String

    public var isActive: Bool { state == "active" }

    init(json: [String: JSONValue]) {
        id = json["placementId"]?.stringValue ?? json["id"]?.stringValue ?? ""
        assetID = json["assetId"]?.stringValue ?? ""
        fixtureID = json["fixtureId"]?.stringValue ?? ""
        breadcrumbLabel = json["breadcrumbLabel"]?.stringValue ?? fixtureID
        state = json["state"]?.stringValue ?? "active"
        sourcePoolID = json["sourcePoolId"]?.stringValue ?? ""
    }
}

public enum FixturePlacementState: String, Codable, Sendable, CaseIterable {
    case undecided
    case picked
    case hidden
}

public enum FixtureCullingView: String, Codable, Sendable, CaseIterable {
    case undecided
    case hidden
    case picked
    case allActive = "all-active"

    public var label: String {
        switch self {
        case .undecided: "Undecided"
        case .hidden: "Hidden"
        case .picked: "Picked"
        case .allActive: "All Active"
        }
    }
}

public struct FixtureCullingSummary: Sendable, Equatable {
    public var filtered: Int
    public var universe: Int
    public var undecided: Int
    public var picked: Int
    public var hidden: Int

    init(json: [String: JSONValue]) {
        filtered = json["filtered"]?.intValue ?? 0
        universe = json["universe"]?.intValue ?? 0
        undecided = json["undecided"]?.intValue ?? 0
        picked = json["picked"]?.intValue ?? 0
        hidden = json["hidden"]?.intValue ?? 0
    }
}

public struct FixtureCullingWindow: Sendable, Equatable {
    public var fixtureID: String
    public var candidateMode: String
    public var view: FixtureCullingView
    public var offset: Int
    public var limit: Int
    public var nextOffset: Int
    public var hasNext: Bool
    public var summary: FixtureCullingSummary
    public var items: [FixtureAsset]

    init(json: [String: JSONValue]) {
        fixtureID = json["fixtureId"]?.stringValue ?? ""
        candidateMode = json["candidateMode"]?.stringValue ?? ""
        view = FixtureCullingView(
            rawValue: json["view"]?.stringValue ?? "undecided"
        ) ?? .undecided
        offset = json["offset"]?.intValue ?? 0
        limit = json["limit"]?.intValue ?? 200
        nextOffset = json["nextOffset"]?.intValue ?? 0
        hasNext = json["hasNext"]?.boolValue ?? false
        summary = FixtureCullingSummary(json: json["summary"]?.objectValue ?? [:])
        items = (json["items"]?.arrayValue ?? [])
            .compactMap(\.objectValue)
            .map(FixtureAsset.init(json:))
    }
}

public struct FixtureStateMigrationReport: Sendable, Equatable {
    public var migrationID: String
    public var mode: String
    public var plannedDecisionInsertCount: Int
    public var plannedPickedCount: Int
    public var plannedHiddenCount: Int
    public var explicitPlacementCount: Int
    public var ancestorClosureCount: Int
    public var backupPath: String
    public var receiptPath: String
    public var applied: Bool
    public var idempotencyReplayed: Bool

    init(json: [String: JSONValue]) {
        migrationID = json["migrationId"]?.stringValue ?? ""
        mode = json["mode"]?.stringValue ?? ""
        plannedDecisionInsertCount = json["plannedDecisionInsertCount"]?.intValue ?? 0
        plannedPickedCount = json["plannedPickedCount"]?.intValue ?? 0
        plannedHiddenCount = json["plannedHiddenCount"]?.intValue ?? 0
        explicitPlacementCount = json["explicitPlacementCount"]?.intValue ?? 0
        ancestorClosureCount = json["ancestorClosureCount"]?.intValue ?? 0
        backupPath = json["backupPath"]?.stringValue ?? ""
        receiptPath = json["receiptPath"]?.stringValue ?? ""
        applied = json["applied"]?.boolValue ?? false
        idempotencyReplayed = json["idempotencyReplayed"]?.boolValue ?? false
    }
}

public struct FixtureAssetState: Identifiable, Sendable, Equatable {
    public var fixtureID: String
    public var assetID: String
    public var placementState: FixturePlacementState
    public var eligibilityState: String
    public var source: String
    public var updatedAt: String

    public var id: String { "\(fixtureID):\(assetID)" }

    init(json: [String: JSONValue]) {
        fixtureID = json["fixture_id"]?.stringValue ?? json["fixtureId"]?.stringValue ?? ""
        assetID = json["asset_id"]?.stringValue ?? json["assetId"]?.stringValue ?? ""
        placementState = FixturePlacementState(
            rawValue: json["placement_state"]?.stringValue
                ?? json["placementState"]?.stringValue
                ?? "undecided"
        ) ?? .undecided
        eligibilityState = json["eligibility_state"]?.stringValue
            ?? json["eligibilityState"]?.stringValue
            ?? "active"
        source = json["source"]?.stringValue ?? ""
        updatedAt = json["updated_at"]?.stringValue ?? json["updatedAt"]?.stringValue ?? ""
    }
}

public struct EffectiveFixtureAccess: Identifiable, Sendable, Equatable {
    public var grantID: String
    public var sourceFixtureID: String
    public var sourceFixtureName: String
    public var provider: String
    public var externalIdentity: String
    public var subjectLabel: String
    public var inherited: Bool

    public var id: String { grantID }

    init(json: [String: JSONValue]) {
        grantID = json["grantId"]?.stringValue ?? ""
        sourceFixtureID = json["sourceFixtureId"]?.stringValue ?? ""
        sourceFixtureName = json["sourceFixtureName"]?.stringValue ?? ""
        provider = json["provider"]?.stringValue ?? ""
        externalIdentity = json["externalIdentity"]?.stringValue ?? ""
        subjectLabel = json["subjectLabel"]?.stringValue ?? ""
        inherited = json["inherited"]?.boolValue ?? false
    }
}

public actor FixtureWorkflowService {
    private let runner: OwnerActionRunner

    public init(runner: OwnerActionRunner) {
        self.runner = runner
    }

    public func tree(includeArchived: Bool = true) async throws -> [FixtureNode] {
        let result = try await run("fixture-tree-list", extra: [
            "includeArchived": .bool(includeArchived),
        ])
        return parseNodes(result["fixtures"])
    }

    public func fixtureStateMigrationPlan() async throws -> FixtureStateMigrationReport {
        let result = try await run("fixture-state-migration-plan", extra: [:])
        return FixtureStateMigrationReport(json: result["migration"]?.objectValue ?? [:])
    }

    public func applyFixtureStateMigration() async throws -> FixtureStateMigrationReport {
        let result = try await run("fixture-state-migration-apply", extra: [:])
        return FixtureStateMigrationReport(json: result["migration"]?.objectValue ?? [:])
    }

    public func candidateUniverse(fixtureID: String) async throws -> [String] {
        let result = try await run("fixture-candidate-universe", extra: [
            "fixtureId": .string(fixtureID),
        ])
        return result["candidateUniverse"]?.objectValue?["assetIds"]?.arrayValue?
            .compactMap(\.stringValue) ?? []
    }

    public func cullingWindow(
        fixtureID: String,
        view: FixtureCullingView = .undecided,
        offset: Int = 0,
        limit: Int = 200,
        search: String = "",
        mediaTypes: [String] = [],
        ratings: [Int] = [],
        colors: [String] = []
    ) async throws -> FixtureCullingWindow {
        let result = try await run("fixture-culling-window", extra: [
            "fixtureId": .string(fixtureID),
            "view": .string(view.rawValue),
            "offset": .number(Double(max(0, offset))),
            "limit": .number(Double(max(1, min(500, limit)))),
            "search": .string(search),
            "mediaTypes": .array(mediaTypes.map(JSONValue.string)),
            "ratings": .array(ratings.map { .number(Double($0)) }),
            "colors": .array(colors.map(JSONValue.string)),
        ])
        return FixtureCullingWindow(
            json: result["cullingWindow"]?.objectValue ?? [:]
        )
    }

    public func applyState(
        _ state: FixturePlacementState,
        assetIDs: [String],
        fixtureID: String,
        reason: String = ""
    ) async throws -> [FixtureAssetState] {
        let result = try await run("fixture-state-apply", extra: [
            "fixtureId": .string(fixtureID),
            "assetIds": .array(assetIDs.map(JSONValue.string)),
            "placementState": .string(state.rawValue),
            "reason": .string(reason),
        ])
        return result["fixtureState"]?.objectValue?["items"]?.arrayValue?
            .compactMap(\.objectValue)
            .map(FixtureAssetState.init(json:)) ?? []
    }

    public func effectiveAccess(fixtureID: String) async throws -> [EffectiveFixtureAccess] {
        let result = try await run("fixture-access-effective", extra: [
            "fixtureId": .string(fixtureID),
        ])
        return result["access"]?.objectValue?["items"]?.arrayValue?
            .compactMap(\.objectValue)
            .map(EffectiveFixtureAccess.init(json:)) ?? []
    }

    public func create(
        name: String,
        parentID: String? = nil,
        templateKey: String = ""
    ) async throws -> [FixtureNode] {
        try await runAndTree("fixture-create", extra: [
            "name": .string(name),
            "parentFixtureId": .string(parentID ?? ""),
            "templateKey": .string(templateKey),
            "tags": .array(templateKey.isEmpty ? [] : [.string(templateKey)]),
            "destinationDefaults": ["r2", "apple_photos"],
        ])
    }

    public func rename(id: String, name: String) async throws -> [FixtureNode] {
        try await runAndTree("fixture-rename", extra: [
            "fixtureId": .string(id), "name": .string(name),
        ])
    }

    public func move(id: String, parentID: String?) async throws -> [FixtureNode] {
        try await runAndTree("fixture-move", extra: [
            "fixtureId": .string(id), "parentFixtureId": .string(parentID ?? ""),
        ])
    }

    public func setArchived(id: String, archived: Bool) async throws -> [FixtureNode] {
        try await runAndTree(archived ? "fixture-archive" : "fixture-reopen", extra: [
            "fixtureId": .string(id),
        ])
    }

    public func search(
        fixtureID: String,
        query: String,
        limit: Int = 240
    ) async throws -> [FixtureAsset] {
        let result = try await run("fixture-search", extra: [
            "filters": ["query": .string(query)],
            "limit": .number(Double(limit)),
            "fixtureId": .string(fixtureID),
        ])
        let search = result["search"]?.objectValue
        return (search?["items"]?.arrayValue ?? []).compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixtureAsset(json: object)
        }
    }

    public func snapshot(
        fixtureID: String,
        assetIDs: [String],
        name: String
    ) async throws -> FixturePool {
        let result = try await run("fixture-pool-create", extra: [
            "fixtureId": .string(fixtureID),
            "selectedAssetIds": .array(assetIDs.map(JSONValue.string)),
            "name": .string(name),
            "criteria": ["source": "native-backstage"],
        ])
        let pool = result["pool"]?.objectValue ?? [:]
        return FixturePool(
            id: pool["poolId"]?.stringValue ?? "",
            name: pool["name"]?.stringValue ?? name,
            fixtureID: pool["fixtureId"]?.stringValue ?? fixtureID,
            assetCount: pool["assetCount"]?.intValue ?? assetIDs.count,
            snapshotHash: pool["snapshotHash"]?.stringValue ?? "",
            assets: parsePoolAssets(pool["assets"])
        )
    }

    public func openPool(id: String) async throws -> FixturePool {
        let result = try await run("fixture-pool-open", extra: [
            "poolId": .string(id),
        ])
        let pool = result["pool"]?.objectValue ?? [:]
        return FixturePool(
            id: pool["poolId"]?.stringValue ?? id,
            name: pool["name"]?.stringValue ?? id,
            fixtureID: pool["fixtureId"]?.stringValue ?? "",
            assetCount: pool["assetCount"]?.intValue ?? 0,
            snapshotHash: pool["snapshotHash"]?.stringValue ?? "",
            assets: parsePoolAssets(pool["assets"])
        )
    }

    public func pools(fixtureID: String, limit: Int = 50) async throws -> [FixturePoolSummary] {
        let result = try await run("fixture-pool-list", extra: [
            "fixtureId": .string(fixtureID),
            "limit": .number(Double(max(1, min(250, limit)))),
        ])
        return (result["pools"]?.arrayValue ?? []).compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixturePoolSummary(json: object)
        }
    }

    public func place(assetIDs: [String], fixtureIDs: [String], poolID: String = "") async throws -> [FixturePlacement] {
        let result = try await run("fixture-place-multi", extra: [
            "assetIds": .array(assetIDs.map(JSONValue.string)),
            "fixtureIds": .array(fixtureIDs.map(JSONValue.string)),
            "poolId": .string(poolID),
        ])
        return parsePlacements(result["ledger"])
    }

    public func placements(assetIDs: [String], fixtureID: String = "") async throws -> [FixturePlacement] {
        let result = try await run("fixture-placement-list", extra: [
            "assetIds": .array(assetIDs.map(JSONValue.string)),
            "fixtureId": .string(fixtureID),
        ])
        return parsePlacements(result["ledger"])
    }

    public func movePlacement(id: String, to fixtureID: String) async throws {
        _ = try await run("fixture-placement-move", extra: [
            "placementId": .string(id),
            "fixtureId": .string(fixtureID),
        ])
    }

    public func removePlacement(id: String) async throws {
        _ = try await run("fixture-placement-remove", extra: [
            "placementId": .string(id),
        ])
    }

    public func restorePlacement(id: String) async throws {
        _ = try await run("fixture-placement-restore", extra: [
            "placementId": .string(id),
        ])
    }

    private func runAndTree(_ mode: String, extra: [String: JSONValue]) async throws -> [FixtureNode] {
        let result = try await run(mode, extra: extra)
        return parseNodes(result["fixtures"])
    }

    private func run(_ mode: String, extra: [String: JSONValue]) async throws -> [String: JSONValue] {
        var manifest = extra
        manifest["mode"] = .string(mode)
        let action = OwnerActionCreate(
            actionKind: "sidecar-culling-review",
            target: "max",
            payload: [
                "workflow": "universal-fixture-pipeline",
                "manifest": .object(manifest),
                "requestedConnector": "max",
                "queuedAt": .string(ISO8601DateFormatter().string(from: Date())),
            ]
        )
        let completed = try await runner.submit(
            action,
            idempotencyKey: ["native-fixture", mode, UUID().uuidString].joined(separator: "-")
        )
        guard let result = completed.result else {
            throw APIErrorEnvelope(error: .init(
                code: "fixture_result_missing",
                message: "The connector completed without a fixture result."
            ))
        }
        return result
    }

    private func parseNodes(_ value: JSONValue?) -> [FixtureNode] {
        (value?.arrayValue ?? []).compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixtureNode(json: object)
        }
    }

    private func parsePlacements(_ value: JSONValue?) -> [FixturePlacement] {
        let rows = value?.objectValue?["items"]?.arrayValue ?? value?.arrayValue ?? []
        return rows.compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixturePlacement(json: object)
        }
    }

    private func parsePoolAssets(_ value: JSONValue?) -> [FixturePoolAsset] {
        (value?.arrayValue ?? [])
            .compactMap { $0.objectValue }
            .map(FixturePoolAsset.init(json:))
            .sorted { $0.position < $1.position }
    }
}
