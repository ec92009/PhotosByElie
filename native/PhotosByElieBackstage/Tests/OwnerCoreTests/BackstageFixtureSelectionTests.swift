import Foundation
import Testing
@testable import BackstageUI
@testable import OwnerCore

@Suite("Backstage fixture scope integration")
struct BackstageFixtureSelectionTests {
    @Test("Fixture selection becomes ready before a stalled Activity refresh")
    @MainActor
    func fixtureSelectionPrecedesActivityRefresh() async throws {
        let suiteName = "PhotosByElieBackstageTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let vault = FixtureSelectionCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        try await session.save(OwnerCredentialSet(
            deviceId: "owner-device-test",
            deviceCredential: String(repeating: "d", count: 48),
            accessToken: "fixture-selection-access-token",
            accessExpiresAt: Date().addingTimeInterval(3_600)
        ))
        let transport = StalledActivityTransport()
        let api = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let authentication = OwnerAuthenticationService(
            api: api,
            session: session
        )
        let localFixtures = StaticLocalFixtureTree(fixtures: fixtureTree)
        let fixtureService = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: api,
                waker: RejectingFixtureSelectionWaker(),
                pollInterval: .milliseconds(1),
                timeout: .milliseconds(10)
            ),
            localReviewService: localFixtures
        )
        let model = BackstageViewModel(
            api: api,
            photoLibrary: InertPhotoLibrary(),
            preferences: preferences,
            authenticationService: authentication,
            fixtureService: fixtureService,
            workflowRecoveryStore: nil
        )

        let bootstrap = Task { await model.bootstrapAuthentication() }
        for _ in 0..<100 where model.selectedFixtureID != "fixture-expo" {
            try await Task.sleep(for: .milliseconds(1))
        }

        #expect(model.selectedFixtureID == "fixture-expo")
        #expect(model.fixtureScopedActionsAllowed)
        for _ in 0..<100 {
            if await transport.activityRequestCount() == 1 { break }
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(await transport.activityRequestCount() == 1)

        bootstrap.cancel()
        await bootstrap.value
    }

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

    @Test("Review Waste Basket X records a same-session Undo restore")
    @MainActor
    func reviewWasteBasketXRecordsUndoRestore() async throws {
        let first = FixtureReviewItem(
            id: "review-first",
            photoLibraryIdentifier: "photos-review-first",
            title: "First",
            keywords: [],
            filename: "first.jpg",
            capturedAt: "2026-08-17T10:00:00Z"
        )
        let second = FixtureReviewItem(
            id: "review-second",
            photoLibraryIdentifier: "photos-review-second",
            title: "Second",
            keywords: [],
            filename: "second.jpg",
            capturedAt: "2026-08-17T10:00:01Z"
        )
        let actionAPI = ReviewLifecycleActionAPI(terminalActions: [
            OwnerAction(
                id: "owner-action-review-x",
                actionKind: "photo-moderation",
                target: "max",
                state: .completed,
                result: ["ok": true]
            ),
            OwnerAction(
                id: "owner-action-review-restore",
                actionKind: "photo-moderation",
                target: "max",
                state: .completed,
                result: ["ok": true]
            ),
        ], terminalDelay: .milliseconds(50))
        let lifecycleService = LifecycleService(runner: OwnerActionRunner(
            api: actionAPI,
            waker: RejectingFixtureSelectionWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            lifecycleService: lifecycleService,
            workflowRecoveryStore: nil
        )
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        model.reviewMode = .full
        model.reviewStateFilters = [.picked]
        model.fixtureReviewWindow = FixtureReviewWindow(
            fixtureID: "fixture-expo",
            mode: .full,
            reviewStateFilters: ["picked"],
            offset: 0,
            limit: 200,
            nextOffset: 0,
            hasNext: false,
            summary: FixtureReviewSummary(
                total: 2,
                unreviewed: 2,
                requestingAI: 0,
                proposed: 0,
                approved: 0
            ),
            items: [first, second]
        )
        model.reviewSelection = OwnerSelectionModel(
            orderedIDs: [first.id, second.id],
            selectedIDs: [first.id],
            anchorID: first.id,
            focusedID: first.id
        )

        await model.moveReviewSelectionToWasteBasket()
        for _ in 0..<200 where model.reviewHistory.isEmpty {
            try await Task.sleep(for: .milliseconds(1))
        }

        #expect(model.reviewHistory.last?.wasteBasketMediaIDs == [first.id])
        #expect(model.reviewItems.map(\.id) == [second.id])
        #expect(model.reviewWasteBasketPendingActionID == "owner-action-review-x")
        for _ in 0..<200 where model.reviewWasteBasketPendingActionID != nil {
            try await Task.sleep(for: .milliseconds(1))
        }

        await model.undoLastReviewAction()

        #expect(model.reviewHistory.isEmpty)
        #expect(model.reviewItems.map(\.id) == [first.id, second.id])
        #expect(model.reviewSelection.selectedIDs == [first.id])
        #expect(model.reviewWasteBasketPendingActionID == "owner-action-review-restore")
        for _ in 0..<200 where model.reviewWasteBasketPendingActionID != nil {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.reviewStatus.contains("Restored 1 item from Waste Basket"))
        let requests = await actionAPI.requests()
        #expect(requests.map { $0.payload["operation"]?.stringValue } == [
            "waste-basket-x",
            "waste-basket-restore",
        ])
    }

    @Test("Review Waste Basket optimistic Undo rolls back on terminal failure")
    @MainActor
    func reviewWasteBasketUndoRollsBackOnFailure() async throws {
        let first = FixtureReviewItem(
            id: "review-rollback-first",
            photoLibraryIdentifier: "photos-review-rollback-first",
            title: "First",
            keywords: [],
            filename: "first.jpg",
            capturedAt: "2026-08-17T10:00:00Z"
        )
        let second = FixtureReviewItem(
            id: "review-rollback-second",
            photoLibraryIdentifier: "photos-review-rollback-second",
            title: "Second",
            keywords: [],
            filename: "second.jpg",
            capturedAt: "2026-08-17T10:00:01Z"
        )
        let actionAPI = ReviewLifecycleActionAPI(terminalActions: [
            OwnerAction(
                id: "owner-action-review-rollback-x",
                actionKind: "photo-moderation",
                target: "max",
                state: .completed,
                result: ["ok": true]
            ),
            OwnerAction(
                id: "owner-action-review-rollback-restore",
                actionKind: "photo-moderation",
                target: "max",
                state: .failed,
                error: ["message": "synthetic restore failure"]
            ),
        ], terminalDelay: .milliseconds(50))
        let model = reviewWasteBasketModel(
            actionAPI: actionAPI,
            items: [first, second],
            selectedID: first.id
        )

        await model.moveReviewSelectionToWasteBasket()
        for _ in 0..<300 where model.reviewHistory.isEmpty {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.reviewItems.map(\.id) == [second.id])
        #expect(model.reviewWasteBasketPendingActionID == "owner-action-review-rollback-x")
        for _ in 0..<300 where model.reviewWasteBasketPendingActionID != nil {
            try await Task.sleep(for: .milliseconds(1))
        }

        await model.undoLastReviewAction()
        #expect(model.reviewItems.map(\.id) == [first.id, second.id])
        #expect(model.reviewHistory.isEmpty)
        #expect(model.reviewWasteBasketPendingActionID == "owner-action-review-rollback-restore")

        for _ in 0..<300 where model.reviewWasteBasketPendingActionID != nil {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.reviewItems.map(\.id) == [second.id])
        #expect(model.reviewHistory.last?.wasteBasketMediaIDs == [first.id])
        #expect(model.reviewStatus.contains("Undo failed"))
    }

    @Test("Review Waste Basket allows consecutive X and Undo actions")
    @MainActor
    func reviewWasteBasketAllowsConsecutiveActions() async throws {
        let items = (1...3).map { index in
            FixtureReviewItem(
                id: "review-consecutive-\(index)",
                photoLibraryIdentifier: "photos-review-consecutive-\(index)",
                title: "Item \(index)",
                keywords: [],
                filename: "item-\(index).jpg",
                capturedAt: "2026-08-17T10:00:0\(index)Z"
            )
        }
        let actionAPI = ReviewLifecycleActionAPI(
            terminalActions: [
                OwnerAction(
                    id: "owner-action-consecutive-x-1",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .completed,
                    result: ["ok": true]
                ),
                OwnerAction(
                    id: "owner-action-consecutive-x-2",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .completed,
                    result: ["ok": true]
                ),
                OwnerAction(
                    id: "owner-action-consecutive-restore-2",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .completed,
                    result: ["ok": true]
                ),
                OwnerAction(
                    id: "owner-action-consecutive-restore-1",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .completed,
                    result: ["ok": true]
                ),
            ],
            terminalDelay: .milliseconds(200)
        )
        let model = reviewWasteBasketModel(
            actionAPI: actionAPI,
            items: items,
            selectedID: items[0].id
        )

        await model.moveReviewSelectionToWasteBasket()
        for _ in 0..<300 where model.reviewHistory.count < 1 {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.reviewItems.map(\.id) == [items[1].id, items[2].id])
        #expect(!model.reviewWasteBasketQueueing)
        #expect(model.reviewWasteBasketPendingActionIDs == ["owner-action-consecutive-x-1"])

        await model.moveReviewSelectionToWasteBasket()
        for _ in 0..<300 where model.reviewHistory.count < 2 {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.reviewItems.map(\.id) == [items[2].id])
        #expect(model.reviewWasteBasketPendingActionIDs.count == 2)
        #expect(model.reviewUndoIsBlockedByPendingWasteBasketAction)

        for _ in 0..<600 where !model.reviewWasteBasketPendingActionIDs.isEmpty {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(!model.reviewUndoIsBlockedByPendingWasteBasketAction)

        await model.undoLastReviewAction()
        #expect(model.reviewItems.map(\.id) == [items[1].id, items[2].id])
        #expect(model.reviewWasteBasketPendingActionIDs == ["owner-action-consecutive-restore-2"])
        #expect(!model.reviewUndoIsBlockedByPendingWasteBasketAction)

        await model.undoLastReviewAction()
        #expect(model.reviewItems.map(\.id) == items.map(\.id))
        #expect(model.reviewHistory.isEmpty)
        #expect(model.reviewWasteBasketPendingActionIDs == [
            "owner-action-consecutive-restore-1",
            "owner-action-consecutive-restore-2",
        ])

        for _ in 0..<600 where !model.reviewWasteBasketPendingActionIDs.isEmpty {
            try await Task.sleep(for: .milliseconds(1))
        }
        let requests = await actionAPI.requests()
        #expect(requests.map { $0.payload["operation"]?.stringValue } == [
            "waste-basket-x",
            "waste-basket-x",
            "waste-basket-restore",
            "waste-basket-restore",
        ])
    }

    @Test("Review Waste Basket optimistic X rolls back on terminal failure")
    @MainActor
    func reviewWasteBasketXRollsBackOnFailure() async throws {
        let first = FixtureReviewItem(
            id: "review-x-failure-first",
            photoLibraryIdentifier: "photos-review-x-failure-first",
            title: "First",
            keywords: [],
            filename: "first.jpg",
            capturedAt: "2026-08-17T10:00:00Z"
        )
        let second = FixtureReviewItem(
            id: "review-x-failure-second",
            photoLibraryIdentifier: "photos-review-x-failure-second",
            title: "Second",
            keywords: [],
            filename: "second.jpg",
            capturedAt: "2026-08-17T10:00:01Z"
        )
        let actionAPI = ReviewLifecycleActionAPI(terminalActions: [
            OwnerAction(
                id: "owner-action-review-x-failure",
                actionKind: "photo-moderation",
                target: "max",
                state: .failed,
                error: ["message": "synthetic X failure"]
            ),
        ], terminalDelay: .milliseconds(50))
        let model = reviewWasteBasketModel(
            actionAPI: actionAPI,
            items: [first, second],
            selectedID: first.id
        )

        await model.moveReviewSelectionToWasteBasket()
        for _ in 0..<300 where model.reviewHistory.isEmpty {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.reviewItems.map(\.id) == [second.id])
        #expect(model.reviewWasteBasketPendingActionID == "owner-action-review-x-failure")

        for _ in 0..<300 where model.reviewWasteBasketPendingActionID != nil {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.reviewItems.map(\.id) == [first.id, second.id])
        #expect(model.reviewHistory.isEmpty)
        #expect(model.reviewSelection.selectedIDs == [first.id])
        #expect(model.reviewStatus.contains("local Review list was restored"))
    }

    @Test("Waste Basket Put back keeps its completion receipt visible")
    @MainActor
    func wasteBasketPutBackKeepsCompletionReceiptVisible() async {
        let actionAPI = ReviewLifecycleActionAPI(terminalActions: [
            OwnerAction(
                id: "owner-action-put-back",
                actionKind: "photo-moderation",
                target: "max",
                state: .completed,
                result: ["ok": true]
            ),
            OwnerAction(
                id: "owner-action-ledger-refresh",
                actionKind: "sidecar-culling-review",
                target: "max",
                state: .completed,
                result: [
                    "lifecycle": [
                        "items": [],
                        "hiddenCount": 0,
                        "discardedCount": 0,
                    ],
                ]
            ),
        ])
        let lifecycleService = LifecycleService(runner: OwnerActionRunner(
            api: actionAPI,
            waker: RejectingFixtureSelectionWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            lifecycleService: lifecycleService,
            workflowRecoveryStore: nil
        )
        model.lifecycleItems = [LifecycleItem(json: [
            "mediaId": "review-first",
            "state": "hidden",
            "title": "First",
        ])]
        model.selectedLifecycleIDs = ["review-first"]

        await model.restoreLifecycleSelection()

        #expect(model.lifecycleItems.isEmpty)
        #expect(model.lifecycleStatus.contains("Restored 1 item"))
        #expect(model.lifecycleStatus.contains("owner-action-put-back"))
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
        let model = BackstageViewModel(
            photoLibrary: RetryPhotoLibrary(),
            injectNextCullingThumbnailFailure: true
        )
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
        model.requestThumbnail(for: asset.id)

        for _ in 0..<20 {
            if model.cullingThumbnailFailures[asset.id] != nil { break }
            try? await Task.sleep(for: .milliseconds(10))
        }

        #expect(model.cullingThumbnails[asset.id] == nil)
        #expect(model.cullingThumbnailFailures[asset.id] == .previewUnavailable)
        #expect(model.cullingStatus.contains("no culling decision changed"))

        model.cullingAssetDidDisappear(asset.id)
        model.cullingAssetDidAppear(
            FixtureAsset(
                id: asset.id,
                title: asset.title,
                filename: asset.filename,
                mediaType: asset.mediaType
            )
        )
        try? await Task.sleep(for: .milliseconds(30))

        #expect(model.cullingThumbnails[asset.id] == nil)
        #expect(model.cullingThumbnailFailures[asset.id] == .previewUnavailable)

        model.retryThumbnail(for: asset.id)

        for _ in 0..<20 {
            if model.cullingThumbnails[asset.id] != nil { break }
            try? await Task.sleep(for: .milliseconds(10))
        }

        #expect(model.cullingThumbnails[asset.id] != nil)
        #expect(model.cullingThumbnailFailures[asset.id] == nil)
        #expect(model.cullingPool?.assets.map(\.id) == [asset.id])
    }

    @Test("Culling thumbnail upgrades coalesce learned current sizes after scroll idle")
    @MainActor
    func cullingThumbnailUpgradeWaitsForScrollIdle() async {
        let photoLibrary = RecordingPreviewPhotoLibrary()
        let sizeCache = RecordingCurrentImageSizeCache()
        let model = BackstageViewModel(
            photoLibrary: photoLibrary,
            currentImageSizeCache: sizeCache,
            cullingThumbnailUpgradeDelay: .milliseconds(60),
            currentImageSizeFlushDelay: .milliseconds(80)
        )
        let firstAsset = FixtureAsset(
            id: "asset-idle-upgrade",
            title: "Idle upgrade fixture",
            filename: "idle-upgrade.jpg",
            mediaType: "photo"
        )
        let secondAsset = FixtureAsset(
            id: "asset-idle-upgrade-2",
            title: "Second idle upgrade fixture",
            filename: "idle-upgrade-2.jpg",
            mediaType: "photo"
        )

        model.cullingScrollPhaseChanged(isScrolling: true)
        model.cullingAssetDidAppear(firstAsset)
        model.cullingAssetDidAppear(secondAsset)
        for _ in 0..<20 {
            if model.cullingThumbnails.count == 2 { break }
            try? await Task.sleep(for: .milliseconds(10))
        }
        try? await Task.sleep(for: .milliseconds(90))

        #expect(photoLibrary.requestedPixelSizes().filter { $0 == 180 }.count == 2)
        #expect(sizeCache.recordedBatches().isEmpty)

        model.cullingScrollPhaseChanged(isScrolling: false)
        for _ in 0..<50 {
            if sizeCache.recordedBatches().count == 1 { break }
            try? await Task.sleep(for: .milliseconds(10))
        }

        #expect(photoLibrary.requestedPixelSizes().filter { $0 == 900 }.count == 2)
        #expect(sizeCache.recordedBatches() == [[
            firstAsset.id: 900_000,
            secondAsset.id: 900_000,
        ]])
        #expect(model.currentImageByteCount(for: firstAsset.id) == 900_000)
        #expect(model.currentImageByteCount(for: secondAsset.id) == 900_000)
    }

    @Test("Focused Quick Look persists a learned current size before returning")
    @MainActor
    func focusedQuickLookPersistsCurrentSizePromptly() async throws {
        let photoLibrary = RecordingPreviewPhotoLibrary()
        let sizeCache = RecordingCurrentImageSizeCache()
        let model = BackstageViewModel(
            photoLibrary: photoLibrary,
            currentImageSizeCache: sizeCache,
            currentImageSizeFlushDelay: .seconds(60)
        )
        let asset = FixturePoolAsset(
            id: "asset-focused-preview",
            position: 0,
            title: "Focused preview",
            filename: "focused-preview.jpg",
            mediaType: "photo"
        )
        model.cullingPool = FixturePool(
            id: "pool-focused-preview",
            name: "Focused preview",
            fixtureID: "fixture-focused-preview",
            assetCount: 1,
            snapshotHash: "synthetic",
            assets: [asset]
        )
        model.cullingSelection = OwnerSelectionModel(
            orderedIDs: [asset.id],
            selectedIDs: [asset.id],
            anchorID: asset.id,
            focusedID: asset.id
        )

        let urls = await model.prepareQuickLookURLs()

        #expect(urls.count == 1)
        #expect(model.currentImageByteCount(for: asset.id) == 4_000_000)
        #expect(sizeCache.recordedBatches() == [[asset.id: 4_000_000]])
        #expect(photoLibrary.requestedPixelSizes().filter { $0 == 4_000 }.count == 1)
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

    @Test("Metadata give-back scope follows the exact Asset ID field")
    @MainActor
    func metadataGiveBackUsesExactAssetIDScope() {
        let model = BackstageViewModel(photoLibrary: InertPhotoLibrary())
        model.metadataAssetID = "  asset-exact  "

        #expect(model.metadataGiveBackAssetIDs == ["asset-exact"])
        #expect(model.metadataGiveBackScopeDescription == "Exact item asset-exact")

        model.metadataAssetID = "   "
        #expect(model.metadataGiveBackAssetIDs.isEmpty)
        #expect(model.metadataGiveBackScopeDescription == "Entire current fixture")
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

    @MainActor
    private func reviewWasteBasketModel(
        actionAPI: ReviewLifecycleActionAPI,
        items: [FixtureReviewItem],
        selectedID: String
    ) -> BackstageViewModel {
        let lifecycleService = LifecycleService(runner: OwnerActionRunner(
            api: actionAPI,
            waker: RejectingFixtureSelectionWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            lifecycleService: lifecycleService,
            workflowRecoveryStore: nil
        )
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        model.reviewMode = .full
        model.reviewStateFilters = [.picked]
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
            selectedIDs: [selectedID],
            anchorID: selectedID,
            focusedID: selectedID
        )
        return model
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

private final class FixtureSelectionCredentialVault: CredentialVault, @unchecked Sendable {
    private let lock = NSLock()
    private var value: Data?

    func read(account: String) throws -> Data? { lock.withLock { value } }
    func write(_ data: Data, account: String) throws { lock.withLock { value = data } }
    func delete(account: String) throws { lock.withLock { value = nil } }
}

private actor StalledActivityTransport: OwnerAPITransport {
    private var activityRequests = 0

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        activityRequests += 1
        try await Task.sleep(for: .seconds(60))
        throw CancellationError()
    }

    func activityRequestCount() -> Int { activityRequests }
}

private struct RejectingFixtureSelectionWaker: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? {
        throw CancellationError()
    }
}

private actor ReviewLifecycleActionAPI: OwnerActionServing {
    private var terminalActions: [OwnerAction]
    private var createdRequests: [OwnerActionCreate] = []
    private let terminalDelay: Duration

    init(terminalActions: [OwnerAction], terminalDelay: Duration = .zero) {
        self.terminalActions = terminalActions
        self.terminalDelay = terminalDelay
    }

    func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String
    ) async throws -> OwnerActionEnvelope {
        let terminal = terminalActions[createdRequests.count]
        createdRequests.append(action)
        return OwnerActionEnvelope(
            action: OwnerAction(
                id: terminal.id,
                actionKind: action.actionKind,
                target: action.target,
                state: .queued
            ),
            idempotencyReplayed: false
        )
    }

    func getAction(id: String) async throws -> OwnerAction {
        if terminalDelay != .zero {
            try await Task.sleep(for: terminalDelay)
        }
        guard let action = terminalActions.first(where: { $0.id == id }) else {
            throw URLError(.resourceUnavailable)
        }
        return action
    }

    func requests() -> [OwnerActionCreate] { createdRequests }
}

