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
    public var capturedAt: String

    public init(
        localIdentifier: String,
        filename: String,
        resourceFormat: String,
        sourcePixelWidth: Int,
        sourcePixelHeight: Int,
        capturedAt: String = ""
    ) {
        self.localIdentifier = localIdentifier
        self.filename = filename
        self.resourceFormat = resourceFormat
        self.sourcePixelWidth = sourcePixelWidth
        self.sourcePixelHeight = sourcePixelHeight
        self.capturedAt = capturedAt
    }
}

public enum RawRecoveryColorVerdict: String, Codable, Sendable {
    case pass
    case suspectBlueCast = "suspect-blue-cast"
    case inconclusive
}

public struct RawRecoveryColorSample: Sendable, Equatable {
    public var red: Double
    public var green: Double
    public var blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }
}

public struct RawRecoveryQualityAssessment: Codable, Sendable, Equatable {
    public var schemaVersion: Int
    public var detector: String
    public var verdict: RawRecoveryColorVerdict
    public var sampledPixelCount: Int
    public var neutralPixelCount: Int
    public var neutralPixelFraction: Double
    public var meanBlueExcess: Double
    public var meanCoolExcess: Double
    public var score: Double
    public var notes: [String]

    public init(
        schemaVersion: Int = 1,
        detector: String = "neutral-pixel-blue-cast-v1",
        verdict: RawRecoveryColorVerdict,
        sampledPixelCount: Int,
        neutralPixelCount: Int,
        neutralPixelFraction: Double,
        meanBlueExcess: Double,
        meanCoolExcess: Double,
        score: Double,
        notes: [String]
    ) {
        self.schemaVersion = schemaVersion
        self.detector = detector
        self.verdict = verdict
        self.sampledPixelCount = sampledPixelCount
        self.neutralPixelCount = neutralPixelCount
        self.neutralPixelFraction = neutralPixelFraction
        self.meanBlueExcess = meanBlueExcess
        self.meanCoolExcess = meanCoolExcess
        self.score = score
        self.notes = notes
    }

    public var blueCastSuspected: Bool { verdict == .suspectBlueCast }
}

public enum RawRecoveryColorPolicy {
    public static func assess(samples: [RawRecoveryColorSample]) -> RawRecoveryQualityAssessment {
        let bounded = samples.map {
            RawRecoveryColorSample(
                red: min(1, max(0, $0.red)),
                green: min(1, max(0, $0.green)),
                blue: min(1, max(0, $0.blue))
            )
        }
        let neutral = bounded.filter { sample in
            let maximum = max(sample.red, sample.green, sample.blue)
            let minimum = min(sample.red, sample.green, sample.blue)
            let luminance = (0.2126 * sample.red) + (0.7152 * sample.green) + (0.0722 * sample.blue)
            return luminance >= 0.08 && luminance <= 0.92 && maximum - minimum <= 0.18
        }
        let minimumNeutralCount = max(32, Int((Double(bounded.count) * 0.02).rounded(.up)))
        guard neutral.count >= minimumNeutralCount else {
            return RawRecoveryQualityAssessment(
                verdict: .inconclusive,
                sampledPixelCount: bounded.count,
                neutralPixelCount: neutral.count,
                neutralPixelFraction: bounded.isEmpty ? 0 : Double(neutral.count) / Double(bounded.count),
                meanBlueExcess: 0,
                meanCoolExcess: 0,
                score: 0,
                notes: [
                    "Too few neutral midtone pixels were available for a reliable cast decision.",
                    "Inconclusive derivatives remain Review-gated; blue skies and water are not treated as casts by themselves.",
                ]
            )
        }

        let blueExcess = neutral.map { $0.blue - (($0.red + $0.green) / 2) }
        let coolExcess = neutral.map { (($0.green + $0.blue) / 2) - $0.red }
        let meanBlue = blueExcess.reduce(0, +) / Double(blueExcess.count)
        let meanCool = coolExcess.reduce(0, +) / Double(coolExcess.count)
        let score = max(meanBlue / 0.055, meanCool / 0.065)
        let suspect = meanBlue >= 0.055 || meanCool >= 0.065
        return RawRecoveryQualityAssessment(
            verdict: suspect ? .suspectBlueCast : .pass,
            sampledPixelCount: bounded.count,
            neutralPixelCount: neutral.count,
            neutralPixelFraction: Double(neutral.count) / Double(bounded.count),
            meanBlueExcess: meanBlue,
            meanCoolExcess: meanCool,
            score: score,
            notes: suspect
                ? ["Neutral midtones show a systematic blue/cyan displacement; quarantine for human Review."]
                : ["Neutral midtones do not show a systematic blue/cyan displacement." ]
        )
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
    public var qualityAssessment: RawRecoveryQualityAssessment?
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
        qualityAssessment: RawRecoveryQualityAssessment? = nil,
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
        self.qualityAssessment = qualityAssessment
        self.failedRungs = failedRungs
        self.notes = notes
    }
}

