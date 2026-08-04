import Foundation

public struct MetadataModelLadderRung: Codable, Identifiable, Sendable, Equatable {
    public var alias: String
    public var label: String
    public var resolvedModel: String
    public var reasoningEffort: String
    public var vision: Bool
    public var estimatedCost: String

    public var id: String { alias }

    public init(
        alias: String,
        label: String,
        resolvedModel: String,
        reasoningEffort: String,
        vision: Bool,
        estimatedCost: String
    ) {
        self.alias = alias
        self.label = label
        self.resolvedModel = resolvedModel
        self.reasoningEffort = reasoningEffort
        self.vision = vision
        self.estimatedCost = estimatedCost
    }

    public static let catalog: [MetadataModelLadderRung] = [
        MetadataModelLadderRung(
            alias: "codex-gpt-5.4-mini",
            label: "Free",
            resolvedModel: "gpt-5.4-mini",
            reasoningEffort: "low",
            vision: false,
            estimatedCost: "Lowest-cost OpenAI rung"
        ),
        MetadataModelLadderRung(
            alias: "codex-gpt-5.6-luna-xhigh-vision",
            label: "Luna XHigh vision",
            resolvedModel: "gpt-5.6-luna",
            reasoningEffort: "xhigh",
            vision: true,
            estimatedCost: "Higher: xhigh + image"
        ),
        MetadataModelLadderRung(
            alias: "codex-gpt-5.6-sol-high-vision",
            label: "Sol High vision",
            resolvedModel: "gpt-5.6-sol",
            reasoningEffort: "high",
            vision: true,
            estimatedCost: "High: high + image"
        ),
    ]

    public static let defaultLadder: [MetadataModelLadderRung] = catalog

    enum CodingKeys: String, CodingKey {
        case alias, label
        case resolvedModel = "resolved_model"
        case reasoningEffort = "reasoning_effort"
        case vision
        case estimatedCost = "estimated_cost"
    }
}

public struct MetadataProposalGenerator: Codable, Sendable, Equatable {
    public var model: String
    public var modelLevel: Int?
    public var modelMaxed: Bool
    public var modelLadder: [String]
    public var label: String?
    public var resolvedModel: String?
    public var reasoningEffort: String?
    public var vision: Bool?
    public var estimatedCost: String?

    public init(
        model: String,
        modelLevel: Int? = nil,
        modelMaxed: Bool = false,
        modelLadder: [String] = [],
        label: String? = nil,
        resolvedModel: String? = nil,
        reasoningEffort: String? = nil,
        vision: Bool? = nil,
        estimatedCost: String? = nil
    ) {
        self.model = model
        self.modelLevel = modelLevel
        self.modelMaxed = modelMaxed
        self.modelLadder = modelLadder
        self.label = label
        self.resolvedModel = resolvedModel
        self.reasoningEffort = reasoningEffort
        self.vision = vision
        self.estimatedCost = estimatedCost
    }

    enum CodingKeys: String, CodingKey {
        case model
        case modelLevel = "model_level"
        case modelMaxed = "model_maxed"
        case modelLadder = "model_ladder"
        case label
        case resolvedModel = "resolved_model"
        case reasoningEffort = "reasoning_effort"
        case vision
        case estimatedCost = "estimated_cost"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        model = try container.decodeIfPresent(String.self, forKey: .model) ?? ""
        modelLevel = try container.decodeIfPresent(Int.self, forKey: .modelLevel)
        modelMaxed = try container.decodeIfPresent(Bool.self, forKey: .modelMaxed) ?? false
        modelLadder = try container.decodeIfPresent([String].self, forKey: .modelLadder) ?? []
        label = try container.decodeIfPresent(String.self, forKey: .label)
        resolvedModel = try container.decodeIfPresent(String.self, forKey: .resolvedModel)
        reasoningEffort = try container.decodeIfPresent(String.self, forKey: .reasoningEffort)
        vision = try container.decodeIfPresent(Bool.self, forKey: .vision)
        estimatedCost = try container.decodeIfPresent(String.self, forKey: .estimatedCost)
    }
}