private struct StaticLocalFixtureTree: LocalFixtureReviewServing, LocalFixtureTreeReading {
    var fixtures: [FixtureNode]

    func nativeFixtureTree(includeArchived: Bool) async throws -> [FixtureNode]? {
        fixtures
    }

    func applyReview(manifest: [String: JSONValue]) async throws -> FixtureReviewResult {
        throw CancellationError()
    }

    func undoReview(operationID: String) async throws -> FixtureReviewUndoResult {
        throw CancellationError()
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

private final class RecordingPreviewPhotoLibrary: PhotoLibraryServing, @unchecked Sendable {
    private let lock = NSLock()
    private var pixelSizes: [Int] = []
    private static let previewData = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!

    func authorization() -> PhotoLibraryAccess { .authorized }

    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }

    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        lock.withLock { pixelSizes.append(maxPixelSize) }
        return PhotoPreview(
            assetID: localIdentifier,
            jpegData: Self.previewData,
            pixelWidth: maxPixelSize,
            pixelHeight: maxPixelSize,
            currentImageByteCount: maxPixelSize >= 900 ? Int64(maxPixelSize * 1_000) : nil
        )
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.exportFailed("Synthetic idle-upgrade test does not export originals.")
    }

    func requestedPixelSizes() -> [Int] {
        lock.withLock { pixelSizes }
    }
}

private final class RecordingCurrentImageSizeCache: OwnerCurrentImageSizeCaching, @unchecked Sendable {
    private let lock = NSLock()
    private var storedValues: [String: Int64] = [:]
    private var batches: [[String: Int64]] = []

    func values(assetIDs: [String]) throws -> [String: Int64] {
        lock.withLock {
            Dictionary(uniqueKeysWithValues: assetIDs.compactMap { assetID in
                storedValues[assetID].map { (assetID, $0) }
            })
        }
    }

    func upsert(_ values: [String: Int64], updatedAt: Date) throws {
        lock.withLock {
            batches.append(values)
            storedValues.merge(values) { _, refreshed in refreshed }
        }
    }

    func recordedBatches() -> [[String: Int64]] {
        lock.withLock { batches }
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
