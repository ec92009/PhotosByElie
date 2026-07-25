import Foundation
import OwnerCore

@MainActor
final class BackstageViewModel: ObservableObject {
    enum Section: String, CaseIterable, Identifiable {
        case overview = "Overview"
        case activity = "Activity"
        case fixtures = "Fixtures"
        case access = "People & Access"
        case culling = "Culling"
        case metadata = "Metadata"
        case wasteBasket = "Waste Basket"
        case uploads = "Uploads"
        case delivery = "Delivery"
        case publication = "Publication"
        var id: String { rawValue }
    }

    @Published var selection: Section? = .overview
    @Published var actions: [OwnerAction] = []
    @Published var status = "Not connected"
    @Published var isRefreshing = false
    @Published var photoAccess: PhotoLibraryAccess
    @Published var libraryItems: [PhotoLibraryItem] = []
    @Published var selectedPhotoIDs: Set<String> = []
    @Published var photoPreview: PhotoPreview?
    @Published var photoStatus = "Photo library not loaded."
    @Published var isLoadingPhotos = false
    @Published var fixtureID = ""
    @Published var metadataReport: MetadataGiveBackReport?
    @Published var metadataStatus = "Choose a fixture, then run the read-only preview."
    @Published var isRunningMetadata = false
    @Published var fixtures: [FixtureNode] = []
    @Published var selectedFixtureID = ""
    @Published var fixtureName = ""
    @Published var fixtureTemplate = ""
    @Published var fixtureSearch = ""
    @Published var fixtureAssets: [FixtureAsset] = []
    @Published var selectedFixtureAssetIDs: Set<String> = []
    @Published var fixtureStatus = "Load the fixture tree to begin."
    @Published var isRunningFixture = false
    @Published var fixturePool: FixturePool?
    @Published var fixturePlacements: [FixturePlacement] = []
    @Published var placementTargetFixtureIDs: Set<String> = []
    @Published var accessState = AccessControlState()
    @Published var selectedPersonID = ""
    @Published var personEmail = ""
    @Published var personName = ""
    @Published var personGroupIDs: Set<String> = []
    @Published var groupID = ""
    @Published var groupName = ""
    @Published var groupKind = "event"
    @Published var accessStatus = "Load people and groups to begin."
    @Published var isRunningAccess = false
    @Published var cullingPickAction: SidecarPickAction = .pick
    @Published var cullingRating = 0
    @Published var cullingStatus = "Select indexed Photos and apply a culling decision."
    @Published var metadataAssetID = ""
    @Published var metadataTitle = ""
    @Published var metadataCaption = ""
    @Published var metadataKeywords = ""
    @Published var metadataBlacklist = ""
    @Published var metadataReviewStatus = "Metadata changes use audited Max actions."
    @Published var metadataProposals: [MetadataProposal] = []
    @Published var metadataProposalStatus = "Load the local AI proposal queue to review it."
    @Published var lifecycleItems: [LifecycleItem] = []
    @Published var selectedLifecycleIDs: Set<String> = []
    @Published var lifecycleStatus = "Load the private lifecycle ledger to review recoverable rejects."
    @Published var isRunningLifecycle = false

    let api: OwnerAPIClient
    let photoLibrary: any PhotoLibraryServing
    let metadataService: MetadataGiveBackService
    let fixtureService: FixtureWorkflowService
    let accessService: AccessControlService
    let decisionService: SidecarDecisionService
    let metadataReviewService: MetadataReviewService
    let lifecycleService: LifecycleService

    init(
        api: OwnerAPIClient = OwnerAPIClient(),
        photoLibrary: any PhotoLibraryServing = PhotoKitLibraryService()
    ) {
        self.api = api
        self.photoLibrary = photoLibrary
        self.photoAccess = photoLibrary.authorization()
        let runner = OwnerActionRunner(api: api)
        self.metadataService = MetadataGiveBackService(runner: runner)
        self.fixtureService = FixtureWorkflowService(runner: runner)
        self.accessService = AccessControlService(api: api)
        self.decisionService = SidecarDecisionService(api: api)
        self.metadataReviewService = MetadataReviewService(runner: runner)
        self.lifecycleService = LifecycleService(runner: runner)
    }

