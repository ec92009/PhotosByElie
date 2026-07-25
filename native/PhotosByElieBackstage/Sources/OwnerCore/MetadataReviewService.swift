import Foundation

public actor MetadataReviewService {
    private let runner: OwnerActionRunner

    public init(runner: OwnerActionRunner) {
        self.runner = runner
    }

    public func update(
        assetID: String,
        title: String,
        keywords: [String]
    ) async throws -> OwnerAction {
        try await submit(operation: "update-photo-metadata", payload: [
            "photo_id": .string(assetID),
            "title": .string(title),
            "keywords": .array(normalize(keywords).map(JSONValue.string)),
        ])
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
