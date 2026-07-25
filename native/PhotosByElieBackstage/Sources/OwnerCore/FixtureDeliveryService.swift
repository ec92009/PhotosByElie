import Foundation

public struct FixtureDeliveryItem: Identifiable, Sendable, Equatable {
    public var id: String { assetID }
    public var assetID: String
    public var approved: Bool
    public var complete: Bool
    public var destinations: [String]
    public var r2Status: String
    public var photosStatus: String
    public var r2Evidence: String
    public var photosEvidence: String
    public var errorText: String

    init(json: [String: JSONValue]) {
        assetID = json["assetId"]?.stringValue ?? ""
        approved = json["approved"]?.boolValue ?? false
        complete = json["complete"]?.boolValue ?? false
        destinations = (json["destinations"]?.arrayValue ?? []).compactMap(\.stringValue)
        let receipts = json["receipts"]?.objectValue ?? [:]
        let r2 = receipts["r2"]?.objectValue ?? [:]
        let photos = receipts["apple_photos"]?.objectValue ?? [:]
        r2Status = r2["status"]?.stringValue ?? "pending"
        photosStatus = photos["status"]?.stringValue ?? "pending"
        r2Evidence = Self.receiptEvidence(r2)
        photosEvidence = Self.receiptEvidence(photos)
        errorText = [r2["errorText"]?.stringValue, photos["errorText"]?.stringValue]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: "; ")
    }

    private static func receiptEvidence(_ receipt: [String: JSONValue]) -> String {
        let rows = receipt["items"]?.arrayValue ?? []
        if rows.isEmpty { return "No receipt" }
        return rows.compactMap { value in
            guard let item = value.objectValue else { return nil }
            let key = item["object_key"]?.stringValue ?? ""
            let checksum = item["checksum_sha256"]?.stringValue ?? ""
            let verifiedAt = item["verified_at"]?.stringValue ?? ""
            let identity = key.isEmpty ? "local item" : key
            let digest = checksum.isEmpty ? "" : " sha256:\(checksum.prefix(12))"
            let verified = verifiedAt.isEmpty ? "" : " verified \(verifiedAt)"
            return "\(identity)\(digest)\(verified)"
        }.joined(separator: " • ")
    }
}

public struct FixtureDeliveryPlan: Sendable, Equatable {
    public var fixtureID: String
    public var items: [FixtureDeliveryItem]
    public var approvedCount: Int
    public var completeCount: Int

    public var retryableIDs: [String] {
        items.filter { $0.approved && !$0.complete }.map(\.assetID)
    }
}

public struct FixtureDeliverable: Identifiable, Sendable, Equatable {
    public var id: String
    public var kind: String
    public var provider: String
    public var externalIdentity: String
    public var state: String

    init(json: [String: JSONValue]) {
        id = json["deliverableId"]?.stringValue ?? ""
        kind = json["kind"]?.stringValue ?? ""
        provider = json["provider"]?.stringValue ?? ""
        externalIdentity = json["externalIdentity"]?.stringValue ?? ""
        state = json["state"]?.stringValue ?? ""
    }
}

public struct FixturePublicationPlan: Sendable, Equatable {
    public var fixtureID: String
    public var eligibleIDs: [String]
    public var blocked: [String: String]
}

public struct FixtureUploadHealth: Sendable, Equatable {
    public var fixtureID: String
    public var activeAssetCount: Int
    public var queuedCount: Int
    public var uploadableCount: Int
    public var coveredCount: Int
    public var partiallyCoveredCount: Int
    public var blockedCount: Int
}

public struct FixtureUploadRunAdoptionPlan: Sendable, Equatable {
    public var runID: String
    public var fixtureID: String
    public var eligibleIDs: [String]
    public var blocked: [String: String]
    public var applied: Bool
}

public struct FixtureOperationReport: Sendable, Equatable {
    public var actionID: String
    public var ok: Bool
    public var status: String
    public var processedCount: Int
    public var failedCount: Int
    public var detail: String
}

public enum FixtureDeliveryError: Error, Sendable, Equatable {
    case missingResult(String)
    case emptySelection
}

