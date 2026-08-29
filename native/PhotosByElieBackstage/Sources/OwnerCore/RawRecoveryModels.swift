import Foundation

public enum RawRecoveryRung: String, Codable, CaseIterable, Sendable {
    case photosRenderedCurrent = "photos-rendered-current"
    case embeddedJPEGPreview = "embedded-jpeg-preview"
    case coreImageRAW = "core-image-raw"
}

public struct RawRecoveryCandidate: Codable, Sendable, Equatable {
    public var localIdentifier: String
    public var filename: String
    public var resourceFormat: String
    public var sourcePixelWidth: Int
    public var sourcePixelHeight: Int

    public init(
        localIdentifier: String,
        filename: String,
        resourceFormat: String,
        sourcePixelWidth: Int,
        sourcePixelHeight: Int
    ) {
        self.localIdentifier = localIdentifier
        self.filename = filename
        self.resourceFormat = resourceFormat
        self.sourcePixelWidth = sourcePixelWidth
        self.sourcePixelHeight = sourcePixelHeight
    }
}

public struct RawRecoveryPlan: Codable, Sendable, Equatable {
    public var schemaVersion: Int
    public var command: String
    public var mode: String
    public var checkedAt: String
    public var ok: Bool
    public var photosImageCount: Int
    public var rawOnlyCount: Int
    public var totalSourcePixels: Int64
    public var estimatedJPEGStorageLowBytes: Int64
    public var estimatedJPEGStorageHighBytes: Int64
    public var sampleCandidates: [RawRecoveryCandidate]
    public var notes: [String]

    public init(
        schemaVersion: Int = 1,
        command: String = "photos raw-recovery plan",
        mode: String = "read-only",
        checkedAt: String,
        ok: Bool = true,
        photosImageCount: Int,
        rawOnlyCount: Int,
        totalSourcePixels: Int64,
        estimatedJPEGStorageLowBytes: Int64,
        estimatedJPEGStorageHighBytes: Int64,
        sampleCandidates: [RawRecoveryCandidate],
        notes: [String]
    ) {
        self.schemaVersion = schemaVersion
        self.command = command
        self.mode = mode
        self.checkedAt = checkedAt
        self.ok = ok
        self.photosImageCount = photosImageCount
        self.rawOnlyCount = rawOnlyCount
        self.totalSourcePixels = totalSourcePixels
        self.estimatedJPEGStorageLowBytes = estimatedJPEGStorageLowBytes
        self.estimatedJPEGStorageHighBytes = estimatedJPEGStorageHighBytes
        self.sampleCandidates = sampleCandidates
        self.notes = notes
    }
}

public struct RawRecoveryReceipt: Codable, Sendable, Equatable {
    public var schemaVersion: Int
    public var command: String
    public var mode: String
    public var generatedAt: String
    public var ok: Bool
    public var localIdentifier: String
    public var sourceAnchor: String
    public var sourceFilename: String
    public var sourceFormat: String
    public var sourcePixelWidth: Int
    public var sourcePixelHeight: Int
    public var rung: RawRecoveryRung
    public var pixelWidth: Int
    public var pixelHeight: Int
    public var colorProfile: String
    public var byteCount: Int64
    public var checksumSHA256: String
    public var relativePath: String
    public var receiptRelativePath: String
    public var reusedExisting: Bool
    public var publicationProducts: [String]
    public var technicalEligibility: String
    public var workflowState: String
    public var requiresReview: Bool
    public var failedRungs: [String]
    public var notes: [String]

