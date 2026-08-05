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

struct ReviewMetadataDraft: Sendable, Equatable {
    var title: String
    var keywords: [String]
    var proposalID: String = ""
    var proposalReason: String = ""
    var proposalStatus: String = ""
    var requestedGeneratorModel: String = ""
    var resolvedModel: String = ""
    var reasoningEffort: String = ""
    var vision: Bool = false

    var isProposal: Bool { !proposalID.isEmpty }
    var isHistoricalProposal: Bool { proposalStatus == "superseded" }
}

struct ReviewHistoryEntry: Identifiable, Sendable {
    var id = UUID()
    var operationID: String = ""
    var fixtureChanges: [FixtureAssetState] = []
    var label: String
    var fixtureID: String
    var mode: FixtureReviewMode
    var stateFilters: Set<FixtureReviewStateFilter>
    var proposalAvailableOnly: Bool
    var mediaFilters: Set<CullingMediaFilter>
    var search: String
    var offset: Int
    var selectedIDs: Set<String>
    var anchorID: String?
    var focusedID: String?
}

@MainActor
final class BackstageViewModel: ObservableObject {
    enum Section: String, CaseIterable, Identifiable {
        case overview = "Overview"
        case activity = "Activity"
        case fixtures = "Fixtures"
        case access = "People & Access"
        case culling = "Culling"
        case review = "Review"
        case metadata = "Metadata"
        case wasteBasket = "Waste Basket"
        case uploads = "Uploads"
        case delivery = "Delivery"
        case publication = "Publication"
        var id: String { rawValue }
    }

    @Published var selection: Section? {
        didSet {
            if let selection {
                preferences.set(selection.rawValue, forKey: Self.selectedSectionPreferenceKey)
            }
        }
    }
    @Published var actions: [OwnerAction] = []
    @Published var status = "Not connected"
    @Published private var cullingPreviewPanelVisible: Bool {
        didSet {
            preferences.set(
                cullingPreviewPanelVisible,
                forKey: Self.cullingPreviewPanelVisibilityPreferenceKey
            )
        }
    }
    @Published private var reviewPreviewPanelVisible: Bool {
        didSet {
            preferences.set(
                reviewPreviewPanelVisible,
                forKey: Self.reviewPreviewPanelVisibilityPreferenceKey
            )
        }
    }
    var isPreviewPanelVisible: Bool {
        get { selection == .review ? reviewPreviewPanelVisible : cullingPreviewPanelVisible }
        set {
            if selection == .review {
                reviewPreviewPanelVisible = newValue
            } else {
                cullingPreviewPanelVisible = newValue
            }
        }
    }
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
    @Published var isReconcilingPhotosIndex = false
    private var hasReconciledRecentPhotosIndex = false
    @Published var fixtureID = ""
    @Published var metadataReport: MetadataGiveBackReport?
    @Published var metadataStatus = "Preview approved global metadata before writing it to Photos."
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
    @Published var isLoadingFixtureTree = false
    @Published var isSearchingFixtureAssets = false
    @Published var fixturePool: FixturePool?
    @Published var fixturePools: [FixturePoolSummary] = []
    @Published var selectedFixturePoolID = ""
    @Published var fixtureSnapshotStatus = ""
    @Published var isReloadingFixturePools = false
    @Published var isOpeningFixturePool = false
    @Published var fixturePopulationMode = "curated"
    @Published var fixtureCandidateSourceKind = "photos-library"
    @Published var fixtureSavedRuleQuery = ""
    @Published var fixturePolicyVisibility = "inherit"
    @Published var fixturePolicySearchable = "inherit"
    @Published var fixturePolicyRetention = "inherit"
    @Published var fixturePolicyDelivery = "inherit"
    @Published var fixturePolicyDownload = "inherit"
    @Published var fixturePolicyCommerce = "inherit"
    @Published var fixtureEffectivePolicy = FixturePolicy(
        visibility: "private",
        searchable: false,
        retention: "no-cloud",
        delivery: "owner-only",
        download: false,
        commerce: "disabled"
    )
    @Published var fixturePolicyRevision = 0
    @Published var fixturePolicyStatus = ""
    @Published var isLoadingFixturePolicy = false
    @Published var cullingPool: FixturePool?
    @Published var cullingFixtureID = ""
    @Published var fixtureCullingWindow: FixtureCullingWindow?
    @Published var cullingViews: Set<FixtureCullingView> = [.undecided]
    @Published var isLoadingFixtureCulling = false
    @Published var cullingGridDensity = 5
    @Published private(set) var cullingGridAvailableWidth = 0.0
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
    @Published var cullingMediaFilters = Set(CullingMediaFilter.selectableCases)
    @Published var cullingRatingFilters = Set(0...5)
    @Published var cullingColorFilters = Set(CullingColorFilter.selectableCases)
    @Published var cullingWindowOffset = 0
    @Published var cullingWindowLimit = 200
    @Published var cullingThumbnails: [String: NSImage] = [:]
    @Published var isLoadingPreview = false
    @Published var isLoadingCullingDecisions = false
    @Published var cullingDecisionProgress = 0
    @Published var cullingDecisionTotal = 0
    @Published var isApplyingCullingDecision = false
    @Published var cullingCancellationRequested = false
    @Published var reviewFixtureID = ""
    @Published var fixtureReviewWindow: FixtureReviewWindow?
    @Published var reviewMode: FixtureReviewMode = .full
    @Published var reviewStateFilters: Set<FixtureReviewStateFilter> = [.picked]
    @Published var reviewProposalAvailableOnly = false
    @Published var reviewMediaFilters = Set(CullingMediaFilter.selectableCases)
    @Published var reviewSearch = ""
    @Published var reviewWindowOffset = 0
    @Published var reviewWindowLimit = 200
    @Published var reviewSelection = OwnerSelectionModel<String>()
    @Published var reviewThumbnails: [String: NSImage] = [:]
    @Published var reviewTitle = ""
    @Published var reviewKeywords = ""
    @Published var reviewAIReasons: Set<String> = []
    @Published var reviewAINote = ""
    @Published var reviewLastAction: FixtureReviewAction = .approve
    @Published var reviewStatus = "Choose a fixture to load its unresolved picked photos."
    @Published var isRunningReview = false
    @Published var reviewScrollTargetID: String?
    @Published var fixtureAIStatus: FixtureAIStatus?
    @Published var reviewProposalDrafts: [String: ReviewMetadataDraft] = [:]
    @Published var reviewProposalConflictIDs: Set<String> = []
    @Published var reviewHistory: [ReviewHistoryEntry] = []
    @Published var aiProposalStatus = "AI runs only for explicitly requested photos."
    @Published var isRunningAIPass = false
    @Published var metadataAssetID = ""
    @Published var metadataTitle = ""
    @Published var metadataCaption = ""
    @Published var metadataKeywords = ""
    @Published var metadataBlacklist = ""
    @Published var metadataReviewStatus = "Metadata changes use audited Max actions."
    @Published var metadataHistory: [MetadataHistoryEntry] = []
    @Published var metadataProposals: [MetadataProposal] = []
    @Published var metadataProposalStatus = "Load the local AI proposal queue to review it."
    @Published var metadataModelCatalog: [MetadataModelLadderRung] = MetadataModelLadderRung.catalog
    @Published var metadataModelLadder: [MetadataModelLadderRung] = MetadataModelLadderRung.defaultLadder
    @Published var metadataModelLadderStatus = "Every rung sends a bounded JPEG; vision is always on."
    @Published var isSavingMetadataModelLadder = false
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
    @Published var nativeUploadPlan: NativeUploadPlan?
    @Published var nativeUploadRun: NativeUploadRun?
    @Published var isRunningNativePublication = false
    @Published var nativePublicationBatchNumber = 0
    @Published var nativePublicationBatchCount = 0
    @Published var nativeUploadThumbnails: [String: NSImage] = [:]
    @Published var nativeUploadPreviewImage: NSImage?
    @Published var nativeUploadPreviewItemID = ""
    @Published var nativeUploadStatus = "Choose a fixture to load its approved publication queue."
    @Published var photosSyncReport: PhotosSyncReport?
    @Published var photosSyncStatus = "Apple Photos sync runs incrementally in the background."
    @Published var isSyncingPhotos = false
    @Published var r2Reconciliation: R2ReconciliationReport?
    @Published var r2ReconciliationStatus = "Preview protected sales and 30-day quarantine before committing cleanup."
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
    private var reviewMetadataAutosaveTask: Task<Void, Never>?
    private var cullingFilterTask: Task<Void, Never>?
    private var cullingBackfillTask: Task<Void, Never>?
    private var cullingThumbnailTasks: [String: Task<Void, Never>] = [:]
    private var reviewThumbnailTasks: [String: Task<Void, Never>] = [:]
    private var cullingWindowRequestSerial = 0
    private var reviewWindowRequestSerial = 0
    private let preferences: UserDefaults
    private static let selectedSectionPreferenceKey =
        "PhotosByElieBackstage.selectedSection"
    private static let legacyPreviewPanelVisibilityPreferenceKey =
        "PhotosByElieBackstage.previewPanelVisible"
    private static let cullingPreviewPanelVisibilityPreferenceKey =
        "PhotosByElieBackstage.cullingPreviewPanelVisible"
    private static let reviewPreviewPanelVisibilityPreferenceKey =
        "PhotosByElieBackstage.reviewPreviewPanelVisible"

    var selectedFixturePoolSummary: FixturePoolSummary? {
        fixturePools.first(where: { $0.id == selectedFixturePoolID })
    }

    var canRunAIProposalPass: Bool {
        guard !isRunningAIPass else { return false }
        return (fixtureAIStatus?.requested ?? 0) > 0
    }

