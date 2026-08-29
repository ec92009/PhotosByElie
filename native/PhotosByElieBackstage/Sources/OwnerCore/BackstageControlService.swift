import Foundation

public struct RetiredPhotosBridgeArtifacts: Sendable, Equatable {
    public var archiveDirectory: URL?
    public var retiredNames: [String]

    public init(archiveDirectory: URL?, retiredNames: [String]) {
        self.archiveDirectory = archiveDirectory
        self.retiredNames = retiredNames
    }
}

/// Recoverably removes the retired standalone PhotoKit helper from the only
/// locations that old Backstage install and rollback flows used as live roots.
/// Historical archives remain untouched for audit and recovery.
public struct RetiredPhotosBridgeService {
    public static let liveArtifactNames = [
        "PhotosByElie Photos Bridge.app",
        "PhotosByElie Photos Bridge.app.previous",
        "PhotosByElie Photos Bridge.app.rollback",
    ]

    private let fileManager: FileManager
    private let applicationsDirectory: URL
    private let retirementRoot: URL
    private let retirementFolderName: String

    public init(
        fileManager: FileManager = .default,
        applicationsDirectory: URL? = nil,
        retirementRoot: URL? = nil,
        retirementFolderName: String? = nil
    ) {
        let applications = applicationsDirectory
            ?? fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent("Applications", isDirectory: true)
        self.fileManager = fileManager
        self.applicationsDirectory = applications.standardizedFileURL
        self.retirementRoot = (retirementRoot
            ?? applications.appendingPathComponent(
                "PhotosByElie Retired Bridge Artifacts",
                isDirectory: true
            )).standardizedFileURL
        self.retirementFolderName = retirementFolderName ?? Self.makeRetirementFolderName()
    }

    @discardableResult
    public func retireInstalledArtifacts() throws -> RetiredPhotosBridgeArtifacts {
        let sources = Self.liveArtifactNames.compactMap { name -> (String, URL)? in
            let url = applicationsDirectory.appendingPathComponent(name, isDirectory: true)
            let exists = fileManager.fileExists(atPath: url.path)
                || (try? fileManager.destinationOfSymbolicLink(atPath: url.path)) != nil
            return exists ? (name, url) : nil
        }
        guard !sources.isEmpty else {
            return RetiredPhotosBridgeArtifacts(archiveDirectory: nil, retiredNames: [])
        }

        let archiveDirectory = retirementRoot.appendingPathComponent(
            retirementFolderName,
            isDirectory: true
        )
        try fileManager.createDirectory(
            at: archiveDirectory,
            withIntermediateDirectories: true
        )

        var retiredNames: [String] = []
        for (name, source) in sources {
            let destination = archiveDirectory.appendingPathComponent(name, isDirectory: true)
            guard !fileManager.fileExists(atPath: destination.path) else {
                throw CocoaError(.fileWriteFileExists)
            }
            try fileManager.moveItem(at: source, to: destination)
            retiredNames.append(name)
        }
        return RetiredPhotosBridgeArtifacts(
            archiveDirectory: archiveDirectory,
            retiredNames: retiredNames
        )
    }

    private static func makeRetirementFolderName() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return "backstage-launch-\(formatter.string(from: Date()))-\(UUID().uuidString)"
    }
}

public struct BackstageReleaseIdentity: Codable, Sendable, Equatable {
    public var bundleIdentifier: String
    public var version: String
    public var build: String

    public init(
        bundleIdentifier: String = "",
        version: String = "",
        build: String = ""
    ) {
        self.bundleIdentifier = bundleIdentifier
        self.version = version
        self.build = build
    }

    public init(bundle: Bundle) {
        self.init(
            bundleIdentifier: bundle.object(forInfoDictionaryKey: "CFBundleIdentifier") as? String ?? "",
            version: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        )
    }

    public var isComplete: Bool {
        !bundleIdentifier.isEmpty
            && !version.isEmpty
            && !build.isEmpty
    }
}

