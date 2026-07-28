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

public struct NativeUploadRunItem: Identifiable, Sendable, Equatable {
    public var id: String { assetID }
    public var assetID: String
    public var status: String
    public var errorText: String
}

public struct NativeUploadPlanItem: Identifiable, Sendable, Equatable {
    public var id: String { assetID }
    public var assetID: String
    public var photoLibraryIdentifier: String
    public var title: String
    public var keywords: [String]
    public var filename: String
    public var capturedAt: String
    public var deliveryState: String
    public var errorText: String
}

public struct NativeUploadPlan: Sendable, Equatable {
    public var fixtureID: String
    public var fixtureName: String
    public var cloudAllowed: Bool
    public var pickedCount: Int
    public var approvedCount: Int
    public var needsReviewCount: Int
    public var needsUploadCount: Int
    public var liveCount: Int
    public var offset: Int
    public var limit: Int
    public var hasNext: Bool
    public var items: [NativeUploadPlanItem]

    public init(
        fixtureID: String,
        fixtureName: String,
        cloudAllowed: Bool,
        pickedCount: Int,
        approvedCount: Int,
        needsReviewCount: Int,
        needsUploadCount: Int,
        liveCount: Int,
        offset: Int,
        limit: Int,
        hasNext: Bool,
        items: [NativeUploadPlanItem]
    ) {
        self.fixtureID = fixtureID
        self.fixtureName = fixtureName
        self.cloudAllowed = cloudAllowed
        self.pickedCount = pickedCount
        self.approvedCount = approvedCount
        self.needsReviewCount = needsReviewCount
        self.needsUploadCount = needsUploadCount
        self.liveCount = liveCount
        self.offset = offset
        self.limit = limit
        self.hasNext = hasNext
        self.items = items
    }
}

public struct NativeUploadRun: Sendable, Equatable {
    public var runID: String
    public var status: String
    public var requested: Int
    public var processed: Int
    public var live: Int
    public var failed: Int
    public var remaining: Int
    public var concurrency: Int
    public var startedAt: String
    public var completedAt: String
    public var items: [NativeUploadRunItem]

    public var isFinished: Bool {
        ["completed", "completed-with-errors", "failed", "cancelled"].contains(status)
    }
}

public struct R2ReconciliationItem: Identifiable, Sendable, Equatable {
    public var id: String { "\(bucket):\(key)" }
    public var bucket: String
    public var key: String
    public var assetID: String
    public var sold: Bool
    public var referenced: Bool
    public var action: String
}

public struct R2ReconciliationReport: Sendable, Equatable {
    public var runID: String
    public var mode: String
    public var scanned: Int
    public var protected: Int
    public var quarantined: Int
    public var restored: Int
    public var eligibleDelete: Int
    public var deleted: Int
    public var items: [R2ReconciliationItem]
}

public struct PhotosSyncReport: Sendable, Equatable {
    public var attached: Bool
    public var requested: Int
    public var scanned: Int
    public var baseline: Int
    public var unchanged: Int
    public var metadataOnly: Int
    public var appearance: Int
    public var sourceMissing: Int
    public var sourceReturned: Int
    public var failed: Int
    public var elapsedSeconds: Double
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

    public func startNativeUpload(
        assetIDs: [String] = [],
        limit: Int = 50,
        concurrency: Int = 4
    ) async throws -> NativeUploadRun {
        let action = try await fixtureAction(
            mode: "asset-upload-run-start",
            fixtureID: "",
            extra: [
                "assetIds": .array(clean(assetIDs).map(JSONValue.string)),
                "limit": .number(Double(limit)),
                "concurrency": .number(Double(concurrency)),
            ]
        )
        return try decodeNativeUploadRun(action)
    }

    public func nativeUploadPlan(
        fixtureID: String,
        offset: Int = 0,
        limit: Int = 200
    ) async throws -> NativeUploadPlan {
        let action = try await fixtureAction(
            mode: "asset-upload-plan",
            fixtureID: fixtureID,
            extra: [
                "offset": .number(Double(max(0, offset))),
                "limit": .number(Double(max(1, min(500, limit)))),
            ]
        )
        guard let plan = action.result?["uploadPlan"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("uploadPlan")
        }
        let items = (plan["items"]?.arrayValue ?? []).compactMap { value -> NativeUploadPlanItem? in
            guard let object = value.objectValue else { return nil }
            let assetID = object["assetId"]?.stringValue ?? ""
            guard !assetID.isEmpty else { return nil }
            return NativeUploadPlanItem(
                assetID: assetID,
                photoLibraryIdentifier: object["photoLibraryIdentifier"]?.stringValue ?? assetID,
                title: object["title"]?.stringValue ?? "",
                keywords: object["keywords"]?.arrayValue?.compactMap(\.stringValue) ?? [],
                filename: object["filename"]?.stringValue ?? "",
                capturedAt: object["capturedAt"]?.stringValue ?? "",
                deliveryState: object["deliveryState"]?.stringValue ?? "needs-upload",
                errorText: object["errorText"]?.stringValue ?? ""
            )
        }
        return NativeUploadPlan(
            fixtureID: plan["fixtureId"]?.stringValue ?? fixtureID,
            fixtureName: plan["fixtureName"]?.stringValue ?? fixtureID,
            cloudAllowed: plan["cloudAllowed"]?.boolValue ?? false,
            pickedCount: plan["pickedCount"]?.intValue ?? 0,
            approvedCount: plan["approvedCount"]?.intValue ?? 0,
            needsReviewCount: plan["needsReviewCount"]?.intValue ?? 0,
            needsUploadCount: plan["needsUploadCount"]?.intValue ?? 0,
            liveCount: plan["liveCount"]?.intValue ?? 0,
            offset: plan["offset"]?.intValue ?? 0,
            limit: plan["limit"]?.intValue ?? max(1, min(500, limit)),
            hasNext: plan["hasNext"]?.boolValue ?? false,
            items: items
        )
    }

