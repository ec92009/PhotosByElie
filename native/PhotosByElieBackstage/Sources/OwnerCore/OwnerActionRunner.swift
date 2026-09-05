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
    func wake(action: OwnerAction) async throws -> OwnerAction?
}

extension OwnerActionWaking {
    public func wake(action: OwnerAction) async throws -> OwnerAction? { try await wake(actionID: action.id) }
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

    private let photoJobAuthority: BackstagePhotosJobAuthority
    private let ownerSnapshot: BackstagePhotosJobAuthority.SessionCheck
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
        fileManager: FileManager = .default,
        photoJobAuthority: BackstagePhotosJobAuthority = .shared,
        ownerSnapshot: @escaping BackstagePhotosJobAuthority.SessionCheck = {
            await OwnerAuthenticationService(api: OwnerAPIClient()).currentSnapshot()
        }
    ) {
        let home = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
        self.photoJobAuthority = photoJobAuthority
        self.ownerSnapshot = ownerSnapshot
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

    /// Run a connector process without occupying a Swift cooperative-executor
    /// thread while the operating system waits for it to exit. Multiple Owner
    /// actions can overlap, so a synchronous `waitUntilExit()` here can starve
    /// the action polling tasks that observe their durable terminal receipts.
    static func runAndAwaitTermination(_ process: Process) async throws -> Int32 {
        try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = { terminatedProcess in
                continuation.resume(returning: terminatedProcess.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                process.terminationHandler = nil
                continuation.resume(throwing: error)
            }
        }
    }

    public func wake(actionID: String) async throws -> OwnerAction? {
        try await wake(actionID: actionID, acceptedAction: nil)
    }

    public func wake(action: OwnerAction) async throws -> OwnerAction? {
        try await wake(actionID: action.id, acceptedAction: action)
    }

    private func wake(actionID: String, acceptedAction: OwnerAction?) async throws -> OwnerAction? {
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

        var credential: BackstagePhotosJobCredential?
        if let action = acceptedAction, BackstagePhotosJobLauncher.requiresPhotos(action) {
            let scope = try await BackstagePhotosJobLauncher.plan(action: action, launch: plan)
            if !scope.operations.isEmpty {
                credential = try await photoJobAuthority.issue(plan: scope,
                    session: await ownerSnapshot(), checkSession: ownerSnapshot)
            }
        }
        do {
            let process = Process()
            process.executableURL = plan.pythonExecutable
            process.arguments = [
                "-I", "-S", "-B", "-c", BackstagePhotosJobLauncher.bootstrap,
                plan.runtimeRoot.appendingPathComponent("scripts").path, plan.scriptURL.path,
                "--config", plan.configURL.path,
                "--once",
                "--action-id", actionID,
            ]
            process.currentDirectoryURL = plan.dataRoot
            var environment = ProcessInfo.processInfo.environment
            for key in environment.keys where key.hasPrefix("PYTHON") || key.hasPrefix("PBE_PHOTOS_JOB") {
                environment.removeValue(forKey: key)
            }
            environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            environment["PBE_CONNECTOR_RUNTIME_ROOT"] = plan.runtimeRoot.path
            environment["PBE_REPO_ROOT"] = plan.dataRoot.path
            environment["PBE_ON_DEMAND_OWNER_CONNECTOR"] = "1"
            let credentialPipe = Pipe()
            if let credential {
                environment["PBE_PHOTOS_JOB_STDIN"] = "1"
                process.standardInput = credentialPipe
                var data = try JSONEncoder().encode(credential)
                data.append(0x0a)
                try credentialPipe.fileHandleForWriting.write(contentsOf: data)
                try credentialPipe.fileHandleForWriting.close()
            } else { process.standardInput = FileHandle.nullDevice }
            process.environment = environment
            process.standardOutput = FileHandle(forWritingAtPath: "/dev/null")
            process.standardError = FileHandle(forWritingAtPath: "/dev/null")
            let terminationStatus = try await Self.runAndAwaitTermination(process)
            if let credential { await photoJobAuthority.revoke(credential.jobID) }
            guard terminationStatus == 0 else {
                throw OwnerActionRunError.failed(
                    "The on-demand Owner connector exited with status \(terminationStatus)."
                )
            }
        } catch {
            if let credential { await photoJobAuthority.revoke(credential.jobID) }
            throw error
        }
        return nil
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
    private var accelerationTasks: [String: Task<Void, Never>] = [:]
    private var photosJobFailures: [String: String] = [:]

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
        accelerate(envelope.action)
        return envelope.action
    }

    /// Retain each one-shot wake until it exits. PBE Owner's native action
    /// bridge uses this path without a separate terminal monitor.
    public func accelerate(_ action: OwnerAction) {
        guard accelerationTasks[action.id] == nil, photosJobFailures[action.id] == nil else { return }
        let waker = self.waker
        let actionID = action.id
        let task = Task.detached(priority: .utility) { [weak self] in
            do { _ = try await waker.wake(action: action) }
            catch {
                if BackstagePhotosJobLauncher.requiresPhotos(action) {
                    await self?.recordPhotosJobFailure(actionID, message: error.localizedDescription)
                }
            }
        }
        accelerationTasks[actionID] = task
        Task { [weak self] in
            await task.value
            await self?.finishAcceleration(actionID)
        }
    }

    private func recordPhotosJobFailure(_ actionID: String, message: String) {
        if photosJobFailures.count >= 1000 { photosJobFailures.removeAll() }
        photosJobFailures[actionID] = message
    }

    private func finishAcceleration(_ actionID: String) {
        accelerationTasks.removeValue(forKey: actionID)
    }

    /// Inspect an enqueued action, including a sealed Photos-job launch failure.
    public func currentAction(id: String) async throws -> OwnerAction {
        let action = try await api.getAction(id: id)
        if [.queued, .claimed, .running].contains(action.state), let failure = photosJobFailures[id] {
            throw OwnerActionRunError.failed(failure)
        }
        return action
    }

    public func awaitCompletion(
        of queued: OwnerAction,
        completionTimeout: Duration? = nil,
        onUpdate: (@Sendable (OwnerAction) -> Void)? = nil
    ) async throws -> OwnerAction {
        let deadline = clock.now.advanced(by: completionTimeout ?? timeout)
        var action = queued
        onUpdate?(action)

        // Enqueued actions are already accelerated before control returns to
        // their caller. Keep this call for actions resumed from durable state;
        // the per-action task registry prevents a duplicate live wake.
        accelerate(action)

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
            if let failure = photosJobFailures[action.id] {
                throw OwnerActionRunError.failed(failure)
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
