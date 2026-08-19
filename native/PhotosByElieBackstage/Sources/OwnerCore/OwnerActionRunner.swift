import Foundation

public protocol OwnerActionServing: Sendable {
    func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String
    ) async throws -> OwnerActionEnvelope
    func getAction(id: String) async throws -> OwnerAction
}

extension OwnerAPIClient: OwnerActionServing {}

public protocol OwnerActionWaking: Sendable {
    func wake(actionID: String) async throws -> OwnerAction?
}

private final class OnDemandOwnerActionFileManager: @unchecked Sendable {
    let value: FileManager

    init(_ value: FileManager) {
        self.value = value
    }
}

/// Runs the trusted connector only for the duration of an explicit Backstage
/// action. The process uses the sealed runtime and mutable Owner data root
/// already resolved by the PBE host contract; credentials remain in the
/// existing connector config and never enter Swift memory or arguments.
public struct OnDemandOwnerActionWaker: OwnerActionWaking {
    public struct LaunchPlan: Sendable, Equatable {
        public var pythonExecutable: URL
        public var scriptURL: URL
        public var configURL: URL
        public var runtimeRoot: URL
        public var dataRoot: URL

        public init(
            pythonExecutable: URL,
            scriptURL: URL,
            configURL: URL,
            runtimeRoot: URL,
            dataRoot: URL
        ) {
            self.pythonExecutable = pythonExecutable
            self.scriptURL = scriptURL
            self.configURL = configURL
            self.runtimeRoot = runtimeRoot
            self.dataRoot = dataRoot
        }
    }

    private let runtimeRoot: URL?
    private let dataRoot: URL?
    private let configURL: URL
    private let pythonExecutable: URL
    private let fileManagerBox: OnDemandOwnerActionFileManager

    public init(
        runtimeRoot: URL? = nil,
        dataRoot: URL? = nil,
        configURL: URL? = nil,
        pythonExecutable: URL = URL(fileURLWithPath: "/usr/bin/python3"),
        fileManager: FileManager = .default
    ) {
        let home = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
        self.runtimeRoot = runtimeRoot
        self.dataRoot = dataRoot
        self.configURL = configURL ?? home.appendingPathComponent(
            ".config/photosbyelie/connector.json",
            isDirectory: false
        )
        self.pythonExecutable = pythonExecutable
        self.fileManagerBox = OnDemandOwnerActionFileManager(fileManager)
    }

    public static func makeLaunchPlan(
        runtimeRoot: URL,
        dataRoot: URL,
        configURL: URL,
        pythonExecutable: URL = URL(fileURLWithPath: "/usr/bin/python3"),
        fileManager: FileManager = .default
    ) throws -> LaunchPlan {
        let runtime = runtimeRoot.standardizedFileURL
        let data = dataRoot.standardizedFileURL
        let config = configURL.standardizedFileURL
        let script = runtime.appendingPathComponent(
            "scripts/new_owner_connector.py",
            isDirectory: false
        )
        let isSymbolicLink: (URL) -> Bool = { url in
            (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true
        }
        guard fileManager.fileExists(atPath: pythonExecutable.path),
              fileManager.fileExists(atPath: script.path),
              fileManager.fileExists(atPath: config.path),
              fileManager.fileExists(atPath: data.appendingPathComponent(
                  "assets/owner-actions/Owner.sqlite",
                  isDirectory: false
              ).path),
              !isSymbolicLink(script),
              !isSymbolicLink(runtime),
              !isSymbolicLink(data) else {
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_connector_runtime_missing",
                message: "Backstage could not prepare its on-demand Owner connector runtime."
            ))
        }
        return LaunchPlan(
            pythonExecutable: pythonExecutable.standardizedFileURL,
            scriptURL: script.standardizedFileURL,
            configURL: config,
            runtimeRoot: runtime,
            dataRoot: data
        )
    }

    public func wake(actionID: String) async throws -> OwnerAction? {
        guard actionID.hasPrefix("owner-action-"), actionID.count <= 96 else {
            throw OwnerActionRunError.invalidActionID
        }
        let roots = PBEOwnerRuntimeRoots.resolve(
            environment: ProcessInfo.processInfo.environment,
            bundleRuntimeRoot: Bundle.main.resourceURL?.appendingPathComponent(
                "OwnerRuntime",
                isDirectory: true
            ),
            connectorConfigURL: configURL,
            homeDirectory: URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true),
            fileManager: fileManagerBox.value
        )
        let resolvedRuntime = runtimeRoot ?? roots.runtimeRoot
        let resolvedData = dataRoot ?? roots.dataRoot
        guard let resolvedRuntime, let resolvedData else {
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_connector_roots_missing",
                message: "Backstage could not resolve its signed Owner runtime and mutable data root."
            ))
        }
        let plan = try Self.makeLaunchPlan(
            runtimeRoot: resolvedRuntime,
            dataRoot: resolvedData,
            configURL: configURL,
            pythonExecutable: pythonExecutable,
            fileManager: fileManagerBox.value
        )
        _ = try PBEOwnerCheckoutIdentity.verified(repositoryRoot: plan.runtimeRoot)

        let process = Process()
        process.executableURL = plan.pythonExecutable
        process.arguments = [
            "-E", "-B",
            plan.scriptURL.path,
            "--config", plan.configURL.path,
            "--once",
        ]
        process.currentDirectoryURL = plan.dataRoot
        var environment = ProcessInfo.processInfo.environment
        for key in environment.keys where key.hasPrefix("PYTHON") {
            environment.removeValue(forKey: key)
        }
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        environment["PBE_CONNECTOR_RUNTIME_ROOT"] = plan.runtimeRoot.path
        environment["PBE_REPO_ROOT"] = plan.dataRoot.path
        environment["PBE_ON_DEMAND_OWNER_CONNECTOR"] = "1"
        process.environment = environment
        process.standardOutput = FileHandle(forWritingAtPath: "/dev/null")
        process.standardError = FileHandle(forWritingAtPath: "/dev/null")
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw OwnerActionRunError.failed(
                "The on-demand Owner connector exited with status \(process.terminationStatus)."
            )
        }
        return nil
    }
}

