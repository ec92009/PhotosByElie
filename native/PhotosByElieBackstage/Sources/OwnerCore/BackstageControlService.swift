import Foundation

public struct BackstageReleaseIdentity: Codable, Sendable, Equatable {
    public var bundleIdentifier: String
    public var version: String
    public var build: String
    public var helperBundleIdentifier: String
    public var helperVersion: String
    public var helperBuild: String

    public init(
        bundleIdentifier: String = "",
        version: String = "",
        build: String = "",
        helperBundleIdentifier: String = "",
        helperVersion: String = "",
        helperBuild: String = ""
    ) {
        self.bundleIdentifier = bundleIdentifier
        self.version = version
        self.build = build
        self.helperBundleIdentifier = helperBundleIdentifier
        self.helperVersion = helperVersion
        self.helperBuild = helperBuild
    }

    public init(bundle: Bundle) {
        self.init(
            bundleIdentifier: bundle.object(forInfoDictionaryKey: "CFBundleIdentifier") as? String ?? "",
            version: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            helperBundleIdentifier: bundle.object(forInfoDictionaryKey: "PBEPhotosBridgeBundleIdentifier") as? String ?? "",
            helperVersion: bundle.object(forInfoDictionaryKey: "PBEPhotosBridgeVersion") as? String ?? "",
            helperBuild: bundle.object(forInfoDictionaryKey: "PBEPhotosBridgeBuild") as? String ?? ""
        )
    }

    public var isComplete: Bool {
        !bundleIdentifier.isEmpty
            && !version.isEmpty
            && !build.isEmpty
            && !helperBundleIdentifier.isEmpty
            && !helperVersion.isEmpty
            && !helperBuild.isEmpty
    }
}

public struct BackstageControlHealth: Codable, Sendable, Equatable {
    public var schemaVersion: Int
    public var command: String
    public var checkedAt: Date
    public var ok: Bool
    public var release: BackstageReleaseIdentity
    public var helper: PhotosBridgeHealth
    public var photoLibraryAccess: String
    public var ownerSession: String
    public var ownerAuthenticated: Bool
    public var connectorID: String
    public var message: String

    public init(
        schemaVersion: Int = 1,
        command: String,
        checkedAt: Date = Date(),
        ok: Bool,
        release: BackstageReleaseIdentity,
        helper: PhotosBridgeHealth,
        photoLibraryAccess: String,
        ownerSession: String,
        ownerAuthenticated: Bool,
        connectorID: String,
        message: String
    ) {
        self.schemaVersion = schemaVersion
        self.command = command
        self.checkedAt = checkedAt
        self.ok = ok
        self.release = release
        self.helper = helper
        self.photoLibraryAccess = photoLibraryAccess
        self.ownerSession = ownerSession
        self.ownerAuthenticated = ownerAuthenticated
        self.connectorID = connectorID
        self.message = message
    }
}

public struct BackstageControlService: Sendable {
    public typealias AuthenticationSnapshotProvider = @Sendable () async -> OwnerAuthenticationSnapshot

    private let release: BackstageReleaseIdentity
    private let photosBridge: PhotosBridgeHealthService
    private let photoLibrary: any PhotoLibraryServing
    private let connectorIdentity: any OwnerConnectorIdentifying
    private let authenticationSnapshot: AuthenticationSnapshotProvider

    public init(
        appURL: URL? = nil,
        helperURL: URL? = nil,
        release: BackstageReleaseIdentity? = nil,
        photosBridge: PhotosBridgeHealthService? = nil,
        photoLibrary: any PhotoLibraryServing = PhotoKitLibraryService(),
        connectorIdentity: any OwnerConnectorIdentifying = LocalOwnerConnectorIdentity(),
        authenticationSnapshot: AuthenticationSnapshotProvider? = nil
    ) {
        let resolvedAppURL = appURL ?? Self.defaultAppURL
        let resolvedHelperURL = helperURL ?? Self.defaultHelperURL
        let mainRelease = BackstageReleaseIdentity(bundle: Bundle.main)
        let resolvedRelease = release
            ?? (mainRelease.isComplete
                ? mainRelease
                : BackstageReleaseIdentity(bundle: Bundle(url: resolvedAppURL) ?? Bundle.main))
        self.release = resolvedRelease
        self.photosBridge = photosBridge ?? PhotosBridgeHealthService(
            appURL: resolvedHelperURL,
            expectedBundleIdentifier: resolvedRelease.helperBundleIdentifier,
            expectedVersion: resolvedRelease.helperVersion,
            expectedBuild: resolvedRelease.helperBuild
        )
        self.photoLibrary = photoLibrary
        self.connectorIdentity = connectorIdentity
        if let authenticationSnapshot {
            self.authenticationSnapshot = authenticationSnapshot
        } else {
            let service = OwnerAuthenticationService(api: OwnerAPIClient())
            self.authenticationSnapshot = {
                await service.currentSnapshot()
            }
        }
    }

