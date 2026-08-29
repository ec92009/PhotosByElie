import Foundation
import Testing
@testable import OwnerCore

@Suite("RAW-only Photos recovery")
struct RawRecoveryTests {
    @Test("The first technically valid rung wins without upscaling")
    func firstPassingRungWins() {
        let attempts = [
            RawRecoveryAttempt(
                rung: .photosRenderedCurrent,
                pixelWidth: 800,
                pixelHeight: 600,
                colorProfile: "sRGB",
                isJPEG: true,
                orientationApplied: true
            ),
            RawRecoveryAttempt(
                rung: .embeddedJPEGPreview,
                pixelWidth: 2_400,
                pixelHeight: 1_600,
                colorProfile: "sRGB",
                isJPEG: true,
                orientationApplied: true
            ),
            RawRecoveryAttempt(
                rung: .coreImageRAW,
                pixelWidth: 6_000,
                pixelHeight: 4_000,
                colorProfile: "sRGB",
                isJPEG: true,
                orientationApplied: true
            ),
        ]

        let selected = RawRecoveryPolicy.firstPassing(
            attempts,
            sourcePixelWidth: 6_000,
            sourcePixelHeight: 4_000
        )
        #expect(selected?.rung == .embeddedJPEGPreview)

        let upscaled = RawRecoveryAttempt(
            rung: .photosRenderedCurrent,
            pixelWidth: 6_001,
            pixelHeight: 4_001,
            colorProfile: "sRGB",
            isJPEG: true,
            orientationApplied: true
        )
        #expect(!RawRecoveryPolicy.passes(
            upscaled,
            sourcePixelWidth: 6_000,
            sourcePixelHeight: 4_000
        ))
    }

    @Test("Publication products reflect real pixels only")
    func publicationProductsUseRealPixels() {
        #expect(RawRecoveryPolicy.publicationProducts(pixelWidth: 1_000, pixelHeight: 999).isEmpty)
        #expect(RawRecoveryPolicy.publicationProducts(pixelWidth: 1_500, pixelHeight: 1_000) == ["1MP"])
        #expect(RawRecoveryPolicy.publicationProducts(pixelWidth: 2_000, pixelHeight: 1_500) == ["1MP", "3MP"])
        #expect(RawRecoveryPolicy.publicationProducts(pixelWidth: 3_000, pixelHeight: 2_000) == ["1MP", "3MP", "6MP"])
    }

    @Test("Control CLI exposes read-only planning and one bounded private sample")
    func controlCLIIsBoundedAndReviewGated() async throws {
        let plan = RawRecoveryPlan(
            checkedAt: "2026-08-29T13:00:00Z",
            photosImageCount: 54_202,
            rawOnlyCount: 31_547,
            totalSourcePixels: 700_000_000_000,
            estimatedJPEGStorageLowBytes: 175_000_000_000,
            estimatedJPEGStorageHighBytes: 525_000_000_000,
            sampleCandidates: [.init(
                localIdentifier: "raw-local-1",
                filename: "IMG_0001.CR3",
                resourceFormat: "RAW",
                sourcePixelWidth: 6_000,
                sourcePixelHeight: 4_000
            )],
            notes: ["read-only"]
        )
        let receipt = RawRecoveryReceipt(
            generatedAt: "2026-08-29T13:01:00Z",
            localIdentifier: "raw-local-1",
            sourceAnchor: "apple-photos://raw-local-1",
            sourceFilename: "IMG_0001.CR3",
            sourceFormat: "RAW",
            sourcePixelWidth: 6_000,
            sourcePixelHeight: 4_000,
            rung: .photosRenderedCurrent,
            pixelWidth: 6_000,
            pixelHeight: 4_000,
            colorProfile: "sRGB",
            byteCount: 8_000_000,
            checksumSHA256: String(repeating: "a", count: 64),
            relativePath: "raw-recovery-test.jpg",
            receiptRelativePath: "raw-recovery-test.receipt.json",
            reusedExisting: false,
            publicationProducts: ["1MP", "3MP", "6MP"],
            technicalEligibility: "candidate-after-review",
            failedRungs: [],
            notes: ["private sample"]
        )
        let library = RawRecoveryTestLibrary(plan: plan, receipt: receipt)
        let service = BackstageControlService(
            release: .init(
                bundleIdentifier: "com.photosbyelie.backstage",
                version: "241.7",
                build: "261"
            ),
            photoLibrary: library
        )

        let planOutput = RawRecoveryLockedOutput()
        let planExit = await BackstageControlCLI.run(
            arguments: ["photos", "raw-recovery", "plan", "--sample-limit", "1"],
            service: service,
            output: { planOutput.append($0) }
        )
        #expect(planExit == 0)
        let decodedPlan = try JSONDecoder().decode(
            RawRecoveryPlan.self,
            from: Data(try #require(planOutput.values.last).utf8)
        )
        #expect(decodedPlan == plan)

        let sampleOutput = RawRecoveryLockedOutput()
        let sampleExit = await BackstageControlCLI.run(
            arguments: [
                "photos", "raw-recovery", "sample",
                "--asset-id", "raw-local-1",
                "--max-pixel", "6000",
                "--minimum-megapixels", "1",
            ],
            service: service,
            output: { sampleOutput.append($0) }
        )
        #expect(sampleExit == 0)
        let decodedReceipt = try JSONDecoder().decode(
            RawRecoveryReceipt.self,
            from: Data(try #require(sampleOutput.values.last).utf8)
        )
        #expect(decodedReceipt == receipt)
        #expect(decodedReceipt.requiresReview)
        #expect(decodedReceipt.workflowState == "needs-review")
        #expect(decodedReceipt.technicalEligibility == "candidate-after-review")
        #expect(library.lastSampleBounds == .init(assetID: "raw-local-1", maxPixel: 6_000, minimumPixels: 1_000_000))

        let invalidExit = await BackstageControlCLI.run(
            arguments: ["photos", "raw-recovery", "sample", "--asset-id", "raw-local-1", "--max-pixel", "9000"],
            service: service,
            output: { _ in }
        )
        #expect(invalidExit == 64)
    }
}

private final class RawRecoveryTestLibrary: PhotoLibraryServing, @unchecked Sendable {
    struct Bounds: Equatable {
        var assetID: String
        var maxPixel: Int
        var minimumPixels: Int
    }

    private let lock = NSLock()
    private let plan: RawRecoveryPlan
    private let receipt: RawRecoveryReceipt
    private var bounds: Bounds?

    init(plan: RawRecoveryPlan, receipt: RawRecoveryReceipt) {
        self.plan = plan
        self.receipt = receipt
    }

    var lastSampleBounds: Bounds? {
        lock.withLock { bounds }
    }

    func authorization() -> PhotoLibraryAccess { .authorized }
    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }
    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }
    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }
    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }
    func rawRecoveryPlan(sampleLimit: Int) async throws -> RawRecoveryPlan {
        plan
    }
    func recoverRawJPEG(
        localIdentifier: String,
        maxPixelSize: Int,
        minimumPixels: Int,
        to directory: URL
    ) async throws -> RawRecoveryReceipt {
        lock.withLock {
            bounds = Bounds(
                assetID: localIdentifier,
                maxPixel: maxPixelSize,
                minimumPixels: minimumPixels
            )
        }
        return receipt
    }
}

private final class RawRecoveryLockedOutput: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var values: [String] { lock.withLock { storage } }
    func append(_ value: String) { lock.withLock { storage.append(value) } }
}
