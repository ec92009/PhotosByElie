import AppKit
import Foundation
import OwnerCore

private enum ActivityRefreshError: Error {
    case timedOut
}

struct CullingHistoryEntry: Identifiable, Sendable {
    var id = UUID()
    var label: String
    var changes: [SidecarDecisionChange] = []
    var fixtureChanges: [FixtureAssetState] = []
    var wasteBasketMediaIDs: [String] = []
    var wasteBasketActionID: String = ""
    var reviewOperationID: String = ""
    var fixtureID: String = ""
    var windowOffset: Int = 0
    var selectedIDs: Set<String>
    var anchorID: String?
    var focusedID: String?
    var cullingItems: [FixtureAsset] = []
    var cullingItemIndexes: [String: Int] = [:]
    var orderedIDs: [String] = []
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
    var country: String = ""
    var title: String
    var keywords: [String]
    var proposalID: String = ""
    var hasManualEdits: Bool = false
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
    var wasteBasketMediaIDs: [String] = []
    var wasteBasketActionID: String = ""
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
    var reviewItems: [FixtureReviewItem] = []
    var reviewItemIndexes: [String: Int] = [:]
}

enum CullingThumbnailFailure: Equatable, Sendable {
    case photosAccess
    case assetUnavailable
    case previewUnavailable
    case timedOut

    init(error: Error) {
        guard let photoError = error as? PhotoLibraryError else {
            self = .previewUnavailable
            return
        }
        switch photoError {
        case .accessDenied:
            self = .photosAccess
        case .assetNotFound, .unsupportedMediaType:
            self = .assetUnavailable
        case .resourceNotFound, .previewUnavailable, .exportFailed, .metadataFailed:
            self = .previewUnavailable
        }
    }

    var title: String {
        switch self {
        case .photosAccess: "Photos access needed"
        case .assetUnavailable: "Photo unavailable"
        case .previewUnavailable: "Preview unavailable"
        case .timedOut: "Preview timed out"
        }
    }

    var detail: String {
        switch self {
        case .photosAccess:
            "Choose Allow Photos or grant Full Access in System Settings."
        case .assetUnavailable:
            "This asset is not in the current Photos library. Retry after Photos sync completes."
        case .previewUnavailable:
            "Photos could not prepare this preview. Retry after a transient or iCloud download failure."
        case .timedOut:
            "Photos took too long to prepare this preview. Retry this card or open Quick Look."
        }
    }

    var systemImage: String {
        switch self {
        case .photosAccess: "lock.shield"
        case .assetUnavailable, .previewUnavailable, .timedOut: "photo.badge.exclamationmark"
        }
    }

    var actionTitle: String {
        self == .photosAccess ? "Allow Photos" : "Retry"
    }

    var offersPhotosAccess: Bool {
        self == .photosAccess
    }
}

enum GallerySavedView: String, CaseIterable, Identifiable {
    case allAssets = "All fixture assets"
    case culling = "Culling — Undecided"
    case reviewQueue = "Review queue"
    case approved = "Approved"
    case uploadQueue = "Upload queue"
    case live = "Live"
    case hidden = "Hidden"
    case unavailable = "Unavailable"

    var id: String { rawValue }
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
        case updates = "Updates"
        var id: String { rawValue }

        var title: String {
            self == .culling ? "Gallery" : rawValue
        }
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
    @Published private(set) var isOpeningCustomerPhoto = false
    @Published private(set) var customerPhotoStatus = ""
    @Published var authentication = OwnerAuthenticationSnapshot(phase: .needsEnrollment)
    @Published var enrollmentCode = ""
    @Published var authenticationStatus = "Checking this Mac's Keychain session…"
    @Published var isAuthenticating = false
    @Published private(set) var isSettingUpThisMac = false
    @Published private(set) var enrolledOwnerDevices: [OwnerDevice] = []
    @Published private(set) var ownerDeviceManagementStatus = "Enrolled Macs have not been refreshed."
    @Published private(set) var isRefreshingOwnerDevices = false
    @Published private(set) var pendingOwnerDeviceRevocation: OwnerDevice?
    @Published var photoAccess: PhotoLibraryAccess
    @Published var libraryItems: [PhotoLibraryItem] = []
    @Published var selectedPhotoIDs: Set<String> = []
    @Published var photoPreview: PhotoPreview?
    @Published var photoStatus = "Photo library not loaded."
    @Published var isLoadingPhotos = false
    @Published var isReconcilingPhotosIndex = false
    @Published var metadataReport: MetadataGiveBackReport?
    @Published var metadataStatus = "Preview approved global metadata before writing it to Photos."
    @Published var isRunningMetadata = false
    @Published private(set) var metadataGiveBackPlannedAssetIDs: [String]?
    @Published private(set) var fixtures: [FixtureNode] = []
    @Published private(set) var selectedFixtureID = ""
    @Published private(set) var selectedFixtureBreadcrumb = ""
    @Published private(set) var fixtureSelectionAvailability: FixtureSelectionAvailability = .loading
    @Published private(set) var fixtureSelectionNotice: String?
    @Published private(set) var pbeOwnerFixtureSession: PBEOwnerFixtureSession?
    @Published private(set) var pbeOwnerSessionStatus = "Choose a fixture, then open PBE Owner from Backstage."
    @Published private(set) var isLaunchingPBEOwner = false
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
    @Published var fixtureCullingWindow: FixtureCullingWindow?
    @Published private(set) var fixtureCullingMediaAvailability: FixtureCullingMediaAvailability?
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
    @Published var cullingScrollTargetID: String?
    @Published var cullingStates: [String: SidecarDecisionState] = [:]
    @Published var cullingHistory: [CullingHistoryEntry] = []
    @Published var cullingStatus = "Select indexed Photos and apply a culling decision."
    @Published var cullingSearch = ""
    @Published var cullingMediaFilters: Set<CullingMediaFilter> = [.photos]
    @Published var cullingRatingFilters = Set(0...5)
    @Published var cullingColorFilters = Set(CullingColorFilter.selectableCases)
    @Published var galleryEditorialFilters: Set<GalleryEditorialFilter> = []
    @Published var galleryDeliveryFilters: Set<GalleryDeliveryFilter> = []
    @Published var gallerySourceFilters: Set<GallerySourceFilter> = [.available]
    @Published var galleryBurstsOnly = false
    @Published var cullingWindowOffset = 0
    @Published var cullingWindowLimit = 200
    @Published var cullingThumbnails: [String: NSImage] = [:]
    @Published var cullingThumbnailFailures: [String: CullingThumbnailFailure] = [:]
    @Published private(set) var currentImageByteCounts: [String: Int64] = [:]
    @Published var isLoadingPreview = false
    @Published var isLoadingCullingDecisions = false
    @Published var cullingDecisionProgress = 0
    @Published var cullingDecisionTotal = 0
    @Published var isApplyingCullingDecision = false
    @Published private(set) var cullingWasteBasketQueueing = false
    @Published private(set) var cullingWasteBasketPendingActionID: String?
    @Published private(set) var cullingWasteBasketPendingAction: OwnerAction?
    @Published private(set) var cullingWasteBasketPendingActionIDs: Set<String> = []
    @Published private(set) var cullingWasteBasketDeferredUndoActionIDs: Set<String> = []
    @Published var cullingCancellationRequested = false
    @Published var fixtureReviewWindow: FixtureReviewWindow?
    @Published var reviewMode: FixtureReviewMode = .full
    @Published var reviewStateFilters: Set<FixtureReviewStateFilter> = [.picked]
    @Published var reviewProposalAvailableOnly = false
    @Published var reviewMediaFilters: Set<CullingMediaFilter> = [.photos]
    @Published var reviewSearch = ""
    @Published var reviewWindowOffset = 0
    @Published var reviewWindowLimit = 200
    @Published var reviewSelection = OwnerSelectionModel<String>()
    @Published var reviewThumbnails: [String: NSImage] = [:]
    @Published var reviewTitle = ""
    @Published var reviewKeywords = ""
    @Published var reviewCountry = ""
    private var reviewCountrySuggestionSeedAssetID: String?
    private var reviewCountrySuggestionSeedValue = ""
    @Published var reviewAIReasons: Set<String> = []
    @Published var reviewAINote = ""
    @Published var reviewLastAction: FixtureReviewAction = .approve
    @Published var reviewStatus = "Choose a fixture to load its unresolved picked photos."
    @Published private(set) var reviewLastTiming: [String: JSONValue] = [:]
    @Published var isRunningReview = false
    @Published private(set) var reviewWasteBasketQueueing = false
    @Published private(set) var reviewWasteBasketPendingActionIDs: Set<String> = []
    @Published private(set) var reviewWasteBasketPendingActionID: String?
    @Published private(set) var reviewWasteBasketPendingAction: OwnerAction?
    @Published var reviewScrollTargetID: String?
    @Published var fixtureAIStatus: FixtureAIStatus?
    @Published var reviewProposalDrafts: [String: ReviewMetadataDraft] = [:]
    @Published var reviewProposalConflictIDs: Set<String> = []
    @Published var reviewVisualProposals: [String: VisualRepairProposal] = [:]
    @Published var visualRepairDefectCategories: Set<VisualRepairDefectCategory> = []
    @Published var visualRepairStatus = "Production visual generation is not configured; comparison remains read-only."
    @Published var isLoadingVisualRepairProposals = false
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
    @Published var metadataModelCatalog: [MetadataModelLadderRung] = MetadataModelLadderRung.catalog
    @Published var metadataModelLadder: [MetadataModelLadderRung] = MetadataModelLadderRung.defaultLadder
    @Published var metadataModelLadderStatus = "Every rung sends a bounded JPEG; vision is always on."
    @Published private(set) var hasLoadedMetadataModelLadder = false
    @Published private(set) var isLoadingMetadataModelLadder = false
    @Published var isSavingMetadataModelLadder = false
    @Published var lifecycleItems: [LifecycleItem] = []
    @Published var selectedLifecycleIDs: Set<String> = []
    // Waste Basket previews are independent from the scrolling Culling cache.
    // Quick Look, fixture refreshes, and Culling window changes must not evict
    // a lifecycle row that is still visible.
    @Published var lifecycleThumbnails: [String: NSImage] = [:]
    @Published var lifecycleThumbnailFailures: [String: CullingThumbnailFailure] = [:]
    @Published var lifecycleStatus = "Load the private lifecycle ledger to review recoverable rejects."
    @Published var lifecycleCountSummary = "0 recoverable • 0 active global tombstones"
    @Published var isRunningLifecycle = false
    @Published private(set) var lifecycleQueueing = false
    @Published private(set) var lifecyclePendingActionID: String?
    @Published private(set) var lifecyclePendingAction: OwnerAction?
    @Published private(set) var lifecycleRestoreQueueing = false
    @Published private(set) var lifecycleRestorePendingActionID: String?
    @Published private(set) var lifecycleRestorePendingActionIDs: Set<String> = []
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
    @Published var isCancellingNativePublication = false
    @Published var nativePublicationBatchNumber = 0
    @Published var nativePublicationBatchCount = 0
    @Published var nativeUploadThumbnails: [String: NSImage] = [:]
    @Published var nativeUploadStatus = "Choose a fixture to load its approved publication queue."
    @Published var photosSyncReport: PhotosSyncReport?
    @Published var photosSyncStatus = "Apple Photos sync runs incrementally in the background."
    @Published var ownerWorkflowRecoveryStatus = "Workflow recovery is checked at Backstage launch."
    @Published var activityStatus = "Refresh to load the latest audited cloud activity."
    @Published var isSyncingPhotos = false
    @Published var r2Reconciliation: R2ReconciliationReport?
    @Published var r2ReconciliationStatus = "Preview protected sales and 30-day quarantine before committing cleanup."
    @Published var isRunningR2Reconciliation = false
    @Published var isCancellingR2Reconciliation = false
    @Published var deliverables: [FixtureDeliverable] = []
    @Published var deliverableKind = "pdf"
    @Published var deliverableShareLink = ""
    @Published var publicationPlan: FixturePublicationPlan?
    @Published var publicationStatus = "Publication is a separate, explicit public-fixture gate."
    @Published var updateState: BackstageUpdateState = .idle
    private var nativePublicationCancellationRequested = false
    private var didCheckOwnerWorkflowRecovery = false
    private var didStartAutomaticRecentPhotosDiscovery = false
    private var r2ReconciliationCancellationRequested = false
    private var terminationRequested = false
    private var aiPassMonitoringDetached = false

    let api: OwnerAPIClient
    let authenticationService: OwnerAuthenticationService
    let photoLibrary: any PhotoLibraryServing
    let previewIPCServer: BackstagePreviewIPCServer
    let metadataService: MetadataGiveBackService
    let fixtureService: FixtureWorkflowService
    let accessService: AccessControlService
    let decisionService: SidecarDecisionService
    let metadataReviewService: MetadataReviewService
    let visualRepairService: VisualRepairProposalService
    let lifecycleService: LifecycleService
    let deliveryService: FixtureDeliveryService
    let updateService: BackstageUpdateService
    let updateInstaller: BackstageUpdateInstaller
    let installedRelease: BackstageReleaseIdentity
    private let pbeOwnerHost: any PBEOwnerHostServing
    private let workflowRecoveryStore: OwnerWorkflowRecoverySQLiteStore?
    private let currentImageSizeCache: (any OwnerCurrentImageSizeCaching)?
    private let customerPhotoLinks: (any CustomerPhotoLinkResolving)?
    private let openExternalURL: (URL) -> Bool
    private var pbeOwnerSessionToken = ""
    private var authenticationTask: Task<OwnerAuthenticationSnapshot, Never>?
    private var nativeEnrollmentTask: Task<Void, Never>?
    private var nativeEnrollmentHandoff: OwnerEnrollmentHandoff?
    private(set) var hasPendingReviewMetadataAutosave = false
    private var reviewMetadataAutosaveTask: Task<Void, Never>?
    private var reviewMetadataAutosaveTaskToken: UUID?
    private var reviewAIStatusRefreshTask: Task<Void, Never>?
    private var cullingFilterTask: Task<Void, Never>?
    private var cullingBackfillTask: Task<Void, Never>?
    private var cullingThumbnailTasks: [String: Task<Void, Never>] = [:]
    private var cullingThumbnailTaskTokens: [String: UUID] = [:]
    private var cullingThumbnailTimeoutTasks: [String: Task<Void, Never>] = [:]
    private var cullingThumbnailUpgradeTasks: [String: Task<Void, Never>] = [:]
    private var cullingThumbnailUpgradeTaskTokens: [String: UUID] = [:]
    // Attempt once per idle/visibility interval, including failures. Completion
    // must advance the queue, not immediately resubmit the same first four IDs.
    private var cullingThumbnailUpgradeAttempts = Set<String>()
    private var cullingBasicThumbnails: [String: NSImage] = [:]
    private var cullingThumbnailRecency: [String] = []
    private var cullingThumbnailBackfillTask: Task<Void, Never>?
    private var cullingThumbnailBackfillTaskToken: UUID?
    private var pendingCurrentImageByteCounts: [String: Int64] = [:]
    private var quickLookEquipmentByAssetID: [String: BackstageQuickLookEquipment] = [:]
    private var currentImageSizeFlushTask: Task<Void, Never>?
    private var thumbnailPreferredIdentifiers: [String: String] = [:]
    private var lifecycleThumbnailTasks: [String: Task<Void, Never>] = [:]
    private var lifecycleThumbnailTaskTokens: [String: UUID] = [:]
    private var lifecycleThumbnailPreferredIdentifiers: [String: String] = [:]
    private var lifecycleRestorePendingActions: [String: OwnerAction] = [:]
    private var lifecycleRestorePendingActionOrder: [String] = []
    private var locallyObservedLifecycleActions: [String: OwnerAction] = [:]
    private var lifecycleRecoverableCount = 0
    private var lifecycleTombstoneCount = 0
    private var cullingWasteBasketPendingActions: [String: OwnerAction] = [:]
    private var cullingWasteBasketPendingActionOrder: [String] = []
    private var reviewWasteBasketPendingActions: [String: OwnerAction] = [:]
    private var reviewWasteBasketPendingActionOrder: [String] = []
    private var cullingStableWindowIndexes: [String: Int] = [:]
    private var pendingGalleryRevealIDs: [String] = []
    private var pendingGalleryRevealSource = ""
    private var lifecycleMonitorTask: Task<Void, Never>?
    private var cullingVisibleAssetIDs = Set<String>()
    private var isCullingScrolling = false
    private var shouldInjectNextCullingThumbnailFailure: Bool
    private var controlledFailedCullingAssetID: String?
    private let cullingThumbnailTimeout: Duration
    private let cullingThumbnailUpgradeDelay: Duration
    private let cullingThumbnailBackfillDelay: Duration
    private let currentImageSizeFlushDelay: Duration
    private let activityRefreshTimeout: Duration
    private var reviewThumbnailTasks: [String: Task<Void, Never>] = [:]
    private var cullingWindowRequestSerial = 0
    private var reviewWindowRequestSerial = 0
    private var reviewAIStatusRefreshGeneration = 0
    private var reviewAIAvailabilityToken = ""
    private var reviewAIWindowRefreshPending = false
    private let preferences: UserDefaults
    private var fixtureSelectionCoordinator: FixtureSelectionCoordinator
    private static let selectedSectionPreferenceKey =
        "PhotosByElieBackstage.selectedSection"
    static let selectedFixturePreferenceKey =
        "PhotosByElieBackstage.selectedFixtureID"
    private static let legacyPreviewPanelVisibilityPreferenceKey =
        "PhotosByElieBackstage.previewPanelVisible"
    private static let cullingPreviewPanelVisibilityPreferenceKey =
        "PhotosByElieBackstage.cullingPreviewPanelVisible"
    private static let reviewPreviewPanelVisibilityPreferenceKey =
        "PhotosByElieBackstage.reviewPreviewPanelVisible"
    private static let cullingThumbnailUpgradePixelSize = 900
    private static let cullingThumbnailUpgradeConcurrencyLimit = 4
    private static let cullingThumbnailBackfillAssetLimit = 2_000
    private static let cullingThumbnailBackfillConcurrencyLimit = 4

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

    var fixtureScopedActionsAllowed: Bool {
        fixtureSelectionCoordinator.fixtureScopedActionsAllowed
    }

    var isFixtureChooserDisabled: Bool {
        fixtureSelectionCoordinator.chooserDisabled
            || fixtureSelectionOperationInFlight
            || isLaunchingPBEOwner
    }

    var isFixtureRefreshDisabled: Bool {
        fixtureSelectionOperationInFlight
            || isLaunchingPBEOwner
            || pbeOwnerFixtureSession != nil
    }

    var fixtureChooserExplanation: String? {
        if fixtureSelectionCoordinator.chooserDisabled {
            return fixtureSelectionCoordinator.chooserExplanation
        }
        if fixtureSelectionOperationInFlight {
            return "Finish the current fixture operation before changing fixtures."
        }
        if isLaunchingPBEOwner {
            return "PBE Owner is opening with the captured current fixture."
        }
        return nil
    }

    var canLaunchPBEOwner: Bool {
        authentication.phase == .authenticated
            && fixtureScopedActionsAllowed
            && !fixtureSelectionOperationInFlight
            && !isLaunchingPBEOwner
            && pbeOwnerFixtureSession == nil
    }

    var isREReviewScope: Bool {
        VisualRepairScope.isREReview(path: fixtures.path(to: selectedFixtureID))
    }

    func visualRepairComparisonState(for item: FixtureReviewItem) -> VisualRepairComparisonState {
        let originalReference = item.sourceVersionID.isEmpty
            ? "immutable-source-asset://\(item.id)"
            : "immutable-source-version://\(item.sourceVersionID)"
        return VisualRepairComparisonState(
            originalReference: originalReference,
            proposal: reviewVisualProposals[item.id]
        )
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
        preferences: UserDefaults = .standard,
        pbeOwnerHost: (any PBEOwnerHostServing)? = nil,
        openExternalURL: @escaping (URL) -> Bool = { NSWorkspace.shared.open($0) },
        updateService: BackstageUpdateService = BackstageUpdateService(),
        updateInstaller: BackstageUpdateInstaller = BackstageUpdateInstaller(),
        authenticationService: OwnerAuthenticationService? = nil,
        fixtureService: FixtureWorkflowService? = nil,
        lifecycleService: LifecycleService? = nil,
        workflowRecoveryStore: OwnerWorkflowRecoverySQLiteStore? = OwnerReviewDatabaseLocator()
            .resolve()
            .map(OwnerWorkflowRecoverySQLiteStore.init(databaseURL:)),
        currentImageSizeCache: (any OwnerCurrentImageSizeCaching)? = OwnerReviewDatabaseLocator()
            .resolve()
            .map { OwnerCurrentImageSizeSQLiteStore(databaseURL: $0) },
        customerPhotoLinks: (any CustomerPhotoLinkResolving)? = OwnerReviewDatabaseLocator()
            .resolve()
            .map { CustomerPhotoLinkSQLiteStore(databaseURL: $0) },
        cullingThumbnailTimeout: Duration = .seconds(12),
        cullingThumbnailUpgradeDelay: Duration = .seconds(1),
        cullingThumbnailBackfillDelay: Duration = .milliseconds(350),
        currentImageSizeFlushDelay: Duration = .milliseconds(500),
        activityRefreshTimeout: Duration = .seconds(5),
        injectNextCullingThumbnailFailure: Bool = ProcessInfo.processInfo.environment[
            "PBE_CULLING_PREVIEW_FAIL_ONCE"
        ] == "1"
    ) {
        self.preferences = preferences
        self.updateService = updateService
        self.updateInstaller = updateInstaller
        self.installedRelease = BackstageReleaseIdentity(bundle: Bundle.main)
        self.fixtureSelectionCoordinator = FixtureSelectionCoordinator(
            lastUsedFixtureID: preferences.string(forKey: Self.selectedFixturePreferenceKey)
        )
        self.selection = preferences.string(forKey: Self.selectedSectionPreferenceKey)
            .flatMap(Section.init(rawValue:)) ?? .culling
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
        self.authenticationService = authenticationService ?? OwnerAuthenticationService(api: api)
        self.photoLibrary = photoLibrary
        self.cullingThumbnailTimeout = cullingThumbnailTimeout
        self.cullingThumbnailUpgradeDelay = cullingThumbnailUpgradeDelay
        self.cullingThumbnailBackfillDelay = cullingThumbnailBackfillDelay
        self.currentImageSizeFlushDelay = currentImageSizeFlushDelay
        self.activityRefreshTimeout = activityRefreshTimeout
        self.shouldInjectNextCullingThumbnailFailure = injectNextCullingThumbnailFailure
        self.previewIPCServer = BackstagePreviewIPCServer(photoLibrary: photoLibrary)
        self.photoAccess = photoLibrary.authorization()
        let runner = OwnerActionRunner(api: api)
        self.metadataService = MetadataGiveBackService(runner: runner)
        self.fixtureService = fixtureService ?? FixtureWorkflowService(
            runner: runner,
            connectorIdentity: LocalOwnerConnectorIdentity(),
            localReviewService: LocalFixtureReviewService()
        )
        self.accessService = AccessControlService(api: api)
        let decisionService = SidecarDecisionService(api: api)
        self.decisionService = decisionService
        self.metadataReviewService = MetadataReviewService(runner: runner)
        self.visualRepairService = VisualRepairProposalService(
            runner: runner,
            connectorIdentity: LocalOwnerConnectorIdentity()
        )
        self.lifecycleService = lifecycleService ?? LifecycleService(runner: runner)
        self.deliveryService = FixtureDeliveryService(runner: runner)
        self.pbeOwnerHost = pbeOwnerHost ?? PBEOwnerNativeHostService(
            api: api,
            photoLibrary: photoLibrary,
            sidecarDecisionService: decisionService
        )
        self.workflowRecoveryStore = workflowRecoveryStore
        self.currentImageSizeCache = currentImageSizeCache
        self.customerPhotoLinks = customerPhotoLinks
        self.openExternalURL = openExternalURL
    }

    var canViewCustomerPhoto: Bool {
        selection == .culling && fixtureScopedActionsAllowed
            && selectedCullingAssetIDs.count == 1 && !isOpeningCustomerPhoto
    }

    func viewSelectedPhotoAsCustomer() async {
        guard !isOpeningCustomerPhoto else { return }
        guard selection == .culling, fixtureScopedActionsAllowed, selectedCullingAssetIDs.count == 1,
              let assetID = selectedCullingAssetIDs.first else {
            customerPhotoStatus = "Select exactly one photo in a current fixture to view as customer."
            return
        }
        guard let customerPhotoLinks else {
            customerPhotoStatus = "Publication evidence is unavailable. No customer page was opened."
            return
        }
        let fixtureID = selectedFixtureID
        isOpeningCustomerPhoto = true
        customerPhotoStatus = "Checking the selected photo's public publication receipt…"
        defer { isOpeningCustomerPhoto = false }
        do {
            let link = try await Task.detached(priority: .utility) {
                try customerPhotoLinks.resolve(assetID: assetID, fixtureID: fixtureID)
            }.value
            guard !Task.isCancelled, selection == .culling, fixtureScopedActionsAllowed,
                  selectedFixtureID == fixtureID, selectedCullingAssetIDs == [assetID] else {
                customerPhotoStatus = "Selection or workspace changed. No customer page was opened."
                return
            }
            customerPhotoStatus = openExternalURL(link.url)
                ? "Opened the published customer page. No Owner session was created; normal customer access rules apply."
                : "The browser could not open the customer page. Please try again."
        } catch CustomerPhotoLinkError.noVerifiedPublication {
            customerPhotoStatus = "No verified public page for this photo in this fixture. Private, unpublished, or withdrawn items are not opened."
        } catch CustomerPhotoLinkError.ambiguousPublication {
            customerPhotoStatus = "Conflicting live publication receipts. No customer page was opened."
        } catch {
            customerPhotoStatus = "Publication evidence could not be read. No customer page was opened."
        }
    }

    func currentImageByteCount(for assetID: String) -> Int64? {
        currentImageByteCounts[assetID]
    }

    private func hydrateCurrentImageByteCounts(for assetIDs: [String]) async {
        guard let currentImageSizeCache else { return }
        let ids = Array(Set(assetIDs)).filter { !$0.isEmpty }
        guard !ids.isEmpty else { return }
        do {
            let values = try await Task.detached(priority: .utility) {
                try currentImageSizeCache.values(assetIDs: ids)
            }.value
            currentImageByteCounts.merge(values) { _, persisted in persisted }
        } catch {
            // This cache is opportunistic. Owner workflow remains available if
            // its compatibility table is absent or temporarily busy.
        }
    }

    private func learnCurrentImageByteCount(
        from preview: PhotoPreview,
        for assetID: String,
        mediaType: String,
        persistPromptly: Bool
    ) async {
        let normalizedType = mediaType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalizedType != "video", normalizedType != "movie",
              let byteCount = preview.currentImageByteCount,
              byteCount > 0
        else { return }
        currentImageByteCounts[assetID] = byteCount
        pendingCurrentImageByteCounts[assetID] = byteCount
        if persistPromptly {
            currentImageSizeFlushTask?.cancel()
            currentImageSizeFlushTask = nil
            await flushCurrentImageByteCounts()
        } else {
            scheduleCurrentImageSizeFlush()
        }
    }

