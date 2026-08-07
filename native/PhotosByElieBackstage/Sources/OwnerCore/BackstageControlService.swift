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

public struct RealEstateOriginalsPreflightRequest: Codable, Sendable, Equatable {
    public struct Item: Codable, Sendable, Equatable {
        public var photoId: String
        public var albumSlug: String
        public var sourceFile: String?
        public var title: String?
        public var sortIndex: Int?

        public init(
            photoId: String,
            albumSlug: String,
            sourceFile: String? = nil,
            title: String? = nil,
            sortIndex: Int? = nil
        ) {
            self.photoId = photoId
            self.albumSlug = albumSlug
            self.sourceFile = sourceFile
            self.title = title
            self.sortIndex = sortIndex
        }
    }

    public var galleryKey: String
    public var items: [Item]

    public init(galleryKey: String, items: [Item]) {
        self.galleryKey = galleryKey
        self.items = items
    }
}

public struct RealEstateOriginalsPreflight: Codable, Sendable, Equatable {
    public struct Item: Codable, Sendable, Equatable {
        public var photoId: String
        public var name: String
        public var contentType: String
        public var available: Bool
        public var bytes: Int?

        public init(
            photoId: String,
            name: String,
            contentType: String,
            available: Bool,
            bytes: Int? = nil
        ) {
            self.photoId = photoId
            self.name = name
            self.contentType = contentType
            self.available = available
            self.bytes = bytes
        }
    }

    public var schemaVersion: Int
    public var command: String
    public var mode: String
    public var checkedAt: String
    public var ok: Bool
    public var galleryKey: String
    public var requestedCount: Int
    public var availableCount: Int
    public var missingCount: Int
    public var totalBytes: Int
    public var items: [Item]
    public var message: String

    public init(
        schemaVersion: Int = 1,
        command: String = "real-estate originals preflight",
        mode: String = "read-only",
        checkedAt: String,
        ok: Bool,
        galleryKey: String,
        requestedCount: Int,
        availableCount: Int,
        missingCount: Int,
        totalBytes: Int,
        items: [Item],
        message: String
    ) {
        self.schemaVersion = schemaVersion
        self.command = command
        self.mode = mode
        self.checkedAt = checkedAt
        self.ok = ok
        self.galleryKey = galleryKey
        self.requestedCount = requestedCount
        self.availableCount = availableCount
        self.missingCount = missingCount
        self.totalBytes = totalBytes
        self.items = items
        self.message = message
    }
}

public struct RealEstateOriginalsPreflightEnvelope: Codable, Sendable, Equatable {
    public var preflight: RealEstateOriginalsPreflight

    public init(preflight: RealEstateOriginalsPreflight) {
        self.preflight = preflight
    }
}

public struct BackstageControlService: Sendable {
    public typealias AuthenticationSnapshotProvider = @Sendable () async -> OwnerAuthenticationSnapshot
    public typealias RealEstateOriginalsPreflightProvider = @Sendable (
        RealEstateOriginalsPreflightRequest
    ) async throws -> RealEstateOriginalsPreflightEnvelope

    private let release: BackstageReleaseIdentity
    private let photosBridge: PhotosBridgeHealthService
    private let photoLibrary: any PhotoLibraryServing
    private let connectorIdentity: any OwnerConnectorIdentifying
    private let authenticationSnapshot: AuthenticationSnapshotProvider
    private let realEstateOriginalsPreflight: RealEstateOriginalsPreflightProvider

