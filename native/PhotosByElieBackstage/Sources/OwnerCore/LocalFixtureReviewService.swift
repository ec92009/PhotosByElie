import Foundation

/// The narrow local contract used by Backstage for Review mutations.
///
/// Keeping this contract separate prevents latency-sensitive Review work from
/// being routed through the cloud action ledger while the migration proceeds.
public protocol LocalFixtureReviewServing: Sendable {
    func applyReview(manifest: [String: JSONValue]) async throws -> FixtureReviewResult
    func undoReview(operationID: String) async throws -> FixtureReviewUndoResult
}

/// Optional native read support for a local Review service. Returning nil means
/// the caller should preserve its existing Owner-action read path.
public protocol LocalFixtureReviewReading: Sendable {
    func nativeReviewWindow(
        fixtureID: String,
        mode: FixtureReviewMode,
        stateFilters: [String],
        proposalAvailableOnly: Bool,
        mediaFilters: [String],
        offset: Int,
        limit: Int,
        search: String
    ) async throws -> FixtureReviewWindow?
}

/// Optional native Culling read support. Returning nil preserves the existing
/// audited Owner-action query for callers without a native database.
public protocol LocalFixtureCullingReading: Sendable {
    func nativeCullingWindow(
        fixtureID: String,
        view: FixtureCullingView,
        views: [FixtureCullingView],
        offset: Int,
        limit: Int,
        search: String,
        mediaTypes: [String],
        ratings: [Int],
        colors: [String]
    ) async throws -> FixtureCullingWindow?
}

/// Optional native Culling placement writes. Returning nil preserves the
/// existing audited Owner-action mutation for callers without native SQLite.
public protocol LocalFixtureCullingServing: Sendable {
    func nativeApplyCullingState(
        _ state: FixturePlacementState,
        fixtureID: String,
        assetIDs: [String],
        reason: String
    ) async throws -> [FixtureAssetState]?

    func nativeUndoCullingState(
        _ applied: [FixtureAssetState],
        reason: String
    ) async throws -> [FixtureAssetState]?
}

public struct LocalFixtureReviewService: LocalFixtureReviewServing, LocalFixtureReviewReading, LocalFixtureCullingReading, LocalFixtureCullingServing {
    private let endpoints: [URL]
    private let session: URLSession
    private let helperURL: URL?
    private let repoRoot: URL?
    private let nativeDatabaseURL: URL?
    private let usesOnDemandProcess: Bool
    private let encoder = JSONEncoder.ownerAPI
    private let decoder = JSONDecoder.ownerAPI

    public init(
        endpoints: [URL] = [
            URL(string: "http://127.0.0.1:8766/photosbyelie/review-action")!,
            URL(string: "http://localhost:8766/photosbyelie/review-action")!,
        ],
        timeout: TimeInterval = 10,
        session: URLSession? = nil,
        helperURL: URL? = nil,
        repoRoot: URL? = nil,
        nativeDatabaseURL: URL? = OwnerReviewDatabaseLocator().resolve(),
        usesOnDemandProcess: Bool = true
    ) {
        self.endpoints = endpoints
        self.helperURL = helperURL
        self.repoRoot = repoRoot
        self.nativeDatabaseURL = nativeDatabaseURL?.standardizedFileURL
        self.usesOnDemandProcess = usesOnDemandProcess
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
        if nativeDatabaseURL != nil {
            return try applyViaNativeSQLite(payload)
        }
        let result = try await request(payload: payload, resultKey: "reviewAction")
        return FixtureReviewResult(json: result)
    }

    public func undoReview(operationID: String) async throws -> FixtureReviewUndoResult {
        if nativeDatabaseURL != nil {
            return try undoViaNativeSQLite(operationID: operationID)
        }
        let result = try await request(
            payload: [
                "operation": .string("undo"),
                "operationId": .string(operationID),
            ],
            resultKey: "reviewUndo"
        )
        return FixtureReviewUndoResult(json: result)
    }

    public func nativeReviewWindow(
        fixtureID: String,
        mode: FixtureReviewMode,
        stateFilters: [String],
        proposalAvailableOnly: Bool,
        mediaFilters: [String],
        offset: Int,
        limit: Int,
        search: String
    ) throws -> FixtureReviewWindow? {
        guard nativeDatabaseURL != nil else { return nil }
        return try nativeStore().reviewWindow(
            fixtureID: fixtureID,
            mode: mode,
            stateFilters: stateFilters,
            proposalAvailableOnly: proposalAvailableOnly,
            mediaFilters: mediaFilters,
            offset: offset,
            limit: limit,
            search: search
        )
    }