    var hasReviewAIDraft: Bool {
        !reviewAIReasons.isEmpty
            || !reviewAINote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var canMarkReviewSelectionNeedsAI: Bool {
        !isRunningReview && !selectedReviewAssetIDs.isEmpty && hasReviewAIDraft
    }

    var selectedFixturePath: [FixtureNode] {
        fixtures.path(to: selectedFixtureID)
    }

    var fixtureEffectivePolicySummary: String {
        let policy = fixtureEffectivePolicy
        return [
            "Visibility \(policy.visibility.replacingOccurrences(of: "-", with: " ").capitalized)",
            "Search \(policy.searchable ? "On" : "Off")",
            "Retention \(policy.retention.replacingOccurrences(of: "-", with: " ").capitalized)",
            "Delivery \(policy.delivery.replacingOccurrences(of: "-", with: " ").capitalized)",
            "Download \(policy.download ? "On" : "Off")",
            "Commerce \(policy.commerce.replacingOccurrences(of: "-", with: " ").capitalized)",
        ].joined(separator: "  •  ")
    }

    var isRunningFixtureSnapshotOperation: Bool {
        isReloadingFixturePools || isOpeningFixturePool
    }

    init(
        api: OwnerAPIClient = OwnerAPIClient(),
        photoLibrary: any PhotoLibraryServing = PhotoKitLibraryService(),
        preferences: UserDefaults = .standard
    ) {
        self.preferences = preferences
        self.selection = preferences.string(forKey: Self.selectedSectionPreferenceKey)
            .flatMap(Section.init(rawValue:)) ?? .overview
        let legacyPreviewVisibility =
            preferences.object(forKey: Self.legacyPreviewPanelVisibilityPreferenceKey) == nil
                ? true
                : preferences.bool(forKey: Self.legacyPreviewPanelVisibilityPreferenceKey)
        self.cullingPreviewPanelVisible =
            preferences.object(forKey: Self.cullingPreviewPanelVisibilityPreferenceKey) == nil
                ? legacyPreviewVisibility
                : preferences.bool(forKey: Self.cullingPreviewPanelVisibilityPreferenceKey)
        self.reviewPreviewPanelVisible =
            preferences.object(forKey: Self.reviewPreviewPanelVisibilityPreferenceKey) == nil
                ? legacyPreviewVisibility
                : preferences.bool(forKey: Self.reviewPreviewPanelVisibilityPreferenceKey)
        self.api = api
        self.authenticationService = OwnerAuthenticationService(api: api)
        self.photoLibrary = photoLibrary
        self.photoAccess = photoLibrary.authorization()
        let runner = OwnerActionRunner(api: api)
        self.metadataService = MetadataGiveBackService(runner: runner)
        self.fixtureService = FixtureWorkflowService(
            runner: runner,
            connectorIdentity: LocalOwnerConnectorIdentity()
        )
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
            await syncPhotosIncrementally()
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
        photoStatus = "\(libraryItems.count.formatted()) recent Photos previews cached."
    }

    func reconcilePhotosLibraryIndex() async {
        guard !isReconcilingPhotosIndex else { return }
        guard await prepareAuthenticatedOperation() else { return }
        isReconcilingPhotosIndex = true
        photoStatus = "Reconciling the complete Photos library with Owner…"
        defer { isReconcilingPhotosIndex = false }
        do {
            let report = try await fixtureService.reconcilePhotosIndex()
            await refreshPhotos()
            if hasCurrentCullingFixture, cullingPool == nil {
                await loadFixtureCullingWindow()
            }
            photoStatus = [
                "Owner reconciled",
                "\(report.importedCount.formatted()) indexed",
                "\(report.missingMarkedCount.formatted()) unavailable marked",
            ].joined(separator: " • ")
        } catch {
            await presentAuthenticationFailureIfNeeded(error)
            if status != "Sign in again" {
                photoStatus = userFacingMessage(for: error)
            }
        }
    }

    func refreshPhotosAndRecentIndex(force: Bool = false) async {
        await refreshPhotos()
        await reconcileRecentPhotosIndex(force: force)
    }

    func reconcileRecentPhotosIndex(force: Bool = false) async {
        guard force || !hasReconciledRecentPhotosIndex else { return }
        guard !isReconcilingPhotosIndex else { return }
        guard [.authorized, .limited].contains(photoAccess) else { return }
        guard await prepareAuthenticatedOperation() else { return }
        isReconcilingPhotosIndex = true
        photoStatus = "Synchronizing recent Photos with the Owner index…"
        defer { isReconcilingPhotosIndex = false }
        do {
            let start = Calendar.current.date(
                byAdding: .day,
                value: -45,
                to: Date()
            ) ?? Date().addingTimeInterval(-45 * 24 * 60 * 60)
            let dateFormatter = DateFormatter()
            dateFormatter.calendar = Calendar(identifier: .gregorian)
            dateFormatter.locale = Locale(identifier: "en_US_POSIX")
            dateFormatter.timeZone = TimeZone(secondsFromGMT: 0)
            dateFormatter.dateFormat = "yyyy-MM-dd"
            let report = try await fixtureService.reconcilePhotosIndex(
                dateFrom: dateFormatter.string(from: start)
            )
            hasReconciledRecentPhotosIndex = true
            photoStatus = [
                "Recent Photos synchronized",
                "\(report.importedCount.formatted()) indexed",
            ].joined(separator: " • ")
        } catch {
            await presentAuthenticationFailureIfNeeded(error)
            if status != "Sign in again" {
                photoStatus = userFacingMessage(for: error)
            }
        }
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
            photoStatus = userFacingMessage(for: error)
        }
    }

    func requestThumbnail(for assetID: String) {
        guard cullingThumbnails[assetID] == nil,
              cullingThumbnailTasks[assetID] == nil
        else { return }
        cullingThumbnailTasks[assetID] = Task { [weak self] in
            guard let self else { return }
            await self.loadThumbnail(for: assetID)
            self.cullingThumbnailTasks[assetID] = nil
        }
    }

    func loadThumbnail(for assetID: String) async {
        guard cullingThumbnails[assetID] == nil else { return }
        let localIdentifier = photoLibraryIdentifier(for: assetID)
        for attempt in 0..<3 {
            guard !Task.isCancelled else { return }
            do {
                let preview = try await photoLibrary.preview(
                    localIdentifier: localIdentifier,
                    maxPixelSize: 180
                )
                guard let image = NSImage(data: preview.jpegData) else {
                    if attempt < 2 {
                        try? await Task.sleep(for: .milliseconds(180))
                        continue
                    }
                    return
                }
                if cullingThumbnails.count >= 300,
                   let oldest = cullingThumbnails.keys.first {
                    cullingThumbnails.removeValue(forKey: oldest)
                }
                cullingThumbnails[assetID] = image
                return
            } catch {
                guard !Task.isCancelled, attempt < 2 else { return }
                try? await Task.sleep(for: .milliseconds(180 * (attempt + 1)))
            }
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
                fixtureID: fixtureID.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            self.metadataReport = retried
            metadataStatus = reportStatus(retried)
        } catch {
            metadataStatus = userFacingMessage(for: error)
        }
    }

    var flatFixtures: [FixtureNode] {
        fixtures.flatMap(\.flattened)
    }

    var cullingAssets: [FixtureAsset] {
        if cullingPool == nil, hasCurrentCullingFixture {
            return fixtureCullingWindow?.items ?? []
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
            media: cullingMediaFilters,
            pick: Set(cullingViews.map {
                switch $0 {
                case .undecided: .undecided
                case .picked: .picked
                case .hidden: .rejected
                case .allActive: .undecided
                }
            }),
            ratings: cullingRatingFilters,
            colors: cullingColorFilters
        )
    }

    var cullingMediaFilterLabel: String {
        cullingMediaFilters.count == CullingMediaFilter.selectableCases.count
            ? "All media"
            : cullingMediaFilters.sorted(by: { $0.rawValue < $1.rawValue }).map(\.label).joined(separator: " + ")
    }

    var cullingViewFilterLabel: String {
        cullingViews.count == FixtureCullingView.selectableCases.count
            ? "All decisions"
            : cullingViews.sorted(by: { $0.rawValue < $1.rawValue }).map(\.label).joined(separator: " + ")
    }

    var cullingRatingFilterLabel: String {
        if cullingRatingFilters.count == 6 { return "All ratings" }
        if cullingRatingFilters.count == 1, let rating = cullingRatingFilters.first {
            return rating == 0 ? "No rating" : "\(rating) star\(rating == 1 ? "" : "s")"
        }
        return "\(cullingRatingFilters.count) ratings"
    }

    var cullingColorFilterLabel: String {
        cullingColorFilters.count == CullingColorFilter.selectableCases.count
            ? "All colors"
            : cullingColorFilters.sorted(by: { $0.rawValue < $1.rawValue }).map(\.label).joined(separator: " + ")
    }

    func toggleCullingMediaFilter(_ filter: CullingMediaFilter) {
        toggle(filter, in: &cullingMediaFilters)
    }

    func toggleCullingViewFilter(_ view: FixtureCullingView) {
        toggle(view, in: &cullingViews)
    }

    func toggleCullingRatingFilter(_ rating: Int) {
        toggle(rating, in: &cullingRatingFilters)
    }

    func toggleCullingColorFilter(_ color: CullingColorFilter) {
        toggle(color, in: &cullingColorFilters)
    }

    private func toggle<Value: Hashable>(_ value: Value, in selection: inout Set<Value>) {
        if selection.contains(value) {
            guard selection.count > 1 else { return }
            selection.remove(value)
        } else {
            selection.insert(value)
        }
    }

