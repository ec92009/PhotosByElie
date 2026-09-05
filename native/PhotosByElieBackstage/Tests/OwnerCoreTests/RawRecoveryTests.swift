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

    @Test("Blue-cast detection uses neutral midtones without condemning blue scenes")
    func blueCastDetectionUsesNeutralMidtones() {
        let balanced = Array(
            repeating: RawRecoveryColorSample(red: 0.50, green: 0.51, blue: 0.52),
            count: 128
        )
        let cast = Array(
            repeating: RawRecoveryColorSample(red: 0.455, green: 0.485, blue: 0.53),
            count: 128
        )
        let blueScene = Array(
            repeating: RawRecoveryColorSample(red: 0.10, green: 0.40, blue: 0.90),
            count: 128
        )
        let oceanWithNeutralWake = Array(
            repeating: RawRecoveryColorSample(red: 0.22, green: 0.32, blue: 0.37),
            count: 96
        ) + Array(
            repeating: RawRecoveryColorSample(red: 0.78, green: 0.79, blue: 0.80),
            count: 32
        )

        #expect(RawRecoveryColorPolicy.assess(samples: balanced).verdict == .pass)
        #expect(RawRecoveryColorPolicy.assess(samples: cast).verdict == .suspectBlueCast)
        #expect(RawRecoveryColorPolicy.assess(samples: blueScene).verdict == .inconclusive)
        #expect(RawRecoveryColorPolicy.assess(samples: oceanWithNeutralWake).verdict == .pass)
    }

    @Test("A bounded batch resumes without replay and quarantines cast derivatives")
    func boundedBatchResumesWithoutReplay() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("raw-batch-test-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let candidates = (1...3).map { index in
            RawRecoveryCandidate(
                localIdentifier: "raw-local-\(index)",
                filename: "IMG_000\(index).CR3",
                resourceFormat: "RAW",
                sourcePixelWidth: 6_000,
                sourcePixelHeight: 4_000,
                capturedAt: "2026-08-29T13:0\(index):00Z"
            )
        }
        let library = RawRecoveryBatchTestLibrary(candidates: candidates)
        let service = RawRecoveryBatchService(
            photoLibrary: library,
            capacityProvider: { _ in 50_000_000_000 },
            clock: { Date(timeIntervalSince1970: 1_788_000_000) }
        )

        let first = try await service.start(
            rootDirectory: root,
            queueWindow: 3,
            maxItemsThisRun: 2,
            reserveBytes: 15_000_000_000
        )
        #expect(first.state == .pausedOperator)
        #expect(first.queued == 3)
        #expect(first.generated == 1)
        #expect(first.quarantinedBlueCast == 1)
        #expect(first.pending == 1)

        let resumed = try await service.resume(rootDirectory: root, maxItemsThisRun: 3)
        #expect(resumed.state == .completed)
        #expect(resumed.generated == 2)
        #expect(resumed.quarantinedBlueCast == 1)
        #expect(resumed.pending == 0)
        #expect(library.recoveryCalls == ["raw-local-1", "raw-local-2", "raw-local-3"])

        let ledgerData = try Data(contentsOf: root.appendingPathComponent("raw-recovery-ledger.json"))
        let ledger = try JSONDecoder().decode(RawRecoveryLedger.self, from: ledgerData)
        #expect(ledger.entries.count == 3)
        #expect(ledger.entries["raw-local-2"]?.state == .quarantinedBlueCast)
    }

    @Test("A batch pauses before crossing its storage reserve")
    func batchHonorsCapacityReserve() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("raw-capacity-test-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let candidate = RawRecoveryCandidate(
            localIdentifier: "raw-local-capacity",
            filename: "CAPACITY.CR3",
            resourceFormat: "RAW",
            sourcePixelWidth: 6_000,
            sourcePixelHeight: 4_000
        )
        let library = RawRecoveryBatchTestLibrary(candidates: [candidate])
        let service = RawRecoveryBatchService(
            photoLibrary: library,
            capacityProvider: { _ in 14_999_999_999 }
        )
        let result = try await service.start(
            rootDirectory: root,
            queueWindow: 1,
            maxItemsThisRun: 1,
            reserveBytes: 15_000_000_000
        )
        #expect(result.state == .pausedCapacity)
        #expect(result.pending == 1)
        #expect(library.recoveryCalls.isEmpty)
    }

    @Test("Control CLI cannot use Photos authority for standalone RAW recovery")
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

        for arguments in [
            ["photos", "raw-recovery", "plan", "--sample-limit", "1"],
            ["photos", "raw-recovery", "sample", "--asset-id", "raw-local-1"],
            ["photos", "raw-recovery", "batch", "start"],
            ["photos", "raw-recovery", "batch", "resume"],
            ["photos", "raw-recovery", "batch", "index"],
        ] {
            let captured = RawRecoveryLockedOutput()
            let exitCode = await BackstageControlCLI.run(arguments: arguments, service: service,
                output: { captured.append($0) })
            #expect(exitCode == 2)
            let text = try #require(captured.values.last)
            let payload = try #require(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
            #expect((payload["error"] as? [String: Any])?["code"] as? String == "photos_job_authorization_required")
        }
        #expect(library.lastSampleBounds == nil)

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
    func rawRecoveryBatchIndex(rootDirectory: URL) async throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 1,
            "ok": true,
            "command": "photos raw-recovery batch index",
            "mode": "exact-completed-batch-index",
            "batchID": "raw-test",
            "requestedCount": 1,
            "indexedCount": 1,
            "missingCount": 0,
            "items": [["assetId": "raw-local-1"]],
        ])
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

