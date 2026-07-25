import Foundation

public struct MetadataGiveBackWrittenItem: Sendable, Equatable, Identifiable {
    public var id: String { assetID }
    public var assetID: String
    public var fixtureIDs: [String]
    public var checksumSHA256: String
}

public struct MetadataGiveBackFailedItem: Sendable, Equatable, Identifiable {
    public var id: String { assetID }
    public var assetID: String
    public var message: String
}

public struct MetadataGiveBackBlockedItem: Sendable, Equatable, Identifiable {
    public var id: String { "\(fixtureID):\(assetID)" }
    public var fixtureID: String
    public var assetID: String
    public var reason: String
}

public struct MetadataGiveBackReport: Sendable, Equatable {
    public var actionID: String
    public var isDryRun: Bool
    public var readyCount: Int
    public var written: [MetadataGiveBackWrittenItem]
    public var failed: [MetadataGiveBackFailedItem]
    public var blocked: [MetadataGiveBackBlockedItem]

    public var failedAssetIDs: [String] {
        failed.map(\.assetID)
    }

    public var verifiedCount: Int { written.count }
}

public enum MetadataGiveBackError: Error, Sendable, Equatable {
    case missingResult
    case malformedResult
    case noFailedItemsToRetry
}

public actor MetadataGiveBackService {
    private let runner: OwnerActionRunner
    private let connectorID: String

    public init(runner: OwnerActionRunner, connectorID: String = "max") {
        self.runner = runner
        self.connectorID = connectorID
    }

    public func plan(
        fixtureID: String,
        assetIDs: [String] = []
    ) async throws -> MetadataGiveBackReport {
        try await run(mode: "fixture-photos-writeback-plan", fixtureID: fixtureID, assetIDs: assetIDs)
    }

    public func commit(
        fixtureID: String,
        assetIDs: [String] = []
    ) async throws -> MetadataGiveBackReport {
        try await run(mode: "fixture-photos-writeback-commit", fixtureID: fixtureID, assetIDs: assetIDs)
    }

    public func retryFailures(
        from report: MetadataGiveBackReport,
        fixtureID: String
    ) async throws -> MetadataGiveBackReport {
        guard !report.failedAssetIDs.isEmpty else {
            throw MetadataGiveBackError.noFailedItemsToRetry
        }
        return try await commit(fixtureID: fixtureID, assetIDs: report.failedAssetIDs)
    }

    private func run(
        mode: String,
        fixtureID: String,
        assetIDs: [String]
    ) async throws -> MetadataGiveBackReport {
        let cleanIDs = Array(Set(assetIDs.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }))
            .filter { !$0.isEmpty }
            .sorted()
        var manifest: [String: JSONValue] = [
            "mode": .string(mode),
            "fixtureId": .string(fixtureID),
        ]
        if !cleanIDs.isEmpty {
            manifest["assetIds"] = .array(cleanIDs.map(JSONValue.string))
        }
        let payload: [String: JSONValue] = [
            "workflow": .string("universal-fixture-pipeline"),
            "manifest": .object(manifest),
            "queuedAt": .string(ISO8601DateFormatter().string(from: Date())),
            "requestedConnector": .string(connectorID),
        ]
        let request = OwnerActionCreate(
            actionKind: "sidecar-culling-review",
            target: connectorID,
            payload: payload
        )
        let idempotency = [
            "metadata-giveback",
            mode,
            fixtureID,
            cleanIDs.joined(separator: ","),
            UUID().uuidString,
        ].joined(separator: ":")
        let action = try await runner.submit(request, idempotencyKey: idempotency)
        return try decodeReport(from: action, dryRun: mode.hasSuffix("-plan"))
    }

    private func decodeReport(
        from action: OwnerAction,
        dryRun: Bool
    ) throws -> MetadataGiveBackReport {
        guard let result = action.result,
              let writeback = result["photosWriteback"]?.objectValue else {
            throw MetadataGiveBackError.missingResult
        }

        let written = (writeback["written"]?.arrayValue ?? []).compactMap { value -> MetadataGiveBackWrittenItem? in
            guard let item = value.objectValue,
                  let assetID = item["assetId"]?.stringValue else { return nil }
            return MetadataGiveBackWrittenItem(
                assetID: assetID,
                fixtureIDs: (item["fixtureIds"]?.arrayValue ?? []).compactMap(\.stringValue),
                checksumSHA256: item["checksumSha256"]?.stringValue ?? ""
            )
        }
        let failed = (writeback["failed"]?.arrayValue ?? []).compactMap { value -> MetadataGiveBackFailedItem? in
            guard let item = value.objectValue,
                  let assetID = item["assetId"]?.stringValue else { return nil }
            return MetadataGiveBackFailedItem(
                assetID: assetID,
                message: item["error"]?.stringValue ?? "Apple Photos verification failed."
            )
        }
        let blocked = (writeback["blocked"]?.arrayValue ?? []).compactMap { value -> MetadataGiveBackBlockedItem? in
            guard let item = value.objectValue,
                  let assetID = item["assetId"]?.stringValue else { return nil }
            return MetadataGiveBackBlockedItem(
                fixtureID: item["fixtureId"]?.stringValue ?? "",
                assetID: assetID,
                reason: item["reason"]?.stringValue ?? "Blocked by the delivery gate."
            )
        }

        return MetadataGiveBackReport(
            actionID: action.id,
            isDryRun: dryRun,
            readyCount: writeback["count"]?.intValue ?? written.count,
            written: written,
            failed: failed,
            blocked: blocked
        )
    }
}