    var cullingWorkspace: CullingWorkspaceResult {
        if cullingPool == nil, hasCurrentCullingFixture, let window = fixtureCullingWindow {
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
        if cullingPool == nil, hasCurrentCullingFixture {
            return CullingWorkspaceResult(
                items: [],
                summary: CullingSummary(
                    total: 0,
                    filtered: 0,
                    undecided: 0,
                    picked: 0,
                    rejected: 0,
                    photos: 0,
                    videos: 0
                ),
                offset: 0,
                limit: cullingWindowLimit
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
        if cullingPool == nil, hasCurrentCullingFixture {
            guard fixtureCullingWindow != nil else { return [] }
            let assets = Dictionary(uniqueKeysWithValues: cullingAssets.map { ($0.id, $0) })
            let exactWindow = CullingWorkspace.evaluate(
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
                offset: 0,
                limit: max(1, cullingAssets.count)
            )
            return exactWindow.items.compactMap { assets[$0.id] }
        }
        let assets = Dictionary(uniqueKeysWithValues: cullingAssets.map { ($0.id, $0) })
        return cullingWorkspace.items.compactMap { assets[$0.id] }
    }

    var selectedCullingAssetIDs: [String] {
        visibleCullingAssets.map(\.id).filter(cullingSelection.selectedIDs.contains)
    }

    var hasCurrentCullingFixture: Bool {
        !cullingFixtureID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var isBlockingFixtureCullingLoad: Bool {
        isLoadingFixtureCulling && fixtureCullingWindow == nil
    }

    var focusedCullingAssetID: String? {
        cullingSelection.focusedID ?? selectedCullingAssetIDs.first
    }

    var focusedCullingAsset: FixtureAsset? {
        guard let id = focusedCullingAssetID else { return nil }
        return cullingAssets.first(where: { $0.id == id })
    }

    var reviewItems: [FixtureReviewItem] {
        fixtureReviewWindow?.items ?? []
    }

    var selectedReviewAssetIDs: [String] {
        reviewItems.map(\.id).filter(reviewSelection.selectedIDs.contains)
    }

    var focusedReviewItem: FixtureReviewItem? {
        let id = reviewSelection.focusedID ?? selectedReviewAssetIDs.first
        return reviewItems.first(where: { $0.id == id })
    }

    var readyAIProposalCount: Int {
        fixtureAIStatus?.ready ?? 0
    }

    func hasProposalDraft(for assetID: String) -> Bool {
        reviewProposalDrafts[assetID]?.isProposal ?? false
    }

    var reviewAIReasonChoices: [String] {
        [
            "Incorrect title",
            "Too generic",
            "Placeholder",
            "Use keywords",
            "Add details",
            "Use shoot context",
            "Other",
        ]
    }

    func replaceCullingItems() {
        cullingSelection.replaceItems(visibleCullingAssets.map(\.id))
        selectedPhotoIDs = cullingSelection.selectedIDs
    }

    func applyCullingFilters(debounceNanoseconds: UInt64 = 0) {
        cullingWindowOffset = 0
        cullingBackfillTask?.cancel()
        cullingFilterTask?.cancel()
        if !cullingFixtureID.isEmpty, cullingPool == nil {
            // Invalidate the old response immediately. Until the audited
            // fixture query completes, the grid must not fall back to the
            // unrelated recent-Photos preview cache or show stale results.
            cullingWindowRequestSerial += 1
            fixtureCullingWindow = nil
            isLoadingFixtureCulling = true
            clearCullingSelection()
            photoPreview = nil
            cullingStatus = "Applying culling filters…"
            cullingFilterTask = Task { [weak self] in
                if debounceNanoseconds > 0 {
                    try? await Task.sleep(nanoseconds: debounceNanoseconds)
                }
                guard !Task.isCancelled else { return }
                await self?.loadFixtureCullingWindow()
            }
            return
        }
        replaceCullingItems()
        photoPreview = nil
        cullingStatus = "\(cullingWorkspace.summary.filtered.formatted()) of \(cullingWorkspace.summary.total.formatted()) items match."
    }

    func scheduleCullingSearchRefresh() {
        applyCullingFilters(debounceNanoseconds: 250_000_000)
    }

    func clearCullingFilters() {
        cullingSearch = ""
        cullingMediaFilters = Set(CullingMediaFilter.selectableCases)
        cullingRatingFilters = Set(0...5)
        cullingColorFilters = Set(CullingColorFilter.selectableCases)
        if cullingViews == [.undecided] {
            applyCullingFilters()
        } else {
            cullingViews = [.undecided]
        }
    }

    func showPickedReview() {
        if !cullingFixtureID.isEmpty, cullingPool == nil {
            if cullingViews == [.picked] {
                applyCullingFilters()
            } else {
                cullingViews = [.picked]
            }
            return
        }
        cullingViews = [.picked]
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

    var canIncreaseCullingThumbnailSize: Bool {
        cullingGridDensity > 1
    }

    var canDecreaseCullingThumbnailSize: Bool {
        cullingGridDensity < CullingGridLayout.maximumColumnsThatFit(
            width: cullingGridAvailableWidth
        )
    }

    func increaseCullingThumbnailSize() {
        cullingGridDensity = max(1, cullingGridDensity - 1)
    }

    func decreaseCullingThumbnailSize() {
        guard canDecreaseCullingThumbnailSize else { return }
        cullingGridDensity += 1
    }

    func updateCullingGridWidth(_ width: Double) {
        // GeometryReader can briefly report a tiny pre-layout width while the
        // split view is being assembled. It is not a usable viewport and must
        // not collapse the user's column count.
        guard width >= CullingGridLayout.minimumColumnWidth else { return }
        if abs(cullingGridAvailableWidth - width) > 0.5 {
            cullingGridAvailableWidth = width
        }
        let clamped = CullingGridLayout.clampedColumnCount(
            cullingGridDensity,
            width: width
        )
        if clamped != cullingGridDensity {
            cullingGridDensity = clamped
        }
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

    func selectVisibleBurstCandidates() {
        let visibleAssets = visibleCullingAssets
        let visibleIDs = visibleAssets.map(\.id)
        guard !visibleAssets.isEmpty else {
            cullingStatus = isLoadingFixtureCulling
                ? "Wait for the filtered culling window to finish loading."
                : "No filtered items are visible."
            return
        }
        let timedItems = visibleAssets.map {
            CullingTimedItem(
                id: $0.id,
                capturedAt: CullingWorkspace.captureDate($0.capturedAt)
            )
        }
        let ids = CullingWorkspace.burstRejectCandidates(in: timedItems)
        cullingSelection = OwnerSelectionModel(
            orderedIDs: visibleIDs,
            selectedIDs: Set(ids),
            anchorID: ids.first,
            focusedID: ids.first
        )
        selectedPhotoIDs = Set(ids)
        cullingStatus = ids.isEmpty
            ? "No adjacent capture-time bursts found in the visible items."
            : "Selected \(ids.count) likely duplicate\(ids.count == 1 ? "" : "s") across adjacent capture-time bursts; each second frame remains as the likely keeper."
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
        cullingViews = [.undecided]
        cullingWindowOffset = 0
        cullingSearch = ""
        clearCullingSelection()
        photoPreview = nil
        cullingThumbnails = [:]
        Task { await loadFixtureCullingWindow() }
    }

    func loadFixtureCullingWindow(preservingVisibleWindow: Bool = false) async {
        guard !cullingFixtureID.isEmpty else {
            cullingStatus = "Choose a fixture to begin culling."
            return
        }
        if !preservingVisibleWindow {
            cullingBackfillTask?.cancel()
        }
        cullingWindowRequestSerial += 1
        let requestSerial = cullingWindowRequestSerial
        isLoadingFixtureCulling = true
        if !preservingVisibleWindow {
            fixtureCullingWindow = nil
            clearCullingSelection()
            photoPreview = nil
            cullingStatus = "Loading the \(cullingViewFilterLabel.lowercased()) fixture window…"
        }
        defer {
            if requestSerial == cullingWindowRequestSerial {
                isLoadingFixtureCulling = false
            }
        }
        do {
            let mediaTypes = cullingMediaFilters.map {
                $0 == .videos ? "video" : "photo"
            }.sorted()
            let colors = cullingColorFilters.map(\.rawValue).sorted()
            let views = cullingViews.sorted(by: { $0.rawValue < $1.rawValue })
            let window = try await fixtureService.cullingWindow(
                fixtureID: cullingFixtureID,
                view: views.count == 1 ? views[0] : .allActive,
                views: views,
                offset: cullingWindowOffset,
                limit: cullingWindowLimit,
                search: cullingSearch,
                mediaTypes: mediaTypes,
                ratings: cullingRatingFilters.sorted(),
                colors: colors
            )
            guard requestSerial == cullingWindowRequestSerial, !Task.isCancelled else { return }
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
            if !preservingVisibleWindow {
                photoPreview = nil
                cullingStatus = "\(window.summary.filtered.formatted()) \(window.view.label.lowercased()) of \(window.summary.universe.formatted()) eligible items."
            }
        } catch {
            guard requestSerial == cullingWindowRequestSerial else { return }
            guard !(error is CancellationError), !Task.isCancelled else { return }
            if preservingVisibleWindow {
                cullingStatus = "Saved. Background backfill delayed: \(userFacingMessage(for: error))"
            } else {
                cullingStatus = userFacingMessage(for: error)
            }
        }
    }

    private func scheduleFixtureCullingBackfill() {
        cullingBackfillTask?.cancel()
        cullingBackfillTask = Task(priority: .utility) { [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await self?.loadFixtureCullingWindow(preservingVisibleWindow: true)
        }
    }

    func loadFixtures() async {
        isLoadingFixtureTree = true
        defer { isLoadingFixtureTree = false }
        await fixtureOperation {
            fixtures = try await fixtureService.tree()
            if cullingFixtureID.isEmpty {
                cullingFixtureID = flatFixtures.first(where: { $0.id == "fixture-expo" })?.id
                    ?? flatFixtures.first(where: { $0.parentID == nil && !$0.isArchived })?.id
                    ?? ""
            }
            if reviewFixtureID.isEmpty {
                reviewFixtureID = cullingFixtureID
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
        isSearchingFixtureAssets = true
        defer { isSearchingFixtureAssets = false }
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

    func loadFixtureConfiguration() async {
        guard !selectedFixtureID.isEmpty else {
            fixturePolicyStatus = ""
            return
        }
        isLoadingFixturePolicy = true
        fixturePolicyStatus = "Loading fixture contract…"
        defer { isLoadingFixturePolicy = false }
        do {
            let configuration = try await fixtureService.configuration(
                fixtureID: selectedFixtureID
            )
            fixturePopulationMode = configuration.populationMode
            fixtureCandidateSourceKind =
                configuration.candidateSource["kind"]?.stringValue ?? "photos-library"
            fixtureSavedRuleQuery =
                configuration.savedRule["query"]?.stringValue ?? ""
            fixtureTemplate = configuration.templateKey
            let configured = configuration.configuredPolicy
            fixturePolicyVisibility = configured.visibility ?? "inherit"
            fixturePolicySearchable = configured.searchable.map { $0 ? "on" : "off" } ?? "inherit"
            fixturePolicyRetention = configured.retention ?? "inherit"
            fixturePolicyDelivery = configured.delivery ?? "inherit"
            fixturePolicyDownload = configured.download.map { $0 ? "on" : "off" } ?? "inherit"
            fixturePolicyCommerce = configured.commerce ?? "inherit"
            fixtureEffectivePolicy = configuration.effectivePolicy
            fixturePolicyRevision = configuration.revision
            fixturePolicyStatus = "Configured overrides and effective revision \(configuration.revision) loaded."
        } catch {
            fixturePolicyStatus = userFacingMessage(for: error)
        }
    }

    func saveFixtureConfiguration() async {
        guard !selectedFixtureID.isEmpty else { return }
        isLoadingFixturePolicy = true
        fixturePolicyStatus = "Saving revisioned fixture contract…"
        defer { isLoadingFixturePolicy = false }
        do {
            var rule: [String: JSONValue] = [:]
            let query = fixtureSavedRuleQuery.trimmingCharacters(in: .whitespacesAndNewlines)
            if !query.isEmpty {
                rule["query"] = .string(query)
            }
            let configuration = try await fixtureService.configure(
                fixtureID: selectedFixtureID,
                populationMode: fixturePopulationMode,
                candidateSource: ["kind": .string(fixtureCandidateSourceKind)],
                savedRule: rule,
                policy: FixturePolicyOverrides(
                    visibility: fixturePolicyVisibility == "inherit"
                        ? nil : fixturePolicyVisibility,
                    searchable: fixturePolicySearchable == "inherit"
                        ? nil : fixturePolicySearchable == "on",
                    retention: fixturePolicyRetention == "inherit"
                        ? nil : fixturePolicyRetention,
                    delivery: fixturePolicyDelivery == "inherit"
                        ? nil : fixturePolicyDelivery,
                    download: fixturePolicyDownload == "inherit"
                        ? nil : fixturePolicyDownload == "on",
                    commerce: fixturePolicyCommerce == "inherit"
                        ? nil : fixturePolicyCommerce
                ),
                templateKey: fixtureTemplate,
                reason: "Backstage fixture policy editor"
            )
            fixtureEffectivePolicy = configuration.effectivePolicy
            fixturePolicyRevision = configuration.revision
            fixturePolicyStatus = "Saved overrides; effective revision \(configuration.revision) refreshed."
        } catch {
            fixturePolicyStatus = userFacingMessage(for: error)
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
            accessStatus = userFacingMessage(for: error)
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
        let semanticAction: FixtureCullingAction = switch action {
        case .pick: .include
        case .reject: .exclude
        case .unpick: .clear
        }
        switch FixtureCullingSemantics.mutation(
            for: semanticAction,
            currentFixtureID: cullingFixtureID
        ) {
        case .unavailable:
            cullingStatus = "Choose a current fixture before using P, H, or U. X remains the global reject action."
        case let .fixtureState(state):
            let label = switch state {
            case .picked: "Include"
            case .hidden: "Exclude"
            case .undecided: "Clear fixture decision"
            }
            await applyFixturePlacement(state, label: label)
        case .globalTombstone:
            return
        }
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
        if destination == .review {
            if reviewFixtureID.isEmpty {
                reviewFixtureID = cullingFixtureID
            }
            reviewStatus = "\(ids.count) picked item\(ids.count == 1 ? "" : "s") handed to Review."
            Task { await loadFixtureReviewWindow(preferredAssetID: ids.first) }
        } else if destination == .metadata {
            metadataAssetID = ids.first ?? ""
            metadataReviewStatus = "\(ids.count) culling item\(ids.count == 1 ? "" : "s") handed to Metadata."
        } else if destination == .uploads {
            uploadRecoveryStatus = "\(ids.count) picked item\(ids.count == 1 ? "" : "s") retained for the fixture-scoped Uploads workflow."
        }
        selection = destination
    }

    func selectReviewFixture(_ fixtureID: String) {
        preserveCurrentReviewDraft()
        reviewFixtureID = fixtureID
        reviewWindowOffset = 0
        reviewSearch = ""
        reviewSelection.clear()
        reviewThumbnails = [:]
        clearReviewDraft()
        Task { await loadFixtureReviewWindow() }
    }

    func selectReviewMode(_ mode: FixtureReviewMode) {
        preserveCurrentReviewDraft()
        reviewMode = mode
        reviewWindowOffset = 0
        reviewSelection.clear()
        clearReviewDraft()
        Task { await loadFixtureReviewWindow() }
    }

    func setReviewProposalAvailableOnly(_ enabled: Bool) {
        preserveCurrentReviewDraft()
        reviewProposalAvailableOnly = enabled
        reviewWindowOffset = 0
        reviewSelection.clear()
        clearReviewDraft()
        Task { await loadFixtureReviewWindow() }
    }

    func toggleReviewStateFilter(_ filter: FixtureReviewStateFilter) {
        preserveCurrentReviewDraft()
        if reviewStateFilters.contains(filter) {
            reviewStateFilters.remove(filter)
        } else {
            reviewStateFilters.insert(filter)
        }
        reviewWindowOffset = 0
        reviewSelection.clear()
        clearReviewDraft()
        Task { await loadFixtureReviewWindow() }
    }

    func toggleReviewMediaFilter(_ filter: CullingMediaFilter) {
        preserveCurrentReviewDraft()
        if reviewMediaFilters.contains(filter) {
            reviewMediaFilters.remove(filter)
        } else {
            reviewMediaFilters.insert(filter)
        }
        reviewWindowOffset = 0
        reviewSelection.clear()
        clearReviewDraft()
        Task { await loadFixtureReviewWindow() }
    }

    func moveReviewWindow(forward: Bool) {
        guard let window = fixtureReviewWindow else { return }
        if forward, window.hasNext {
            reviewWindowOffset = window.nextOffset
        } else if !forward, window.offset > 0 {
            reviewWindowOffset = max(0, window.offset - window.limit)
        }
        Task { await loadFixtureReviewWindow() }
    }

    func loadFixtureReviewWindow(
        preferredAssetID: String? = nil,
        retryOnCancellation: Bool = true
    ) async {
        guard !reviewFixtureID.isEmpty else {
            reviewStatus = "Choose a fixture to load its Review queue."
            return
        }
        reviewWindowRequestSerial += 1
        let requestSerial = reviewWindowRequestSerial
        let currentID = preferredAssetID
            ?? reviewSelection.focusedID
            ?? selectedReviewAssetIDs.first
        preserveCurrentReviewDraft()
        isRunningReview = true
        reviewStatus = "Loading the oldest unresolved picked photos…"
        defer {
            if requestSerial == reviewWindowRequestSerial {
                isRunningReview = false
            }
        }
        do {
            let window = try await fixtureService.reviewWindow(
                fixtureID: reviewFixtureID,
                mode: reviewMode,
                stateFilters: reviewStateFilters.map(\.rawValue).sorted(),
                proposalAvailableOnly: reviewProposalAvailableOnly,
                mediaFilters: reviewMediaFilters.map(\.rawValue).sorted(),
                offset: reviewWindowOffset,
                limit: reviewWindowLimit,
                search: reviewSearch
            )
            guard requestSerial == reviewWindowRequestSerial, !Task.isCancelled else { return }
            hydrateReviewProposalDrafts(from: window.items)
            fixtureReviewWindow = window
            let orderedIDs = window.items.map(\.id)
            let replacementID = currentID.flatMap { orderedIDs.contains($0) ? $0 : nil }
                ?? orderedIDs.first
            reviewSelection = OwnerSelectionModel(
                orderedIDs: orderedIDs,
                selectedIDs: Set(replacementID.map { [$0] } ?? []),
                anchorID: replacementID,
                focusedID: replacementID
            )
            reviewScrollTargetID = replacementID
            syncReviewDraft()
            let queueScope = reviewStateFilters
                .sorted { $0.rawValue < $1.rawValue }
                .map(\.label)
                .joined(separator: " + ")
            let scope = reviewProposalAvailableOnly
                ? "\(queueScope.isEmpty ? "No states" : queueScope) with proposals available"
                : (queueScope.isEmpty ? "No states" : queueScope)
            let mediaScope: String
            switch reviewMediaFilters {
            case let filters where filters == Set(CullingMediaFilter.selectableCases):
                mediaScope = "items"
            case let filters where filters == [.photos]:
                mediaScope = "photos"
            case let filters where filters == [.videos]:
                mediaScope = "videos"
            default:
                mediaScope = "items"
            }
            reviewStatus = "\(window.summary.total.formatted()) \(scope) \(mediaScope) • oldest first."
            await refreshAIStatus()
        } catch {
            guard requestSerial == reviewWindowRequestSerial else { return }
            if isTransientCancellation(error) {
                guard retryOnCancellation, !Task.isCancelled else { return }
                try? await Task.sleep(for: .milliseconds(180))
                guard !Task.isCancelled else { return }
                await loadFixtureReviewWindow(
                    preferredAssetID: currentID,
                    retryOnCancellation: false
                )
                return
            }
            reviewStatus = userFacingMessage(for: error)
        }
    }

    func clickReviewItem(_ id: String, modifiers: NSEvent.ModifierFlags) {
        preserveCurrentReviewDraft()
        reviewSelection.click(
            id,
            extending: modifiers.contains(.shift),
            toggling: modifiers.contains(.command)
        )
        syncReviewDraft()
    }

    func moveReviewSelection(by delta: Int, extending: Bool) {
        preserveCurrentReviewDraft()
        reviewSelection.move(by: delta, extending: extending)
        reviewScrollTargetID = reviewSelection.focusedID
        syncReviewDraft()
    }

    func selectAllReviewItems() {
        reviewSelection.selectAll()
        syncReviewDraft()
    }

    func clearReviewSelection() {
        preserveCurrentReviewDraft()
        reviewSelection.clear()
        clearReviewDraft()
    }

    func toggleReviewAIReason(_ reason: String) {
        if reviewAIReasons.contains(reason) {
            reviewAIReasons.remove(reason)
        } else {
            reviewAIReasons.insert(reason)
        }
    }

    func updateReviewAINote(_ value: String) {
        reviewAINote = value
    }

    func markReviewSelectionNeedsAI() async {
        guard hasReviewAIDraft else {
            reviewStatus = "Choose at least one AI reason or add a note."
            return
        }
        await applyReviewAction(.requestAI)
    }

    func unpickReviewSelection() async {
        guard !isRunningReview else {
            reviewStatus = "Finish the current Review action first."
            return
        }
        reviewMetadataAutosaveTask?.cancel()
        reviewMetadataAutosaveTask = nil
        let ids = selectedReviewAssetIDs
        guard !reviewFixtureID.isEmpty, !ids.isEmpty else {
            reviewStatus = "Choose a fixture and select one or more Review items."
            return
        }
        let oldItems = reviewItems
        let focusedID = reviewSelection.focusedID ?? ids.first
        let oldIndex = focusedID.flatMap { focusedID in
            oldItems.firstIndex(where: { $0.id == focusedID })
        } ?? oldItems.firstIndex(where: { ids.contains($0.id) }) ?? 0
        let fixtureLabel = flatFixtures.first(where: { $0.id == reviewFixtureID })?.name
            ?? reviewFixtureID
        let historyEntry = ReviewHistoryEntry(
            label: "Unpick",
            fixtureID: reviewFixtureID,
            mode: reviewMode,
            stateFilters: reviewStateFilters,
            proposalAvailableOnly: reviewProposalAvailableOnly,
            mediaFilters: reviewMediaFilters,
            search: reviewSearch,
            offset: reviewWindowOffset,
            selectedIDs: reviewSelection.selectedIDs,
            anchorID: reviewSelection.anchorID,
            focusedID: reviewSelection.focusedID
        )
        isRunningReview = true
        reviewStatus = "Unpicking \(ids.count.formatted()) Review item\(ids.count == 1 ? "" : "s")…"
        defer { isRunningReview = false }
        do {
            let changes = try await fixtureService.applyState(
                .undecided,
                assetIDs: ids,
                fixtureID: reviewFixtureID,
                reason: "Native Review unpick"
            )
            reviewHistory.append(
                ReviewHistoryEntry(
                    fixtureChanges: changes,
                    label: historyEntry.label,
                    fixtureID: historyEntry.fixtureID,
                    mode: historyEntry.mode,
                    stateFilters: historyEntry.stateFilters,
                    proposalAvailableOnly: historyEntry.proposalAvailableOnly,
                    mediaFilters: historyEntry.mediaFilters,
                    search: historyEntry.search,
                    offset: historyEntry.offset,
                    selectedIDs: historyEntry.selectedIDs,
                    anchorID: historyEntry.anchorID,
                    focusedID: historyEntry.focusedID
                )
            )
            if reviewHistory.count > 100 {
                reviewHistory.removeFirst(reviewHistory.count - 100)
            }
            removeUnpickedReviewItems(Set(ids), preferredIndex: oldIndex)
            reviewStatus = "Unpicked \(changes.count.formatted()) item\(changes.count == 1 ? "" : "s") from \(fixtureLabel)."
        } catch {
            reviewStatus = "Unpick failed: \(userFacingMessage(for: error))"
        }
    }

    func updateReviewTitle(_ value: String) {
        reviewTitle = value
        scheduleReviewMetadataAutosave()
    }

    func updateReviewKeywords(_ value: String) {
        reviewKeywords = value
        scheduleReviewMetadataAutosave()
    }

    func applyReviewAction(_ action: FixtureReviewAction, propagate: Bool = false) async {
        guard !isRunningReview else {
            reviewStatus = "Finish the current Review action first."
            return
        }
        if action != .editMetadata {
            reviewMetadataAutosaveTask?.cancel()
            reviewMetadataAutosaveTask = nil
        }
        let ids = selectedReviewAssetIDs
        guard !ids.isEmpty, let anchor = reviewSelection.focusedID ?? ids.first else {
            reviewStatus = "Select one or more Review items."
            return
        }
        // Approve submits the visible anchor draft in the same audited request.
        // The Owner pipeline resolves every other selected or propagated item
        // from its own active proposal, so one photo's metadata cannot leak
        // across a multi-selection or two-hour propagation scope.
        let approvalDraft = action == .approve ? reviewProposalDrafts[anchor] : nil
        let approvalTitle = action == .approve
            ? (approvalDraft?.title ?? reviewTitle)
            : action == .editMetadata || action == .propagateTitle
                ? reviewTitle
                : nil
        let approvalKeywords = action == .approve
            ? (approvalDraft?.keywords ?? parsedReviewKeywords())
            : action == .editMetadata || action == .propagateKeywords
                ? parsedReviewKeywords()
                : nil
        let oldItems = reviewItems
        let oldIndex = oldItems.firstIndex(where: { $0.id == anchor }) ?? 0
        let historyEntry = ReviewHistoryEntry(
            operationID: "",
            label: reviewActionLabel(action),
            fixtureID: reviewFixtureID,
            mode: reviewMode,
            stateFilters: reviewStateFilters,
            proposalAvailableOnly: reviewProposalAvailableOnly,
            mediaFilters: reviewMediaFilters,
            search: reviewSearch,
            offset: reviewWindowOffset,
            selectedIDs: reviewSelection.selectedIDs,
            anchorID: reviewSelection.anchorID,
            focusedID: reviewSelection.focusedID
        )
        if [.approve, .hide, .requestAI].contains(action) {
            reviewLastAction = action
        }
        isRunningReview = true
        reviewStatus = propagate
            ? "Propagating \(reviewActionLabel(action).lowercased()) through the two-hour shoot window…"
            : "Applying \(reviewActionLabel(action).lowercased())…"
        defer { isRunningReview = false }
        do {
            let result = try await fixtureService.applyReview(
                action,
                fixtureID: reviewFixtureID,
                assetIDs: ids,
                anchorAssetID: anchor,
                propagate: propagate,
                title: approvalTitle,
                keywords: approvalKeywords,
                aiReasons: action == .requestAI ? Array(reviewAIReasons).sorted() : [],
                aiNote: action == .requestAI ? reviewAINote : ""
            )
            if action == .approve || action == .hide {
                reviewAIReasons = []
                reviewAINote = ""
            }
            if [.approve, .hide, .editMetadata].contains(action) {
                ids.forEach {
                    reviewProposalDrafts.removeValue(forKey: $0)
                    reviewProposalConflictIDs.remove($0)
                }
            } else if action == .requestAI {
                ids.forEach {
                    guard var draft = reviewProposalDrafts[$0], draft.isProposal else {
                        return
                    }
                    draft.proposalStatus = "superseded"
                    reviewProposalDrafts[$0] = draft
                }
            }
            if !result.operationID.isEmpty {
                reviewHistory.append(
                    ReviewHistoryEntry(
                        operationID: result.operationID,
                        label: historyEntry.label,
                        fixtureID: historyEntry.fixtureID,
                        mode: historyEntry.mode,
                        stateFilters: historyEntry.stateFilters,
                        proposalAvailableOnly: historyEntry.proposalAvailableOnly,
                        mediaFilters: historyEntry.mediaFilters,
                        search: historyEntry.search,
                        offset: historyEntry.offset,
                        selectedIDs: historyEntry.selectedIDs,
                        anchorID: historyEntry.anchorID,
                        focusedID: historyEntry.focusedID
                    )
                )
            }
            retainReviewResultInCurrentWindow(result, action: action)
            let orderedIDs = reviewItems.map(\.id)
            let replacementID = orderedIDs.contains(anchor)
                ? anchor
                : orderedIDs.indices.contains(oldIndex)
                    ? orderedIDs[oldIndex]
                    : orderedIDs.last
            let retainedSelection = Set(ids).intersection(orderedIDs)
            reviewSelection = OwnerSelectionModel(
                orderedIDs: orderedIDs,
                selectedIDs: retainedSelection.isEmpty
                    ? Set(replacementID.map { [$0] } ?? [])
                    : retainedSelection,
                anchorID: orderedIDs.contains(anchor) ? anchor : replacementID,
                focusedID: orderedIDs.contains(anchor) ? anchor : replacementID
            )
            syncReviewDraft()
            reviewStatus = "\(reviewActionLabel(action)) affected \(result.changes.count.formatted()) item\(result.changes.count == 1 ? "" : "s")."
            await refreshAIStatus()
        } catch {
            reviewStatus = "\(reviewActionLabel(action)) failed: \(error)"
        }
    }

    /// Keep decisions visible for the lifetime of the current Review surface.
    ///
    /// Backfill deliberately excludes approved and hidden items when it is
    /// loaded from Owner. Refreshing immediately after an action therefore
    /// removed the propagation anchor before the user could reuse it. The
    /// action result is authoritative, so apply it to the already-loaded
    /// window and let the next explicit load or panel transition rebuild the
    /// queue from Owner.
    private func retainReviewResultInCurrentWindow(
        _ result: FixtureReviewResult,
        action: FixtureReviewAction
    ) {
        guard var window = fixtureReviewWindow else { return }
        let changesByID = Dictionary(
            uniqueKeysWithValues: result.changes.map { ($0.assetID, $0.after) }
        )
        let updatesTitle = action == .approve
            || action == .editMetadata
            || action == .propagateTitle
        let updatesKeywords = action == .approve
            || action == .editMetadata
            || action == .propagateKeywords
        window.items = window.items.map { current in
            guard let after = changesByID[current.id] else { return current }
            var item = current
            if updatesTitle, let title = after["title"]?.stringValue {
                item.title = title
            }
            if updatesKeywords, let keywords = after["keywords"]?.arrayValue {
                item.keywords = keywords.compactMap(\.stringValue)
            }
            if let editorialState = after["editorialState"]?.stringValue {
                item.editorialState = editorialState
            }
            if let reasons = after["aiReasons"]?.arrayValue {
                item.aiReasons = reasons.compactMap(\.stringValue)
            }
            if let note = after["aiNote"]?.stringValue {
                item.aiNote = note
            }
            switch action {
            case .approve:
                item.editorialState = "approved"
                item.deliveryState = "needs-upload"
                item.aiReasons = []
                item.aiNote = ""
                item.proposalReady = false
            case .hide:
                item.placementState = "hidden"
                item.aiReasons = []
                item.aiNote = ""
                item.proposalReady = false
            case .requestAI:
                item.deliveryState = "not-ready"
                item.proposalReady = false
                item.proposalStatus = "superseded"
            case .returnToReview:
                item.editorialState = "unreviewed"
                item.deliveryState = "not-ready"
            case .editMetadata:
                item.proposalReady = false
            case .propagateTitle, .propagateKeywords:
                break
            }
            return item
        }
        .filter { item in
            let retainsCompletedAction = changesByID[item.id] != nil
                && (action == .approve || action == .hide)
            return reviewItemMatchesActiveFilters(
                item,
                retainingConsumedProposal: retainsCompletedAction
            )
        }
        fixtureReviewWindow = window
    }

    /// Local action retention must honor the same filters as a fresh Owner
    /// Review query. A completed Approve or Hide consumes its proposal, but
    /// remains a session-local propagation anchor when its resulting state is
    /// explicitly visible; the next reload reapplies Proposal Available.
    private func reviewItemMatchesActiveFilters(
        _ item: FixtureReviewItem,
        retainingConsumedProposal: Bool = false
    ) -> Bool {
        let state: FixtureReviewStateFilter
        if item.placementState == "hidden" {
            state = .hidden
        } else if item.editorialState == "approved" {
            state = .approved
        } else {
            state = .picked
        }
        guard reviewStateFilters.contains(state) else { return false }
        guard retainingConsumedProposal || !reviewProposalAvailableOnly || item.proposalReady else {
            return false
        }

        let mediaFilter: CullingMediaFilter = item.mediaType == "video" ? .videos : .photos
        guard reviewMediaFilters.contains(mediaFilter) else { return false }

        let query = reviewSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return true }
        let searchable = ([item.title, item.caption, item.filename] + item.keywords)
            .joined(separator: "\n")
        return searchable.localizedCaseInsensitiveContains(query)
    }

    private func removeUnpickedReviewItems(
        _ ids: Set<String>,
        preferredIndex: Int
    ) {
        guard var window = fixtureReviewWindow else { return }
        let removed = window.items.filter { ids.contains($0.id) }
        window.items.removeAll { ids.contains($0.id) }
        window.summary.total = max(0, window.summary.total - removed.count)
        window.summary.unreviewed = max(
            0,
            window.summary.unreviewed
                - removed.filter { $0.editorialState == "unreviewed" }.count
        )
        window.summary.requestingAI = max(
            0,
            window.summary.requestingAI
                - removed.filter { $0.editorialState == "requesting-ai" }.count
        )
        window.summary.proposed = max(
            0,
            window.summary.proposed
                - removed.filter { $0.editorialState == "proposed" }.count
        )
        window.summary.approved = max(
            0,
            window.summary.approved
                - removed.filter { $0.editorialState == "approved" }.count
        )
        fixtureReviewWindow = window
        let orderedIDs = window.items.map(\.id)
        let replacementID = orderedIDs.indices.contains(preferredIndex)
            ? orderedIDs[preferredIndex]
            : orderedIDs.last
        reviewSelection = OwnerSelectionModel(
            orderedIDs: orderedIDs,
            selectedIDs: Set(replacementID.map { [$0] } ?? []),
            anchorID: replacementID,
            focusedID: replacementID
        )
        reviewScrollTargetID = replacementID
        ids.forEach {
            reviewProposalDrafts.removeValue(forKey: $0)
            reviewProposalConflictIDs.remove($0)
            reviewThumbnails.removeValue(forKey: $0)
        }
        syncReviewDraft()
    }

    func undoLastReviewAction() async {
        guard let entry = reviewHistory.last else {
            reviewStatus = "Nothing to undo in this Backstage session."
            return
        }
        isRunningReview = true
        reviewStatus = "Undoing \(entry.label.lowercased())…"
        defer { isRunningReview = false }
        do {
            if !entry.fixtureChanges.isEmpty {
                let grouped = Dictionary(
                    grouping: entry.fixtureChanges,
                    by: \.beforePlacementState
                )
                for (state, changes) in grouped {
                    _ = try await fixtureService.applyState(
                        state,
                        assetIDs: changes.map(\.assetID),
                        fixtureID: entry.fixtureID,
                        reason: "Undo \(entry.label)"
                    )
                }
                reviewHistory.removeLast()
                reviewFixtureID = entry.fixtureID
                reviewMode = entry.mode
                reviewStateFilters = entry.stateFilters
                reviewProposalAvailableOnly = entry.proposalAvailableOnly
                reviewMediaFilters = entry.mediaFilters
                reviewSearch = entry.search
                reviewWindowOffset = entry.offset
                await loadFixtureReviewWindow(
                    preferredAssetID: entry.focusedID ?? entry.selectedIDs.first
                )
                reviewStatus = "Undid \(entry.label.lowercased()) for \(entry.fixtureChanges.count.formatted()) item\(entry.fixtureChanges.count == 1 ? "" : "s")."
                return
            }
            let result = try await fixtureService.undoReview(
                operationID: entry.operationID
            )
            reviewHistory.removeLast()
            reviewFixtureID = entry.fixtureID
            reviewMode = entry.mode
            reviewStateFilters = entry.stateFilters
            reviewProposalAvailableOnly = entry.proposalAvailableOnly
            reviewMediaFilters = entry.mediaFilters
            reviewSearch = entry.search
            reviewWindowOffset = entry.offset
            let window = try await fixtureService.reviewWindow(
                fixtureID: entry.fixtureID,
                mode: entry.mode,
                stateFilters: entry.stateFilters.map(\.rawValue).sorted(),
                proposalAvailableOnly: entry.proposalAvailableOnly,
                mediaFilters: entry.mediaFilters.map(\.rawValue).sorted(),
                offset: entry.offset,
                limit: reviewWindowLimit,
                search: entry.search
            )
            hydrateReviewProposalDrafts(from: window.items)
            fixtureReviewWindow = window
            let orderedIDs = window.items.map(\.id)
            let restoredSelectedIDs = entry.selectedIDs.intersection(orderedIDs)
            let restoredFocusedID = entry.focusedID.flatMap {
                orderedIDs.contains($0) ? $0 : nil
            } ?? restoredSelectedIDs.first ?? orderedIDs.first
            let restoredAnchorID = entry.anchorID.flatMap {
                orderedIDs.contains($0) ? $0 : nil
            } ?? restoredFocusedID
            reviewSelection = OwnerSelectionModel(
                orderedIDs: orderedIDs,
                selectedIDs: restoredSelectedIDs.isEmpty
                    ? Set(restoredFocusedID.map { [$0] } ?? [])
                    : restoredSelectedIDs,
                anchorID: restoredAnchorID,
                focusedID: restoredFocusedID
            )
            reviewScrollTargetID = restoredFocusedID
            syncReviewDraft()
            reviewStatus = result.alreadyUndone
                ? "The Review action was already undone; the queue was refreshed."
                : "Undid \(entry.label.lowercased()) for \(result.changes.count.formatted()) item\(result.changes.count == 1 ? "" : "s")."
            await refreshAIStatus()
        } catch {
            reviewStatus = "Undo failed: \(error)"
        }
    }

    func saveReviewMetadata() async {
        reviewMetadataAutosaveTask?.cancel()
        reviewMetadataAutosaveTask = nil
        await saveReviewMetadataIfNeeded()
    }

    func propagateReviewTitle() async {
        reviewMetadataAutosaveTask?.cancel()
        reviewMetadataAutosaveTask = nil
        await saveReviewMetadataIfNeeded()
        await applyReviewAction(.propagateTitle, propagate: true)
    }

    func propagateReviewKeywords() async {
        reviewMetadataAutosaveTask?.cancel()
        reviewMetadataAutosaveTask = nil
        await saveReviewMetadataIfNeeded()
        await applyReviewAction(.propagateKeywords, propagate: true)
    }

    func propagateLastReviewAction() async {
        // A local AI draft is the current Review intent even if Approve or
        // Hide was the last completed action. Propagation commits that draft
        // directly to the two-hour cohort without first changing the anchor.
        let action = hasReviewAIDraft ? .requestAI : reviewLastAction
        guard [.approve, .hide, .requestAI].contains(action) else {
            reviewStatus = "Choose Approve or Hide, or prepare an AI draft, before using Propagate."
            return
        }
        await applyReviewAction(action, propagate: true)
    }

    func refreshAIStatus() async {
        do {
            fixtureAIStatus = try await fixtureService.aiStatus()
            guard let status = fixtureAIStatus else { return }
            if let run = status.run, status.active {
                aiProposalStatus = [
                    "\(run.processed.formatted()) of \(run.requested.formatted()) processed",
                    "\(run.proposed.formatted()) proposed",
                    "\(run.failed.formatted()) failed",
                    "\(run.remaining.formatted()) remaining",
                    "\(Int(run.elapsedSeconds).formatted())s elapsed",
                ].joined(separator: " • ")
            } else if status.ready > 0 {
                aiProposalStatus = "\(status.ready.formatted()) new proposal\(status.ready == 1 ? "" : "s") ready."
            } else if status.requested > 0 {
                aiProposalStatus = "\(status.requested.formatted()) requested item\(status.requested == 1 ? "" : "s") waiting for the next AI pass."
            } else {
                aiProposalStatus = "No requested AI work is waiting."
            }
        } catch {
            guard !isTransientCancellation(error) else { return }
            aiProposalStatus = "AI status unavailable: \(error)"
        }
    }

    func runAIProposalPass() async {
        if isRunningAIPass {
            await refreshAIStatus()
            return
        }
        await refreshAIStatus()
        guard (fixtureAIStatus?.requested ?? 0) > 0 else {
            aiProposalStatus = "No requested AI work is waiting."
            return
        }
        isRunningAIPass = true
        aiProposalStatus = "Starting or attaching to the requested AI pass…"
        defer { isRunningAIPass = false }
        do {
            fixtureAIStatus = try await fixtureService.startAIPass()
            repeat {
                try await Task.sleep(for: .seconds(2))
                fixtureAIStatus = try await fixtureService.aiStatus()
                await refreshAIStatus()
            } while fixtureAIStatus?.active == true
            await loadFixtureReviewWindow(preferredAssetID: reviewSelection.focusedID)
        } catch {
            aiProposalStatus = "AI pass failed to start: \(error)"
        }
    }

    func cancelAIProposalPass() async {
        do {
            fixtureAIStatus = try await fixtureService.cancelAIPass()
            aiProposalStatus = "Cancellation requested; the current item may finish first."
        } catch {
            aiProposalStatus = "Could not request cancellation: \(error)"
        }
    }

    func loadAIProposals(replacingConflicts: Bool = false) async {
        preserveCurrentReviewDraft()
        do {
            let proposals = try await fixtureService.aiProposals(includeLoaded: false)
            var loadedProposalIDs: [String] = []
            var conflicts: Set<String> = []
            for proposal in proposals {
                let existing = reviewProposalDrafts[proposal.assetID]
                let hasManualConflict = existing.map { !$0.isProposal } ?? false
                if hasManualConflict, !replacingConflicts {
                    conflicts.insert(proposal.assetID)
                    continue
                }
                reviewProposalDrafts[proposal.assetID] = ReviewMetadataDraft(
                    title: proposal.proposedTitle,
                    keywords: proposal.proposedKeywords,
                    proposalID: proposal.id,
                    proposalReason: proposal.reason,
                    proposalStatus: proposal.status,
                    requestedGeneratorModel: proposal.requestedGeneratorModel,
                    resolvedModel: proposal.resolvedModel,
                    reasoningEffort: proposal.reasoningEffort,
                    vision: proposal.vision
                )
                loadedProposalIDs.append(proposal.id)
            }
            if !loadedProposalIDs.isEmpty {
                _ = try await fixtureService.markAIProposalsLoaded(loadedProposalIDs)
            }
            reviewProposalConflictIDs = conflicts
            syncReviewDraft()
            await refreshAIStatus()
            if conflicts.isEmpty {
                aiProposalStatus = "Loaded \(loadedProposalIDs.count.formatted()) proposal draft\(loadedProposalIDs.count == 1 ? "" : "s"); nothing was approved."
            } else {
                aiProposalStatus = "Loaded \(loadedProposalIDs.count.formatted()) clean draft\(loadedProposalIDs.count == 1 ? "" : "s"). \(conflicts.count.formatted()) conflict\(conflicts.count == 1 ? "" : "s") kept the manual draft."
            }
        } catch {
            aiProposalStatus = "Could not load AI proposals: \(error)"
        }
    }

    func restoreLoadedAIProposalDrafts() async {
        preserveCurrentReviewDraft()
        do {
            let proposals = try await fixtureService.aiProposals(includeLoaded: true)
                .filter { $0.status == "loaded" }
            var restored = 0
            for proposal in proposals where reviewProposalDrafts[proposal.assetID] == nil {
                reviewProposalDrafts[proposal.assetID] = ReviewMetadataDraft(
                    title: proposal.proposedTitle,
                    keywords: proposal.proposedKeywords,
                    proposalID: proposal.id,
                    proposalReason: proposal.reason,
                    proposalStatus: proposal.status,
                    requestedGeneratorModel: proposal.requestedGeneratorModel,
                    resolvedModel: proposal.resolvedModel,
                    reasoningEffort: proposal.reasoningEffort,
                    vision: proposal.vision
                )
                restored += 1
            }
            syncReviewDraft()
            if restored > 0 {
                aiProposalStatus = "Restored \(restored.formatted()) loaded proposal draft\(restored == 1 ? "" : "s"); nothing was approved."
            }
        } catch {
            aiProposalStatus = "Could not restore loaded proposal drafts: \(error)"
        }
    }

    func requestReviewThumbnail(for item: FixtureReviewItem) {
        guard reviewThumbnails[item.id] == nil,
              reviewThumbnailTasks[item.id] == nil
        else { return }
        reviewThumbnailTasks[item.id] = Task { [weak self] in
            guard let self else { return }
            await self.loadReviewThumbnail(for: item)
            self.reviewThumbnailTasks[item.id] = nil
        }
    }

    func loadReviewThumbnail(for item: FixtureReviewItem) async {
        guard reviewThumbnails[item.id] == nil else { return }
        for attempt in 0..<3 {
            guard !Task.isCancelled else { return }
            do {
                let preview = try await photoLibrary.preview(
                    localIdentifier: item.photoLibraryIdentifier,
                    maxPixelSize: 420
                )
                guard let image = NSImage(data: preview.jpegData) else {
                    if attempt < 2 {
                        try? await Task.sleep(for: .milliseconds(180))
                        continue
                    }
                    return
                }
                if reviewThumbnails.count >= 300, let oldest = reviewThumbnails.keys.first {
                    reviewThumbnails.removeValue(forKey: oldest)
                }
                reviewThumbnails[item.id] = image
                return
            } catch {
                guard !Task.isCancelled, attempt < 2 else { return }
                try? await Task.sleep(for: .milliseconds(180 * (attempt + 1)))
            }
        }
    }

    func prepareReviewQuickLookURLs() async -> [URL] {
        let ids = selectedReviewAssetIDs
        guard !ids.isEmpty else {
            reviewStatus = "Select one or more Review items to preview."
            return []
        }
        let directory = FileManager.default.urls(
            for: .cachesDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("com.photosbyelie.backstage/ReviewQuickLook", isDirectory: true)
        isRunningReview = true
        defer { isRunningReview = false }
        do {
            try? FileManager.default.removeItem(at: directory)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var urls: [URL] = []
            for id in ids {
                guard let item = reviewItems.first(where: { $0.id == id }) else { continue }
                if item.mediaType == "video" {
                    urls.append(try await photoLibrary.exportOriginal(
                        localIdentifier: item.photoLibraryIdentifier,
                        to: directory
                    ).destination)
                } else {
                    let preview = try await photoLibrary.preview(
                        localIdentifier: item.photoLibraryIdentifier,
                        maxPixelSize: 4_000
                    )
                    let destination = directory
                        .appendingPathComponent(id.replacingOccurrences(of: "/", with: "_"))
                        .appendingPathExtension("jpg")
                    try preview.jpegData.write(to: destination, options: .atomic)
                    urls.append(destination)
                }
            }
            reviewStatus = "Prepared \(urls.count.formatted()) private Quick Look item\(urls.count == 1 ? "" : "s")."
            return urls
        } catch {
            reviewStatus = userFacingMessage(for: error)
            return []
        }
    }

    private func syncReviewDraft() {
        guard let item = focusedReviewItem else {
            clearReviewDraft()
            return
        }
        let draft = reviewProposalDrafts[item.id]
        reviewTitle = draft?.title ?? item.title
        reviewKeywords = (draft?.keywords ?? item.keywords).joined(separator: ", ")
        let hasActiveAIRequest = item.editorialState == "requesting-ai"
        reviewAIReasons = hasActiveAIRequest ? Set(item.aiReasons) : []
        reviewAINote = hasActiveAIRequest ? item.aiNote : ""
        if hasActiveAIRequest {
            reviewLastAction = .requestAI
        } else if item.placementState == "hidden" {
            reviewLastAction = .hide
        } else if item.editorialState == "approved" {
            reviewLastAction = .approve
        }
    }

    /// Make durable ready/loaded proposal metadata visible without changing
    /// the proposal's audit status. Explicit "Load proposals" remains the
    /// transition that marks a ready proposal as loaded.
    private func hydrateReviewProposalDrafts(from items: [FixtureReviewItem]) {
        for item in items
        where item.proposalContextAvailable && !item.proposalID.isEmpty {
            if let existing = reviewProposalDrafts[item.id] {
                if existing.proposalID == item.proposalID {
                    var refreshed = existing
                    refreshed.proposalStatus = item.proposalStatus
                    refreshed.requestedGeneratorModel = item.requestedGeneratorModel
                    refreshed.resolvedModel = item.resolvedModel
                    refreshed.reasoningEffort = item.reasoningEffort
                    refreshed.vision = item.vision
                    reviewProposalDrafts[item.id] = refreshed
                    continue
                }
                if !existing.isProposal {
                    continue
                }
            }
            reviewProposalDrafts[item.id] = ReviewMetadataDraft(
                title: item.proposedTitle,
                keywords: item.proposedKeywords,
                proposalID: item.proposalID,
                proposalReason: item.proposalReason,
                proposalStatus: item.proposalStatus,
                requestedGeneratorModel: item.requestedGeneratorModel,
                resolvedModel: item.resolvedModel,
                reasoningEffort: item.reasoningEffort,
                vision: item.vision
            )
        }
    }

    private func clearReviewDraft() {
        reviewTitle = ""
        reviewKeywords = ""
        reviewAIReasons = []
        reviewAINote = ""
    }

    private func preserveCurrentReviewDraft() {
        guard let item = focusedReviewItem else { return }
        let title = reviewTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let keywords = parsedReviewKeywords()
        if let existing = reviewProposalDrafts[item.id], existing.isProposal {
            reviewProposalDrafts[item.id] = ReviewMetadataDraft(
                title: title,
                keywords: keywords,
                proposalID: existing.proposalID,
                proposalReason: existing.proposalReason,
                proposalStatus: existing.proposalStatus,
                requestedGeneratorModel: existing.requestedGeneratorModel,
                resolvedModel: existing.resolvedModel,
                reasoningEffort: existing.reasoningEffort,
                vision: existing.vision
            )
        } else if title != item.title || keywords != item.keywords {
            reviewProposalDrafts[item.id] = ReviewMetadataDraft(
                title: title,
                keywords: keywords
            )
        } else {
            reviewProposalDrafts.removeValue(forKey: item.id)
        }
    }

    private func scheduleReviewMetadataAutosave() {
        preserveCurrentReviewDraft()
        reviewMetadataAutosaveTask?.cancel()
        guard let assetID = focusedReviewItem?.id else { return }
        reviewMetadataAutosaveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self else { return }
            guard self.focusedReviewItem?.id == assetID else { return }
            if self.isRunningReview {
                self.scheduleReviewMetadataAutosave()
                return
            }
            await self.saveReviewMetadataIfNeeded()
        }
    }

    private func saveReviewMetadataIfNeeded() async {
        guard let item = focusedReviewItem else { return }
        let title = reviewTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let keywords = parsedReviewKeywords()
        guard title != item.title || keywords != item.keywords else { return }
        await applyReviewAction(.editMetadata)
    }

    private func parsedReviewKeywords() -> [String] {
        reviewKeywords
            .split(whereSeparator: { $0 == "," || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func reviewActionLabel(_ action: FixtureReviewAction) -> String {
        switch action {
        case .approve: "Approve"
        case .returnToReview: "Return to Review"
        case .hide: "Hide"
        case .requestAI:
            reviewAIReasons.isEmpty && reviewAINote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "Clear AI request"
                : "Request AI"
        case .editMetadata: "Save title and keywords"
        case .propagateTitle: "Propagate title"
        case .propagateKeywords: "Propagate keywords"
        }
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
            cullingStatus = userFacingMessage(for: error)
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
            cullingStatus = userFacingMessage(for: error)
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
            cullingStatus = userFacingMessage(for: error)
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
        let focusedBefore = cullingSelection.focusedID ?? ids.last
        let previousStates = ids.map { ($0, cullingStates[$0]) }
        for id in ids {
            var decision = cullingStates[id] ?? SidecarDecisionState(assetId: id)
            decision.pickState = state.rawValue
            cullingStates[id] = decision
        }
        let visibleIDs = visibleCullingAssets.map(\.id)
        if let focusedBefore {
            _ = cullingSelection.replaceItems(
                visibleIDs,
                selectingSuccessorAfterRemoving: focusedBefore
            )
        } else {
            cullingSelection.replaceItems(visibleIDs)
        }
        selectedPhotoIDs = cullingSelection.selectedIDs
        if focusedCullingAssetID == nil {
            photoPreview = nil
        } else if focusedCullingAssetID != focusedBefore {
            Task { [weak self] in
                await self?.loadPreview()
            }
        }
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
            for change in changes {
                var decision = cullingStates[change.assetID]
                    ?? SidecarDecisionState(assetId: change.assetID)
                decision.pickState = change.placementState.rawValue
                cullingStates[change.assetID] = decision
            }
            cullingHistory.append(CullingHistoryEntry(
                label: label,
                fixtureChanges: changes,
                selectedIDs: selectedBefore
            ))
            if cullingPool == nil {
                scheduleFixtureCullingBackfill()
            } else {
                replaceCullingItems()
            }
            cullingStatus = "\(label) saved for \(changes.count) fixture item\(changes.count == 1 ? "" : "s")."
        } catch {
            for (id, previousState) in previousStates {
                if let previousState {
                    cullingStates[id] = previousState
                } else {
                    cullingStates.removeValue(forKey: id)
                }
            }
            replaceCullingItems()
            let visibleIDs = visibleCullingAssets.map(\.id)
            let restoredSelection = selectedBefore.intersection(Set(visibleIDs))
            cullingSelection = OwnerSelectionModel(
                orderedIDs: visibleIDs,
                selectedIDs: restoredSelection,
                anchorID: restoredSelection.first,
                focusedID: restoredSelection.first
            )
            selectedPhotoIDs = restoredSelection
            if focusedCullingAssetID != focusedBefore {
                Task { [weak self] in
                    await self?.loadPreview()
                }
            }
            cullingStatus = userFacingMessage(for: error)
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
            metadataReviewStatus = userFacingMessage(for: error)
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
            metadataReviewStatus = userFacingMessage(for: error)
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
            metadataReviewStatus = userFacingMessage(for: error)
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
            metadataReviewStatus = "Undo failed; the history entry was retained. \(userFacingMessage(for: error))"
        }
    }

    func loadMetadataProposals() async {
        do {
            let queue = try await metadataReviewService.proposals()
            if let loaded = queue.modelLadder, !loaded.isEmpty {
                metadataModelLadder = loaded
            }
            metadataProposals = queue.photos
            metadataProposalStatus = "\(queue.photos.count) pending proposal\(queue.photos.count == 1 ? "" : "s") loaded from Owner.sqlite."
            metadataModelLadderStatus = "Saved ladder loaded: \(metadataModelLadder.map(\.label).joined(separator: " → "))."
        } catch {
            metadataProposalStatus = userFacingMessage(for: error)
        }
    }

    func saveMetadataModelLadder() async {
        if let validation = metadataModelLadderValidation {
            metadataModelLadderStatus = validation
            return
        }
        isSavingMetadataModelLadder = true
        defer { isSavingMetadataModelLadder = false }
        do {
            let change = try await metadataReviewService.replaceModelLadderDetailed(metadataModelLadder)
            if !change.after.isEmpty {
                metadataModelLadder = change.after
            }
            metadataModelLadderStatus = "Saved \(metadataModelLadder.map(\.label).joined(separator: " → ")) through audited action \(change.actionID)."
        } catch {
            metadataModelLadderStatus = String(describing: error)
        }
    }

    var metadataModelLadderValidation: String? {
        metadataReviewService.validateModelLadder(metadataModelLadder)
    }

    func addMetadataModelRung() {
        metadataModelLadder.append(MetadataModelLadderRung(model: "gpt-5.6-sol", effort: "high"))
    }

    func removeMetadataModelRung(at index: Int) {
        guard metadataModelLadder.indices.contains(index) else { return }
        metadataModelLadder.remove(at: index)
    }

    func moveMetadataModelRung(at index: Int, offset: Int) {
        guard metadataModelLadder.indices.contains(index) else { return }
        let destination = index + offset
        guard metadataModelLadder.indices.contains(destination) else { return }
        metadataModelLadder.swapAt(index, destination)
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
            metadataProposalStatus = userFacingMessage(for: error)
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
        lifecycleStatus = "Loading the private lifecycle ledger…"
        defer { isRunningLifecycle = false }
        do {
            let ledger = try await lifecycleService.ledger()
            lifecycleItems = ledger.items
            selectedLifecycleIDs.formIntersection(Set(ledger.items.map(\.id)))
            lifecycleStatus = "\(ledger.hiddenCount) recoverable and \(ledger.discardedCount) permanently discarded item\(ledger.items.count == 1 ? "" : "s")."
        } catch {
            lifecycleStatus = userFacingMessage(for: error)
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
            lifecycleStatus = userFacingMessage(for: error)
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
            lifecycleStatus = userFacingMessage(for: error)
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
            deliveryStatus = userFacingMessage(for: error)
        }
    }

    func loadNativeUploadPlan() async {
        guard !selectedFixtureID.isEmpty else {
            nativeUploadPlan = nil
            nativeUploadStatus = "Choose a fixture to load its approved publication queue."
            return
        }
        isRunningDelivery = true
        nativeUploadStatus = "Loading approved publication eligibility…"
        defer { isRunningDelivery = false }
        do {
            let plan = try await deliveryService.nativeUploadPlan(
                fixtureID: selectedFixtureID,
                limit: 200
            )
            nativeUploadPlan = plan
            selectedDeliveryIDs.formIntersection(Set(plan.items.map(\.id)))
            if !plan.cloudAllowed {
                nativeUploadStatus = "\(plan.fixtureName) policy does not permit cloud publication."
            } else if plan.needsUploadCount == 0 {
                nativeUploadStatus = "\(plan.approvedCount) approved • \(plan.liveCount) live • \(plan.needsReviewCount) picked awaiting Review • nothing needs upload."
            } else {
                nativeUploadStatus = "\(plan.needsUploadCount) approved need upload • \(plan.liveCount) live • \(plan.needsReviewCount) picked awaiting Review. Showing \(plan.items.count) oldest eligible."
            }
        } catch {
            nativeUploadPlan = nil
            nativeUploadStatus = userFacingMessage(for: error)
        }
    }

    func loadNativeUploadThumbnail(for item: NativeUploadPlanItem) async {
        guard nativeUploadThumbnails[item.id] == nil else { return }
        do {
            let preview = try await photoLibrary.preview(
                localIdentifier: item.photoLibraryIdentifier,
                maxPixelSize: 100
            )
            guard let image = NSImage(data: preview.jpegData) else { return }
            if nativeUploadThumbnails.count >= 300,
               let oldest = nativeUploadThumbnails.keys.first {
                nativeUploadThumbnails.removeValue(forKey: oldest)
            }
            nativeUploadThumbnails[item.id] = image
        } catch {
            // Publication eligibility must remain usable when a Photos preview
            // is unavailable or still downloading from iCloud.
        }
    }

    func loadNativeUploadPreview(for item: NativeUploadPlanItem) async {
        if nativeUploadPreviewItemID == item.id, nativeUploadPreviewImage != nil {
            return
        }
        nativeUploadPreviewItemID = item.id
        nativeUploadPreviewImage = nil
        do {
            let preview = try await photoLibrary.preview(
                localIdentifier: item.photoLibraryIdentifier,
                maxPixelSize: 1_600
            )
            guard nativeUploadPreviewItemID == item.id else { return }
            nativeUploadPreviewImage = NSImage(data: preview.jpegData)
        } catch {
            nativeUploadStatus = "The preview could not be prepared. The approved upload item is unchanged."
        }
    }

    func clearNativeUploadPreview() {
        nativeUploadPreviewItemID = ""
        nativeUploadPreviewImage = nil
    }

    func returnSelectedUploadsToReview() async {
        guard !isRunningDelivery else { return }
        let ids = Array(selectedDeliveryIDs).sorted()
        guard !selectedFixtureID.isEmpty, let anchor = ids.first else {
            nativeUploadStatus = "Select one or more approved items first."
            return
        }
        isRunningDelivery = true
        nativeUploadStatus = "Returning \(ids.count.formatted()) approved item\(ids.count == 1 ? "" : "s") to Review…"
        defer { isRunningDelivery = false }
        do {
            let result = try await fixtureService.applyReview(
                .returnToReview,
                fixtureID: selectedFixtureID,
                assetIDs: ids,
                anchorAssetID: anchor
            )
            let returnedIDs = Set(result.changes.map(\.assetID))
            selectedDeliveryIDs.subtract(returnedIDs)
            for id in returnedIDs {
                nativeUploadThumbnails.removeValue(forKey: id)
            }
            if let current = nativeUploadPlan {
                nativeUploadPlan = NativeUploadPlan(
                    fixtureID: current.fixtureID,
                    fixtureName: current.fixtureName,
                    cloudAllowed: current.cloudAllowed,
                    pickedCount: current.pickedCount,
                    approvedCount: max(0, current.approvedCount - returnedIDs.count),
                    needsReviewCount: current.needsReviewCount + returnedIDs.count,
                    needsUploadCount: max(0, current.needsUploadCount - returnedIDs.count),
                    liveCount: current.liveCount,
                    offset: current.offset,
                    limit: current.limit,
                    hasNext: current.hasNext,
                    items: current.items.filter { !returnedIDs.contains($0.id) }
                )
            }
            nativeUploadStatus = "Returned \(returnedIDs.count.formatted()) item\(returnedIDs.count == 1 ? "" : "s") to Review. Their fixture picks and metadata were preserved."
        } catch {
            nativeUploadStatus = "Return to Review failed: \(userFacingMessage(for: error))"
        }
    }

    func hideSelectedUploads() async {
        guard !isRunningDelivery else { return }
        let ids = Array(selectedDeliveryIDs).sorted()
        guard !selectedFixtureID.isEmpty, let anchor = ids.first else {
            nativeUploadStatus = "Select one or more approved items first."
            return
        }
        isRunningDelivery = true
        nativeUploadStatus = "Hiding \(ids.count.formatted()) approved item\(ids.count == 1 ? "" : "s")…"
        defer { isRunningDelivery = false }
        do {
            let result = try await fixtureService.applyReview(
                .hide,
                fixtureID: selectedFixtureID,
                assetIDs: ids,
                anchorAssetID: anchor
            )
            let hiddenIDs = Set(result.changes.map(\.assetID))
            selectedDeliveryIDs.subtract(hiddenIDs)
            for id in hiddenIDs {
                nativeUploadThumbnails.removeValue(forKey: id)
            }
            if nativeUploadPreviewItemID.isEmpty == false,
               hiddenIDs.contains(nativeUploadPreviewItemID) {
                clearNativeUploadPreview()
            }
            if let current = nativeUploadPlan {
                nativeUploadPlan = NativeUploadPlan(
                    fixtureID: current.fixtureID,
                    fixtureName: current.fixtureName,
                    cloudAllowed: current.cloudAllowed,
                    pickedCount: max(0, current.pickedCount - hiddenIDs.count),
                    approvedCount: max(0, current.approvedCount - hiddenIDs.count),
                    needsReviewCount: current.needsReviewCount,
                    needsUploadCount: max(0, current.needsUploadCount - hiddenIDs.count),
                    liveCount: current.liveCount,
                    offset: current.offset,
                    limit: current.limit,
                    hasNext: current.hasNext,
                    items: current.items.filter { !hiddenIDs.contains($0.id) }
                )
            }
            nativeUploadStatus = "Hid \(hiddenIDs.count.formatted()) item\(hiddenIDs.count == 1 ? "" : "s"). Their rows were removed from this upload queue."
        } catch {
            nativeUploadStatus = "Hide failed: \(userFacingMessage(for: error))"
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
            uploadRecoveryStatus = userFacingMessage(for: error)
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
            uploadRecoveryStatus = userFacingMessage(for: error)
        }
    }

    func deliverSelected() async {
        await deliver(ids: Array(selectedDeliveryIDs).sorted())
    }

    func publishSelectedNatively() async {
        await startNativePublication(assetIDs: Array(selectedDeliveryIDs).sorted())
    }

    func publishVisibleNativeWindow() async {
        let ids = nativeUploadPlan?.items.map(\.assetID) ?? []
        guard !ids.isEmpty else {
            nativeUploadStatus = "No approved assets in this fixture currently need upload."
            return
        }
        await startNativePublication(assetIDs: ids)
    }

    func syncPhotosIncrementally(limit: Int = 25) async {
        guard !isSyncingPhotos else { return }
        guard authentication.phase == .authenticated else { return }
        isSyncingPhotos = true
        defer { isSyncingPhotos = false }
        do {
            let report = try await deliveryService.syncPhotos(limit: limit)
            photosSyncReport = report
            if report.attached {
                photosSyncStatus = "An Apple Photos sync pass is already running."
            } else {
                photosSyncStatus = "Scanned \(report.scanned) of \(report.requested) in \(report.elapsedSeconds.formatted(.number.precision(.fractionLength(1))))s: \(report.metadataOnly) metadata, \(report.appearance) appearance, \(report.sourceMissing) missing, \(report.failed) failed."
            }
        } catch {
            photosSyncStatus = userFacingMessage(for: error)
        }
    }

    func runPhotosSyncLoop() async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(for: .seconds(15 * 60))
            } catch {
                return
            }
            await syncPhotosIncrementally()
        }
    }

    private func startNativePublication(assetIDs: [String]) async {
        guard !isRunningDelivery else { return }
        var seen = Set<String>()
        let ids = assetIDs.filter { !$0.isEmpty && seen.insert($0).inserted }
        guard !ids.isEmpty else {
            nativeUploadStatus = "No approved assets currently need upload."
            return
        }
        let batches = stride(from: 0, to: ids.count, by: 50).map {
            Array(ids[$0..<min($0 + 50, ids.count)])
        }
        isRunningDelivery = true
        isRunningNativePublication = true
        nativeUploadRun = nil
        nativePublicationBatchNumber = 0
        nativePublicationBatchCount = batches.count
        defer {
            isRunningNativePublication = false
            nativePublicationBatchNumber = 0
            nativePublicationBatchCount = 0
            isRunningDelivery = false
        }
        var totalRequested = 0
        var totalProcessed = 0
        var totalLive = 0
        var totalFailed = 0
        var totalCatalogPending = 0
        var totalCatalogFailed = 0
        var attemptedIDs = Set<String>()
        var successfulIDs = Set<String>()
        var failedIDs = Set<String>()
        do {
            for (batchIndex, batch) in batches.enumerated() {
                nativePublicationBatchNumber = batchIndex + 1
                var run = try await deliveryService.startNativeUpload(
                    assetIDs: batch,
                    limit: batch.count,
                    concurrency: 4
                )
                attemptedIDs.formUnion(batch)
                nativeUploadRun = run
                totalRequested += run.requested
                if run.requested == 0 { continue }
                nativeUploadStatus = "Publishing shown queue • batch \(batchIndex + 1) of \(batches.count) • \(totalProcessed) of \(ids.count) processed."
                while !run.isFinished {
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                    run = try await deliveryService.nativeUploadStatus(runID: run.runID)
                    nativeUploadRun = run
                    nativeUploadStatus = "Publishing shown queue • batch \(batchIndex + 1) of \(batches.count) • \(totalProcessed + run.processed) of \(ids.count) processed • \(totalLive + run.live) live • \(totalFailed + run.failed) failed."
                }
                totalProcessed += run.processed
                totalLive += run.live
                totalFailed += run.failed
                totalCatalogPending += run.items.lazy.filter {
                    $0.status == "verified" && ["pending", "local"].contains($0.catalogState)
                }.count
                totalCatalogFailed += run.items.lazy.filter {
                    $0.status == "verified" && $0.catalogState == "failed"
                }.count
                successfulIDs.formUnion(
                    run.items.lazy.filter { ["verified", "live"].contains($0.status) }.map(\.assetID)
                )
                failedIDs.formUnion(
                    run.items.lazy.filter { $0.status == "failed" }.map(\.assetID)
                )
            }
            let skipped = max(0, ids.count - totalRequested)
            let checksumVerified = totalLive + totalCatalogPending + totalCatalogFailed
            let completion = "Uploaded and checksum-verified \(checksumVerified) asset\(checksumVerified == 1 ? "" : "s"); \(totalLive) live on the public site."
                + (totalCatalogPending > 0
                    ? " \(totalCatalogPending) await catalog deployment and live verification."
                    : "")
                + (totalCatalogFailed > 0
                    ? " \(totalCatalogFailed) failed catalog verification and can retry without re-uploading."
                    : "")
                + (totalFailed > 0
                    ? " \(totalFailed) upload\(totalFailed == 1 ? "" : "s") failed and remain independently retryable."
                    : "")
            await preserveNativeUploadTray(
                afterAttempting: attemptedIDs,
                successfulIDs: successfulIDs,
                failedIDs: failedIDs
            )
            nativeUploadStatus = completion
                + (skipped > 0 ? " \(skipped) changed eligibility before publication and were skipped safely." : "")
                + (failedIDs.isEmpty
                    ? " This batch is complete; load the next 200 when ready."
                    : " Failed items remain in this tray for retry.")
                + " Give Back completed for approved metadata."
        } catch {
            if !attemptedIDs.isEmpty {
                await preserveNativeUploadTray(
                    afterAttempting: attemptedIDs,
                    successfulIDs: successfulIDs,
                    failedIDs: failedIDs
                )
            }
            nativeUploadStatus = (totalProcessed > 0
                ? "Published \(totalLive) before the run stopped; \(totalFailed) failed. "
                : "")
                + userFacingMessage(for: error)
        }
    }

    private func preserveNativeUploadTray(
        afterAttempting attemptedIDs: Set<String>,
        successfulIDs: Set<String>,
        failedIDs: Set<String>
    ) async {
        guard let current = nativeUploadPlan else { return }
        let retainedItems = current.items.filter {
            !attemptedIDs.contains($0.assetID) || failedIDs.contains($0.assetID)
        }
        let retainedIDs = Set(retainedItems.map(\.assetID))
        selectedDeliveryIDs.formIntersection(retainedIDs)
        for id in attemptedIDs.subtracting(failedIDs) {
            nativeUploadThumbnails.removeValue(forKey: id)
        }
        if !nativeUploadPreviewItemID.isEmpty,
           !retainedIDs.contains(nativeUploadPreviewItemID) {
            clearNativeUploadPreview()
        }

        do {
            let summary = try await deliveryService.nativeUploadPlan(
                fixtureID: selectedFixtureID,
                limit: 200
            )
            nativeUploadPlan = NativeUploadPlan(
                fixtureID: summary.fixtureID,
                fixtureName: summary.fixtureName,
                cloudAllowed: summary.cloudAllowed,
                pickedCount: summary.pickedCount,
                approvedCount: summary.approvedCount,
                needsReviewCount: summary.needsReviewCount,
                needsUploadCount: summary.needsUploadCount,
                liveCount: summary.liveCount,
                offset: current.offset,
                limit: current.limit,
                hasNext: summary.hasNext,
                items: retainedItems
            )
        } catch {
            let removedCount = max(0, attemptedIDs.count - failedIDs.count)
            nativeUploadPlan = NativeUploadPlan(
                fixtureID: current.fixtureID,
                fixtureName: current.fixtureName,
                cloudAllowed: current.cloudAllowed,
                pickedCount: current.pickedCount,
                approvedCount: current.approvedCount,
                needsReviewCount: current.needsReviewCount,
                needsUploadCount: max(0, current.needsUploadCount - removedCount),
                liveCount: current.liveCount + successfulIDs.count,
                offset: current.offset,
                limit: current.limit,
                hasNext: current.hasNext,
                items: retainedItems
            )
        }
    }

    func previewR2Reconciliation() async {
        await runR2Reconciliation(commit: false)
    }

    func commitR2Reconciliation() async {
        await runR2Reconciliation(commit: true)
    }

    private func runR2Reconciliation(commit: Bool) async {
        isRunningDelivery = true
        defer { isRunningDelivery = false }
        do {
            let report = try await deliveryService.r2Reconciliation(commit: commit)
            r2Reconciliation = report
            r2ReconciliationStatus = commit
                ? "Reconciled \(report.scanned): \(report.protected) sale-protected, \(report.quarantined) quarantined, \(report.restored) restored, \(report.deleted) deleted after the second pass."
                : "Previewed \(report.scanned): \(report.protected) sale-protected, \(report.quarantined) would enter quarantine, \(report.eligibleDelete) eligible after a prior 30-day pass."
        } catch {
            r2ReconciliationStatus = userFacingMessage(for: error)
        }
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
            deliveryStatus = userFacingMessage(for: error)
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
            deliveryStatus = userFacingMessage(for: error)
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
            deliveryStatus = userFacingMessage(for: error)
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
            publicationStatus = userFacingMessage(for: error)
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
            publicationStatus = userFacingMessage(for: error)
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
            guard !(error is CancellationError), !Task.isCancelled else { return }
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

    private func isTransientCancellation(_ error: Error) -> Bool {
        if error is CancellationError || Task.isCancelled {
            return true
        }
        let cocoaError = error as NSError
        return cocoaError.domain == NSURLErrorDomain
            && cocoaError.code == NSURLErrorCancelled
    }

    private func userFacingMessage(for error: Error) -> String {
        if let envelope = error as? APIErrorEnvelope {
            if envelope.error.code == "google_login_required" {
                return "Backstage could not renew this Mac's Owner session. Open Overview and enroll this Mac again."
            }
            return envelope.error.message
        }
        if let ownerActionError = error as? OwnerActionRunError {
            let message = ownerActionError.localizedDescription
            if message.localizedCaseInsensitiveContains("database is locked") {
                return "The Owner index is busy with another sync. Backstage kept the current view; try again after the sync finishes."
            }
            return message
        }
        let message = error.localizedDescription
        if message.localizedCaseInsensitiveContains("database is locked") {
            return "The Owner index is busy with another sync. Backstage kept the current view; try again after the sync finishes."
        }
        return message
    }

    private func runMetadata(commit: Bool) async {
        let fixture = fixtureID.trimmingCharacters(in: .whitespacesAndNewlines)
        isRunningMetadata = true
        defer { isRunningMetadata = false }
        do {
            let report = try await (commit
                ? metadataService.commit(fixtureID: fixture)
                : metadataService.plan(fixtureID: fixture))
            metadataReport = report
            metadataStatus = reportStatus(report)
        } catch {
            metadataStatus = userFacingMessage(for: error)
        }
    }

    private func reportStatus(_ report: MetadataGiveBackReport) -> String {
        if report.isDryRun {
            return "\(report.readyCount) ready; \(report.blocked.count) blocked. Photos is unchanged."
        }
        return "\(report.verifiedCount) written and re-read as verified; \(report.failed.count) failed; \(report.blocked.count) blocked."
    }

    private func photoLibraryIdentifier(for assetID: String) -> String {
        if let identifier = fixtureReviewWindow?.items
            .first(where: { $0.id == assetID })?
            .photoLibraryIdentifier,
           !identifier.isEmpty {
            return identifier
        }
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