private final class RawRecoveryBatchTestLibrary: PhotoLibraryServing, @unchecked Sendable {
    private let lock = NSLock()
    private let candidates: [RawRecoveryCandidate]
    private var calls: [String] = []

    init(candidates: [RawRecoveryCandidate]) {
        self.candidates = candidates
    }

    var recoveryCalls: [String] { lock.withLock { calls } }

    func authorization() -> PhotoLibraryAccess { .authorized }
    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }
    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }
    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }
    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }
    func rawRecoveryCandidates(
        limit: Int,
        excludingLocalIdentifiers: Set<String>
    ) async throws -> [RawRecoveryCandidate] {
        candidates.filter { !excludingLocalIdentifiers.contains($0.localIdentifier) }.prefix(limit).map { $0 }
    }
    func recoverRawJPEG(
        localIdentifier: String,
        maxPixelSize: Int,
        minimumPixels: Int,
        to directory: URL
    ) async throws -> RawRecoveryReceipt {
        lock.withLock { calls.append(localIdentifier) }
        let suspect = localIdentifier == "raw-local-2"
        return RawRecoveryReceipt(
            generatedAt: "2026-08-29T13:10:00Z",
            localIdentifier: localIdentifier,
            sourceAnchor: "apple-photos://\(localIdentifier)",
            sourceFilename: "\(localIdentifier).CR3",
            sourceFormat: "RAW",
            sourcePixelWidth: 6_000,
            sourcePixelHeight: 4_000,
            rung: .photosRenderedCurrent,
            pixelWidth: 6_000,
            pixelHeight: 4_000,
            colorProfile: "sRGB",
            byteCount: 6_000_000,
            checksumSHA256: String(repeating: suspect ? "b" : "a", count: 64),
            relativePath: "\(localIdentifier).jpg",
            receiptRelativePath: "\(localIdentifier).receipt.json",
            reusedExisting: false,
            publicationProducts: ["1MP", "3MP", "6MP"],
            technicalEligibility: suspect ? "quarantined-blue-cast" : "candidate-after-review",
            qualityAssessment: RawRecoveryQualityAssessment(
                verdict: suspect ? .suspectBlueCast : .pass,
                sampledPixelCount: 128,
                neutralPixelCount: 128,
                neutralPixelFraction: 1,
                meanBlueExcess: suspect ? 0.08 : 0.01,
                meanCoolExcess: suspect ? 0.08 : 0.01,
                score: suspect ? 1.4 : 0.2,
                notes: []
            ),
            failedRungs: [],
            notes: []
        )
    }
}