public struct MetadataProposalState: Codable, Sendable, Equatable {
    public var proposalAttempt: Int?
    public var reworkRequested: Bool?
    public var requestedGenerator: MetadataProposalGenerator?
    public var previousGenerator: MetadataProposalGenerator?
    public var modelAttempts: Int?
    public var modelPreviewPath: String?

    enum CodingKeys: String, CodingKey {
        case proposalAttempt = "proposal_attempt"
        case reworkRequested = "rework_requested"
        case requestedGenerator = "requested_generator"
        case previousGenerator = "previous_generator"
        case modelAttempts = "model_attempts"
        case modelPreviewPath = "model_preview_path"
    }
}

public struct MetadataProposalQueue: Codable, Sendable, Equatable {
    public var batchId: String
    public var photos: [MetadataProposal]
    public var modelLadder: [String]?
    public var modelCatalog: [MetadataModelLadderRung]?

    enum CodingKeys: String, CodingKey {
        case batchId = "batch_id"
        case photos
        case modelLadder = "model_ladder"
        case modelCatalog = "model_catalog"
    }
}

public struct MetadataProposal: Codable, Identifiable, Sendable, Equatable {
    public struct Values: Codable, Sendable, Equatable {
        public var title: String
        public var keywords: [String]
        public var reason: String?
        public var confidence: String?
        public var generator: MetadataProposalGenerator?

        public init(
            title: String,
            keywords: [String],
            reason: String? = nil,
            confidence: String? = nil,
            generator: MetadataProposalGenerator? = nil
        ) {
            self.title = title
            self.keywords = keywords
            self.reason = reason
            self.confidence = confidence
            self.generator = generator
        }

        enum CodingKeys: String, CodingKey {
            case title, keywords, reason, confidence, generator
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            title = try container.decode(String.self, forKey: .title)
            keywords = try container.decodeIfPresent([String].self, forKey: .keywords) ?? []
            reason = try container.decodeIfPresent(String.self, forKey: .reason)
            if let text = try? container.decode(String.self, forKey: .confidence) {
                confidence = text
            } else if let number = try? container.decode(Double.self, forKey: .confidence) {
                confidence = String(number)
            } else {
                confidence = nil
            }
            generator = try container.decodeIfPresent(MetadataProposalGenerator.self, forKey: .generator)
        }
    }

    public var photoId: String
    public var batchId: String
    public var current: Values
    public var proposed: Values
    public var state: MetadataProposalState?

    public var id: String { photoId }

    enum CodingKeys: String, CodingKey {
        case photoId = "photo_id"
        case batchId = "batch_id"
        case current, proposed
        case state
    }

    public init(
        photoID: String,
        batchID: String,
        current: Values,
        proposed: Values,
        state: MetadataProposalState? = nil
    ) {
        photoId = photoID
        batchId = batchID
        self.current = current
        self.proposed = proposed
        self.state = state
    }
}

public enum MetadataProposalDisposition: String, Sendable, CaseIterable {
    case approve, reject, block
}

public struct MetadataValues: Sendable, Equatable {
    public var title: String
    public var caption: String
    public var keywords: [String]

    public init(title: String, caption: String, keywords: [String]) {
        self.title = title
        self.caption = caption
        self.keywords = keywords
    }
}

public struct MetadataEditChange: Sendable, Equatable {
    public var actionID: String
    public var assetID: String
    public var before: MetadataValues
    public var after: MetadataValues
}

public struct MetadataBlacklistChange: Sendable, Equatable {
    public var actionID: String
    public var before: [String]
    public var after: [String]
}

public struct MetadataModelLadderChange: Sendable, Equatable {
    public var actionID: String
    public var before: [String]
    public var after: [String]
}