    private func scheduleCurrentImageSizeFlush() {
        guard currentImageSizeFlushTask == nil else { return }
        currentImageSizeFlushTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: self.currentImageSizeFlushDelay)
            guard !Task.isCancelled else { return }
            await self.flushCurrentImageByteCounts()
        }
    }

    private func flushCurrentImageByteCounts() async {
        currentImageSizeFlushTask = nil
        guard let currentImageSizeCache, !pendingCurrentImageByteCounts.isEmpty else { return }
        let values = pendingCurrentImageByteCounts
        pendingCurrentImageByteCounts.removeAll()
        do {
            try await Task.detached(priority: .utility) {
                try currentImageSizeCache.upsert(values, updatedAt: Date())
            }.value
        } catch {
            pendingCurrentImageByteCounts.merge(values) { current, _ in current }
        }
    }

    private func pendingLifecycleActionStatus(
        _ operation: String,
        action: OwnerAction,
        availability: String
    ) -> String {
        let state = action.state.rawValue
        let phase = action.diagnosticPhaseName
        var message = operation
            + " action "
            + action.id
            + " remains durable ("
            + state
            + "); current phase: "
            + phase
            + "."
        if let detail = action.progress?.detail, !detail.isEmpty {
            message += " " + detail + "."
        }
        if let elapsed = action.diagnosticPhaseElapsedMs {
            message += " Last recorded phase "
                + elapsed.formatted(.number.precision(.fractionLength(0...1)))
                + " ms."
        }
        return message + " " + availability
    }

    @discardableResult
    func selectFixture(_ fixtureID: String, now: Date = Date()) -> Bool {
        guard !fixtureSelectionOperationInFlight, !isLaunchingPBEOwner else {
            fixtureSelectionNotice = "Finish the current fixture operation before changing fixtures."
            return false
        }
        do {
            try fixtureSelectionCoordinator.selectFixture(fixtureID, now: now)
            publishFixtureSelection(persist: true)
            return true
        } catch {
            fixtureSelectionNotice = userFacingMessage(for: error)
            return false
        }
    }

    @discardableResult
    func beginPBEOwnerSession(
        expiresAt: Date,
        now: Date = Date()
    ) throws -> PBEOwnerFixtureSession {
        guard !fixtureSelectionOperationInFlight else {
            throw FixtureSelectionError.unavailable(
                "Finish the current fixture operation before starting PBE Owner."
            )
        }
        let session = try fixtureSelectionCoordinator.beginPBEOwnerSession(
            expiresAt: expiresAt,
            now: now
        )
        publishFixtureSelection(persist: false)
        return session
    }

    @discardableResult
    func beginPBEOwnerSession(
        _ session: PBEOwnerFixtureSession,
        now: Date = Date()
    ) throws -> PBEOwnerFixtureSession {
        guard !fixtureSelectionOperationInFlight else {
            throw FixtureSelectionError.unavailable(
                "Finish the current fixture operation before starting PBE Owner."
            )
        }
        let installed = try fixtureSelectionCoordinator.beginPBEOwnerSession(
            session,
            now: now
        )
        publishFixtureSelection(persist: false)
        return installed
    }

    func launchPBEOwner() async {
        guard canLaunchPBEOwner else {
            switch authentication.phase {
            case .authenticated:
                pbeOwnerSessionStatus = "Choose an available fixture and finish current work before opening PBE Owner."
            case .renewalFailed:
                pbeOwnerSessionStatus = "Retry this Mac's retained Owner session before opening PBE Owner."
            case .needsEnrollment, .signedOut:
                pbeOwnerSessionStatus = "Enroll this Mac before opening PBE Owner."
            }
            return
        }
        let captured: (fixtureID: String, breadcrumb: String)
        do {
            captured = try beginPBEOwnerLaunch()
        } catch {
            pbeOwnerSessionStatus = userFacingMessage(for: error)
            return
        }
        let frozenFixtureID = captured.fixtureID
        let frozenBreadcrumb = captured.breadcrumb
        pbeOwnerSessionStatus = "Checking the local PBE host and frozen fixture identity…"
        var minted: PBEOwnerSessionMintEnvelope?
        defer { finishPBEOwnerLaunch() }
        do {
            guard await prepareAuthenticatedOperation() else {
                throw APIErrorEnvelope(error: .init(
                    code: "backstage_authentication_required",
                    message: "Backstage authentication is missing or expired."
                ))
            }
            let readiness = try await pbeOwnerHost.ensureReadiness(fixtureID: frozenFixtureID)
            pbeOwnerSessionStatus = "Minting a short-lived Owner session for \(frozenBreadcrumb)…"
            let issued = try await api.mintPBEOwnerSession(PBEOwnerSessionMintRequest(
                fixtureId: frozenFixtureID,
                fixtureBreadcrumb: frozenBreadcrumb,
                sourceIdentity: readiness.sourceIdentity,
                catalogIdentity: readiness.catalogIdentity,
                readinessIdentity: readiness.readinessIdentity,
                fixtureRevision: readiness.fixtureRevision
            ))
            minted = issued
            guard issued.session.fixtureId == frozenFixtureID,
                  issued.session.fixtureBreadcrumb == frozenBreadcrumb,
                  issued.session.sourceIdentity == readiness.sourceIdentity,
                  issued.session.catalogIdentity == readiness.catalogIdentity,
                  issued.session.readinessIdentity == readiness.readinessIdentity,
                  issued.session.fixtureRevision == readiness.fixtureRevision else {
                throw FixtureSelectionError.ownerSessionMismatch
            }
            let attached = try await pbeOwnerHost.attach(
                sessionToken: issued.sessionToken,
                fixtureID: frozenFixtureID
            )
            guard let launchURL = attached.launchUrl,
                  attached.session.id == issued.session.id,
                  attached.session.fixtureId == issued.session.fixtureId,
                  attached.session.fixtureBreadcrumb == issued.session.fixtureBreadcrumb,
                  attached.session.sourceIdentity == issued.session.sourceIdentity,
                  attached.session.catalogIdentity == issued.session.catalogIdentity,
                  attached.session.readinessIdentity == issued.session.readinessIdentity,
                  attached.session.fixtureRevision == issued.session.fixtureRevision,
                  Set(attached.session.capabilities) == Set(issued.session.capabilities),
                  attached.session.lifecycleWriter == issued.session.lifecycleWriter else {
                throw APIErrorEnvelope(error: .init(
                    code: "pbe_owner_host_contract_mismatch",
                    message: "The local PBE host did not attach the exact Worker-issued session."
                ))
            }
            let fixtureSession = PBEOwnerFixtureSession(
                sessionID: issued.session.id,
                fixtureID: issued.session.fixtureId,
                fixtureBreadcrumb: issued.session.fixtureBreadcrumb,
                sourceIdentity: issued.session.sourceIdentity,
                catalogIdentity: issued.session.catalogIdentity,
                readinessIdentity: issued.session.readinessIdentity,
                fixtureRevision: issued.session.fixtureRevision,
                capabilities: Set(issued.session.capabilities),
                lifecycleWriter: issued.session.lifecycleWriter,
                expiresAt: issued.session.expiresAt
            )
            _ = try beginPBEOwnerSession(fixtureSession)
            pbeOwnerSessionToken = issued.sessionToken
            guard openExternalURL(launchURL) else {
                throw APIErrorEnvelope(error: .init(
                    code: "pbe_owner_browser_launch_failed",
                    message: "Backstage could not open the hosted PBE Owner page."
                ))
            }
            pbeOwnerSessionStatus = "Ready: \(frozenBreadcrumb) is frozen until \(issued.session.expiresAt.formatted(date: .omitted, time: .shortened))."
        } catch {
            if let minted {
                try? await pbeOwnerHost.close(sessionToken: minted.sessionToken)
                _ = try? await api.closePBEOwnerSession(
                    id: minted.session.id,
                    sessionToken: minted.sessionToken
                )
            }
            await pbeOwnerHost.stopIfLaunched()
            pbeOwnerSessionToken = ""
            closePBEOwnerSession()
            pbeOwnerSessionStatus = "PBE Owner unavailable: \(userFacingMessage(for: error))"
        }
    }

    /// Captures the exact current fixture synchronously, before authentication,
    /// readiness, or session minting can suspend the launch task.
    func beginPBEOwnerLaunch() throws -> (fixtureID: String, breadcrumb: String) {
        guard !isLaunchingPBEOwner,
              fixtureScopedActionsAllowed,
              !fixtureSelectionOperationInFlight,
              !selectedFixtureID.isEmpty,
              !selectedFixtureBreadcrumb.isEmpty else {
            throw FixtureSelectionError.unavailable(
                "Choose an available fixture and finish current work before opening PBE Owner."
            )
        }
        isLaunchingPBEOwner = true
        return (selectedFixtureID, selectedFixtureBreadcrumb)
    }

    func finishPBEOwnerLaunch() {
        isLaunchingPBEOwner = false
    }

    func refreshPBEOwnerSessionStatus() async {
        guard let session = pbeOwnerFixtureSession,
              !pbeOwnerSessionToken.isEmpty else { return }
        if session.expiresAt <= Date() {
            await endPBEOwnerSession(reason: "PBE Owner session expired.")
            return
        }
        do {
            let status = try await pbeOwnerHost.status(sessionToken: pbeOwnerSessionToken)
            guard status.session.id == session.sessionID,
                  status.session.fixtureId == session.fixtureID else {
                throw FixtureSelectionError.ownerSessionMismatch
            }
            pbeOwnerSessionStatus = "Ready: \(session.fixtureBreadcrumb) is frozen until \(session.expiresAt.formatted(date: .omitted, time: .shortened))."
        } catch {
            await endPBEOwnerSession(
                reason: "PBE Owner closed or unavailable: \(userFacingMessage(for: error))"
            )
        }
    }

    func endPBEOwnerSession(reason: String = "PBE Owner session closed.") async {
        let token = pbeOwnerSessionToken
        let sessionID = pbeOwnerFixtureSession?.sessionID ?? ""
        pbeOwnerSessionToken = ""
        if !token.isEmpty {
            try? await pbeOwnerHost.close(sessionToken: token)
            if !sessionID.isEmpty {
                _ = try? await api.closePBEOwnerSession(id: sessionID, sessionToken: token)
            }
        }
        await pbeOwnerHost.stopIfLaunched()
        closePBEOwnerSession()
        pbeOwnerSessionStatus = reason
    }

    func closePBEOwnerSession() {
        fixtureSelectionCoordinator.closePBEOwnerSession()
        publishFixtureSelection(persist: false)
    }

    func expirePBEOwnerSessionIfNeeded(now: Date = Date()) {
        guard fixtureSelectionCoordinator.expireOwnerSessionIfNeeded(at: now) else { return }
        publishFixtureSelection(persist: false)
    }

    func installFixtureTree(
        _ loadedFixtures: [FixtureNode],
        preferredFixtureID: String? = nil,
        persistSelection: Bool = true,
        now: Date = Date()
    ) {
        if let preferredFixtureID {
            fixtureSelectionCoordinator = FixtureSelectionCoordinator(
                lastUsedFixtureID: preferredFixtureID
            )
        }
        fixtures = loadedFixtures
        fixtureSelectionCoordinator.restore(from: loadedFixtures, now: now)
        publishFixtureSelection(persist: persistSelection)
    }

    func markFixtureSelectionUnavailable(_ reason: String, notice: String? = nil) {
        fixtureSelectionCoordinator.markUnavailable(reason)
        publishFixtureSelection(persist: false)
        fixtureSelectionNotice = notice
    }

    private var fixtureSelectionOperationInFlight: Bool {
        isRunningFixture
            || isApplyingCullingDecision
            || isRunningReview
            || isRunningDelivery
            || isRunningMetadata
            || isRunningNativePublication
    }

    private func publishFixtureSelection(persist: Bool) {
        let previousFixtureID = selectedFixtureID
        selectedFixtureID = fixtureSelectionCoordinator.selectedFixtureID ?? ""
        selectedFixtureBreadcrumb = fixtureSelectionCoordinator.selectedFixtureBreadcrumb ?? ""
        fixtureSelectionAvailability = fixtureSelectionCoordinator.availability
        fixtureSelectionNotice = fixtureSelectionCoordinator.notice
        pbeOwnerFixtureSession = fixtureSelectionCoordinator.ownerSession
        if persist, let preferredFixtureID = fixtureSelectionCoordinator.preferredFixtureID {
            preferences.set(preferredFixtureID, forKey: Self.selectedFixturePreferenceKey)
        }
        if previousFixtureID != selectedFixtureID {
            resetFixtureScopedViewState()
        }
    }

    /// Clears only transient views when scope changes. Durable workflow state
    /// remains untouched until the user invokes an explicit audited action.
    private func resetFixtureScopedViewState() {
        metadataReport = nil
        metadataGiveBackPlannedAssetIDs = nil
        metadataStatus = selectedFixtureID.isEmpty
            ? "Fixture-scoped metadata give-back is unavailable."
            : "Run a metadata plan for \(selectedFixtureBreadcrumb)."
        cullingFilterTask?.cancel()
        cullingBackfillTask?.cancel()
        cullingWindowRequestSerial += 1
        cancelCullingThumbnailWork()
        cullingPool = nil
        fixtureCullingWindow = nil
        fixtureCullingMediaAvailability = nil
        cullingWindowOffset = 0
        cullingSelection.clear()
        selectedPhotoIDs = []
        photoPreview = nil
        cullingThumbnails = [:]
        cullingThumbnailRecency.removeAll()
        cullingThumbnailFailures = [:]
        cullingStatus = selectedFixtureID.isEmpty
            ? "Fixture-scoped Culling is unavailable."
            : "Loading \(selectedFixtureBreadcrumb) for Culling…"

        preserveCurrentReviewDraft()
        cancelReviewMetadataAutosave()
        reviewWindowRequestSerial += 1
        fixtureReviewWindow = nil
        reviewWindowOffset = 0
        reviewSelection.clear()
        reviewThumbnails = [:]
        clearReviewDraft()
        reviewStatus = selectedFixtureID.isEmpty
            ? "Fixture-scoped Review is unavailable."
            : "Loading \(selectedFixtureBreadcrumb) for Review…"

        fixtureAssets = []
        selectedFixtureAssetIDs = []
        fixturePool = nil
        fixturePools = []
        selectedFixturePoolID = ""
        fixturePlacements = []
        deliveryPlan = nil
        selectedDeliveryIDs = []
        uploadHealth = nil
        uploadAdoptionPlan = nil
        nativeUploadPlan = nil
        nativeUploadRun = nil
        nativeUploadThumbnails = [:]
        deliverables = []
        publicationPlan = nil
    }

    func refreshVisibleFixtureSurface() async {
        guard fixtureScopedActionsAllowed else { return }
        switch selection ?? .overview {
        case .culling:
            await loadFixtureCullingWindow()
        case .review:
            await loadFixtureReviewWindow()
            await restoreLoadedAIProposalDrafts()
            await refreshAIStatus()
        case .fixtures:
            await loadFixturePools()
            await loadFixtureConfiguration()
        case .uploads:
            await loadNativeUploadPlan()
        case .delivery:
            await loadDeliveryPlan()
            await loadDeliverables()
        case .publication:
            await loadPublicationPlan()
        case .updates:
            await checkForUpdates()
        case .overview, .activity, .access, .metadata, .wasteBasket:
            break
        }
    }

    func checkForUpdates() async {
        updateState = .checking
        do {
            let check = try await updateService.check(current: installedRelease)
            switch check.availability {
            case .current:
                updateState = .current(check.manifest)
            case .updateAvailable:
                updateState = .updateAvailable(check.manifest)
            case .downgradeRejected:
                updateState = .failed(
                    message: BackstageUpdateError.downgradeRejected.localizedDescription,
                    recovery: BackstageUpdateError.downgradeRejected.recoveryGuidance
                )
            case .incompatible:
                let error = BackstageUpdateError.incompatible(
                    "The cloud release is not compatible with this Backstage installation or Mac."
                )
                updateState = .failed(message: error.localizedDescription, recovery: error.recoveryGuidance)
            }
        } catch {
            let updateError = (error as? BackstageUpdateError)
                ?? BackstageUpdateError.network(error.localizedDescription)
            updateState = .failed(
                message: updateError.localizedDescription,
                recovery: updateError.recoveryGuidance
            )
        }
    }

    var shouldAutomaticallyCheckForUpdates: Bool {
        switch updateState {
        case .idle, .current, .updateAvailable, .failed:
            true
        case .checking, .downloading, .verified, .installing, .installed:
            false
        }
    }

    func downloadVerifiedUpdate() async {
        guard case let .updateAvailable(manifest) = updateState else { return }
        updateState = .downloading(manifest, receivedBytes: 0, totalBytes: manifest.fileSize)
        do {
            let verified = try await updateService.downloadAndVerify(
                current: installedRelease,
                manifest: manifest
            ) { [weak self] received, total in
                Task { @MainActor in
                    guard let self,
                          case let .downloading(activeManifest, _, _) = self.updateState,
                          activeManifest == manifest else { return }
                    self.updateState = .downloading(
                        manifest,
                        receivedBytes: received,
                        totalBytes: total > 0 ? total : manifest.fileSize
                    )
                }
            }
            updateState = .verified(verified)
        } catch {
            let updateError = (error as? BackstageUpdateError)
                ?? BackstageUpdateError.downloadFailed(error.localizedDescription)
            updateState = .failed(
                message: updateError.localizedDescription,
                recovery: updateError.recoveryGuidance
            )
        }
    }

    func installVerifiedUpdate() async {
        guard case let .verified(update) = updateState else { return }
        updateState = .installing(update.manifest)
        do {
            let installer = updateInstaller
            let receipt = try await Task.detached {
                try installer.install(update)
            }.value
            updateState = .installed(receipt)
        } catch {
            let updateError = (error as? BackstageUpdateError)
                ?? BackstageUpdateError.installationFailed(error.localizedDescription)
            updateState = .failed(
                message: updateError.localizedDescription,
                recovery: updateError.recoveryGuidance
            )
        }
    }

    func bootstrapAuthentication() async {
        await reconcileInterruptedOwnerWorkflows()
        photoAccess = photoLibrary.authorization()
        isAuthenticating = true
        defer { isAuthenticating = false }
        authentication = await ensuredAuthentication()
        switch authentication.phase {
        case .authenticated:
            authenticationStatus = "Authenticated with this Mac's revocable device credential."
            await loadFixtures()
            await refreshActions()
        case .renewalFailed:
            authenticationStatus = "This Mac remains enrolled, but its Owner session could not be renewed. Check the connection and retry."
            status = "Retry Owner session"
            markFixtureSelectionUnavailable(
                "Fixtures are unavailable until the saved Owner session renews. This Mac's enrollment is retained."
            )
        case .needsEnrollment:
            authenticationStatus = "Enroll Backstage from a signed-in Owner browser session."
            status = "Enrollment required"
            markFixtureSelectionUnavailable(
                "Fixtures are unavailable until this Mac is enrolled. Fixture-scoped actions are disabled."
            )
        case .signedOut:
            authenticationStatus = "Signed out on this Mac."
            status = "Signed out"
            markFixtureSelectionUnavailable(
                "Fixtures are unavailable while Backstage is signed out. Fixture-scoped actions are disabled."
            )
        }
    }

    func reconcileInterruptedOwnerWorkflows() async {
        guard !didCheckOwnerWorkflowRecovery else { return }
        didCheckOwnerWorkflowRecovery = true
        guard let workflowRecoveryStore else {
            ownerWorkflowRecoveryStatus = "Workflow recovery unavailable: Owner.sqlite could not be resolved."
            return
        }
        do {
            let report = try await Task.detached(priority: .utility) {
                try workflowRecoveryStore.reconcile()
            }.value
            if report.changed == 0 {
                ownerWorkflowRecoveryStatus = "No stale Owner workflow rows needed recovery."
            } else {
                let recovered = report.photosRecovered + report.uploadsRecovered
                let review = report.photosNeedsReview + report.uploadsNeedsReview
                ownerWorkflowRecoveryStatus = "Workflow recovery: \(recovered) interrupted run\(recovered == 1 ? "" : "s") recovered; \(review) legacy run\(review == 1 ? "" : "s") marked needs review."
            }
        } catch {
            ownerWorkflowRecoveryStatus = "Workflow recovery failed closed: \(userFacingMessage(for: error))"
        }
    }

    func refreshPhotosAccess() {
        photoAccess = photoLibrary.authorization()
    }

    func startPreviewIPC() {
        do {
            try previewIPCServer.start()
        } catch {
            NSLog("PhotosByElie Backstage preview IPC unavailable: %@", error.localizedDescription)
        }
    }

    func authorizePhotosAccess() async {
        if photoLibrary.authorization() == .notDetermined {
            photoAccess = await photoLibrary.requestAuthorization()
        } else {
            refreshPhotosAccess()
        }
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
            await loadFixtures()
        } catch {
            authenticationStatus = "Enrollment failed: \(error)"
            status = "Enrollment failed"
        }
    }

    func setUpThisMac() {
        guard nativeEnrollmentTask == nil else { return }
        nativeEnrollmentTask = Task { [weak self] in
            await self?.runNativeEnrollment()
        }
    }

    private func runNativeEnrollment() async {
        isSettingUpThisMac = true
        isAuthenticating = true
        authenticationStatus = "Preparing a private, five-minute enrollment handoff…"
        defer {
            isSettingUpThisMac = false
            isAuthenticating = false
            nativeEnrollmentTask = nil
            nativeEnrollmentHandoff = nil
        }
        do {
            let handoff = try await authenticationService.beginNativeEnrollment(
                name: Host.current().localizedName ?? "This Mac"
            )
            nativeEnrollmentHandoff = handoff
            guard openExternalURL(handoff.authorizationURL) else {
                await authenticationService.cancelNativeEnrollment(handoff)
                authenticationStatus = "The Owner sign-in page could not be opened. No enrollment was created."
                return
            }
            authenticationStatus = "Finish the Owner identity check in your browser. Backstage will receive the credential directly."
            while !Task.isCancelled, Date() < handoff.expiresAt {
                if let snapshot = try await authenticationService.claimNativeEnrollment(handoff) {
                    authentication = snapshot
                    authenticationStatus = "This Mac is enrolled. Its revocable credential is stored in Keychain."
                    enrolledOwnerDevices = []
                    ownerDeviceManagementStatus = "Refreshing enrolled Macs…"
                    await refreshActions()
                    await loadFixtures()
                    await refreshOwnerDevices()
                    return
                }
                try await Task.sleep(for: .seconds(1))
            }
            await authenticationService.cancelNativeEnrollment(handoff)
            authenticationStatus = Task.isCancelled
                ? "Mac setup was cancelled. No credential was stored."
                : "Mac setup expired. Choose Set up this Mac to try again."
        } catch is CancellationError {
            if let nativeEnrollmentHandoff {
                await authenticationService.cancelNativeEnrollment(nativeEnrollmentHandoff)
            }
            authenticationStatus = "Mac setup was cancelled. No credential was stored."
        } catch {
            authenticationStatus = "Mac setup failed: \(userFacingMessage(for: error))"
            status = "Enrollment failed"
        }
    }

    func cancelMacSetup() {
        nativeEnrollmentTask?.cancel()
        if let nativeEnrollmentHandoff {
            Task { [authenticationService] in
                await authenticationService.cancelNativeEnrollment(nativeEnrollmentHandoff)
            }
        }
    }

    func refreshOwnerDevices() async {
        guard authentication.phase == .authenticated else {
            enrolledOwnerDevices = []
            ownerDeviceManagementStatus = "Enroll this Mac before managing device credentials."
            return
        }
        isRefreshingOwnerDevices = true
        defer { isRefreshingOwnerDevices = false }
        do {
            enrolledOwnerDevices = try await api.listOwnerDevices()
                .sorted { $0.createdAt > $1.createdAt }
            if enrolledOwnerDevices.isEmpty {
                ownerDeviceManagementStatus = "No enrolled Macs were returned."
            } else {
                let activeCount = enrolledOwnerDevices.count { $0.revokedAt == nil }
                let revokedCount = enrolledOwnerDevices.count - activeCount
                ownerDeviceManagementStatus = "\(activeCount) active Mac\(activeCount == 1 ? "" : "s") • \(revokedCount) revoked"
            }
        } catch {
            await presentAuthenticationFailureIfNeeded(error)
            ownerDeviceManagementStatus = "Enrolled Macs unavailable: \(userFacingMessage(for: error))"
        }
    }

    func requestOwnerDeviceRevocation(_ device: OwnerDevice) {
        pendingOwnerDeviceRevocation = device
    }

    func cancelOwnerDeviceRevocation() {
        pendingOwnerDeviceRevocation = nil
    }

    func confirmOwnerDeviceRevocation() {
        guard let device = pendingOwnerDeviceRevocation else { return }
        pendingOwnerDeviceRevocation = nil
        Task { await revokeOwnerDevice(device) }
    }

    private func revokeOwnerDevice(_ device: OwnerDevice) async {
        isRefreshingOwnerDevices = true
        defer { isRefreshingOwnerDevices = false }
        do {
            _ = try await api.revokeOwnerDevice(id: device.id)
            if authentication.deviceId == device.id {
                authentication = try await authenticationService.signOut()
                enrolledOwnerDevices = []
                ownerDeviceManagementStatus = "This Mac was revoked and its local Keychain credential was removed."
                authenticationStatus = "This Mac was revoked. Choose Set up this Mac to enroll it again."
                status = "Enrollment required"
            } else {
                enrolledOwnerDevices.removeAll { $0.id == device.id }
                ownerDeviceManagementStatus = "Revoked \(device.name). It can no longer renew an Owner session."
            }
        } catch {
            await presentAuthenticationFailureIfNeeded(error)
            ownerDeviceManagementStatus = "Revocation failed: \(userFacingMessage(for: error))"
        }
    }

    func signOut() async {
        cancelMacSetup()
        if pbeOwnerFixtureSession != nil {
            await endPBEOwnerSession(reason: "PBE Owner closed before sign-out.")
        }
        isAuthenticating = true
        defer { isAuthenticating = false }
        do {
            authentication = try await authenticationService.signOut()
            actions = []
            fixtures = []
            enrolledOwnerDevices = []
            markFixtureSelectionUnavailable(
                "Fixtures are unavailable while Backstage is signed out. Fixture-scoped actions are disabled."
            )
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
            let fetched = try await fetchActionsWithTimeout().actions
            actions = mergeLocallyObservedLifecycleActions(into: fetched)
            authentication = await authenticationService.currentSnapshot()
            status = "Connected"
            activityStatus = actions.isEmpty
                ? "Activity is up to date. No recent cloud actions."
                : "Loaded \(actions.count) recent audited action\(actions.count == 1 ? "" : "s")."
        } catch ActivityRefreshError.timedOut {
            activityStatus = "Cloud Activity timed out after 5 seconds. Local workflow recovery remains available; retry when online."
            status = "Activity refresh timed out"
        } catch {
            await presentAuthenticationFailureIfNeeded(error)
            if authentication.phase == .authenticated {
                status = userFacingMessage(for: error)
            }
            activityStatus = "Cloud Activity unavailable: \(userFacingMessage(for: error))"
        }
    }

    private func fetchActionsWithTimeout() async throws -> OwnerActionPage {
        try await withThrowingTaskGroup(of: OwnerActionPage.self) { group in
            group.addTask { [api] in
                try await api.listActions(limit: 50)
            }
            group.addTask { [activityRefreshTimeout] in
                try await Task.sleep(for: activityRefreshTimeout)
                throw ActivityRefreshError.timedOut
            }
            defer { group.cancelAll() }
            guard let first = try await group.next() else {
                throw CancellationError()
            }
            return first
        }
    }

    private func retainLocallyObservedLifecycleAction(_ action: OwnerAction) {
        locallyObservedLifecycleActions[action.id] = action
        actions = mergeLocallyObservedLifecycleActions(into: actions)
    }

    private func mergeLocallyObservedLifecycleActions(
        into fetched: [OwnerAction]
    ) -> [OwnerAction] {
        var merged = fetched
        for local in locallyObservedLifecycleActions.values {
            if let index = merged.firstIndex(where: { $0.id == local.id }) {
                let remote = merged[index]
                let remoteUpdated = remote.updatedAt ?? remote.createdAt ?? Date.distantPast
                let localUpdated = local.updatedAt ?? local.createdAt ?? Date.distantPast
                if localUpdated >= remoteUpdated {
                    merged[index] = local
                }
            } else {
                merged.append(local)
            }
        }
        return merged
            .sorted {
                ($0.updatedAt ?? $0.createdAt ?? Date.distantPast)
                    > ($1.updatedAt ?? $1.createdAt ?? Date.distantPast)
            }
            .prefix(50)
            .map { $0 }
    }

    func authorizeAndLoadPhotos() async {
        await authorizePhotosAccess()
        await refreshPhotos()
    }

    func refreshPhotos() async {
        guard !isLoadingPhotos else { return }
        photoAccess = photoLibrary.authorization()
        guard [.authorized, .limited].contains(photoAccess) else {
            photoStatus = "Photos access is required. Choose Allow Photos, then retry Refresh previews."
            return
        }
        isLoadingPhotos = true
        photoStatus = "Refreshing Photos previews…"
        defer { isLoadingPhotos = false }
        libraryItems = await photoLibrary.fetch(limit: 2_000)
        replaceCullingItems()
        photoStatus = libraryItems.isEmpty
            ? "Refresh completed with no Photos previews. Try Refresh previews again."
            : "\(libraryItems.count.formatted()) recent Photos previews cached."
    }

    func reconcilePhotosLibraryIndex() async {
        guard !isReconcilingPhotosIndex else { return }
        guard await prepareAuthenticatedOperation() else { return }
        isReconcilingPhotosIndex = true
        photoStatus = "Reconciling the complete Photos library with Owner…"
        defer { isReconcilingPhotosIndex = false }
        do {
            let report = try await fixtureService.reconcilePhotosIndex(fullLibrary: true)
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
            if authentication.phase == .authenticated {
                photoStatus = userFacingMessage(for: error)
            }
        }
    }

    func refreshPhotosAndRecentIndex() async {
        await refreshPhotos()
        await reconcileRecentPhotosIndex()
    }

    func discoverRecentPhotosAtStartupIfNeeded() async {
        guard !didStartAutomaticRecentPhotosDiscovery else { return }
        didStartAutomaticRecentPhotosDiscovery = true
        await reconcileRecentPhotosIndex()
        guard !Task.isCancelled else { return }
        if !selectedFixtureID.isEmpty {
            await loadFixtureCullingWindow(preservingVisibleWindow: true)
        }
    }

    func reconcileRecentPhotosIndex() async {
        guard !isReconcilingPhotosIndex else { return }
        guard [.authorized, .limited].contains(photoAccess) else { return }
        guard await prepareAuthenticatedOperation() else { return }
        isReconcilingPhotosIndex = true
        photoStatus = "Synchronizing recent Photos with the Owner index…"
        defer { isReconcilingPhotosIndex = false }
        do {
            let report = try await fixtureService.reconcilePhotosIndex()
            photoStatus = [
                "Recent Photos discovered",
                "\(report.importedCount.formatted()) indexed",
                report.checkpointCaptureDate.isEmpty
                    ? "resume point unchanged"
                    : "resume point \(report.checkpointCaptureDate)",
            ].joined(separator: " • ")
        } catch {
            await presentAuthenticationFailureIfNeeded(error)
            if authentication.phase == .authenticated {
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
            // The focused pane is the high-resolution culling preview. When
            // Photos contains a rendered JPG alongside a RAW resource, the
            // generic PhotoKit image-data request may choose the RAW resource
            // and surface its unrendered color profile. Keep this path on the
            // same rendered-JPG source as the idle thumbnail upgrade.
            let preview = try await renderedJPEGPreviewForAsset(
                forAssetID: id,
                maxPixelSize: 1_600
            )
            guard focusedCullingAssetID == id else { return }
            photoPreview = preview
            photoStatus = "Preview prepared from Photos without exporting the original."
        } catch {
            photoStatus = userFacingMessage(for: error)
        }
    }

    func requestThumbnail(
        for assetID: String,
        preferredIdentifier: String? = nil,
        preferRenderedJPEG: Bool = false,
        priority: TaskPriority? = nil
    ) {
        guard !terminationRequested else { return }
        if cullingThumbnailTasks[assetID]?.isCancelled == true {
            cullingThumbnailTasks[assetID] = nil
            cullingThumbnailTaskTokens[assetID] = nil
            cullingThumbnailTimeoutTasks[assetID]?.cancel()
            cullingThumbnailTimeoutTasks[assetID] = nil
        }
        if let preferredIdentifier = preferredIdentifier?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !preferredIdentifier.isEmpty {
            thumbnailPreferredIdentifiers[assetID] = preferredIdentifier
        }
        guard cullingThumbnails[assetID] == nil,
              cullingThumbnailTasks[assetID] == nil,
              !(controlledFailedCullingAssetID == assetID && cullingThumbnailFailures[assetID] != nil)
        else { return }
        let preferredIdentifier = thumbnailPreferredIdentifiers[assetID]
        let taskToken = UUID()
        cullingThumbnailTaskTokens[assetID] = taskToken
        let timeout = cullingThumbnailTimeout
        cullingThumbnailTimeoutTasks[assetID]?.cancel()
        cullingThumbnailTimeoutTasks[assetID] = Task { [weak self] in
            do {
                try await Task.sleep(for: timeout)
            } catch {
                return
            }
            guard let self,
                  !Task.isCancelled,
                  self.cullingThumbnailTaskTokens[assetID] == taskToken,
                  self.cullingThumbnails[assetID] == nil
            else { return }
            self.cullingThumbnailTasks[assetID]?.cancel()
            self.cullingThumbnailTasks[assetID] = nil
            self.cullingThumbnailTaskTokens[assetID] = nil
            self.cullingThumbnailTimeoutTasks[assetID] = nil
            self.cullingThumbnailFailures[assetID] = .timedOut
        }
        cullingThumbnailTasks[assetID] = Task(priority: priority) { [weak self] in
            guard let self else { return }
            defer {
                if self.cullingThumbnailTaskTokens[assetID] == taskToken {
                    self.cullingThumbnailTimeoutTasks[assetID]?.cancel()
                    self.cullingThumbnailTimeoutTasks[assetID] = nil
                    self.cullingThumbnailTaskTokens[assetID] = nil
                    self.cullingThumbnailTasks[assetID] = nil
                }
            }
            guard !Task.isCancelled,
                  self.cullingThumbnailTaskTokens[assetID] == taskToken else { return }
            await self.loadThumbnail(
                for: assetID,
                preferredIdentifier: preferredIdentifier,
                preferRenderedJPEG: preferRenderedJPEG
            )
        }
    }

    func requestLifecycleThumbnail(
        for assetID: String,
        preferredIdentifier: String? = nil
    ) {
        if let preferredIdentifier = preferredIdentifier?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !preferredIdentifier.isEmpty {
            lifecycleThumbnailPreferredIdentifiers[assetID] = preferredIdentifier
        }
        guard lifecycleThumbnails[assetID] == nil,
              lifecycleThumbnailTasks[assetID] == nil
        else { return }
        let preferredIdentifier = lifecycleThumbnailPreferredIdentifiers[assetID]
        let taskToken = UUID()
        lifecycleThumbnailTaskTokens[assetID] = taskToken
        lifecycleThumbnailTasks[assetID] = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.lifecycleThumbnailTaskTokens[assetID] == taskToken {
                    self.lifecycleThumbnailTaskTokens[assetID] = nil
                    self.lifecycleThumbnailTasks[assetID] = nil
                }
            }
            await self.loadLifecycleThumbnail(
                for: assetID,
                preferredIdentifier: preferredIdentifier
            )
        }
    }

    func loadLifecycleThumbnail(
        for assetID: String,
        preferredIdentifier: String? = nil
    ) async {
        guard lifecycleThumbnails[assetID] == nil else { return }
        let preferredIdentifier = preferredIdentifier
            ?? lifecycleThumbnailPreferredIdentifiers[assetID]
        var lastFailure = CullingThumbnailFailure.previewUnavailable
        for attempt in 0..<3 {
            guard !Task.isCancelled else { return }
            do {
                let preview = try await renderedJPEGPreviewForAsset(
                    forAssetID: assetID,
                    preferredIdentifier: preferredIdentifier,
                    maxPixelSize: 180
                )
                guard let image = NSImage(data: preview.jpegData) else {
                    lastFailure = .previewUnavailable
                    if attempt < 2 {
                        try? await Task.sleep(for: .milliseconds(180))
                        continue
                    }
                    break
                }
                lifecycleThumbnails[assetID] = image
                lifecycleThumbnailFailures.removeValue(forKey: assetID)
                return
            } catch {
                lastFailure = CullingThumbnailFailure(error: error)
                guard !Task.isCancelled, attempt < 2 else { break }
                try? await Task.sleep(for: .milliseconds(180 * (attempt + 1)))
            }
        }
        if !Task.isCancelled {
            lifecycleThumbnailFailures[assetID] = lastFailure
        }
    }

    func retryLifecycleThumbnail(
        for assetID: String,
        preferredIdentifier: String? = nil
    ) {
        guard lifecycleThumbnails[assetID] == nil else { return }
        lifecycleThumbnailTasks[assetID]?.cancel()
        lifecycleThumbnailTasks[assetID] = nil
        lifecycleThumbnailTaskTokens[assetID] = nil
        lifecycleThumbnailFailures.removeValue(forKey: assetID)
        requestLifecycleThumbnail(
            for: assetID,
            preferredIdentifier: preferredIdentifier
                ?? lifecycleThumbnailPreferredIdentifiers[assetID]
        )
    }

    func cullingAssetDidAppear(_ asset: FixtureAsset) {
        guard !asset.id.isEmpty, !terminationRequested else { return }
        cullingVisibleAssetIDs.insert(asset.id)
        touchCullingThumbnail(asset.id)
        requestThumbnail(for: asset.id, preferredIdentifier: asset.photoLibraryIdentifier)
        scheduleThumbnailUpgrade(for: asset.id)
        scheduleCullingThumbnailBackfill()
    }

    func cullingAssetDidDisappear(_ assetID: String) {
        cullingVisibleAssetIDs.remove(assetID)
        cullingThumbnailTasks[assetID]?.cancel()
        cullingThumbnailTasks.removeValue(forKey: assetID)
        cullingThumbnailTaskTokens.removeValue(forKey: assetID)
        cullingThumbnailTimeoutTasks[assetID]?.cancel()
        cullingThumbnailTimeoutTasks.removeValue(forKey: assetID)
        cancelCullingThumbnailUpgrade(for: assetID)
        // Keep a completed idle high-resolution upgrade in the bounded cache.
        // Only in-flight work is cancelled when a card leaves the viewport;
        // an explicit Gallery/work cancellation can still downgrade it.
        cullingThumbnailUpgradeAttempts.remove(assetID)
        scheduleVisibleThumbnailUpgrades()
    }

    func cullingScrollPhaseChanged(isScrolling: Bool) {
        isCullingScrolling = isScrolling
        guard !terminationRequested else { return }
        guard !isScrolling else {
            let tasks = Array(cullingThumbnailUpgradeTasks.values)
            cullingThumbnailUpgradeTasks.removeAll()
            cullingThumbnailUpgradeTaskTokens.removeAll()
            tasks.forEach { $0.cancel() }
            cullingThumbnailUpgradeAttempts = Set(cullingBasicThumbnails.keys)
            cancelCullingThumbnailBackfill()
            return
        }
        // An idle backfill request may have been cancelled while its card
        // stayed on-screen. Restart the base request without needing a reappear.
        for assetID in cullingVisibleAssetIDs where cullingThumbnailFailures[assetID] == nil {
            requestThumbnail(for: assetID)
        }
        scheduleVisibleThumbnailUpgrades()
        scheduleCullingThumbnailBackfill()
    }

    private func scheduleThumbnailUpgrade(for assetID: String) {
        guard !terminationRequested,
              cullingThumbnailUpgradeTasks[assetID] == nil,
              !cullingThumbnailUpgradeAttempts.contains(assetID),
              cullingThumbnailUpgradeTasks.count
                < Self.cullingThumbnailUpgradeConcurrencyLimit,
              cullingVisibleAssetIDs.contains(assetID),
              !isCullingScrolling,
              cullingBasicThumbnails[assetID] == nil,
              cullingThumbnails[assetID] != nil
        else { return }
        cullingThumbnailUpgradeAttempts.insert(assetID)
        let taskToken = UUID()
        cullingThumbnailUpgradeTaskTokens[assetID] = taskToken
        cullingThumbnailUpgradeTasks[assetID] = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.cullingThumbnailUpgradeTaskTokens[assetID] == taskToken {
                    self.cullingThumbnailUpgradeTaskTokens[assetID] = nil
                    self.cullingThumbnailUpgradeTasks[assetID] = nil
                    self.scheduleVisibleThumbnailUpgrades()
                }
            }
            try? await Task.sleep(for: self.cullingThumbnailUpgradeDelay)
            guard !Task.isCancelled,
                  self.cullingThumbnailUpgradeTaskTokens[assetID] == taskToken,
                  self.cullingVisibleAssetIDs.contains(assetID),
                  !self.isCullingScrolling,
                  self.cullingBasicThumbnails[assetID] == nil,
                  self.cullingThumbnails[assetID] != nil
            else { return }
            await self.upgradeThumbnail(for: assetID, taskToken: taskToken)
        }
    }

    private func scheduleVisibleThumbnailUpgrades() {
        guard !isCullingScrolling else { return }
        for assetID in cullingVisibleAssetIDs.sorted() {
            guard cullingThumbnailUpgradeTasks.count
                < Self.cullingThumbnailUpgradeConcurrencyLimit
            else { break }
            scheduleThumbnailUpgrade(for: assetID)
        }
    }

    private func cancelCullingThumbnailUpgrade(for assetID: String) {
        cullingThumbnailUpgradeTaskTokens[assetID] = nil
        cullingThumbnailUpgradeTasks[assetID]?.cancel()
        cullingThumbnailUpgradeTasks[assetID] = nil
    }

    private func scheduleCullingThumbnailBackfill() {
        guard !terminationRequested, !isCullingScrolling,
              !cullingVisibleAssetIDs.isEmpty,
              cullingThumbnailBackfillTask == nil else { return }
        let assets = cullingThumbnailBackfillAssets.filter {
            cullingThumbnails[$0.id] == nil && cullingThumbnailFailures[$0.id] == nil
        }
        guard !assets.isEmpty else { return }
        let taskToken = UUID()
        cullingThumbnailBackfillTaskToken = taskToken
        cullingThumbnailBackfillTask = Task(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                if self.cullingThumbnailBackfillTaskToken == taskToken {
                    self.cullingThumbnailBackfillTaskToken = nil
                    self.cullingThumbnailBackfillTask = nil
                }
            }
            try? await Task.sleep(for: self.cullingThumbnailBackfillDelay)
            guard !Task.isCancelled,
                  self.cullingThumbnailBackfillTaskToken == taskToken,
                  !self.isCullingScrolling
            else { return }

            var nextIndex = 0
            await withTaskGroup(of: Void.self) { group in
                for _ in 0..<Self.cullingThumbnailBackfillConcurrencyLimit {
                    guard nextIndex < assets.count else { break }
                    let asset = assets[nextIndex]
                    nextIndex += 1
                    group.addTask { [weak self] in
                        await self?.backfillCullingThumbnail(
                            for: asset,
                            taskToken: taskToken
                        )
                    }
                }
                while await group.next() != nil {
                    guard !Task.isCancelled,
                          self.cullingThumbnailBackfillTaskToken == taskToken,
                          !self.isCullingScrolling
                    else {
                        group.cancelAll()
                        return
                    }
                    guard nextIndex < assets.count else { continue }
                    let asset = assets[nextIndex]
                    nextIndex += 1
                    group.addTask { [weak self] in
                        await self?.backfillCullingThumbnail(
                            for: asset,
                            taskToken: taskToken
                        )
                    }
                }
            }
        }
    }

    private var cullingThumbnailBackfillAssets: [FixtureAsset] {
        let currentAssets = cullingAssets
        let visible = currentAssets.filter { cullingVisibleAssetIDs.contains($0.id) }
        let remaining = currentAssets.filter { !cullingVisibleAssetIDs.contains($0.id) }
        let loadedPhotos = libraryItems
            .filter { !$0.mediaType.lowercased().contains("video") }
            .map {
                FixtureAsset(
                    id: $0.id,
                    title: "",
                    filename: $0.filename,
                    mediaType: $0.mediaType
                )
            }

        var seen = Set<String>()
        let ordered = (visible + remaining + loadedPhotos).filter { asset in
            !asset.id.isEmpty && seen.insert(asset.id).inserted
        }
        return Array(ordered.prefix(Self.cullingThumbnailBackfillAssetLimit))
    }

    private func backfillCullingThumbnail(
        for asset: FixtureAsset,
        taskToken: UUID
    ) async {
        guard cullingThumbnailBackfillTaskToken == taskToken,
              !Task.isCancelled,
              !isCullingScrolling,
              cullingThumbnails[asset.id] == nil,
              cullingThumbnailTasks[asset.id] == nil,
              cullingThumbnailFailures[asset.id] == nil
        else { return }
        // Use the same deduplication, timeout and retry path as a visible card.
        // Cancel this owned task when the utility pass is interrupted.
        requestThumbnail(
            for: asset.id,
            preferredIdentifier: asset.photoLibraryIdentifier,
            priority: .utility
        )
        guard let task = cullingThumbnailTasks[asset.id] else { return }
        await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
    }

    private func cancelCullingThumbnailBackfill() {
        cullingThumbnailBackfillTaskToken = nil
        cullingThumbnailBackfillTask?.cancel()
        cullingThumbnailBackfillTask = nil
    }

    private func upgradeThumbnail(for assetID: String, taskToken: UUID) async {
        for attempt in 0..<3 {
            guard !Task.isCancelled,
                  cullingThumbnailUpgradeTaskTokens[assetID] == taskToken,
                  cullingVisibleAssetIDs.contains(assetID),
                  !isCullingScrolling
            else { return }
            do {
                let preview = try await cullingPreviewForAsset(
                    forAssetID: assetID,
                    preferredIdentifier: thumbnailPreferredIdentifiers[assetID],
                    maxPixelSize: Self.cullingThumbnailUpgradePixelSize
                )
                guard !Task.isCancelled,
                      cullingThumbnailUpgradeTaskTokens[assetID] == taskToken,
                      cullingVisibleAssetIDs.contains(assetID),
                      !isCullingScrolling
                else { return }
                guard let image = NSImage(data: preview.jpegData) else {
                    if attempt < 2 {
                        try? await Task.sleep(for: .milliseconds(180 * (attempt + 1)))
                        continue
                    }
                    return
                }
                cullingBasicThumbnails[assetID] = cullingThumbnails[assetID]
                cullingThumbnails[assetID] = image
                await learnCurrentImageByteCount(
                    from: preview,
                    for: assetID,
                    mediaType: "photo",
                    persistPromptly: false
                )
                return
            } catch {
                guard !(error is CancellationError), !Task.isCancelled, attempt < 2 else {
                    return
                }
                // Photos and iCloud previews can fail transiently while an
                // idle viewport is filling. Retry this card without opening
                // an unbounded scheduler loop or discarding its basic image.
                try? await Task.sleep(for: .milliseconds(180 * (attempt + 1)))
            }
        }
    }

    func loadThumbnail(
        for assetID: String,
        preferredIdentifier: String? = nil,
        preferRenderedJPEG: Bool = false
    ) async {
        guard cullingThumbnails[assetID] == nil else { return }
        if shouldInjectNextCullingThumbnailFailure {
            shouldInjectNextCullingThumbnailFailure = false
            controlledFailedCullingAssetID = assetID
            cullingThumbnailFailures[assetID] = .previewUnavailable
            cullingStatus = "Controlled preview failure ready. Retry this card; no culling decision changed."
            return
        }
        let preferredIdentifier = preferredIdentifier ?? thumbnailPreferredIdentifiers[assetID]
        var lastFailure = CullingThumbnailFailure.previewUnavailable
        for attempt in 0..<3 {
            guard !Task.isCancelled else { return }
            do {
                let preview: PhotoPreview
                if preferRenderedJPEG {
                    preview = try await renderedJPEGPreviewForAsset(
                        forAssetID: assetID,
                        preferredIdentifier: preferredIdentifier,
                        maxPixelSize: 180
                    )
                } else {
                    preview = try await previewForAsset(
                        forAssetID: assetID,
                        preferredIdentifier: preferredIdentifier,
                        maxPixelSize: 180
                    )
                }
                guard let image = NSImage(data: preview.jpegData) else {
                    lastFailure = .previewUnavailable
                    if attempt < 2 {
                        try? await Task.sleep(for: .milliseconds(180))
                        continue
                    }
                    break
                }
                guard !Task.isCancelled else { return }
                cacheCullingThumbnail(image, for: assetID)
                cullingThumbnailFailures.removeValue(forKey: assetID)
                scheduleThumbnailUpgrade(for: assetID)
                return
            } catch {
                lastFailure = CullingThumbnailFailure(error: error)
                guard !Task.isCancelled, attempt < 2 else { break }
                try? await Task.sleep(for: .milliseconds(180 * (attempt + 1)))
            }
        }
        if !Task.isCancelled {
            cullingThumbnailFailures[assetID] = lastFailure
        }
    }

    func retryThumbnail(for assetID: String, preferredIdentifier: String? = nil) {
        guard cullingThumbnails[assetID] == nil else { return }
        if controlledFailedCullingAssetID == assetID {
            controlledFailedCullingAssetID = nil
        }
        cullingThumbnailTasks[assetID]?.cancel()
        cullingThumbnailTasks[assetID] = nil
        cullingThumbnailTaskTokens[assetID] = nil
        cullingThumbnailTimeoutTasks[assetID]?.cancel()
        cullingThumbnailTimeoutTasks[assetID] = nil
        cullingThumbnailFailures.removeValue(forKey: assetID)
        requestThumbnail(
            for: assetID,
            preferredIdentifier: preferredIdentifier ?? thumbnailPreferredIdentifiers[assetID]
        )
    }

    private func cacheCullingThumbnail(_ image: NSImage, for assetID: String) {
        // Retain the entire bounded ordinary-thumbnail working set. Never let
        // background replenishment evict a card the user is looking at.
        while cullingThumbnails[assetID] == nil,
              cullingThumbnails.count >= Self.cullingThumbnailBackfillAssetLimit {
            let oldest = cullingThumbnailRecency.first {
                cullingThumbnails[$0] != nil && !cullingVisibleAssetIDs.contains($0)
            } ?? cullingThumbnails.keys.sorted().first {
                !cullingVisibleAssetIDs.contains($0)
            }
            guard let oldest else { return }
            cullingThumbnails.removeValue(forKey: oldest)
            cullingThumbnailRecency.removeAll { $0 == oldest }
            cullingBasicThumbnails.removeValue(forKey: oldest)
            cullingThumbnailUpgradeAttempts.remove(oldest)
        }
        cullingThumbnails[assetID] = image
        touchCullingThumbnail(assetID)
    }

    private func touchCullingThumbnail(_ assetID: String) {
        cullingThumbnailRecency.removeAll { $0 == assetID }
        if cullingThumbnails[assetID] != nil {
            cullingThumbnailRecency.append(assetID)
        }
    }

    private func restoreBasicCullingThumbnail(for assetID: String) {
        if let basic = cullingBasicThumbnails.removeValue(forKey: assetID),
           cullingThumbnails[assetID] != nil {
            cullingThumbnails[assetID] = basic
        }
    }

    private func recoverCullingThumbnail(_ image: NSImage, for assetID: String) {
        cullingThumbnailTasks[assetID]?.cancel()
        cullingThumbnailTasks[assetID] = nil
        cullingThumbnailTaskTokens[assetID] = nil
        cullingThumbnailTimeoutTasks[assetID]?.cancel()
        cullingThumbnailTimeoutTasks[assetID] = nil
        cullingThumbnailFailures.removeValue(forKey: assetID)
        // Quick Look can return a 4000px image. Do not retain that full image
        // in a working set sized for 2000 ordinary thumbnails.
        cacheCullingThumbnail(Self.basicThumbnail(from: image), for: assetID)
    }

    static func basicThumbnail(from image: NSImage) -> NSImage {
        let longest = max(image.size.width, image.size.height)
        guard longest > 180 else { return image }
        let scale = 180 / longest
        let width = max(1, Int(image.size.width * scale))
        let height = max(1, Int(image.size.height * scale))
        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0
        ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return image }
        let size = NSSize(width: width, height: height)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        image.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        let thumbnail = NSImage(size: size)
        thumbnail.addRepresentation(bitmap)
        return thumbnail
    }

    func cancelCullingThumbnailWork() {
        cullingThumbnailTasks.values.forEach { $0.cancel() }
        cullingThumbnailTasks.removeAll()
        cullingThumbnailTaskTokens.removeAll()
        cullingThumbnailTimeoutTasks.values.forEach { $0.cancel() }
        cullingThumbnailTimeoutTasks.removeAll()
        cullingThumbnailUpgradeTasks.values.forEach { $0.cancel() }
        cullingThumbnailUpgradeTasks.removeAll()
        cullingThumbnailUpgradeTaskTokens.removeAll()
        for assetID in Array(cullingBasicThumbnails.keys) {
            restoreBasicCullingThumbnail(for: assetID)
        }
        cullingThumbnailUpgradeAttempts.removeAll()
        cancelCullingThumbnailBackfill()
        cullingVisibleAssetIDs.removeAll()
        isCullingScrolling = false
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

    var metadataGiveBackAssetIDs: [String] {
        let assetID = metadataAssetID.trimmingCharacters(in: .whitespacesAndNewlines)
        return assetID.isEmpty ? [] : [assetID]
    }

    var metadataGiveBackScopeDescription: String {
        guard let assetID = metadataGiveBackAssetIDs.first else {
            return "Entire current fixture"
        }
        return "Exact item \(assetID)"
    }

    var metadataGiveBackCommitReady: Bool {
        guard let report = metadataReport,
              report.isDryRun,
              report.fixtureID == selectedFixtureID,
              report.readyCount > 0,
              let plannedAssetIDs = metadataGiveBackPlannedAssetIDs
        else { return false }
        return plannedAssetIDs == metadataGiveBackAssetIDs
    }

    func retryMetadataFailures() async {
        guard let metadataReport else { return }
        guard fixtureScopedActionsAllowed else {
            metadataStatus = "Current fixture unavailable; metadata give-back stayed closed."
            return
        }
        guard metadataReport.fixtureID == selectedFixtureID else {
            self.metadataReport = nil
            metadataGiveBackPlannedAssetIDs = nil
            metadataStatus = "The prior metadata report belongs to another fixture. Run a new plan for the current fixture."
            return
        }
        isRunningMetadata = true
        defer { isRunningMetadata = false }
        do {
            let retried = try await metadataService.retryFailures(
                from: metadataReport,
                fixtureID: selectedFixtureID
            )
            self.metadataReport = retried
            metadataGiveBackPlannedAssetIDs = nil
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
            return (fixtureCullingWindow?.items ?? []).filter {
                !$0.mediaType.lowercased().contains("video")
            }
        }
        if let cullingPool {
            return cullingPool.assets.filter {
                !$0.mediaType.lowercased().contains("video")
            }.map {
                FixtureAsset(
                    id: $0.id,
                    title: $0.title,
                    filename: $0.filename,
                    mediaType: $0.mediaType
                )
            }
        }
        return libraryItems.filter {
            !$0.mediaType.lowercased().contains("video")
        }.map {
            FixtureAsset(id: $0.id, title: "", filename: $0.filename, mediaType: $0.mediaType)
        }
    }

    var cullingMediaFilterControls: [CullingMediaFilter] {
        [.photos]
    }

    var cullingQuery: CullingQuery {
        CullingQuery(
            search: cullingSearch,
            media: [.photos],
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

    var cullingViewFilterLabel: String {
        cullingViews.count == FixtureCullingView.selectableCases.count
            ? "All decisions"
            : cullingViews.sorted(by: { $0.rawValue < $1.rawValue }).map(\.label).joined(separator: " + ")
    }

    var gallerySavedViewLabel: String {
        GallerySavedView.allCases.first(where: matchesGallerySavedView)?.rawValue ?? "Custom"
    }

    var cullingRatingFilterLabel: String {
        let rating = cullingMinimumRating
        return rating == 0 ? "All ratings" : "\(rating)+ stars"
    }

    var cullingMinimumRating: Int {
        cullingRatingFilters.min() ?? 0
    }

    var cullingColorFilterLabel: String {
        cullingColorFilters.count == CullingColorFilter.selectableCases.count
            ? "All colors"
            : cullingColorFilters.sorted(by: { $0.rawValue < $1.rawValue }).map(\.label).joined(separator: " + ")
    }

    func toggleCullingViewFilter(_ view: FixtureCullingView) {
        toggle(view, in: &cullingViews)
    }

    var cullingHiddenMatchViews: [FixtureCullingView] {
        guard cullingPool == nil,
              hasCurrentCullingFixture,
              cullingWorkspace.summary.filtered == 0,
              cullingWorkspace.summary.total > 0
        else { return [] }
        return FixtureCullingView.selectableCases.filter {
            !cullingViews.contains($0) && cullingMatchCount(for: $0) > 0
        }
    }

    func cullingMatchCount(for view: FixtureCullingView) -> Int {
        switch view {
        case .undecided: cullingWorkspace.summary.undecided
        case .picked: cullingWorkspace.summary.picked
        case .hidden: cullingWorkspace.summary.rejected
        case .allActive: cullingWorkspace.summary.total
        }
    }

    func includeCullingViewFilter(_ view: FixtureCullingView) {
        guard view != .allActive, !cullingViews.contains(view) else { return }
        cullingViews.insert(view)
    }

    func showAllFixtureAssetsInGallery() {
        applyGallerySavedView(.allAssets)
    }

    func showCullingSavedView() {
        applyGallerySavedView(.culling)
    }

    func openInGallery(assetIDs: [String], sourceLabel: String) async {
        let ids = assetIDs.reduce(into: [String]()) { result, rawID in
            let id = rawID.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty, !result.contains(id) else { return }
            result.append(id)
        }
        guard !selectedFixtureID.isEmpty else {
            cullingStatus = "Choose a fixture before opening an asset in Gallery."
            return
        }
        guard let targetID = ids.first else {
            cullingStatus = "Select an asset before opening Gallery."
            return
        }

        let preset = gallerySavedViewPreset(.allAssets)
        cullingPool = nil
        cullingViews = preset.views
        cullingRatingFilters = Set(0...5)
        cullingColorFilters = Set(CullingColorFilter.selectableCases)
        galleryEditorialFilters = preset.editorial
        galleryDeliveryFilters = preset.delivery
        gallerySourceFilters = preset.sources
        galleryBurstsOnly = false
        cullingSearch = targetID
        cullingWindowOffset = 0
        pendingGalleryRevealIDs = ids
        pendingGalleryRevealSource = sourceLabel
        selection = .culling
        await loadFixtureCullingWindow()
    }

    func applyGallerySavedView(_ savedView: GallerySavedView) {
        let preset = gallerySavedViewPreset(savedView)
        cullingSearch = ""
        cullingViews = preset.views
        cullingRatingFilters = Set(0...5)
        cullingColorFilters = Set(CullingColorFilter.selectableCases)
        galleryEditorialFilters = preset.editorial
        galleryDeliveryFilters = preset.delivery
        gallerySourceFilters = preset.sources
        galleryBurstsOnly = false
        applyCullingFilters()
    }

    func toggleGalleryEditorialFilter(_ filter: GalleryEditorialFilter) {
        toggleOptional(filter, in: &galleryEditorialFilters)
    }

    func toggleGalleryDeliveryFilter(_ filter: GalleryDeliveryFilter) {
        toggleOptional(filter, in: &galleryDeliveryFilters)
    }

    func toggleGallerySourceFilter(_ filter: GallerySourceFilter) {
        toggle(filter, in: &gallerySourceFilters)
    }

    func setCullingMinimumRating(_ rating: Int) {
        let minimum = min(5, max(0, rating))
        cullingRatingFilters = Set(minimum...5)
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

    private func toggleOptional<Value: Hashable>(_ value: Value, in selection: inout Set<Value>) {
        if selection.contains(value) {
            selection.remove(value)
        } else {
            selection.insert(value)
        }
    }

    private func matchesGallerySavedView(_ savedView: GallerySavedView) -> Bool {
        let preset = gallerySavedViewPreset(savedView)
        return cullingViews == preset.views
            && cullingSearch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && cullingRatingFilters == Set(0...5)
            && cullingColorFilters == Set(CullingColorFilter.selectableCases)
            && galleryEditorialFilters == preset.editorial
            && galleryDeliveryFilters == preset.delivery
            && gallerySourceFilters == preset.sources
            && !galleryBurstsOnly
    }

    private func gallerySavedViewPreset(
        _ savedView: GallerySavedView
    ) -> (
        views: Set<FixtureCullingView>,
        editorial: Set<GalleryEditorialFilter>,
        delivery: Set<GalleryDeliveryFilter>,
        sources: Set<GallerySourceFilter>
    ) {
        let allViews = Set(FixtureCullingView.selectableCases)
        let allSources = Set(GallerySourceFilter.allCases)
        return switch savedView {
        case .allAssets:
            (allViews, [], [], allSources)
        case .culling:
            ([.undecided], [], [], [.available])
        case .reviewQueue:
            ([.picked], [.needsReview, .aiRequested, .proposalAvailable], [], [.available])
        case .approved:
            ([.picked], [.approved], [], [.available])
        case .uploadQueue:
            ([.picked], [.approved], [.needsUpload, .uploading, .failed], [.available])
        case .live:
            ([.picked], [], [.live], [.available])
        case .hidden:
            ([.hidden], [], [], [.available])
        case .unavailable:
            (allViews, [], [], [.unavailable])
        }
    }

    @discardableResult
    func normalizeCullingMediaFilters(
        for availableCases: [CullingMediaFilter]
    ) -> Bool {
        _ = availableCases
        let normalized: Set<CullingMediaFilter> = [.photos]
        guard normalized != cullingMediaFilters else { return false }
        cullingMediaFilters = normalized
        return true
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
                        cameraBody: asset.cameraBody,
                        lens: asset.lens,
                        focalLength: asset.focalLength,
                        decision: cullingStates[asset.id]
                    )
                },
                summary: CullingSummary(
                    total: window.summary.universe,
                    filtered: window.summary.filtered,
                    undecided: window.summary.undecided,
                    picked: window.summary.picked,
                    rejected: window.summary.hidden,
                    photos: window.mediaAvailability?.photos ?? 0,
                    videos: window.mediaAvailability?.videos ?? 0
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
                    cameraBody: asset.cameraBody,
                    lens: asset.lens,
                    focalLength: asset.focalLength,
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
            // OwnerCullingSQLiteStore is the sole authority for fixture search,
            // filters, counts, ordering, and pagination. Re-evaluating its
            // already-filtered page here can make summary counts disagree with
            // the rendered cards whenever the server matches metadata that is
            // not duplicated perfectly in the client model.
            return cullingAssets
        }
        let assets = Dictionary(uniqueKeysWithValues: cullingAssets.map { ($0.id, $0) })
        return cullingWorkspace.items.compactMap { assets[$0.id] }
    }

    var selectedCullingAssetIDs: [String] {
        cullingSelection.selectedInDisplayOrder
    }

    var cullingReturnToReviewEligibleIDs: [String] {
        let selected = Set(selectedCullingAssetIDs)
        return cullingAssets.compactMap { asset in
            guard selected.contains(asset.id),
                  asset.editorialState.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "approved"
            else { return nil }
            return asset.id
        }
    }

    var cullingReturnToReviewSkippedCount: Int {
        max(0, selectedCullingAssetIDs.count - cullingReturnToReviewEligibleIDs.count)
    }

    var cullingReturnToReviewLiveCount: Int {
        let eligible = Set(cullingReturnToReviewEligibleIDs)
        return cullingAssets.filter {
            eligible.contains($0.id)
                && $0.deliveryState.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "live"
        }.count
    }

    var canReturnCullingSelectionToReview: Bool {
        !selectedFixtureID.isEmpty
            && cullingPool == nil
            && !isApplyingCullingDecision
            && !cullingReturnToReviewEligibleIDs.isEmpty
    }

    var cullingReturnToReviewConfirmationMessage: String {
        let eligible = cullingReturnToReviewEligibleIDs.count
        let live = cullingReturnToReviewLiveCount
        let skipped = cullingReturnToReviewSkippedCount
        var parts = [
            "This reverses approval for \(eligible.formatted()) selected asset\(eligible == 1 ? "" : "s") while preserving metadata and fixture picks."
        ]
        if live > 0 {
            parts.append("The current deployed rendition for \(live.formatted()) live asset\(live == 1 ? "" : "s") remains live until a separate replacement or unpublish action.")
        }
        if skipped > 0 {
            parts.append("\(skipped.formatted()) selected asset\(skipped == 1 ? " is" : "s are") not approved and will be skipped.")
        }
        parts.append("The audited action can be undone during this Backstage session.")
        return parts.joined(separator: " ")
    }

    var cullingClearDecisionLabel: String {
        let placements = selectedCullingPlacementStates
        if placements == [.hidden] { return "Unhide" }
        if placements == [.picked] { return "Unpick" }
        return "Clear decisions"
    }

    var canClearCullingDecision: Bool {
        !selectedCullingAssetIDs.isEmpty
            && selectedCullingPlacementStates.contains(where: { $0 != .undecided })
    }

    var cullingClearDecisionHelp: String {
        switch cullingClearDecisionLabel {
        case "Unhide":
            "Return the hidden selection to Undecided in the current fixture."
        case "Unpick":
            "Return the picked selection to Undecided in the current fixture."
        default:
            "Return every selected fixture decision to Undecided."
        }
    }

    private var selectedCullingPlacementStates: Set<FixturePlacementState> {
        let assetsByID = Dictionary(uniqueKeysWithValues: cullingAssets.map { ($0.id, $0) })
        return Set(selectedCullingAssetIDs.compactMap { id in
            if let rawValue = cullingStates[id]?.pickState,
               let placement = FixturePlacementState(rawValue: rawValue) {
                return placement
            }
            return assetsByID[id]?.placementState
        })
    }

    var cullingSelectionRating: Int? {
        let ids = selectedCullingAssetIDs
        guard let firstID = ids.first else { return nil }
        let firstRating = cullingStates[firstID]?.rating
            ?? cullingAssets.first(where: { $0.id == firstID })?.rating
            ?? 0
        guard ids.dropFirst().allSatisfy({ id in
            let rating = cullingStates[id]?.rating
                ?? cullingAssets.first(where: { $0.id == id })?.rating
                ?? 0
            return rating == firstRating
        }) else { return nil }
        return firstRating
    }

    func cullingSelectionHasColor(_ color: SidecarColor) -> Bool {
        let ids = selectedCullingAssetIDs
        guard !ids.isEmpty else { return false }
        return ids.allSatisfy { id in
            let currentColor = cullingStates[id]?.color
                ?? cullingAssets.first(where: { $0.id == id })?.color
                ?? ""
            return currentColor == color.rawValue
        }
    }

    var hasCurrentCullingFixture: Bool {
        !selectedFixtureID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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

    var canSelectReviewBurstCandidates: Bool {
        !isRunningReview
            && !CullingWorkspace.reviewBurstRejectCandidates(in: reviewItems).isEmpty
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
        if cullingPool != nil || !hasCurrentCullingFixture {
            normalizeCullingMediaFilters(for: cullingMediaFilterControls)
        }
        cullingSelection.replaceItems(visibleCullingAssets.map(\.id))
        selectedPhotoIDs = cullingSelection.selectedIDs
    }

    func applyCullingFilters(debounceNanoseconds: UInt64 = 0) {
        cullingWindowOffset = 0
        invalidateCullingWindowLoads()
        if !selectedFixtureID.isEmpty, cullingPool == nil {
            // Invalidate the old response immediately. Until the audited
            // fixture query completes, the grid must not fall back to the
            // unrelated recent-Photos preview cache or show stale results.
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

    /// Prevent a read-only window request from replacing a newer local
    /// decision after a filter transition. The next explicit load receives a
    /// fresh serial, while the current in-memory decision remains authoritative
    /// until the mutation result has been applied.
    private func invalidateCullingWindowLoads() {
        cullingWindowRequestSerial += 1
        cullingBackfillTask?.cancel()
        cullingBackfillTask = nil
        cullingFilterTask?.cancel()
        cullingFilterTask = nil
        cancelCullingThumbnailBackfill()
    }

    func scheduleCullingSearchRefresh() {
        applyCullingFilters(debounceNanoseconds: 250_000_000)
    }

    func clearCullingFilters() {
        cullingSearch = ""
        cullingMediaFilters = [.photos]
        cullingRatingFilters = Set(0...5)
        cullingColorFilters = Set(CullingColorFilter.selectableCases)
        galleryEditorialFilters = []
        galleryDeliveryFilters = []
        gallerySourceFilters = Set(GallerySourceFilter.allCases)
        galleryBurstsOnly = false
        let allViews = Set(FixtureCullingView.selectableCases)
        let viewsChanged = cullingViews != allViews
        cullingViews = allViews
        if !viewsChanged {
            applyCullingFilters()
        }
    }

    func showPickedReview() {
        if !selectedFixtureID.isEmpty, cullingPool == nil {
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
        if !selectedFixtureID.isEmpty, cullingPool == nil {
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

    var cullingGridColumnWidth: Double {
        CullingGridLayout.columnWidth(
            width: max(cullingGridAvailableWidth, CullingGridLayout.minimumColumnWidth),
            columns: cullingGridDensity
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
        normalizeCullingMediaFilters(for: cullingMediaFilterControls)
        cullingSelection = OwnerSelectionModel(orderedIDs: fixturePool.assets.map(\.id))
        selectedPhotoIDs = []
        photoPreview = nil
        cancelCullingThumbnailWork()
        cullingThumbnails = [:]
        cullingThumbnailRecency.removeAll()
        cullingThumbnailFailures = [:]
        cullingStatus = "Fixture pool \(fixturePool.id) loaded in immutable snapshot order."
        selection = .culling
        Task { await refreshCullingDecisions() }
    }

    func showAllPhotosInCulling() {
        cullingPool = nil
        cullingWindowOffset = 0
        cancelCullingThumbnailWork()
        cullingThumbnails = [:]
        cullingThumbnailRecency.removeAll()
        cullingThumbnailFailures = [:]
        Task { await loadFixtureCullingWindow() }
    }

    func loadFixtureCullingWindow(preservingVisibleWindow: Bool = false) async {
        guard !selectedFixtureID.isEmpty else {
            cullingStatus = "Choose a fixture to browse its Gallery."
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
            cancelCullingThumbnailWork()
            cullingStatus = "Loading the \(cullingViewFilterLabel.lowercased()) fixture window…"
        }
        defer {
            if requestSerial == cullingWindowRequestSerial {
                isLoadingFixtureCulling = false
            }
        }
        do {
            let requestedFixtureID = selectedFixtureID
            let requestedSearch = cullingSearch
            let colors = cullingColorFilters.map(\.rawValue).sorted()
            let views = cullingViews.sorted(by: { $0.rawValue < $1.rawValue })
            let ratings = cullingRatingFilters.sorted()
            let requestedOffset = cullingWindowOffset
            let requestedLimit = cullingWindowLimit

            func requestWindow(offset: Int) async throws -> FixtureCullingWindow {
                return try await fixtureService.cullingWindow(
                    fixtureID: requestedFixtureID,
                    view: views.count == 1 ? views[0] : .allActive,
                    views: views,
                    offset: offset,
                    limit: requestedLimit,
                    search: requestedSearch,
                    mediaTypes: ["photo"],
                    ratings: ratings,
                    colors: colors,
                    editorialFilters: galleryEditorialFilters.sorted(by: { $0.rawValue < $1.rawValue }),
                    deliveryFilters: galleryDeliveryFilters.sorted(by: { $0.rawValue < $1.rawValue }),
                    sourceFilters: gallerySourceFilters.sorted(by: { $0.rawValue < $1.rawValue }),
                    burstsOnly: galleryBurstsOnly
                )
            }

            cullingMediaFilters = [.photos]
            let window = try await requestWindow(offset: requestedOffset)
            guard requestSerial == cullingWindowRequestSerial, !Task.isCancelled else { return }
            fixtureCullingMediaAvailability = window.mediaAvailability
            fixtureCullingWindow = window
            cullingStableWindowIndexes = Dictionary(
                uniqueKeysWithValues: window.items.enumerated().map { index, item in
                    (item.id, window.offset + index)
                }
            )
            await hydrateCurrentImageByteCounts(for: window.items.map(\.id))
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
            let didRevealGallerySelection = applyPendingGalleryRevealIfPossible()
            if !preservingVisibleWindow {
                photoPreview = nil
                if !didRevealGallerySelection {
                    cullingStatus = "\(window.summary.filtered.formatted()) \(window.view.label.lowercased()) of \(window.summary.universe.formatted()) eligible items."
                }
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

    @discardableResult
    private func applyPendingGalleryRevealIfPossible() -> Bool {
        guard !pendingGalleryRevealIDs.isEmpty else { return false }
        let visibleIDs = visibleCullingAssets.map(\.id)
        let requested = Set(pendingGalleryRevealIDs)
        let matched = visibleIDs.filter(requested.contains)
        let requestedCount = pendingGalleryRevealIDs.count
        let source = pendingGalleryRevealSource
        pendingGalleryRevealIDs = []
        pendingGalleryRevealSource = ""
        guard let focusedID = matched.first else {
            cullingStatus = "The selected \(source) asset is not in the current fixture Gallery."
            return true
        }
        cullingSelection = OwnerSelectionModel(
            orderedIDs: visibleIDs,
            selectedIDs: Set(matched),
            anchorID: focusedID,
            focusedID: focusedID
        )
        selectedPhotoIDs = cullingSelection.selectedIDs
        cullingScrollTargetID = focusedID
        if requestedCount == 1 {
            cullingStatus = "Opened the selected \(source) asset in Gallery."
        } else if matched.count == requestedCount {
            cullingStatus = "Opened all \(matched.count.formatted()) selected \(source) assets in Gallery."
        } else {
            cullingStatus = "Opened \(matched.count.formatted()) of \(requestedCount.formatted()) selected \(source) assets in Gallery; the others are outside this exact result."
        }
        return true
    }

    func loadFixtures() async {
        guard !isLaunchingPBEOwner else {
            fixtureStatus = "PBE Owner is opening with the captured current fixture; refresh is disabled."
            return
        }
        guard !isLoadingFixtureTree else { return }
        isLoadingFixtureTree = true
        isRunningFixture = true
        fixtureSelectionCoordinator.beginLoading()
        publishFixtureSelection(persist: false)
        defer {
            isLoadingFixtureTree = false
            isRunningFixture = false
        }
        guard await prepareAuthenticatedOperation() else {
            if Task.isCancelled {
                fixtureSelectionCoordinator.cancelLoading()
                publishFixtureSelection(persist: false)
                fixtureStatus = "Fixture refresh cancelled; the previous current fixture was preserved."
                return
            }
            let reason = "Fixtures could not load: \(authenticationOperationRecoveryMessage) Fixture-scoped actions are disabled."
            fixtureStatus = reason
            markFixtureSelectionUnavailable(reason)
            return
        }
        do {
            let loadedFixtures = try await fixtureService.tree()
            installFixtureTree(loadedFixtures)
            fixtureStatus = "\(flatFixtures.count) fixture nodes loaded."
            authentication = await authenticationService.currentSnapshot()
            status = "Connected"
        } catch {
            guard !(error is CancellationError), !Task.isCancelled else {
                fixtureSelectionCoordinator.cancelLoading()
                publishFixtureSelection(persist: false)
                fixtureStatus = "Fixture refresh cancelled; the previous current fixture was preserved."
                return
            }
            await presentAuthenticationFailureIfNeeded(error)
            let failure = fixtureTreeFailureMessage(for: error)
            let reason = "\(failure) Fixture-scoped actions are disabled."
            fixtureStatus = "\(failure) Select Reload tree to retry."
            markFixtureSelectionUnavailable(reason, notice: "Select Reload tree to retry.")
        }
    }

    func createFixture(atRoot: Bool = false) async {
        let name = fixtureName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            fixtureStatus = "Enter a fixture name."
            return
        }
        await fixtureOperation {
            let loadedFixtures = try await fixtureService.create(
                name: name,
                parentID: atRoot ? nil : selectedFixtureID,
                templateKey: fixtureTemplate
            )
            installFixtureTree(loadedFixtures)
            fixtureName = ""
            fixtureStatus = "Fixture created through an audited Max action."
        }
    }

    func renameFixture() async {
        guard !selectedFixtureID.isEmpty, !fixtureName.isEmpty else { return }
        await fixtureOperation {
            let loadedFixtures = try await fixtureService.rename(id: selectedFixtureID, name: fixtureName)
            installFixtureTree(loadedFixtures)
            fixtureStatus = "Fixture renamed; its stable ID and relationships were preserved."
        }
    }

    func toggleFixtureArchive() async {
        guard let fixture = flatFixtures.first(where: { $0.id == selectedFixtureID }) else { return }
        await fixtureOperation {
            let loadedFixtures = try await fixtureService.setArchived(
                id: fixture.id,
                archived: !fixture.isArchived
            )
            installFixtureTree(loadedFixtures)
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

    func toggleCullingColor(_ color: SidecarColor) async {
        guard !selectedCullingAssetIDs.isEmpty else {
            cullingStatus = "Select one or more Photos items."
            return
        }
        cullingColor = cullingSelectionHasColor(color) ? .none : color
        await applyColor()
    }

    @discardableResult
    func applyPickShortcut(
        _ action: SidecarPickAction,
        removalDirection: OwnerSelectionDirection = .next
    ) async -> Bool {
        if case .unpick = action, !canClearCullingDecision {
            cullingStatus = selectedCullingAssetIDs.isEmpty
                ? "Select one or more Photos items."
                : "The selected items are already Undecided."
            return false
        }
        let semanticAction: FixtureCullingAction = switch action {
        case .pick: .include
        case .reject: .exclude
        case .unpick: .clear
        }
        switch FixtureCullingSemantics.mutation(
            for: semanticAction,
            currentFixtureID: selectedFixtureID
        ) {
        case .unavailable:
            cullingStatus = "Choose a current fixture before using P, H, or U. X still moves the asset to the recoverable Waste Basket."
            return false
        case let .fixtureState(state):
            let label = switch state {
            case .picked: "Include"
            case .hidden: "Exclude"
            case .undecided: "Clear fixture decision"
            }
            return await applyFixturePlacement(
                state,
                label: label,
                removalDirection: removalDirection
            )
        case .globalTombstone:
            return false
        }
    }

    func moveCullingSelectionToWasteBasket(
        removalDirection: OwnerSelectionDirection = .next,
        onTerminal: ((Bool, String?) -> Void)? = nil
    ) async {
        guard !isApplyingCullingDecision,
              !cullingWasteBasketQueueing else {
            cullingStatus = cullingWasteBasketQueueing
                ? "This Culling X action is already queued; the Culling workspace remains available while it completes."
                : "Finish the current Culling action first."
            return
        }
        let ids = selectedCullingAssetIDs
        guard !ids.isEmpty else {
            cullingStatus = "Select one or more Photos items."
            return
        }
        let previousIDs = visibleCullingAssets.map(\.id)
        for (index, id) in previousIDs.enumerated()
        where cullingStableWindowIndexes[id] == nil {
            cullingStableWindowIndexes[id] = (fixtureCullingWindow?.offset ?? 0) + index
        }
        let focusedID = cullingSelection.focusedID ?? ids.first
        let fixtureID = selectedFixtureID
        var historyEntry = CullingHistoryEntry(
            label: "Waste Basket",
            wasteBasketMediaIDs: ids,
            fixtureID: fixtureID,
            windowOffset: fixtureCullingWindow?.offset ?? cullingWindowOffset,
            selectedIDs: cullingSelection.selectedIDs,
            anchorID: cullingSelection.anchorID,
            focusedID: cullingSelection.focusedID,
            cullingItems: cullingAssets.filter { ids.contains($0.id) },
            cullingItemIndexes: Dictionary(
                uniqueKeysWithValues: cullingAssets.enumerated().compactMap { index, item in
                    ids.contains(item.id) ? (item.id, index) : nil
                }
            )
        )
        cullingWasteBasketQueueing = true
        cullingStatus = "Submitting X for \(ids.count.formatted()) item\(ids.count == 1 ? "" : "s")… Culling remains available."
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let action = try await self.lifecycleService.enqueueMoveToWasteBasket(
                    mediaIDs: ids,
                    fixtureID: fixtureID,
                    source: "backstage-culling"
                )
                self.cullingWasteBasketQueueing = false
                historyEntry.wasteBasketActionID = action.id
                self.beginCullingWasteBasketAction(action)
                self.cullingHistory.append(historyEntry)
                if self.cullingHistory.count > 100 {
                    self.cullingHistory.removeFirst(self.cullingHistory.count - 100)
                }
                let replacementID = self.removeWasteBasketCullingEntryFromCurrentWindow(
                    historyEntry,
                    previousIDs: previousIDs,
                    focusedID: focusedID,
                    removalDirection: removalDirection
                )
                self.cullingStatus = "Queued X for \(ids.count.formatted()) item\(ids.count == 1 ? "" : "s") as action \(action.id). The local Culling grid is updated; durable reconciliation continues in the background."
                onTerminal?(true, replacementID)
                do {
                    let completedAction = try await self.lifecycleService.awaitCompletion(of: action) { [weak self] update in
                        Task { @MainActor [weak self] in
                            guard let self else { return }
                            self.updateCullingWasteBasketAction(update)
                            self.cullingStatus = self.pendingLifecycleActionStatus(
                                "Culling X",
                                action: update,
                                availability: "Culling remains available while it completes."
                            )
                        }
                    }
                    let undoWasRequested = self.cullingWasteBasketDeferredUndoActionIDs.contains(action.id)
                    self.finishCullingWasteBasketAction(action.id)
                    let receipt = LifecycleActionReceipt.summarize(
                        completedAction,
                        requestedCount: ids.count
                    )
                    if !undoWasRequested {
                        self.cullingStatus = "Culling X completed through action \(action.id). \(receipt.statusSummary). Every affected item remains recoverable in Waste Basket."
                    }
                } catch {
                    if let ownerError = error as? OwnerActionRunError,
                       ownerError == .timedOut {
                        self.cullingStatus = self.pendingLifecycleActionStatus(
                            "Culling X",
                            action: self.cullingWasteBasketPendingActions[action.id] ?? action,
                            availability: "Culling remains available; check Activity for the full receipt."
                        )
                    } else {
                        self.finishCullingWasteBasketAction(action.id)
                        self.cullingHistory.removeAll { $0.id == historyEntry.id }
                        if self.selectedFixtureID == historyEntry.fixtureID,
                           !self.restoreWasteBasketCullingEntryInCurrentWindow(historyEntry) {
                            await self.loadFixtureCullingWindow(preservingVisibleWindow: true)
                        }
                        let receipt = LifecycleActionReceipt(
                            affected: 0,
                            skipped: 0,
                            failed: ids.count
                        )
                        self.cullingStatus = "Waste Basket move failed; the local Culling grid was restored. \(receipt.statusSummary). \(self.userFacingMessage(for: error))"
                        onTerminal?(false, nil)
                    }
                }
            } catch {
                self.cullingWasteBasketQueueing = false
                let receipt = LifecycleActionReceipt(
                    affected: 0,
                    skipped: 0,
                    failed: ids.count
                )
                self.cullingStatus = "Waste Basket move failed. \(receipt.statusSummary). \(self.userFacingMessage(for: error))"
                onTerminal?(false, nil)
            }
        }
    }

    func applyColorShortcut(_ color: SidecarColor) async {
        await toggleCullingColor(color)
    }

    func returnCullingSelectionToReview() async {
        guard !isApplyingCullingDecision else { return }
        let eligibleIDs = cullingReturnToReviewEligibleIDs
        let skippedCount = cullingReturnToReviewSkippedCount
        let liveCount = cullingReturnToReviewLiveCount
        guard !selectedFixtureID.isEmpty, let anchorID = eligibleIDs.first else {
            cullingStatus = selectedCullingAssetIDs.isEmpty
                ? "Select one or more Gallery assets first."
                : "Return to Review is available only for approved Gallery assets."
            return
        }
        let entry = CullingHistoryEntry(
            label: "Return to Review",
            fixtureID: selectedFixtureID,
            windowOffset: fixtureCullingWindow?.offset ?? cullingWindowOffset,
            selectedIDs: cullingSelection.selectedIDs,
            anchorID: cullingSelection.anchorID,
            focusedID: cullingSelection.focusedID,
            cullingItems: cullingAssets.filter { eligibleIDs.contains($0.id) },
            cullingItemIndexes: Dictionary(
                uniqueKeysWithValues: cullingAssets.enumerated().compactMap { index, item in
                    eligibleIDs.contains(item.id) ? (item.id, index) : nil
                }
            ),
            orderedIDs: visibleCullingAssets.map(\.id)
        )
        isApplyingCullingDecision = true
        cullingStatus = "Returning \(eligibleIDs.count.formatted()) approved Gallery asset\(eligibleIDs.count == 1 ? "" : "s") to Review…"
        defer { isApplyingCullingDecision = false }
        do {
            let result = try await fixtureService.applyReview(
                .returnToReview,
                fixtureID: selectedFixtureID,
                assetIDs: eligibleIDs,
                anchorAssetID: anchorID
            )
            var completedEntry = entry
            completedEntry.reviewOperationID = result.operationID
            cullingHistory.append(completedEntry)
            if cullingHistory.count > 100 {
                cullingHistory.removeFirst(cullingHistory.count - 100)
            }
            retainCullingReviewResultInCurrentWindow(result.changes)
            reconcileCullingSelection(after: completedEntry, primaryChangedID: anchorID)
            let returnedCount = result.changes.count
            var message = "Returned \(returnedCount.formatted()) approved asset\(returnedCount == 1 ? "" : "s") to Review. Metadata and fixture picks were preserved."
            if liveCount > 0 {
                message += " \(liveCount.formatted()) current live rendition\(liveCount == 1 ? " remains" : "s remain") live until a separate replacement or unpublish action."
            }
            if skippedCount > 0 {
                message += " Skipped \(skippedCount.formatted()) selected asset\(skippedCount == 1 ? "" : "s") that were not approved."
            }
            cullingStatus = message
            scheduleFixtureCullingBackfill()
        } catch {
            cullingStatus = "Return to Review failed; no Gallery state changed. \(userFacingMessage(for: error))"
        }
    }

    private func retainCullingReviewResultInCurrentWindow(
        _ changes: [FixtureReviewChange]
    ) {
        let reviewsByID = Dictionary(uniqueKeysWithValues: changes.map { ($0.assetID, $0.review) })
        if var window = fixtureCullingWindow {
            window.items = window.items.map { current in
                guard let review = reviewsByID[current.id] else { return current }
                var item = current
                if let editorialState = review["editorialState"]?.stringValue {
                    item.editorialState = editorialState
                }
                if let deliveryState = review["deliveryState"]?.stringValue {
                    item.deliveryState = deliveryState
                }
                return item
            }
            fixtureCullingWindow = window
        }
        for change in changes {
            var decision = cullingStates[change.assetID]
                ?? SidecarDecisionState(assetId: change.assetID)
            if let editorialState = change.review["editorialState"]?.stringValue {
                decision.metadataState = editorialState
            }
            cullingStates[change.assetID] = decision
        }
        replaceCullingItems()
    }

    private func reconcileCullingSelection(
        after entry: CullingHistoryEntry,
        primaryChangedID: String
    ) {
        let visibleIDs = visibleCullingAssets.map(\.id)
        var selection = OwnerSelectionModel(
            orderedIDs: entry.orderedIDs,
            selectedIDs: entry.selectedIDs,
            anchorID: entry.anchorID,
            focusedID: entry.focusedID
        )
        if visibleIDs.contains(primaryChangedID) {
            selection.replaceItems(visibleIDs)
        } else {
            _ = selection.replaceItems(
                visibleIDs,
                selectingSuccessorAfterRemoving: primaryChangedID,
                direction: .next
            )
        }
        if selection.selectedIDs.isEmpty, let fallback = visibleIDs.first {
            selection = OwnerSelectionModel(
                orderedIDs: visibleIDs,
                selectedIDs: [fallback],
                anchorID: fallback,
                focusedID: fallback
            )
        }
        cullingSelection = selection
        selectedPhotoIDs = selection.selectedIDs
        cullingScrollTargetID = selection.focusedID
    }

    func applyRatingShortcut(_ rating: Int) async {
        cullingRating = min(5, max(0, rating))
        await applyRating()
    }

    @discardableResult
    func applyQuickLookRating(_ rating: Int, assetID: String) async -> Bool {
        let value = min(5, max(0, rating))
        return await applyCullingDecisions(
            [.rating(assetID, value: value)],
            label: value == 0 ? "Clear rating" : "Rate \(value)"
        )
    }

    @discardableResult
    func applyQuickLookColor(_ color: SidecarColor, assetID: String) async -> Bool {
        await applyCullingDecisions(
            [.color(assetID, value: color)],
            label: color == .none ? "Clear color" : "\(color.label) color"
        )
    }

    func sendCullingSelection(to destination: Section) {
        let ids = selectedCullingAssetIDs
        guard !ids.isEmpty else {
            cullingStatus = "Select one or more items before continuing."
            return
        }
        selectedPhotoIDs = Set(ids)
        if destination == .review {
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
        guard !selectedFixtureID.isEmpty else {
            reviewStatus = "Choose a fixture to load its Review queue."
            return
        }
        reviewWindowRequestSerial += 1
        let requestSerial = reviewWindowRequestSerial
        let preservedSelectedIDs = reviewSelection.selectedIDs
        let preservedAnchorID = reviewSelection.anchorID
        let preservedFocusedID = reviewSelection.focusedID
        let currentID = preferredAssetID
            ?? preservedFocusedID
            ?? preservedSelectedIDs.first
        preserveCurrentReviewDraft()
        isRunningReview = true
        reviewStatus = "Loading the oldest unresolved picked photos…"
        defer {
            if requestSerial == reviewWindowRequestSerial {
                isRunningReview = false
            }
        }
        do {
            reviewMediaFilters = [.photos]
            let window = try await fixtureService.reviewWindow(
                fixtureID: selectedFixtureID,
                mode: reviewMode,
                stateFilters: reviewStateFilters.map(\.rawValue).sorted(),
                proposalAvailableOnly: reviewProposalAvailableOnly,
                mediaFilters: [CullingMediaFilter.photos.rawValue],
                offset: reviewWindowOffset,
                limit: reviewWindowLimit,
                search: reviewSearch
            )
            guard requestSerial == reviewWindowRequestSerial, !Task.isCancelled else { return }
            hydrateReviewProposalDrafts(from: window.items)
            reviewAIWindowRefreshPending = false
            fixtureReviewWindow = window
            await hydrateCurrentImageByteCounts(for: window.items.map(\.id))
            let orderedIDs = window.items.map(\.id)
            let replacementID = currentID.flatMap { orderedIDs.contains($0) ? $0 : nil }
                ?? orderedIDs.first
            let restoredSelectedIDs = preservedSelectedIDs.intersection(orderedIDs)
            let selectedIDs: Set<String>
            if preferredAssetID == nil, !restoredSelectedIDs.isEmpty {
                selectedIDs = restoredSelectedIDs
            } else {
                selectedIDs = Set(replacementID.map { [$0] } ?? [])
            }
            let anchorID = preferredAssetID ?? preservedAnchorID
            let focusID = preferredAssetID ?? preservedFocusedID
            let restoredAnchorID = anchorID.flatMap {
                orderedIDs.contains($0) ? $0 : nil
            } ?? replacementID
            let restoredFocusedID = focusID.flatMap {
                orderedIDs.contains($0) ? $0 : nil
            } ?? replacementID
            reviewSelection = OwnerSelectionModel(
                orderedIDs: orderedIDs,
                selectedIDs: selectedIDs,
                anchorID: restoredAnchorID,
                focusedID: restoredFocusedID
            )
            reviewScrollTargetID = restoredFocusedID
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
            await refreshVisualRepairProposals(for: window.items)
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

    func toggleVisualRepairCategory(_ category: VisualRepairDefectCategory) {
        if visualRepairDefectCategories.contains(category) {
            visualRepairDefectCategories.remove(category)
        } else {
            visualRepairDefectCategories.insert(category)
        }
    }

    /// The local domain and persistence path accept only an injected synthetic
    /// generator. Production visual generation remains an explicit gate until
    /// a bounded, privacy-reviewed provider is configured.
    var visualRepairGenerationConfigured: Bool { false }

    func refreshVisualRepairProposals(for items: [FixtureReviewItem]) async {
        guard isREReviewScope else {
            reviewVisualProposals = [:]
            isLoadingVisualRepairProposals = false
            visualRepairStatus = "Visual repair drafts are limited to the RE fixture review subtree."
            return
        }
        isLoadingVisualRepairProposals = true
        defer { isLoadingVisualRepairProposals = false }
        do {
            let proposals = try await visualRepairService.proposals(
                fixtureID: selectedFixtureID,
                assetIDs: items.map(\.id)
            )
            reviewVisualProposals = proposals.reduce(into: [String: VisualRepairProposal]()) { result, proposal in
                guard result[proposal.assetID] == nil else { return }
                result[proposal.assetID] = proposal
            }
            visualRepairStatus = proposals.isEmpty
                ? "No visual repair draft is available. Production visual generation is not configured."
                : "Loaded \(proposals.count.formatted()) visual repair draft\(proposals.count == 1 ? "" : "s") for read-only comparison."
        } catch {
            reviewVisualProposals = [:]
            visualRepairStatus = userFacingMessage(for: error)
        }
    }

    func decideVisualRepair(
        _ decision: VisualRepairDecision,
        for assetID: String
    ) async {
        guard isREReviewScope,
              let proposal = reviewVisualProposals[assetID] else {
            visualRepairStatus = "No RE visual repair draft is available for this item."
            return
        }
        if decision == .regenerate, !visualRepairGenerationConfigured {
            visualRepairStatus = "Regeneration is unavailable until a privacy-reviewed visual generator is configured."
            return
        }
        do {
            let updated = try await visualRepairService.decide(
                decision,
                fixtureID: selectedFixtureID,
                proposalID: proposal.id,
                generator: decision == .regenerate ? "synthetic" : "",
                idempotencyKey: "backstage-visual-\(decision.rawValue)-\(proposal.id)"
            )
            reviewVisualProposals[assetID] = updated
            visualRepairStatus = "Recorded visual draft \(decision.rawValue); comparison remains read-only."
        } catch {
            visualRepairStatus = userFacingMessage(for: error)
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

    func selectReviewBurstCandidates() {
        let items = reviewItems
        guard !items.isEmpty else {
            reviewStatus = isRunningReview
                ? "Wait for the Review queue to finish loading."
                : "No Review items are loaded."
            return
        }
        let ids = CullingWorkspace.reviewBurstRejectCandidates(in: items)
        guard !ids.isEmpty else {
            reviewStatus = "No adjacent capture-time bursts found in the current Review filter."
            return
        }

        preserveCurrentReviewDraft()
        let orderedIDs = items.map(\.id)
        let candidateIDs = Set(ids)
        let focusedID = reviewSelection.focusedID.flatMap {
            candidateIDs.contains($0) ? $0 : nil
        } ?? ids.first
        let anchorID = reviewSelection.anchorID.flatMap {
            candidateIDs.contains($0) ? $0 : nil
        } ?? ids.first
        reviewSelection = OwnerSelectionModel(
            orderedIDs: orderedIDs,
            selectedIDs: Set(ids),
            anchorID: anchorID,
            focusedID: focusedID
        )
        reviewScrollTargetID = focusedID
        syncReviewDraft()
        reviewStatus = "Selected \(ids.count) likely duplicate\(ids.count == 1 ? "" : "s") across Review capture-time bursts; each second frame remains unselected. Choose Hide to apply the audited Review action."
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
        cancelReviewMetadataAutosave()
        let ids = selectedReviewAssetIDs
        guard !selectedFixtureID.isEmpty, !ids.isEmpty else {
            reviewStatus = "Choose a fixture and select one or more Review items."
            return
        }
        let oldItems = reviewItems
        let focusedID = reviewSelection.focusedID ?? ids.first
        let oldIndex = focusedID.flatMap { focusedID in
            oldItems.firstIndex(where: { $0.id == focusedID })
        } ?? oldItems.firstIndex(where: { ids.contains($0.id) }) ?? 0
        let fixtureLabel = selectedFixtureBreadcrumb
        let historyEntry = ReviewHistoryEntry(
            label: "Unpick",
            fixtureID: selectedFixtureID,
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
                fixtureID: selectedFixtureID,
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

    func moveReviewSelectionToWasteBasket(
        removalDirection: OwnerSelectionDirection = .next,
        onTerminal: ((Bool, String?) -> Void)? = nil
    ) async {
        guard !isRunningReview,
              !reviewWasteBasketQueueing else {
            reviewStatus = reviewWasteBasketQueueing
                ? "This Review X action is already queued; the Review workspace remains available while it completes."
                : "Finish the current Review action first."
            return
        }
        let ids = selectedReviewAssetIDs
        guard !ids.isEmpty else {
            reviewStatus = "Select one or more Review items."
            return
        }
        let fixtureID = selectedFixtureID
        let focusedID = reviewSelection.focusedID ?? ids.first
        let previousIDs = reviewItems.map(\.id)
        var historyEntry = ReviewHistoryEntry(
            wasteBasketMediaIDs: ids,
            label: "Waste Basket",
            fixtureID: selectedFixtureID,
            mode: reviewMode,
            stateFilters: reviewStateFilters,
            proposalAvailableOnly: reviewProposalAvailableOnly,
            mediaFilters: reviewMediaFilters,
            search: reviewSearch,
            offset: reviewWindowOffset,
            selectedIDs: reviewSelection.selectedIDs,
            anchorID: reviewSelection.anchorID,
            focusedID: reviewSelection.focusedID,
            reviewItems: reviewItems.filter { ids.contains($0.id) },
            reviewItemIndexes: Dictionary(
                uniqueKeysWithValues: reviewItems.enumerated().compactMap { index, item in
                    ids.contains(item.id) ? (item.id, index) : nil
                }
            )
        )
        reviewWasteBasketQueueing = true
        reviewStatus = "Submitting X for \(ids.count.formatted()) Review item\(ids.count == 1 ? "" : "s")… Review remains available."
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let action = try await self.lifecycleService.enqueueMoveToWasteBasket(
                    mediaIDs: ids,
                    fixtureID: fixtureID,
                    source: "backstage-review"
                )
                self.reviewWasteBasketQueueing = false
                historyEntry.wasteBasketActionID = action.id
                self.beginReviewWasteBasketAction(action)
                self.reviewHistory.append(historyEntry)
                if self.reviewHistory.count > 100 {
                    self.reviewHistory.removeFirst(self.reviewHistory.count - 100)
                }
                var replacementID: String?
                if var window = self.fixtureReviewWindow {
                    window.items.removeAll { ids.contains($0.id) }
                    self.fixtureReviewWindow = window
                    let orderedIDs = self.reviewItems.map(\.id)
                    var selection = OwnerSelectionModel(
                        orderedIDs: previousIDs,
                        selectedIDs: Set(focusedID.map { [$0] } ?? []),
                        anchorID: focusedID,
                        focusedID: focusedID
                    )
                    replacementID = focusedID.flatMap {
                        selection.replaceItems(
                            orderedIDs,
                            selectingSuccessorAfterRemoving: $0,
                            direction: removalDirection
                        )
                    }
                    self.reviewSelection = selection
                    self.syncReviewDraft()
                }
                self.reviewStatus = "Queued X for \(ids.count.formatted()) Review item\(ids.count == 1 ? "" : "s") as action \(action.id). The local Review list is updated; durable reconciliation continues in the background."
                onTerminal?(true, replacementID)
                do {
                    _ = try await self.lifecycleService.awaitCompletion(of: action) { [weak self] update in
                        Task { @MainActor [weak self] in
                            guard let self else { return }
                            self.updateReviewWasteBasketAction(update)
                            self.reviewStatus = self.pendingLifecycleActionStatus(
                                "Review X",
                                action: update,
                                availability: "Review remains available while it completes."
                            )
                        }
                    }
                    self.finishReviewWasteBasketAction(action.id)
                    self.reviewStatus = "Moved \(ids.count.formatted()) item\(ids.count == 1 ? "" : "s") to Waste Basket through action \(action.id)."
                } catch {
                    if let ownerError = error as? OwnerActionRunError,
                       ownerError == .timedOut {
                        self.reviewStatus = self.pendingLifecycleActionStatus(
                            "Review X",
                            action: self.reviewWasteBasketPendingActions[action.id] ?? action,
                            availability: "Review remains available; check Activity for the full receipt."
                        )
                    } else {
                        self.finishReviewWasteBasketAction(action.id)
                        self.reviewHistory.removeAll { $0.id == historyEntry.id }
                        if self.selectedFixtureID == historyEntry.fixtureID,
                           !self.restoreWasteBasketReviewEntryInCurrentWindow(historyEntry) {
                            await self.loadFixtureReviewWindow(
                                preferredAssetID: historyEntry.focusedID ?? historyEntry.selectedIDs.first
                            )
                        }
                        self.reviewStatus = "Waste Basket move failed; the local Review list was restored. \(self.userFacingMessage(for: error))"
                        onTerminal?(false, nil)
                    }
                }
            } catch {
                self.reviewWasteBasketQueueing = false
                self.reviewStatus = "Waste Basket move failed: \(self.userFacingMessage(for: error))"
                onTerminal?(false, nil)
            }
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

    func updateReviewCountry(_ value: String) {
        if value != reviewCountry {
            reviewCountrySuggestionSeedAssetID = nil
            reviewCountrySuggestionSeedValue = ""
        }
        reviewCountry = value
        scheduleReviewMetadataAutosave()
    }

    func applyReviewAction(
        _ action: FixtureReviewAction,
        propagate: Bool = false,
        removalDirection: OwnerSelectionDirection = .next
    ) async {
        guard !isRunningReview else {
            reviewStatus = "Finish the current Review action first."
            return
        }
        if action != .editMetadata {
            cancelReviewMetadataAutosave()
        }
        let ids = selectedReviewAssetIDs
        guard !ids.isEmpty, let anchor = reviewSelection.focusedID ?? ids.first else {
            reviewStatus = "Select one or more Review items."
            return
        }
        let reviewClickStartedAt = Date()
        // Approve submits the visible anchor draft in the same audited request.
        // The Owner pipeline resolves every other selected or propagated item
        // from its own active proposal, so one photo's metadata cannot leak
        // across a multi-selection or two-hour propagation scope.
        let approvalDraft = action == .approve ? reviewProposalDrafts[anchor] : nil
        let approvalProposalID = action == .approve
            && approvalDraft?.isProposal == true
            && approvalDraft?.hasManualEdits == false
            ? approvalDraft?.proposalID
            : nil
        let approvalTitle = action == .approve
            ? (approvalDraft?.title ?? reviewTitle)
            : action == .editMetadata || action == .propagateTitle
                ? reviewTitle
                : nil
        let currentCountry = focusedReviewItem?.country ?? ""
        let countrySuggestionIsUntouched = reviewCountrySuggestionSeedAssetID == anchor
            && reviewCountrySuggestionSeedValue == reviewCountry
        let countryDraft = action == .approve && countrySuggestionIsUntouched
            ? reviewCountry
            : approvalDraft?.country ?? reviewCountry
        let approvalCountry: String? = fixtureReviewWindow?.countryWriteEnabled == true
            && (
                action == .propagateCountry
                    || (action == .approve && countryDraft != currentCountry)
                    || (action == .editMetadata
                        && countryDraft != currentCountry
                        && !countrySuggestionIsUntouched)
            )
            ? countryDraft
            : nil
        let approvalKeywords = action == .approve
            ? (approvalDraft?.keywords ?? parsedReviewKeywords())
            : action == .editMetadata || action == .propagateKeywords
                ? parsedReviewKeywords()
                : nil
        let oldItems = reviewItems
        let oldIndex = oldItems.firstIndex(where: { $0.id == anchor }) ?? 0
        let reviewItemsBeforeAction = oldItems.filter { ids.contains($0.id) }
        let reviewItemIndexes = Dictionary(
            uniqueKeysWithValues: oldItems.enumerated().compactMap { index, item in
                ids.contains(item.id) ? (item.id, index) : nil
            }
        )
        let historyEntry = ReviewHistoryEntry(
            operationID: "",
            label: reviewActionLabel(action),
            fixtureID: selectedFixtureID,
            mode: reviewMode,
            stateFilters: reviewStateFilters,
            proposalAvailableOnly: reviewProposalAvailableOnly,
            mediaFilters: reviewMediaFilters,
            search: reviewSearch,
            offset: reviewWindowOffset,
            selectedIDs: reviewSelection.selectedIDs,
            anchorID: reviewSelection.anchorID,
            focusedID: reviewSelection.focusedID,
            reviewItems: reviewItemsBeforeAction,
            reviewItemIndexes: reviewItemIndexes
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
                fixtureID: selectedFixtureID,
                assetIDs: ids,
                anchorAssetID: anchor,
                propagate: propagate,
                title: approvalTitle,
                keywords: approvalKeywords,
                country: approvalCountry,
                proposalID: approvalProposalID,
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
                        focusedID: historyEntry.focusedID,
                        reviewItems: historyEntry.reviewItems,
                        reviewItemIndexes: historyEntry.reviewItemIndexes
                    )
                )
            }
            retainReviewResultInCurrentWindow(result, action: action)
            let orderedIDs = reviewItems.map(\.id)
            let replacementID: String?
            if orderedIDs.contains(anchor) {
                replacementID = anchor
            } else {
                switch removalDirection {
                case .next:
                    replacementID = orderedIDs.indices.contains(oldIndex)
                        ? orderedIDs[oldIndex]
                        : orderedIDs.last
                case .previous:
                    let previousIndex = oldIndex - 1
                    replacementID = orderedIDs.indices.contains(previousIndex)
                        ? orderedIDs[previousIndex]
                        : orderedIDs.first
                }
            }
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
            recordReviewUITiming(result.timing, clickedAt: reviewClickStartedAt)
            reviewStatus = "\(reviewActionLabel(action)) affected \(result.changes.count.formatted()) item\(result.changes.count == 1 ? "" : "s").\(reviewTimingSuffix(result.timing))"
            scheduleReviewAIStatusRefresh()
        } catch {
            reviewStatus = "\(reviewActionLabel(action)) failed: \(error)"
        }
    }

    private func recordReviewUITiming(
        _ serverTiming: [String: JSONValue],
        clickedAt: Date
    ) {
        let refreshedAt = Date()
        let formatter = ISO8601DateFormatter()
        var timing = serverTiming
        var uiTiming = timing["ui"]?.objectValue ?? [:]
        uiTiming["clickStartedAt"] = .string(formatter.string(from: clickedAt))
        uiTiming["uiRefreshedAt"] = .string(formatter.string(from: refreshedAt))
        uiTiming["clickToRefreshDurationMs"] = .number(
            max(0, refreshedAt.timeIntervalSince(clickedAt) * 1000)
        )
        timing["ui"] = .object(uiTiming)
        reviewLastTiming = timing
    }

    private func reviewTimingSuffix(_ timing: [String: JSONValue]) -> String {
        guard let duration = timing["localTransaction"]?.objectValue?["durationMs"]?.intValue else {
            return ""
        }
        return " Local SQLite transaction: \(duration) ms."
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
        if action == .requestAI {
            for change in result.changes {
                guard let before = change.before["editorialState"]?.stringValue,
                      let after = change.after["editorialState"]?.stringValue
                else { continue }
                window.summary.applyEditorialStateTransition(from: before, to: after)
            }
        }
        let updatesTitle = action == .approve
            || action == .editMetadata
            || action == .propagateTitle
        let updatesKeywords = action == .approve
            || action == .editMetadata
            || action == .propagateKeywords
        let updatesCountry = action == .approve
            || action == .editMetadata
            || action == .propagateCountry
        if updatesCountry {
            for change in result.changes {
                let wasMissing = change.before["country"]?.stringValue?.isEmpty ?? true
                let isMissing = change.after["country"]?.stringValue?.isEmpty ?? true
                if wasMissing != isMissing {
                    window.summary.countryMissing = max(
                        0,
                        window.summary.countryMissing + (isMissing ? 1 : -1)
                    )
                }
            }
        }
        window.items = window.items.map { current in
            guard let after = changesByID[current.id] else { return current }
            var item = current
            if updatesTitle, let title = after["title"]?.stringValue {
                item.title = title
            }
            if updatesKeywords, let keywords = after["keywords"]?.arrayValue {
                item.keywords = keywords.compactMap(\.stringValue)
            }
            if updatesCountry, let country = after["country"]?.stringValue {
                item.country = country
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
            case .propagateCountry, .propagateTitle, .propagateKeywords:
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

    /// Apply the exact undo receipt to the current page when it carries the
    /// normalized Review state. This avoids a second full-window read after
    /// the audited undo transaction while preserving the safe reload fallback
    /// for older or incomplete receipts.
    private func retainReviewUndoResultInCurrentWindow(
        _ result: FixtureReviewUndoResult,
        restoring restoredItems: [FixtureReviewItem],
        indexes: [String: Int]
    ) -> Bool {
        guard !restoredItems.isEmpty,
              !result.changes.isEmpty,
              result.changes.allSatisfy({ !$0.review.isEmpty }),
              var window = fixtureReviewWindow
        else { return false }

        let changesByID = Dictionary(
            uniqueKeysWithValues: result.changes.map { ($0.assetID, $0) }
        )
        let existingItems = Dictionary(
            uniqueKeysWithValues: window.items.map { ($0.id, $0) }
        )
        var items = window.items
        let existingIDs = Set(items.map(\.id))
        for restoredItem in restoredItems where !existingIDs.contains(restoredItem.id) {
            let index = min(
                max(0, indexes[restoredItem.id] ?? items.count),
                items.count
            )
            items.insert(restoredItem, at: index)
        }
        for change in result.changes {
            let beforeCountry = change.before["countryAssignment"]?
                .objectValue?["country_slug"]?.stringValue ?? ""
            let restoredCountry = change.after["countryAssignment"]?
                .objectValue?["country_slug"]?.stringValue ?? ""
            if beforeCountry.isEmpty != restoredCountry.isEmpty {
                window.summary.countryMissing = max(
                    0,
                    window.summary.countryMissing + (restoredCountry.isEmpty ? 1 : -1)
                )
            }
            guard let current = existingItems[change.assetID],
                  let restoredState = change.review["editorialState"]?.stringValue
            else { continue }
            window.summary.applyEditorialStateTransition(
                from: current.editorialState,
                to: restoredState
            )
        }
        window.items = items.map { current in
            guard let change = changesByID[current.id] else { return current }
            return applyReviewItemUpdate(current, from: change.review)
        }
        fixtureReviewWindow = window
        hydrateReviewProposalDrafts(from: window.items)
        return true
    }

    private func applyReviewItemUpdate(
        _ current: FixtureReviewItem,
        from update: [String: JSONValue]
    ) -> FixtureReviewItem {
        var item = current
        if let value = update["title"]?.stringValue { item.title = value }
        if let value = update["caption"]?.stringValue { item.caption = value }
        if let value = update["keywords"]?.arrayValue {
            item.keywords = value.compactMap(\.stringValue)
        }
        if let value = update["rating"]?.intValue { item.rating = value }
        if let value = update["color"]?.stringValue { item.color = value }
        if let value = update["placementState"]?.stringValue {
            item.placementState = value
        }
        if let value = update["editorialState"]?.stringValue {
            item.editorialState = value
        }
        if let value = update["aiReasons"]?.arrayValue {
            item.aiReasons = value.compactMap(\.stringValue)
        }
        if let value = update["aiNote"]?.stringValue { item.aiNote = value }
        if let value = update["aiAttemptCount"]?.intValue {
            item.aiAttemptCount = value
        }
        if let value = update["aiLastError"]?.stringValue {
            item.aiLastError = value
        }
        if let value = update["proposalReady"]?.boolValue {
            item.proposalReady = value
        }
        if let value = update["proposalContextAvailable"]?.boolValue {
            item.proposalContextAvailable = value
        }
        if let value = update["proposalId"]?.stringValue {
            item.proposalID = value
        }
        if let value = update["proposedTitle"]?.stringValue {
            item.proposedTitle = value
        }
        if let value = update["proposedKeywords"]?.arrayValue {
            item.proposedKeywords = value.compactMap(\.stringValue)
        }
        if let value = update["country"]?.stringValue {
            item.country = value
        }
        if let value = update["proposedCountry"]?.stringValue {
            item.proposedCountry = value
        }
        if let value = update["countryProposalSource"]?.stringValue {
            item.countryProposalSource = value
        }
        if let value = update["proposalReason"]?.stringValue {
            item.proposalReason = value
        }
        if let value = update["proposalStatus"]?.stringValue {
            item.proposalStatus = value
        }
        if let value = update["requestedGeneratorModel"]?.stringValue {
            item.requestedGeneratorModel = value
        }
        if let value = update["resolvedModel"]?.stringValue {
            item.resolvedModel = value
        }
        if let value = update["reasoningEffort"]?.stringValue {
            item.reasoningEffort = value
        }
        if let value = update["vision"]?.boolValue { item.vision = value }
        if let value = update["modelLadder"]?.arrayValue {
            item.modelLadder = value.compactMap(\.stringValue)
        }
        if let value = update["deliveryState"]?.stringValue {
            item.deliveryState = value
        }
        return item
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

        guard !item.mediaType.lowercased().contains("video") else { return false }

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
        guard !reviewWasteBasketQueueing else {
            reviewStatus = "Finish queueing the current Waste Basket action before undoing it."
            return
        }
        guard let entry = reviewHistory.last else {
            reviewStatus = "Nothing to undo in this Backstage session."
            return
        }
        guard !reviewWasteBasketPendingActionIDs.contains(entry.wasteBasketActionID) else {
            reviewStatus = "This Waste Basket action must finish before its Undo can be queued."
            return
        }
        let reviewClickStartedAt = Date()
        isRunningReview = true
        reviewStatus = "Undoing \(entry.label.lowercased())…"
        defer { isRunningReview = false }
        do {
            if !entry.wasteBasketMediaIDs.isEmpty {
                reviewWasteBasketQueueing = true
                let action = try await lifecycleService.enqueueRestore(
                    mediaIDs: entry.wasteBasketMediaIDs
                )
                reviewWasteBasketQueueing = false
                beginReviewWasteBasketAction(action)
                reviewHistory.removeLast()
                var retainedLocally = false
                if selectedFixtureID == entry.fixtureID {
                    reviewMode = entry.mode
                    reviewStateFilters = entry.stateFilters
                    reviewProposalAvailableOnly = entry.proposalAvailableOnly
                    reviewMediaFilters = entry.mediaFilters
                    reviewSearch = entry.search
                    reviewWindowOffset = entry.offset
                    retainedLocally = restoreWasteBasketReviewEntryInCurrentWindow(entry)
                }
                reviewStatus = "Queued Undo for \(entry.wasteBasketMediaIDs.count.formatted()) Waste Basket item\(entry.wasteBasketMediaIDs.count == 1 ? "" : "s") as action \(action.id). The local Review list is restored; durable reconciliation continues in the background."
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    do {
                        _ = try await self.lifecycleService.awaitCompletion(of: action) { [weak self] update in
                            Task { @MainActor [weak self] in
                                guard let self else { return }
                                self.updateReviewWasteBasketAction(update)
                                self.reviewStatus = self.pendingLifecycleActionStatus(
                                    "Review Undo",
                                    action: update,
                                    availability: "Review remains available while it completes."
                                )
                            }
                        }
                        self.finishReviewWasteBasketAction(action.id)
                        if !retainedLocally {
                            if self.selectedFixtureID == entry.fixtureID {
                                await self.loadFixtureReviewWindow(
                                    preferredAssetID: entry.focusedID ?? entry.selectedIDs.first
                                )
                            } else if !self.selectedFixtureID.isEmpty {
                                await self.loadFixtureReviewWindow()
                            }
                        }
                        self.reviewStatus = "Restored \(entry.wasteBasketMediaIDs.count.formatted()) item\(entry.wasteBasketMediaIDs.count == 1 ? "" : "s") from Waste Basket through action \(action.id)."
                    } catch {
                        if let ownerError = error as? OwnerActionRunError,
                           ownerError == .timedOut {
                            self.reviewStatus = self.pendingLifecycleActionStatus(
                                "Review Undo",
                                action: self.reviewWasteBasketPendingActions[action.id] ?? action,
                                availability: "Review remains available; check Activity for the full receipt."
                            )
                        } else {
                            self.finishReviewWasteBasketAction(action.id)
                            if !self.reviewHistory.contains(where: { $0.id == entry.id }) {
                                self.reviewHistory.append(entry)
                            }
                            if retainedLocally, self.selectedFixtureID == entry.fixtureID {
                                self.removeWasteBasketReviewEntryFromCurrentWindow(entry)
                            }
                            self.reviewStatus = "Waste Basket Undo failed; the local Review list was returned to the authoritative pending state. \(self.userFacingMessage(for: error))"
                        }
                    }
                }
                return
            }
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
                if selectedFixtureID == entry.fixtureID {
                    reviewMode = entry.mode
                    reviewStateFilters = entry.stateFilters
                    reviewProposalAvailableOnly = entry.proposalAvailableOnly
                    reviewMediaFilters = [.photos]
                    reviewSearch = entry.search
                    reviewWindowOffset = entry.offset
                    await loadFixtureReviewWindow(
                        preferredAssetID: entry.focusedID ?? entry.selectedIDs.first
                    )
                } else if !selectedFixtureID.isEmpty {
                    await loadFixtureReviewWindow()
                }
                reviewStatus = "Undid \(entry.label.lowercased()) for \(entry.fixtureChanges.count.formatted()) item\(entry.fixtureChanges.count == 1 ? "" : "s"); the current fixture stayed \(selectedFixtureBreadcrumb)."
                return
            }
            let result = try await fixtureService.undoReview(
                operationID: entry.operationID
            )
            reviewHistory.removeLast()
            if selectedFixtureID == entry.fixtureID {
                reviewMode = entry.mode
                reviewStateFilters = entry.stateFilters
                reviewProposalAvailableOnly = entry.proposalAvailableOnly
                reviewMediaFilters = [.photos]
                reviewSearch = entry.search
                reviewWindowOffset = entry.offset
                let retainedLocally = retainReviewUndoResultInCurrentWindow(
                    result,
                    restoring: entry.reviewItems,
                    indexes: entry.reviewItemIndexes
                )
                let orderedIDs: [String]
                if retainedLocally {
                    orderedIDs = reviewItems.map(\.id)
                } else {
                    let window = try await fixtureService.reviewWindow(
                        fixtureID: entry.fixtureID,
                        mode: entry.mode,
                        stateFilters: entry.stateFilters.map(\.rawValue).sorted(),
                        proposalAvailableOnly: entry.proposalAvailableOnly,
                        mediaFilters: [CullingMediaFilter.photos.rawValue],
                        offset: entry.offset,
                        limit: reviewWindowLimit,
                        search: entry.search
                    )
                    hydrateReviewProposalDrafts(from: window.items)
                    fixtureReviewWindow = window
                    orderedIDs = window.items.map(\.id)
                }
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
            } else if !selectedFixtureID.isEmpty {
                await loadFixtureReviewWindow()
            }
            recordReviewUITiming(result.timing, clickedAt: reviewClickStartedAt)
            reviewStatus = result.alreadyUndone
                ? "The Review action was already undone; the current fixture stayed \(selectedFixtureBreadcrumb)."
                : "Undid \(entry.label.lowercased()) for \(result.changes.count.formatted()) item\(result.changes.count == 1 ? "" : "s"); the current fixture stayed \(selectedFixtureBreadcrumb).\(reviewTimingSuffix(result.timing))"
            scheduleReviewAIStatusRefresh()
        } catch {
            reviewWasteBasketQueueing = false
            reviewStatus = "Undo failed: \(error)"
        }
    }

    var reviewUndoIsBlockedByPendingWasteBasketAction: Bool {
        guard let actionID = reviewHistory.last?.wasteBasketActionID,
              !actionID.isEmpty else {
            return false
        }
        return reviewWasteBasketPendingActionIDs.contains(actionID)
    }

    private func beginReviewWasteBasketAction(_ action: OwnerAction) {
        reviewWasteBasketPendingActionIDs.insert(action.id)
        reviewWasteBasketPendingActions[action.id] = action
        reviewWasteBasketPendingActionOrder.removeAll { $0 == action.id }
        reviewWasteBasketPendingActionOrder.append(action.id)
        refreshLatestReviewWasteBasketAction()
    }

    private func updateReviewWasteBasketAction(_ action: OwnerAction) {
        guard reviewWasteBasketPendingActionIDs.contains(action.id) else { return }
        reviewWasteBasketPendingActions[action.id] = action
        refreshLatestReviewWasteBasketAction()
    }

    private func finishReviewWasteBasketAction(_ actionID: String) {
        reviewWasteBasketPendingActionIDs.remove(actionID)
        reviewWasteBasketPendingActions.removeValue(forKey: actionID)
        reviewWasteBasketPendingActionOrder.removeAll { $0 == actionID }
        refreshLatestReviewWasteBasketAction()
    }

    private func refreshLatestReviewWasteBasketAction() {
        reviewWasteBasketPendingActionID = reviewWasteBasketPendingActionOrder.last
        reviewWasteBasketPendingAction = reviewWasteBasketPendingActionID.flatMap {
            reviewWasteBasketPendingActions[$0]
        }
    }

    /// Reinsert same-session Review X items without a full queue reload. The
    /// durable restore request has already been accepted before this cache repair.
    private func restoreWasteBasketReviewEntryInCurrentWindow(
        _ entry: ReviewHistoryEntry
    ) -> Bool {
        guard var window = fixtureReviewWindow,
              window.fixtureID == entry.fixtureID,
              window.mode == entry.mode else {
            return false
        }
        let restoredIDs = Set(entry.wasteBasketMediaIDs)
        var items = window.items.filter { !restoredIDs.contains($0.id) }
        for item in entry.reviewItems.sorted(by: {
            entry.reviewItemIndexes[$0.id, default: .max]
                < entry.reviewItemIndexes[$1.id, default: .max]
        }) {
            let index = min(entry.reviewItemIndexes[item.id, default: items.count], items.count)
            items.insert(item, at: index)
        }
        window.items = items
        fixtureReviewWindow = window
        hydrateReviewProposalDrafts(from: entry.reviewItems)
        let orderedIDs = items.map(\.id)
        let selectedIDs = entry.selectedIDs.intersection(orderedIDs)
        let focusedID = entry.focusedID.flatMap { orderedIDs.contains($0) ? $0 : nil }
            ?? selectedIDs.first
            ?? orderedIDs.first
        let anchorID = entry.anchorID.flatMap { orderedIDs.contains($0) ? $0 : nil }
            ?? focusedID
        reviewSelection = OwnerSelectionModel(
            orderedIDs: orderedIDs,
            selectedIDs: selectedIDs.isEmpty
                ? Set(focusedID.map { [$0] } ?? [])
                : selectedIDs,
            anchorID: anchorID,
            focusedID: focusedID
        )
        reviewScrollTargetID = focusedID
        syncReviewDraft()
        return true
    }

    /// Roll back an optimistic same-session Waste Basket restore after the
    /// durable restore action reaches a terminal failure.
    private func removeWasteBasketReviewEntryFromCurrentWindow(
        _ entry: ReviewHistoryEntry
    ) {
        guard var window = fixtureReviewWindow,
              window.fixtureID == entry.fixtureID,
              window.mode == entry.mode else {
            return
        }
        let removedIDs = Set(entry.wasteBasketMediaIDs)
        window.items.removeAll { removedIDs.contains($0.id) }
        fixtureReviewWindow = window
        let orderedIDs = window.items.map(\.id)
        let preferredIndex = entry.reviewItemIndexes.values.min() ?? 0
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
        syncReviewDraft()
    }

    func saveReviewMetadata() async {
        cancelReviewMetadataAutosave()
        await saveReviewMetadataIfNeeded()
    }

    func propagateReviewTitle() async {
        cancelReviewMetadataAutosave()
        await saveReviewMetadataIfNeeded()
        await applyReviewAction(.propagateTitle, propagate: true)
    }

    func propagateReviewKeywords() async {
        cancelReviewMetadataAutosave()
        await saveReviewMetadataIfNeeded()
        await applyReviewAction(.propagateKeywords, propagate: true)
    }

    func propagateReviewCountry() async {
        cancelReviewMetadataAutosave()
        await saveReviewMetadataIfNeeded()
        await applyReviewAction(.propagateCountry, propagate: true)
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

    private func scheduleReviewAIStatusRefresh() {
        reviewAIStatusRefreshTask?.cancel()
        reviewAIStatusRefreshGeneration += 1
        let generation = reviewAIStatusRefreshGeneration
        aiProposalStatus = "Refreshing AI status…"
        reviewAIStatusRefreshTask = Task { [weak self] in
            guard let self else { return }
            await self.refreshAIStatus(forGeneration: generation)
        }
    }

    func refreshAIStatus() async {
        await refreshAIStatus(forGeneration: nil)
    }

    private func refreshAIStatus(forGeneration generation: Int?) async {
        do {
            let status = try await fixtureService.aiStatus()
            guard !Task.isCancelled else { return }
            if let generation, generation != reviewAIStatusRefreshGeneration {
                return
            }
            fixtureAIStatus = status
            reviewAIAvailabilityToken = Self.aiAvailabilityToken(for: status)
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
            if let generation, generation != reviewAIStatusRefreshGeneration {
                return
            }
            aiProposalStatus = "AI status unavailable: \(error)"
        }
    }

    /// Poll AI progress without making the operator press a batch-load button.
    /// The Review window is rebuilt only when the durable ready-proposal
    /// frontier changes; clean arrivals hydrate as drafts, while the loader
    /// preserves the current page, selection, focus, and draft text.
    func refreshReviewAIAvailability() async {
        let previousToken = reviewAIAvailabilityToken
        await refreshAIStatus()
        let availabilityChanged = previousToken != reviewAIAvailabilityToken
        let hasAvailableProposals = readyAIProposalCount > 0
            || (fixtureAIStatus?.run?.proposed ?? 0) > 0
        guard availabilityChanged || reviewAIWindowRefreshPending else { return }
        guard hasAvailableProposals,
              !selectedFixtureID.isEmpty,
              fixtureReviewWindow != nil
        else { return }
        guard !isRunningReview else {
            reviewAIWindowRefreshPending = true
            return
        }
        reviewAIWindowRefreshPending = false
        await loadFixtureReviewWindow()
    }

    private static func aiAvailabilityToken(for status: FixtureAIStatus) -> String {
        [
            String(status.ready),
            status.run?.id ?? "",
            String(status.run?.proposed ?? 0),
            status.run?.status ?? "",
        ].joined(separator: "|")
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
        aiPassMonitoringDetached = false
        aiProposalStatus = "Starting or attaching to the requested AI pass…"
        defer { isRunningAIPass = false }
        do {
            fixtureAIStatus = try await fixtureService.startAIPass()
            repeat {
                try await Task.sleep(for: .seconds(2))
                guard !aiPassMonitoringDetached else { return }
                fixtureAIStatus = try await fixtureService.aiStatus()
                await refreshAIStatus()
            } while fixtureAIStatus?.active == true
            await loadFixtureReviewWindow(preferredAssetID: reviewSelection.focusedID)
        } catch {
            aiProposalStatus = "AI pass failed to start: \(error)"
        }
    }

    /// Stop only Backstage's progress monitor after the durable AI worker has
    /// been confirmed. The worker is already in its own process group and
    /// continues to persist proposals and its terminal receipt independently.
    @discardableResult
    func detachAIProposalPassForTermination() -> Bool {
        guard isRunningAIPass, fixtureAIStatus?.active == true else { return false }
        aiPassMonitoringDetached = true
        isRunningAIPass = false
        aiProposalStatus = "AI pass detached. It will continue in the background."
        return true
    }

    func cancelAIProposalPass() async {
        do {
            fixtureAIStatus = try await fixtureService.cancelAIPass()
            if fixtureAIStatus?.active == true {
                aiProposalStatus = "Cancellation requested; the current item may finish first."
            } else {
                await refreshAIStatus()
                await loadFixtureReviewWindow(preferredAssetID: reviewSelection.focusedID)
            }
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
                let hasManualConflict = existing.map {
                    !$0.isProposal || $0.hasManualEdits
                } ?? false
                if hasManualConflict, !replacingConflicts {
                    conflicts.insert(proposal.assetID)
                    continue
                }
                reviewProposalDrafts[proposal.assetID] = ReviewMetadataDraft(
                    country: proposal.proposedCountry.isEmpty
                        ? (reviewItems.first { $0.id == proposal.assetID }?.country ?? "")
                        : proposal.proposedCountry,
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
                    country: proposal.proposedCountry.isEmpty
                        ? (reviewItems.first { $0.id == proposal.assetID }?.country ?? "")
                        : proposal.proposedCountry,
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
                    let preview = try await renderedJPEGPreviewForAsset(
                        forAssetID: item.id,
                        preferredIdentifier: item.photoLibraryIdentifier,
                        maxPixelSize: 4_000
                    )
                    learnQuickLookEquipment(from: preview, for: item.id)
                    await learnCurrentImageByteCount(
                        from: preview,
                        for: item.id,
                        mediaType: item.mediaType,
                        persistPromptly: true
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
        if let draft {
            reviewCountry = draft.country
            reviewCountrySuggestionSeedAssetID = nil
            reviewCountrySuggestionSeedValue = ""
        } else if item.country.isEmpty, !item.suggestedCountry.isEmpty {
            reviewCountry = item.suggestedCountry
            reviewCountrySuggestionSeedAssetID = item.id
            reviewCountrySuggestionSeedValue = item.suggestedCountry
        } else {
            reviewCountry = item.country
            reviewCountrySuggestionSeedAssetID = nil
            reviewCountrySuggestionSeedValue = ""
        }
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
    /// the proposal's audit status. Clean arrivals replace only an untouched
    /// proposal draft; a manual draft remains visible and is surfaced as a
    /// conflict for the explicit replacement action.
    private func hydrateReviewProposalDrafts(from items: [FixtureReviewItem]) {
        var conflicts = reviewProposalConflictIDs
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
                    conflicts.remove(item.id)
                    continue
                }
                if !existing.isProposal || existing.hasManualEdits {
                    conflicts.insert(item.id)
                    continue
                }
            }
            reviewProposalDrafts[item.id] = ReviewMetadataDraft(
                country: item.proposedCountry.isEmpty ? item.country : item.proposedCountry,
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
            conflicts.remove(item.id)
        }
        reviewProposalConflictIDs = conflicts
    }

    private func clearReviewDraft() {
        reviewTitle = ""
        reviewKeywords = ""
        reviewCountry = ""
        reviewCountrySuggestionSeedAssetID = nil
        reviewCountrySuggestionSeedValue = ""
        reviewAIReasons = []
        reviewAINote = ""
    }

    private func preserveCurrentReviewDraft() {
        guard let item = focusedReviewItem else { return }
        let title = reviewTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let keywords = parsedReviewKeywords()
        let visibleCountry = reviewCountry.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let country = reviewCountrySuggestionSeedAssetID == item.id
            && reviewCountrySuggestionSeedValue == visibleCountry
            ? item.country
            : visibleCountry
        if let existing = reviewProposalDrafts[item.id], existing.isProposal {
            reviewProposalDrafts[item.id] = ReviewMetadataDraft(
                country: country,
                title: title,
                keywords: keywords,
                proposalID: existing.proposalID,
                hasManualEdits: existing.hasManualEdits
                    || title != existing.title
                    || keywords != existing.keywords
                    || country != existing.country,
                proposalReason: existing.proposalReason,
                proposalStatus: existing.proposalStatus,
                requestedGeneratorModel: existing.requestedGeneratorModel,
                resolvedModel: existing.resolvedModel,
                reasoningEffort: existing.reasoningEffort,
                vision: existing.vision
            )
        } else if title != item.title || keywords != item.keywords || country != item.country {
            reviewProposalDrafts[item.id] = ReviewMetadataDraft(
                country: country,
                title: title,
                keywords: keywords
            )
        } else {
            reviewProposalDrafts.removeValue(forKey: item.id)
        }
    }

    private func scheduleReviewMetadataAutosave() {
        preserveCurrentReviewDraft()
        cancelReviewMetadataAutosave()
        guard let assetID = focusedReviewItem?.id else { return }
        if let draft = reviewProposalDrafts[assetID], draft.isProposal {
            reviewStatus = draft.hasManualEdits
                ? "AI proposal draft edited. Press Approve to accept it."
                : "AI proposal remains a draft until you press Approve."
            return
        }
        guard reviewMetadataAutosaveIsNeeded else { return }
        hasPendingReviewMetadataAutosave = true
        let taskToken = UUID()
        reviewMetadataAutosaveTaskToken = taskToken
        reviewMetadataAutosaveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self else { return }
            guard self.focusedReviewItem?.id == assetID else { return }
            if self.isRunningReview {
                self.scheduleReviewMetadataAutosave()
                return
            }
            await self.saveReviewMetadataIfNeeded()
            guard self.reviewMetadataAutosaveTaskToken == taskToken else { return }
            self.reviewMetadataAutosaveTask = nil
            self.reviewMetadataAutosaveTaskToken = nil
            self.hasPendingReviewMetadataAutosave = false
        }
    }

    private func cancelReviewMetadataAutosave() {
        reviewMetadataAutosaveTask?.cancel()
        reviewMetadataAutosaveTask = nil
        reviewMetadataAutosaveTaskToken = nil
        hasPendingReviewMetadataAutosave = false
    }

    private func saveReviewMetadataIfNeeded() async {
        guard let item = focusedReviewItem else { return }
        // A visible AI proposal is an editable draft, never an autosave source.
        // Text-field focus commits can invoke their bindings during window
        // teardown even when the owner made no edit, so fail closed here as
        // well as in the scheduler. Only the explicit Approve action may
        // consume the proposal and write its three metadata fields.
        guard reviewProposalDrafts[item.id]?.isProposal != true else { return }
        let title = reviewTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let keywords = parsedReviewKeywords()
        let country = reviewCountry.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard title != item.title || keywords != item.keywords || country != item.country else { return }
        if country != item.country, fixtureReviewWindow?.countryWriteEnabled != true {
            reviewStatus = fixtureReviewWindow?.countryWriteBlockReason
                ?? "Country writes await the reviewed identity migration."
            return
        }
        await applyReviewAction(.editMetadata)
    }

    /// SwiftUI may commit an unchanged binding while the window is closing, so
    /// only a real field difference starts the explicit pending-save lifecycle.
    private var reviewMetadataAutosaveIsNeeded: Bool {
        guard let item = focusedReviewItem else { return false }
        guard reviewProposalDrafts[item.id]?.isProposal != true else { return false }
        let title = reviewTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let keywords = parsedReviewKeywords()
        let country = reviewCountry.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard title != item.title || keywords != item.keywords || country != item.country else {
            return false
        }
        if country != item.country, fixtureReviewWindow?.countryWriteEnabled != true {
            return false
        }
        return true
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
        case .editMetadata: "Save Country, title, and keywords"
        case .propagateCountry: "Propagate Country"
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
        if !entry.wasteBasketMediaIDs.isEmpty {
            if cullingWasteBasketPendingActionIDs.contains(entry.wasteBasketActionID),
               let pendingAction = cullingWasteBasketPendingActions[entry.wasteBasketActionID] {
                cullingHistory.removeLast()
                let restoredLocally = selectedFixtureID == entry.fixtureID
                    && restoreWasteBasketCullingEntryInCurrentWindow(entry)
                cullingWasteBasketDeferredUndoActionIDs.insert(entry.wasteBasketActionID)
                cullingStatus = "Undo requested for \(entry.wasteBasketMediaIDs.count.formatted()) Waste Basket item\(entry.wasteBasketMediaIDs.count == 1 ? "" : "s"). The local Culling grid is restored; durable Put Back will queue as soon as X finishes."
                Task { @MainActor [weak self] in
                    await self?.finishDeferredCullingWasteBasketUndo(
                        entry,
                        after: pendingAction,
                        restoredLocally: restoredLocally
                    )
                }
                return
            }
            cullingWasteBasketQueueing = true
            do {
                let action = try await lifecycleService.enqueueRestore(
                    mediaIDs: entry.wasteBasketMediaIDs
                )
                cullingWasteBasketQueueing = false
                beginCullingWasteBasketAction(action)
                cullingHistory.removeLast()
                let restoredLocally = selectedFixtureID == entry.fixtureID
                    && restoreWasteBasketCullingEntryInCurrentWindow(entry)
                cullingStatus = "Queued Undo for \(entry.wasteBasketMediaIDs.count.formatted()) Waste Basket item\(entry.wasteBasketMediaIDs.count == 1 ? "" : "s") as action \(action.id). The local Culling grid is restored; durable reconciliation continues in the background."
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    do {
                        _ = try await self.lifecycleService.awaitCompletion(of: action) { [weak self] update in
                            Task { @MainActor [weak self] in
                                guard let self else { return }
                                self.updateCullingWasteBasketAction(update)
                                self.cullingStatus = self.pendingLifecycleActionStatus(
                                    "Culling Undo",
                                    action: update,
                                    availability: "Culling remains available while it completes."
                                )
                            }
                        }
                        self.finishCullingWasteBasketAction(action.id)
                        if !restoredLocally, self.selectedFixtureID == entry.fixtureID {
                            await self.loadFixtureCullingWindow(preservingVisibleWindow: true)
                        }
                        self.cullingStatus = "Restored \(entry.wasteBasketMediaIDs.count.formatted()) item\(entry.wasteBasketMediaIDs.count == 1 ? "" : "s") from Waste Basket through action \(action.id)."
                    } catch {
                        if let ownerError = error as? OwnerActionRunError,
                           ownerError == .timedOut {
                            self.cullingStatus = self.pendingLifecycleActionStatus(
                                "Culling Undo",
                                action: self.cullingWasteBasketPendingActions[action.id] ?? action,
                                availability: "Culling remains available; check Activity for the full receipt."
                            )
                        } else {
                            self.finishCullingWasteBasketAction(action.id)
                            if !self.cullingHistory.contains(where: { $0.id == entry.id }) {
                                self.cullingHistory.append(entry)
                            }
                            if restoredLocally, self.selectedFixtureID == entry.fixtureID {
                                _ = self.removeWasteBasketCullingEntryFromCurrentWindow(
                                    entry,
                                    previousIDs: self.visibleCullingAssets.map(\.id),
                                    focusedID: entry.focusedID,
                                    removalDirection: .next
                                )
                            }
                            self.cullingStatus = "Waste Basket Undo failed; the local Culling grid was returned to the authoritative pending state. \(self.userFacingMessage(for: error))"
                        }
                    }
                }
            } catch {
                cullingWasteBasketQueueing = false
                cullingStatus = "Undo failed; the history step was preserved. \(userFacingMessage(for: error))"
            }
            return
        }
        if !entry.reviewOperationID.isEmpty {
            isApplyingCullingDecision = true
            defer { isApplyingCullingDecision = false }
            do {
                let result = try await fixtureService.undoReview(
                    operationID: entry.reviewOperationID
                )
                retainCullingReviewResultInCurrentWindow(result.changes)
                cullingHistory.removeLast()
                let orderedIDs = visibleCullingAssets.map(\.id)
                let selectedIDs = entry.selectedIDs.intersection(Set(orderedIDs))
                let focusedID = entry.focusedID.flatMap { orderedIDs.contains($0) ? $0 : nil }
                    ?? selectedIDs.first
                    ?? orderedIDs.first
                let anchorID = entry.anchorID.flatMap { orderedIDs.contains($0) ? $0 : nil }
                    ?? focusedID
                cullingSelection = OwnerSelectionModel(
                    orderedIDs: orderedIDs,
                    selectedIDs: selectedIDs.isEmpty
                        ? Set(focusedID.map { [$0] } ?? [])
                        : selectedIDs,
                    anchorID: anchorID,
                    focusedID: focusedID
                )
                selectedPhotoIDs = cullingSelection.selectedIDs
                cullingScrollTargetID = focusedID
                cullingStatus = result.alreadyUndone
                    ? "Return to Review was already undone; Gallery refreshed from the authoritative receipt."
                    : "Undid Return to Review and restored the exact approval and delivery states."
                scheduleFixtureCullingBackfill()
            } catch {
                cullingStatus = "Undo failed; the Return to Review history step was preserved. \(userFacingMessage(for: error))"
            }
            return
        }
        if !entry.fixtureChanges.isEmpty {
            do {
                let restoredChanges = try await fixtureService.undoState(
                    entry.fixtureChanges,
                    reason: "Undo \(entry.label)"
                )
                for change in restoredChanges {
                    var decision = cullingStates[change.assetID]
                        ?? SidecarDecisionState(assetId: change.assetID)
                    decision.pickState = change.placementState.rawValue
                    cullingStates[change.assetID] = decision
                }
                cullingHistory.removeLast()
                replaceCullingItems()
                let orderedIDs = visibleCullingAssets.map(\.id)
                let selectedIDs = entry.selectedIDs.intersection(Set(orderedIDs))
                let focusedID = entry.focusedID.flatMap {
                    orderedIDs.contains($0) ? $0 : nil
                } ?? selectedIDs.first ?? orderedIDs.first
                let anchorID = entry.anchorID.flatMap {
                    orderedIDs.contains($0) ? $0 : nil
                } ?? focusedID
                cullingSelection = OwnerSelectionModel(
                    orderedIDs: orderedIDs,
                    selectedIDs: selectedIDs.isEmpty
                        ? Set(focusedID.map { [$0] } ?? [])
                        : selectedIDs,
                    anchorID: anchorID,
                    focusedID: focusedID
                )
                selectedPhotoIDs = cullingSelection.selectedIDs
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

    var canUndoCurrentSection: Bool {
        switch selection ?? .overview {
        case .culling:
            !cullingHistory.isEmpty
        case .review:
            !reviewHistory.isEmpty
                && !isRunningReview
                && !reviewWasteBasketQueueing
                && !reviewUndoIsBlockedByPendingWasteBasketAction
        case .metadata:
            !metadataHistory.isEmpty
        default:
            false
        }
    }

    var currentUndoMenuTitle: String {
        switch selection ?? .overview {
        case .culling where !cullingHistory.isEmpty:
            "Undo Culling"
        case .review where !reviewHistory.isEmpty:
            "Undo Review"
        case .metadata where !metadataHistory.isEmpty:
            "Undo Metadata"
        default:
            "Undo"
        }
    }

    func undoCurrentSection() async {
        switch selection ?? .overview {
        case .culling:
            await undoLastCullingDecision()
        case .review:
            await undoLastReviewAction()
        case .metadata:
            await undoLastMetadataChange()
        default:
            break
        }
    }

    private func finishDeferredCullingWasteBasketUndo(
        _ entry: CullingHistoryEntry,
        after pendingAction: OwnerAction,
        restoredLocally: Bool
    ) async {
        while true {
            do {
                _ = try await lifecycleService.awaitCompletion(of: pendingAction) { [weak self] update in
                    Task { @MainActor [weak self] in
                        self?.updateCullingWasteBasketAction(update)
                    }
                }
                finishCullingWasteBasketAction(pendingAction.id)
                break
            } catch let ownerError as OwnerActionRunError where ownerError == .timedOut {
                cullingStatus = "Undo is still waiting for X action \(pendingAction.id) to finish. The local Culling grid remains restored."
                continue
            } catch {
                finishCullingWasteBasketAction(pendingAction.id)
                cullingWasteBasketDeferredUndoActionIDs.remove(pendingAction.id)
                cullingStatus = "X did not complete, so no durable Put Back was needed. The local Culling grid remains restored. \(userFacingMessage(for: error))"
                return
            }
        }

        do {
            let restoreAction = try await lifecycleService.enqueueRestore(
                mediaIDs: entry.wasteBasketMediaIDs
            )
            beginCullingWasteBasketAction(restoreAction)
            cullingWasteBasketDeferredUndoActionIDs.remove(pendingAction.id)
            cullingStatus = "Queued durable Put Back for the immediate Undo as action \(restoreAction.id). The local Culling grid remains restored while reconciliation completes."
            monitorCullingWasteBasketRestore(
                restoreAction,
                entry: entry,
                restoredLocally: restoredLocally
            )
        } catch {
            cullingWasteBasketDeferredUndoActionIDs.remove(pendingAction.id)
            if restoredLocally, selectedFixtureID == entry.fixtureID {
                _ = removeWasteBasketCullingEntryFromCurrentWindow(
                    entry,
                    previousIDs: visibleCullingAssets.map(\.id),
                    focusedID: entry.focusedID,
                    removalDirection: .next
                )
            }
            if !cullingHistory.contains(where: { $0.id == entry.id }) {
                cullingHistory.append(entry)
            }
            cullingStatus = "Undo could not be queued after X completed; the history step was preserved. \(userFacingMessage(for: error))"
        }
    }

    private func monitorCullingWasteBasketRestore(
        _ action: OwnerAction,
        entry: CullingHistoryEntry,
        restoredLocally: Bool
    ) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                _ = try await self.lifecycleService.awaitCompletion(of: action) { [weak self] update in
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        self.updateCullingWasteBasketAction(update)
                        self.cullingStatus = self.pendingLifecycleActionStatus(
                            "Culling Undo",
                            action: update,
                            availability: "Culling remains available while it completes."
                        )
                    }
                }
                self.finishCullingWasteBasketAction(action.id)
                if !restoredLocally, self.selectedFixtureID == entry.fixtureID {
                    await self.loadFixtureCullingWindow(preservingVisibleWindow: true)
                }
                self.cullingStatus = "Restored \(entry.wasteBasketMediaIDs.count.formatted()) item\(entry.wasteBasketMediaIDs.count == 1 ? "" : "s") from Waste Basket through action \(action.id)."
            } catch {
                if let ownerError = error as? OwnerActionRunError,
                   ownerError == .timedOut {
                    self.cullingStatus = self.pendingLifecycleActionStatus(
                        "Culling Undo",
                        action: self.cullingWasteBasketPendingActions[action.id] ?? action,
                        availability: "Culling remains available; check Activity for the full receipt."
                    )
                } else {
                    self.finishCullingWasteBasketAction(action.id)
                    if !self.cullingHistory.contains(where: { $0.id == entry.id }) {
                        self.cullingHistory.append(entry)
                    }
                    if restoredLocally, self.selectedFixtureID == entry.fixtureID {
                        _ = self.removeWasteBasketCullingEntryFromCurrentWindow(
                            entry,
                            previousIDs: self.visibleCullingAssets.map(\.id),
                            focusedID: entry.focusedID,
                            removalDirection: .next
                        )
                    }
                    self.cullingStatus = "Waste Basket Undo failed; the local Culling grid was returned to the authoritative pending state. \(self.userFacingMessage(for: error))"
                }
            }
        }
    }

    private func beginCullingWasteBasketAction(_ action: OwnerAction) {
        cullingWasteBasketPendingActionIDs.insert(action.id)
        cullingWasteBasketPendingActions[action.id] = action
        cullingWasteBasketPendingActionOrder.removeAll { $0 == action.id }
        cullingWasteBasketPendingActionOrder.append(action.id)
        refreshLatestCullingWasteBasketAction()
    }

    private func updateCullingWasteBasketAction(_ action: OwnerAction) {
        guard cullingWasteBasketPendingActionIDs.contains(action.id) else { return }
        cullingWasteBasketPendingActions[action.id] = action
        refreshLatestCullingWasteBasketAction()
    }

    private func finishCullingWasteBasketAction(_ actionID: String) {
        cullingWasteBasketPendingActionIDs.remove(actionID)
        cullingWasteBasketPendingActions.removeValue(forKey: actionID)
        cullingWasteBasketPendingActionOrder.removeAll { $0 == actionID }
        refreshLatestCullingWasteBasketAction()
    }

    private func refreshLatestCullingWasteBasketAction() {
        cullingWasteBasketPendingActionID = cullingWasteBasketPendingActionOrder.last
        cullingWasteBasketPendingAction = cullingWasteBasketPendingActionID.flatMap {
            cullingWasteBasketPendingActions[$0]
        }
    }

    @discardableResult
    private func removeWasteBasketCullingEntryFromCurrentWindow(
        _ entry: CullingHistoryEntry,
        previousIDs: [String],
        focusedID: String?,
        removalDirection: OwnerSelectionDirection
    ) -> String? {
        guard var window = fixtureCullingWindow,
              window.fixtureID == entry.fixtureID,
              window.offset == entry.windowOffset else {
            replaceCullingItems()
            return nil
        }
        let removedIDs = Set(entry.wasteBasketMediaIDs)
        window.items.removeAll { removedIDs.contains($0.id) }
        adjustCullingSummary(&window, for: entry.cullingItems, delta: -1)
        fixtureCullingWindow = window
        let orderedIDs = visibleCullingAssets.map(\.id)
        var selection = OwnerSelectionModel(
            orderedIDs: previousIDs,
            selectedIDs: Set(focusedID.map { [$0] } ?? []),
            anchorID: focusedID,
            focusedID: focusedID
        )
        let replacementID = focusedID.flatMap {
            selection.replaceItems(
                orderedIDs,
                selectingSuccessorAfterRemoving: $0,
                direction: removalDirection
            )
        }
        cullingSelection = selection
        selectedPhotoIDs = selection.selectedIDs
        return replacementID
    }

    private func restoreWasteBasketCullingEntryInCurrentWindow(
        _ entry: CullingHistoryEntry
    ) -> Bool {
        guard var window = fixtureCullingWindow,
              window.fixtureID == entry.fixtureID,
              window.offset == entry.windowOffset else {
            return false
        }
        let restoredIDs = Set(entry.wasteBasketMediaIDs)
        var items = window.items.filter { !restoredIDs.contains($0.id) }
        let newlyRestoredItems = entry.cullingItems.filter { restoredItem in
            !items.contains(where: { $0.id == restoredItem.id })
        }
        items.append(contentsOf: newlyRestoredItems)
        items.sort { left, right in
            let leftIndex = cullingStableWindowIndexes[left.id]
                ?? entry.cullingItemIndexes[left.id].map { entry.windowOffset + $0 }
                ?? .max
            let rightIndex = cullingStableWindowIndexes[right.id]
                ?? entry.cullingItemIndexes[right.id].map { entry.windowOffset + $0 }
                ?? .max
            return leftIndex < rightIndex
        }
        window.items = items
        adjustCullingSummary(&window, for: newlyRestoredItems, delta: 1)
        fixtureCullingWindow = window
        let orderedIDs = visibleCullingAssets.map(\.id)
        let selectedIDs = entry.selectedIDs.intersection(orderedIDs)
        let focusedID = entry.focusedID.flatMap { orderedIDs.contains($0) ? $0 : nil }
            ?? selectedIDs.first
            ?? orderedIDs.first
        let anchorID = entry.anchorID.flatMap { orderedIDs.contains($0) ? $0 : nil }
            ?? focusedID
        cullingSelection = OwnerSelectionModel(
            orderedIDs: orderedIDs,
            selectedIDs: selectedIDs.isEmpty
                ? Set(focusedID.map { [$0] } ?? [])
                : selectedIDs,
            anchorID: anchorID,
            focusedID: focusedID
        )
        selectedPhotoIDs = cullingSelection.selectedIDs
        return true
    }

    private func adjustCullingSummary(
        _ window: inout FixtureCullingWindow,
        for items: [FixtureAsset],
        delta: Int
    ) {
        guard !items.isEmpty else { return }
        window.summary.filtered = max(0, window.summary.filtered + (items.count * delta))
        window.summary.universe = max(0, window.summary.universe + (items.count * delta))
        for item in items {
            switch item.placementState {
            case .undecided:
                window.summary.undecided = max(0, window.summary.undecided + delta)
            case .picked:
                window.summary.picked = max(0, window.summary.picked + delta)
            case .hidden:
                window.summary.hidden = max(0, window.summary.hidden + delta)
            }
        }
    }

    func prepareLifecycleQuickLookURL(for item: LifecycleItem) async -> URL? {
        let directory = FileManager.default.urls(
            for: .cachesDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent(
            "com.photosbyelie.backstage/WasteBasketQuickLook",
            isDirectory: true
        )
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            if item.mediaType == "video" {
                let receipt = try await exportOriginalForAsset(
                    forAssetID: item.mediaID,
                    preferredIdentifier: item.photoLibraryIdentifier,
                    to: directory
                )
                lifecycleStatus = "Prepared one private Waste Basket Quick Look item from Photos."
                return receipt.destination
            }

            let preview = try await renderedJPEGPreviewForAsset(
                forAssetID: item.mediaID,
                preferredIdentifier: item.photoLibraryIdentifier,
                maxPixelSize: 4_000
            )
            learnQuickLookEquipment(from: preview, for: item.mediaID)
            await learnCurrentImageByteCount(
                from: preview,
                for: item.mediaID,
                mediaType: item.mediaType,
                persistPromptly: true
            )
            let destination = directory
                .appendingPathComponent(item.mediaID.replacingOccurrences(of: "/", with: "_"))
                .appendingPathExtension("jpg")
            try preview.jpegData.write(to: destination, options: .atomic)
            lifecycleStatus = "Prepared one private Waste Basket Quick Look item from Apple Photos."
            return destination
        } catch {
            lifecycleStatus = "Waste Basket Quick Look unavailable: \(userFacingMessage(for: error))"
            return nil
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
                    let preview = try await renderedJPEGPreviewForAsset(
                        forAssetID: id,
                        preferredIdentifier: photoLibraryIdentifier(for: id),
                        maxPixelSize: 4_000
                    )
                    learnQuickLookEquipment(from: preview, for: id)
                    if let image = NSImage(data: preview.jpegData) {
                        recoverCullingThumbnail(image, for: id)
                    }
                    await learnCurrentImageByteCount(
                        from: preview,
                        for: id,
                        mediaType: asset?.mediaType ?? "photo",
                        persistPromptly: true
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

    @discardableResult
    private func applyCullingDecisions(
        _ decisions: [SidecarDecision],
        label: String
    ) async -> Bool {
        guard await preparePhotosMutation() else {
            cullingStatus = photosMutationReadinessMessage()
            return false
        }
        if cullingPool == nil {
            invalidateCullingWindowLoads()
        }
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
                    return false
                }
                let end = min(decisions.count, start + 200)
                let batch = try await decisionService.applyDetailed(
                    Array(decisions[start..<end]),
                    idempotencyKey: "native-culling-\(UUID().uuidString)"
                )
                for change in batch {
                    cullingStates[change.assetID] = mergedCullingState(for: change)
                }
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
            return true
        } catch {
            cullingStatus = userFacingMessage(for: error)
            return false
        }
    }

    private func mergedCullingState(for change: SidecarDecisionChange) -> SidecarDecisionState {
        guard cullingPool == nil,
              fixtureCullingWindow != nil,
              var current = cullingStates[change.assetID]
        else {
            return change.state
        }

        // Fixture placement is local to the active fixture. Rating/color and
        // metadata updates come from the global Sidecar ledger, whose
        // pickState must not replace the fixture's placement state.
        let families = Set(change.changedFamilies)
        if families.contains("rating") {
            current.rating = change.state.rating
        }
        if families.contains("color") {
            current.color = change.state.color
        }
        if families.contains("metadata") {
            current.metadataState = change.state.metadataState
            current.title = change.state.title
            current.keywords = change.state.keywords
        }
        if families.contains("pick_state") {
            current.pickState = change.state.pickState
        }
        if families.contains("tombstone") {
            current.tombstoneState = change.state.tombstoneState
        }
        current.updatedAt = change.state.updatedAt
        return current
    }

    @discardableResult
    private func applyFixturePlacement(
        _ state: FixturePlacementState,
        label: String,
        removalDirection: OwnerSelectionDirection = .next
    ) async -> Bool {
        let ids = selectedCullingAssetIDs
        guard !selectedFixtureID.isEmpty, !ids.isEmpty else {
            cullingStatus = "Choose a fixture and select one or more Photos items."
            return false
        }
        if cullingPool == nil {
            invalidateCullingWindowLoads()
        }
        let selectedBefore = cullingSelection.selectedIDs
        let anchorBefore = cullingSelection.anchorID
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
                selectingSuccessorAfterRemoving: focusedBefore,
                direction: removalDirection
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
                fixtureID: selectedFixtureID,
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
                selectedIDs: selectedBefore,
                anchorID: anchorBefore,
                focusedID: focusedBefore
            ))
            if cullingPool == nil {
                scheduleFixtureCullingBackfill()
            } else {
                replaceCullingItems()
            }
            let skipped = max(0, ids.count - changes.count)
            cullingStatus = "\(label) saved. Affected \(changes.count.formatted()) • skipped \(skipped.formatted()) • failed 0."
            return true
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
            cullingStatus = "\(label) failed. Affected 0 • skipped 0 • failed \(ids.count.formatted()). \(userFacingMessage(for: error))"
            return false
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

    func loadMetadataModelLadderIfNeeded() async {
        guard !hasLoadedMetadataModelLadder, !isLoadingMetadataModelLadder else { return }
        isLoadingMetadataModelLadder = true
        defer { isLoadingMetadataModelLadder = false }
        do {
            let loaded = try await metadataReviewService.modelLadder()
            if !loaded.isEmpty {
                metadataModelLadder = loaded
            }
            hasLoadedMetadataModelLadder = true
            metadataModelLadderStatus = "Saved ladder loaded: \(metadataModelLadder.map(\.label).joined(separator: " → "))."
        } catch {
            metadataModelLadderStatus = userFacingMessage(for: error)
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

    private func recordMetadataHistory(_ entry: MetadataHistoryEntry) {
        metadataHistory.append(entry)
        if metadataHistory.count > 100 {
            metadataHistory.removeFirst(metadataHistory.count - 100)
        }
    }

    func loadLifecycle(successStatus: String? = nil) async {
        isRunningLifecycle = true
        lifecycleStatus = "Loading the private lifecycle ledger…"
        defer { isRunningLifecycle = false }
        do {
            let ledger = try await lifecycleService.ledger()
            lifecycleItems = ledger.items
            selectedLifecycleIDs.formIntersection(Set(ledger.items.map(\.id)))
            lifecycleRecoverableCount = ledger.hiddenCount
            lifecycleTombstoneCount = ledger.discardedCount
            refreshLifecycleCountSummary()
            lifecycleStatus = successStatus
                ?? "\(ledger.hiddenCount) recoverable and \(ledger.discardedCount) active global tombstone item\(ledger.items.count == 1 ? "" : "s")."
        } catch {
            lifecycleStatus = userFacingMessage(for: error)
        }
    }

    func restoreLifecycleSelection() async {
        guard !isRunningLifecycle, !lifecycleRestoreQueueing else {
            lifecycleStatus = lifecycleRestoreQueueing
                ? "This Put Back action is already being queued; the Waste Basket remains available."
                : "Finish the current Waste Basket refresh first."
            return
        }
        let selectedItems = lifecycleItems.enumerated().compactMap { index, item in
            selectedLifecycleIDs.contains(item.id) && item.state == "hidden"
                ? (index, item)
                : nil
        }
        let ids = selectedItems.map { $0.1.id }
        guard !ids.isEmpty else {
            lifecycleStatus = "Select one or more recoverable items."
            return
        }
        let priorSelection = selectedLifecycleIDs
        lifecycleRestoreQueueing = true
        lifecycleStatus = "Submitting Put Back for \(ids.count.formatted()) item\(ids.count == 1 ? "" : "s")… The Waste Basket remains available."
        do {
            let action = try await lifecycleService.enqueueRestore(mediaIDs: ids)
            lifecycleRestoreQueueing = false
            beginLifecycleRestoreAction(action)
            let removedIDs = Set(ids)
            lifecycleItems.removeAll { removedIDs.contains($0.id) }
            selectedLifecycleIDs.subtract(removedIDs)
            lifecycleRecoverableCount = max(0, lifecycleRecoverableCount - ids.count)
            refreshLifecycleCountSummary()
            lifecycleStatus = "Queued Put Back for \(ids.count.formatted()) item\(ids.count == 1 ? "" : "s") as action \(action.id). The selected row\(ids.count == 1 ? " is" : "s are") removed locally; durable reconciliation continues in the background."
            Task { @MainActor [weak self] in
                guard let self else { return }
                do {
                    _ = try await self.lifecycleService.awaitCompletion(of: action) { [weak self] update in
                        Task { @MainActor [weak self] in
                            guard let self else { return }
                            self.updateLifecycleRestoreAction(update)
                            self.lifecycleStatus = self.pendingLifecycleActionStatus(
                                "Put Back",
                                action: update,
                                availability: "The remaining Waste Basket rows and Quick Look remain available."
                            )
                        }
                    }
                    self.finishLifecycleRestoreAction(action.id)
                    self.lifecycleStatus = "Restored \(ids.count) item\(ids.count == 1 ? "" : "s") with saved private titles through action \(action.id)."
                } catch {
                    if let ownerError = error as? OwnerActionRunError,
                       ownerError == .timedOut {
                        self.lifecycleStatus = self.pendingLifecycleActionStatus(
                            "Put Back",
                            action: self.lifecycleRestorePendingActions[action.id] ?? action,
                            availability: "The remaining Waste Basket rows and Quick Look remain available; check Activity for the full receipt."
                        )
                    } else {
                        self.finishLifecycleRestoreAction(action.id)
                        for (index, item) in selectedItems.sorted(by: { $0.0 < $1.0 }) {
                            guard !self.lifecycleItems.contains(where: { $0.id == item.id }) else {
                                continue
                            }
                            self.lifecycleItems.insert(item, at: min(index, self.lifecycleItems.count))
                        }
                        self.selectedLifecycleIDs.formUnion(priorSelection)
                        self.lifecycleRecoverableCount += selectedItems.count
                        self.refreshLifecycleCountSummary()
                        self.lifecycleStatus = "Put Back failed; the selected Waste Basket row\(ids.count == 1 ? " was" : "s were") restored locally. \(self.userFacingMessage(for: error))"
                    }
                }
            }
        } catch {
            lifecycleRestoreQueueing = false
            lifecycleStatus = userFacingMessage(for: error)
        }
    }

    private func beginLifecycleRestoreAction(_ action: OwnerAction) {
        lifecycleRestorePendingActionIDs.insert(action.id)
        lifecycleRestorePendingActions[action.id] = action
        lifecycleRestorePendingActionOrder.removeAll { $0 == action.id }
        lifecycleRestorePendingActionOrder.append(action.id)
        refreshLatestLifecycleRestoreAction()
    }

    private func updateLifecycleRestoreAction(_ action: OwnerAction) {
        guard lifecycleRestorePendingActionIDs.contains(action.id) else { return }
        lifecycleRestorePendingActions[action.id] = action
        refreshLatestLifecycleRestoreAction()
    }

    private func finishLifecycleRestoreAction(_ actionID: String) {
        lifecycleRestorePendingActionIDs.remove(actionID)
        lifecycleRestorePendingActions.removeValue(forKey: actionID)
        lifecycleRestorePendingActionOrder.removeAll { $0 == actionID }
        refreshLatestLifecycleRestoreAction()
    }

    private func refreshLatestLifecycleRestoreAction() {
        lifecycleRestorePendingActionID = lifecycleRestorePendingActionOrder.last
    }

    private func refreshLifecycleCountSummary() {
        lifecycleCountSummary = "\(lifecycleRecoverableCount.formatted()) recoverable • \(lifecycleTombstoneCount.formatted()) active global tombstone\(lifecycleTombstoneCount == 1 ? "" : "s")"
    }

    func emptyWasteBasket() async {
        guard !isRunningLifecycle, !lifecycleQueueing, lifecyclePendingActionID == nil else {
            lifecycleStatus = lifecycleQueueing || lifecyclePendingActionID != nil
                ? "A Waste Basket action is already queued; browsing and Quick Look remain available while it completes."
                : "Finish the current Waste Basket action first."
            return
        }
        lifecycleQueueing = true
        lifecycleStatus = "Submitting Empty Waste Basket… Browsing and Quick Look remain available."
        lifecycleMonitorTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let action = try await self.lifecycleService.enqueueEmptyWasteBasket(confirmed: true)
                self.lifecycleQueueing = false
                self.lifecyclePendingActionID = action.id
                self.lifecyclePendingAction = action
                self.retainLocallyObservedLifecycleAction(action)
                self.lifecycleStatus = "Empty Waste Basket queued as action \(action.id). Browsing and Quick Look remain available while it completes."
                do {
                    let completed = try await self.lifecycleService.awaitCompletion(of: action) { [weak self] update in
                        Task { @MainActor [weak self] in
                            guard let self else { return }
                            self.lifecyclePendingAction = update
                            self.retainLocallyObservedLifecycleAction(update)
                            self.lifecycleStatus = self.pendingLifecycleActionStatus(
                                "Empty Waste Basket",
                                action: update,
                                availability: "Browsing and Quick Look remain available while it completes."
                            )
                        }
                    }
                    self.retainLocallyObservedLifecycleAction(completed)
                    self.lifecyclePendingActionID = nil
                    self.lifecyclePendingAction = nil
                    let lifecycle = completed.result?["lifecycle"]?.objectValue
                    let retainedLocalOnlyCount = lifecycle?["retainedLocalOnlyAssetIds"]?.arrayValue?.count ?? 0
                    let completionStatus: String
                    if retainedLocalOnlyCount > 0 {
                        let emptiedCount = completed.result?["result"]?.objectValue?["assetIds"]?.arrayValue?.count ?? 0
                        completionStatus = "Empty Waste Basket activated the audited global tombstone state for \(emptiedCount.formatted()) deployed item\(emptiedCount == 1 ? "" : "s") through action \(action.id). \(retainedLocalOnlyCount.formatted()) local-only item\(retainedLocalOnlyCount == 1 ? " remains" : "s remain") recoverable because no cloud media exists. Source and R2 media were retained."
                    } else {
                        completionStatus = "Empty Waste Basket activated the audited global tombstone state through action \(action.id). Source and R2 media were retained."
                    }
                    await self.loadLifecycle(successStatus: completionStatus)
                } catch {
                    if let ownerError = error as? OwnerActionRunError,
                       ownerError == .timedOut {
                        self.lifecycleStatus = self.pendingLifecycleActionStatus(
                            "Empty Waste Basket",
                            action: self.lifecyclePendingAction ?? action,
                            availability: "Browsing and Quick Look remain available; check Activity for the full receipt."
                        )
                    } else {
                        let failed = self.lifecyclePendingAction ?? action
                        self.retainLocallyObservedLifecycleAction(failed)
                        self.lifecyclePendingActionID = nil
                        self.lifecyclePendingAction = nil
                        self.lifecycleStatus = "Empty Waste Basket action \(action.id) failed. All current rows remain recoverable; no retry was started. \(self.userFacingMessage(for: error))"
                    }
                }
            } catch {
                self.lifecycleQueueing = false
                self.lifecyclePendingAction = nil
                self.lifecycleStatus = "Empty Waste Basket was not queued. No items changed. \(self.userFacingMessage(for: error))"
            }
            self.lifecycleMonitorTask = nil
        }
    }

    var selectedRecoverableLifecycleIDs: [String] {
        lifecycleItems
            .filter { selectedLifecycleIDs.contains($0.id) && $0.state == "hidden" }
            .map(\.id)
            .sorted()
    }

    func emptyWasteBasketSelection() async {
        guard !isRunningLifecycle, !lifecycleQueueing, lifecyclePendingActionID == nil else {
            lifecycleStatus = lifecycleQueueing || lifecyclePendingActionID != nil
                ? "A Waste Basket action is already queued; browsing and Quick Look remain available while it completes."
                : "Finish the current Waste Basket action first."
            return
        }
        let ids = selectedRecoverableLifecycleIDs
        guard !ids.isEmpty else {
            lifecycleStatus = "Select one or more recoverable items before choosing Delete Selected."
            return
        }
        lifecycleQueueing = true
        lifecycleStatus = "Submitting Delete Selected for \(ids.count.formatted()) item\(ids.count == 1 ? "" : "s")… Browsing and Quick Look remain available."
        lifecycleMonitorTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let action = try await self.lifecycleService.enqueueEmptyWasteBasket(
                    mediaIDs: ids,
                    confirmed: true
                )
                self.lifecycleQueueing = false
                self.lifecyclePendingActionID = action.id
                self.lifecyclePendingAction = action
                self.retainLocallyObservedLifecycleAction(action)
                self.lifecycleStatus = "Delete Selected queued as action \(action.id). Browsing and Quick Look remain available while it completes."
                do {
                    let completed = try await self.lifecycleService.awaitCompletion(of: action) { [weak self] update in
                        Task { @MainActor [weak self] in
                            guard let self else { return }
                            self.lifecyclePendingAction = update
                            self.retainLocallyObservedLifecycleAction(update)
                            self.lifecycleStatus = self.pendingLifecycleActionStatus(
                                "Delete Selected",
                                action: update,
                                availability: "Browsing and Quick Look remain available while it completes."
                            )
                        }
                    }
                    self.retainLocallyObservedLifecycleAction(completed)
                    self.lifecyclePendingActionID = nil
                    self.lifecyclePendingAction = nil
                    self.lifecycleStatus = "Deleted \(ids.count.formatted()) selected recoverable item\(ids.count == 1 ? "" : "s") through action \(action.id). Source media and R2 objects were retained."
                    await self.loadLifecycle()
                } catch {
                    if let ownerError = error as? OwnerActionRunError,
                       ownerError == .timedOut {
                        self.lifecycleStatus = self.pendingLifecycleActionStatus(
                            "Delete Selected",
                            action: self.lifecyclePendingAction ?? action,
                            availability: "Browsing and Quick Look remain available; check Activity for the full receipt."
                        )
                    } else {
                        let failed = self.lifecyclePendingAction ?? action
                        self.retainLocallyObservedLifecycleAction(failed)
                        self.lifecyclePendingActionID = nil
                        self.lifecyclePendingAction = nil
                        self.lifecycleStatus = "Delete Selected action \(action.id) failed. The selected rows remain recoverable; no retry was started. \(self.userFacingMessage(for: error))"
                    }
                }
            } catch {
                self.lifecycleQueueing = false
                self.lifecyclePendingAction = nil
                self.lifecycleStatus = "Delete Selected was not queued. No items changed. \(self.userFacingMessage(for: error))"
            }
            self.lifecycleMonitorTask = nil
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

    func loadNativeUploadPlan(order requestedOrder: NativeUploadPlanOrder? = nil) async {
        guard !selectedFixtureID.isEmpty else {
            nativeUploadPlan = nil
            nativeUploadStatus = "Choose a fixture to load its approved publication queue."
            return
        }
        let order = requestedOrder ?? nativeUploadPlan?.order ?? .oldest
        isRunningDelivery = true
        nativeUploadStatus = "Loading approved publication eligibility…"
        defer { isRunningDelivery = false }
        do {
            let plan = try await deliveryService.nativeUploadPlan(
                fixtureID: selectedFixtureID,
                limit: 200,
                order: order
            )
            nativeUploadPlan = plan
            await hydrateCurrentImageByteCounts(for: plan.items.map(\.id))
            selectedDeliveryIDs.formIntersection(Set(plan.items.map(\.id)))
            if !plan.cloudAllowed {
                nativeUploadStatus = "\(plan.fixtureName) policy does not permit cloud publication."
            } else if plan.needsUploadCount == 0 {
                nativeUploadStatus = "\(plan.approvedCount) approved • \(plan.mediaUploadedCount) media uploaded • \(plan.liveOnWebsiteCount) live on website • \(plan.needsReviewCount) picked awaiting Review • nothing needs upload."
            } else {
                nativeUploadStatus = "\(plan.needsUploadCount) approved need upload • \(plan.mediaUploadedCount) media uploaded • \(plan.liveOnWebsiteCount) live on website • \(plan.needsReviewCount) picked awaiting Review. Showing \(plan.items.count) \(plan.order.label)."
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

    func prepareNativeUploadQuickLookURL(for item: NativeUploadPlanItem) async -> URL? {
        let result = await prepareCanonicalQuickLookURL(
            assetID: item.id,
            localIdentifier: item.photoLibraryIdentifier,
            namespace: "UploadQuickLook"
        )
        if result == nil {
            nativeUploadStatus = "The Upload preview could not be prepared. The approved item is unchanged."
        }
        return result
    }

    func prepareMetadataQuickLookURL(
        for assetID: String,
        preferredIdentifier: String? = nil
    ) async -> URL? {
        let result = await prepareCanonicalQuickLookURL(
            assetID: assetID,
            localIdentifier: preferredIdentifier ?? photoLibraryIdentifier(for: assetID),
            namespace: "MetadataQuickLook"
        )
        if result == nil {
            metadataReviewStatus = "The Metadata preview could not be prepared. No metadata was changed."
        }
        return result
    }

    private func prepareCanonicalQuickLookURL(
        assetID: String,
        localIdentifier: String,
        namespace: String
    ) async -> URL? {
        let directory = FileManager.default.urls(
            for: .cachesDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent(
            "com.photosbyelie.backstage/\(namespace)",
            isDirectory: true
        )
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            let preview = try await renderedJPEGPreviewForAsset(
                forAssetID: assetID,
                preferredIdentifier: localIdentifier,
                maxPixelSize: 4_000
            )
            learnQuickLookEquipment(from: preview, for: assetID)
            await learnCurrentImageByteCount(
                from: preview,
                for: assetID,
                mediaType: "photo",
                persistPromptly: true
            )
            let safeName = assetID
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: ":", with: "_")
            let destination = directory
                .appendingPathComponent(safeName)
                .appendingPathExtension("jpg")
            try preview.jpegData.write(to: destination, options: .atomic)
            return destination
        } catch {
            return nil
        }
    }

    func quickLookEquipment(
        for assetID: String,
        cameraBody: String = "",
        lens: String = "",
        focalLength: String = ""
    ) -> BackstageQuickLookEquipment {
        let learned = quickLookEquipmentByAssetID[assetID]
        return BackstageQuickLookEquipment(
            cameraBody: preferredQuickLookEquipmentValue(cameraBody, learned?.cameraBody),
            lens: preferredQuickLookEquipmentValue(lens, learned?.lens),
            focalLength: preferredQuickLookEquipmentValue(focalLength, learned?.focalLength)
        )
    }

    private func learnQuickLookEquipment(from preview: PhotoPreview, for assetID: String) {
        let equipment = BackstageQuickLookEquipment(
            cameraBody: preview.cameraBody,
            lens: preview.lens,
            focalLength: preview.focalLength
        )
        guard equipment.displayValue != nil else { return }
        quickLookEquipmentByAssetID[assetID] = equipment
    }

    private func preferredQuickLookEquipmentValue(
        _ authoritative: String,
        _ learned: String?
    ) -> String {
        authoritative.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? learned ?? ""
            : authoritative
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
                    mediaUploadedCount: current.mediaUploadedCount,
                    projectionPendingCount: current.projectionPendingCount,
                    projectionFailedCount: current.projectionFailedCount,
                    deploymentPendingCount: current.deploymentPendingCount,
                    deploymentFailedCount: current.deploymentFailedCount,
                    liveOnWebsiteCount: current.liveOnWebsiteCount,
                    order: current.order,
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
                    mediaUploadedCount: current.mediaUploadedCount,
                    projectionPendingCount: current.projectionPendingCount,
                    projectionFailedCount: current.projectionFailedCount,
                    deploymentPendingCount: current.deploymentPendingCount,
                    deploymentFailedCount: current.deploymentFailedCount,
                    liveOnWebsiteCount: current.liveOnWebsiteCount,
                    order: current.order,
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
            } else if report.status == "cancelled" {
                photosSyncStatus = "Stopped safely after \(report.scanned) of \(report.requested); \(report.remaining) remain for the next pass. Completed checkpoints are recorded."
            } else if report.status == "failed" {
                photosSyncStatus = report.errorText.isEmpty
                    ? "Apple Photos sync failed. Retry starts a new bounded pass."
                    : report.errorText
            } else {
                photosSyncStatus = "Scanned \(report.scanned) of \(report.requested) in \(report.elapsedSeconds.formatted(.number.precision(.fractionLength(1))))s: \(report.metadataOnly) metadata, \(report.appearance) appearance, \(report.sourceMissing) missing, \(report.failed) failed."
            }
        } catch {
            photosSyncStatus = userFacingMessage(for: error)
        }
    }

    func prepareForTermination() async {
        terminationRequested = true

        // These tasks only hydrate or refresh the UI. They must not keep the
        // process alive after the window closes.
        // Leave fixture-window reads alone. They own loading flags and may
        // still be between a debounce and the audited query; canceling them
        // here could strand that flag and prevent the drain from completing.
        reviewAIStatusRefreshTask?.cancel()
        cancelCullingThumbnailWork()
        reviewThumbnailTasks.values.forEach { $0.cancel() }

        // A delayed Review text edit is durable work even though its network
        // action has not started yet. Flush it synchronously before draining
        // the other active operation flags.
        cancelReviewMetadataAutosave()
        await saveReviewMetadataIfNeeded()
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
        isCancellingNativePublication = false
        nativePublicationCancellationRequested = false
        nativeUploadRun = nil
        nativePublicationBatchNumber = 0
        nativePublicationBatchCount = batches.count
        defer {
            isRunningNativePublication = false
            nativePublicationBatchNumber = 0
            nativePublicationBatchCount = 0
            isCancellingNativePublication = false
            nativePublicationCancellationRequested = false
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
                if nativePublicationCancellationRequested { break }
                nativePublicationBatchNumber = batchIndex + 1
                var run = try await deliveryService.startNativeUpload(
                    assetIDs: batch,
                    limit: batch.count,
                    concurrency: 4
                )
                nativeUploadRun = run
                if nativePublicationCancellationRequested, !run.runID.isEmpty {
                    run = try await deliveryService.cancelNativeUpload(runID: run.runID)
                    nativeUploadRun = run
                }
                totalRequested += run.requested
                if run.requested == 0 { continue }
                nativeUploadStatus = "Publishing shown queue • batch \(batchIndex + 1) of \(batches.count) • \(totalProcessed) of \(ids.count) processed."
                while !run.isFinished {
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                    run = try await deliveryService.nativeUploadStatus(runID: run.runID)
                    nativeUploadRun = run
                    nativeUploadStatus = "Publishing shown queue • batch \(batchIndex + 1) of \(batches.count) • \(totalProcessed + run.processed) of \(ids.count) processed • \(totalLive + run.live) live • \(totalFailed + run.failed) failed."
                }
                attemptedIDs.formUnion(
                    run.items.lazy.filter {
                        ["verified", "live", "failed", "skipped"].contains($0.status)
                    }.map(\.assetID)
                )
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
                if run.status == "cancelled" { break }
            }
            let skipped = nativePublicationCancellationRequested ? 0 : max(0, ids.count - totalRequested)
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
            nativeUploadStatus = (nativePublicationCancellationRequested
                ? "Stopped safely after \(totalProcessed) of \(ids.count); completed uploads remain verified and all unstarted items remain in the tray. "
                : completion)
                + (skipped > 0 ? " \(skipped) changed eligibility before publication and were skipped safely." : "")
                + (nativePublicationCancellationRequested
                    ? " Retry resumes from the remaining independently eligible items."
                    : failedIDs.isEmpty
                    ? " This batch is complete; load the next 200 when ready."
                    : " Failed items remain in this tray for retry.")
                + (nativePublicationCancellationRequested ? "" : " Give Back completed for approved metadata.")
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

    func cancelNativePublication() async {
        guard isRunningNativePublication else { return }
        nativePublicationCancellationRequested = true
        isCancellingNativePublication = true
        nativeUploadStatus = "Stopping safely after currently uploading assets finish…"
        guard let runID = nativeUploadRun?.runID, !runID.isEmpty else { return }
        do {
            nativeUploadRun = try await deliveryService.cancelNativeUpload(runID: runID)
        } catch {
            nativeUploadStatus = userFacingMessage(for: error)
            isCancellingNativePublication = false
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
        do {
            let summary = try await deliveryService.nativeUploadPlan(
                fixtureID: selectedFixtureID,
                limit: 200,
                order: current.order
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
                mediaUploadedCount: summary.mediaUploadedCount,
                projectionPendingCount: summary.projectionPendingCount,
                projectionFailedCount: summary.projectionFailedCount,
                deploymentPendingCount: summary.deploymentPendingCount,
                deploymentFailedCount: summary.deploymentFailedCount,
                liveOnWebsiteCount: summary.liveOnWebsiteCount,
                order: summary.order,
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
                liveCount: current.liveCount,
                mediaUploadedCount: current.mediaUploadedCount + successfulIDs.count,
                projectionPendingCount: current.projectionPendingCount + successfulIDs.count,
                projectionFailedCount: current.projectionFailedCount,
                deploymentPendingCount: current.deploymentPendingCount,
                deploymentFailedCount: current.deploymentFailedCount,
                liveOnWebsiteCount: current.liveOnWebsiteCount,
                order: current.order,
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
        guard !isRunningR2Reconciliation else { return }
        isRunningDelivery = true
        isRunningR2Reconciliation = true
        isCancellingR2Reconciliation = false
        r2ReconciliationCancellationRequested = false
        defer {
            isRunningDelivery = false
            isRunningR2Reconciliation = false
            isCancellingR2Reconciliation = false
            r2ReconciliationCancellationRequested = false
        }
        do {
            var report = try await deliveryService.startR2Reconciliation(commit: commit)
            r2Reconciliation = report
            if r2ReconciliationCancellationRequested, !report.runID.isEmpty {
                report = try await deliveryService.cancelR2Reconciliation(runID: report.runID)
                r2Reconciliation = report
            }
            while !report.isFinished {
                r2ReconciliationStatus = "\(report.stage) • \(report.scanned) of \(report.requested) checked • \(report.remaining) remaining."
                try await Task.sleep(for: .seconds(1))
                report = try await deliveryService.r2ReconciliationStatus(runID: report.runID)
                r2Reconciliation = report
            }
            if report.status == "cancelled" {
                r2ReconciliationStatus = "Stopped safely after \(report.scanned) of \(report.requested); \(report.remaining) remain. Every completed object checkpoint is in the run receipt."
            } else if report.status == "failed" {
                r2ReconciliationStatus = report.errorText.isEmpty
                    ? "R2 reconciliation failed. The completed checkpoints remain auditable and retryable."
                    : report.errorText
            } else {
                r2ReconciliationStatus = commit
                    ? "Reconciled \(report.scanned): \(report.protected) sale-protected, \(report.quarantined) quarantined, \(report.restored) restored, \(report.deleted) deleted after the second pass."
                    : "Previewed \(report.scanned): \(report.protected) sale-protected, \(report.quarantined) would enter quarantine, \(report.eligibleDelete) eligible after a prior 30-day pass."
            }
        } catch {
            r2ReconciliationStatus = userFacingMessage(for: error)
        }
    }

    func cancelR2Reconciliation() async {
        guard isRunningR2Reconciliation else { return }
        r2ReconciliationCancellationRequested = true
        isCancellingR2Reconciliation = true
        r2ReconciliationStatus = "Stopping safely after the current R2 object checkpoint…"
        guard let runID = r2Reconciliation?.runID, !runID.isEmpty else { return }
        do {
            r2Reconciliation = try await deliveryService.cancelR2Reconciliation(runID: runID)
        } catch {
            r2ReconciliationStatus = userFacingMessage(for: error)
            isCancellingR2Reconciliation = false
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
            fixtureStatus = authenticationOperationRecoveryMessage
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
            accessStatus = authenticationOperationRecoveryMessage
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
            updateAuthenticationRecoveryStatus()
            return false
        }
        return true
    }

    private func preparePhotosMutation() async -> Bool {
        photoAccess = photoLibrary.authorization()
        return [.authorized, .limited].contains(photoAccess)
    }

    private func photosMutationReadinessMessage() -> String {
        guard [.authorized, .limited].contains(photoAccess) else {
            return "Backstage Photos access is required before culling or metadata give-back. Choose Allow Photos or grant Full Access in System Settings."
        }
        return "Backstage native Photos access is ready."
    }

    private func presentAuthenticationFailureIfNeeded(_ error: Error) async {
        guard let envelope = error as? APIErrorEnvelope,
              envelope.error.code == "google_login_required" else { return }
        authentication = await authenticationService.currentSnapshot()
        updateAuthenticationRecoveryStatus()
    }

    private func fixtureTreeFailureMessage(for error: Error) -> String {
        if let ownerActionError = error as? OwnerActionRunError,
           case .timedOut = ownerActionError {
            return "Fixture tree refresh timed out."
        }
        if let envelope = error as? APIErrorEnvelope,
           envelope.error.code == "google_login_required" {
            return "Backstage authentication expired."
        }
        return "Fixture tree unavailable: \(userFacingMessage(for: error))"
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
                if authentication.phase == .needsEnrollment {
                    return "Backstage's saved device credential was rejected. Open Overview and enroll this Mac again."
                }
                return "Backstage could not renew this Mac's Owner session. Its enrollment is retained; check the connection and retry from Overview."
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

    private func updateAuthenticationRecoveryStatus() {
        switch authentication.phase {
        case .authenticated:
            authenticationStatus = "Authenticated with this Mac's revocable device credential."
            status = "Connected"
        case .renewalFailed:
            authenticationStatus = "This Mac remains enrolled, but its Owner session could not be renewed. Check the connection and retry."
            status = "Retry Owner session"
        case .needsEnrollment:
            authenticationStatus = "This Mac's saved Backstage device credential is missing or was rejected. Enroll it again from Owner."
            status = "Enrollment required"
        case .signedOut:
            authenticationStatus = "Signed out on this Mac."
            status = "Signed out"
        }
    }

    private var authenticationOperationRecoveryMessage: String {
        switch authentication.phase {
        case .authenticated:
            return "Backstage Owner authentication is ready."
        case .renewalFailed:
            return "Backstage retained this Mac's enrollment, but the Owner session needs to be retried from Overview."
        case .needsEnrollment:
            return "Backstage needs this Mac to be enrolled again. Open Overview to continue."
        case .signedOut:
            return "Backstage is signed out. Open Overview to enroll this Mac."
        }
    }

    private func runMetadata(commit: Bool) async {
        guard fixtureScopedActionsAllowed else {
            metadataStatus = "Current fixture unavailable; metadata give-back stayed closed."
            return
        }
        let scopedAssetIDs = metadataGiveBackAssetIDs
        if commit, !metadataGiveBackCommitReady {
            metadataStatus = "Run a fresh preview for the current write scope before committing to Apple Photos."
            return
        }
        let operationFixtureID = selectedFixtureID
        if !commit {
            metadataReport = nil
            metadataGiveBackPlannedAssetIDs = nil
        }
        isRunningMetadata = true
        defer { isRunningMetadata = false }
        if commit, !(await preparePhotosMutation()) {
            metadataStatus = photosMutationReadinessMessage()
            return
        }
        do {
            let report = try await (commit
                ? metadataService.commit(fixtureID: operationFixtureID, assetIDs: scopedAssetIDs)
                : metadataService.plan(fixtureID: operationFixtureID, assetIDs: scopedAssetIDs))
            guard selectedFixtureID == operationFixtureID else {
                metadataReport = nil
                metadataGiveBackPlannedAssetIDs = nil
                metadataStatus = "The current fixture changed before metadata completed; the stale report was discarded."
                return
            }
            metadataReport = report
            metadataGiveBackPlannedAssetIDs = commit ? nil : scopedAssetIDs
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

    private func photoLibraryIdentifierCandidates(
        for assetID: String,
        preferredIdentifier: String? = nil
    ) -> [String] {
        var candidates: [String] = []
        for value in [preferredIdentifier, photoLibraryIdentifier(for: assetID), assetID] {
            guard let value, !value.isEmpty, !candidates.contains(value) else { continue }
            candidates.append(value)
        }
        return candidates
    }

    private func previewForAsset(
        forAssetID assetID: String,
        preferredIdentifier: String? = nil,
        maxPixelSize: Int
    ) async throws -> PhotoPreview {
        var lastError: Error?
        for identifier in photoLibraryIdentifierCandidates(
            for: assetID,
            preferredIdentifier: preferredIdentifier
        ) {
            do {
                return try await photoLibrary.preview(
                    localIdentifier: identifier,
                    maxPixelSize: maxPixelSize
                )
            } catch {
                if error is CancellationError || Task.isCancelled {
                    throw error
                }
                lastError = error
            }
        }
        throw lastError ?? PhotoLibraryError.assetNotFound(assetID)
    }

    private func cullingPreviewForAsset(
        forAssetID assetID: String,
        preferredIdentifier: String? = nil,
        maxPixelSize: Int
    ) async throws -> PhotoPreview {
        var lastError: Error?
        for identifier in photoLibraryIdentifierCandidates(
            for: assetID,
            preferredIdentifier: preferredIdentifier
        ) {
            do {
                return try await photoLibrary.cullingPreview(
                    localIdentifier: identifier,
                    maxPixelSize: maxPixelSize
                )
            } catch {
                if error is CancellationError || Task.isCancelled {
                    throw error
                }
                lastError = error
            }
        }
        throw lastError ?? PhotoLibraryError.assetNotFound(assetID)
    }

    private func renderedJPEGPreviewForAsset(
        forAssetID assetID: String,
        preferredIdentifier: String? = nil,
        maxPixelSize: Int
    ) async throws -> PhotoPreview {
        var lastError: Error?
        for identifier in photoLibraryIdentifierCandidates(
            for: assetID,
            preferredIdentifier: preferredIdentifier
        ) {
            do {
                return try await photoLibrary.renderedJPEGPreview(
                    localIdentifier: identifier,
                    maxPixelSize: maxPixelSize
                )
            } catch {
                if error is CancellationError || Task.isCancelled {
                    throw error
                }
                lastError = error
            }
        }
        throw lastError ?? PhotoLibraryError.assetNotFound(assetID)
    }

    private func exportOriginalForAsset(
        forAssetID assetID: String,
        preferredIdentifier: String? = nil,
        to directory: URL
    ) async throws -> PhotoExportReceipt {
        var lastError: Error?
        for identifier in photoLibraryIdentifierCandidates(
            for: assetID,
            preferredIdentifier: preferredIdentifier
        ) {
            do {
                return try await photoLibrary.exportOriginal(
                    localIdentifier: identifier,
                    to: directory
                )
            } catch {
                if error is CancellationError || Task.isCancelled {
                    throw error
                }
                lastError = error
            }
        }
        throw lastError ?? PhotoLibraryError.assetNotFound(assetID)
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
