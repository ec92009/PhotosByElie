import Foundation

public struct BackstageUpdateResourceLimits: Sendable, Equatable {
    public static let hardMaximumArchiveFileSize: Int64 = 1_073_741_824
    public static let hardMaximumExtractedRegularFileSize: Int64 = 4_294_967_296
    public static let hardMaximumExtractedEntryCount = 50_000

    public static let standard = BackstageUpdateResourceLimits()

    public let maximumArchiveFileSize: Int64
    public let maximumExtractedRegularFileSize: Int64
    public let maximumExtractedEntryCount: Int

    public init(
        maximumArchiveFileSize: Int64 = Self.hardMaximumArchiveFileSize,
        maximumExtractedRegularFileSize: Int64 = Self.hardMaximumExtractedRegularFileSize,
        maximumExtractedEntryCount: Int = Self.hardMaximumExtractedEntryCount
    ) {
        self.maximumArchiveFileSize = min(
            max(maximumArchiveFileSize, 1),
            Self.hardMaximumArchiveFileSize
        )
        self.maximumExtractedRegularFileSize = min(
            max(maximumExtractedRegularFileSize, 1),
            Self.hardMaximumExtractedRegularFileSize
        )
        self.maximumExtractedEntryCount = min(
            max(maximumExtractedEntryCount, 1),
            Self.hardMaximumExtractedEntryCount
        )
    }
}

public struct BackstageReleaseTrust: Codable, Sendable, Equatable {
    public var teamIdentifier: String
    public var signingIdentity: String
    public var designatedRequirement: String

    public init(
        teamIdentifier: String,
        signingIdentity: String,
        designatedRequirement: String
    ) {
        self.teamIdentifier = teamIdentifier
        self.signingIdentity = signingIdentity
        self.designatedRequirement = designatedRequirement
    }
}

public struct BackstageReleaseManifest: Codable, Sendable, Equatable {
    public static let currentSchemaVersion = 1
    public static let productName = "PhotosByElie Backstage"
    public static let bundleIdentifier = "com.photosbyelie.backstage"

    public var schemaVersion: Int
    public var product: String
    public var bundleIdentifier: String
    public var version: String
    public var build: String
    public var minimumOSVersion: String
    public var releaseNotes: String
    public var artifactFormat: String
    public var architectures: [String]?
    public var downloadURL: URL
    public var fileSize: Int64
    public var sha256: String
    public var trust: BackstageReleaseTrust

    public init(
        schemaVersion: Int = BackstageReleaseManifest.currentSchemaVersion,
        product: String = BackstageReleaseManifest.productName,
        bundleIdentifier: String = BackstageReleaseManifest.bundleIdentifier,
        version: String,
        build: String,
        minimumOSVersion: String,
        releaseNotes: String,
        artifactFormat: String = "zip",
        architectures: [String]? = nil,
        downloadURL: URL,
        fileSize: Int64,
        sha256: String,
        trust: BackstageReleaseTrust
    ) {
        self.schemaVersion = schemaVersion
        self.product = product
        self.bundleIdentifier = bundleIdentifier
        self.version = version
        self.build = build
        self.minimumOSVersion = minimumOSVersion
        self.releaseNotes = releaseNotes
        self.artifactFormat = artifactFormat
        self.architectures = architectures
        self.downloadURL = downloadURL
        self.fileSize = fileSize
        self.sha256 = sha256
        self.trust = trust
    }