    public init(
        schemaVersion: Int = 1,
        command: String = "photos raw-recovery sample",
        mode: String = "bounded-private-sample",
        generatedAt: String,
        ok: Bool = true,
        localIdentifier: String,
        sourceAnchor: String,
        sourceFilename: String,
        sourceFormat: String,
        sourcePixelWidth: Int,
        sourcePixelHeight: Int,
        rung: RawRecoveryRung,
        pixelWidth: Int,
        pixelHeight: Int,
        colorProfile: String,
        byteCount: Int64,
        checksumSHA256: String,
        relativePath: String,
        receiptRelativePath: String,
        reusedExisting: Bool,
        publicationProducts: [String],
        technicalEligibility: String,
        workflowState: String = "needs-review",
        requiresReview: Bool = true,
        failedRungs: [String],
        notes: [String]
    ) {
        self.schemaVersion = schemaVersion
        self.command = command
        self.mode = mode
        self.generatedAt = generatedAt
        self.ok = ok
        self.localIdentifier = localIdentifier
        self.sourceAnchor = sourceAnchor
        self.sourceFilename = sourceFilename
        self.sourceFormat = sourceFormat
        self.sourcePixelWidth = sourcePixelWidth
        self.sourcePixelHeight = sourcePixelHeight
        self.rung = rung
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.colorProfile = colorProfile
        self.byteCount = byteCount
        self.checksumSHA256 = checksumSHA256
        self.relativePath = relativePath
        self.receiptRelativePath = receiptRelativePath
        self.reusedExisting = reusedExisting
        self.publicationProducts = publicationProducts
        self.technicalEligibility = technicalEligibility
        self.workflowState = workflowState
        self.requiresReview = requiresReview
        self.failedRungs = failedRungs
        self.notes = notes
    }
}

public struct RawRecoveryAttempt: Sendable, Equatable {
    public var rung: RawRecoveryRung
    public var pixelWidth: Int
    public var pixelHeight: Int
    public var colorProfile: String
    public var isJPEG: Bool
    public var orientationApplied: Bool

    public init(
        rung: RawRecoveryRung,
        pixelWidth: Int,
        pixelHeight: Int,
        colorProfile: String,
        isJPEG: Bool,
        orientationApplied: Bool
    ) {
        self.rung = rung
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.colorProfile = colorProfile
        self.isJPEG = isJPEG
        self.orientationApplied = orientationApplied
    }
}

public enum RawRecoveryPolicy {
    public static let minimumPublicationPixels = 1_000_000

    public static func publicationProducts(pixelWidth: Int, pixelHeight: Int) -> [String] {
        let pixels = max(0, Int64(pixelWidth)) * max(0, Int64(pixelHeight))
        return [(1_000_000, "1MP"), (3_000_000, "3MP"), (6_000_000, "6MP")]
            .compactMap { pixels >= $0.0 ? $0.1 : nil }
    }

    public static func passes(
        _ attempt: RawRecoveryAttempt,
        sourcePixelWidth: Int,
        sourcePixelHeight: Int,
        minimumPixels: Int = minimumPublicationPixels
    ) -> Bool {
        guard attempt.isJPEG,
              attempt.orientationApplied,
              attempt.colorProfile == "sRGB",
              attempt.pixelWidth > 0,
              attempt.pixelHeight > 0,
              Int64(attempt.pixelWidth) * Int64(attempt.pixelHeight) >= Int64(minimumPixels)
        else { return false }

        let directFit = attempt.pixelWidth <= sourcePixelWidth
            && attempt.pixelHeight <= sourcePixelHeight
        let rotatedFit = attempt.pixelWidth <= sourcePixelHeight
            && attempt.pixelHeight <= sourcePixelWidth
        return directFit || rotatedFit
    }

    public static func firstPassing(
        _ attempts: [RawRecoveryAttempt],
        sourcePixelWidth: Int,
        sourcePixelHeight: Int,
        minimumPixels: Int = minimumPublicationPixels
    ) -> RawRecoveryAttempt? {
        for rung in RawRecoveryRung.allCases {
            if let attempt = attempts.first(where: { $0.rung == rung }),
               passes(
                attempt,
                sourcePixelWidth: sourcePixelWidth,
                sourcePixelHeight: sourcePixelHeight,
                minimumPixels: minimumPixels
               ) {
                return attempt
            }
        }
        return nil
    }
}