    public func nativeUploadStatus(runID: String) async throws -> NativeUploadRun {
        let cleanRunID = runID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanRunID.isEmpty else {
            throw FixtureDeliveryError.missingResult("runID")
        }
        let action = try await fixtureAction(
            mode: "asset-upload-run-status",
            fixtureID: "",
            extra: ["runId": .string(cleanRunID)]
        )
        return try decodeNativeUploadRun(action)
    }

    public func r2Reconciliation(commit: Bool = false) async throws -> R2ReconciliationReport {
        let action = try await fixtureAction(
            mode: commit ? "r2-reconciliation-commit" : "r2-reconciliation-plan",
            fixtureID: ""
        )
        guard let result = action.result?["reconciliation"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("reconciliation")
        }
        let items = (result["actions"]?.arrayValue ?? []).compactMap { value -> R2ReconciliationItem? in
            guard let item = value.objectValue,
                  let key = item["key"]?.stringValue else { return nil }
            return R2ReconciliationItem(
                bucket: item["bucket"]?.stringValue ?? "",
                key: key,
                assetID: item["assetId"]?.stringValue ?? "",
                sold: item["sold"]?.boolValue ?? false,
                referenced: item["referenced"]?.boolValue ?? false,
                action: item["action"]?.stringValue ?? ""
            )
        }
        return R2ReconciliationReport(
            runID: result["runId"]?.stringValue ?? "",
            mode: result["mode"]?.stringValue ?? (commit ? "commit" : "plan"),
            scanned: result["scanned"]?.intValue ?? items.count,
            protected: result["protected"]?.intValue ?? 0,
            quarantined: result["quarantined"]?.intValue ?? 0,
            restored: result["restored"]?.intValue ?? 0,
            eligibleDelete: result["eligibleDelete"]?.intValue ?? 0,
            deleted: result["deleted"]?.intValue ?? 0,
            items: items
        )
    }

    public func syncPhotos(limit: Int = 25) async throws -> PhotosSyncReport {
        let action = try await fixtureAction(
            mode: "photos-sync-run",
            fixtureID: "",
            extra: ["limit": .number(Double(max(1, min(limit, 50))))]
        )
        guard let result = action.result?["photosSync"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("photosSync")
        }
        let changes = result["changes"]?.objectValue ?? [:]
        let elapsedSeconds: Double
        if case let .number(value) = result["elapsedSeconds"] {
            elapsedSeconds = value
        } else {
            elapsedSeconds = 0
        }
        return PhotosSyncReport(
            attached: result["attached"]?.boolValue ?? false,
            requested: result["requested"]?.intValue ?? 0,
            scanned: result["scanned"]?.intValue ?? 0,
            baseline: changes["baseline"]?.intValue ?? 0,
            unchanged: changes["unchanged"]?.intValue ?? 0,
            metadataOnly: changes["metadataOnly"]?.intValue ?? 0,
            appearance: changes["appearance"]?.intValue ?? 0,
            sourceMissing: changes["sourceMissing"]?.intValue ?? 0,
            sourceReturned: changes["sourceReturned"]?.intValue ?? 0,
            failed: result["failures"]?.arrayValue?.count ?? 0,
            elapsedSeconds: elapsedSeconds
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

    private func decodeNativeUploadRun(_ action: OwnerAction) throws -> NativeUploadRun {
        guard let result = action.result?["uploadRun"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("uploadRun")
        }
        let items = (result["items"]?.arrayValue ?? []).compactMap { value -> NativeUploadRunItem? in
            guard let item = value.objectValue,
                  let assetID = item["asset_id"]?.stringValue ?? item["assetId"]?.stringValue
            else { return nil }
            return NativeUploadRunItem(
                assetID: assetID,
                status: item["status"]?.stringValue ?? "",
                errorText: item["error_text"]?.stringValue
                    ?? item["errorText"]?.stringValue
                    ?? ""
            )
        }
        return NativeUploadRun(
            runID: result["runId"]?.stringValue ?? "",
            status: result["status"]?.stringValue ?? "queued",
            requested: result["requested"]?.intValue
                ?? result["count"]?.intValue
                ?? items.count,
            processed: result["processed"]?.intValue ?? 0,
            live: result["live"]?.intValue ?? 0,
            failed: result["failed"]?.intValue ?? 0,
            remaining: result["remaining"]?.intValue
                ?? result["count"]?.intValue
                ?? items.count,
            concurrency: result["concurrency"]?.intValue ?? 1,
            startedAt: result["startedAt"]?.stringValue ?? "",
            completedAt: result["completedAt"]?.stringValue ?? "",
            items: items
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