public enum RawRecoveryBatchItemState: String, Codable, Sendable {
    case pending
    case generated
    case quarantinedBlueCast = "quarantined-blue-cast"
    case failed
    case disposedAfterUpload = "disposed-after-upload"
    case disposedAfterRejection = "disposed-after-rejection"
}

public struct RawRecoveryBatchItem: Codable, Sendable, Equatable {
    public var candidate: RawRecoveryCandidate
    public var state: RawRecoveryBatchItemState
    public var receiptRelativePath: String
    public var error: String
    public var updatedAt: String

    public init(
        candidate: RawRecoveryCandidate,
        state: RawRecoveryBatchItemState = .pending,
        receiptRelativePath: String = "",
        error: String = "",
        updatedAt: String = ""
    ) {
        self.candidate = candidate
        self.state = state
        self.receiptRelativePath = receiptRelativePath
        self.error = error
        self.updatedAt = updatedAt
    }
}

public enum RawRecoveryBatchState: String, Codable, Sendable {
    case running
    case pausedCapacity = "paused-capacity"
    case pausedOperator = "paused-operator"
    case completed
    case cancelled
}

public struct RawRecoveryBatchManifest: Codable, Sendable, Equatable {
    public var schemaVersion: Int
    public var command: String
    public var mode: String
    public var batchID: String
    public var createdAt: String
    public var updatedAt: String
    public var state: RawRecoveryBatchState
    public var stopReason: String
    public var queueWindow: Int
    public var maxPixelSize: Int
    public var minimumPixels: Int
    public var reserveBytes: Int64
    public var outputRelativePath: String
    public var items: [RawRecoveryBatchItem]

    public init(
        schemaVersion: Int = 1,
        command: String = "photos raw-recovery batch",
        mode: String = "bounded-private-batch",
        batchID: String,
        createdAt: String,
        updatedAt: String,
        state: RawRecoveryBatchState,
        stopReason: String = "",
        queueWindow: Int,
        maxPixelSize: Int,
        minimumPixels: Int,
        reserveBytes: Int64,
        outputRelativePath: String,
        items: [RawRecoveryBatchItem]
    ) {
        self.schemaVersion = schemaVersion
        self.command = command
        self.mode = mode
        self.batchID = batchID
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.state = state
        self.stopReason = stopReason
        self.queueWindow = queueWindow
        self.maxPixelSize = maxPixelSize
        self.minimumPixels = minimumPixels
        self.reserveBytes = reserveBytes
        self.outputRelativePath = outputRelativePath
        self.items = items
    }
}

public struct RawRecoveryLedgerEntry: Codable, Sendable, Equatable {
    public var localIdentifier: String
    public var sourceFilename: String
    public var batchID: String
    public var state: RawRecoveryBatchItemState
    public var receiptRelativePath: String
    public var updatedAt: String
}

public struct RawRecoveryLedger: Codable, Sendable, Equatable {
    public var schemaVersion: Int
    public var entries: [String: RawRecoveryLedgerEntry]

    public init(schemaVersion: Int = 1, entries: [String: RawRecoveryLedgerEntry] = [:]) {
        self.schemaVersion = schemaVersion
        self.entries = entries
    }
}

public struct RawRecoveryBatchResult: Codable, Sendable, Equatable {
    public var schemaVersion: Int
    public var command: String
    public var mode: String
    public var ok: Bool
    public var batchID: String
    public var state: RawRecoveryBatchState
    public var queued: Int
    public var pending: Int
    public var generated: Int
    public var quarantinedBlueCast: Int
    public var failed: Int
    public var disposed: Int
    public var processedThisRun: Int
    public var availableCapacityBytes: Int64
    public var reserveBytes: Int64
    public var destination: String
    public var stopReason: String

    public init(
        schemaVersion: Int = 1,
        command: String = "photos raw-recovery batch",
        mode: String = "bounded-private-batch",
        ok: Bool,
        batchID: String,
        state: RawRecoveryBatchState,
        queued: Int,
        pending: Int,
        generated: Int,
        quarantinedBlueCast: Int,
        failed: Int,
        disposed: Int,
        processedThisRun: Int,
        availableCapacityBytes: Int64,
        reserveBytes: Int64,
        destination: String,
        stopReason: String
    ) {
        self.schemaVersion = schemaVersion
        self.command = command
        self.mode = mode
        self.ok = ok
        self.batchID = batchID
        self.state = state
        self.queued = queued
        self.pending = pending
        self.generated = generated
        self.quarantinedBlueCast = quarantinedBlueCast
        self.failed = failed
        self.disposed = disposed
        self.processedThisRun = processedThisRun
        self.availableCapacityBytes = availableCapacityBytes
        self.reserveBytes = reserveBytes
        self.destination = destination
        self.stopReason = stopReason
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