    public func nativeCullingWindow(
        fixtureID: String,
        view: FixtureCullingView,
        views: [FixtureCullingView],
        offset: Int,
        limit: Int,
        search: String,
        mediaTypes: [String],
        ratings: [Int],
        colors: [String]
    ) throws -> FixtureCullingWindow? {
        guard nativeDatabaseURL != nil else { return nil }
        return try nativeCullingStore().cullingWindow(
            fixtureID: fixtureID,
            view: view,
            views: views,
            offset: offset,
            limit: limit,
            search: search,
            mediaTypes: mediaTypes,
            ratings: ratings,
            colors: colors
        )
    }

    public func nativeApplyCullingState(
        _ state: FixturePlacementState,
        fixtureID: String,
        assetIDs: [String],
        reason: String
    ) throws -> [FixtureAssetState]? {
        guard nativeDatabaseURL != nil else { return nil }
        return try nativeCullingStore().applyState(
            state,
            fixtureID: fixtureID,
            assetIDs: assetIDs,
            actor: "owner",
            reason: reason
        )
    }

    public func nativeUndoCullingState(
        _ applied: [FixtureAssetState],
        reason: String
    ) throws -> [FixtureAssetState]? {
        guard nativeDatabaseURL != nil else { return nil }
        return try nativeCullingStore().undoState(
            applied,
            actor: "owner",
            reason: reason
        )
    }

    /// Uses the already-verified native SQLite parity store when the app-level
    /// resolver supplies the Owner-private database. Callers without that
    /// resolved database retain the existing Python/HTTP fallback.
    private func applyViaNativeSQLite(
        _ payload: [String: JSONValue]
    ) throws -> FixtureReviewResult {
        let action = try requiredAction(from: payload)
        let fixtureID = try requiredString("fixtureId", from: payload)
        let assetIDs = try requiredStringArray("assetIds", from: payload)
        let anchorAssetID = try optionalString("anchorAssetId", from: payload) ?? ""
        let title = try optionalString("title", from: payload)
        let keywords = try optionalStringArray("keywords", from: payload)
        let proposalID = try optionalString("proposalId", from: payload)
        let aiReasons = try optionalStringArray("aiReasons", from: payload) ?? []
        let aiNote = try optionalString("aiNote", from: payload) ?? ""
        let propagate = payload["propagate"]?.boolValue ?? false
        return try nativeStore().applyReview(
            action,
            fixtureID: fixtureID,
            assetIDs: assetIDs,
            anchorAssetID: anchorAssetID,
            propagate: propagate,
            title: title,
            keywords: keywords,
            proposalID: proposalID,
            aiReasons: aiReasons,
            aiNote: aiNote
        )
    }

    private func undoViaNativeSQLite(
        operationID: String
    ) throws -> FixtureReviewUndoResult {
        try nativeStore().undoReview(operationID: operationID)
    }

    private func nativeStore() throws -> OwnerReviewSQLiteStore {
        guard let nativeDatabaseURL else {
            throw APIErrorEnvelope(error: .init(
                code: "native_review_database_missing",
                message: "Backstage could not resolve the native Review database."
            ))
        }
        guard FileManager.default.fileExists(atPath: nativeDatabaseURL.path) else {
            throw APIErrorEnvelope(error: .init(
                code: "native_review_database_missing",
                message: "Backstage could not find the native Review database."
            ))
        }
        return OwnerReviewSQLiteStore(databaseURL: nativeDatabaseURL)
    }

    private func nativeCullingStore() throws -> OwnerCullingSQLiteStore {
        guard let nativeDatabaseURL else {
            throw APIErrorEnvelope(error: .init(
                code: "native_review_database_missing",
                message: "Backstage could not resolve the native Culling database."
            ))
        }
        guard FileManager.default.fileExists(atPath: nativeDatabaseURL.path) else {
            throw APIErrorEnvelope(error: .init(
                code: "native_review_database_missing",
                message: "Backstage could not find the native Culling database."
            ))
        }
        return OwnerCullingSQLiteStore(databaseURL: nativeDatabaseURL)
    }

    private func requiredAction(
        from payload: [String: JSONValue]
    ) throws -> FixtureReviewAction {
        let rawValue = try requiredString("reviewAction", from: payload)
        guard let action = FixtureReviewAction(rawValue: rawValue) else {
            throw invalidManifest("reviewAction is not supported: \(rawValue)")
        }
        return action
    }