    func refreshActions() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            actions = try await api.listActions(limit: 50).actions
            status = "Connected"
        } catch {
            status = String(describing: error)
        }
    }

    func authorizeAndLoadPhotos() async {
        if photoLibrary.authorization() == .notDetermined {
            photoAccess = await photoLibrary.requestAuthorization()
        } else {
            photoAccess = photoLibrary.authorization()
        }
        await refreshPhotos()
    }

    func refreshPhotos() async {
        photoAccess = photoLibrary.authorization()
        guard [.authorized, .limited].contains(photoAccess) else {
            photoStatus = "Photos access is required for indexing, preview, and export."
            return
        }
        isLoadingPhotos = true
        defer { isLoadingPhotos = false }
        libraryItems = await photoLibrary.fetch(limit: 2_000)
        selectedPhotoIDs.formIntersection(Set(libraryItems.map(\.id)))
        photoStatus = "\(libraryItems.count.formatted()) recent Photos items indexed."
    }

    func loadPreview() async {
        guard let id = selectedPhotoIDs.first else {
            photoStatus = "Select one item to preview."
            return
        }
        do {
            photoPreview = try await photoLibrary.preview(localIdentifier: id, maxPixelSize: 1_600)
            photoStatus = "Preview prepared from Photos without exporting the original."
        } catch {
            photoStatus = String(describing: error)
        }
    }

    func exportSelected(to directory: URL) async {
        let ids = libraryItems.map(\.id).filter(selectedPhotoIDs.contains)
        guard !ids.isEmpty else {
            photoStatus = "Select one or more items to export."
            return
        }
        isLoadingPhotos = true
        defer { isLoadingPhotos = false }
        var receipts: [PhotoExportReceipt] = []
        var failures: [String] = []
        for id in ids {
            do {
                receipts.append(try await photoLibrary.exportOriginal(localIdentifier: id, to: directory))
            } catch {
                failures.append("\(id): \(error)")
            }
        }
        photoStatus = "\(receipts.count) originals exported with SHA-256 receipts"
            + (failures.isEmpty ? "." : "; \(failures.count) failed.")
    }

    func planMetadataGiveBack() async {
        await runMetadata(commit: false)
    }

    func commitMetadataGiveBack() async {
        await runMetadata(commit: true)
    }

    func retryMetadataFailures() async {
        guard let metadataReport else { return }
        isRunningMetadata = true
        defer { isRunningMetadata = false }
        do {
            let retried = try await metadataService.retryFailures(
                from: metadataReport,
                fixtureID: fixtureID
            )
            self.metadataReport = retried
            metadataStatus = reportStatus(retried)
        } catch {
            metadataStatus = String(describing: error)
        }
    }

    var flatFixtures: [FixtureNode] {
        fixtures.flatMap(\.flattened)
    }

    func loadFixtures() async {
        await fixtureOperation {
            fixtures = try await fixtureService.tree()
            fixtureStatus = "\(flatFixtures.count) fixture nodes loaded."
        }
    }

    func createFixture() async {
        let name = fixtureName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            fixtureStatus = "Enter a fixture name."
            return
        }
        await fixtureOperation {
            fixtures = try await fixtureService.create(
                name: name,
                parentID: selectedFixtureID.isEmpty ? nil : selectedFixtureID,
                templateKey: fixtureTemplate
            )
            fixtureName = ""
            fixtureStatus = "Fixture created through an audited Max action."
        }
    }

    func renameFixture() async {
        guard !selectedFixtureID.isEmpty, !fixtureName.isEmpty else { return }
        await fixtureOperation {
            fixtures = try await fixtureService.rename(id: selectedFixtureID, name: fixtureName)
            fixtureStatus = "Fixture renamed; its stable ID and relationships were preserved."
        }
    }

    func toggleFixtureArchive() async {
        guard let fixture = flatFixtures.first(where: { $0.id == selectedFixtureID }) else { return }
        await fixtureOperation {
            fixtures = try await fixtureService.setArchived(id: fixture.id, archived: !fixture.isArchived)
            fixtureStatus = fixture.isArchived ? "Fixture reopened." : "Fixture archived without deleting attached state."
        }
    }

    func searchFixtureAssets() async {
        guard !selectedFixtureID.isEmpty else {
            fixtureStatus = "Choose a fixture before searching."
            return
        }
        await fixtureOperation {
            fixtureAssets = try await fixtureService.search(
                fixtureID: selectedFixtureID,
                query: fixtureSearch
            )
            selectedFixtureAssetIDs = []
            fixtureStatus = "\(fixtureAssets.count) candidates loaded. Search was read-only."
        }
    }

    func snapshotFixtureAssets() async {
        let ordered = fixtureAssets.map(\.id).filter(selectedFixtureAssetIDs.contains)
        guard !selectedFixtureID.isEmpty, !ordered.isEmpty else { return }
        await fixtureOperation {
            fixturePool = try await fixtureService.snapshot(
                fixtureID: selectedFixtureID,
                assetIDs: ordered,
                name: fixtureName.isEmpty ? "Native selection" : fixtureName
            )
            fixtureStatus = "Stable culling snapshot created; source assets were not copied."
        }
    }

    func placeFixtureAssets() async {
        let assetIDs = fixtureAssets.map(\.id).filter(selectedFixtureAssetIDs.contains)
        let targets = Array(placementTargetFixtureIDs).sorted()
        guard !assetIDs.isEmpty, !targets.isEmpty else {
            fixtureStatus = "Select assets and at least one destination fixture."
            return
        }
        await fixtureOperation {
            fixturePlacements = try await fixtureService.place(
                assetIDs: assetIDs,
                fixtureIDs: targets,
                poolID: fixturePool?.id ?? ""
            )
            fixtureStatus = "Placed \(assetIDs.count) assets in \(targets.count) fixtures without copying source files."
        }
    }

    func loadFixturePlacements() async {
        let assetIDs = fixtureAssets.map(\.id).filter(selectedFixtureAssetIDs.contains)
        guard !assetIDs.isEmpty else {
            fixtureStatus = "Select assets before reviewing placements."
            return
        }
        await fixtureOperation {
            fixturePlacements = try await fixtureService.placements(assetIDs: assetIDs)
            fixtureStatus = "\(fixturePlacements.count) reversible placement relationships loaded."
        }
    }

    func movePlacement(_ id: String, to fixtureID: String) async {
        await fixtureOperation {
            try await fixtureService.movePlacement(id: id, to: fixtureID)
            fixturePlacements = try await fixtureService.placements(
                assetIDs: fixtureAssets.map(\.id).filter(selectedFixtureAssetIDs.contains)
            )
            fixtureStatus = "Placement moved; source assets and history were preserved."
        }
    }

    func togglePlacement(_ placement: FixturePlacement) async {
        await fixtureOperation {
            if placement.isActive {
                try await fixtureService.removePlacement(id: placement.id)
            } else {
                try await fixtureService.restorePlacement(id: placement.id)
            }
            fixturePlacements = try await fixtureService.placements(
                assetIDs: fixtureAssets.map(\.id).filter(selectedFixtureAssetIDs.contains)
            )
            fixtureStatus = placement.isActive ? "Placement removed reversibly." : "Placement restored."
        }
    }

    func loadAccess() async {
        isRunningAccess = true
        defer { isRunningAccess = false }
        do {
            accessState = try await accessService.load()
            accessStatus = "\(accessState.allPeople.count) people and \(accessState.allGroups.count) groups loaded."
        } catch {
            accessStatus = String(describing: error)
        }
    }

    func selectPerson(_ id: String) {
        selectedPersonID = id
        guard let person = accessState.allPeople.first(where: { $0.id == id }) else { return }
        personEmail = person.email
        personName = person.displayName ?? ""
        personGroupIDs = Set(person.groupIds ?? [])
    }

    func newPerson() {
        selectedPersonID = ""
        personEmail = ""
        personName = ""
        personGroupIDs = []
    }

    func savePerson() async {
        let email = personEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard email.contains("@") else {
            accessStatus = "Enter a valid email address."
            return
        }
        await accessOperation {
            _ = try await accessService.save(person: AccessPerson(
                email: email,
                displayName: personName,
                groupIds: Array(personGroupIDs).sorted()
            ))
            accessState = try await accessService.load()
            selectPerson(email)
            accessStatus = "Person and inherited group access saved."
        }
    }

    func disablePerson() async {
        guard !selectedPersonID.isEmpty else { return }
        await accessOperation {
            _ = try await accessService.disable(personID: selectedPersonID)
            accessState = try await accessService.load()
            accessStatus = "Person disabled; audit history was preserved."
        }
    }

    func saveGroup() async {
        let id = groupID.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = groupName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, !name.isEmpty else {
            accessStatus = "Enter a stable group ID and label."
            return
        }
        await accessOperation {
            _ = try await accessService.save(group: AccessGroup(
                id: id,
                label: name,
                kind: groupKind,
                galleryKind: groupKind == "real_estate" ? "real_estate" : "event",
                fixture: groupKind == "fixture"
            ))
            accessState = try await accessService.load()
            accessStatus = "Group and policy defaults saved."
        }
    }

    func archiveGroup(_ id: String) async {
        await accessOperation {
            _ = try await accessService.archive(groupID: id)
            accessState = try await accessService.load()
            accessStatus = "Group archived; memberships and audit history remain recoverable."
        }
    }

    func applyPickDecision() async {
        let ids = libraryItems.map(\.id).filter(selectedPhotoIDs.contains)
        guard !ids.isEmpty else {
            cullingStatus = "Select one or more Photos items."
            return
        }
        do {
            let decisions = ids.map { SidecarDecision.pick($0, action: cullingPickAction) }
            _ = try await decisionService.apply(
                decisions,
                idempotencyKey: "native-culling-\(UUID().uuidString)"
            )
            cullingStatus = "\(ids.count) \(cullingPickAction.label.lowercased()) decision\(ids.count == 1 ? "" : "s") recorded in the cloud ledger."
        } catch {
            cullingStatus = String(describing: error)
        }
    }

    func applyRating() async {
        let ids = libraryItems.map(\.id).filter(selectedPhotoIDs.contains)
        guard !ids.isEmpty else {
            cullingStatus = "Select one or more Photos items."
            return
        }
        do {
            _ = try await decisionService.apply(
                ids.map { SidecarDecision.rating($0, value: cullingRating) },
                idempotencyKey: "native-rating-\(UUID().uuidString)"
            )
            cullingStatus = "\(ids.count) rating\(ids.count == 1 ? "" : "s") set to \(cullingRating)."
        } catch {
            cullingStatus = String(describing: error)
        }
    }

    func useSelectedPhotoForMetadata() {
        metadataAssetID = selectedPhotoIDs.first ?? metadataAssetID
    }

    func updatePhotoMetadata() async {
        let id = metadataAssetID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, !metadataTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            metadataReviewStatus = "Choose one asset and enter a non-empty title."
            return
        }
        do {
            let action = try await metadataReviewService.update(
                assetID: id,
                title: metadataTitle,
                caption: metadataCaption,
                keywords: metadataKeywords.components(separatedBy: ",")
            )
            metadataReviewStatus = "Title, caption, and keywords saved by action \(action.id). Publication remains separate."
        } catch {
            metadataReviewStatus = String(describing: error)
        }
    }

    func queueMetadataReview() async {
        let ids = selectedPhotoIDs.isEmpty
            ? [metadataAssetID].filter { !$0.isEmpty }
            : libraryItems.map(\.id).filter(selectedPhotoIDs.contains)
        do {
            let action = try await metadataReviewService.queueReview(assetIDs: ids)
            metadataReviewStatus = "\(ids.count) item\(ids.count == 1 ? "" : "s") queued for review by action \(action.id)."
        } catch {
            metadataReviewStatus = String(describing: error)
        }
    }

    func saveMetadataBlacklist() async {
        do {
            let terms = metadataBlacklist.components(separatedBy: ",")
            let action = try await metadataReviewService.replaceBlacklist(terms)
            metadataReviewStatus = "Keyword blacklist replaced through action \(action.id)."
        } catch {
            metadataReviewStatus = String(describing: error)
        }
    }

    func loadMetadataProposals() async {
        do {
            let queue = try await metadataReviewService.proposals()
            metadataProposals = queue.photos
            metadataProposalStatus = "\(queue.photos.count) pending proposal\(queue.photos.count == 1 ? "" : "s") loaded from Owner.sqlite."
        } catch {
            metadataProposalStatus = String(describing: error)
        }
    }

    func decideProposal(
        _ proposal: MetadataProposal,
        disposition: MetadataProposalDisposition
    ) async {
        do {
            let action = try await metadataReviewService.decide(
                proposal,
                disposition: disposition,
                comment: disposition == .reject ? "Rejected in native Backstage" : ""
            )
            metadataProposals.removeAll { $0.id == proposal.id }
            metadataProposalStatus = "\(disposition.rawValue.capitalized) saved by audited action \(action.id)."
        } catch {
            metadataProposalStatus = String(describing: error)
        }
    }

    func loadLifecycle() async {
        isRunningLifecycle = true
        defer { isRunningLifecycle = false }
        do {
            let ledger = try await lifecycleService.ledger()
            lifecycleItems = ledger.items
            selectedLifecycleIDs.formIntersection(Set(ledger.items.map(\.id)))
            lifecycleStatus = "\(ledger.hiddenCount) recoverable and \(ledger.discardedCount) permanently discarded item\(ledger.items.count == 1 ? "" : "s")."
        } catch {
            lifecycleStatus = String(describing: error)
        }
    }

    func restoreLifecycleSelection() async {
        let ids = lifecycleItems
            .filter { selectedLifecycleIDs.contains($0.id) && $0.state == "hidden" }
            .map(\.id)
        guard !ids.isEmpty else {
            lifecycleStatus = "Select one or more recoverable items."
            return
        }
        isRunningLifecycle = true
        defer { isRunningLifecycle = false }
        do {
            let action = try await lifecycleService.restore(mediaIDs: ids)
            lifecycleStatus = "Restored \(ids.count) item\(ids.count == 1 ? "" : "s") with saved private titles through action \(action.id)."
            await loadLifecycle()
        } catch {
            lifecycleStatus = String(describing: error)
        }
    }

    func discardLifecycleItem(_ id: String) async {
        isRunningLifecycle = true
        defer { isRunningLifecycle = false }
        do {
            let action = try await lifecycleService.discard(mediaID: id)
            lifecycleStatus = "Permanently discarded one item through action \(action.id)."
            await loadLifecycle()
        } catch {
            lifecycleStatus = String(describing: error)
        }
    }

    private func fixtureOperation(_ operation: () async throws -> Void) async {
        isRunningFixture = true
        defer { isRunningFixture = false }
        do {
            try await operation()
        } catch {
            fixtureStatus = String(describing: error)
        }
    }

    private func accessOperation(_ operation: () async throws -> Void) async {
        isRunningAccess = true
        defer { isRunningAccess = false }
        do {
            try await operation()
        } catch {
            accessStatus = String(describing: error)
        }
    }

    private func runMetadata(commit: Bool) async {
        let fixture = fixtureID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !fixture.isEmpty else {
            metadataStatus = "A fixture ID is required."
            return
        }
        isRunningMetadata = true
        defer { isRunningMetadata = false }
        do {
            let report = try await (commit
                ? metadataService.commit(fixtureID: fixture)
                : metadataService.plan(fixtureID: fixture))
            metadataReport = report
            metadataStatus = reportStatus(report)
        } catch {
            metadataStatus = String(describing: error)
        }
    }

    private func reportStatus(_ report: MetadataGiveBackReport) -> String {
        if report.isDryRun {
            return "\(report.readyCount) ready; \(report.blocked.count) blocked. Photos is unchanged."
        }
        return "\(report.verifiedCount) written and re-read as verified; \(report.failed.count) failed; \(report.blocked.count) blocked."
    }
}
