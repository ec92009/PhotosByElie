import Foundation

public enum VisualRepairDefectCategory: String, Codable, CaseIterable, Identifiable, Sendable {
    case lightingExposure = "lighting-exposure"
    case contrast
    case whiteBalanceColor = "white-balance-color"
    case perspectiveGeometry = "perspective-geometry"
    case distractingItems = "distracting-items"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .lightingExposure: "Lighting / exposure"
        case .contrast: "Contrast"
        case .whiteBalanceColor: "White balance / color"
        case .perspectiveGeometry: "Perspective / geometry"
        case .distractingItems: "Distracting items"
        }
    }
}

public enum VisualRepairProposalStatus: String, Codable, Sendable {
    case draft
    case accepted
    case rejected
    case superseded

    public var isComparable: Bool {
        self == .draft || self == .accepted
    }
}

public enum VisualRepairDecision: String, Codable, Sendable {
    case accept
    case reject
    case regenerate
}

public struct VisualRepairModelLadderRung: Codable, Equatable, Sendable {
    public var model: String
    public var effort: String
    public var vision: Bool

    public init(model: String, effort: String, vision: Bool = true) {
        self.model = model
        self.effort = effort
        self.vision = vision
    }

    init(json: [String: JSONValue]) {
        model = json["model"]?.stringValue ?? ""
        effort = json["effort"]?.stringValue ?? ""
        vision = json["vision"]?.boolValue ?? true
    }
}

public struct VisualRepairProposal: Identifiable, Codable, Equatable, Sendable {
    public var id: String
    public var fixtureID: String
    public var assetID: String
    public var sourceVersionID: String
    public var defectCategories: [VisualRepairDefectCategory]
    public var ladderRung: Int
    public var modelLadder: [VisualRepairModelLadderRung]
    public var requestedGeneratorModel: String
    public var resolvedModel: String
    public var reasoningEffort: String
    public var vision: Bool
    public var attempt: Int
    public var status: VisualRepairProposalStatus
    public var originalReference: String
    public var originalPreviewReference: String
    public var originalPreviewSHA256: String
    public var derivedReference: String
    public var derivedAvailable: Bool
    public var derivedSHA256: String
    public var generatorReference: String
    public var previousProposalID: String
    public var decisionReason: String
    public var generatedAt: String
    public var materializedAt: String
    public var createdAt: String
    public var updatedAt: String
    public var decidedAt: String
    public var idempotentReplay: Bool
    public var readOnlyComparison: Bool

    public init(
        id: String,
        fixtureID: String,
        assetID: String,
        sourceVersionID: String,
        defectCategories: [VisualRepairDefectCategory],
        ladderRung: Int,
        modelLadder: [VisualRepairModelLadderRung],
        requestedGeneratorModel: String,
        resolvedModel: String,
        reasoningEffort: String,
        vision: Bool,
        attempt: Int,
        status: VisualRepairProposalStatus,
        originalReference: String,
        originalPreviewReference: String = "",
        originalPreviewSHA256: String = "",
        derivedReference: String,
        derivedAvailable: Bool,
        derivedSHA256: String = "",
        generatorReference: String,
        previousProposalID: String = "",
        decisionReason: String = "",
        generatedAt: String = "",
        materializedAt: String = "",
        createdAt: String = "",
        updatedAt: String = "",
        decidedAt: String = "",
        idempotentReplay: Bool = false,
        readOnlyComparison: Bool = true
    ) {
        self.id = id
        self.fixtureID = fixtureID
        self.assetID = assetID
        self.sourceVersionID = sourceVersionID
        self.defectCategories = defectCategories
        self.ladderRung = ladderRung
        self.modelLadder = modelLadder
        self.requestedGeneratorModel = requestedGeneratorModel
        self.resolvedModel = resolvedModel
        self.reasoningEffort = reasoningEffort
        self.vision = vision
        self.attempt = attempt
        self.status = status
        self.originalReference = originalReference
        self.originalPreviewReference = originalPreviewReference
        self.originalPreviewSHA256 = originalPreviewSHA256
        self.derivedReference = derivedReference
        self.derivedAvailable = derivedAvailable
        self.derivedSHA256 = derivedSHA256
        self.generatorReference = generatorReference
        self.previousProposalID = previousProposalID
        self.decisionReason = decisionReason
        self.generatedAt = generatedAt
        self.materializedAt = materializedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.decidedAt = decidedAt
        self.idempotentReplay = idempotentReplay
        self.readOnlyComparison = readOnlyComparison
    }