    public init(
        appURL: URL? = nil,
        helperURL: URL? = nil,
        release: BackstageReleaseIdentity? = nil,
        photosBridge: PhotosBridgeHealthService? = nil,
        photoLibrary: any PhotoLibraryServing = PhotoKitLibraryService(),
        connectorIdentity: any OwnerConnectorIdentifying = LocalOwnerConnectorIdentity(),
        authenticationSnapshot: AuthenticationSnapshotProvider? = nil,
        realEstateOriginalsPreflight: RealEstateOriginalsPreflightProvider? = nil
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
        if let realEstateOriginalsPreflight {
            self.realEstateOriginalsPreflight = realEstateOriginalsPreflight
        } else {
            let api = OwnerAPIClient()
            let authentication = OwnerAuthenticationService(api: api)
            self.realEstateOriginalsPreflight = { request in
                let snapshot = await authentication.bootstrap()
                guard snapshot.phase == .authenticated else {
                    throw APIErrorEnvelope(error: .init(
                        code: "owner_authentication_required",
                        message: "Backstage Owner enrollment or session renewal is required."
                    ))
                }
                return try await api.request(
                    path: "/real-estate/originals/preflight",
                    method: "POST",
                    body: request
                )
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

    public func preflightRealEstateOriginals(
        _ request: RealEstateOriginalsPreflightRequest
    ) async throws -> RealEstateOriginalsPreflight {
        try await realEstateOriginalsPreflight(request).preflight
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
    Usage:
      backstage-control [health|doctor|release verify|photos health|photos authorize] [--pretty]
      backstage-control real-estate originals preflight --gallery <gallery-key> --items-file <items.json> [--pretty]

    Commands return JSON on stdout. Exit codes: 0 ready, 1 internal error,
    2 readiness check failed, 64 invalid arguments.

    The preflight items file is a JSON array. Each item requires photoId and
    albumSlug; sourceFile, title, and sortIndex are optional. Preflight is
    read-only and never creates download tokens, orders, email, or messages.
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
        if Array(tokens.prefix(3)) == ["real-estate", "originals", "preflight"] {
            return await emitRealEstateOriginalsPreflight(
                arguments: Array(tokens.dropFirst(3)),
                pretty: pretty,
                service: service,
                output: output
            )
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

    private static func emitRealEstateOriginalsPreflight(
        arguments: [String],
        pretty: Bool,
        service: BackstageControlService,
        output: @escaping @Sendable (String) -> Void
    ) async -> Int32 {
        var galleryKey: String?
        var itemsFile: String?
        var index = 0
        while index < arguments.count {
            let argument = arguments[index]
            guard ["--gallery", "--items-file"].contains(argument),
                  index + 1 < arguments.count else {
                return emitError(
                    code: "invalid_arguments",
                    message: "Preflight requires --gallery and --items-file.",
                    pretty: pretty,
                    exitCode: 64,
                    output: output
                )
            }
            let value = arguments[index + 1]
            if argument == "--gallery" {
                guard galleryKey == nil else {
                    return emitError(
                        code: "invalid_arguments",
                        message: "--gallery may be provided only once.",
                        pretty: pretty,
                        exitCode: 64,
                        output: output
                    )
                }
                galleryKey = value
            } else {
                guard itemsFile == nil else {
                    return emitError(
                        code: "invalid_arguments",
                        message: "--items-file may be provided only once.",
                        pretty: pretty,
                        exitCode: 64,
                        output: output
                    )
                }
                itemsFile = value
            }
            index += 2
        }

        guard let galleryKey = galleryKey?.trimmingCharacters(in: .whitespacesAndNewlines),
              !galleryKey.isEmpty,
              let itemsFile,
              !itemsFile.isEmpty else {
            return emitError(
                code: "invalid_arguments",
                message: "Preflight requires non-empty --gallery and --items-file values.",
                pretty: pretty,
                exitCode: 64,
                output: output
            )
        }

        let data: Data
        do {
            data = try Data(contentsOf: URL(fileURLWithPath: itemsFile))
        } catch {
            return emitError(
                code: "items_file_unreadable",
                message: "The preflight items file could not be read.",
                pretty: pretty,
                exitCode: 64,
                output: output
            )
        }

        let items: [RealEstateOriginalsPreflightRequest.Item]
        do {
            items = try JSONDecoder.ownerAPI.decode(
                [RealEstateOriginalsPreflightRequest.Item].self,
                from: data
            )
        } catch {
            return emitError(
                code: "invalid_items_file",
                message: "The preflight items file must be a JSON array with photoId and albumSlug for every item.",
                pretty: pretty,
                exitCode: 64,
                output: output
            )
        }
        guard !items.isEmpty else {
            return emitError(
                code: "invalid_items_file",
                message: "The preflight items file must contain at least one item.",
                pretty: pretty,
                exitCode: 64,
                output: output
            )
        }

        do {
            let preflight = try await service.preflightRealEstateOriginals(.init(
                galleryKey: galleryKey,
                items: items
            ))
            output(encode(preflight, pretty: pretty))
            return preflight.ok ? 0 : 2
        } catch let error as APIErrorEnvelope {
            return emitError(
                code: error.error.code,
                message: error.error.message,
                pretty: pretty,
                exitCode: 1,
                output: output
            )
        } catch {
            return emitError(
                code: "preflight_failed",
                message: "The read-only originals preflight could not be completed.",
                pretty: pretty,
                exitCode: 1,
                output: output
            )
        }
    }

    private static func emitError(
        code: String,
        message: String,
        pretty: Bool,
        exitCode: Int32,
        output: @escaping @Sendable (String) -> Void
    ) -> Int32 {
        output(encode(
            ErrorPayload(
                error: .init(code: code, message: message),
                usage: usage
            ),
            pretty: pretty
        ))
        return exitCode
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
