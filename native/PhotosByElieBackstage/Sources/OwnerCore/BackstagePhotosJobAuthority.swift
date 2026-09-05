import CryptoKit
import Foundation

/// A snapshot produced by the sealed job planner before its worker receives
/// Photos authority. Empty asset scopes never mean the entire library.
public struct BackstagePhotosJobPlan: Codable, Sendable {
    public var operations: Set<String>
    public var assetIDs: Set<String>
    public var writes: [PhotoMetadataApplyRequest]
    public var preserveMetadataIDs: Set<String>
    public var dateFrom: String
    public var dateTo: String
    public var maxPixel: Int

    public init(operations: Set<String> = [], assetIDs: Set<String> = [],
                writes: [PhotoMetadataApplyRequest] = [], preserveMetadataIDs: Set<String> = [],
                dateFrom: String = "", dateTo: String = "", maxPixel: Int = 1800) {
        self.operations = operations; self.assetIDs = assetIDs; self.writes = writes
        self.preserveMetadataIDs = preserveMetadataIDs
        self.dateFrom = dateFrom; self.dateTo = dateTo; self.maxPixel = maxPixel
    }
}

public struct BackstagePhotosJobCredential: Codable, Sendable {
    public let jobID: String
    public let secret: String
    public let expiresAt: TimeInterval
    public let dateFrom: String
    public let dateTo: String
}

