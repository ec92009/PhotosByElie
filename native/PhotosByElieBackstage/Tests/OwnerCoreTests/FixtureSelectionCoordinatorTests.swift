import Foundation
import Testing
@testable import OwnerCore

@Suite("Authoritative fixture selection")
struct FixtureSelectionCoordinatorTests {
    @Test("Restores the stable last-used fixture and its full breadcrumb")
    func restoresStableFixture() {
        var coordinator = FixtureSelectionCoordinator(
            lastUsedFixtureID: "fixture-re-la-concha-pool"
        )

        coordinator.restore(from: fixtureTree)

        #expect(coordinator.availability == .ready)
        #expect(coordinator.selectedFixtureID == "fixture-re-la-concha-pool")
        #expect(coordinator.selectedFixtureBreadcrumb == "RE › La Concha › Commons › Pool")
        #expect(coordinator.fixtureScopedActionsAllowed)
        #expect(coordinator.notice == nil)
    }

    @Test("Missing and archived preferences explicitly fall back to Expo")
    func explicitExpoFallbacks() {
        var missing = FixtureSelectionCoordinator(lastUsedFixtureID: "fixture-gone")
        missing.restore(from: fixtureTree)
        #expect(missing.selectedFixtureID == FixtureSelectionCoordinator.expoFixtureID)
        #expect(missing.notice == "The last-used fixture is no longer available, so Backstage is using Expo.")

        var archived = FixtureSelectionCoordinator(lastUsedFixtureID: "fixture-archive")
        archived.restore(from: fixtureTree)
        #expect(archived.selectedFixtureID == FixtureSelectionCoordinator.expoFixtureID)
        #expect(archived.notice == "The last-used fixture is archived, so Backstage is using Expo.")
    }

    @Test("Fixture load failure and missing Expo fail fixture actions closed")
    func unavailableFailsClosed() {
        var coordinator = FixtureSelectionCoordinator(lastUsedFixtureID: "fixture-re")
        coordinator.restore(from: [FixtureNode(id: "fixture-re", name: "RE", state: "archived")])

        #expect(coordinator.selectedFixtureID == nil)
        #expect(coordinator.fixtureScopedActionsAllowed == false)
        #expect(coordinator.chooserDisabled)
        guard case let .unavailable(reason) = coordinator.availability else {
            Issue.record("Expected an unavailable fixture state")
            return
        }
        #expect(reason.contains("Expo is missing"))

        coordinator.markUnavailable("Fixtures could not load.")
        #expect(coordinator.availability == .unavailable("Fixtures could not load."))
        #expect(coordinator.selectedFixtureID == nil)
        #expect(coordinator.fixtureScopedActionsAllowed == false)
    }

    @Test("PBE Owner freezes the exact fixture until close or expiry")
    func ownerSessionFreezeAndUnfreeze() throws {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        var coordinator = FixtureSelectionCoordinator(
            lastUsedFixtureID: "fixture-re-la-concha-pool"
        )
        coordinator.restore(from: fixtureTree, now: now)

        let session = try coordinator.beginPBEOwnerSession(
            expiresAt: now.addingTimeInterval(300),
            now: now
        )
        #expect(session.fixtureID == "fixture-re-la-concha-pool")
        #expect(session.fixtureBreadcrumb == "RE › La Concha › Commons › Pool")
        #expect(coordinator.chooserDisabled)
        #expect(throws: FixtureSelectionError.self) {
            try coordinator.selectFixture("fixture-expo", now: now.addingTimeInterval(1))
        }
        #expect(coordinator.selectedFixtureID == session.fixtureID)

        let didExpire = coordinator.expireOwnerSessionIfNeeded(
            at: now.addingTimeInterval(301)
        )
        #expect(didExpire)
        try coordinator.selectFixture("fixture-expo", now: now.addingTimeInterval(301))
        #expect(coordinator.selectedFixtureID == "fixture-expo")
        #expect(coordinator.ownerSession == nil)

        _ = try coordinator.beginPBEOwnerSession(
            expiresAt: now.addingTimeInterval(600),
            now: now.addingTimeInterval(302)
        )
        coordinator.closePBEOwnerSession()
        #expect(coordinator.ownerSession == nil)
        #expect(coordinator.chooserDisabled == false)
    }

    @Test("Changing selection only changes coordinator preference state")
    func selectionDoesNotMutateFixtureTree() throws {
        let originalTree = fixtureTree
        var coordinator = FixtureSelectionCoordinator(lastUsedFixtureID: "fixture-expo")
        coordinator.restore(from: originalTree)

        try coordinator.selectFixture("fixture-re-la-concha-pool")

        #expect(coordinator.selectedFixtureID == "fixture-re-la-concha-pool")
        #expect(coordinator.preferredFixtureID == "fixture-re-la-concha-pool")
        #expect(fixtureTree == originalTree)
    }

    @Test("Cancelled fixture reload restores the prior explicit selection")
    func cancelledReloadPreservesSelection() {
        var coordinator = FixtureSelectionCoordinator(
            lastUsedFixtureID: "fixture-re-la-concha-pool"
        )
        coordinator.restore(from: fixtureTree)

        coordinator.beginLoading()
        #expect(coordinator.availability == .loading)
        #expect(coordinator.selectedFixtureID == "fixture-re-la-concha-pool")
        #expect(coordinator.fixtureScopedActionsAllowed == false)

        coordinator.cancelLoading()
        #expect(coordinator.availability == .ready)
        #expect(coordinator.selectedFixtureID == "fixture-re-la-concha-pool")
        #expect(coordinator.selectedFixtureBreadcrumb == "RE › La Concha › Commons › Pool")
        #expect(coordinator.fixtureScopedActionsAllowed)
        #expect(coordinator.notice?.contains("previous current fixture") == true)
    }

    private var fixtureTree: [FixtureNode] {
        [
            FixtureNode(id: "fixture-expo", name: "Expo"),
            FixtureNode(
                id: "fixture-re",
                name: "RE",
                children: [
                    FixtureNode(
                        id: "fixture-re-la-concha",
                        name: "La Concha",
                        children: [
                            FixtureNode(
                                id: "fixture-re-la-concha-commons",
                                name: "Commons",
                                children: [
                                    FixtureNode(
                                        id: "fixture-re-la-concha-pool",
                                        name: "Pool"
                                    ),
                                ]
                            ),
                        ]
                    ),
                ]
            ),
            FixtureNode(id: "fixture-archive", name: "Archive", state: "archived"),
        ]
    }
}