public struct LocalOwnerActionWaker: OwnerActionWaking {
    private let endpoints: [URL]
    private let session: URLSession
    private let decoder = JSONDecoder.ownerAPI

    public init(
        endpoints: [URL] = [
            URL(string: "http://127.0.0.1:8766/photosbyelie/wake-owner-action")!,
            URL(string: "http://localhost:8766/photosbyelie/wake-owner-action")!,
        ],
        timeout: TimeInterval = 20
    ) {
        self.endpoints = endpoints
        let configuration = URLSessionConfiguration.ephemeral
        // Large immutable fixture snapshots can take several seconds to read
        // and serialize locally. Keep the direct-wake request alive long
        // enough to receive that result instead of abandoning it and falling
        // back to a second cloud polling round trip.
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.waitsForConnectivity = false
        self.session = URLSession(configuration: configuration)
    }

    public func wake(actionID: String) async throws -> OwnerAction? {
        struct RequestBody: Encodable { let actionId: String }
        struct ResponseBody: Decodable { let action: OwnerAction? }

        guard actionID.hasPrefix("owner-action-"), actionID.count <= 96 else {
            throw OwnerActionRunError.invalidActionID
        }
        var lastError: Error = URLError(.cannotConnectToHost)
        for endpoint in endpoints {
            do {
                var request = URLRequest(url: endpoint)
                request.httpMethod = "POST"
                request.httpBody = try JSONEncoder.ownerAPI.encode(RequestBody(actionId: actionID))
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                // The connector applies the same allowlist used by the public
                // Owner page. It still receives only the opaque action ID.
                request.setValue("https://photos-by-elie.com", forHTTPHeaderField: "Origin")
                let (data, response) = try await session.data(for: request)
                guard let response = response as? HTTPURLResponse,
                      (200..<300).contains(response.statusCode) else {
                    throw URLError(.badServerResponse)
                }
                return try decoder.decode(ResponseBody.self, from: data).action
            } catch {
                lastError = error
            }
        }
        throw lastError
    }
}

public enum OwnerActionRunError: Error, Sendable, Equatable {
    case invalidActionID
    case failed(String)
    case cancelled
    case timedOut
}

extension OwnerActionRunError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .invalidActionID:
            "The audited Owner action did not return a valid action ID."
        case let .failed(message):
            message.isEmpty ? "The audited Owner action failed." : message
        case .cancelled:
            "The audited Owner action was cancelled."
        case .timedOut:
            "The audited Owner action is taking longer than expected. It remains durable and can be checked in Activity."
        }
    }
}

public actor OwnerActionRunner {
    private let api: any OwnerActionServing
    private let waker: any OwnerActionWaking
    private let pollInterval: Duration
    private let timeout: Duration
    private let clock = ContinuousClock()

    public init(
        api: any OwnerActionServing,
        waker: any OwnerActionWaking = OnDemandOwnerActionWaker(),
        pollInterval: Duration = .milliseconds(500),
        timeout: Duration = .seconds(15 * 60)
    ) {
        self.api = api
        self.waker = waker
        self.pollInterval = pollInterval
        self.timeout = timeout
    }

    public func submit(
        _ request: OwnerActionCreate,
        idempotencyKey: String = UUID().uuidString,
        completionTimeout: Duration? = nil
    ) async throws -> OwnerAction {
        let envelope = try await api.createAction(request, idempotencyKey: idempotencyKey)
        return try await awaitCompletion(
            of: envelope.action,
            completionTimeout: completionTimeout
        )
    }

    /// Create the durable action and return as soon as the Worker has accepted
    /// it. Callers that need terminal state can monitor the returned action
    /// with `awaitCompletion(of:)` from a background task.
    public func enqueue(
        _ request: OwnerActionCreate,
        idempotencyKey: String = UUID().uuidString
    ) async throws -> OwnerAction {
        let envelope = try await api.createAction(request, idempotencyKey: idempotencyKey)
        return envelope.action
    }

    public func awaitCompletion(
        of queued: OwnerAction,
        completionTimeout: Duration? = nil,
        onUpdate: (@Sendable (OwnerAction) -> Void)? = nil
    ) async throws -> OwnerAction {
        let deadline = clock.now.advanced(by: completionTimeout ?? timeout)
        var action = queued
        onUpdate?(action)

        // The local connector wake is only an acceleration hint. Fire it in
        // the background and let the durable Worker poll remain the source of
        // truth, so a slow PhotoKit/SQLite/connector operation never blocks
        // the native action monitor or its UI.
        let waker = self.waker
        let actionID = action.id
        Task.detached(priority: .utility) {
            _ = try? await waker.wake(actionID: actionID)
        }

        while true {
            try Task.checkCancellation()
            switch action.state {
            case .completed:
                return action
            case .failed:
                let message = action.error?["message"]?.stringValue
                    ?? action.error?["code"]?.stringValue
                    ?? "Owner action failed."
                throw OwnerActionRunError.failed(message)
            case .cancelled:
                throw OwnerActionRunError.cancelled
            case .queued, .claimed, .running:
                break
            }
            guard clock.now < deadline else {
                throw OwnerActionRunError.timedOut
            }
            let remaining = deadline - clock.now
            try await clock.sleep(for: min(pollInterval, remaining))
            action = try await api.getAction(id: action.id)
            onUpdate?(action)
        }
    }

}
