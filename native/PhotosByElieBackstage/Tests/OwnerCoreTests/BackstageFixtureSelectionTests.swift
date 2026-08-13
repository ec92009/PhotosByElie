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

    @Test("PBE launch captures fixture synchronously and releases provisional freeze")
    @MainActor
    func pbeLaunchProvisionalFreeze() throws {
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
        #expect(model.selectFixture("fixture-expo") == false)
        #expect(model.selectedFixtureID == "fixture-pool")

        model.finishPBEOwnerLaunch()
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
