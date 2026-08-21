import Foundation
import Testing
@testable import BackstageUI
@testable import OwnerCore

@Suite("Backstage fixture scope integration")
struct BackstageFixtureSelectionTests {
    @Test("One selection persists across launch without changing the current section or workflow history")
    @MainActor
    func authoritativeSelectionPersistsAndKeepsContext() throws {
        let suiteName = "PhotosByElieBackstageTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }

        let firstModel = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            preferences: preferences
        )
        firstModel.installFixtureTree(fixtureTree)
        firstModel.selection = .review
        firstModel.reviewHistory = [reviewHistoryEntry]
        let historyID = try #require(firstModel.reviewHistory.first?.id)

        #expect(firstModel.selectFixture("fixture-pool"))
        #expect(firstModel.selectedFixtureID == "fixture-pool")
        #expect(firstModel.selectedFixtureBreadcrumb == "RE › La Concha › Pool")
        #expect(firstModel.selection == .review)
        #expect(firstModel.reviewHistory.first?.id == historyID)
        #expect(
            preferences.string(forKey: BackstageViewModel.selectedFixturePreferenceKey)
                == "fixture-pool"
        )

        let relaunchedModel = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            preferences: preferences
        )
        relaunchedModel.installFixtureTree(fixtureTree)
        #expect(relaunchedModel.selectedFixtureID == "fixture-pool")
        #expect(relaunchedModel.selectedFixtureBreadcrumb == "RE › La Concha › Pool")
    }

    @Test("PBE Owner disables the global chooser without changing sections")
    @MainActor
    func ownerSessionDisablesChooser() throws {
        let preferences = try #require(UserDefaults(suiteName: "PhotosByElieBackstageTests.\(UUID().uuidString)"))
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            preferences: preferences
        )
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-pool",
            persistSelection: false,
            now: now
        )
        model.selection = .uploads

        let session = try model.beginPBEOwnerSession(
            expiresAt: now.addingTimeInterval(60),
            now: now
        )
        #expect(session.fixtureID == "fixture-pool")
        #expect(model.isFixtureChooserDisabled)
        #expect(model.fixtureChooserExplanation?.contains("RE › La Concha › Pool") == true)
        #expect(model.selectFixture("fixture-expo", now: now.addingTimeInterval(1)) == false)
        #expect(model.selectedFixtureID == "fixture-pool")
        #expect(model.selection == .uploads)

        model.expirePBEOwnerSessionIfNeeded(now: now.addingTimeInterval(61))
        #expect(model.selectFixture("fixture-expo", now: now.addingTimeInterval(61)))
        #expect(model.selectedFixtureID == "fixture-expo")
        #expect(model.selection == .uploads)
    }

    @Test("Unavailable fixture state clears scope and fails actions closed")
    @MainActor
    func unavailableStateFailsClosed() {
        let model = BackstageViewModel(photoLibrary: InertPhotoLibrary())
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-pool",
            persistSelection: false
        )

        model.markFixtureSelectionUnavailable("Synthetic fixture load failure.")

        #expect(model.selectedFixtureID.isEmpty)
        #expect(model.selectedFixtureBreadcrumb.isEmpty)
        #expect(model.fixtureScopedActionsAllowed == false)
        #expect(model.fixtureSelectionAvailability == .unavailable("Synthetic fixture load failure."))
        #expect(model.isFixtureChooserDisabled)
    }

    @Test("Fixture switches keep Culling on the still-photo source policy")
    @MainActor
    func fixtureSwitchRecomputesCullingMediaAvailability() throws {
        let suiteName = "PhotosByElieBackstageTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }

        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            preferences: preferences
        )
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-pool",
            persistSelection: false
        )
        model.cullingMediaFilters = [.videos]
        model.fixtureCullingWindow = cullingWindow(
            fixtureID: "fixture-pool",
            photos: 12,
            videos: 0
        )

        #expect(model.cullingMediaFilterControls == [.photos])
        #expect(model.normalizeCullingMediaFilters(for: model.cullingMediaFilterControls))
        #expect(model.cullingMediaFilters == [.photos])

        #expect(model.selectFixture("fixture-expo"))
        model.fixtureCullingWindow = cullingWindow(
            fixtureID: "fixture-expo",
            photos: 0,
            videos: 7
        )

        #expect(model.cullingMediaFilterControls == [.photos])
        #expect(!model.normalizeCullingMediaFilters(for: model.cullingMediaFilterControls))
        #expect(model.cullingMediaFilters == [.photos])

        model.fixtureCullingWindow = cullingWindow(
            fixtureID: "fixture-expo",
            photos: 5,
            videos: 7
        )
        #expect(model.cullingMediaFilterControls == [.photos])
    }

    @Test("Review burst selection repairs stale anchor and focus")
    @MainActor
    func reviewBurstSelectionRepairsStaleAnchorAndFocus() {
        let items = [
            FixtureReviewItem(
                id: "review-first",
                photoLibraryIdentifier: "photos-review-first",
                title: "First",
                keywords: [],
                filename: "first.jpg",
                capturedAt: "2026-08-17T10:00:00Z"
            ),
            FixtureReviewItem(
                id: "review-keeper",
                photoLibraryIdentifier: "photos-review-keeper",
                title: "Keeper",
                keywords: [],
                filename: "keeper.jpg",
                capturedAt: "2026-08-17T10:00:01Z"
            ),
            FixtureReviewItem(
                id: "review-third",
                photoLibraryIdentifier: "photos-review-third",
                title: "Third",
                keywords: [],
                filename: "third.jpg",
                capturedAt: "2026-08-17T10:00:02Z"
            ),
            FixtureReviewItem(
                id: "review-singleton",
                photoLibraryIdentifier: "photos-review-singleton",
                title: "Singleton",
                keywords: [],
                filename: "singleton.jpg",
                capturedAt: "2026-08-17T10:01:00Z"
            ),
        ]
        let model = BackstageViewModel(photoLibrary: InertPhotoLibrary())
        model.fixtureReviewWindow = FixtureReviewWindow(
            fixtureID: "fixture-expo",
            mode: .full,
            reviewStateFilters: ["picked"],
            offset: 0,
            limit: 200,
            nextOffset: 0,
            hasNext: false,
            summary: FixtureReviewSummary(
                total: items.count,
                unreviewed: items.count,
                requestingAI: 0,
                proposed: 0,
                approved: 0
            ),
            items: items
        )
        model.reviewSelection = OwnerSelectionModel(
            orderedIDs: items.map(\.id),
            selectedIDs: ["review-singleton"],
            anchorID: "review-singleton",
            focusedID: "review-singleton"
        )

        model.selectReviewBurstCandidates()

        #expect(model.reviewSelection.selectedIDs == ["review-first", "review-third"])
        #expect(model.reviewSelection.anchorID == "review-first")
        #expect(model.reviewSelection.focusedID == "review-first")
        #expect(model.reviewSelection.selectedIDs.contains(model.reviewSelection.anchorID!))
        #expect(model.reviewSelection.selectedIDs.contains(model.reviewSelection.focusedID!))
    }

    @Test("Refresh previews reports immediate progress and prevents duplicate requests")
    @MainActor
    func refreshPhotosReportsProgressAndGuardsDuplicates() async throws {
        let library = RefreshPhotoLibrary(
            access: .authorized,
            items: (0..<2_000).map { index in
                PhotoLibraryItem(
                    id: "asset-\(index)",
                    filename: "IMG_\(index).HEIC",
                    creationDate: nil,
                    mediaType: "photo"
                )
            },
            delay: .milliseconds(40)
        )
        let model = BackstageViewModel(photoLibrary: library)

        let refreshTask = Task { await model.refreshPhotos() }
        for _ in 0..<100 where library.fetchCount == 0 || !model.isLoadingPhotos {
            await Task.yield()
        }

        #expect(library.fetchCount == 1)
        #expect(model.isLoadingPhotos)
        #expect(model.photoStatus == "Refreshing Photos previews…")

        await model.refreshPhotos()
        #expect(library.fetchCount == 1)
        #expect(model.isLoadingPhotos)

        await refreshTask.value
        #expect(model.isLoadingPhotos == false)
        #expect(model.libraryItems.count == 2_000)
        #expect(model.photoStatus == "2,000 recent Photos previews cached.")
    }

    @Test("Refresh previews makes an empty result actionable")
    @MainActor
    func emptyRefreshResultOffersRetry() async {
        let model = BackstageViewModel(
            photoLibrary: RefreshPhotoLibrary(
                access: .authorized,
                items: [],
                delay: .milliseconds(1)
            )
        )

        await model.refreshPhotos()

        #expect(model.isLoadingPhotos == false)
        #expect(model.photoStatus == "Refresh completed with no Photos previews. Try Refresh previews again.")
    }

    @Test("Refresh previews makes missing Photos access actionable")
    @MainActor
    func deniedRefreshOffersActionableRecovery() async {
        let model = BackstageViewModel(photoLibrary: InertPhotoLibrary())

        await model.refreshPhotos()

        #expect(model.isLoadingPhotos == false)
        #expect(model.photoStatus == "Photos access is required. Choose Allow Photos, then retry Refresh previews.")
    }

    @Test("Culling thumbnail Retry recovers one failed card without changing decisions")
    @MainActor
    func cullingThumbnailRetryRecoversOneFailedCard() async {
        let model = BackstageViewModel(photoLibrary: RetryPhotoLibrary())
        let asset = FixturePoolAsset(
            id: "asset-retry",
            position: 0,
            title: "Retry fixture",
            filename: "retry.jpg",
            mediaType: "photo"
        )
        model.cullingPool = FixturePool(
            id: "pool-retry",
            name: "Retry",
            fixtureID: "fixture-retry",
            assetCount: 1,
            snapshotHash: "synthetic",
            assets: [asset]
        )
        model.cullingThumbnails = [:]
        model.cullingThumbnailFailures[asset.id] = .previewUnavailable

        model.retryThumbnail(for: asset.id)

        for _ in 0..<20 {
            if model.cullingThumbnails[asset.id] != nil { break }
            try? await Task.sleep(for: .milliseconds(10))
        }

        #expect(model.cullingThumbnails[asset.id] != nil)
        #expect(model.cullingThumbnailFailures[asset.id] == nil)
        #expect(model.cullingPool?.assets.map(\.id) == [asset.id])
    }

    @Test("Missing media availability still keeps Culling on photos")
    @MainActor
    func missingMediaAvailabilityFallsBackSafely() throws {
        let suiteName = "PhotosByElieBackstageTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }

        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            preferences: preferences
        )
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        model.fixtureCullingWindow = FixtureCullingWindow(json: [
            "fixtureId": .string("fixture-expo"),
            "candidateMode": .string("photos-library"),
        ])

        #expect(model.cullingMediaFilterControls == [.photos])
    }

    @Test("PBE launch captures fixture synchronously and releases provisional freeze")
    @MainActor
    func pbeLaunchProvisionalFreeze() async throws {
        let model = BackstageViewModel(photoLibrary: InertPhotoLibrary())
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-pool",
            persistSelection: false
        )

        let captured = try model.beginPBEOwnerLaunch()
        #expect(captured.fixtureID == "fixture-pool")
        #expect(captured.breadcrumb == "RE › La Concha › Pool")
        #expect(model.isFixtureChooserDisabled)
        #expect(model.isFixtureRefreshDisabled)
        #expect(model.selectFixture("fixture-expo") == false)
        #expect(model.selectedFixtureID == "fixture-pool")
        await model.loadFixtures()
        #expect(model.selectedFixtureID == "fixture-pool")
        #expect(model.fixtureStatus.contains("refresh is disabled"))

        model.finishPBEOwnerLaunch()
        #expect(model.isFixtureRefreshDisabled == false)
        #expect(model.selectFixture("fixture-expo"))
    }

    @Test("Fixture switch invalidates a stale metadata failure report")
    @MainActor
    func fixtureSwitchClearsMetadataReport() {
        let model = BackstageViewModel(photoLibrary: InertPhotoLibrary())
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-pool",
            persistSelection: false
        )
        model.metadataReport = MetadataGiveBackReport(
            actionID: "action-fixture-pool",
            fixtureID: "fixture-pool",
            isDryRun: false,
            readyCount: 0,
            written: [],
            failed: [MetadataGiveBackFailedItem(assetID: "asset-a", message: "synthetic")],
            blocked: []
        )

        #expect(model.selectFixture("fixture-expo"))
        #expect(model.metadataReport == nil)
        #expect(model.metadataStatus.contains("Expo"))
    }

    private var fixtureTree: [FixtureNode] {
        [
            FixtureNode(id: "fixture-expo", name: "Expo"),
            FixtureNode(
                id: "fixture-re",
                name: "RE",
                children: [
                    FixtureNode(
                        id: "fixture-la-concha",
                        name: "La Concha",
                        children: [FixtureNode(id: "fixture-pool", name: "Pool")]
                    ),
                ]
            ),
        ]
    }

    private var reviewHistoryEntry: ReviewHistoryEntry {
        ReviewHistoryEntry(
            label: "Synthetic history sentinel",
            fixtureID: "fixture-expo",
            mode: .full,
            stateFilters: [.picked],
            proposalAvailableOnly: false,
            mediaFilters: Set(CullingMediaFilter.selectableCases),
            search: "",
            offset: 0,
            selectedIDs: [],
            anchorID: nil,
            focusedID: nil
        )
    }

    private func cullingWindow(
        fixtureID: String,
        photos: Int,
        videos: Int
    ) -> FixtureCullingWindow {
        FixtureCullingWindow(json: [
            "fixtureId": .string(fixtureID),
            "candidateMode": .string("inherited"),
            "mediaAvailability": .object([
                "photos": .number(Double(photos)),
                "videos": .number(Double(videos)),
            ]),
        ])
    }
}

