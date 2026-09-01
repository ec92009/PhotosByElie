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
    public var catalogState: String
    public var errorText: String

    public var workflowStage: AssetWorkflowStage {
        let cleanCatalog = catalogState.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if cleanCatalog == "live" { return .live }
        if ["pending", "local"].contains(cleanCatalog) { return .publishing }
        let cleanStatus = status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if ["live", "verified", "uploaded"].contains(cleanStatus) {
            return .fullResolutionUploaded
        }
        if cleanStatus == "uploading" || cleanStatus == "running" { return .uploading }
        return .needsUpload
    }
}

public struct NativeUploadPlanItem: Identifiable, Sendable, Equatable {
    public var id: String { assetID }
    public var keywordsText: String { keywords.joined(separator: ", ") }
    public var assetID: String
    public var photoLibraryIdentifier: String
    public var title: String
    public var keywords: [String]
    public var filename: String
    public var capturedAt: String
    public var mediaType: String
    public var pixelWidth: Int
    public var pixelHeight: Int
    public var originalByteCount: Int64
    public var deliveryState: String
    public var errorText: String
    public var cameraBody: String
    public var lens: String
    public var focalLength: String

    public var workflowStage: AssetWorkflowStage {
        AssetWorkflowStage.resolve(
            placementState: "picked",
            editorialState: "approved",
            deliveryState: deliveryState
        )
    }

    public init(
        assetID: String,
        photoLibraryIdentifier: String,
        title: String,
        keywords: [String],
        filename: String,
        capturedAt: String,
        mediaType: String = "photo",
        pixelWidth: Int = 0,
        pixelHeight: Int = 0,
        originalByteCount: Int64 = 0,
        deliveryState: String,
        errorText: String,
        cameraBody: String = "",
        lens: String = "",
        focalLength: String = ""
    ) {
        self.assetID = assetID
        self.photoLibraryIdentifier = photoLibraryIdentifier
        self.title = title
        self.keywords = keywords
        self.filename = filename
        self.capturedAt = capturedAt
        self.mediaType = mediaType
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.originalByteCount = originalByteCount
        self.deliveryState = deliveryState
        self.errorText = errorText
        self.cameraBody = cameraBody
        self.lens = lens
        self.focalLength = focalLength
    }
}

public enum NativeUploadPlanOrder: String, Sendable, CaseIterable, Equatable {
    case oldest
    case recent

    public var label: String {
        switch self {
        case .oldest: "oldest eligible"
        case .recent: "recent approvals"
        }
    }

    public var alternateLabel: String {
        switch self {
        case .oldest: "Show recent approvals"
        case .recent: "Show oldest queue"
        }
    }
}

public struct NativeUploadPlan: Sendable, Equatable {
    public var fixtureID: String
    public var fixtureName: String
    public var cloudAllowed: Bool
    public var pickedCount: Int
    public var approvedCount: Int
    public var needsReviewCount: Int
    public var needsUploadCount: Int
    public var mediaUploadedCount: Int
    public var projectionPendingCount: Int
    public var projectionFailedCount: Int
    public var deploymentPendingCount: Int
    public var deploymentFailedCount: Int
    public var liveOnWebsiteCount: Int
    public var liveCount: Int
    public var order: NativeUploadPlanOrder
    public var offset: Int
    public var limit: Int
    public var hasNext: Bool
    public var items: [NativeUploadPlanItem]

    /// Mutually exclusive owner-facing stages. The raw receipt counters remain
    /// available for diagnostics, but these are the counts presented as the
    /// workflow so parent totals are not mistaken for additional states.
    public var publishingCount: Int {
        max(0, projectionPendingCount) + max(0, deploymentPendingCount)
    }

    public var fullResolutionUploadedCount: Int {
        max(0, mediaUploadedCount - publishingCount - liveOnWebsiteCount)
    }

    public var approvedOnlyCount: Int {
        max(0, approvedCount - needsUploadCount - mediaUploadedCount)
    }

    public var failedHealthCount: Int {
        max(0, projectionFailedCount) + max(0, deploymentFailedCount)
    }