    public func health(command: String = "health") async -> BackstageControlHealth {
        async let helper = photosBridge.probe()
        async let owner = authenticationSnapshot()
        async let connectorID = connectorIdentity.connectorID()
        let photoAccess = photoLibrary.authorization()
        let helperHealth = await helper
        let ownerSnapshot = await owner
        let resolvedConnectorID = await connectorID
        let photoAccessLabel = Self.photoAccessLabel(photoAccess)
        let releaseReady = release.isComplete
            && helperHealth.installed
            && helperHealth.headless
            && helperHealth.compatible
            && helperHealth.photoAccess == "authorized"
        let photosReady = releaseReady && [.authorized, .limited].contains(photoAccess)
        let commandReady = command == "release verify" ? releaseReady : photosReady

        return BackstageControlHealth(
            command: command,
            ok: commandReady,
            release: release,
            helper: helperHealth,
            photoLibraryAccess: photoAccessLabel,
            ownerSession: ownerSnapshot.phase.rawValue,
            ownerAuthenticated: ownerSnapshot.phase == .authenticated,
            connectorID: resolvedConnectorID,
            message: message(
                photoAccess: photoAccessLabel,
                helper: helperHealth,
                ownerSnapshot: ownerSnapshot,
                releaseReady: releaseReady,
                photosReady: photosReady,
                command: command
            )
        )
    }

    public func authorizePhotos(command: String = "photos authorize") async -> BackstageControlHealth {
        _ = await photoLibrary.requestAuthorization()
        return await health(command: command)
    }

    private func message(
        photoAccess: String,
        helper: PhotosBridgeHealth,
        ownerSnapshot: OwnerAuthenticationSnapshot,
        releaseReady: Bool,
        photosReady: Bool,
        command: String
    ) -> String {
        guard release.isComplete else {
            return "Backstage release metadata is unavailable. Run this command from the installed Backstage app."
        }
        guard helper.installed else { return helper.message }
        guard helper.compatible else { return helper.message }
        guard helper.photoAccess == "authorized" else { return helper.message }
        if command == "release verify" {
            return "Backstage release and Photos Bridge helper are compatible."
        }
        guard ["authorized", "limited"].contains(photoAccess) else {
            return "Backstage Photos access is \(photoAccess). Choose Allow Photos or grant Full Access to PhotosByElie Backstage in System Settings."
        }
        guard releaseReady && photosReady else {
            return "Backstage control health is not ready."
        }
        guard ownerSnapshot.phase == .authenticated else {
            return "Local Photos control is ready; Owner session requires enrollment or renewal."
        }
        return "Backstage control health is ready."
    }

    private static func photoAccessLabel(_ access: PhotoLibraryAccess) -> String {
        switch access {
        case .notDetermined: return "not_determined"
        case .denied: return "denied"
        case .limited: return "limited"
        case .authorized: return "authorized"
        }
    }

    private static let defaultAppURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Applications/PhotosByElie Backstage.app")
    private static let defaultHelperURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Applications/PhotosByElie Photos Bridge.app")
}

public enum BackstageControlCLI {
    private struct ErrorPayload: Codable {
        struct Detail: Codable {
            var code: String
            var message: String
        }

        var schemaVersion = 1
        var ok = false
        var error: Detail
        var usage: String
    }

    private static let usage = """
    Usage: backstage-control [health|doctor|release verify|photos health|photos authorize] [--pretty]

    Commands return JSON on stdout. Exit codes: 0 ready, 1 internal error,
    2 readiness check failed, 64 invalid arguments.
    """

    public static func run(
        arguments: [String],
        service: BackstageControlService = BackstageControlService(),
        output: @escaping @Sendable (String) -> Void = { print($0) }
    ) async -> Int32 {
        var tokens: [String] = []
        var pretty = false
        for argument in arguments {
            switch argument {
            case "--pretty": pretty = true
            case "--json": break
            default: tokens.append(argument)
            }
        }

        if tokens.isEmpty || tokens == ["health"] || tokens == ["doctor"] {
            return await emitHealth(
                command: tokens == ["doctor"] ? "doctor" : "health",
                pretty: pretty,
                service: service,
                output: output
            )
        }
        if tokens == ["release", "verify"] {
            return await emitHealth(
                command: "release verify",
                pretty: pretty,
                service: service,
                output: output
            )
        }
        if tokens == ["photos", "health"] {
            return await emitHealth(
                command: "photos health",
                pretty: pretty,
                service: service,
                output: output
            )
        }
        if tokens == ["photos", "authorize"] {
            let health = await service.authorizePhotos()
            output(encode(health, pretty: pretty))
            return health.ok ? 0 : 2
        }
        if tokens == ["help"] {
            output(usage)
            return 0
        }

        output(encode(
            ErrorPayload(
                error: .init(
                    code: "invalid_arguments",
                    message: "Unsupported control command."
                ),
                usage: usage
            ),
            pretty: pretty
        ))
        return 64
    }

    private static func emitHealth(
        command: String,
        pretty: Bool,
        service: BackstageControlService,
        output: @escaping @Sendable (String) -> Void
    ) async -> Int32 {
        let health = await service.health(command: command)
        output(encode(health, pretty: pretty))
        return health.ok ? 0 : 2
    }

    private static func encode<Value: Encodable>(_ value: Value, pretty: Bool) -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if pretty {
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        }
        guard let data = try? encoder.encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return "{\"schemaVersion\":1,\"ok\":false,\"error\":{\"code\":\"encoding_failed\",\"message\":\"Could not encode control response.\"}}"
        }
        return text
    }
}
