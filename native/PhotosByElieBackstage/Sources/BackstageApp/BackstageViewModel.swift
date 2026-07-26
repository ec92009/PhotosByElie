import AppKit
import Foundation
import OwnerCore

struct CullingHistoryEntry: Identifiable, Sendable {
    var id = UUID()
    var label: String
    var changes: [SidecarDecisionChange] = []
    var fixtureChanges: [FixtureAssetState] = []
    var selectedIDs: Set<String>
}

enum MetadataHistoryKind: Sendable {
    case edit(MetadataEditChange)
    case blacklist(MetadataBlacklistChange)
}

struct MetadataHistoryEntry: Identifiable, Sendable {
    var id = UUID()
    var label: String
    var kind: MetadataHistoryKind
}

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
    @Published var authentication = OwnerAuthenticationSnapshot(phase: .needsEnrollment)
    @Published var enrollmentCode = ""
    @Published var authenticationStatus = "Checking this Mac's Keychain session…"
    @Published var isAuthenticating = false
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
    @Published var fixturePools: [FixturePoolSummary] = []
    @Published var selectedFixturePoolID = ""
    @Published var fixtureSnapshotStatus = ""
    @Published var isReloadingFixturePools = false
    @Published var isOpeningFixturePool = false
    @Published var cullingPool: FixturePool?
    @Published var cullingFixtureID = ""
    @Published var fixtureCullingWindow: FixtureCullingWindow?
    @Published var cullingView: FixtureCullingView = .undecided
    @Published var isLoadingFixtureCulling = false
    @Published var cullingGridDensity = 5
    @Published var cullingUsesFill = true
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
    @Published var cullingColor: SidecarColor = .none
    @Published var cullingSelection = OwnerSelectionModel<String>()
    @Published var cullingStates: [String: SidecarDecisionState] = [:]
    @Published var cullingHistory: [CullingHistoryEntry] = []
    @Published var cullingStatus = "Select indexed Photos and apply a culling decision."
    @Published var cullingSearch = ""
    @Published var cullingMediaFilter: CullingMediaFilter = .all
    @Published var cullingPickFilter: CullingPickFilter = .all
    @Published var cullingRatingFilter = -1
    @Published var cullingColorFilter: CullingColorFilter = .all
    @Published var cullingWindowOffset = 0
    @Published var cullingWindowLimit = 200
    @Published var cullingThumbnails: [String: NSImage] = [:]
    @Published var isLoadingPreview = false
    @Published var isLoadingCullingDecisions = false
    @Published var cullingDecisionProgress = 0
    @Published var cullingDecisionTotal = 0
    @Published var isApplyingCullingDecision = false
    @Published var cullingCancellationRequested = false
    @Published var metadataAssetID = ""
    @Published var metadataTitle = ""
    @Published var metadataCaption = ""
    @Published var metadataKeywords = ""
    @Published var metadataBlacklist = ""
    @Published var metadataReviewStatus = "Metadata changes use audited Max actions."
    @Published var metadataHistory: [MetadataHistoryEntry] = []
    @Published var metadataProposals: [MetadataProposal] = []
    @Published var metadataProposalStatus = "Load the local AI proposal queue to review it."
    @Published var lifecycleItems: [LifecycleItem] = []
    @Published var selectedLifecycleIDs: Set<String> = []
    @Published var lifecycleStatus = "Load the private lifecycle ledger to review recoverable rejects."
    @Published var isRunningLifecycle = false
    @Published var deliveryPlan: FixtureDeliveryPlan?
    @Published var selectedDeliveryIDs: Set<String> = []
    @Published var deliveryStatus = "Choose a fixture and load its delivery plan."
    @Published var deliveryCompleted = 0
    @Published var deliveryTotal = 0
    @Published var deliveryFailedIDs: [String] = []
    @Published var isRunningDelivery = false
    @Published var uploadHealth: FixtureUploadHealth?
    @Published var uploadRunID = ""
    @Published var uploadAdoptionPlan: FixtureUploadRunAdoptionPlan?
    @Published var uploadRecoveryStatus = "Existing verified upload runs can be adopted explicitly."
    @Published var deliverables: [FixtureDeliverable] = []
    @Published var deliverableKind = "pdf"
    @Published var deliverableShareLink = ""
    @Published var publicationPlan: FixturePublicationPlan?
    @Published var publicationStatus = "Publication is a separate, explicit public-fixture gate."
    @Published var photosBridgeHealth = PhotosBridgeHealth(
        installed: false,
        headless: false,
        bundleIdentifier: "",
        version: "",
        photoAccess: "checking",
        message: "Checking the signed Photos helper…"
    )

    let api: OwnerAPIClient
    let authenticationService: OwnerAuthenticationService
    let photoLibrary: any PhotoLibraryServing
    let metadataService: MetadataGiveBackService
    let fixtureService: FixtureWorkflowService
    let accessService: AccessControlService
    let decisionService: SidecarDecisionService
    let metadataReviewService: MetadataReviewService
    let lifecycleService: LifecycleService
    let deliveryService: FixtureDeliveryService
    let photosBridgeHealthService: PhotosBridgeHealthService
    private var authenticationTask: Task<OwnerAuthenticationSnapshot, Never>?

    var selectedFixturePoolSummary: FixturePoolSummary? {
        fixturePools.first(where: { $0.id == selectedFixturePoolID })
    }

    var selectedFixturePath: [FixtureNode] {
        fixtures.path(to: selectedFixtureID)
    }

    var isRunningFixtureSnapshotOperation: Bool {
        isReloadingFixturePools || isOpeningFixturePool
    }

    init(
        api: OwnerAPIClient = OwnerAPIClient(),
        photoLibrary: any PhotoLibraryServing = PhotoKitLibraryService()
    ) {
        self.api = api
        self.authenticationService = OwnerAuthenticationService(api: api)
        self.photoLibrary = photoLibrary
        self.photoAccess = photoLibrary.authorization()
        let runner = OwnerActionRunner(api: api)
        self.metadataService = MetadataGiveBackService(runner: runner)
        self.fixtureService = FixtureWorkflowService(runner: runner)
        self.accessService = AccessControlService(api: api)
        self.decisionService = SidecarDecisionService(api: api)
        self.metadataReviewService = MetadataReviewService(runner: runner)
        self.lifecycleService = LifecycleService(runner: runner)
        self.deliveryService = FixtureDeliveryService(runner: runner)
        self.photosBridgeHealthService = PhotosBridgeHealthService()
    }

    func bootstrapAuthentication() async {
        photosBridgeHealth = await photosBridgeHealthService.probe()
        isAuthenticating = true
        defer { isAuthenticating = false }
        authentication = await ensuredAuthentication()
        switch authentication.phase {
        case .authenticated:
            authenticationStatus = "Authenticated with this Mac's revocable device credential."
            await refreshActions()
        case .needsEnrollment:
            authenticationStatus = "Enroll Backstage from a signed-in Owner browser session."
            status = "Enrollment required"
        case .signedOut:
            authenticationStatus = "Signed out on this Mac."
            status = "Signed out"
        }
    }

    func refreshPhotosBridgeHealth() async {
        photosBridgeHealth = await photosBridgeHealthService.probe()
    }

    func enroll() async {
        let code = enrollmentCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            authenticationStatus = "Paste the one-time enrollment code from Owner."
            return
        }
        isAuthenticating = true
        defer { isAuthenticating = false }
        do {
            authentication = try await authenticationService.enroll(code: code)
            enrollmentCode = ""
            authenticationStatus = "Enrollment verified and stored in this Mac's Keychain."
            await refreshActions()
        } catch {
            authenticationStatus = "Enrollment failed: \(error)"
            status = "Enrollment failed"
        }
    }

    func signOut() async {
        isAuthenticating = true
        defer { isAuthenticating = false }
        do {
            authentication = try await authenticationService.signOut()
            actions = []
            authenticationStatus = "Signed out; local tokens were removed from Keychain."
            status = "Signed out"
        } catch {
            authenticationStatus = "Sign-out failed: \(error)"
        }
    }

    func refreshActions() async {
        isRefreshing = true
        defer { isRefreshing = false }
        guard await prepareAuthenticatedOperation() else { return }
        do {
            actions = try await api.listActions(limit: 50).actions
            authentication = await authenticationService.currentSnapshot()
            status = "Connected"
        } catch {
            await presentAuthenticationFailureIfNeeded(error)
            if status != "Sign in again" {
                status = userFacingMessage(for: error)
            }
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
        replaceCullingItems()
        photoStatus = "\(libraryItems.count.formatted()) recent Photos items indexed."
    }

    func loadPreview() async {
        guard let id = focusedCullingAssetID else {
            photoStatus = "Select one item to preview."
            return
        }
        isLoadingPreview = true
        photoStatus = "Loading preview…"
        defer { isLoadingPreview = false }
        do {
            let preview = try await photoLibrary.preview(
                localIdentifier: photoLibraryIdentifier(for: id),
                maxPixelSize: 1_600
            )
            guard focusedCullingAssetID == id else { return }
            photoPreview = preview
            photoStatus = "Preview prepared from Photos without exporting the original."
        } catch {
            photoStatus = String(describing: error)
        }
    }

    func loadThumbnail(for assetID: String) async {
        guard cullingThumbnails[assetID] == nil else { return }
        do {
            let preview = try await photoLibrary.preview(
                localIdentifier: photoLibraryIdentifier(for: assetID),
                maxPixelSize: 180
            )
            guard let image = NSImage(data: preview.jpegData) else { return }
            if cullingThumbnails.count >= 300,
               let oldest = cullingThumbnails.keys.first {
                cullingThumbnails.removeValue(forKey: oldest)
            }
            cullingThumbnails[assetID] = image
        } catch {
            // A missing thumbnail must not block culling or the larger preview.
        }
    }

    func exportSelected(to directory: URL) async {
        let ids = selectedCullingAssetIDs
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
                receipts.append(try await photoLibrary.exportOriginal(
                    localIdentifier: photoLibraryIdentifier(for: id),
                    to: directory
                ))
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

    var cullingAssets: [FixtureAsset] {
        if let fixtureCullingWindow, cullingPool == nil {
            return fixtureCullingWindow.items
        }
        if let cullingPool {
            return cullingPool.assets.map {
                FixtureAsset(
                    id: $0.id,
                    title: $0.title,
                    filename: $0.filename,
                    mediaType: $0.mediaType
                )
            }
        }
        return libraryItems.map {
            FixtureAsset(id: $0.id, title: "", filename: $0.filename, mediaType: $0.mediaType)
        }
    }

    var cullingQuery: CullingQuery {
        CullingQuery(
            search: cullingSearch,
            media: cullingMediaFilter,
            pick: cullingPickFilter,
            rating: cullingRatingFilter < 0 ? nil : cullingRatingFilter,
            color: cullingColorFilter
        )
    }

    var cullingWorkspace: CullingWorkspaceResult {
        if let window = fixtureCullingWindow, cullingPool == nil {
            return CullingWorkspaceResult(
                items: window.items.map { asset in
                    CullingCandidate(
                        id: asset.id,
                        title: asset.title,
                        filename: asset.filename,
                        mediaType: asset.mediaType,
                        decision: cullingStates[asset.id]
                    )
                },
                summary: CullingSummary(
                    total: window.summary.universe,
                    filtered: window.summary.filtered,
                    undecided: window.summary.undecided,
                    picked: window.summary.picked,
                    rejected: window.summary.hidden,
                    photos: window.items.count(where: { $0.mediaType != "video" }),
                    videos: window.items.count(where: { $0.mediaType == "video" })
                ),
                offset: window.offset,
                limit: window.limit
            )
        }
        return CullingWorkspace.evaluate(
            cullingAssets.map { asset in
                CullingCandidate(
                    id: asset.id,
                    title: asset.title,
                    filename: asset.filename,
                    mediaType: asset.mediaType,
                    decision: cullingStates[asset.id]
                )
            },
            query: cullingQuery,
            offset: cullingWindowOffset,
            limit: cullingWindowLimit
        )
    }

    var visibleCullingAssets: [FixtureAsset] {
        if fixtureCullingWindow != nil, cullingPool == nil {
            return cullingAssets
        }
        let assets = Dictionary(uniqueKeysWithValues: cullingAssets.map { ($0.id, $0) })
        return cullingWorkspace.items.compactMap { assets[$0.id] }
    }

    var selectedCullingAssetIDs: [String] {
        visibleCullingAssets.map(\.id).filter(cullingSelection.selectedIDs.contains)
    }

    var focusedCullingAssetID: String? {
        cullingSelection.focusedID ?? selectedCullingAssetIDs.first
    }

    func replaceCullingItems() {
        cullingSelection.replaceItems(visibleCullingAssets.map(\.id))
        selectedPhotoIDs = cullingSelection.selectedIDs
    }

    func applyCullingFilters() {
        cullingWindowOffset = 0
        if !cullingFixtureID.isEmpty, cullingPool == nil {
            Task { await loadFixtureCullingWindow() }
            return
        }
        replaceCullingItems()
        photoPreview = nil
        cullingStatus = "\(cullingWorkspace.summary.filtered.formatted()) of \(cullingWorkspace.summary.total.formatted()) items match."
    }

    func clearCullingFilters() {
        cullingSearch = ""
        cullingMediaFilter = .all
        cullingPickFilter = .all
        cullingRatingFilter = -1
        cullingColorFilter = .all
        if cullingView == .undecided {
            applyCullingFilters()
        } else {
            cullingView = .undecided
        }
    }

    func showPickedReview() {
        if !cullingFixtureID.isEmpty, cullingPool == nil {
            if cullingView == .picked {
                applyCullingFilters()
            } else {
                cullingView = .picked
            }
            return
        }
        cullingPickFilter = .picked
        applyCullingFilters()
        cullingStatus = "Reviewing \(cullingWorkspace.summary.filtered.formatted()) picked items in the current scope."
    }

    func moveCullingWindow(forward: Bool) {
        let result = cullingWorkspace
        if forward, result.hasNext {
            cullingWindowOffset += result.limit
        } else if !forward, result.hasPrevious {
            cullingWindowOffset = max(0, cullingWindowOffset - result.limit)
        }
        replaceCullingItems()
        photoPreview = nil
        if !cullingFixtureID.isEmpty, cullingPool == nil {
            Task { await loadFixtureCullingWindow() }
        }
    }

    func clickCullingAsset(_ id: String, modifiers: NSEvent.ModifierFlags) {
        cullingSelection.click(
            id,
            extending: modifiers.contains(.shift),
            toggling: modifiers.contains(.command)
        )
        selectedPhotoIDs = cullingSelection.selectedIDs
    }

    func moveCullingSelection(_ direction: OwnerSelectionDirection, extending: Bool) {
        cullingSelection.move(direction, extending: extending)
        selectedPhotoIDs = cullingSelection.selectedIDs
    }

    func moveCullingSelection(by delta: Int, extending: Bool) {
        cullingSelection.move(by: delta, extending: extending)
        selectedPhotoIDs = cullingSelection.selectedIDs
    }

    func changeCullingGridDensity(by delta: Int) {
        cullingGridDensity = min(10, max(2, cullingGridDensity + delta))
    }

    func toggleCullingFitFill() {
        cullingUsesFill.toggle()
    }

    func selectAllCullingAssets() {
        cullingSelection.selectAll()
        selectedPhotoIDs = cullingSelection.selectedIDs
    }

    func clearCullingSelection() {
        cullingSelection.clear()
        selectedPhotoIDs = []
    }

    func selectFocusedBurst() {
        guard let focusedID = focusedCullingAssetID else {
            cullingStatus = "Focus one item before selecting its burst."
            return
        }
        let libraryByID = Dictionary(uniqueKeysWithValues: libraryItems.map { ($0.id, $0) })
        let timed = visibleCullingAssets.map { asset in
            CullingTimedItem(
                id: asset.id,
                capturedAt: libraryByID[photoLibraryIdentifier(for: asset.id)]?.creationDate
            )
        }
        let ids = CullingWorkspace.burst(containing: focusedID, in: timed)
        cullingSelection = OwnerSelectionModel(
            orderedIDs: visibleCullingAssets.map(\.id),
            selectedIDs: Set(ids),
            anchorID: ids.first,
            focusedID: focusedID
        )
        selectedPhotoIDs = Set(ids)
        cullingStatus = ids.count > 1
            ? "Selected a contiguous \(ids.count)-item burst."
            : "No neighboring frames within two seconds; selected the focused item."
    }

    func cancelCullingOperation() {
        cullingCancellationRequested = true
        cullingStatus = "Stopping after the current audited batch…"
    }

    func openFixturePoolInCulling() {
        guard let fixturePool else { return }
        cullingPool = fixturePool
        cullingWindowOffset = 0
        cullingSelection = OwnerSelectionModel(orderedIDs: fixturePool.assets.map(\.id))
        selectedPhotoIDs = []
        photoPreview = nil
        cullingThumbnails = [:]
        cullingStatus = "Fixture pool \(fixturePool.id) loaded in immutable snapshot order."
        selection = .culling
        Task { await refreshCullingDecisions() }
    }

    func showAllPhotosInCulling() {
        cullingPool = nil
        cullingWindowOffset = 0
        if cullingFixtureID.isEmpty {
            cullingFixtureID = flatFixtures.first(where: { $0.id == "fixture-expo" })?.id
                ?? flatFixtures.first(where: { $0.parentID == nil && !$0.isArchived })?.id
                ?? ""
        }
        Task { await loadFixtureCullingWindow() }
    }

    func selectCullingFixture(_ fixtureID: String) {
        cullingFixtureID = fixtureID
        cullingPool = nil
        cullingView = .undecided
        cullingWindowOffset = 0
        cullingSearch = ""
        clearCullingSelection()
        photoPreview = nil
        cullingThumbnails = [:]
        Task { await loadFixtureCullingWindow() }
    }

    func loadFixtureCullingWindow() async {
        guard !cullingFixtureID.isEmpty else {
            cullingStatus = "Choose a fixture to begin culling."
            return
        }
        isLoadingFixtureCulling = true
        cullingStatus = "Loading the \(cullingView.label.lowercased()) fixture window…"
        defer { isLoadingFixtureCulling = false }
        do {
            let mediaTypes: [String] = switch cullingMediaFilter {
            case .all: []
            case .photos: ["photo"]
            case .videos: ["video"]
            }
            let colors: [String] = switch cullingColorFilter {
            case .all: []
            case .none: ["none"]
            default: [cullingColorFilter.rawValue]
            }
            let window = try await fixtureService.cullingWindow(
                fixtureID: cullingFixtureID,
                view: cullingView,
                offset: cullingWindowOffset,
                limit: cullingWindowLimit,
                search: cullingSearch,
                mediaTypes: mediaTypes,
                ratings: cullingRatingFilter < 0 ? [] : [cullingRatingFilter],
                colors: colors
            )
            fixtureCullingWindow = window
            cullingStates = Dictionary(uniqueKeysWithValues: window.items.map { asset in
                (
                    asset.id,
                    SidecarDecisionState(
                        assetId: asset.id,
                        rating: asset.rating,
                        color: asset.color,
                        pickState: asset.placementState.rawValue,
                        metadataState: asset.editorialState,
                        title: asset.title,
                        keywords: asset.keywords
                    )
                )
            })
            replaceCullingItems()
            photoPreview = nil
            cullingStatus = "\(window.summary.filtered.formatted()) \(window.view.label.lowercased()) of \(window.summary.universe.formatted()) eligible items."
        } catch {
            cullingStatus = String(describing: error)
        }
    }

    func loadFixtures() async {
        await fixtureOperation {
            fixtures = try await fixtureService.tree()
            if cullingFixtureID.isEmpty {
                cullingFixtureID = flatFixtures.first(where: { $0.id == "fixture-expo" })?.id
                    ?? flatFixtures.first(where: { $0.parentID == nil && !$0.isArchived })?.id
                    ?? ""
            }
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
        if let fixturePool {
            selectedFixturePoolID = fixturePool.id
            await loadFixturePools()
        }
    }

    func loadFixturePools() async {
        guard !selectedFixtureID.isEmpty else {
            fixturePools = []
            selectedFixturePoolID = ""
            fixtureSnapshotStatus = ""
            return
        }
        isReloadingFixturePools = true
        fixtureSnapshotStatus = "Reloading saved snapshots…"
        defer { isReloadingFixturePools = false }
        await fixtureOperation {
            fixturePools = try await fixtureService.pools(fixtureID: selectedFixtureID)
            if !fixturePools.contains(where: { $0.id == selectedFixturePoolID }) {
                selectedFixturePoolID = fixturePools.first?.id ?? ""
            }
            fixtureStatus = fixturePools.isEmpty
                ? "No saved culling snapshots for this fixture."
                : "\(fixturePools.count) saved culling snapshot\(fixturePools.count == 1 ? "" : "s") loaded."
            fixtureSnapshotStatus = fixtureStatus
        }
        if fixtureSnapshotStatus == "Reloading saved snapshots…" {
            fixtureSnapshotStatus = fixtureStatus
        }
    }

    func openSelectedFixturePool() async {
        let poolID = selectedFixturePoolID
        guard !poolID.isEmpty else {
            fixtureStatus = "Choose a saved snapshot."
            fixtureSnapshotStatus = fixtureStatus
            return
        }
        let summary = selectedFixturePoolSummary
        isOpeningFixturePool = true
        fixtureSnapshotStatus = summary.map {
            "Opening \($0.name) (\($0.assetCount.formatted()) assets)…"
        } ?? "Opening selected snapshot…"
        defer { isOpeningFixturePool = false }
        await fixtureOperation {
            fixturePool = try await fixtureService.openPool(id: poolID)
            fixtureStatus = "Saved snapshot opened without changing its assets."
            fixtureSnapshotStatus = fixtureStatus
        }
        if fixturePool?.id == poolID {
            openFixturePoolInCulling()
        } else if fixtureSnapshotStatus.hasPrefix("Opening ") {
            fixtureSnapshotStatus = fixtureStatus
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
                poolID: selectedFixturePoolID
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
        let ids = selectedCullingAssetIDs
        guard !ids.isEmpty else {
            cullingStatus = "Select one or more Photos items."
            return
        }
        await applyCullingDecisions(
            ids.map { SidecarDecision.pick($0, action: cullingPickAction) },
            label: cullingPickAction.label
        )
    }

    func applyRating() async {
        let ids = selectedCullingAssetIDs
        guard !ids.isEmpty else {
            cullingStatus = "Select one or more Photos items."
            return
        }
        await applyCullingDecisions(
            ids.map { SidecarDecision.rating($0, value: cullingRating) },
            label: cullingRating == 0 ? "Clear rating" : "Rate \(cullingRating)"
        )
    }

    func applyColor() async {
        let ids = selectedCullingAssetIDs
        guard !ids.isEmpty else {
            cullingStatus = "Select one or more Photos items."
            return
        }
        await applyCullingDecisions(
            ids.map { SidecarDecision.color($0, value: cullingColor) },
            label: cullingColor == .none ? "Clear color" : "\(cullingColor.label) color"
        )
    }

    func applyPickShortcut(_ action: SidecarPickAction) async {
        if !cullingFixtureID.isEmpty, cullingPool == nil {
            switch action {
            case .pick:
                await applyFixturePlacement(.picked, label: "Pick")
            case .reject:
                await applyFixturePlacement(.hidden, label: "Hide")
            case .unpick:
                await applyFixturePlacement(.undecided, label: "Clear")
            }
            return
        }
        cullingPickAction = action
        await applyPickDecision()
    }

    func tombstoneCullingSelection() async {
        let ids = selectedCullingAssetIDs
        guard !ids.isEmpty else {
            cullingStatus = "Select one or more Photos items."
            return
        }
        await applyCullingDecisions(
            ids.map { .tombstone($0, reason: "Backstage culling") },
            label: "Tombstone"
        )
        if !cullingFixtureID.isEmpty, cullingPool == nil {
            await loadFixtureCullingWindow()
        }
    }

    func applyColorShortcut(_ color: SidecarColor) async {
        cullingColor = color
        await applyColor()
    }

    func applyRatingShortcut(_ rating: Int) async {
        cullingRating = min(5, max(0, rating))
        await applyRating()
    }

    func sendCullingSelection(to destination: Section) {
        let ids = selectedCullingAssetIDs
        guard !ids.isEmpty else {
            cullingStatus = "Select one or more items before continuing."
            return
        }
        selectedPhotoIDs = Set(ids)
        if destination == .metadata {
            metadataAssetID = ids.first ?? ""
            metadataReviewStatus = "\(ids.count) culling item\(ids.count == 1 ? "" : "s") handed to Metadata."
        } else if destination == .uploads {
            uploadRecoveryStatus = "\(ids.count) picked item\(ids.count == 1 ? "" : "s") retained for the fixture-scoped Uploads workflow."
        }
        selection = destination
    }

    func refreshCullingDecisions() async {
        let ids = cullingAssets.map(\.id)
        guard !ids.isEmpty else {
            cullingStates = [:]
            return
        }
        isLoadingCullingDecisions = true
        cullingCancellationRequested = false
        cullingDecisionProgress = 0
        cullingDecisionTotal = ids.count
        cullingStatus = "Loading decisions for \(ids.count.formatted()) items…"
        defer { isLoadingCullingDecisions = false }
        do {
            var states: [String: SidecarDecisionState] = [:]
            for start in stride(from: 0, to: ids.count, by: 500) {
                if cullingCancellationRequested || Task.isCancelled {
                    cullingStates = states
                    replaceCullingItems()
                    cullingStatus = "Decision reload stopped after \(cullingDecisionProgress.formatted()) of \(ids.count.formatted()) items."
                    return
                }
                let end = min(ids.count, start + 500)
                states.merge(
                    try await decisionService.queryStates(assetIDs: Array(ids[start..<end])),
                    uniquingKeysWith: { _, latest in latest }
                )
                cullingDecisionProgress = end
                cullingStatus = "Loaded decisions \(end.formatted()) / \(ids.count.formatted())…"
            }
            cullingStates = states
            replaceCullingItems()
            cullingStatus = "Loaded \(states.count) preserved decision\(states.count == 1 ? "" : "s") for this culling scope."
        } catch {
            cullingStatus = String(describing: error)
        }
    }

    func undoLastCullingDecision() async {
        guard let entry = cullingHistory.last else {
            cullingStatus = "Nothing to undo in this Backstage session."
            return
        }
        if !entry.fixtureChanges.isEmpty {
            do {
                let grouped = Dictionary(grouping: entry.fixtureChanges, by: \.beforePlacementState)
                for (state, changes) in grouped {
                    _ = try await fixtureService.applyState(
                        state,
                        assetIDs: changes.map(\.assetID),
                        fixtureID: changes.first?.fixtureID ?? cullingFixtureID,
                        reason: "Undo \(entry.label)"
                    )
                }
                cullingHistory.removeLast()
                await loadFixtureCullingWindow()
                cullingStatus = "Undid \(entry.label)."
            } catch {
                cullingStatus = "Undo failed; the history step was preserved. \(error)"
            }
            return
        }
        let decisions = entry.changes.contains(where: {
            $0.changedFamilies.contains("tombstone")
        })
            ? entry.changes.map { SidecarDecision.restore($0.assetID) }
            : entry.changes.flatMap(undoDecisions)
        guard !decisions.isEmpty else {
            cullingHistory.removeLast()
            cullingStatus = "Nothing to undo in the last culling step."
            return
        }
        do {
            let changes = try await decisionService.applyDetailed(
                decisions,
                idempotencyKey: "native-culling-undo-\(entry.id.uuidString)"
            )
            for change in changes { cullingStates[change.assetID] = change.state }
            cullingHistory.removeLast()
            cullingSelection = OwnerSelectionModel(
                orderedIDs: visibleCullingAssets.map(\.id),
                selectedIDs: entry.selectedIDs,
                anchorID: entry.selectedIDs.first,
                focusedID: entry.selectedIDs.first
            )
            selectedPhotoIDs = entry.selectedIDs
            cullingStatus = "Undid \(entry.label). \(cullingHistory.count) reversible step\(cullingHistory.count == 1 ? "" : "s") remain."
        } catch {
            cullingStatus = "Undo failed; the history step was preserved. \(error)"
        }
    }

    func prepareQuickLookURLs() async -> [URL] {
        let ids = selectedCullingAssetIDs
        guard !ids.isEmpty else {
            cullingStatus = "Select one or more items to preview."
            return []
        }
        isApplyingCullingDecision = true
        cullingCancellationRequested = false
        cullingDecisionProgress = 0
        cullingDecisionTotal = ids.count
        cullingStatus = "Preparing Quick Look 0 / \(ids.count.formatted())…"
        defer { isApplyingCullingDecision = false }
        let directory = FileManager.default.urls(
            for: .cachesDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("com.photosbyelie.backstage/QuickLook", isDirectory: true)
        do {
            try? FileManager.default.removeItem(at: directory)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var urls: [URL] = []
            for id in ids {
                if cullingCancellationRequested || Task.isCancelled {
                    cullingStatus = "Quick Look preparation stopped after \(urls.count.formatted()) of \(ids.count.formatted()) items."
                    return urls
                }
                let asset = cullingAssets.first(where: { $0.id == id })
                if asset?.mediaType == "video" {
                    let receipt = try await photoLibrary.exportOriginal(
                        localIdentifier: photoLibraryIdentifier(for: id),
                        to: directory
                    )
                    urls.append(receipt.destination)
                } else {
                    let preview = try await photoLibrary.preview(
                        localIdentifier: photoLibraryIdentifier(for: id),
                        maxPixelSize: 4_000
                    )
                    let destination = directory
                        .appendingPathComponent(id.replacingOccurrences(of: "/", with: "_"))
                        .appendingPathExtension("jpg")
                    try preview.jpegData.write(to: destination, options: .atomic)
                    urls.append(destination)
                }
                cullingDecisionProgress = urls.count
                cullingStatus = "Preparing Quick Look \(urls.count.formatted()) / \(ids.count.formatted())…"
            }
            cullingStatus = "Prepared \(urls.count) private Quick Look item\(urls.count == 1 ? "" : "s") from Photos."
            return urls
        } catch {
            cullingStatus = String(describing: error)
            return []
        }
    }

    private func applyCullingDecisions(_ decisions: [SidecarDecision], label: String) async {
        let selectedBefore = cullingSelection.selectedIDs
        isApplyingCullingDecision = true
        cullingCancellationRequested = false
        cullingDecisionProgress = 0
        cullingDecisionTotal = decisions.count
        cullingStatus = "Applying \(label.lowercased()) to \(decisions.count.formatted()) items…"
        defer { isApplyingCullingDecision = false }
        do {
            var changes: [SidecarDecisionChange] = []
            for start in stride(from: 0, to: decisions.count, by: 200) {
                if cullingCancellationRequested || Task.isCancelled {
                    if !changes.isEmpty {
                        cullingHistory.append(CullingHistoryEntry(
                            label: label,
                            changes: changes,
                            selectedIDs: selectedBefore
                        ))
                    }
                    replaceCullingItems()
                    cullingStatus = "Stopped after \(cullingDecisionProgress.formatted()) of \(decisions.count.formatted()) items; completed batches remain audited and undoable."
                    return
                }
                let end = min(decisions.count, start + 200)
                let batch = try await decisionService.applyDetailed(
                    Array(decisions[start..<end]),
                    idempotencyKey: "native-culling-\(UUID().uuidString)"
                )
                for change in batch { cullingStates[change.assetID] = change.state }
                changes.append(contentsOf: batch)
                cullingDecisionProgress = end
                cullingStatus = "Applied \(label.lowercased()) \(end.formatted()) / \(decisions.count.formatted())…"
            }
            if !changes.isEmpty {
                cullingHistory.append(CullingHistoryEntry(
                    label: label,
                    changes: changes,
                    selectedIDs: selectedBefore
                ))
                if cullingHistory.count > 100 {
                    cullingHistory.removeFirst(cullingHistory.count - 100)
                }
            }
            replaceCullingItems()
            cullingStatus = "\(label) saved for \(changes.count) item\(changes.count == 1 ? "" : "s") in the cloud ledger."
        } catch {
            cullingStatus = String(describing: error)
        }
    }

    private func applyFixturePlacement(
        _ state: FixturePlacementState,
        label: String
    ) async {
        let ids = selectedCullingAssetIDs
        guard !cullingFixtureID.isEmpty, !ids.isEmpty else {
            cullingStatus = "Choose a fixture and select one or more Photos items."
            return
        }
        let selectedBefore = cullingSelection.selectedIDs
        isApplyingCullingDecision = true
        cullingStatus = "Applying \(label.lowercased()) to \(ids.count.formatted()) items…"
        defer { isApplyingCullingDecision = false }
        do {
            let changes = try await fixtureService.applyState(
                state,
                assetIDs: ids,
                fixtureID: cullingFixtureID,
                reason: "Native culling \(label.lowercased())"
            )
            cullingHistory.append(CullingHistoryEntry(
                label: label,
                fixtureChanges: changes,
                selectedIDs: selectedBefore
            ))
            await loadFixtureCullingWindow()
            cullingStatus = "\(label) saved for \(changes.count) fixture item\(changes.count == 1 ? "" : "s")."
        } catch {
            cullingStatus = String(describing: error)
        }
    }

    private func undoDecisions(_ change: SidecarDecisionChange) -> [SidecarDecision] {
        change.changedFamilies.compactMap { family in
            switch family {
            case "rating":
                return .rating(change.assetID, value: change.before.rating)
            case "color":
                return .color(
                    change.assetID,
                    value: SidecarColor(rawValue: change.before.color) ?? .none
                )
            case "pick_state":
                let action: SidecarPickAction = switch change.before.pickState {
                case "picked": .pick
                case "rejected": .reject
                default: .unpick
                }
                return .pick(change.assetID, action: action)
            default:
                return nil
            }
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
            let change = try await metadataReviewService.updateDetailed(
                assetID: id,
                title: metadataTitle,
                caption: metadataCaption,
                keywords: metadataKeywords.components(separatedBy: ",")
            )
            recordMetadataHistory(
                MetadataHistoryEntry(
                    label: "Metadata for \(id)",
                    kind: .edit(change)
                )
            )
            metadataReviewStatus = "Title, caption, and keywords saved by action \(change.actionID). Publication remains separate."
        } catch {
            metadataReviewStatus = String(describing: error)
        }
    }

    func queueMetadataReview() async {
        let ids = selectedPhotoIDs.isEmpty
            ? [metadataAssetID].filter { !$0.isEmpty }
            : selectedCullingAssetIDs
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
            let change = try await metadataReviewService.replaceBlacklistDetailed(terms)
            recordMetadataHistory(
                MetadataHistoryEntry(
                    label: "Keyword blacklist",
                    kind: .blacklist(change)
                )
            )
            metadataBlacklist = change.after.joined(separator: ", ")
            metadataReviewStatus = "Keyword blacklist replaced through action \(change.actionID)."
        } catch {
            metadataReviewStatus = String(describing: error)
        }
    }

    func undoLastMetadataChange() async {
        guard let entry = metadataHistory.last else {
            metadataReviewStatus = "Nothing to undo in this Backstage session."
            return
        }
        do {
            switch entry.kind {
            case .edit(let change):
                let action = try await metadataReviewService.update(
                    assetID: change.assetID,
                    title: change.before.title,
                    caption: change.before.caption,
                    keywords: change.before.keywords
                )
                metadataAssetID = change.assetID
                metadataTitle = change.before.title
                metadataCaption = change.before.caption
                metadataKeywords = change.before.keywords.joined(separator: ", ")
                metadataReviewStatus = "Undid \(entry.label) through audited action \(action.id)."
            case .blacklist(let change):
                let action = try await metadataReviewService.replaceBlacklist(change.before)
                metadataBlacklist = change.before.joined(separator: ", ")
                metadataReviewStatus = "Restored the previous keyword blacklist through audited action \(action.id)."
            }
            metadataHistory.removeLast()
        } catch {
            metadataReviewStatus = "Undo failed; the history entry was retained. \(String(describing: error))"
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

    private func recordMetadataHistory(_ entry: MetadataHistoryEntry) {
        metadataHistory.append(entry)
        if metadataHistory.count > 100 {
            metadataHistory.removeFirst(metadataHistory.count - 100)
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

    func loadDeliveryPlan() async {
        guard !selectedFixtureID.isEmpty else {
            deliveryStatus = "Choose a fixture first."
            return
        }
        isRunningDelivery = true
        defer { isRunningDelivery = false }
        do {
            let plan = try await deliveryService.plan(fixtureID: selectedFixtureID)
            deliveryPlan = plan
            selectedDeliveryIDs.formIntersection(Set(plan.items.map(\.id)))
            deliveryStatus = "\(plan.completeCount) of \(plan.items.count) complete; \(plan.retryableIDs.count) approved items remain."
        } catch {
            deliveryStatus = String(describing: error)
        }
    }

    func loadUploadHealth() async {
        guard !selectedFixtureID.isEmpty else {
            uploadRecoveryStatus = "Choose a fixture first."
            return
        }
        isRunningDelivery = true
        defer { isRunningDelivery = false }
        do {
            uploadHealth = try await deliveryService.uploadHealth(fixtureID: selectedFixtureID)
            if let uploadHealth {
                uploadRecoveryStatus = "\(uploadHealth.uploadableCount) uploadable; \(uploadHealth.coveredCount) already covered; \(uploadHealth.blockedCount) metadata-blocked."
            }
        } catch {
            uploadRecoveryStatus = String(describing: error)
        }
    }

    func previewUploadRunAdoption() async {
        await runUploadAdoption(commit: false)
    }

    func commitUploadRunAdoption() async {
        await runUploadAdoption(commit: true)
    }

    private func runUploadAdoption(commit: Bool) async {
        guard !selectedFixtureID.isEmpty, !uploadRunID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            uploadRecoveryStatus = "Choose a fixture and enter an Upload Bridge run ID."
            return
        }
        isRunningDelivery = true
        defer { isRunningDelivery = false }
        do {
            let plan = try await (commit
                ? deliveryService.adopt(
                    runID: uploadRunID,
                    fixtureID: selectedFixtureID,
                    assetIDs: Array(selectedDeliveryIDs)
                )
                : deliveryService.adoptionPlan(
                    runID: uploadRunID,
                    fixtureID: selectedFixtureID,
                    assetIDs: Array(selectedDeliveryIDs)
                ))
            uploadAdoptionPlan = plan
            uploadRecoveryStatus = commit
                ? "Adopted \(plan.eligibleIDs.count) exact verified item\(plan.eligibleIDs.count == 1 ? "" : "s"); Apple Photos give-back remains visible in the delivery plan."
                : "\(plan.eligibleIDs.count) eligible; \(plan.blocked.count) blocked. No state changed."
            if commit { await loadDeliveryPlan() }
        } catch {
            uploadRecoveryStatus = String(describing: error)
        }
    }

    func deliverSelected() async {
        await deliver(ids: Array(selectedDeliveryIDs).sorted())
    }

    func retryDeliveryFailures() async {
        await deliver(ids: deliveryFailedIDs)
    }

    private func deliver(ids: [String]) async {
        guard !selectedFixtureID.isEmpty, !ids.isEmpty else {
            deliveryStatus = "Choose a fixture and one or more approved items."
            return
        }
        isRunningDelivery = true
        deliveryCompleted = 0
        deliveryTotal = ids.count
        deliveryFailedIDs = []
        defer { isRunningDelivery = false }
        do {
            try await deliveryService.configure(
                fixtureID: selectedFixtureID,
                assetIDs: ids
            )
            for id in ids {
                do {
                    let report = try await deliveryService.deliver(
                        fixtureID: selectedFixtureID,
                        assetIDs: [id]
                    )
                    if !report.ok || report.failedCount > 0 {
                        deliveryFailedIDs.append(id)
                    }
                } catch {
                    deliveryFailedIDs.append(id)
                }
                deliveryCompleted += 1
                deliveryStatus = "Processed \(deliveryCompleted) of \(deliveryTotal); \(deliveryFailedIDs.count) independently retryable failure\(deliveryFailedIDs.count == 1 ? "" : "s")."
            }
            deliveryPlan = try await deliveryService.plan(fixtureID: selectedFixtureID)
        } catch {
            deliveryStatus = String(describing: error)
        }
    }

    func loadDeliverables() async {
        guard !selectedFixtureID.isEmpty else {
            deliveryStatus = "Choose a fixture first."
            return
        }
        isRunningDelivery = true
        defer { isRunningDelivery = false }
        do {
            deliverables = try await deliveryService.deliverables(fixtureID: selectedFixtureID)
            deliveryStatus = "\(deliverables.count) PDF, video, originals, or share-link record\(deliverables.count == 1 ? "" : "s") loaded."
        } catch {
            deliveryStatus = String(describing: error)
        }
    }

    func linkDeliverable() async {
        let link = deliverableShareLink.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !selectedFixtureID.isEmpty, URL(string: link) != nil else {
            deliveryStatus = "Choose a fixture and enter a complete share URL."
            return
        }
        isRunningDelivery = true
        defer { isRunningDelivery = false }
        do {
            deliverables = try await deliveryService.linkDeliverable(
                fixtureID: selectedFixtureID,
                kind: deliverableKind,
                shareLink: link
            )
            deliverableShareLink = ""
            deliveryStatus = "\(deliverableKind.uppercased()) share link recorded; no message was sent."
        } catch {
            deliveryStatus = String(describing: error)
        }
    }

    func loadPublicationPlan() async {
        guard !selectedFixtureID.isEmpty else {
            publicationStatus = "Choose a public fixture first."
            return
        }
        do {
            let plan = try await deliveryService.publicationPlan(
                fixtureID: selectedFixtureID,
                assetIDs: Array(selectedDeliveryIDs)
            )
            publicationPlan = plan
            publicationStatus = "\(plan.eligibleIDs.count) eligible; \(plan.blocked.count) blocked. Nothing was rebuilt or deployed."
        } catch {
            publicationStatus = String(describing: error)
        }
    }

    func publishEligible() async {
        guard let publicationPlan, !publicationPlan.eligibleIDs.isEmpty else {
            publicationStatus = "Run the publication preview and select eligible assets first."
            return
        }
        isRunningDelivery = true
        defer { isRunningDelivery = false }
        do {
            let report = try await deliveryService.publish(
                fixtureID: publicationPlan.fixtureID,
                assetIDs: publicationPlan.eligibleIDs
            )
            publicationStatus = report.ok
                ? "Catalog registration and static rebuild completed through action \(report.actionID). Deployment remains explicit."
                : "\(report.failedCount) publication item\(report.failedCount == 1 ? "" : "s") failed."
        } catch {
            publicationStatus = String(describing: error)
        }
    }

    private func fixtureOperation(_ operation: () async throws -> Void) async {
        isRunningFixture = true
        defer { isRunningFixture = false }
        guard await prepareAuthenticatedOperation() else {
            fixtureStatus = "Backstage needs this Mac to be enrolled again. Open Overview to continue."
            return
        }
        do {
            try await operation()
            authentication = await authenticationService.currentSnapshot()
            status = "Connected"
        } catch {
            await presentAuthenticationFailureIfNeeded(error)
            fixtureStatus = userFacingMessage(for: error)
        }
    }

    private func accessOperation(_ operation: () async throws -> Void) async {
        isRunningAccess = true
        defer { isRunningAccess = false }
        guard await prepareAuthenticatedOperation() else {
            accessStatus = "Backstage needs this Mac to be enrolled again. Open Overview to continue."
            return
        }
        do {
            try await operation()
            authentication = await authenticationService.currentSnapshot()
            status = "Connected"
        } catch {
            await presentAuthenticationFailureIfNeeded(error)
            accessStatus = userFacingMessage(for: error)
        }
    }

    private func ensuredAuthentication() async -> OwnerAuthenticationSnapshot {
        if let authenticationTask {
            return await authenticationTask.value
        }
        let task = Task { [authenticationService] in
            await authenticationService.bootstrap()
        }
        authenticationTask = task
        let snapshot = await task.value
        authenticationTask = nil
        return snapshot
    }

    private func prepareAuthenticatedOperation() async -> Bool {
        authentication = await ensuredAuthentication()
        guard authentication.phase == .authenticated else {
            authenticationStatus = "This Mac's Backstage enrollment must be renewed from Owner."
            status = "Sign in again"
            return false
        }
        return true
    }

    private func presentAuthenticationFailureIfNeeded(_ error: Error) async {
        guard let envelope = error as? APIErrorEnvelope,
              envelope.error.code == "google_login_required" else { return }
        authentication = await authenticationService.currentSnapshot()
        authenticationStatus = "This Mac's Backstage session could not be renewed automatically."
        status = "Sign in again"
    }

    private func userFacingMessage(for error: Error) -> String {
        if let envelope = error as? APIErrorEnvelope {
            if envelope.error.code == "google_login_required" {
                return "Backstage could not renew this Mac's Owner session. Open Overview and enroll this Mac again."
            }
            return envelope.error.message
        }
        return error.localizedDescription
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

    private func photoLibraryIdentifier(for assetID: String) -> String {
        if let identifier = fixtureCullingWindow?.items
            .first(where: { $0.id == assetID })?
            .photoLibraryIdentifier,
           !identifier.isEmpty {
            return identifier
        }
        guard let poolAsset = cullingPool?.assets.first(where: { $0.id == assetID }) else {
            return assetID
        }
        return poolAsset.sourceKind == "apple_photos" && !poolAsset.photoLibraryIdentifier.isEmpty
            ? poolAsset.photoLibraryIdentifier
            : assetID
    }
}
