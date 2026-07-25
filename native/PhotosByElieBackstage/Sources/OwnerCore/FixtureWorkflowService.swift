import Foundation

public struct FixtureNode: Identifiable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var parentID: String?
    public var state: String
    public var templateKey: String
    public var children: [FixtureNode]

    public var isArchived: Bool { state == "archived" }

    init(json: [String: JSONValue]) {
        id = json["fixtureId"]?.stringValue ?? json["id"]?.stringValue ?? ""
        name = json["name"]?.stringValue ?? id
        parentID = json["parentFixtureId"]?.stringValue
        state = json["state"]?.stringValue ?? "active"
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
    public var title: String
    public var filename: String
    public var mediaType: String

    init(json: [String: JSONValue]) {
        id = json["assetId"]?.stringValue ?? json["id"]?.stringValue ?? ""
        title = json["title"]?.stringValue ?? ""
        filename = json["filename"]?.stringValue ?? ""
        mediaType = json["mediaType"]?.stringValue ?? json["kind"]?.stringValue ?? ""
    }
}

public struct FixturePool: Sendable, Equatable {
    public var id: String
    public var name: String
    public var fixtureID: String
    public var assetCount: Int
    public var sidecarURL: URL?
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
            sidecarURL: result["sidecarUrl"]?.stringValue.flatMap(URL.init(string:))
        )
    }

    public func place(assetIDs: [String], fixtureIDs: [String], poolID: String = "") async throws {
        _ = try await run("fixture-place-multi", extra: [
            "assetIds": .array(assetIDs.map(JSONValue.string)),
            "fixtureIds": .array(fixtureIDs.map(JSONValue.string)),
            "poolId": .string(poolID),
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
}