    private func requiredString(
        _ key: String,
        from payload: [String: JSONValue]
    ) throws -> String {
        guard let value = payload[key]?.stringValue,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw invalidManifest("\(key) is required")
        }
        return value
    }

    private func requiredStringArray(
        _ key: String,
        from payload: [String: JSONValue]
    ) throws -> [String] {
        guard let value = payload[key], let values = value.arrayValue else {
            throw invalidManifest("\(key) must be an array of strings")
        }
        guard values.allSatisfy({ $0.stringValue != nil }) else {
            throw invalidManifest("\(key) must be an array of strings")
        }
        return values.compactMap(\.stringValue)
    }

    private func optionalString(
        _ key: String,
        from payload: [String: JSONValue]
    ) throws -> String? {
        guard let value = payload[key] else { return nil }
        if case .null = value { return nil }
        guard let string = value.stringValue else {
            throw invalidManifest("\(key) must be a string")
        }
        return string
    }

    private func optionalStringArray(
        _ key: String,
        from payload: [String: JSONValue]
    ) throws -> [String]? {
        guard let value = payload[key] else { return nil }
        if case .null = value { return nil }
        guard let values = value.arrayValue,
              values.allSatisfy({ $0.stringValue != nil }) else {
            throw invalidManifest("\(key) must be an array of strings")
        }
        return values.compactMap(\.stringValue)
    }

    private func invalidManifest(_ message: String) -> APIErrorEnvelope {
        APIErrorEnvelope(error: .init(
            code: "native_review_manifest_invalid",
            message: message
        ))
    }

    private func request(
        payload: [String: JSONValue],
        resultKey: String
    ) async throws -> [String: JSONValue] {
        if usesOnDemandProcess {
            return try await requestViaOnDemandProcess(payload: payload, resultKey: resultKey)
        }
        return try await requestViaHTTP(payload: payload, resultKey: resultKey)
    }

    private func requestViaOnDemandProcess(
        payload: [String: JSONValue],
        resultKey: String
    ) async throws -> [String: JSONValue] {
        let root = try resolvedRepoRoot()
        let helper = (helperURL ?? root.appendingPathComponent(
            "scripts/new_owner_connector.py",
            isDirectory: false
        )).standardizedFileURL
        guard FileManager.default.fileExists(atPath: helper.path) else {
            throw APIErrorEnvelope(error: .init(
                code: "local_review_helper_missing",
                message: "Backstage could not find its on-demand local Review helper."
            ))
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = ["-E", "-B", helper.path, "--local-review-action"]
        process.currentDirectoryURL = root
        var environment = ProcessInfo.processInfo.environment
        for key in environment.keys where key.hasPrefix("PYTHON") {
            environment.removeValue(forKey: key)
        }
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        environment["PBE_REPO_ROOT"] = root.path
        environment["PBE_ON_DEMAND_OWNER_CONNECTOR"] = "1"
        process.environment = environment

        let input = Pipe()
        let output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle(forWritingAtPath: "/dev/null")
        do {
            try process.run()
            input.fileHandleForWriting.write(try encoder.encode(payload))
            input.fileHandleForWriting.closeFile()
            process.waitUntilExit()
        } catch {
            throw APIErrorEnvelope(error: .init(
                code: "local_review_helper_failed",
                message: "Backstage could not start its on-demand local Review helper: \(error)"
            ))
        }

        let data = output.fileHandleForReading.readDataToEndOfFile()
        let decoded = (try? decoder.decode([String: JSONValue].self, from: data)) ?? [:]
        guard process.terminationStatus == 0, decoded["ok"]?.boolValue == true else {
            let message = decoded["error"]?.stringValue
                ?? "The on-demand local Review helper exited with status \(process.terminationStatus)."
            throw APIErrorEnvelope(error: .init(
                code: "local_review_action_failed",
                message: message
            ))
        }
        guard let result = decoded[resultKey]?.objectValue else {
            throw APIErrorEnvelope(error: .init(
                code: "local_review_result_missing",
                message: "The on-demand local Review helper returned no \(resultKey) result."
            ))
        }
        return result
    }

    private func resolvedRepoRoot() throws -> URL {
        if let repoRoot {
            return repoRoot.standardizedFileURL
        }
        if let value = ProcessInfo.processInfo.environment["PBE_REPO_ROOT"], !value.isEmpty {
            return URL(fileURLWithPath: value, isDirectory: true).standardizedFileURL
        }
        let configURL = URL(
            fileURLWithPath: NSHomeDirectory(),
            isDirectory: true
        ).appendingPathComponent(
            ".config/photosbyelie/connector.json",
            isDirectory: false
        )
        guard let data = try? Data(contentsOf: configURL),
              let object = try? JSONSerialization.jsonObject(with: data),
              let payload = object as? [String: Any],
              let value = payload["repoRoot"] as? String,
              !value.isEmpty else {
            throw APIErrorEnvelope(error: .init(
                code: "local_review_repo_missing",
                message: "Backstage could not resolve the local Review data root."
            ))
        }
        return URL(fileURLWithPath: value, isDirectory: true).standardizedFileURL
    }

    private func requestViaHTTP(
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