/// The descriptor advertises transport only. Authority comes from a secret
/// delivered over stdin to a Backstage-launched, sealed helper, never a file,
/// argument, environment variable or public IPC grant-issuance endpoint.
public actor BackstagePhotosJobAuthority {
    public static let shared = BackstagePhotosJobAuthority()
    public typealias SessionCheck = @Sendable () async -> OwnerAuthenticationSnapshot
    private struct Job {
        var plan: BackstagePhotosJobPlan
        var key: SymmetricKey
        var expiresAt: Date
        var deviceID: String
        var checkSession: SessionCheck
        var consumed: Set<String> = []
        var nextOffset = 0
        var indexInFlight = false
        var before: [String: PhotoMetadataApplyRequest] = [:]
    }
    private var jobs: [String: Job] = [:]
    public init() {}

    public func issue(plan: BackstagePhotosJobPlan, session: OwnerAuthenticationSnapshot,
                      checkSession: @escaping SessionCheck, now: Date = Date()) throws -> BackstagePhotosJobCredential {
        jobs = jobs.filter { $0.value.expiresAt > now }
        let supported: Set<String> = ["photos.preview", "photos.library-index", "photos.identity-map",
            "photos.export-original", "photos.metadata-read-many", "photos.metadata-apply-many"]
        guard session.phase == .authenticated, let deviceID = session.deviceId, !deviceID.isEmpty, let expiry = session.accessExpiresAt, expiry > now,
              !plan.operations.isEmpty, plan.operations.isSubset(of: supported),
              (256...1800).contains(plan.maxPixel),
              plan.assetIDs.count <= 100_000, plan.writes.count <= 100_000,
              Set(plan.writes.map(\.assetID)).count == plan.writes.count,
              Set(plan.writes.map(\.assetID)).isSubset(of: plan.assetIDs),
              plan.preserveMetadataIDs.isSubset(of: plan.assetIDs), jobs.count < 32 else {
            throw OwnerActionRunError.failed("The Photos helper job has no valid bounded Owner authority.")
        }
        let key = SymmetricKey(size: .bits256)
        let id = UUID().uuidString
        let deadline = min(expiry, now.addingTimeInterval(15 * 60))
        jobs[id] = Job(plan: plan, key: key, expiresAt: deadline, deviceID: deviceID, checkSession: checkSession)
        return BackstagePhotosJobCredential(jobID: id,
            secret: key.withUnsafeBytes { Data($0).base64EncodedString() },
            expiresAt: deadline.timeIntervalSince1970, dateFrom: plan.dateFrom, dateTo: plan.dateTo)
    }

    public func revokeAll() { jobs.removeAll() }

    public func revoke(_ jobID: String) { jobs.removeValue(forKey: jobID) }

    /// Atomically consumes one signed request. The signature binds every byte,
    /// including asset, operation, metadata, query and request ID.
    public func consume(_ envelopeData: Data, now: Date = Date()) async -> Data? {
        guard envelopeData.count <= 24_000,
              let envelope = try? JSONDecoder().decode(Envelope.self, from: envelopeData),
              let raw = Data(base64Encoded: envelope.request), raw.count <= 16_384,
              let signature = Data(base64Encoded: envelope.signature),
              let first = jobs[envelope.jobID], first.expiresAt > now,
              HMAC<SHA256>.isValidAuthenticationCode(signature, authenticating: raw, using: first.key),
              let request = try? JSONDecoder().decode(Request.self, from: raw),
              UUID(uuidString: request.requestId) != nil else { return nil }
        let session = await first.checkSession()
        let checkedAt = max(now, Date())
        guard session.phase == .authenticated, let expiry = session.accessExpiresAt, expiry > checkedAt,
              var job = jobs[envelope.jobID], job.expiresAt > checkedAt,
              session.deviceId == job.deviceID,
              job.consumed.count < 100_000, !job.consumed.contains(request.requestId),
              permits(request, job: job) else { return nil }
        job.consumed.insert(request.requestId)
        if request.operation == "photos.library-index" { job.indexInFlight = true }
        jobs[envelope.jobID] = job
        return raw
    }

    /// Capture successful metadata reads for a tombstone write that must keep
    /// the original title/caption and unrelated keywords exactly as read.
    public func recordResponse(envelopeData: Data, requestData: Data, response: Data) {
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: envelopeData),
              let request = try? JSONDecoder().decode(Request.self, from: requestData),
              var job = jobs[envelope.jobID],
              let payload = try? JSONSerialization.jsonObject(with: response) as? [String: Any] else { return }
        if request.operation == "photos.library-index" { job.indexInFlight = false }
        guard payload["ok"] as? Bool == true else { jobs[envelope.jobID] = job; return }
        if request.operation == "photos.library-index" {
            job.nextOffset = (request.offset ?? 0) + (request.limit ?? 0)
        }
        if request.operation == "photos.metadata-read-many",
           let items = payload["items"] as? [[String: Any]] {
            for item in items {
                guard let id = item["assetId"] as? String, job.plan.preserveMetadataIDs.contains(id),
                      item["error"] == nil,
                      let title = item["title"] as? String, let caption = item["caption"] as? String,
                      let keywords = item["keywords"] as? [String] else { continue }
                job.before[id] = PhotoMetadataApplyRequest(assetID: id, title: title, caption: caption,
                    keywords: keywords.filter { !Self.isManaged($0) }, managedKeywords: ["PBE:Tombstone"])
            }
        }
        jobs[envelope.jobID] = job
    }

    private func permits(_ request: Request, job: Job) -> Bool {
        guard job.plan.operations.contains(request.operation) else { return false }
        switch request.operation {
        case "photos.library-index":
            return !job.indexInFlight && (request.dateFrom ?? "") == job.plan.dateFrom && (request.dateTo ?? "") == job.plan.dateTo
                && request.offset == job.nextOffset && (1...1000).contains(request.limit ?? 0)
        case "photos.preview":
            return job.plan.assetIDs.contains(request.assetId ?? "")
                && (256...job.plan.maxPixel).contains(request.maxPixel ?? 0)
        case "photos.export-original": return job.plan.assetIDs.contains(request.assetId ?? "")
        case "photos.identity-map":
            guard let ids = request.localIdentifiers, !ids.isEmpty, ids.count <= 64 else { return false }
            return Set(ids).isSubset(of: job.plan.assetIDs)
        case "photos.metadata-read-many", "photos.metadata-apply-many":
            guard let rows = request.requests, !rows.isEmpty, rows.count <= 64,
                  rows.allSatisfy({ job.plan.assetIDs.contains($0.assetID) }) else { return false }
            guard request.operation == "photos.metadata-apply-many" else { return true }
            let expected = Dictionary(job.plan.writes.map { ($0.assetID, $0) }, uniquingKeysWith: { first, _ in first })
            return rows.allSatisfy { row in
                if job.plan.preserveMetadataIDs.contains(row.assetID) { return job.before[row.assetID] == row }
                return expected[row.assetID] == row
            }
        default: return false
        }
    }

    private static func isManaged(_ value: String) -> Bool {
        ["PBE:Approved", "PBE:Tombstone", "PBE-Approved"].contains(value)
            || ["PBE:Rating:", "PBE:Color:", "PBE-Rating-", "PBE-Color-", "PBE-Fixture-ID:"].contains { value.hasPrefix($0) }
    }
    private struct Envelope: Decodable { var jobID: String; var request: String; var signature: String }
    private struct Request: Decodable {
        var requestId: String; var operation: String
        var assetId: String?; var maxPixel: Int?; var limit: Int?; var offset: Int?
        var dateFrom: String?; var dateTo: String?
        var requests: [PhotoMetadataApplyRequest]?; var localIdentifiers: [String]?
    }
}