public actor MetadataReviewService {
    private let runner: OwnerActionRunner
    private let proposalURLs: [URL]
    private let session: URLSession

    public init(
        runner: OwnerActionRunner,
        proposalURLs: [URL] = [
            URL(string: "http://localhost:8766/photosbyelie/title-keyword-review-queue")!,
            URL(string: "http://127.0.0.1:8766/photosbyelie/title-keyword-review-queue")!,
        ],
        session: URLSession = .shared
    ) {
        self.runner = runner
        self.proposalURLs = proposalURLs
        self.session = session
    }

    public func update(
        assetID: String,
        title: String,
        caption: String,
        keywords: [String]
    ) async throws -> OwnerAction {
        try await submit(operation: "update-photo-metadata", payload: [
            "photo_id": .string(assetID),
            "title": .string(title),
            "caption": .string(caption),
            "keywords": .array(normalize(keywords).map(JSONValue.string)),
        ])
    }

    public func updateDetailed(
        assetID: String,
        title: String,
        caption: String,
        keywords: [String]
    ) async throws -> MetadataEditChange {
        let normalizedKeywords = normalize(keywords)
        let action = try await update(
            assetID: assetID,
            title: title,
            caption: caption,
            keywords: normalizedKeywords
        )
        let result = action.result?["result"]?.objectValue ?? action.result ?? [:]
        let previous = result["previous_metadata"]?.objectValue ?? [:]
        let applied = result["metadata"]?.objectValue ?? [:]
        return MetadataEditChange(
            actionID: action.id,
            assetID: applied["photo_id"]?.stringValue ?? assetID,
            before: values(from: previous),
            after: MetadataValues(
                title: applied["title"]?.stringValue ?? title,
                caption: applied["caption"]?.stringValue ?? caption,
                keywords: applied["keywords"]?.arrayValue?.compactMap(\.stringValue)
                    ?? normalizedKeywords
            )
        )
    }

    public func proposals() async throws -> MetadataProposalQueue {
        var lastError: Error = URLError(.cannotConnectToHost)
        for url in proposalURLs {
            do {
                let (data, response) = try await session.data(from: url)
                guard let http = response as? HTTPURLResponse,
                      (200..<300).contains(http.statusCode) else {
                    throw URLError(.badServerResponse)
                }
                return try JSONDecoder.ownerAPI.decode(MetadataProposalQueue.self, from: data)
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    public func decide(
        _ proposal: MetadataProposal,
        disposition: MetadataProposalDisposition,
        comment: String = ""
    ) async throws -> OwnerAction {
        var payload: [String: JSONValue] = [
            "batch_id": .string(proposal.batchId),
            "approvals": .array([]),
            "rejections": .array([]),
            "blocked": .array([]),
        ]
        switch disposition {
        case .approve:
            payload["approvals"] = .array([.object([
                "photo_id": .string(proposal.photoId),
                "batch_id": .string(proposal.batchId),
                "approved": .bool(true),
                "title": .string(proposal.proposed.title),
                "keywords": .array(normalize(proposal.proposed.keywords).map(JSONValue.string)),
            ])])
        case .reject:
            payload["rejections"] = .array([.object([
                "photo_id": .string(proposal.photoId),
                "batch_id": .string(proposal.batchId),
                "rejected": .bool(true),
                "title": .string(proposal.proposed.title),
                "keywords": .array(normalize(proposal.proposed.keywords).map(JSONValue.string)),
                "comment": .string(comment),
            ])])
        case .block:
            payload["blocked"] = .array([.object([
                "photo_id": .string(proposal.photoId),
                "batch_id": .string(proposal.batchId),
                "blocked": .bool(true),
            ])])
        }
        return try await submit(
            operation: "save-title-keyword-review-approvals",
            payload: payload
        )
    }

    public func queueReview(assetIDs: [String]) async throws -> OwnerAction {
        let ids = normalize(assetIDs)
        guard !ids.isEmpty else {
            throw APIErrorEnvelope(error: .init(
                code: "missing_asset_ids",
                message: "Choose at least one asset for metadata review."
            ))
        }
        return try await submit(
            operation: ids.count == 1
                ? "queue-title-keyword-review"
                : "queue-title-keyword-review-many",
            payload: ids.count == 1
                ? ["photo_id": .string(ids[0])]
                : ["photo_ids": .array(ids.map(JSONValue.string))]
        )
    }

    public func replaceBlacklist(_ terms: [String]) async throws -> OwnerAction {
        try await submit(operation: "save-keyword-blacklist", payload: [
            "keywords": .array(normalize(terms).map(JSONValue.string)),
            "mode": "replace",
        ])
    }

    public func replaceBlacklistDetailed(_ terms: [String]) async throws -> MetadataBlacklistChange {
        let action = try await replaceBlacklist(terms)
        let result = action.result?["result"]?.objectValue ?? action.result ?? [:]
        return MetadataBlacklistChange(
            actionID: action.id,
            before: result["previous_keywords"]?.arrayValue?.compactMap(\.stringValue) ?? [],
            after: result["keywords"]?.arrayValue?.compactMap(\.stringValue) ?? normalize(terms)
        )
    }

    public func replaceModelLadder(_ rungs: [MetadataModelLadderRung]) async throws -> OwnerAction {
        let aliases = try normalizeModelLadder(rungs)
        return try await submit(operation: "save-title-keyword-model-ladder", payload: [
            "model_ladder": .array(aliases.map(JSONValue.string)),
        ])
    }

    public func replaceModelLadderDetailed(_ rungs: [MetadataModelLadderRung]) async throws -> MetadataModelLadderChange {
        let aliases = try normalizeModelLadder(rungs)
        let action = try await replaceModelLadder(rungs)
        let result = action.result?["result"]?.objectValue ?? action.result ?? [:]
        return MetadataModelLadderChange(
            actionID: action.id,
            before: result["previous_model_ladder"]?.arrayValue?.compactMap(\.stringValue) ?? [],
            after: result["model_ladder"]?.arrayValue?.compactMap(\.stringValue) ?? aliases
        )
    }

    private func submit(
        operation: String,
        payload: [String: JSONValue]
    ) async throws -> OwnerAction {
        var body = payload
        body["operation"] = .string(operation)
        body["action"] = .string(operation)
        body["queuedAt"] = .string(ISO8601DateFormatter().string(from: Date()))
        let request = OwnerActionCreate(
            actionKind: "photo-moderation",
            target: "max",
            payload: body
        )
        return try await runner.submit(
            request,
            idempotencyKey: ["native-metadata", operation, UUID().uuidString]
                .joined(separator: "-")
        )
    }

    private func normalize(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values
            .flatMap { $0.split(separator: ",").map(String.init) }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter {
                let key = $0.lowercased()
                return !$0.isEmpty && seen.insert(key).inserted
            }
    }

    private func normalizeModelLadder(_ rungs: [MetadataModelLadderRung]) throws -> [String] {
        let aliases = rungs.map(\.alias)
        let supported = Set(MetadataModelLadderRung.catalog.map(\.alias))
        guard !aliases.isEmpty else {
            throw APIErrorEnvelope(error: .init(
                code: "empty_model_ladder",
                message: "Choose at least one OpenAI model rung for the title/keyword ladder."
            ))
        }
        guard aliases.count <= MetadataModelLadderRung.catalog.count else {
            throw APIErrorEnvelope(error: .init(
                code: "model_ladder_too_large",
                message: "The title/keyword ladder can contain at most three OpenAI rungs."
            ))
        }
        guard aliases.allSatisfy(supported.contains) else {
            throw APIErrorEnvelope(error: .init(
                code: "unsupported_model_ladder_rung",
                message: "Only the supported OpenAI Free, Luna, and Sol rungs can be saved."
            ))
        }
        guard Set(aliases).count == aliases.count else {
            throw APIErrorEnvelope(error: .init(
                code: "duplicate_model_ladder_rung",
                message: "Each title/keyword model rung can appear only once."
            ))
        }
        return aliases
    }

    private func values(from object: [String: JSONValue]) -> MetadataValues {
        MetadataValues(
            title: object["title"]?.stringValue ?? "",
            caption: object["caption"]?.stringValue ?? "",
            keywords: object["keywords"]?.arrayValue?.compactMap(\.stringValue) ?? []
        )
    }
}