    public init(
        fixtureID: String,
        fixtureName: String,
        cloudAllowed: Bool,
        pickedCount: Int,
        approvedCount: Int,
        needsReviewCount: Int,
        needsUploadCount: Int,
        liveCount: Int,
        mediaUploadedCount: Int = 0,
        projectionPendingCount: Int = 0,
        projectionFailedCount: Int = 0,
        deploymentPendingCount: Int = 0,
        deploymentFailedCount: Int = 0,
        liveOnWebsiteCount: Int? = nil,
        order: NativeUploadPlanOrder = .oldest,
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
        self.mediaUploadedCount = mediaUploadedCount
        self.projectionPendingCount = projectionPendingCount
        self.projectionFailedCount = projectionFailedCount
        self.deploymentPendingCount = deploymentPendingCount
        self.deploymentFailedCount = deploymentFailedCount
        self.liveOnWebsiteCount = liveOnWebsiteCount ?? liveCount
        self.liveCount = liveOnWebsiteCount ?? liveCount
        self.order = order
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
    public var lastError: String
    public var cancelRequested: Bool
    public var items: [NativeUploadRunItem]

    public var isFinished: Bool {
        ["completed", "completed-with-errors", "failed", "cancelled"].contains(status)
    }
}

public struct NativeUploadRecoveryReport: Sendable, Equatable {
    public var completedZeroCount: Int
    public var failedReceiptCount: Int
    public var needsReviewCount: Int
    public var latestFailedRun: NativeUploadRun?
}

public struct NativeCatalogRecoveryPlan: Sendable, Equatable {
    public var fixtureID: String
    public var candidateCount: Int
    public var recoverableCount: Int
    public var blockedCount: Int
    public var retryableFailureCount: Int
    public var batchLimit: Int
}

public struct PublicCatalogDeploymentReport: Sendable, Equatable {
    public var state: String
    public var pushed: Bool
    public var commitSHA: String
    public var deploymentID: String
    public var projectionRevision: Int
    public var projectionSHA256: String
    public var remoteSHA256: String
    public var mediaCount: Int
    public var publicURL: String
    public var verifiedAt: String
    public var attempts: Int
    public var errorText: String

    public var isVerified: Bool { state == "verified" }
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
    public var status: String
    public var stage: String
    public var requested: Int
    public var scanned: Int
    public var protected: Int
    public var quarantined: Int
    public var restored: Int
    public var eligibleDelete: Int
    public var deleted: Int
    public var remaining: Int
    public var cancelRequested: Bool
    public var errorText: String
    public var items: [R2ReconciliationItem]

    public var isFinished: Bool {
        ["completed", "failed", "cancelled"].contains(status)
    }
}

public struct R2ReconciliationRecoveryReport: Sendable, Equatable {
    public var activeCount: Int
    public var recoveredCancelledCount: Int
    public var recoveredFailedCount: Int
    public var latestRun: R2ReconciliationReport?
}

public struct PhotosSyncReport: Sendable, Equatable {
    public var runID: String
    public var status: String
    public var stage: String
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
    public var remaining: Int
    public var elapsedSeconds: Double
    public var cancelRequested: Bool
    public var errorText: String