public actor FixtureDeliveryService {
    private let runner: OwnerActionRunner
    private let connectorID: String

    public init(runner: OwnerActionRunner, connectorID: String = "max") {
        self.runner = runner
        self.connectorID = connectorID
    }

    public func plan(fixtureID: String) async throws -> FixtureDeliveryPlan {
        let action = try await fixtureAction(
            mode: "fixture-delivery-plan",
            fixtureID: fixtureID
        )
        guard let delivery = action.result?["delivery"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("delivery")
        }
        let items = (delivery["items"]?.arrayValue ?? []).compactMap { value -> FixtureDeliveryItem? in
            guard let object = value.objectValue else { return nil }
            return FixtureDeliveryItem(json: object)
        }
        return FixtureDeliveryPlan(
            fixtureID: delivery["fixtureId"]?.stringValue ?? fixtureID,
            items: items,
            approvedCount: delivery["approvedCount"]?.intValue ?? items.filter(\.approved).count,
            completeCount: delivery["completeCount"]?.intValue ?? items.filter(\.complete).count
        )
    }

    public func uploadHealth(fixtureID: String) async throws -> FixtureUploadHealth {
        let action = try await fixtureAction(
            mode: "fixture-upload-health",
            fixtureID: fixtureID
        )
        guard let health = action.result?["uploadHealth"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("uploadHealth")
        }
        return FixtureUploadHealth(
            fixtureID: health["fixtureId"]?.stringValue ?? fixtureID,
            activeAssetCount: health["activeAssetCount"]?.intValue ?? 0,
            queuedCount: health["bridgeQueuedCount"]?.intValue ?? 0,
            uploadableCount: health["uploadableItemCount"]?.intValue ?? 0,
            coveredCount: health["fullyCoveredItemCount"]?.intValue ?? 0,
            partiallyCoveredCount: health["partiallyCoveredItemCount"]?.intValue ?? 0,
            blockedCount: health["metadataBlockedQueuedCount"]?.intValue ?? 0
        )
    }

    public func adoptionPlan(
        runID: String,
        fixtureID: String,
        assetIDs: [String] = []
    ) async throws -> FixtureUploadRunAdoptionPlan {
        try await adoption(
            mode: "fixture-upload-run-adoption-plan",
            runID: runID,
            fixtureID: fixtureID,
            assetIDs: assetIDs
        )
    }

    public func adopt(
        runID: String,
        fixtureID: String,
        assetIDs: [String] = []
    ) async throws -> FixtureUploadRunAdoptionPlan {
        try await adoption(
            mode: "fixture-upload-run-adoption-commit",
            runID: runID,
            fixtureID: fixtureID,
            assetIDs: assetIDs
        )
    }

    public func configure(
        fixtureID: String,
        assetIDs: [String],
        destinations: [String] = ["r2", "apple_photos"]
    ) async throws {
        _ = try await fixtureAction(
            mode: "fixture-destinations",
            fixtureID: fixtureID,
            extra: [
                "assetIds": .array(clean(assetIDs).map(JSONValue.string)),
                "destinations": .array(destinations.map(JSONValue.string)),
            ]
        )
    }

    public func deliver(fixtureID: String, assetIDs: [String]) async throws -> FixtureOperationReport {
        try await submitExactWorkflow(
            workflow: "fixture-delivery",
            fixtureID: fixtureID,
            assetIDs: assetIDs
        )
    }

    public func publicationPlan(
        fixtureID: String,
        assetIDs: [String] = []
    ) async throws -> FixturePublicationPlan {
        let action = try await fixtureAction(
            mode: "fixture-publication-plan",
            fixtureID: fixtureID,
            extra: ["assetIds": .array(clean(assetIDs).map(JSONValue.string))]
        )
        guard let publication = action.result?["publication"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("publication")
        }
        let eligible = (publication["eligible"]?.arrayValue ?? []).compactMap {
            $0.objectValue?["assetId"]?.stringValue
        }
        var blocked: [String: String] = [:]
        for value in publication["blocked"]?.arrayValue ?? [] {
            guard let row = value.objectValue, let id = row["assetId"]?.stringValue else { continue }
            blocked[id] = row["reason"]?.stringValue ?? "blocked"
        }
        return FixturePublicationPlan(
            fixtureID: publication["fixtureId"]?.stringValue ?? fixtureID,
            eligibleIDs: eligible,
            blocked: blocked
        )
    }

    public func publish(fixtureID: String, assetIDs: [String]) async throws -> FixtureOperationReport {
        try await submitExactWorkflow(
            workflow: "fixture-publication",
            fixtureID: fixtureID,
            assetIDs: assetIDs
        )
    }

    public func deliverables(fixtureID: String) async throws -> [FixtureDeliverable] {
        let action = try await fixtureAction(
            mode: "fixture-deliverable-list",
            fixtureID: fixtureID
        )
        let values = action.result?["deliverables"]?.objectValue?["items"]?.arrayValue ?? []
        return values.compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixtureDeliverable(json: object)
        }
    }

    public func linkDeliverable(
        fixtureID: String,
        kind: String,
        shareLink: String,
        provider: String = "share-link"
    ) async throws -> [FixtureDeliverable] {
        let action = try await fixtureAction(
            mode: "fixture-deliverable-link",
            fixtureID: fixtureID,
            extra: [
                "kind": .string(kind),
                "provider": .string(provider),
                "externalIdentity": .string(shareLink),
                "state": "ready",
                "recovery": ["shareLink": .string(shareLink)],
            ]
        )
        let values = action.result?["deliverables"]?.objectValue?["items"]?.arrayValue ?? []
        return values.compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixtureDeliverable(json: object)
        }
    }

    private func submitExactWorkflow(
        workflow: String,
        fixtureID: String,
        assetIDs: [String]
    ) async throws -> FixtureOperationReport {
        let ids = clean(assetIDs)
        guard !ids.isEmpty else { throw FixtureDeliveryError.emptySelection }
        let action = try await runner.submit(
            OwnerActionCreate(
                actionKind: "sidecar-upload-publish",
                target: connectorID,
                payload: [
                    "workflow": .string(workflow),
                    "fixtureId": .string(fixtureID),
                    "assetIds": .array(ids.map(JSONValue.string)),
                    "requestedConnector": .string(connectorID),
                ]
            ),
            idempotencyKey: [workflow, fixtureID, ids.joined(separator: ","), UUID().uuidString]
                .joined(separator: ":")
        )
        let result = action.result?["result"]?.objectValue ?? action.result ?? [:]
        let summary = result["summary"]?.objectValue ?? [:]
        return FixtureOperationReport(
            actionID: action.id,
            ok: result["ok"]?.boolValue ?? true,
            status: result["status"]?.stringValue ?? "completed",
            processedCount: summary["processedCount"]?.intValue
                ?? (result["assetIds"]?.arrayValue?.count ?? ids.count),
            failedCount: summary["failedCount"]?.intValue ?? 0,
            detail: result["message"]?.stringValue ?? ""
        )
    }

    private func fixtureAction(
        mode: String,
        fixtureID: String,
        extra: [String: JSONValue] = [:]
    ) async throws -> OwnerAction {
        var manifest = extra
        manifest["mode"] = .string(mode)
        manifest["fixtureId"] = .string(fixtureID)
        return try await runner.submit(
            OwnerActionCreate(
                actionKind: "sidecar-culling-review",
                target: connectorID,
                payload: [
                    "workflow": "universal-fixture-pipeline",
                    "manifest": .object(manifest),
                    "requestedConnector": .string(connectorID),
                    "queuedAt": .string(ISO8601DateFormatter().string(from: Date())),
                ]
            ),
            idempotencyKey: ["native-delivery", mode, fixtureID, UUID().uuidString]
                .joined(separator: ":")
        )
    }

    private func adoption(
        mode: String,
        runID: String,
        fixtureID: String,
        assetIDs: [String]
    ) async throws -> FixtureUploadRunAdoptionPlan {
        let cleanedRunID = runID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanedRunID.isEmpty else {
            throw FixtureDeliveryError.missingResult("runID")
        }
        let action = try await fixtureAction(
            mode: mode,
            fixtureID: fixtureID,
            extra: [
                "runId": .string(cleanedRunID),
                "assetIds": .array(clean(assetIDs).map(JSONValue.string)),
            ]
        )
        guard let plan = action.result?["uploadRunAdoption"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("uploadRunAdoption")
        }
        let eligible = (plan["items"]?.arrayValue ?? []).compactMap {
            $0.objectValue?["assetId"]?.stringValue
        }
        var blocked: [String: String] = [:]
        for value in plan["blocked"]?.arrayValue ?? [] {
            guard let row = value.objectValue, let id = row["assetId"]?.stringValue else { continue }
            blocked[id] = row["reason"]?.stringValue ?? "blocked"
        }
        return FixtureUploadRunAdoptionPlan(
            runID: plan["runId"]?.stringValue ?? cleanedRunID,
            fixtureID: plan["fixtureId"]?.stringValue ?? fixtureID,
            eligibleIDs: eligible,
            blocked: blocked,
            applied: plan["applied"]?.boolValue ?? false
        )
    }

    private func clean(_ values: [String]) -> [String] {
        Array(Set(values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }))
            .filter { !$0.isEmpty }
            .sorted()
    }
}