    public func validate(
        maximumFileSize: Int64 = BackstageUpdateResourceLimits.hardMaximumArchiveFileSize
    ) throws {
        guard schemaVersion == Self.currentSchemaVersion else {
            throw BackstageUpdateError.invalidManifest("Unsupported manifest schema version \(schemaVersion).")
        }
        guard product == Self.productName else {
            throw BackstageUpdateError.invalidManifest("Manifest product is not PhotosByElie Backstage.")
        }
        guard bundleIdentifier == Self.bundleIdentifier else {
            throw BackstageUpdateError.invalidManifest("Manifest bundle identifier is not the stable Backstage identity.")
        }
        guard BackstageReleaseNumber.isValid(version),
              build.range(of: "^[0-9]+$", options: .regularExpression) != nil,
              Int(build) != nil else {
            throw BackstageUpdateError.invalidManifest("Manifest version and build must be numeric release values.")
        }
        guard BackstageReleaseNumber.isValid(minimumOSVersion) else {
            throw BackstageUpdateError.invalidManifest("Manifest minimumOSVersion is not a dotted numeric version.")
        }
        guard artifactFormat == "zip" else {
            throw BackstageUpdateError.invalidManifest("Backstage updates must be ZIP archives containing one app bundle.")
        }
        if let architectures {
            let architectureSet = Set(architectures)
            let isAppleSiliconRelease = architectureSet == Set(["arm64"]) && architectures.count == 1
            let isLegacyUniversalRelease = architectureSet == Set(["arm64", "x86_64"])
                && architectures.count == 2
            guard isAppleSiliconRelease || isLegacyUniversalRelease else {
                throw BackstageUpdateError.invalidManifest(
                    "Manifest architectures must identify an arm64 Apple-silicon release; legacy universal arm64/x86_64 manifests are accepted for rollback compatibility."
                )
            }
        }
        guard downloadURL.scheme?.lowercased() == "https",
              let downloadHost = downloadURL.host,
              !downloadHost.isEmpty,
              downloadURL.user == nil,
              downloadURL.password == nil else {
            throw BackstageUpdateError.invalidManifest("Manifest downloadURL must be an HTTPS URL.")
        }
        let effectiveMaximumFileSize = min(
            max(maximumFileSize, 1),
            BackstageUpdateResourceLimits.hardMaximumArchiveFileSize
        )
        guard fileSize > 0, fileSize <= effectiveMaximumFileSize else {
            throw BackstageUpdateError.invalidManifest(
                "Manifest fileSize must be between 1 and \(effectiveMaximumFileSize) bytes."
            )
        }
        guard sha256.range(of: "^[0-9a-fA-F]{64}$", options: .regularExpression) != nil else {
            throw BackstageUpdateError.invalidManifest("Manifest sha256 must contain exactly 64 hexadecimal characters.")
        }
        guard !releaseNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BackstageUpdateError.invalidManifest("Manifest releaseNotes must explain the available release.")
        }
        let trustValues = [
            trust.teamIdentifier,
            trust.signingIdentity,
            trust.designatedRequirement,
        ]
        guard trustValues.allSatisfy({ value in
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return !trimmed.isEmpty && trimmed == value
        }) else {
            throw BackstageUpdateError.invalidManifest("Manifest signing trust data is incomplete.")
        }
    }
}

public enum BackstageUpdateAvailability: String, Sendable, Equatable {
    case current
    case updateAvailable
    case downgradeRejected
    case incompatible
}

public struct BackstageUpdateCheck: Sendable, Equatable {
    public var current: BackstageReleaseIdentity
    public var manifest: BackstageReleaseManifest
    public var availability: BackstageUpdateAvailability

    public init(
        current: BackstageReleaseIdentity,
        manifest: BackstageReleaseManifest,
        availability: BackstageUpdateAvailability
    ) {
        self.current = current
        self.manifest = manifest
        self.availability = availability
    }
}

public struct BackstageVerifiedUpdate: Sendable, Equatable {
    public var manifest: BackstageReleaseManifest
    public var archiveURL: URL
    public var bundleURL: URL

    public init(manifest: BackstageReleaseManifest, archiveURL: URL, bundleURL: URL) {
        self.manifest = manifest
        self.archiveURL = archiveURL
        self.bundleURL = bundleURL
    }
}

public struct BackstageInstallationReceipt: Sendable, Equatable {
    public var manifest: BackstageReleaseManifest
    public var installedBundleURL: URL
    public var rollbackBundleURL: URL?
    public var reconciledStagingBundleURLs: [URL]

    public init(
        manifest: BackstageReleaseManifest,
        installedBundleURL: URL,
        rollbackBundleURL: URL?,
        reconciledStagingBundleURLs: [URL] = []
    ) {
        self.manifest = manifest
        self.installedBundleURL = installedBundleURL
        self.rollbackBundleURL = rollbackBundleURL
        self.reconciledStagingBundleURLs = reconciledStagingBundleURLs
    }
}

public enum BackstageInstallerStagingState: String, Sendable, Equatable {
    case active
    case staleVerified
    case unsafe
}

public struct BackstageInstallerStagingBundle: Sendable, Equatable {
    public var bundleURL: URL
    public var version: String?
    public var build: String?
    public var ageSeconds: TimeInterval
    public var state: BackstageInstallerStagingState
    public var detail: String

