import Foundation

/// The narrow local IPC contract used by Backstage for Review mutations.
///
/// Review reads remain Owner-action based, but Hide/Approve/etc. and Undo are
/// already backed by one local SQLite transaction. Keeping this contract
/// separate prevents those latency-sensitive mutations from being routed
/// through the cloud action ledger.
public protocol LocalFixtureReviewServing: Sendable {
    func applyReview(manifest: [String: JSONValue]) async throws -> FixtureReviewResult
    func undoReview(operationID: String) async throws -> FixtureReviewUndoResult
}

public struct LocalFixtureReviewService: LocalFixtureReviewServing {
    private let endpoints: [URL]
    private let session: URLSession
    private let encoder = JSONEncoder.ownerAPI
    private let decoder = JSONDecoder.ownerAPI

    public init(
        endpoints: [URL] = [
            URL(string: "http://127.0.0.1:8766/photosbyelie/review-action")!,
            URL(string: "http://localhost:8766/photosbyelie/review-action")!,
        ],
        timeout: TimeInterval = 10,
        session: URLSession? = nil
    ) {
        self.endpoints = endpoints
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = timeout
            configuration.timeoutIntervalForResource = timeout
            configuration.waitsForConnectivity = false
            self.session = URLSession(configuration: configuration)
        }
    }

    public func applyReview(manifest: [String: JSONValue]) async throws -> FixtureReviewResult {
        var payload = manifest
        payload["operation"] = .string("apply")
        let result = try await request(payload: payload, resultKey: "reviewAction")
        return FixtureReviewResult(json: result)
    }

    public func undoReview(operationID: String) async throws -> FixtureReviewUndoResult {
        let result = try await request(
            payload: [
                "operation": .string("undo"),
                "operationId": .string(operationID),
            ],
            resultKey: "reviewUndo"
        )
        return FixtureReviewUndoResult(json: result)
    }

    private func request(
        payload: [String: JSONValue],
        resultKey: String
    ) async throws -> [String: JSONValue] {
        let body = try encoder.encode(payload)
        var lastError: Error = URLError(.cannotConnectToHost)
        for endpoint in endpoints {
            do {
                var request = URLRequest(url: endpoint)
                request.httpMethod = "POST"
                request.httpBody = body
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("https://photos-by-elie.com", forHTTPHeaderField: "Origin")
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw URLError(.badServerResponse)
                }
                let decoded = try decoder.decode([String: JSONValue].self, from: data)
                guard (200..<300).contains(http.statusCode) else {
                    let message = decoded["error"]?.stringValue ?? "Local Review action failed."
                    throw APIErrorEnvelope(error: .init(
                        code: "local_review_action_failed",
                        message: message
                    ))
                }
                guard decoded["ok"]?.boolValue == true,
                      let result = decoded[resultKey]?.objectValue else {
                    throw APIErrorEnvelope(error: .init(
                        code: "local_review_result_missing",
                        message: "The local Review service returned no \(resultKey) result."
                    ))
                }
                return result
            } catch {
                lastError = error
            }
        }
        throw lastError
    }
}
