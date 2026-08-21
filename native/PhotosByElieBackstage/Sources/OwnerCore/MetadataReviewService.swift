import Foundation

public struct MetadataModelLadderRung: Codable, Identifiable, Sendable, Equatable {
    public var model: String
    public var effort: String
    public var vision: Bool { true }
    public var id: String { model }
    public var alias: String { model }
    public var label: String { "\(model) \(effort)" }
    public var resolvedModel: String { model }
    public var reasoningEffort: String { effort }
    public var estimatedCost: String { "Depends on model and effort" }

    public init(model: String, effort: String) {
        self.model = model
        self.effort = effort
    }

    public init(
        alias: String,
        label: String,
        resolvedModel: String,
        reasoningEffort: String,
        vision: Bool,
        estimatedCost: String
    ) {
        self.model = resolvedModel
        self.effort = reasoningEffort
    }

    public static let catalog: [MetadataModelLadderRung] = [
        MetadataModelLadderRung(
            alias: "gpt-5.4-mini",
            label: "GPT-5.4 mini low",
            resolvedModel: "gpt-5.4-mini",
            reasoningEffort: "low",
            vision: true,
            estimatedCost: "Lowest-cost default vision rung"
        ),
        MetadataModelLadderRung(
            alias: "gpt-5.6-luna",
            label: "Luna Max vision",
            resolvedModel: "gpt-5.6-luna",
            reasoningEffort: "max",
            vision: true,
            estimatedCost: "Higher: max + image"
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
        case model, effort, vision
        case alias
        case resolvedModel = "resolved_model"
        case reasoningEffort = "reasoning_effort"
    }

    public init(from decoder: Decoder) throws {
        if let legacy = try? decoder.singleValueContainer().decode(String.self) {
            let mappings: [String: (String, String)] = [
                "codex-gpt-5.4-mini": ("gpt-5.4-mini", "low"),
                "codex-gpt-5.6-luna-max-vision": ("gpt-5.6-luna", "max"),
                "codex-gpt-5.6-luna-xhigh-vision": ("gpt-5.6-luna", "xhigh"),
                "codex-gpt-5.6-sol-high-vision": ("gpt-5.6-sol", "high"),
            ]
            let mapped = mappings[legacy] ?? (legacy, "medium")
            model = mapped.0
            effort = mapped.1
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        model = try container.decodeIfPresent(String.self, forKey: .model)
            ?? container.decodeIfPresent(String.self, forKey: .resolvedModel)
            ?? container.decodeIfPresent(String.self, forKey: .alias)
            ?? ""
        effort = try container.decodeIfPresent(String.self, forKey: .effort)
            ?? container.decodeIfPresent(String.self, forKey: .reasoningEffort)
            ?? ""
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(model, forKey: .model)
        try container.encode(effort, forKey: .effort)
        try container.encode(true, forKey: .vision)
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
    public var modelLadder: [MetadataModelLadderRung]?
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
    public var before: [MetadataModelLadderRung]
    public var after: [MetadataModelLadderRung]
}

public actor MetadataReviewService {
    private let runner: OwnerActionRunner
    private let proposalStore: MetadataProposalSQLiteStore?

    public init(
        runner: OwnerActionRunner,
        nativeDatabaseURL: URL? = OwnerReviewDatabaseLocator().resolve()
    ) {
        self.runner = runner
        self.proposalStore = nativeDatabaseURL.map(MetadataProposalSQLiteStore.init(databaseURL:))
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
        guard let proposalStore else {
            throw APIErrorEnvelope(error: .init(
                code: "native_metadata_database_missing",
                message: "Backstage could not resolve the native Metadata database."
            ))
        }
        return try proposalStore.proposals()
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
        let normalized = try normalizeModelLadder(rungs)
        return try await submit(operation: "save-title-keyword-model-ladder", payload: [
            "model_ladder": .array(normalized.map { rung in
                .object([
                    "model": .string(rung.model),
                    "effort": .string(rung.effort),
                    "vision": .bool(true),
                ])
            }),
        ])
    }

    public func replaceModelLadderDetailed(_ rungs: [MetadataModelLadderRung]) async throws -> MetadataModelLadderChange {
        let normalized = try normalizeModelLadder(rungs)
        let action = try await replaceModelLadder(rungs)
        let result = action.result?["result"]?.objectValue ?? action.result ?? [:]
        return MetadataModelLadderChange(
            actionID: action.id,
            before: decodeModelLadder(result["previous_model_ladder"]),
            after: decodeModelLadder(result["model_ladder"]).isEmpty
                ? normalized
                : decodeModelLadder(result["model_ladder"])
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

    public nonisolated func validateModelLadder(_ rungs: [MetadataModelLadderRung]) -> String? {
        do {
            _ = try normalizeModelLadder(rungs)
            return nil
        } catch let error as APIErrorEnvelope {
            return error.error.message
        } catch {
            return String(describing: error)
        }
    }

    private nonisolated func normalizeModelLadder(_ rungs: [MetadataModelLadderRung]) throws -> [MetadataModelLadderRung] {
        guard !rungs.isEmpty else {
            throw APIErrorEnvelope(error: .init(
                code: "empty_model_ladder",
                message: "Add at least one vision model rung for the title/keyword ladder."
            ))
        }
        let efforts = Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
        let modelPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
        var seen = Set<String>()
        var normalized: [MetadataModelLadderRung] = []
        for (offset, rung) in rungs.enumerated() {
            let model = rung.model.trimmingCharacters(in: .whitespacesAndNewlines)
            let effort = rung.effort.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let range = NSRange(model.startIndex..<model.endIndex, in: model)
            guard modelPattern.firstMatch(in: model, range: range) != nil else {
                throw APIErrorEnvelope(error: .init(code: "invalid_model", message: "Rung \(offset + 1) needs a valid model identifier."))
            }
            guard !["local-", "ollama", "lmstudio"].contains(where: { model.lowercased().hasPrefix($0) }) else {
                throw APIErrorEnvelope(error: .init(code: "local_model_not_allowed", message: "Rung \(offset + 1) must use a Codex-accessible OpenAI model."))
            }
            guard efforts.contains(effort) else {
                throw APIErrorEnvelope(error: .init(code: "invalid_effort", message: "Rung \(offset + 1) has an unsupported effort."))
            }
            let knownEfforts: Set<String>? = model.lowercased().hasPrefix("gpt-5.6")
                ? Set(["none", "low", "medium", "high", "xhigh", "max"])
                : model.lowercased().hasPrefix("gpt-5.4")
                    ? Set(["none", "low", "medium", "high", "xhigh"])
                    : nil
            guard knownEfforts?.contains(effort) != false else {
                throw APIErrorEnvelope(error: .init(code: "invalid_model_effort", message: "Rung \(offset + 1): \(model) does not support effort \(effort)."))
            }
            guard seen.insert(model.lowercased()).inserted else {
                throw APIErrorEnvelope(error: .init(code: "duplicate_model_ladder_rung", message: "Each model can appear only once."))
            }
            normalized.append(MetadataModelLadderRung(model: model, effort: effort))
        }
        return normalized
    }

    private func decodeModelLadder(_ value: JSONValue?) -> [MetadataModelLadderRung] {
        value?.arrayValue?.compactMap { item in
            if let legacy = item.stringValue {
                return try? JSONDecoder().decode(MetadataModelLadderRung.self, from: Data("\"\(legacy)\"".utf8))
            }
            guard let object = item.objectValue else { return nil }
            let model = object["model"]?.stringValue ?? object["resolved_model"]?.stringValue ?? ""
            let effort = object["effort"]?.stringValue ?? object["reasoning_effort"]?.stringValue ?? ""
            return MetadataModelLadderRung(model: model, effort: effort)
        } ?? []
    }

    private func values(from object: [String: JSONValue]) -> MetadataValues {
        MetadataValues(
            title: object["title"]?.stringValue ?? "",
            caption: object["caption"]?.stringValue ?? "",
            keywords: object["keywords"]?.arrayValue?.compactMap(\.stringValue) ?? []
        )
    }
}