    public init(
        bundleURL: URL,
        version: String?,
        build: String?,
        ageSeconds: TimeInterval,
        state: BackstageInstallerStagingState,
        detail: String
    ) {
        self.bundleURL = bundleURL
        self.version = version
        self.build = build
        self.ageSeconds = ageSeconds
        self.state = state
        self.detail = detail
    }
}

public enum BackstageUpdateState: Sendable, Equatable {
    case idle
    case checking
    case current(BackstageReleaseManifest)
    case updateAvailable(BackstageReleaseManifest)
    case downloading(BackstageReleaseManifest, receivedBytes: Int64, totalBytes: Int64)
    case verified(BackstageVerifiedUpdate)
    case installing(BackstageReleaseManifest)
    case installed(BackstageInstallationReceipt)
    case failed(message: String, recovery: String)
}

public struct BackstageUpdateConfiguration: Sendable, Equatable {
    public var manifestURL: URL?

    public init(manifestURL: URL? = nil) {
        self.manifestURL = manifestURL
    }

    public init(bundle: Bundle) {
        let rawURL = bundle.object(forInfoDictionaryKey: "PBEBackstageUpdateManifestURL") as? String
        self.manifestURL = rawURL.flatMap(URL.init(string:))
    }
}

public enum BackstageUpdateError: Error, LocalizedError, Sendable, Equatable {
    case configurationMissing
    case invalidManifest(String)
    case network(String)
    case incompatible(String)
    case downgradeRejected
    case noUpdateAvailable
    case downloadFailed(String)
    case checksumMismatch(expected: String, actual: String)
    case archiveInvalid(String)
    case signatureMismatch(String)
    case installationFailed(String)

    public var errorDescription: String? {
        switch self {
        case .configurationMissing:
            return "No authoritative Backstage release-manifest endpoint is configured."
        case let .invalidManifest(message), let .incompatible(message), let .downloadFailed(message), let .archiveInvalid(message), let .signatureMismatch(message), let .installationFailed(message):
            return message
        case let .network(message):
            return "The authoritative Backstage release check failed: \(message)"
        case .downgradeRejected:
            return "The cloud manifest is older than this installed Backstage build; downgrade was blocked."
        case .noUpdateAvailable:
            return "No compatible newer Backstage update is available."
        case let .checksumMismatch(expected, actual):
            return "The downloaded update checksum did not match the release manifest. Expected \(expected), received \(actual)."
        }
    }

    public var recoveryGuidance: String {
        switch self {
        case .configurationMissing:
            return "Ask the release owner to publish the approved HTTPS manifest and configure it in the signed app. No download or installation was attempted."
        case .downgradeRejected:
            return "Keep this installation. Ask the release owner for a newer compatible manifest; do not replace the running app with an older archive."
        case .checksumMismatch, .signatureMismatch, .archiveInvalid:
            return "The rejected temporary archive was removed. Retry only after the release owner repairs the artifact or manifest. The running app and local Owner state were not touched."
        case .incompatible:
            return "Keep this installation and use a release whose minimum macOS version and stable bundle identity match this Mac."
        case .installationFailed:
            return "Keep using the incumbent Backstage app. Its canonical bundle was preserved or restored; inspect the retained rollback copy before retrying."
        default:
            return "Retry the read-only check or download. If it continues, keep the current installation and contact the release owner."
        }
    }
}

enum BackstageReleaseNumber {
    static func isValid(_ value: String) -> Bool {
        value.range(of: "^[0-9]+(?:\\.[0-9]+)*$", options: .regularExpression) != nil
            && value.split(separator: ".").allSatisfy { Int($0) != nil }
    }

    static func compare(_ lhs: String, _ rhs: String) -> ComparisonResult? {
        guard isValid(lhs), isValid(rhs) else { return nil }
        let left = lhs.split(separator: ".").map { Int($0)! }
        let right = rhs.split(separator: ".").map { Int($0)! }
        let count = max(left.count, right.count)
        for index in 0..<count {
            let leftValue = index < left.count ? left[index] : 0
            let rightValue = index < right.count ? right[index] : 0
            if leftValue < rightValue { return .orderedAscending }
            if leftValue > rightValue { return .orderedDescending }
        }
        return .orderedSame
    }
}
