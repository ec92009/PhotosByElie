import Foundation

public struct MetadataProposalQueue: Codable, Sendable, Equatable {
    public var batchId: String
    public var photos: [MetadataProposal]

    enum CodingKeys: String, CodingKey {
        case batchId = "batch_id"
        case photos
    }
}

public struct MetadataProposal: Codable, Identifiable, Sendable, Equatable {
    public struct Values: Codable, Sendable, Equatable {
        public var title: String
        public var keywords: [String]
        public var reason: String?
        public var confidence: String?

        public init(
            title: String,
            keywords: [String],
            reason: String? = nil,
            confidence: String? = nil
        ) {
            self.title = title
            self.keywords = keywords
            self.reason = reason
            self.confidence = confidence
        }

        enum CodingKeys: String, CodingKey {
            case title, keywords, reason, confidence
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
        }
    }

    public var photoId: String
    public var batchId: String
    public var current: Values
    public var proposed: Values

    public var id: String { photoId }

    enum CodingKeys: String, CodingKey {
        case photoId = "photo_id"
        case batchId = "batch_id"
        case current, proposed
    }

    public init(
        photoID: String,
        batchID: String,
        current: Values,
        proposed: Values
    ) {
        photoId = photoID
        batchId = batchID
        self.current = current
        self.proposed = proposed
    }
}

public enum MetadataProposalDisposition: String, Sendable, CaseIterable {
    case approve, reject, block
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
}
