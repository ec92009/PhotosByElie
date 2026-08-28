import AppKit
import Foundation
import SwiftUI
import Testing
@testable import BackstageUI
@testable import OwnerCore

@Suite("Backstage fixture scope integration")
struct BackstageFixtureSelectionTests {
    @Test("Compact fixture picker renders without changing data", arguments: [230, 320], [false, true])
    @MainActor
    func compactFixturePicker(width: Int, dark: Bool) throws {
        let suiteName = "PhotosByElieBackstageTests.\(UUID())"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(), preferences: preferences,
            workflowRecoveryStore: nil, currentImageSizeCache: nil, customerPhotoLinks: nil
        )
        let tree = [
            FixtureNode(id: "travel", name: "Travel", children: [
                FixtureNode(id: "travel-family", name: "Friends and Family"),
            ]),
            FixtureNode(id: "other-family", name: "Friends and Family"),
        ]
        for state in ["loading", "ready", "long-name", "unavailable"] {
            if state == "ready" || state == "long-name" {
                model.installFixtureTree(
                    tree, preferredFixtureID: state == "ready" ? "travel" : "travel-family",
                    persistSelection: false
                )
            } else if state == "unavailable" {
                model.markFixtureSelectionUnavailable("Fixture tree unavailable. Reload to retry.")
            }
            let selectedID = model.selectedFixtureID
            let view = FixturePicker(model: model)
                .padding(12)
                .frame(width: CGFloat(width), alignment: .topLeading)
                .background(dark ? Color.black : Color.white)
                .environment(\.colorScheme, dark ? .dark : .light)
            let host = NSHostingView(rootView: view)
            host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            host.setFrameSize(host.fittingSize)
            host.layoutSubtreeIfNeeded()
            #expect(host.bounds.width == CGFloat(width))
            #expect(host.bounds.height > 0 && host.bounds.height < 400)
            let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.cacheDisplay(in: host.bounds, to: bitmap)
            let png = try #require(bitmap.representation(using: .png, properties: [:]))
            #expect(!png.isEmpty)
            // Optional synthetic render artifacts; never open a window or connect to Photos/Owner.
            if let directory = ProcessInfo.processInfo.environment["PBB132_SNAPSHOTS"] {
                let destination = URL(fileURLWithPath: directory, isDirectory: true)
                    .appendingPathComponent("\(state)-\(width)-\(dark ? "dark" : "light").png")
                try png.write(to: destination, options: .atomic)
            }
            #expect(model.selectedFixtureID == selectedID)
            #expect(model.pbeOwnerFixtureSession == nil)
            #expect(model.cullingHistory.isEmpty && model.cullingStates.isEmpty)
            #expect(preferences.persistentDomain(forName: suiteName)?.isEmpty != false)
        }
    }

    @Test("View as customer opens one neutral URL without Owner authentication, session, or decisions")
    @MainActor
    func customerPhotoHandoff() async throws {
        let suiteName = "PhotosByElieBackstageTests.\(UUID())"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        var opened: [URL] = []
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(), preferences: preferences,
            openExternalURL: { opened.append($0); return true },
            workflowRecoveryStore: nil, currentImageSizeCache: nil,
            customerPhotoLinks: CustomerPhotoTestResolver()
        )
        model.selection = .culling
        model.installFixtureTree(fixtureTree, preferredFixtureID: "fixture-expo", persistSelection: false)
        model.cullingSelection = OwnerSelectionModel(orderedIDs: ["private-id"], selectedIDs: ["private-id"])
        #expect(model.canViewCustomerPhoto)
        await model.viewSelectedPhotoAsCustomer()
        #expect(opened.map(\.absoluteString) == ["https://photos-by-elie.com/photo.html?id=published-id"])
        #expect(model.authentication.phase == .needsEnrollment)
        #expect(model.pbeOwnerFixtureSession == nil)
        #expect(model.cullingHistory.isEmpty && model.cullingStates.isEmpty)
        #expect(!model.isOpeningCustomerPhoto)
        #expect(model.customerPhotoStatus.contains("No Owner session"))
    }

    @Test("Customer handoff reports unavailable evidence and browser failures without fallback")
    @MainActor
    func customerPhotoFailureFeedback() async throws {
        let suiteName = "PhotosByElieBackstageTests.\(UUID())"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        for error in [CustomerPhotoLinkError.noVerifiedPublication, .ambiguousPublication, .unavailable] {
            var opened = false
            let model = BackstageViewModel(
                photoLibrary: InertPhotoLibrary(), preferences: preferences,
                openExternalURL: { _ in opened = true; return true },
                workflowRecoveryStore: nil, currentImageSizeCache: nil,
                customerPhotoLinks: CustomerPhotoTestResolver(error: error)
            )
            model.installFixtureTree(fixtureTree, preferredFixtureID: "fixture-expo", persistSelection: false)
            model.cullingSelection = OwnerSelectionModel(orderedIDs: ["a"], selectedIDs: ["a"])
            await model.viewSelectedPhotoAsCustomer()
            #expect(!opened && !model.isOpeningCustomerPhoto)
            #expect(!model.customerPhotoStatus.isEmpty)
        }
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(), preferences: preferences, openExternalURL: { _ in false },
            workflowRecoveryStore: nil, currentImageSizeCache: nil,
            customerPhotoLinks: CustomerPhotoTestResolver()
        )
        model.selection = .culling
        model.installFixtureTree(fixtureTree, preferredFixtureID: "fixture-expo", persistSelection: false)
        await model.viewSelectedPhotoAsCustomer()
        #expect(model.customerPhotoStatus.contains("exactly one"))
        model.cullingSelection = OwnerSelectionModel(orderedIDs: ["a", "b"], selectedIDs: ["a", "b"])
        #expect(!model.canViewCustomerPhoto)
        await model.viewSelectedPhotoAsCustomer()
        #expect(model.customerPhotoStatus.contains("exactly one"))
        model.cullingSelection = OwnerSelectionModel(orderedIDs: ["a"], selectedIDs: ["a"])
        await model.viewSelectedPhotoAsCustomer()
        #expect(model.customerPhotoStatus.contains("browser could not"))
    }

    @Test("In-flight customer lookup ignores discard, selection, fixture, or workspace changes", arguments: ["selection", "fixture", "workspace", "cancel"])
    @MainActor
    func customerPhotoStaleLookup(change: String) async throws {
        let suiteName = "PhotosByElieBackstageTests.\(UUID())"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let gate = DispatchSemaphore(value: 0)
        var opened = false
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(), preferences: preferences,
            openExternalURL: { _ in opened = true; return true },
            workflowRecoveryStore: nil, currentImageSizeCache: nil,
            customerPhotoLinks: CustomerPhotoTestResolver(gate: gate)
        )
        model.selection = .culling
        model.installFixtureTree(fixtureTree, preferredFixtureID: "fixture-expo", persistSelection: false)
        model.cullingSelection = OwnerSelectionModel(orderedIDs: ["a", "b"], selectedIDs: ["a"])
        let opening = Task { await model.viewSelectedPhotoAsCustomer() }
        while !model.isOpeningCustomerPhoto { await Task.yield() }
        #expect(!model.canViewCustomerPhoto)
        await model.viewSelectedPhotoAsCustomer() // Duplicate must not start a second lookup.
        switch change {
        case "selection": model.cullingSelection = OwnerSelectionModel(orderedIDs: ["a", "b"], selectedIDs: ["b"])
        case "fixture": model.markFixtureSelectionUnavailable("test")
        case "workspace": model.selection = .review
        default: opening.cancel()
        }
        gate.signal()
        await opening.value
        #expect(!opened && !model.isOpeningCustomerPhoto)
        #expect(model.customerPhotoStatus.contains("No customer page was opened"))
    }

    @Test("Gallery preserves legacy navigation identity and applies bounded saved views")
    @MainActor
    func gallerySavedViewsPreserveCullingPersistence() throws {
        let suiteName = "PhotosByElieBackstageTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        preferences.set("Culling", forKey: "PhotosByElieBackstage.selectedSection")
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            preferences: preferences,
            workflowRecoveryStore: nil
        )

        #expect(model.selection == .culling)
        #expect(BackstageViewModel.Section.culling.rawValue == "Culling")
        #expect(BackstageViewModel.Section.culling.title == "Gallery")

        model.showAllFixtureAssetsInGallery()
        #expect(model.cullingViews == Set(FixtureCullingView.selectableCases))
        #expect(model.gallerySourceFilters == Set(GallerySourceFilter.allCases))
        #expect(model.gallerySavedViewLabel == "All fixture assets")

        model.showCullingSavedView()
        #expect(model.cullingViews == [.undecided])
        #expect(model.gallerySourceFilters == [.available])
        #expect(model.gallerySavedViewLabel == "Culling — Undecided")

        model.applyGallerySavedView(.reviewQueue)
        #expect(model.cullingViews == [.picked])
        #expect(model.galleryEditorialFilters == [.needsReview, .aiRequested, .proposalAvailable])
        #expect(model.gallerySavedViewLabel == "Review queue")

        model.applyGallerySavedView(.approved)
        #expect(model.galleryEditorialFilters == [.approved])
        #expect(model.gallerySavedViewLabel == "Approved")

        model.applyGallerySavedView(.uploadQueue)
        #expect(model.galleryEditorialFilters == [.approved])
        #expect(model.galleryDeliveryFilters == [.needsUpload, .uploading, .failed])
        #expect(model.gallerySavedViewLabel == "Upload queue")

        model.applyGallerySavedView(.live)
        #expect(model.galleryDeliveryFilters == [.live])
        #expect(model.gallerySavedViewLabel == "Live")

        model.applyGallerySavedView(.hidden)
        #expect(model.cullingViews == [.hidden])
        #expect(model.gallerySavedViewLabel == "Hidden")

        model.applyGallerySavedView(.unavailable)
        #expect(model.cullingViews == Set(FixtureCullingView.selectableCases))
        #expect(model.gallerySourceFilters == [.unavailable])
        #expect(model.gallerySavedViewLabel == "Unavailable")

        model.cullingSearch = "custom"
        #expect(model.gallerySavedViewLabel == "Custom")
    }

    @Test("Gallery returns only approved selections to Review and exact Undo restores delivery")
    @MainActor
    func galleryReturnToReviewPreservesLiveAndUndo() async throws {
        let approvedLive = FixtureAsset(
            id: "gallery-approved-live",
            title: "Approved live",
            filename: "approved-live.jpg",
            mediaType: "photo",
            placementState: .picked,
            editorialState: "approved",
            deliveryState: "live"
        )
        let approvedQueued = FixtureAsset(
            id: "gallery-approved-queued",
            title: "Approved queued",
            filename: "approved-queued.jpg",
            mediaType: "photo",
            placementState: .picked,
            editorialState: "approved",
            deliveryState: "needs-upload"
        )
        let alreadyUnreviewed = FixtureAsset(
            id: "gallery-unreviewed",
            title: "Already unreviewed",
            filename: "already-unreviewed.jpg",
            mediaType: "photo",
            placementState: .picked,
            editorialState: "unreviewed",
            deliveryState: "not-ready"
        )
        let items = [approvedLive, approvedQueued, alreadyUnreviewed]
        let localReview = RecordingGalleryReviewService(
            states: Dictionary(uniqueKeysWithValues: items.map {
                ($0.id, ($0.editorialState, $0.deliveryState))
            })
        )
        let fixtureService = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: ReviewLifecycleActionAPI(terminalActions: []),
                waker: RejectingFixtureSelectionWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            localReviewService: localReview
        )
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            fixtureService: fixtureService,
            workflowRecoveryStore: nil
        )
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        var window = cullingWindow(fixtureID: "fixture-expo", photos: items.count, videos: 0)
        window.items = items
        model.fixtureCullingWindow = window
        model.cullingViews = [.picked]
        model.cullingStates = Dictionary(uniqueKeysWithValues: items.map { item in
            (
                item.id,
                SidecarDecisionState(
                    assetId: item.id,
                    pickState: FixturePlacementState.picked.rawValue,
                    metadataState: item.editorialState
                )
            )
        })
        model.cullingSelection = OwnerSelectionModel(
            orderedIDs: items.map(\.id),
            selectedIDs: Set(items.map(\.id)),
            anchorID: approvedLive.id,
            focusedID: approvedQueued.id
        )

        #expect(model.cullingReturnToReviewEligibleIDs == [approvedLive.id, approvedQueued.id])
        #expect(model.cullingReturnToReviewSkippedCount == 1)
        #expect(model.cullingReturnToReviewLiveCount == 1)

        await model.returnCullingSelectionToReview()

        #expect(model.cullingHistory.last?.reviewOperationID == "gallery-return-operation")
        #expect(model.cullingAssets.first(where: { $0.id == approvedLive.id })?.editorialState == "unreviewed")
        #expect(model.cullingAssets.first(where: { $0.id == approvedLive.id })?.deliveryState == "live")
        #expect(model.cullingAssets.first(where: { $0.id == approvedQueued.id })?.editorialState == "unreviewed")
        #expect(model.cullingAssets.first(where: { $0.id == approvedQueued.id })?.deliveryState == "not-ready")
        #expect(model.cullingStatus.contains("Skipped 1 selected asset"))
        #expect(model.cullingStatus.contains("live rendition remains live"))
        #expect(await localReview.appliedAssetIDs() == [approvedLive.id, approvedQueued.id])

        await model.undoLastCullingDecision()

        #expect(model.cullingHistory.isEmpty)
        #expect(model.cullingAssets.first(where: { $0.id == approvedLive.id })?.editorialState == "approved")
        #expect(model.cullingAssets.first(where: { $0.id == approvedLive.id })?.deliveryState == "live")
        #expect(model.cullingAssets.first(where: { $0.id == approvedQueued.id })?.editorialState == "approved")
        #expect(model.cullingAssets.first(where: { $0.id == approvedQueued.id })?.deliveryState == "needs-upload")
        #expect(model.cullingSelection.selectedIDs == Set(items.map(\.id)))
        #expect(model.cullingSelection.focusedID == approvedQueued.id)
        #expect(await localReview.undoOperationIDs() == ["gallery-return-operation"])
    }

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

    @Test("Activity refresh times out promptly without hiding local recovery truth")
    @MainActor
    func activityRefreshIsBounded() async throws {
        let suiteName = "PhotosByElieBackstageTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let vault = FixtureSelectionCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        try await session.save(OwnerCredentialSet(
            deviceId: "owner-device-test",
            deviceCredential: String(repeating: "d", count: 48),
            accessToken: "activity-timeout-access-token",
            accessExpiresAt: Date().addingTimeInterval(3_600)
        ))
        let transport = StalledActivityTransport()
        let api = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let authentication = OwnerAuthenticationService(api: api, session: session)
        let model = BackstageViewModel(
            api: api,
            photoLibrary: InertPhotoLibrary(),
            preferences: preferences,
            authenticationService: authentication,
            workflowRecoveryStore: nil,
            activityRefreshTimeout: .milliseconds(20)
        )

        let clock = ContinuousClock()
        let started = clock.now
        await model.refreshActions()
        let elapsed = started.duration(to: clock.now)

        #expect(elapsed < .seconds(1))
        #expect(!model.isRefreshing)
        #expect(model.actions.isEmpty)
        #expect(model.activityStatus.contains("timed out"))
        #expect(model.activityStatus.contains("Local workflow recovery remains available"))
    }

    @Test("Device revocation captures the selected Mac before confirmation dismissal")
    @MainActor
    func deviceRevocationSurvivesConfirmationDismissal() async throws {
        let suiteName = "PhotosByElieBackstageTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let transport = DeviceRevocationTransport()
        let api = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        await api.setAccessToken("device-manager-token")
        let model = BackstageViewModel(
            api: api,
            photoLibrary: InertPhotoLibrary(),
            preferences: preferences,
            workflowRecoveryStore: nil,
            currentImageSizeCache: nil,
            customerPhotoLinks: nil
        )
        model.authentication = OwnerAuthenticationSnapshot(
            phase: .authenticated,
            deviceId: "owner-device-current",
            accessExpiresAt: Date().addingTimeInterval(900)
        )

        await model.refreshOwnerDevices()
        #expect(model.ownerDeviceManagementStatus == "2 active Macs • 1 revoked")
        let historicalDevice = try #require(
            model.enrolledOwnerDevices.first { $0.id == "owner-device-historical" }
        )
        model.requestOwnerDeviceRevocation(historicalDevice)
        model.confirmOwnerDeviceRevocation()
        model.cancelOwnerDeviceRevocation()
        for _ in 0..<100 where !model.ownerDeviceManagementStatus.hasPrefix("Revoked ") {
            try await Task.sleep(for: .milliseconds(1))
        }

        #expect(await transport.revokedDeviceIDs() == ["owner-device-historical"])
        #expect(model.pendingOwnerDeviceRevocation == nil)
        #expect(model.enrolledOwnerDevices.map(\.id) == ["owner-device-current", "owner-device-revoked"])
        #expect(model.ownerDeviceManagementStatus == "Revoked Max Backstage. It can no longer renew an Owner session.")
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

    @Test("AI Review proposal fields remain drafts until explicit Approve")
    @MainActor
    func aiReviewProposalFieldsDoNotAutosave() async throws {
        let item = FixtureReviewItem(
            id: "review-proposal",
            photoLibraryIdentifier: "photos-review-proposal",
            title: "Current title",
            keywords: ["Current"],
            country: "",
            filename: "proposal.jpg",
            capturedAt: "2026-08-27T16:38:00Z",
            editorialState: "proposed",
            proposalReady: true,
            proposalContextAvailable: true,
            proposalID: "proposal-review",
            proposedTitle: "AI title",
            proposedKeywords: ["Interior", "Sea view"],
            proposedCountry: "spain",
            proposalReason: "Synthetic bounded preview.",
            proposalStatus: "ready"
        )
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            workflowRecoveryStore: nil,
            currentImageSizeCache: nil,
            customerPhotoLinks: nil
        )
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        model.fixtureReviewWindow = FixtureReviewWindow(
            fixtureID: "fixture-expo",
            mode: .full,
            reviewStateFilters: ["picked"],
            offset: 0,
            limit: 200,
            nextOffset: 0,
            hasNext: false,
            summary: FixtureReviewSummary(
                total: 1,
                unreviewed: 0,
                requestingAI: 0,
                proposed: 1,
                approved: 0
            ),
            items: [item]
        )
        model.reviewSelection = OwnerSelectionModel(
            orderedIDs: [item.id],
            selectedIDs: [item.id],
            anchorID: item.id,
            focusedID: item.id
        )
        model.reviewProposalDrafts[item.id] = ReviewMetadataDraft(
            country: "spain",
            title: "AI title",
            keywords: ["Interior", "Sea view"],
            proposalID: "proposal-review",
            proposalReason: "Synthetic bounded preview.",
            proposalStatus: "ready"
        )
        model.reviewCountry = "spain"
        model.reviewTitle = "AI title"
        model.reviewKeywords = "Interior, Sea view"

        // SwiftUI can commit an unchanged text-field binding while the window
        // is closing. That must not consume the proposal.
        model.updateReviewTitle("AI title")
        #expect(model.reviewProposalDrafts[item.id]?.hasManualEdits == false)
        #expect(model.reviewStatus.contains("remains a draft"))

        model.updateReviewTitle("Edited AI title")
        model.updateReviewKeywords("Interior, Sea view, Balcony")
        model.updateReviewCountry("portugal")
        try await Task.sleep(for: .milliseconds(700))

        #expect(model.reviewProposalDrafts[item.id]?.hasManualEdits == true)
        #expect(model.reviewProposalDrafts[item.id]?.title == "Edited AI title")
        #expect(model.reviewProposalDrafts[item.id]?.keywords == ["Interior", "Sea view", "Balcony"])
        #expect(model.reviewProposalDrafts[item.id]?.country == "portugal")
        #expect(model.reviewStatus.contains("Press Approve"))
        #expect(model.reviewHistory.isEmpty)
        #expect(model.reviewItems.first?.title == "Current title")
        #expect(model.reviewItems.first?.keywords == ["Current"])
        #expect(model.reviewItems.first?.country.isEmpty == true)
    }

    @Test("Apple Photos Country suggestion seeds the picker but title autosave does not accept it")
    @MainActor
    func locationCountrySuggestionRemainsDraftOnly() async throws {
        let item = FixtureReviewItem(
            id: "review-location-country",
            photoLibraryIdentifier: "photos-review-location-country",
            title: "Current title",
            keywords: ["Current"],
            country: "",
            suggestedCountry: "usa",
            countrySuggestionSource: "Apple Photos location",
            filename: "location.jpg",
            capturedAt: "2026-08-28T00:00:00Z"
        )
        let reviewService = CapturingReviewService()
        let aiStatusActions = (1...4).map { index in
            OwnerAction(
                id: "owner-action-country-ai-status-\(index)",
                actionKind: "sidecar-culling-review",
                target: "max",
                state: .completed,
                result: [
                    "ai": .object([
                        "active": false,
                        "requested": 0,
                        "ready": 0,
                    ]),
                ]
            )
        }
        let fixtureService = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: ReviewLifecycleActionAPI(terminalActions: aiStatusActions),
                waker: RejectingFixtureSelectionWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            localReviewService: reviewService
        )
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            fixtureService: fixtureService,
            workflowRecoveryStore: nil,
            currentImageSizeCache: nil,
            customerPhotoLinks: nil
        )
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        model.fixtureReviewWindow = FixtureReviewWindow(
            fixtureID: "fixture-expo",
            mode: .full,
            reviewStateFilters: ["picked"],
            offset: 0,
            limit: 200,
            nextOffset: 0,
            hasNext: false,
            countryWriteEnabled: true,
            summary: FixtureReviewSummary(
                total: 1,
                unreviewed: 1,
                requestingAI: 0,
                proposed: 0,
                approved: 0,
                countryMissing: 1
            ),
            items: [item]
        )
        model.reviewSelection = OwnerSelectionModel(orderedIDs: [item.id])
        model.clickReviewItem(item.id, modifiers: [])

        #expect(model.reviewCountry == "usa")
        model.updateReviewTitle("Edited title")
        #expect(model.reviewProposalDrafts[item.id]?.country == "")
        for _ in 0..<30 {
            if await reviewService.recordedManifests().last?["reviewAction"]?.stringValue == "edit-metadata" {
                break
            }
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(model.reviewItems.first?.country == "")
        let autosaves = await reviewService.recordedManifests()
        #expect(autosaves.last?["reviewAction"]?.stringValue == "edit-metadata")
        #expect(autosaves.last?["country"] == nil)

        await model.applyReviewAction(.approve)
        let approvals = await reviewService.recordedManifests()
        #expect(approvals.last?["reviewAction"]?.stringValue == "approve")
        #expect(approvals.last?["country"]?.stringValue == "usa")
    }

    @Test("Culling Waste Basket updates locally and exact Undo restores the same window")
    @MainActor
    func cullingWasteBasketOptimisticXAndUndo() async throws {
        let items = (1...3).map { index in
            FixtureAsset(
                id: "culling-x-\(index)",
                title: "Item \(index)",
                filename: "item-\(index).jpg",
                mediaType: "photo"
            )
        }
        let actionAPI = ReviewLifecycleActionAPI(terminalActions: [
            OwnerAction(
                id: "owner-action-culling-x",
                actionKind: "photo-moderation",
                target: "max",
                state: .completed,
                result: ["ok": true]
            ),
            OwnerAction(
                id: "owner-action-culling-restore",
                actionKind: "photo-moderation",
                target: "max",
                state: .completed,
                result: ["ok": true]
            ),
        ], terminalDelay: .milliseconds(50))
        let model = cullingWasteBasketModel(
            actionAPI: actionAPI,
            items: items,
            selectedIDs: [items[0].id, items[1].id],
            focusedID: items[0].id
        )

        await model.moveCullingSelectionToWasteBasket()
        for _ in 0..<300 where model.cullingHistory.isEmpty {
            try await Task.sleep(for: .milliseconds(1))
        }

        #expect(model.visibleCullingAssets.map(\.id) == [items[2].id])
        #expect(model.cullingSelection.selectedIDs == [items[2].id])
        #expect(model.cullingHistory.last?.wasteBasketMediaIDs == [items[0].id, items[1].id])
        #expect(model.cullingWasteBasketPendingActionID == "owner-action-culling-x")
        for _ in 0..<300 where model.cullingWasteBasketPendingActionID != nil {
            try await Task.sleep(for: .milliseconds(1))
        }

        await model.undoLastCullingDecision()

        #expect(model.cullingHistory.isEmpty)
        #expect(model.visibleCullingAssets.map(\.id) == items.map(\.id))
        #expect(model.cullingSelection.selectedIDs == [items[0].id, items[1].id])
        #expect(model.cullingSelection.focusedID == items[0].id)
        #expect(model.cullingWasteBasketPendingActionID == "owner-action-culling-restore")
        for _ in 0..<300 where model.cullingWasteBasketPendingActionID != nil {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.cullingStatus.contains("Restored 2 items from Waste Basket"))
        let requests = await actionAPI.requests()
        #expect(requests.map { $0.payload["operation"]?.stringValue } == [
            "waste-basket-x",
            "waste-basket-restore",
        ])
    }

    @Test("Culling Undo restores locally while X is pending and defers Put Back")
    @MainActor
    func cullingWasteBasketImmediateUndoWhileXPending() async throws {
        let items = (1...2).map { index in
            FixtureAsset(
                id: "culling-immediate-undo-\(index)",
                title: "Item \(index)",
                filename: "item-\(index).jpg",
                mediaType: "photo"
            )
        }
        let xActionID = "owner-action-culling-immediate-x"
        let restoreActionID = "owner-action-culling-immediate-restore"
        let actionAPI = ReviewLifecycleActionAPI(terminalActions: [
            OwnerAction(
                id: xActionID,
                actionKind: "photo-moderation",
                target: "max",
                state: .completed,
                result: ["ok": true]
            ),
            OwnerAction(
                id: restoreActionID,
                actionKind: "photo-moderation",
                target: "max",
                state: .completed,
                result: ["ok": true]
            ),
        ], terminalDelay: .milliseconds(200))
        let model = cullingWasteBasketModel(
            actionAPI: actionAPI,
            items: items,
            selectedIDs: [items[0].id],
            focusedID: items[0].id
        )

        await model.moveCullingSelectionToWasteBasket()
        for _ in 0..<300 where model.cullingHistory.isEmpty {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.visibleCullingAssets.map(\.id) == [items[1].id])
        #expect(model.cullingWasteBasketPendingActionIDs == [xActionID])

        await model.undoLastCullingDecision()

        #expect(model.cullingHistory.isEmpty)
        #expect(model.visibleCullingAssets.map(\.id) == items.map(\.id))
        #expect(model.cullingSelection.selectedIDs == [items[0].id])
        #expect(model.cullingWasteBasketDeferredUndoActionIDs == [xActionID])
        #expect(model.cullingStatus.contains("local Culling grid is restored"))
        #expect(await actionAPI.requests().count == 1)

        for _ in 0..<1_000 where await actionAPI.requests().count < 2 {
            try await Task.sleep(for: .milliseconds(1))
        }
        let requests = await actionAPI.requests()
        #expect(requests.map { $0.payload["operation"]?.stringValue } == [
            "waste-basket-x",
            "waste-basket-restore",
        ])
        #expect(model.cullingWasteBasketDeferredUndoActionIDs.isEmpty)
        #expect(model.cullingWasteBasketPendingActionIDs == [restoreActionID])

        for _ in 0..<1_000 where !model.cullingWasteBasketPendingActionIDs.isEmpty {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.cullingStatus.contains("Restored 1 item from Waste Basket"))
    }

    @Test("Fixture decision Undo restores selection without forcing a viewport recenter")
    @MainActor
    func fixtureDecisionUndoPreservesCullingAnchor() async throws {
        let items = [
            FixtureAsset(
                id: "culling-hidden",
                title: "Hidden",
                filename: "hidden.jpg",
                mediaType: "photo",
                placementState: .hidden
            ),
            FixtureAsset(
                id: "culling-picked",
                title: "Picked",
                filename: "picked.jpg",
                mediaType: "photo",
                placementState: .picked
            ),
        ]
        let placementService = RecordingFixturePlacementService(states: [
            items[0].id: .hidden,
            items[1].id: .picked,
        ])
        let actionAPI = ReviewLifecycleActionAPI(terminalActions: [])
        let fixtureService = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: actionAPI,
                waker: RejectingFixtureSelectionWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            localReviewService: placementService
        )
        let model = BackstageViewModel(
            photoLibrary: InertPhotoLibrary(),
            fixtureService: fixtureService,
            workflowRecoveryStore: nil
        )
        model.installFixtureTree(
            fixtureTree,
            preferredFixtureID: "fixture-expo",
            persistSelection: false
        )
        var window = cullingWindow(fixtureID: "fixture-expo", photos: 2, videos: 0)
        window.items = items
        model.fixtureCullingWindow = window
        model.cullingViews = [.hidden, .picked]
        model.cullingStates = Dictionary(uniqueKeysWithValues: items.map { item in
            (
                item.id,
                SidecarDecisionState(
                    assetId: item.id,
                    pickState: item.placementState.rawValue
                )
            )
        })
        model.cullingSelection = OwnerSelectionModel(
            orderedIDs: items.map(\.id),
            selectedIDs: Set(items.map(\.id)),
            anchorID: items[0].id,
            focusedID: items[1].id
        )

        #expect(await model.applyPickShortcut(.unpick))
        #expect(model.visibleCullingAssets.isEmpty)
        #expect(model.cullingHistory.last?.anchorID == items[0].id)
        #expect(model.cullingHistory.last?.focusedID == items[1].id)

        await model.undoLastCullingDecision()

        #expect(model.visibleCullingAssets.map(\.id) == items.map(\.id))
        #expect(model.cullingSelection.selectedIDs == Set(items.map(\.id)))
        #expect(model.cullingSelection.anchorID == items[0].id)
        #expect(model.cullingSelection.focusedID == items[1].id)
        #expect(await placementService.undoCount() == 1)
    }

    @Test("Culling Waste Basket allows consecutive X and Undo actions")
    @MainActor
    func cullingWasteBasketAllowsConsecutiveActions() async throws {
        let items = (1...3).map { index in
            FixtureAsset(
                id: "culling-consecutive-\(index)",
                title: "Item \(index)",
                filename: "item-\(index).jpg",
                mediaType: "photo"
            )
        }
        let actionAPI = ReviewLifecycleActionAPI(
            terminalActions: [
                OwnerAction(
                    id: "owner-action-culling-consecutive-x-1",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .completed,
                    result: ["ok": true]
                ),
                OwnerAction(
                    id: "owner-action-culling-consecutive-x-2",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .completed,
                    result: ["ok": true]
                ),
                OwnerAction(
                    id: "owner-action-culling-consecutive-restore-2",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .completed,
                    result: ["ok": true]
                ),
                OwnerAction(
                    id: "owner-action-culling-consecutive-restore-1",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .completed,
                    result: ["ok": true]
                ),
            ],
            terminalDelay: .milliseconds(100)
        )
        let model = cullingWasteBasketModel(
            actionAPI: actionAPI,
            items: items,
            selectedIDs: [items[0].id],
            focusedID: items[0].id
        )

        await model.moveCullingSelectionToWasteBasket()
        for _ in 0..<300 where model.cullingHistory.count < 1 {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.visibleCullingAssets.map(\.id) == [items[1].id, items[2].id])

        await model.moveCullingSelectionToWasteBasket()
        for _ in 0..<300 where model.cullingHistory.count < 2 {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.visibleCullingAssets.map(\.id) == [items[2].id])
        #expect(model.cullingWasteBasketPendingActionIDs.count == 2)

        for _ in 0..<600 where !model.cullingWasteBasketPendingActionIDs.isEmpty {
            try await Task.sleep(for: .milliseconds(1))
        }

        await model.undoLastCullingDecision()
        #expect(model.visibleCullingAssets.map(\.id) == [items[1].id, items[2].id])
        #expect(model.cullingWasteBasketPendingActionIDs == [
            "owner-action-culling-consecutive-restore-2",
        ])

        await model.undoLastCullingDecision()
        #expect(model.visibleCullingAssets.map(\.id) == items.map(\.id))
        #expect(model.cullingHistory.isEmpty)
        #expect(model.cullingWasteBasketPendingActionIDs == [
            "owner-action-culling-consecutive-restore-1",
            "owner-action-culling-consecutive-restore-2",
        ])

        for _ in 0..<600 where !model.cullingWasteBasketPendingActionIDs.isEmpty {
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

    @Test("Culling Waste Basket optimistic X rolls back without replacing the window")
    @MainActor
    func cullingWasteBasketXRollsBackOnFailure() async throws {
        let items = (1...2).map { index in
            FixtureAsset(
                id: "culling-rollback-\(index)",
                title: "Item \(index)",
                filename: "item-\(index).jpg",
                mediaType: "photo"
            )
        }
        let actionAPI = ReviewLifecycleActionAPI(terminalActions: [
            OwnerAction(
                id: "owner-action-culling-x-failure",
                actionKind: "photo-moderation",
                target: "max",
                state: .failed,
                error: ["message": "synthetic X failure"]
            ),
        ], terminalDelay: .milliseconds(50))
        let model = cullingWasteBasketModel(
            actionAPI: actionAPI,
            items: items,
            selectedIDs: [items[0].id],
            focusedID: items[0].id
        )

        await model.moveCullingSelectionToWasteBasket()
        for _ in 0..<300 where model.cullingHistory.isEmpty {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.visibleCullingAssets.map(\.id) == [items[1].id])

        for _ in 0..<300 where model.cullingWasteBasketPendingActionID != nil {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.visibleCullingAssets.map(\.id) == items.map(\.id))
        #expect(model.cullingSelection.selectedIDs == [items[0].id])
        #expect(model.cullingHistory.isEmpty)
        #expect(model.cullingStatus.contains("local Culling grid was restored"))
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
        let actionAPI = ReviewLifecycleActionAPI(
            terminalActions: [
                OwnerAction(
                    id: "owner-action-put-back",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .completed,
                    result: ["ok": true]
                ),
            ],
            terminalDelay: .milliseconds(50)
        )
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
        #expect(model.selectedLifecycleIDs.isEmpty)
        #expect(model.lifecycleRestorePendingActionID == "owner-action-put-back")
        for _ in 0..<300 where model.lifecycleRestorePendingActionID != nil {
            try? await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.lifecycleStatus.contains("Restored 1 item"))
        #expect(model.lifecycleStatus.contains("owner-action-put-back"))
        let requests = await actionAPI.requests()
        #expect(requests.map { $0.payload["operation"]?.stringValue } == [
            "waste-basket-restore",
        ])
    }

    @Test("Waste Basket Put back rolls failed rows into the exact local position")
    @MainActor
    func wasteBasketPutBackRollsBackLocally() async throws {
        let first = LifecycleItem(json: [
            "mediaId": "put-back-first",
            "state": "hidden",
            "title": "First",
        ])
        let second = LifecycleItem(json: [
            "mediaId": "put-back-second",
            "state": "hidden",
            "title": "Second",
        ])
        let third = LifecycleItem(json: [
            "mediaId": "put-back-third",
            "state": "hidden",
            "title": "Third",
        ])
        let actionAPI = ReviewLifecycleActionAPI(
            terminalActions: [
                OwnerAction(
                    id: "owner-action-put-back-failure",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .failed,
                    error: ["message": "synthetic Put Back failure"]
                ),
            ],
            terminalDelay: .milliseconds(50)
        )
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
        model.lifecycleItems = [first, second, third]
        model.selectedLifecycleIDs = [first.id, third.id]

        await model.restoreLifecycleSelection()

        #expect(model.lifecycleItems.map(\.id) == [second.id])
        #expect(model.selectedLifecycleIDs.isEmpty)
        for _ in 0..<300 where model.lifecycleRestorePendingActionID != nil {
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(model.lifecycleItems.map(\.id) == [first.id, second.id, third.id])
        #expect(model.selectedLifecycleIDs == [first.id, third.id])
        #expect(model.lifecycleStatus.contains("restored locally"))
    }

    @Test("Failed Empty Waste Basket action remains visible with terminal feedback")
    @MainActor
    func failedEmptyWasteBasketRetainsActionAndFeedback() async throws {
        let actionAPI = ReviewLifecycleActionAPI(
            terminalActions: [
                OwnerAction(
                    id: "owner-action-empty-failure",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .failed,
                    error: ["message": "synthetic Empty failure"]
                ),
            ],
            terminalDelay: .milliseconds(50)
        )
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
            "mediaId": "recoverable-empty-failure",
            "state": "hidden",
            "title": "Recoverable",
        ])]

        await model.emptyWasteBasket()
        for _ in 0..<300 where !model.lifecycleStatus.contains("no retry") {
            try await Task.sleep(for: .milliseconds(1))
        }

        #expect(model.lifecycleItems.count == 1)
        #expect(model.actions.first(where: { $0.id == "owner-action-empty-failure" })?.state == .failed)
        #expect(model.lifecycleStatus.contains("owner-action-empty-failure"))
        #expect(model.lifecycleStatus.contains("remain recoverable"))
        #expect(model.lifecycleStatus.contains("no retry"))
    }

    @Test("Mixed Empty Waste Basket reports retained local-only rows after refresh")
    @MainActor
    func mixedEmptyWasteBasketReportsRetainedLocalOnlyRows() async throws {
        let actionAPI = ReviewLifecycleActionAPI(terminalActions: [
            OwnerAction(
                id: "owner-action-mixed-empty",
                actionKind: "photo-moderation",
                target: "max",
                state: .completed,
                result: [
                    "result": ["assetIds": ["asset-deployed"]],
                    "lifecycle": [
                        "scope": "mixed",
                        "partial": true,
                        "retainedLocalOnlyAssetIds": ["asset-local-only"],
                    ],
                ]
            ),
            OwnerAction(
                id: "owner-action-lifecycle-refresh",
                actionKind: "sidecar-culling-review",
                target: "max",
                state: .completed,
                result: [
                    "lifecycle": [
                        "hiddenCount": 1,
                        "discardedCount": 1,
                        "items": [[
                            "mediaId": "asset-local-only",
                            "state": "hidden",
                            "title": "Local only",
                        ]],
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

        await model.emptyWasteBasket()
        for _ in 0..<300 where !model.lifecycleStatus.contains("local-only") {
            try await Task.sleep(for: .milliseconds(1))
        }

        #expect(model.lifecycleItems.map(\.id) == ["asset-local-only"])
        #expect(model.lifecycleStatus.contains("1 deployed item"))
        #expect(model.lifecycleStatus.contains("1 local-only item remains recoverable"))
        #expect(model.lifecycleStatus.contains("owner-action-mixed-empty"))
    }

    @Test("Failed Delete Selected action remains visible with terminal feedback")
    @MainActor
    func failedDeleteSelectedRetainsActionAndFeedback() async throws {
        let actionAPI = ReviewLifecycleActionAPI(
            terminalActions: [
                OwnerAction(
                    id: "owner-action-delete-selection-failure",
                    actionKind: "photo-moderation",
                    target: "max",
                    state: .failed,
                    error: ["message": "synthetic Delete Selected failure"]
                ),
            ],
            terminalDelay: .milliseconds(50)
        )
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
        let selected = LifecycleItem(json: [
            "mediaId": "recoverable-delete-selection-failure",
            "state": "hidden",
            "title": "Recoverable",
        ])
        model.lifecycleItems = [selected]
        model.selectedLifecycleIDs = [selected.id]

        await model.emptyWasteBasketSelection()
        for _ in 0..<300 where !model.lifecycleStatus.contains("no retry") {
            try await Task.sleep(for: .milliseconds(1))
        }

        #expect(model.lifecycleItems.count == 1)
        #expect(model.actions.first(where: { $0.id == "owner-action-delete-selection-failure" })?.state == .failed)
        #expect(model.lifecycleStatus.contains("owner-action-delete-selection-failure"))
        #expect(model.lifecycleStatus.contains("remain recoverable"))
        #expect(model.lifecycleStatus.contains("no retry"))
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

    @Test("A stalled Culling thumbnail times out and Quick Look recovers that card in place")
    @MainActor
    func stalledCullingThumbnailIsRecoveredByQuickLook() async {
        let photoLibrary = StalledThumbnailPhotoLibrary()
        let model = BackstageViewModel(
            photoLibrary: photoLibrary,
            cullingThumbnailTimeout: .milliseconds(40)
        )
        let asset = FixturePoolAsset(
            id: "asset-stalled-thumbnail",
            position: 0,
            title: "Stalled thumbnail",
            filename: "stalled-thumbnail.jpg",
            mediaType: "photo"
        )
        model.cullingPool = FixturePool(
            id: "pool-stalled-thumbnail",
            name: "Stalled thumbnail",
            fixtureID: "fixture-stalled-thumbnail",
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
        model.cullingWindowOffset = 37
        model.cullingSearch = "stalled"
        let originalRatingFilters = model.cullingRatingFilters
        let originalColorFilters = model.cullingColorFilters

        model.requestThumbnail(for: asset.id)
        for _ in 0..<40 {
            if model.cullingThumbnailFailures[asset.id] == .timedOut { break }
            try? await Task.sleep(for: .milliseconds(10))
        }

        #expect(model.cullingThumbnails[asset.id] == nil)
        #expect(model.cullingThumbnailFailures[asset.id] == .timedOut)

        let urls = await model.prepareQuickLookURLs()

        #expect(urls.count == 1)
        #expect(model.cullingThumbnails[asset.id] != nil)
        #expect(model.cullingThumbnailFailures[asset.id] == nil)
        #expect(model.selectedCullingAssetIDs == [asset.id])
        #expect(model.cullingSelection.focusedID == asset.id)
        #expect(model.cullingWindowOffset == 37)
        #expect(model.cullingSearch == "stalled")
        #expect(model.cullingRatingFilters == originalRatingFilters)
        #expect(model.cullingColorFilters == originalColorFilters)
        #expect(photoLibrary.requestedPixelSizes().contains(180))
        #expect(photoLibrary.requestedPixelSizes().contains(4_000))
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

    @Test("Culling thumbnail upgrades stay bounded and cancel when scrolling resumes")
    @MainActor
    func cullingThumbnailUpgradesAreBoundedAndCancelOnScroll() async {
        let photoLibrary = BoundedUpgradePhotoLibrary()
        let model = BackstageViewModel(
            photoLibrary: photoLibrary,
            cullingThumbnailUpgradeDelay: .milliseconds(1)
        )
        let assets = (0..<10).map { index in
            FixtureAsset(
                id: "asset-bounded-upgrade-\(index)",
                title: "Bounded upgrade \(index)",
                filename: "bounded-upgrade-\(index).jpg",
                mediaType: "photo"
            )
        }

        for asset in assets {
            model.cullingAssetDidAppear(asset)
        }

        for _ in 0..<100 where photoLibrary.startedUpgradeCount < 4 {
            try? await Task.sleep(for: .milliseconds(10))
        }
        try? await Task.sleep(for: .milliseconds(50))

        #expect(photoLibrary.startedUpgradeCount == 4)
        #expect(photoLibrary.maximumConcurrentUpgradeRequests == 4)

        model.cullingScrollPhaseChanged(isScrolling: true)
        for _ in 0..<100 where photoLibrary.cancelledUpgradeCount < 4 {
            try? await Task.sleep(for: .milliseconds(10))
        }

        #expect(photoLibrary.cancelledUpgradeCount == 4)
        #expect(photoLibrary.activeUpgradeRequests == 0)
    }

    @Test("Idle thumbnail backfill caps the loaded APL set at 2000 items")
    @MainActor
    func idleThumbnailBackfillCapsLoadedAPLSet() async {
        let photoLibrary = RecordingPreviewPhotoLibrary()
        let model = BackstageViewModel(
            photoLibrary: photoLibrary,
            cullingThumbnailUpgradeDelay: .seconds(60),
            cullingThumbnailBackfillDelay: .milliseconds(1)
        )
        model.libraryItems = (0..<2_005).map { index in
            PhotoLibraryItem(
                id: "asset-apl-backfill-\(index)",
                filename: "apl-backfill-\(index).jpg",
                creationDate: nil,
                mediaType: "photo"
            )
        }

        model.cullingAssetDidAppear(
            FixtureAsset(
                id: "asset-apl-backfill-0",
                title: "APL backfill 0",
                filename: "apl-backfill-0.jpg",
                mediaType: "photo"
            )
        )

        for _ in 0..<500 {
            if model.cullingThumbnails.count == 2_000 { break }
            try? await Task.sleep(for: .milliseconds(10))
        }

        let requestedPixelSizes = photoLibrary.requestedPixelSizes()
        #expect(requestedPixelSizes.filter { $0 == 180 }.count == 2_000)
        #expect(requestedPixelSizes.filter { $0 >= 900 }.isEmpty)
        #expect(model.cullingThumbnails.count == 2_000)
        #expect(model.cullingThumbnails["asset-apl-backfill-0"] != nil)
        model.cullingScrollPhaseChanged(isScrolling: true)
        await model.loadThumbnail(for: "new-foreground-card")
        #expect(model.cullingThumbnails.count == 2_000)
        #expect(model.cullingThumbnails["new-foreground-card"] != nil)
        #expect(model.cullingThumbnails["asset-apl-backfill-0"] != nil)
    }

    @Test("Idle upgrades visit every visible card once without repeating completed work")
    @MainActor
    func idleThumbnailUpgradesFinishWithoutRepeating() async {
        let photoLibrary = RecordingPreviewPhotoLibrary()
        let model = BackstageViewModel(
            photoLibrary: photoLibrary,
            cullingThumbnailUpgradeDelay: .milliseconds(1)
        )
        let assets = (0..<50).map {
            FixtureAsset(id: "visible-\($0)", title: "", filename: "\($0).jpg", mediaType: "photo")
        }
        for asset in assets { model.cullingAssetDidAppear(asset) }
        for _ in 0..<100 {
            if Set(photoLibrary.requestedIDs(at: 900)).count == assets.count { break }
            try? await Task.sleep(for: .milliseconds(10))
        }
        try? await Task.sleep(for: .milliseconds(40))
        model.cullingScrollPhaseChanged(isScrolling: true)
        model.cullingScrollPhaseChanged(isScrolling: false)
        try? await Task.sleep(for: .milliseconds(40))
        #expect(photoLibrary.requestedIDs(at: 900).sorted() == assets.map(\.id).sorted())
        model.cullingScrollPhaseChanged(isScrolling: true)
    }

    @Test("Idle thumbnail upgrades retry a transient Photos preview failure")
    @MainActor
    func idleThumbnailUpgradeRetriesTransientFailure() async throws {
        let asset = FixtureAsset(
            id: "visible-flaky",
            title: "",
            filename: "visible-flaky.jpg",
            mediaType: "photo"
        )
        let photoLibrary = RecordingPreviewPhotoLibrary(
            transientUpgradeFailures: [asset.id: 1]
        )
        let model = BackstageViewModel(
            photoLibrary: photoLibrary,
            cullingThumbnailUpgradeDelay: .milliseconds(1)
        )
        model.cullingScrollPhaseChanged(isScrolling: true)
        model.cullingAssetDidAppear(asset)
        for _ in 0..<50 where model.cullingThumbnails[asset.id] == nil {
            try? await Task.sleep(for: .milliseconds(10))
        }
        let basic = try #require(model.cullingThumbnails[asset.id])

        model.cullingScrollPhaseChanged(isScrolling: false)
        for _ in 0..<100 where model.cullingThumbnails[asset.id] === basic {
            try? await Task.sleep(for: .milliseconds(10))
        }

        #expect(photoLibrary.requestedIDs(at: 900) == [asset.id, asset.id])
        #expect(model.cullingThumbnails[asset.id] !== basic)
        model.cullingScrollPhaseChanged(isScrolling: true)
    }

    @Test("Offscreen cards retain completed idle upgrades and reuse them on return")
    @MainActor
    func offscreenThumbnailRetainsUpgrade() async throws {
        let photoLibrary = RecordingPreviewPhotoLibrary()
        let model = BackstageViewModel(
            photoLibrary: photoLibrary,
            cullingThumbnailUpgradeDelay: .milliseconds(1)
        )
        let asset = FixtureAsset(id: "visible", title: "", filename: "visible.jpg", mediaType: "photo")
        model.cullingScrollPhaseChanged(isScrolling: true)
        model.cullingAssetDidAppear(asset)
        for _ in 0..<50 where model.cullingThumbnails[asset.id] == nil {
            try? await Task.sleep(for: .milliseconds(10))
        }
        let basic = try #require(model.cullingThumbnails[asset.id])
        model.cullingScrollPhaseChanged(isScrolling: false)
        for _ in 0..<50 where model.cullingThumbnails[asset.id] === basic {
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(model.cullingThumbnails[asset.id] !== basic)
        let upgraded = try #require(model.cullingThumbnails[asset.id])
        model.cullingAssetDidDisappear(asset.id)
        #expect(model.cullingThumbnails[asset.id] === upgraded)
        model.cullingAssetDidAppear(asset)
        #expect(model.cullingThumbnails[asset.id] === upgraded)
        model.cullingScrollPhaseChanged(isScrolling: true)
        model.cullingAssetDidDisappear(asset.id)
        model.cullingAssetDidAppear(asset)
        model.cullingScrollPhaseChanged(isScrolling: false)
        try? await Task.sleep(for: .milliseconds(40))
        #expect(photoLibrary.requestedIDs(at: 900) == [asset.id])
        model.cancelCullingThumbnailWork()
    }

    @Test("Quick Look recovery keeps only a bounded aspect-correct basic thumbnail")
    @MainActor
    func recoveredQuickLookThumbnailIsBounded() throws {
        let source = NSImage(size: NSSize(width: 4_000, height: 2_000), flipped: false) { rect in
            NSColor.systemGreen.setFill()
            rect.fill()
            return true
        }
        let thumbnail = BackstageViewModel.basicThumbnail(from: source)
        #expect(thumbnail.size == NSSize(width: 180, height: 90))
        let bitmap = try #require(thumbnail.representations.first as? NSBitmapImageRep)
        #expect(bitmap.pixelsWide == 180)
        #expect(bitmap.pixelsHigh == 90)
    }

    @Test("Late larger-image completions after scrolling cannot replace basic thumbnails")
    @MainActor
    func cancelledThumbnailUpgradeIgnoresLateResult() async throws {
        let photoLibrary = BoundedUpgradePhotoLibrary(returnsAfterCancellation: true)
        let model = BackstageViewModel(
            photoLibrary: photoLibrary, cullingThumbnailUpgradeDelay: .milliseconds(1)
        )
        let asset = FixtureAsset(id: "late", title: "", filename: "late.jpg", mediaType: "photo")
        model.cullingAssetDidAppear(asset)
        for _ in 0..<50 where photoLibrary.startedUpgradeCount == 0 {
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(photoLibrary.startedUpgradeCount == 1)
        let basic = try #require(model.cullingThumbnails[asset.id])
        model.cullingScrollPhaseChanged(isScrolling: true)
        for _ in 0..<50 where photoLibrary.activeUpgradeRequests > 0 {
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(photoLibrary.cancelledUpgradeCount == 1)
        #expect(model.cullingThumbnails[asset.id] === basic)
        model.cancelCullingThumbnailWork()
    }

    @Test("Idle backfill cancels on scroll, resumes missing thumbnails, and stops on Gallery exit")
    @MainActor
    func idleBackfillCancelsAndResumes() async {
        let photoLibrary = RecordingPreviewPhotoLibrary()
        let model = BackstageViewModel(
            photoLibrary: photoLibrary,
            cullingThumbnailUpgradeDelay: .seconds(60),
            cullingThumbnailBackfillDelay: .milliseconds(1)
        )
        model.libraryItems = (0..<20).map {
            PhotoLibraryItem(id: "apl-\($0)", filename: "\($0).jpg", creationDate: nil, mediaType: "photo")
        }
        await model.loadThumbnail(for: "apl-0")
        photoLibrary.setThumbnailDelay(.seconds(60))
        let asset = FixtureAsset(id: "apl-0", title: "", filename: "0.jpg", mediaType: "photo")
        model.cullingAssetDidAppear(asset)
        for _ in 0..<50 where photoLibrary.requestedIDs(at: 180).count < 5 {
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(photoLibrary.requestedIDs(at: 180).count == 5)
        model.cullingScrollPhaseChanged(isScrolling: true)
        for _ in 0..<50 where photoLibrary.cancelledThumbnails < 4 {
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(photoLibrary.cancelledThumbnails == 4)
        try? await Task.sleep(for: .milliseconds(40))
        #expect(photoLibrary.requestedIDs(at: 180).count == 5)
        photoLibrary.setThumbnailDelay(.zero)
        model.cullingScrollPhaseChanged(isScrolling: false)
        for _ in 0..<100 where model.cullingThumbnails.count < 20 {
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(model.cullingThumbnails.count == 20)
        #expect(model.cullingThumbnailFailures.isEmpty)
        #expect(photoLibrary.requestedIDs(at: 900).isEmpty)
        model.cancelCullingThumbnailWork()
        let count = photoLibrary.requestedPixelSizes().count
        model.cullingScrollPhaseChanged(isScrolling: false)
        try? await Task.sleep(for: .milliseconds(40))
        #expect(photoLibrary.requestedPixelSizes().count == count)
    }

    @Test("A stalled backfill times out and remains explicitly retryable")
    @MainActor
    func idleBackfillTimeoutCanRetry() async {
        let photoLibrary = RecordingPreviewPhotoLibrary()
        let model = BackstageViewModel(
            photoLibrary: photoLibrary,
            cullingThumbnailTimeout: .milliseconds(40),
            cullingThumbnailUpgradeDelay: .seconds(60),
            cullingThumbnailBackfillDelay: .milliseconds(1)
        )
        model.libraryItems = (0..<10).map {
            PhotoLibraryItem(id: "apl-\($0)", filename: "\($0).jpg", creationDate: nil, mediaType: "photo")
        }
        await model.loadThumbnail(for: "apl-0")
        photoLibrary.setThumbnailDelay(.seconds(60))
        model.cullingAssetDidAppear(FixtureAsset(id: "apl-0", title: "", filename: "0.jpg", mediaType: "photo"))
        for _ in 0..<100 where model.cullingThumbnailFailures.count < 9 {
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(model.cullingThumbnailFailures.count == 9)
        #expect(model.cullingThumbnailFailures["apl-1"] == .timedOut)
        photoLibrary.setThumbnailDelay(.zero)
        model.retryThumbnail(for: "apl-1")
        for _ in 0..<50 where model.cullingThumbnails["apl-1"] == nil {
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(model.cullingThumbnails["apl-1"] != nil)
        #expect(model.cullingThumbnailFailures["apl-1"] == nil)
        model.cancelCullingThumbnailWork()
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
    private func cullingWasteBasketModel(
        actionAPI: ReviewLifecycleActionAPI,
        items: [FixtureAsset],
        selectedIDs: Set<String>,
        focusedID: String
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
        var window = cullingWindow(
            fixtureID: "fixture-expo",
            photos: items.count,
            videos: 0
        )
        window.items = items
        window.summary = FixtureCullingSummary(json: [
            "filtered": .number(Double(items.count)),
            "universe": .number(Double(items.count)),
            "undecided": .number(Double(items.count)),
            "picked": .number(0),
            "hidden": .number(0),
        ])
        model.fixtureCullingWindow = window
        model.cullingStates = Dictionary(uniqueKeysWithValues: items.map { item in
            (
                item.id,
                SidecarDecisionState(
                    assetId: item.id,
                    pickState: item.placementState.rawValue
                )
            )
        })
        model.cullingSelection = OwnerSelectionModel(
            orderedIDs: items.map(\.id),
            selectedIDs: selectedIDs,
            anchorID: focusedID,
            focusedID: focusedID
        )
        return model
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

private actor DeviceRevocationTransport: OwnerAPITransport {
    private var revokedIDs: [String] = []

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url?.path ?? ""
        let body: String
        if request.httpMethod == "GET", path == "/api/v1/devices" {
            body = """
            {
              "ok":true,
              "devices":[
                {
                  "id":"owner-device-historical",
                  "name":"Max Backstage",
                  "platform":"MacIntel",
                  "createdAt":"2026-07-25T07:06:25Z",
                  "lastUsedAt":null,
                  "revokedAt":null
                },
                {
                  "id":"owner-device-current",
                  "name":"Max Backstage",
                  "platform":"MacIntel",
                  "createdAt":"2026-07-25T08:29:04Z",
                  "lastUsedAt":null,
                  "revokedAt":null
                },
                {
                  "id":"owner-device-revoked",
                  "name":"Old Max Backstage",
                  "platform":"MacIntel",
                  "createdAt":"2026-07-25T06:42:00Z",
                  "lastUsedAt":"2026-07-25T07:00:00Z",
                  "revokedAt":"2026-08-28T12:00:00Z"
                }
              ]
            }
            """
        } else if request.httpMethod == "POST",
                  path == "/api/v1/devices/owner-device-historical/revoke" {
            revokedIDs.append("owner-device-historical")
            body = """
            {
              "ok":true,
              "device":{
                "id":"owner-device-historical",
                "name":"Max Backstage",
                "platform":"MacIntel",
                "createdAt":"2026-07-25T07:06:25Z",
                "lastUsedAt":null,
                "revokedAt":"2026-08-28T12:08:00Z"
              }
            }
            """
        } else {
            throw URLError(.resourceUnavailable)
        }
        return (
            Data(body.utf8),
            HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        )
    }

    func revokedDeviceIDs() -> [String] { revokedIDs }
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

private actor CapturingReviewService: LocalFixtureReviewServing {
    private var manifests: [[String: JSONValue]] = []

    func applyReview(manifest: [String: JSONValue]) async throws -> FixtureReviewResult {
        manifests.append(manifest)
        let action = manifest["reviewAction"]?.stringValue ?? "edit-metadata"
        let assetID = manifest["anchorAssetId"]?.stringValue ?? ""
        let title = manifest["title"]?.stringValue ?? "Current title"
        let keywords = manifest["keywords"]?.arrayValue ?? [.string("Current")]
        let country = manifest["country"]?.stringValue ?? ""
        return FixtureReviewResult(json: [
            "operationId": .string("captured-\(manifests.count)"),
            "fixtureId": manifest["fixtureId"] ?? .string(""),
            "action": .string(action),
            "anchorAssetId": .string(assetID),
            "propagated": manifest["propagate"] ?? .bool(false),
            "items": .array([
                .object([
                    "assetId": .string(assetID),
                    "before": .object([
                        "title": .string("Current title"),
                        "keywords": .array([.string("Current")]),
                        "country": .string(""),
                        "editorialState": .string("unreviewed"),
                    ]),
                    "after": .object([
                        "title": .string(title),
                        "keywords": .array(keywords),
                        "country": .string(country),
                        "editorialState": .string(action == "approve" ? "approved" : "unreviewed"),
                    ]),
                    "review": .object([:]),
                ]),
            ]),
            "timing": .object([:]),
        ])
    }

    func undoReview(operationID: String) async throws -> FixtureReviewUndoResult {
        throw CancellationError()
    }

    func recordedManifests() -> [[String: JSONValue]] {
        manifests
    }
}

private actor RecordingFixturePlacementService: LocalFixtureReviewServing, LocalFixtureCullingServing {
    private var states: [String: FixturePlacementState]
    private var recordedUndoCount = 0

    init(states: [String: FixturePlacementState]) {
        self.states = states
    }

    func applyReview(manifest: [String: JSONValue]) async throws -> FixtureReviewResult {
        throw CancellationError()
    }

    func undoReview(operationID: String) async throws -> FixtureReviewUndoResult {
        throw CancellationError()
    }

    func nativeApplyCullingState(
        _ state: FixturePlacementState,
        fixtureID: String,
        assetIDs: [String],
        reason: String
    ) async throws -> [FixtureAssetState]? {
        assetIDs.map { assetID in
            let before = states[assetID] ?? .undecided
            states[assetID] = state
            return fixtureAssetState(
                fixtureID: fixtureID,
                assetID: assetID,
                placementState: state,
                beforePlacementState: before
            )
        }
    }

    func nativeUndoCullingState(
        _ applied: [FixtureAssetState],
        reason: String
    ) async throws -> [FixtureAssetState]? {
        recordedUndoCount += 1
        return applied.map { change in
            states[change.assetID] = change.beforePlacementState
            return fixtureAssetState(
                fixtureID: change.fixtureID,
                assetID: change.assetID,
                placementState: change.beforePlacementState,
                beforePlacementState: change.placementState
            )
        }
    }

    func undoCount() -> Int { recordedUndoCount }

    private func fixtureAssetState(
        fixtureID: String,
        assetID: String,
        placementState: FixturePlacementState,
        beforePlacementState: FixturePlacementState
    ) -> FixtureAssetState {
        FixtureAssetState(json: [
            "fixtureId": .string(fixtureID),
            "assetId": .string(assetID),
            "placementState": .string(placementState.rawValue),
            "eligibilityState": .string("active"),
            "source": .string("test"),
            "beforePlacementState": .string(beforePlacementState.rawValue),
            "beforeEligibilityState": .string("active"),
        ])
    }
}

private struct CustomerPhotoTestResolver: CustomerPhotoLinkResolving {
    var error: CustomerPhotoLinkError? = nil
    var gate: DispatchSemaphore? = nil

    func resolve(assetID: String, fixtureID: String) throws -> CustomerPhotoLink {
        if let gate, gate.wait(timeout: .now() + 5) == .timedOut {
            throw CustomerPhotoLinkError.unavailable
        }
        if let error { throw error }
        return try CustomerPhotoLink(publishedMediaID: "published-id")
    }
}

private actor RecordingGalleryReviewService: LocalFixtureReviewServing {
    private var states: [String: (editorial: String, delivery: String)]
    private var beforeStates: [String: (editorial: String, delivery: String)] = [:]
    private var appliedIDs: [String] = []
    private var undoneOperationIDs: [String] = []

    init(states: [String: (String, String)]) {
        self.states = states
    }

    func applyReview(manifest: [String: JSONValue]) async throws -> FixtureReviewResult {
        let ids = manifest["assetIds"]?.arrayValue?.compactMap(\.stringValue) ?? []
        appliedIDs = ids
        let items = ids.map { assetID -> JSONValue in
            let before = states[assetID] ?? ("unreviewed", "not-ready")
            beforeStates[assetID] = before
            let after = (
                editorial: "unreviewed",
                delivery: before.delivery == "live" ? "live" : "not-ready"
            )
            states[assetID] = after
            let beforeJSON: JSONValue = .object([
                "editorialState": .string(before.editorial),
                "deliveryState": .string(before.delivery),
            ])
            let afterJSON: JSONValue = .object([
                "editorialState": .string(after.editorial),
                "deliveryState": .string(after.delivery),
            ])
            return .object([
                "assetId": .string(assetID),
                "before": beforeJSON,
                "after": afterJSON,
                "review": afterJSON,
            ])
        }
        return FixtureReviewResult(json: [
            "operationId": "gallery-return-operation",
            "fixtureId": manifest["fixtureId"] ?? "",
            "action": manifest["reviewAction"] ?? "return-to-review",
            "anchorAssetId": manifest["anchorAssetId"] ?? "",
            "propagated": false,
            "items": .array(items),
        ])
    }

    func undoReview(operationID: String) async throws -> FixtureReviewUndoResult {
        undoneOperationIDs.append(operationID)
        let items = appliedIDs.map { assetID -> JSONValue in
            let beforeUndo = states[assetID] ?? ("unreviewed", "not-ready")
            let restored = beforeStates[assetID] ?? beforeUndo
            states[assetID] = restored
            let beforeJSON: JSONValue = .object([
                "editorialState": .string(beforeUndo.editorial),
                "deliveryState": .string(beforeUndo.delivery),
            ])
            let restoredJSON: JSONValue = .object([
                "editorialState": .string(restored.editorial),
                "deliveryState": .string(restored.delivery),
            ])
            return .object([
                "assetId": .string(assetID),
                "before": beforeJSON,
                "after": restoredJSON,
                "review": restoredJSON,
            ])
        }
        return FixtureReviewUndoResult(json: [
            "operationId": .string(operationID),
            "fixtureId": "fixture-expo",
            "action": "return-to-review",
            "alreadyUndone": false,
            "items": .array(items),
        ])
    }

    func appliedAssetIDs() -> [String] { appliedIDs }
    func undoOperationIDs() -> [String] { undoneOperationIDs }
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

private final class StalledThumbnailPhotoLibrary: PhotoLibraryServing, @unchecked Sendable {
    private let lock = NSLock()
    private var pixelSizes: [Int] = []
    private static let previewData = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!

    func authorization() -> PhotoLibraryAccess { .authorized }

    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }

    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        lock.withLock { pixelSizes.append(maxPixelSize) }
        if maxPixelSize <= 180 {
            try await Task.sleep(for: .seconds(60))
        }
        return PhotoPreview(
            assetID: localIdentifier,
            jpegData: Self.previewData,
            pixelWidth: maxPixelSize,
            pixelHeight: maxPixelSize
        )
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.exportFailed("Synthetic stalled-thumbnail test does not export originals.")
    }

    func requestedPixelSizes() -> [Int] {
        lock.withLock { pixelSizes }
    }
}

private final class RecordingPreviewPhotoLibrary: PhotoLibraryServing, @unchecked Sendable {
    private let lock = NSLock()
    private var pixelSizes: [Int] = []
    private var requests: [(String, Int)] = []
    private var thumbnailDelay: Duration = .zero
    private var cancelled = 0
    private var transientUpgradeFailures: [String: Int]
    private static let previewData = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!

    init(transientUpgradeFailures: [String: Int] = [:]) {
        self.transientUpgradeFailures = transientUpgradeFailures
    }

    func authorization() -> PhotoLibraryAccess { .authorized }

    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }

    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        let shouldFailTransiently = lock.withLock {
            pixelSizes.append(maxPixelSize)
            requests.append((localIdentifier, maxPixelSize))
            guard maxPixelSize >= 900,
                  let remaining = transientUpgradeFailures[localIdentifier],
                  remaining > 0
            else { return false }
            transientUpgradeFailures[localIdentifier] = remaining - 1
            return true
        }
        if shouldFailTransiently {
            throw PhotoLibraryError.previewUnavailable(localIdentifier)
        }
        if maxPixelSize == 180 {
            let delay = lock.withLock { thumbnailDelay }
            do {
                try await Task.sleep(for: delay)
            } catch {
                lock.withLock { cancelled += 1 }
                throw error
            }
        }
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

    func requestedIDs(at pixelSize: Int) -> [String] {
        lock.withLock { requests.filter { $0.1 == pixelSize }.map(\.0) }
    }

    func setThumbnailDelay(_ delay: Duration) {
        lock.withLock { thumbnailDelay = delay }
    }

    var cancelledThumbnails: Int { lock.withLock { cancelled } }
}

private final class BoundedUpgradePhotoLibrary: PhotoLibraryServing, @unchecked Sendable {
    private let lock = NSLock()
    private var active = 0
    private var maximumActive = 0
    private var started = 0
    private var cancelled = 0
    private let returnsAfterCancellation: Bool
    private static let previewData = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!

    init(returnsAfterCancellation: Bool = false) {
        self.returnsAfterCancellation = returnsAfterCancellation
    }

    func authorization() -> PhotoLibraryAccess { .authorized }

    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }

    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        guard maxPixelSize >= 900 else {
            return PhotoPreview(
                assetID: localIdentifier,
                jpegData: Self.previewData,
                pixelWidth: maxPixelSize,
                pixelHeight: maxPixelSize
            )
        }

        lock.withLock {
            active += 1
            maximumActive = max(maximumActive, active)
            started += 1
        }
        defer { lock.withLock { active -= 1 } }
        do {
            try await Task.sleep(for: .seconds(60))
        } catch {
            lock.withLock { cancelled += 1 }
            if !returnsAfterCancellation { throw error }
        }
        return PhotoPreview(
            assetID: localIdentifier,
            jpegData: Self.previewData,
            pixelWidth: maxPixelSize,
            pixelHeight: maxPixelSize,
            currentImageByteCount: Int64(maxPixelSize * 1_000)
        )
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.exportFailed("Synthetic bounded-upgrade test does not export originals.")
    }

    var activeUpgradeRequests: Int {
        lock.withLock { active }
    }

    var maximumConcurrentUpgradeRequests: Int {
        lock.withLock { maximumActive }
    }

    var startedUpgradeCount: Int {
        lock.withLock { started }
    }

    var cancelledUpgradeCount: Int {
        lock.withLock { cancelled }
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