private struct InertPhotoLibrary: PhotoLibraryServing {
    func authorization() -> PhotoLibraryAccess { .denied }
    func requestAuthorization() async -> PhotoLibraryAccess { .denied }
    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }
}

private struct RetryPhotoLibrary: PhotoLibraryServing {
    private static let previewData = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!

    func authorization() -> PhotoLibraryAccess { .authorized }

    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }

    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        PhotoPreview(
            assetID: localIdentifier,
            jpegData: Self.previewData,
            pixelWidth: 1,
            pixelHeight: 1
        )
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.exportFailed("Synthetic retry test does not export originals.")
    }
}

private final class RefreshPhotoLibrary: PhotoLibraryServing, @unchecked Sendable {
    private let lock = NSLock()
    private let access: PhotoLibraryAccess
    private let items: [PhotoLibraryItem]
    private let delay: Duration
    private var calls = 0

    init(access: PhotoLibraryAccess, items: [PhotoLibraryItem], delay: Duration) {
        self.access = access
        self.items = items
        self.delay = delay
    }

    var fetchCount: Int {
        lock.withLock { calls }
    }

    func authorization() -> PhotoLibraryAccess { access }

    func requestAuthorization() async -> PhotoLibraryAccess { access }

    func fetch(limit: Int) async -> [PhotoLibraryItem] {
        lock.withLock { calls += 1 }
        try? await Task.sleep(for: delay)
        return Array(items.prefix(limit))
    }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }
}