    public var isFinished: Bool {
        ["completed", "failed", "cancelled"].contains(status)
    }
}

public enum FixtureDeliveryError: Error, Sendable, Equatable {
    case missingResult(String)
    case emptySelection
}

public actor FixtureDeliveryService {
    private let runner: OwnerActionRunner
    private let connectorID: String
    private let sourceStore: OwnerAssetSourceSQLiteStore?

    public init(
        runner: OwnerActionRunner,
        connectorID: String = "max",
        nativeDatabaseURL: URL? = OwnerReviewDatabaseLocator().resolve()
    ) {
        self.runner = runner
        self.connectorID = connectorID
        self.sourceStore = nativeDatabaseURL.map {
            OwnerAssetSourceSQLiteStore(databaseURL: $0)
        }
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

    public func nativeCatalogRecoveryPlan(
        fixtureID: String
    ) async throws -> NativeCatalogRecoveryPlan {
        let action = try await fixtureAction(
            mode: "asset-catalog-recovery-plan",
            fixtureID: fixtureID
        )
        guard let plan = action.result?["catalogRecoveryPlan"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("catalogRecoveryPlan")
        }
        return NativeCatalogRecoveryPlan(
            fixtureID: plan["fixtureId"]?.stringValue ?? fixtureID,
            candidateCount: plan["candidateCount"]?.intValue ?? 0,
            recoverableCount: plan["recoverableCount"]?.intValue ?? 0,
            blockedCount: plan["blockedCount"]?.intValue ?? 0,
            retryableFailureCount: plan["retryableFailureCount"]?.intValue ?? 0,
            batchLimit: plan["batchLimit"]?.intValue ?? 50
        )
    }

    public func startNativeCatalogRecovery(
        fixtureID: String,
        limit: Int = 50,
        concurrency: Int = 4
    ) async throws -> NativeUploadRun {
        let action = try await fixtureAction(
            mode: "asset-catalog-recovery-run-start",
            fixtureID: fixtureID,
            extra: [
                "limit": .number(Double(max(1, min(50, limit)))),
                "concurrency": .number(Double(max(1, min(8, concurrency)))),
            ]
        )
        return try decodeNativeUploadRun(action)
    }

    public func nativeUploadPlan(
        fixtureID: String,
        offset: Int = 0,
        limit: Int = 200,
        order: NativeUploadPlanOrder = .oldest
    ) async throws -> NativeUploadPlan {
        let action = try await fixtureAction(
            mode: "asset-upload-plan",
            fixtureID: fixtureID,
            extra: [
                "offset": .number(Double(max(0, offset))),
                "limit": .number(Double(max(1, min(500, limit)))),
                "order": .string(order.rawValue),
            ]
        )
        guard let plan = action.result?["uploadPlan"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("uploadPlan")
        }
        let rawItems = plan["items"]?.arrayValue ?? []
        let assetIDs = rawItems.compactMap { $0.objectValue?["assetId"]?.stringValue }
        let sourceMetadata = (try? sourceStore?.metadata(assetIDs: assetIDs)) ?? [:]
        let items = rawItems.compactMap { value -> NativeUploadPlanItem? in
            guard let object = value.objectValue else { return nil }
            let assetID = object["assetId"]?.stringValue ?? ""
            guard !assetID.isEmpty else { return nil }
            let source = sourceMetadata[assetID]
            return NativeUploadPlanItem(
                assetID: assetID,
                photoLibraryIdentifier: object["photoLibraryIdentifier"]?.stringValue ?? assetID,
                title: object["title"]?.stringValue ?? "",
                keywords: object["keywords"]?.arrayValue?.compactMap(\.stringValue) ?? [],
                filename: object["filename"]?.stringValue ?? "",
                capturedAt: object["capturedAt"]?.stringValue ?? "",
                mediaType: source?.mediaType ?? object["mediaType"]?.stringValue ?? "photo",
                pixelWidth: source?.pixelWidth ?? object["pixelWidth"]?.intValue ?? 0,
                pixelHeight: source?.pixelHeight ?? object["pixelHeight"]?.intValue ?? 0,
                originalByteCount: source?.originalByteCount
                    ?? Int64(object["originalByteCount"]?.intValue ?? 0),
                deliveryState: object["deliveryState"]?.stringValue ?? "needs-upload",
                errorText: object["errorText"]?.stringValue ?? "",
                cameraBody: source?.cameraBody ?? object["cameraBody"]?.stringValue ?? "",
                lens: source?.lens ?? object["lens"]?.stringValue ?? "",
                focalLength: source?.focalLength ?? object["focalLength"]?.stringValue ?? ""
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
            mediaUploadedCount: plan["mediaUploadedCount"]?.intValue ?? 0,
            projectionPendingCount: plan["projectionPendingCount"]?.intValue ?? 0,
            projectionFailedCount: plan["projectionFailedCount"]?.intValue ?? 0,
            deploymentPendingCount: plan["deploymentPendingCount"]?.intValue ?? 0,
            deploymentFailedCount: plan["deploymentFailedCount"]?.intValue ?? 0,
            liveOnWebsiteCount: plan["liveOnWebsiteCount"]?.intValue,
            order: NativeUploadPlanOrder(
                rawValue: plan["order"]?.stringValue ?? NativeUploadPlanOrder.oldest.rawValue
            ) ?? .oldest,
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

    public func recoverNativeUploadRuns() async throws -> NativeUploadRecoveryReport {
        let action = try await fixtureAction(
            mode: "asset-upload-run-recover",
            fixtureID: ""
        )
        guard let recovery = action.result?["uploadRecovery"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("uploadRecovery")
        }
        let latest = recovery["latestFailedRun"]?.objectValue
        return NativeUploadRecoveryReport(
            completedZeroCount: recovery["completedZeroCount"]?.intValue ?? 0,
            failedReceiptCount: recovery["failedReceiptCount"]?.intValue ?? 0,
            needsReviewCount: recovery["needsReviewCount"]?.intValue ?? 0,
            latestFailedRun: latest.map { nativeUploadRun(from: $0) }
        )
    }

    public func deployPublicCatalog() async throws -> PublicCatalogDeploymentReport {
        let action = try await fixtureAction(
            mode: "public-catalog-deploy",
            fixtureID: ""
        )
        guard let deployment = action.result?["catalogDeployment"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("catalogDeployment")
        }
        return PublicCatalogDeploymentReport(
            state: deployment["state"]?.stringValue ?? "failed",
            pushed: deployment["pushed"]?.boolValue ?? false,
            commitSHA: deployment["commitSha"]?.stringValue ?? "",
            deploymentID: deployment["deploymentId"]?.stringValue ?? "",
            projectionRevision: deployment["projectionRevision"]?.intValue ?? 0,
            projectionSHA256: deployment["projectionSha256"]?.stringValue ?? "",
            remoteSHA256: deployment["remoteSha256"]?.stringValue ?? "",
            mediaCount: deployment["mediaCount"]?.intValue ?? 0,
            publicURL: deployment["publicUrl"]?.stringValue ?? "",
            verifiedAt: deployment["verifiedAt"]?.stringValue ?? "",
            attempts: deployment["attempts"]?.intValue ?? 0,
            errorText: deployment["error"]?.stringValue ?? ""
        )
    }

    public func cancelNativeUpload(runID: String) async throws -> NativeUploadRun {
        let action = try await runAction(
            mode: "asset-upload-run-cancel",
            runID: runID
        )
        return try decodeNativeUploadRun(action)
    }

    public func resumeNativeUpload(runID: String) async throws -> NativeUploadRun {
        let action = try await runAction(
            mode: "asset-upload-run-resume",
            runID: runID
        )
        return try decodeNativeUploadRun(action)
    }

    public func startR2Reconciliation(commit: Bool = false) async throws -> R2ReconciliationReport {
        let action = try await fixtureAction(
            mode: "r2-reconciliation-run-start",
            fixtureID: "",
            extra: ["commit": .bool(commit)]
        )
        return try decodeR2Reconciliation(action, commit: commit)
    }

    public func r2ReconciliationStatus(runID: String) async throws -> R2ReconciliationReport {
        let action = try await runAction(mode: "r2-reconciliation-run-status", runID: runID)
        return try decodeR2Reconciliation(action, commit: false)
    }

    public func cancelR2Reconciliation(runID: String) async throws -> R2ReconciliationReport {
        let action = try await runAction(mode: "r2-reconciliation-run-cancel", runID: runID)
        return try decodeR2Reconciliation(action, commit: false)
    }

    public func recoverR2ReconciliationRuns() async throws -> R2ReconciliationRecoveryReport {
        let action = try await fixtureAction(
            mode: "r2-reconciliation-run-recover",
            fixtureID: ""
        )
        guard let recovery = action.result?["reconciliationRecovery"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("reconciliationRecovery")
        }
        return R2ReconciliationRecoveryReport(
            activeCount: recovery["activeCount"]?.intValue ?? 0,
            recoveredCancelledCount: recovery["recoveredCancelledCount"]?.intValue ?? 0,
            recoveredFailedCount: recovery["recoveredFailedCount"]?.intValue ?? 0,
            latestRun: recovery["latestRun"]?.objectValue.map {
                r2Reconciliation(from: $0, commit: false)
            }
        )
    }

    public func r2Reconciliation(commit: Bool = false) async throws -> R2ReconciliationReport {
        let action = try await fixtureAction(
            mode: commit ? "r2-reconciliation-commit" : "r2-reconciliation-plan",
            fixtureID: ""
        )
        return try decodeR2Reconciliation(action, commit: commit)
    }

    private func decodeR2Reconciliation(
        _ action: OwnerAction,
        commit: Bool
    ) throws -> R2ReconciliationReport {
        guard let result = action.result?["reconciliation"]?.objectValue else {
            throw FixtureDeliveryError.missingResult("reconciliation")
        }
        return r2Reconciliation(from: result, commit: commit)
    }

    private func r2Reconciliation(
        from result: [String: JSONValue],
        commit: Bool
    ) -> R2ReconciliationReport {
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
            status: result["status"]?.stringValue ?? "completed",
            stage: result["stage"]?.stringValue ?? "Completed",
            requested: result["requested"]?.intValue
                ?? result["scanned"]?.intValue
                ?? items.count,
            scanned: result["scanned"]?.intValue ?? items.count,
            protected: result["protected"]?.intValue ?? 0,
            quarantined: result["quarantined"]?.intValue ?? 0,
            restored: result["restored"]?.intValue ?? 0,
            eligibleDelete: result["eligibleDelete"]?.intValue ?? 0,
            deleted: result["deleted"]?.intValue ?? 0,
            remaining: result["remaining"]?.intValue ?? 0,
            cancelRequested: result["cancelRequested"]?.boolValue ?? false,
            errorText: result["error"]?.stringValue ?? "",
            items: items
        )
    }

    public func startPhotosSync(limit: Int = 25) async throws -> PhotosSyncReport {
        let action = try await fixtureAction(
            mode: "photos-sync-run-start",
            fixtureID: "",
            extra: ["limit": .number(Double(max(1, min(limit, 50))))]
        )
        return try decodePhotosSync(action)
    }

    public func photosSyncStatus(runID: String) async throws -> PhotosSyncReport {
        let action = try await runAction(mode: "photos-sync-run-status", runID: runID)
        return try decodePhotosSync(action)
    }

    public func cancelPhotosSync(runID: String) async throws -> PhotosSyncReport {
        let action = try await runAction(mode: "photos-sync-run-cancel", runID: runID)
        return try decodePhotosSync(action)
    }

    public func syncPhotos(limit: Int = 25) async throws -> PhotosSyncReport {
        let action = try await fixtureAction(
            mode: "photos-sync-run",
            fixtureID: "",
            extra: ["limit": .number(Double(max(1, min(limit, 50))))]
        )
        return try decodePhotosSync(action)
    }

    private func decodePhotosSync(_ action: OwnerAction) throws -> PhotosSyncReport {
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
            runID: result["runId"]?.stringValue ?? "",
            status: result["status"]?.stringValue ?? "completed",
            stage: result["stage"]?.stringValue ?? "Completed",
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
            remaining: result["remaining"]?.intValue ?? 0,
            elapsedSeconds: elapsedSeconds,
            cancelRequested: result["cancelRequested"]?.boolValue ?? false,
            errorText: result["error"]?.stringValue ?? ""
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
        return nativeUploadRun(from: result)
    }

    private func nativeUploadRun(from result: [String: JSONValue]) -> NativeUploadRun {
        let items = (result["items"]?.arrayValue ?? []).compactMap { value -> NativeUploadRunItem? in
            guard let item = value.objectValue,
                  let assetID = item["asset_id"]?.stringValue ?? item["assetId"]?.stringValue
            else { return nil }
            return NativeUploadRunItem(
                assetID: assetID,
                status: item["status"]?.stringValue ?? "",
                catalogState: item["catalog_state"]?.stringValue
                    ?? item["catalogState"]?.stringValue
                    ?? "not-applicable",
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
            lastError: result["lastError"]?.stringValue ?? "",
            cancelRequested: result["cancelRequested"]?.boolValue ?? false,
            items: items
        )
    }

    private func runAction(mode: String, runID: String) async throws -> OwnerAction {
        let cleanedRunID = runID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanedRunID.isEmpty else {
            throw FixtureDeliveryError.missingResult("runID")
        }
        return try await fixtureAction(
            mode: mode,
            fixtureID: "",
            extra: ["runId": .string(cleanedRunID)]
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