    init(json: [String: JSONValue]) {
        id = json["proposalId"]?.stringValue ?? ""
        fixtureID = json["fixtureId"]?.stringValue ?? ""
        assetID = json["assetId"]?.stringValue ?? ""
        sourceVersionID = json["sourceVersionId"]?.stringValue ?? ""
        defectCategories = (json["defectCategories"]?.arrayValue ?? [])
            .compactMap { $0.stringValue }
            .compactMap(VisualRepairDefectCategory.init(rawValue:))
        ladderRung = json["ladderRung"]?.intValue ?? 0
        modelLadder = (json["modelLadder"]?.arrayValue ?? [])
            .compactMap { $0.objectValue }
            .map(VisualRepairModelLadderRung.init(json:))
        requestedGeneratorModel = json["requestedGeneratorModel"]?.stringValue ?? ""
        resolvedModel = json["resolvedModel"]?.stringValue ?? ""
        reasoningEffort = json["reasoningEffort"]?.stringValue ?? ""
        vision = json["vision"]?.boolValue ?? false
        attempt = json["attempt"]?.intValue ?? 0
        status = VisualRepairProposalStatus(
            rawValue: json["status"]?.stringValue ?? "draft"
        ) ?? .draft
        originalReference = json["originalReference"]?.stringValue ?? ""
        originalPreviewReference = json["originalPreviewReference"]?.stringValue ?? ""
        originalPreviewSHA256 = json["originalPreviewSha256"]?.stringValue ?? ""
        derivedReference = json["derivedReference"]?.stringValue ?? ""
        derivedAvailable = json["derivedAvailable"]?.boolValue ?? false
        derivedSHA256 = json["derivedSha256"]?.stringValue ?? ""
        generatorReference = json["generatorReference"]?.stringValue ?? ""
        previousProposalID = json["previousProposalId"]?.stringValue ?? ""
        decisionReason = json["decisionReason"]?.stringValue ?? ""
        generatedAt = json["generatedAt"]?.stringValue ?? ""
        materializedAt = json["materializedAt"]?.stringValue ?? ""
        createdAt = json["createdAt"]?.stringValue ?? ""
        updatedAt = json["updatedAt"]?.stringValue ?? ""
        decidedAt = json["decidedAt"]?.stringValue ?? ""
        idempotentReplay = json["idempotentReplay"]?.boolValue ?? false
        readOnlyComparison = json["readOnlyComparison"]?.boolValue ?? true
    }
}

public enum VisualRepairScope {
    public static func isREReview(path: [FixtureNode]) -> Bool {
        guard let root = path.first else { return false }
        let template = root.templateKey
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "-")
        let name = root.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let tags = Set(root.tags.map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
                .replacingOccurrences(of: "_", with: "-")
        })
        return ["re", "real-estate", "real estate"].contains(template)
            || ["re", "real estate"].contains(name)
            || !tags.isDisjoint(with: ["re", "real-estate", "real estate"])
    }
}

public struct VisualRepairComparisonState: Equatable, Sendable {
    public var originalReference: String
    public var proposalID: String
    public var proposedReference: String
    public var status: VisualRepairProposalStatus?
    public var message: String
    public let isReadOnly = true

    public var proposalAvailable: Bool {
        guard let status, status.isComparable else { return false }
        return !proposalID.isEmpty && !proposedReference.isEmpty
    }

    public init(
        originalReference: String,
        proposal: VisualRepairProposal? = nil,
        proposedImageAvailable: Bool? = nil
    ) {
        self.originalReference = originalReference
        proposalID = proposal?.id ?? ""
        let referenceAvailable = proposal.map {
            $0.derivedAvailable
                && Self.isRenderableReference($0.derivedReference)
        } ?? false
        let imageAvailable = proposedImageAvailable ?? referenceAvailable
        proposedReference = imageAvailable
            ? proposal?.derivedReference ?? ""
            : ""
        status = proposal?.status
        let comparable = proposal?.status.isComparable == true
            && !proposalID.isEmpty
            && !proposedReference.isEmpty
        if comparable {
            message = "Original and proposed visual draft are available for read-only comparison."
        } else if proposal?.status == .rejected || proposal?.status == .superseded {
            message = "This visual draft is unavailable; the immutable original remains unchanged."
        } else {
            message = "No visual draft is available. Production visual generation is not configured."
        }
    }