public struct BackstageControlHealth: Codable, Sendable, Equatable {
    public var schemaVersion: Int
    public var command: String
    public var checkedAt: Date
    public var ok: Bool
    public var release: BackstageReleaseIdentity
    public var photoLibraryAccess: String
    public var ownerSession: String
    public var ownerAuthenticated: Bool
    public var connectorID: String
    public var message: String

    public init(
        schemaVersion: Int = 2,
        command: String,
        checkedAt: Date = Date(),
        ok: Bool,
        release: BackstageReleaseIdentity,
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
    private let photoLibrary: any PhotoLibraryServing
    private let connectorIdentity: any OwnerConnectorIdentifying
    private let authenticationSnapshot: AuthenticationSnapshotProvider
    private let realEstateOriginalsPreflight: RealEstateOriginalsPreflightProvider
    private let rawRecoveryDirectory: URL

    public init(
        appURL: URL? = nil,
        release: BackstageReleaseIdentity? = nil,
        photoLibrary: any PhotoLibraryServing = PhotoKitLibraryService(),
        connectorIdentity: any OwnerConnectorIdentifying = LocalOwnerConnectorIdentity(),
        authenticationSnapshot: AuthenticationSnapshotProvider? = nil,
        realEstateOriginalsPreflight: RealEstateOriginalsPreflightProvider? = nil
    ) {
        let resolvedAppURL = appURL ?? Self.defaultAppURL
        let mainRelease = BackstageReleaseIdentity(bundle: Bundle.main)
        let resolvedRelease = release
            ?? (mainRelease.isComplete
                ? mainRelease
                : BackstageReleaseIdentity(bundle: Bundle(url: resolvedAppURL) ?? Bundle.main))
        self.release = resolvedRelease
        self.photoLibrary = photoLibrary
        self.connectorIdentity = connectorIdentity
        self.rawRecoveryDirectory = BackstagePreviewIPCConstants.defaultExportDirectory()
            .deletingLastPathComponent()
            .appendingPathComponent("raw-recovery-samples", isDirectory: true)
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
        async let owner = authenticationSnapshot()
        async let connectorID = connectorIdentity.connectorID()
        let photoAccess = photoLibrary.authorization()
        let ownerSnapshot = await owner
        let resolvedConnectorID = await connectorID
        let photoAccessLabel = Self.photoAccessLabel(photoAccess)
        let releaseReady = release.isComplete
        let photosReady = releaseReady && [.authorized, .limited].contains(photoAccess)
        let commandReady = command == "release verify" ? releaseReady : photosReady

        return BackstageControlHealth(
            command: command,
            ok: commandReady,
            release: release,
            photoLibraryAccess: photoAccessLabel,
            ownerSession: ownerSnapshot.phase.rawValue,
            ownerAuthenticated: ownerSnapshot.phase == .authenticated,
            connectorID: resolvedConnectorID,
            message: message(
                photoAccess: photoAccessLabel,
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

    public func rawRecoveryPlan(sampleLimit: Int = 8) async throws -> RawRecoveryPlan {
        try await photoLibrary.rawRecoveryPlan(sampleLimit: sampleLimit)
    }

    public func recoverRawJPEGSample(
        localIdentifier: String,
        maxPixelSize: Int = 8_192,
        minimumPixels: Int = RawRecoveryPolicy.minimumPublicationPixels
    ) async throws -> RawRecoveryReceipt {
        try await photoLibrary.recoverRawJPEG(
            localIdentifier: localIdentifier,
            maxPixelSize: maxPixelSize,
            minimumPixels: minimumPixels,
            to: rawRecoveryDirectory
        )
    }

    private func message(
        photoAccess: String,
        ownerSnapshot: OwnerAuthenticationSnapshot,
        releaseReady: Bool,
        photosReady: Bool,
        command: String
    ) -> String {
        guard release.isComplete else {
            return "Backstage release metadata is unavailable. Run this command from the installed Backstage app."
        }
        if command == "release verify" {
            return "Backstage release metadata is complete; no standalone Photos helper is required."
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
      backstage-control photos raw-recovery plan [--sample-limit <0-32>] [--pretty]
      backstage-control photos raw-recovery sample --asset-id <Photos-local-ID> [--max-pixel <256-8192>] [--minimum-megapixels <1-100>] [--pretty]
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
        if Array(tokens.prefix(3)) == ["photos", "raw-recovery", "plan"] {
            return await emitRawRecoveryPlan(
                arguments: Array(tokens.dropFirst(3)),
                pretty: pretty,
                service: service,
                output: output
            )
        }
        if Array(tokens.prefix(3)) == ["photos", "raw-recovery", "sample"] {
            return await emitRawRecoverySample(
                arguments: Array(tokens.dropFirst(3)),
                pretty: pretty,
                service: service,
                output: output
            )
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

    private static func emitRawRecoveryPlan(
        arguments: [String],
        pretty: Bool,
        service: BackstageControlService,
        output: @escaping @Sendable (String) -> Void
    ) async -> Int32 {
        var sampleLimit = 8
        var index = 0
        while index < arguments.count {
            guard arguments[index] == "--sample-limit",
                  index + 1 < arguments.count,
                  let value = Int(arguments[index + 1]),
                  (0...32).contains(value) else {
                return emitError(
                    code: "invalid_arguments",
                    message: "RAW recovery plan accepts only --sample-limit from 0 to 32.",
                    pretty: pretty,
                    exitCode: 64,
                    output: output
                )
            }
            sampleLimit = value
            index += 2
        }
        do {
            let plan = try await service.rawRecoveryPlan(sampleLimit: sampleLimit)
            output(encode(plan, pretty: pretty))
            return plan.ok ? 0 : 2
        } catch {
            return emitError(
                code: "raw_recovery_plan_failed",
                message: error.localizedDescription,
                pretty: pretty,
                exitCode: 1,
                output: output
            )
        }
    }

    private static func emitRawRecoverySample(
        arguments: [String],
        pretty: Bool,
        service: BackstageControlService,
        output: @escaping @Sendable (String) -> Void
    ) async -> Int32 {
        var assetID: String?
        var maxPixel = 8_192
        var minimumMegapixels = 1
        var index = 0
        while index < arguments.count {
            let argument = arguments[index]
            guard ["--asset-id", "--max-pixel", "--minimum-megapixels"].contains(argument),
                  index + 1 < arguments.count else {
                return emitError(
                    code: "invalid_arguments",
                    message: "RAW recovery sample requires --asset-id and supports bounded pixel options.",
                    pretty: pretty,
                    exitCode: 64,
                    output: output
                )
            }
            let value = arguments[index + 1]
            switch argument {
            case "--asset-id":
                guard assetID == nil, !value.isEmpty, value.utf8.count <= 2_048 else {
                    return emitError(
                        code: "invalid_arguments",
                        message: "--asset-id must be one non-empty Photos local identifier.",
                        pretty: pretty,
                        exitCode: 64,
                        output: output
                    )
                }
                assetID = value
            case "--max-pixel":
                guard let parsed = Int(value), (256...8_192).contains(parsed) else {
                    return emitError(
                        code: "invalid_arguments",
                        message: "--max-pixel must be between 256 and 8192.",
                        pretty: pretty,
                        exitCode: 64,
                        output: output
                    )
                }
                maxPixel = parsed
            default:
                guard let parsed = Int(value), (1...100).contains(parsed) else {
                    return emitError(
                        code: "invalid_arguments",
                        message: "--minimum-megapixels must be between 1 and 100.",
                        pretty: pretty,
                        exitCode: 64,
                        output: output
                    )
                }
                minimumMegapixels = parsed
            }
            index += 2
        }
        guard let assetID else {
            return emitError(
                code: "invalid_arguments",
                message: "RAW recovery sample requires --asset-id.",
                pretty: pretty,
                exitCode: 64,
                output: output
            )
        }
        do {
            let receipt = try await service.recoverRawJPEGSample(
                localIdentifier: assetID,
                maxPixelSize: maxPixel,
                minimumPixels: minimumMegapixels * 1_000_000
            )
            output(encode(receipt, pretty: pretty))
            return receipt.ok ? 0 : 2
        } catch {
            return emitError(
                code: "raw_recovery_sample_failed",
                message: error.localizedDescription,
                pretty: pretty,
                exitCode: 1,
                output: output
            )
        }
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
