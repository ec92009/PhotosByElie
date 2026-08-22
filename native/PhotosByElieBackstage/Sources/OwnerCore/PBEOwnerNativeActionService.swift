import CryptoKit
import Foundation

/// Owns the browser-to-Worker mutation boundary for the fixture-frozen PBE
/// Owner surface. Browser-supplied authority fields are ignored; the active
/// native session supplies fixture, actor, connector, and lifecycle scope.
public actor PBEOwnerNativeActionService {
    public typealias GalleryProvider = @Sendable (
        PBEOwnerSessionContract
    ) async throws -> PBEOwnerNativeGallery

    private struct Record: Sendable, Equatable {
        var sessionID: String
        var fixtureID: String
        var operation: String
        var assetIDs: [String]
        var idempotencyDigest: String
    }

    private let api: any OwnerActionServing
    private let runner: OwnerActionRunner
    private let connectorID: String
    private let galleryProvider: GalleryProvider
    private var records: [String: Record] = [:]
    private var latestRequestBySession: [String: String] = [:]

    public init(
        api: any OwnerActionServing,
        runner: OwnerActionRunner,
        connectorID: String,
        galleryProvider: @escaping GalleryProvider
    ) {
        self.api = api
        self.runner = runner
        self.connectorID = connectorID.trimmingCharacters(in: .whitespacesAndNewlines)
        self.galleryProvider = galleryProvider
    }

    public func submit(
        session: PBEOwnerSessionContract,
        payload: [String: JSONValue],
        idempotencyKey: String
    ) async throws -> [String: JSONValue] {
        let key = idempotencyKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty,
              key == idempotencyKey,
              key.utf8.count <= 256,
              key.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
            throw failure("pbe_owner_idempotency_required", 400)
        }
        guard !connectorID.isEmpty else {
            throw failure("pbe_owner_connector_unavailable", 503)
        }

        let operation = clean(payload["action"]?.stringValue ?? "").lowercased()
        guard ["waste-basket-x", "waste-basket-x-many", "waste-basket-restore"]
            .contains(operation) else {
            throw failure("pbe_owner_action_forbidden", 403)
        }
        let capability = operation == "waste-basket-restore"
            ? "waste-basket.restore"
            : "waste-basket.x"
        guard session.capabilities.contains(capability) else {
            throw failure("pbe_owner_action_forbidden", 403)
        }
        let requestedFixture = clean(
            payload["fixtureId"]?.stringValue
                ?? payload["fixture_id"]?.stringValue
                ?? ""
        )
        guard requestedFixture.isEmpty || requestedFixture == session.fixtureId else {
            throw failure("pbe_owner_session_mismatch", 409)
        }

        let assetIDs = try requestedAssetIDs(payload)
        if operation == "waste-basket-restore" {
            try await authorizeRestore(
                session: session,
                assetIDs: assetIDs
            )
        } else {
            let gallery = try await galleryProvider(session)
            let allowed = Set(gallery.items.map(\.assetId))
            guard gallery.fixtureId == session.fixtureId,
                  Set(assetIDs).isSubset(of: allowed) else {
                throw failure("pbe_owner_fixture_mismatch", 409)
            }
        }

        if let active = try await activeAction(session: session) {
            var response = response(for: active)
            response["resumed"] = true
            return response
        }

        let reason = try cleanReason(payload["reason"]?.stringValue ?? "")
        let request = OwnerActionCreate(
            actionKind: "photo-moderation",
            target: connectorID,
            payload: [
                "operation": .string(operation),
                "photoIds": .array(assetIDs.map(JSONValue.string)),
                "source": .string("owner-gallery"),
                "actor": .string("backstage-pbe:\(session.id)"),
                "fixtureId": .string(session.fixtureId),
                "galleryId": .string(session.fixtureId),
                "requestedConnector": .string(connectorID),
                "reason": .string(reason.isEmpty ? "Hosted PBE Owner gallery X" : reason),
            ]
        )
        let action: OwnerAction
        do {
            action = try await runner.enqueue(request, idempotencyKey: key)
        } catch {
            throw failure("pbe_owner_action_failed", 502)
        }
        guard !action.id.isEmpty,
              action.actionKind == "photo-moderation",
              action.target == connectorID else {
            throw failure("pbe_owner_action_invalid", 502)
        }
        let record = Record(
            sessionID: session.id,
            fixtureID: session.fixtureId,
            operation: operation,
            assetIDs: assetIDs,
            idempotencyDigest: Self.digest(key)
        )
        if let existing = records[action.id], existing != record {
            throw failure("pbe_owner_idempotency_conflict", 409)
        }
        records[action.id] = record
        latestRequestBySession[session.id] = action.id
        await runner.accelerate(action)
        return response(for: action)
    }

    public func status(
        session: PBEOwnerSessionContract,
        requestID: String?
    ) async throws -> [String: JSONValue] {
        let requested = clean(requestID ?? "")
        let actionID = requested.isEmpty
            ? latestRequestBySession[session.id] ?? ""
            : requested
        guard !actionID.isEmpty else {
            return ["ok": true, "requestId": "", "state": "idle"]
        }
        guard let record = records[actionID],
              record.sessionID == session.id,
              record.fixtureID == session.fixtureId else {
            throw failure("pbe_owner_request_unavailable", 404)
        }
        let action: OwnerAction
        do {
            action = try await api.getAction(id: actionID)
        } catch {
            throw failure("pbe_owner_action_status_failed", 502)
        }
        guard action.id == actionID,
              action.actionKind == "photo-moderation",
              action.target == connectorID else {
            throw failure("pbe_owner_action_invalid", 502)
        }
        return response(for: action)
    }

    public func submitProvider() -> @Sendable (
        PBEOwnerSessionContract,
        [String: JSONValue],
        String
    ) async throws -> [String: JSONValue] {
        { session, payload, key in
            try await self.submit(
                session: session,
                payload: payload,
                idempotencyKey: key
            )
        }
    }

    public func statusProvider() -> @Sendable (
        PBEOwnerSessionContract,
        String?
    ) async throws -> [String: JSONValue] {
        { session, requestID in
            try await self.status(session: session, requestID: requestID)
        }
    }

    private func activeAction(session: PBEOwnerSessionContract) async throws -> OwnerAction? {
        guard let actionID = latestRequestBySession[session.id],
              let record = records[actionID],
              record.fixtureID == session.fixtureId else { return nil }
        let action: OwnerAction
        do {
            action = try await api.getAction(id: actionID)
        } catch {
            throw failure("pbe_owner_action_status_failed", 502)
        }
        guard action.id == actionID,
              action.actionKind == "photo-moderation",
              action.target == connectorID else {
            throw failure("pbe_owner_action_invalid", 502)
        }
        switch action.state {
        case .queued, .claimed, .running:
            return action
        case .completed, .failed, .cancelled:
            return nil
        }
    }

    private func authorizeRestore(
        session: PBEOwnerSessionContract,
        assetIDs: [String]
    ) async throws {
        let requested = Set(assetIDs)
        for (actionID, record) in records where
            record.sessionID == session.id
                && record.fixtureID == session.fixtureId
                && ["waste-basket-x", "waste-basket-x-many"].contains(record.operation)
                && requested.isSubset(of: Set(record.assetIDs)) {
            if let action = try? await api.getAction(id: actionID),
               action.id == actionID,
               action.actionKind == "photo-moderation",
               action.target == connectorID,
               action.state == .completed {
                return
            }
        }
        throw failure("pbe_owner_fixture_mismatch", 409)
    }

    private func requestedAssetIDs(
        _ payload: [String: JSONValue]
    ) throws -> [String] {
        var raw: [String] = []
        if let single = payload["photo_id"]?.stringValue
            ?? payload["photoId"]?.stringValue {
            raw.append(single)
        }
        for key in ["photo_ids", "photoIds"] {
            raw.append(contentsOf: payload[key]?.arrayValue?.compactMap(\.stringValue) ?? [])
        }
        var seen = Set<String>()
        let ids = raw.compactMap { value -> String? in
            let cleanValue = clean(value)
            guard !cleanValue.isEmpty, seen.insert(cleanValue).inserted else { return nil }
            return cleanValue
        }
        guard !ids.isEmpty,
              ids.count <= 100,
              ids.allSatisfy({
                  $0.utf8.count <= BackstagePreviewIPCConstants.maximumAssetIDBytes
                      && $0.unicodeScalars.allSatisfy({
                          !CharacterSet.controlCharacters.contains($0)
                      })
              }) else {
            throw failure("pbe_owner_action_invalid", 400)
        }
        return ids
    }

    private func cleanReason(_ value: String) throws -> String {
        let reason = clean(value)
        guard reason.utf8.count <= 1_000,
              reason.unicodeScalars.allSatisfy({
                  !CharacterSet.controlCharacters.contains($0)
              }) else {
            throw failure("pbe_owner_action_invalid", 400)
        }
        return reason
    }

    private func response(for action: OwnerAction) -> [String: JSONValue] {
        let state: String
        switch action.state {
        case .queued: state = "queued"
        case .claimed, .running: state = "running"
        case .completed: state = "completed"
        case .failed: state = "failed"
        case .cancelled: state = "failed"
        }
        var output: [String: JSONValue] = [
            "ok": true,
            "requestId": .string(action.id),
            "state": .string(state),
        ]
        if action.state == .completed {
            let result = action.result?["result"]?.objectValue ?? action.result ?? [:]
            for (key, value) in result where !["ok", "requestId", "state"].contains(key) {
                output[key] = value
            }
        } else if action.state == .failed || action.state == .cancelled {
            output["error"] = .string("The trusted connector could not complete this action.")
        }
        return output
    }

    private func failure(
        _ code: String,
        _ statusCode: Int
    ) -> PBEOwnerNativeSessionFailure {
        PBEOwnerNativeSessionFailure(
            code: code,
            statusCode: statusCode,
            message: "The hosted lifecycle action is unavailable; refresh its trusted status."
        )
    }

    private func clean(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