    public static func isRenderableReference(_ reference: String) -> Bool {
        guard let url = URL(string: reference), url.isFileURL, !url.path.isEmpty else {
            return false
        }
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let fileType = attributes[.type] as? FileAttributeType
        else {
            return false
        }
        return fileType == .typeRegular
    }
}

public actor VisualRepairProposalService {
    private let runner: OwnerActionRunner
    private let connectorIdentity: any OwnerConnectorIdentifying

    public init(
        runner: OwnerActionRunner,
        connectorIdentity: any OwnerConnectorIdentifying = StaticOwnerConnectorIdentity("max")
    ) {
        self.runner = runner
        self.connectorIdentity = connectorIdentity
    }

    public func proposals(
        fixtureID: String,
        assetIDs: [String] = [],
        includeHistory: Bool = false
    ) async throws -> [VisualRepairProposal] {
        let result = try await run("fixture-visual-repair-proposal-list", extra: [
            "fixtureId": .string(fixtureID),
            "assetIds": .array(assetIDs.map(JSONValue.string)),
            "includeHistory": .bool(includeHistory),
        ])
        return result["visualRepairProposals"]?.objectValue?["items"]?.arrayValue?
            .compactMap { $0.objectValue }
            .map(VisualRepairProposal.init(json:)) ?? []
    }

    public func request(
        fixtureID: String,
        assetID: String,
        sourceVersionID: String,
        categories: [VisualRepairDefectCategory],
        requestedGeneratorModel: String = "",
        generator: String = "",
        idempotencyKey: String = UUID().uuidString
    ) async throws -> VisualRepairProposal {
        let result = try await run("fixture-visual-repair-proposal-request", extra: [
            "fixtureId": .string(fixtureID),
            "assetId": .string(assetID),
            "sourceVersionId": .string(sourceVersionID),
            "defectCategories": .array(categories.map { .string($0.rawValue) }),
            "requestedGeneratorModel": .string(requestedGeneratorModel),
            "generator": .string(generator),
            "idempotencyKey": .string(idempotencyKey),
        ])
        return VisualRepairProposal(
            json: result["visualRepairProposal"]?.objectValue ?? [:]
        )
    }

    public func decide(
        _ decision: VisualRepairDecision,
        fixtureID: String,
        proposalID: String,
        reason: String = "",
        generator: String = "",
        idempotencyKey: String = UUID().uuidString
    ) async throws -> VisualRepairProposal {
        let result = try await run("fixture-visual-repair-proposal-decide", extra: [
            "fixtureId": .string(fixtureID),
            "proposalId": .string(proposalID),
            "decision": .string(decision.rawValue),
            "reason": .string(reason),
            "generator": .string(generator),
            "idempotencyKey": .string(idempotencyKey),
        ])
        return VisualRepairProposal(
            json: result["visualRepairProposal"]?.objectValue ?? [:]
        )
    }

    private func run(
        _ mode: String,
        extra: [String: JSONValue]
    ) async throws -> [String: JSONValue] {
        var manifest = extra
        manifest["mode"] = .string(mode)
        manifest["includePreviews"] = .bool(false)
        manifest["launchWorkspace"] = .bool(false)
        let connectorID = await connectorIdentity.connectorID()
        let action = OwnerActionCreate(
            actionKind: "sidecar-culling-review",
            target: connectorID,
            payload: [
                "workflow": "universal-fixture-pipeline",
                "manifest": .object(manifest),
                "requestedConnector": .string(connectorID),
                "queuedAt": .string(ISO8601DateFormatter().string(from: Date())),
            ]
        )
        let completed = try await runner.submit(
            action,
            idempotencyKey: ["native-visual-repair", mode, UUID().uuidString].joined(separator: "-")
        )
        guard let result = completed.result else {
            throw APIErrorEnvelope(error: .init(
                code: "visual_repair_result_missing",
                message: "The connector completed without a visual repair result."
            ))
        }
        return result
    }
}

public extension FixtureReviewItem {
    var visualAIReasons: [String] {
        guard visualAIRequest["sourceVersionId"]?.stringValue == sourceVersionID else { return [] }
        return visualAIRequest["reasons"]?.arrayValue?.compactMap(\.stringValue) ?? []
    }

    var reviewStatusLabel: String {
        guard !visualAIReasons.isEmpty else { return workflowStage.label }
        return editorialState == "requesting-ai" ? "Visual + title/keyword AI requested" : "Visual AI requested"
    }

}
