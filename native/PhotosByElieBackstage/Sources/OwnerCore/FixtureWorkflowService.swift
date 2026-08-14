import Foundation

public struct FixtureNode: Identifiable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var parentID: String?
    public var state: String
    public var templateKey: String
    public var children: [FixtureNode]

    public var isArchived: Bool { state == "archived" }
    public var outlineChildren: [FixtureNode]? { children.isEmpty ? nil : children }

    public init(
        id: String,
        name: String,
        parentID: String? = nil,
        state: String = "active",
        templateKey: String = "",
        children: [FixtureNode] = []
    ) {
        self.id = id
        self.name = name
        self.parentID = parentID
        self.state = state
        self.templateKey = templateKey
        self.children = children
    }

    init(json: [String: JSONValue]) {
        id = json["fixtureId"]?.stringValue ?? json["id"]?.stringValue ?? ""
        name = json["name"]?.stringValue ?? id
        parentID = json["parentFixtureId"]?.stringValue
        let archivedAt = json["archivedAt"]?.stringValue?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        state = json["state"]?.stringValue ?? (archivedAt.isEmpty ? "active" : "archived")
        templateKey = json["templateKey"]?.stringValue ?? ""
        children = (json["children"]?.arrayValue ?? []).compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixtureNode(json: object)
        }
    }

    public var flattened: [FixtureNode] {
        [self] + children.flatMap(\.flattened)
    }
}

public struct FixtureAsset: Identifiable, Sendable, Equatable {
    public var id: String
    public var photoLibraryIdentifier: String
    public var title: String
    public var filename: String
    public var mediaType: String
    public var capturedAt: String
    public var pixelWidth: Int
    public var pixelHeight: Int
    public var resourceFormat: String
    public var originalByteCount: Int64
    public var placementState: FixturePlacementState
    public var eligibilityState: String
    public var rating: Int
    public var color: String
    public var editorialState: String
    public var keywords: [String]

    public init(
        id: String,
        photoLibraryIdentifier: String = "",
        title: String,
        filename: String,
        mediaType: String,
        capturedAt: String = "",
        pixelWidth: Int = 0,
        pixelHeight: Int = 0,
        resourceFormat: String = "",
        originalByteCount: Int64 = 0,
        placementState: FixturePlacementState = .undecided,
        eligibilityState: String = "active",
        rating: Int = 0,
        color: String = "",
        editorialState: String = "unreviewed",
        keywords: [String] = []
    ) {
        self.id = id
        self.photoLibraryIdentifier = photoLibraryIdentifier.isEmpty ? id : photoLibraryIdentifier
        self.title = title
        self.filename = filename
        self.mediaType = mediaType
        self.capturedAt = capturedAt
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.resourceFormat = resourceFormat
        self.originalByteCount = originalByteCount
        self.placementState = placementState
        self.eligibilityState = eligibilityState
        self.rating = rating
        self.color = color
        self.editorialState = editorialState
        self.keywords = keywords
    }

    init(json: [String: JSONValue]) {
        id = json["assetId"]?.stringValue ?? json["id"]?.stringValue ?? ""
        photoLibraryIdentifier = json["photoLibraryIdentifier"]?.stringValue ?? id
        title = json["title"]?.stringValue ?? ""
        filename = json["filename"]?.stringValue ?? ""
        mediaType = json["mediaType"]?.stringValue ?? json["kind"]?.stringValue ?? ""
        capturedAt = json["capturedAt"]?.stringValue ?? ""
        pixelWidth = json["pixelWidth"]?.intValue ?? 0
        pixelHeight = json["pixelHeight"]?.intValue ?? 0
        resourceFormat = json["resourceFormat"]?.stringValue ?? ""
        originalByteCount = Int64(json["originalByteCount"]?.intValue ?? 0)
        placementState = FixturePlacementState(
            rawValue: json["placementState"]?.stringValue ?? "undecided"
        ) ?? .undecided
        eligibilityState = json["eligibilityState"]?.stringValue ?? "active"
        rating = json["rating"]?.intValue ?? 0
        color = json["color"]?.stringValue ?? ""
        editorialState = json["editorialState"]?.stringValue ?? "unreviewed"
        keywords = json["keywords"]?.arrayValue?.compactMap(\.stringValue) ?? []
    }
}

public struct FixturePoolAsset: Identifiable, Sendable, Equatable {
    public var id: String
    public var sourceIdentity: String
    public var photoLibraryIdentifier: String
    public var sourceKind: String
    public var position: Int
    public var title: String
    public var filename: String
    public var mediaType: String

    public init(
        id: String,
        sourceIdentity: String = "",
        photoLibraryIdentifier: String = "",
        sourceKind: String = "photos-library",
        position: Int,
        title: String,
        filename: String,
        mediaType: String
    ) {
        self.id = id
        self.sourceIdentity = sourceIdentity
        self.photoLibraryIdentifier = photoLibraryIdentifier.isEmpty ? id : photoLibraryIdentifier
        self.sourceKind = sourceKind
        self.position = position
        self.title = title
        self.filename = filename
        self.mediaType = mediaType
    }

    init(json: [String: JSONValue]) {
        id = json["assetId"]?.stringValue ?? ""
        sourceIdentity = json["sourceIdentity"]?.stringValue ?? ""
        photoLibraryIdentifier = json["photoLibraryIdentifier"]?.stringValue ?? ""
        sourceKind = json["sourceKind"]?.stringValue ?? ""
        position = json["position"]?.intValue ?? 0
        title = json["title"]?.stringValue ?? ""
        filename = json["filename"]?.stringValue ?? ""
        mediaType = json["mediaType"]?.stringValue ?? ""
    }
}

public struct FixturePool: Sendable, Equatable {
    public var id: String
    public var name: String
    public var fixtureID: String
    public var assetCount: Int
    public var snapshotHash: String
    public var assets: [FixturePoolAsset]

    public init(
        id: String,
        name: String,
        fixtureID: String,
        assetCount: Int,
        snapshotHash: String,
        assets: [FixturePoolAsset]
    ) {
        self.id = id
        self.name = name
        self.fixtureID = fixtureID
        self.assetCount = assetCount
        self.snapshotHash = snapshotHash
        self.assets = assets
    }
}

public struct FixturePoolSummary: Identifiable, Sendable, Equatable {
    public var id: String
    public var fixtureID: String
    public var name: String
    public var assetCount: Int
    public var snapshotHash: String
    public var state: String
    public var createdAt: String

    init(json: [String: JSONValue]) {
        id = json["poolId"]?.stringValue ?? ""
        fixtureID = json["fixtureId"]?.stringValue ?? ""
        name = json["name"]?.stringValue ?? id
        assetCount = json["assetCount"]?.intValue ?? 0
        snapshotHash = json["snapshotHash"]?.stringValue ?? ""
        state = json["state"]?.stringValue ?? "active"
        createdAt = json["createdAt"]?.stringValue ?? ""
    }
}

public struct FixturePolicy: Sendable, Equatable {
    public var visibility: String
    public var searchable: Bool
    public var retention: String
    public var delivery: String
    public var download: Bool
    public var commerce: String

    public init(
        visibility: String,
        searchable: Bool,
        retention: String,
        delivery: String,
        download: Bool,
        commerce: String
    ) {
        self.visibility = visibility
        self.searchable = searchable
        self.retention = retention
        self.delivery = delivery
        self.download = download
        self.commerce = commerce
    }

    init(json: [String: JSONValue]) {
        visibility = json["visibility"]?.stringValue ?? "private"
        searchable = json["searchable"]?.boolValue ?? false
        retention = json["retention"]?.stringValue ?? "no-cloud"
        delivery = json["delivery"]?.stringValue ?? "owner-only"
        download = json["download"]?.boolValue ?? false
        commerce = json["commerce"]?.stringValue ?? "disabled"
    }

    var json: [String: JSONValue] {
        [
            "visibility": .string(visibility),
            "searchable": .bool(searchable),
            "retention": .string(retention),
            "delivery": .string(delivery),
            "download": .bool(download),
            "commerce": .string(commerce),
        ]
    }
}

public struct FixturePolicyOverrides: Sendable, Equatable {
    public var visibility: String?
    public var searchable: Bool?
    public var retention: String?
    public var delivery: String?
    public var download: Bool?
    public var commerce: String?

    public init(
        visibility: String? = nil,
        searchable: Bool? = nil,
        retention: String? = nil,
        delivery: String? = nil,
        download: Bool? = nil,
        commerce: String? = nil
    ) {
        self.visibility = visibility
        self.searchable = searchable
        self.retention = retention
        self.delivery = delivery
        self.download = download
        self.commerce = commerce
    }

    init(json: [String: JSONValue]) {
        visibility = json["visibility"]?.stringValue
        searchable = json["searchable"]?.boolValue
        retention = json["retention"]?.stringValue
        delivery = json["delivery"]?.stringValue
        download = json["download"]?.boolValue
        commerce = json["commerce"]?.stringValue
    }

    var json: [String: JSONValue] {
        var result: [String: JSONValue] = [:]
        if let visibility { result["visibility"] = .string(visibility) }
        if let searchable { result["searchable"] = .bool(searchable) }
        if let retention { result["retention"] = .string(retention) }
        if let delivery { result["delivery"] = .string(delivery) }
        if let download { result["download"] = .bool(download) }
        if let commerce { result["commerce"] = .string(commerce) }
        return result
    }
}

public struct FixtureConfiguration: Sendable, Equatable {
    public var fixtureID: String
    public var populationMode: String
    public var candidateSource: [String: JSONValue]
    public var savedRule: [String: JSONValue]
    public var templateKey: String
    public var configuredPolicy: FixturePolicyOverrides
    public var effectivePolicy: FixturePolicy
    public var revision: Int

    init(json: [String: JSONValue]) {
        fixtureID = json["fixtureId"]?.stringValue ?? ""
        populationMode = json["populationMode"]?.stringValue ?? "curated"
        candidateSource = json["candidateSource"]?.objectValue ?? [:]
        savedRule = json["savedRule"]?.objectValue ?? [:]
        templateKey = json["templateKey"]?.stringValue ?? ""
        let policy = json["policy"]?.objectValue ?? [:]
        configuredPolicy = FixturePolicyOverrides(
            json: policy["configured"]?.objectValue ?? [:]
        )
        effectivePolicy = FixturePolicy(
            json: policy["effective"]?.objectValue ?? [:]
        )
        revision = policy["revision"]?.intValue ?? 0
    }
}

public struct FixturePlacement: Identifiable, Sendable, Equatable {
    public var id: String
    public var assetID: String
    public var fixtureID: String
    public var breadcrumbLabel: String
    public var state: String
    public var sourcePoolID: String

    public var isActive: Bool { state == "active" }

    init(json: [String: JSONValue]) {
        id = json["placementId"]?.stringValue ?? json["id"]?.stringValue ?? ""
        assetID = json["assetId"]?.stringValue ?? ""
        fixtureID = json["fixtureId"]?.stringValue ?? ""
        breadcrumbLabel = json["breadcrumbLabel"]?.stringValue ?? fixtureID
        state = json["state"]?.stringValue ?? "active"
        sourcePoolID = json["sourcePoolId"]?.stringValue ?? ""
    }
}

public enum FixturePlacementState: String, Codable, Sendable, CaseIterable {
    case undecided
    case picked
    case hidden
}

public enum FixtureCullingAction: Sendable, Equatable {
    case include
    case exclude
    case clear
    /// Legacy compatibility semantic; normal Culling X uses LifecycleService.
    case tombstone
}

public enum FixtureCullingMutation: Sendable, Equatable {
    case unavailable
    case fixtureState(FixturePlacementState)
    case globalTombstone
}

public enum FixtureCullingSemantics {
    public static func mutation(
        for action: FixtureCullingAction,
        currentFixtureID: String
    ) -> FixtureCullingMutation {
        if action == .tombstone {
            return .globalTombstone
        }
        guard !currentFixtureID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return .unavailable
        }
        return switch action {
        case .include: .fixtureState(.picked)
        case .exclude: .fixtureState(.hidden)
        case .clear: .fixtureState(.undecided)
        case .tombstone: .globalTombstone
        }
    }
}

public enum FixtureCullingView: String, Codable, Sendable, CaseIterable {
    case undecided
    case hidden
    case picked
    case allActive = "all-active"

    public var label: String {
        switch self {
        case .undecided: "Undecided"
        case .hidden: "Hidden"
        case .picked: "Picked"
        case .allActive: "All Active"
        }
    }

    public static var selectableCases: [Self] { [.undecided, .picked, .hidden] }
}

public struct FixtureCullingSummary: Sendable, Equatable {
    public var filtered: Int
    public var universe: Int
    public var undecided: Int
    public var picked: Int
    public var hidden: Int

    init(json: [String: JSONValue]) {
        filtered = json["filtered"]?.intValue ?? 0
        universe = json["universe"]?.intValue ?? 0
        undecided = json["undecided"]?.intValue ?? 0
        picked = json["picked"]?.intValue ?? 0
        hidden = json["hidden"]?.intValue ?? 0
    }
}

public struct FixtureCullingMediaAvailability: Sendable, Equatable {
    public var photos: Int
    public var videos: Int

    init(json: [String: JSONValue]) {
        photos = json["photos"]?.intValue ?? 0
        videos = json["videos"]?.intValue ?? 0
    }

    public var availableFilters: [CullingMediaFilter] {
        CullingMediaFilter.selectableCases.filter { filter in
            switch filter {
            case .photos: photos > 0
            case .videos: videos > 0
            case .all: false
            }
        }
    }
}

public struct FixtureCullingWindow: Sendable, Equatable {
    public var fixtureID: String
    public var candidateMode: String
    public var view: FixtureCullingView
    public var offset: Int
    public var limit: Int
    public var nextOffset: Int
    public var hasNext: Bool
    public var summary: FixtureCullingSummary
    public var mediaAvailability: FixtureCullingMediaAvailability?
    public var items: [FixtureAsset]

    init(json: [String: JSONValue]) {
        fixtureID = json["fixtureId"]?.stringValue ?? ""
        candidateMode = json["candidateMode"]?.stringValue ?? ""
        view = FixtureCullingView(
            rawValue: json["view"]?.stringValue ?? "undecided"
        ) ?? .undecided
        offset = json["offset"]?.intValue ?? 0
        limit = json["limit"]?.intValue ?? 200
        nextOffset = json["nextOffset"]?.intValue ?? 0
        hasNext = json["hasNext"]?.boolValue ?? false
        summary = FixtureCullingSummary(json: json["summary"]?.objectValue ?? [:])
        mediaAvailability = json["mediaAvailability"]?.objectValue.map(
            FixtureCullingMediaAvailability.init(json:)
        )
        items = (json["items"]?.arrayValue ?? [])
            .compactMap(\.objectValue)
            .map(FixtureAsset.init(json:))
    }

    public var availableMediaFilters: [CullingMediaFilter] {
        mediaAvailability?.availableFilters ?? CullingMediaFilter.selectableCases
    }
}

public enum FixtureReviewAction: String, Codable, Sendable, CaseIterable {
    case approve
    case returnToReview = "return-to-review"
    case hide
    case requestAI = "request-ai"
    case editMetadata = "edit-metadata"
    case propagateTitle = "propagate-title"
    case propagateKeywords = "propagate-keywords"
}

public enum FixtureReviewMode: String, Codable, Sendable, CaseIterable, Identifiable {
    case backfill
    case full

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .backfill: "Backfill"
        case .full: "Full queue"
        }
    }
}

public enum FixtureReviewStateFilter: String, Codable, Sendable, CaseIterable, Identifiable {
    case picked
    case approved
    case hidden

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .picked: "Picked"
        case .approved: "Approved"
        case .hidden: "Hidden"
        }
    }
}

public struct FixtureReviewItem: Identifiable, Sendable, Equatable {
    public var id: String
    public var photoLibraryIdentifier: String
    public var title: String
    public var caption: String
    public var keywords: [String]
    public var filename: String
    public var mediaType: String
    public var capturedAt: String
    public var rating: Int
    public var color: String
    public var placementState: String
    public var editorialState: String
    public var aiReasons: [String]
    public var aiNote: String
    public var aiAttemptCount: Int
    public var aiLastError: String
    public var proposalReady: Bool
    public var proposalContextAvailable: Bool
    public var proposalID: String
    public var proposedTitle: String
    public var proposedKeywords: [String]
    public var proposalReason: String
    public var proposalStatus: String
    public var requestedGeneratorModel: String
    public var resolvedModel: String
    public var reasoningEffort: String
    public var vision: Bool
    public var modelLadder: [String]
    public var deliveryState: String

    public init(
        id: String,
        photoLibraryIdentifier: String,
        title: String,
        caption: String = "",
        keywords: [String],
        filename: String,
        mediaType: String = "photo",
        capturedAt: String,
        rating: Int = 0,
        color: String = "",
        placementState: String = "picked",
        editorialState: String = "unreviewed",
        aiReasons: [String] = [],
        aiNote: String = "",
        aiAttemptCount: Int = 0,
        aiLastError: String = "",
        proposalReady: Bool = false,
        proposalContextAvailable: Bool = false,
        proposalID: String = "",
        proposedTitle: String = "",
        proposedKeywords: [String] = [],
        proposalReason: String = "",
        proposalStatus: String = "",
        requestedGeneratorModel: String = "",
        resolvedModel: String = "",
        reasoningEffort: String = "",
        vision: Bool = false,
        modelLadder: [String] = [],
        deliveryState: String = "not-ready"
    ) {
        self.id = id
        self.photoLibraryIdentifier = photoLibraryIdentifier
        self.title = title
        self.caption = caption
        self.keywords = keywords
        self.filename = filename
        self.mediaType = mediaType
        self.capturedAt = capturedAt
        self.rating = rating
        self.color = color
        self.placementState = placementState
        self.editorialState = editorialState
        self.aiReasons = aiReasons
        self.aiNote = aiNote
        self.aiAttemptCount = aiAttemptCount
        self.aiLastError = aiLastError
        self.proposalReady = proposalReady
        self.proposalContextAvailable = proposalContextAvailable
        self.proposalID = proposalID
        self.proposedTitle = proposedTitle
        self.proposedKeywords = proposedKeywords
        self.proposalReason = proposalReason
        self.proposalStatus = proposalStatus
        self.requestedGeneratorModel = requestedGeneratorModel
        self.resolvedModel = resolvedModel
        self.reasoningEffort = reasoningEffort
        self.vision = vision
        self.modelLadder = modelLadder
        self.deliveryState = deliveryState
    }

    init(json: [String: JSONValue]) {
        id = json["assetId"]?.stringValue ?? ""
        photoLibraryIdentifier = json["photoLibraryIdentifier"]?.stringValue ?? id
        title = json["title"]?.stringValue ?? ""
        caption = json["caption"]?.stringValue ?? ""
        keywords = json["keywords"]?.arrayValue?.compactMap(\.stringValue) ?? []
        filename = json["filename"]?.stringValue ?? ""
        mediaType = json["mediaType"]?.stringValue ?? "photo"
        capturedAt = json["capturedAt"]?.stringValue ?? ""
        rating = json["rating"]?.intValue ?? 0
        color = json["color"]?.stringValue ?? ""
        placementState = json["placementState"]?.stringValue ?? "picked"
        editorialState = json["editorialState"]?.stringValue ?? "unreviewed"
        aiReasons = json["aiReasons"]?.arrayValue?.compactMap(\.stringValue) ?? []
        aiNote = json["aiNote"]?.stringValue ?? ""
        aiAttemptCount = json["aiAttemptCount"]?.intValue ?? 0
        aiLastError = json["aiLastError"]?.stringValue ?? ""
        proposalReady = json["proposalReady"]?.boolValue ?? false
        proposalContextAvailable = json["proposalContextAvailable"]?.boolValue
            ?? proposalReady
        proposalID = json["proposalId"]?.stringValue ?? ""
        proposedTitle = json["proposedTitle"]?.stringValue ?? ""
        proposedKeywords = json["proposedKeywords"]?.arrayValue?.compactMap(\.stringValue) ?? []
        proposalReason = json["proposalReason"]?.stringValue ?? ""
        proposalStatus = json["proposalStatus"]?.stringValue ?? ""
        requestedGeneratorModel = json["requestedGeneratorModel"]?.stringValue ?? ""
        resolvedModel = json["resolvedModel"]?.stringValue ?? ""
        reasoningEffort = json["reasoningEffort"]?.stringValue ?? ""
        vision = json["vision"]?.boolValue ?? false
        modelLadder = json["modelLadder"]?.arrayValue?.compactMap(\.stringValue) ?? []
        deliveryState = json["deliveryState"]?.stringValue ?? "not-ready"
    }
}

public struct FixtureReviewSummary: Sendable, Equatable {
    public var total: Int
    public var unreviewed: Int
    public var requestingAI: Int
    public var proposed: Int
    public var approved: Int

    public init(
        total: Int,
        unreviewed: Int,
        requestingAI: Int,
        proposed: Int,
        approved: Int
    ) {
        self.total = total
        self.unreviewed = unreviewed
        self.requestingAI = requestingAI
        self.proposed = proposed
        self.approved = approved
    }

    init(json: [String: JSONValue]) {
        total = json["total"]?.intValue ?? 0
        unreviewed = json["unreviewed"]?.intValue ?? 0
        requestingAI = json["requestingAI"]?.intValue ?? 0
        proposed = json["proposed"]?.intValue ?? 0
        approved = json["approved"]?.intValue ?? 0
    }

    /// Apply a durable editorial-state transition to the already-loaded
    /// Review summary without reloading the queue or disturbing selection.
    public mutating func applyEditorialStateTransition(
        from before: String,
        to after: String
    ) {
        guard before != after else { return }
        switch before {
        case "unreviewed": unreviewed = max(0, unreviewed - 1)
        case "requesting-ai": requestingAI = max(0, requestingAI - 1)
        case "proposed": proposed = max(0, proposed - 1)
        case "approved": approved = max(0, approved - 1)
        default: break
        }
        switch after {
        case "unreviewed": unreviewed += 1
        case "requesting-ai": requestingAI += 1
        case "proposed": proposed += 1
        case "approved": approved += 1
        default: break
        }
    }
}

public struct FixtureReviewWindow: Sendable, Equatable {
    public var fixtureID: String
    public var mode: FixtureReviewMode
    public var offset: Int
    public var limit: Int
    public var nextOffset: Int
    public var hasNext: Bool
    public var summary: FixtureReviewSummary
    public var items: [FixtureReviewItem]

    public init(
        fixtureID: String,
        mode: FixtureReviewMode,
        offset: Int,
        limit: Int,
        nextOffset: Int,
        hasNext: Bool,
        summary: FixtureReviewSummary,
        items: [FixtureReviewItem]
    ) {
        self.fixtureID = fixtureID
        self.mode = mode
        self.offset = offset
        self.limit = limit
        self.nextOffset = nextOffset
        self.hasNext = hasNext
        self.summary = summary
        self.items = items
    }

    init(json: [String: JSONValue]) {
        fixtureID = json["fixtureId"]?.stringValue ?? ""
        mode = FixtureReviewMode(
            rawValue: json["mode"]?.stringValue ?? "backfill"
        ) ?? .backfill
        offset = json["offset"]?.intValue ?? 0
        limit = json["limit"]?.intValue ?? 200
        nextOffset = json["nextOffset"]?.intValue ?? 0
        hasNext = json["hasNext"]?.boolValue ?? false
        summary = FixtureReviewSummary(json: json["summary"]?.objectValue ?? [:])
        items = (json["items"]?.arrayValue ?? [])
            .compactMap(\.objectValue)
            .map(FixtureReviewItem.init(json:))
    }
}

public struct FixtureReviewChange: Identifiable, Sendable, Equatable {
    public var id: String { assetID }
    public var assetID: String
    public var before: [String: JSONValue]
    public var after: [String: JSONValue]

    init(json: [String: JSONValue]) {
        assetID = json["assetId"]?.stringValue ?? ""
        before = json["before"]?.objectValue ?? [:]
        after = json["after"]?.objectValue ?? [:]
    }
}

public struct FixtureReviewResult: Sendable, Equatable {
    public var operationID: String
    public var fixtureID: String
    public var action: FixtureReviewAction
    public var anchorAssetID: String
    public var propagated: Bool
    public var changes: [FixtureReviewChange]

    init(json: [String: JSONValue]) {
        operationID = json["operationId"]?.stringValue ?? ""
        fixtureID = json["fixtureId"]?.stringValue ?? ""
        action = FixtureReviewAction(
            rawValue: json["action"]?.stringValue ?? "edit-metadata"
        ) ?? .editMetadata
        anchorAssetID = json["anchorAssetId"]?.stringValue ?? ""
        propagated = json["propagated"]?.boolValue ?? false
        changes = (json["items"]?.arrayValue ?? [])
            .compactMap(\.objectValue)
            .map(FixtureReviewChange.init(json:))
    }
}

public struct FixtureReviewUndoResult: Sendable, Equatable {
    public var operationID: String
    public var fixtureID: String
    public var action: FixtureReviewAction
    public var alreadyUndone: Bool
    public var changes: [FixtureReviewChange]

    init(json: [String: JSONValue]) {
        operationID = json["operationId"]?.stringValue ?? ""
        fixtureID = json["fixtureId"]?.stringValue ?? ""
        action = FixtureReviewAction(
            rawValue: json["action"]?.stringValue ?? "edit-metadata"
        ) ?? .editMetadata
        alreadyUndone = json["alreadyUndone"]?.boolValue ?? false
        changes = (json["items"]?.arrayValue ?? [])
            .compactMap(\.objectValue)
            .map(FixtureReviewChange.init(json:))
    }
}

public struct FixtureAIProposal: Identifiable, Sendable, Equatable {
    public var id: String
    public var status: String
    public var assetID: String
    public var runID: String
    public var attempt: Int
    public var previousTitle: String
    public var previousKeywords: [String]
    public var canonicalTitle: String
    public var canonicalKeywords: [String]
    public var proposedTitle: String
    public var proposedKeywords: [String]
    public var confidence: String
    public var reason: String
    public var needsOwnerContext: Bool
    public var requestReasons: [String]
    public var requestNote: String
    public var requestedGeneratorModel: String
    public var resolvedModel: String
    public var reasoningEffort: String
    public var vision: Bool
    public var modelLadder: [String]
    public var createdAt: String

    init(json: [String: JSONValue]) {
        id = json["proposalId"]?.stringValue ?? ""
        status = json["status"]?.stringValue ?? "ready"
        assetID = json["assetId"]?.stringValue ?? ""
        runID = json["runId"]?.stringValue ?? ""
        attempt = json["attempt"]?.intValue ?? 0
        previousTitle = json["previousTitle"]?.stringValue ?? ""
        previousKeywords = json["previousKeywords"]?.arrayValue?.compactMap(\.stringValue) ?? []
        canonicalTitle = json["canonicalTitle"]?.stringValue ?? ""
        canonicalKeywords = json["canonicalKeywords"]?.arrayValue?.compactMap(\.stringValue) ?? []
        proposedTitle = json["proposedTitle"]?.stringValue ?? ""
        proposedKeywords = json["proposedKeywords"]?.arrayValue?.compactMap(\.stringValue) ?? []
        confidence = json["confidence"]?.stringValue ?? ""
        reason = json["reason"]?.stringValue ?? ""
        needsOwnerContext = json["needsOwnerContext"]?.boolValue ?? false
        requestReasons = json["requestReasons"]?.arrayValue?.compactMap(\.stringValue) ?? []
        requestNote = json["requestNote"]?.stringValue ?? ""
        requestedGeneratorModel = json["requestedGeneratorModel"]?.stringValue ?? ""
        resolvedModel = json["resolvedModel"]?.stringValue ?? ""
        reasoningEffort = json["reasoningEffort"]?.stringValue ?? ""
        vision = json["vision"]?.boolValue ?? false
        modelLadder = json["modelLadder"]?.arrayValue?.compactMap(\.stringValue) ?? []
        createdAt = json["createdAt"]?.stringValue ?? ""
    }
}

public struct FixtureAIRun: Sendable, Equatable {
    public var id: String
    public var trigger: String
    public var status: String
    public var requested: Int
    public var processed: Int
    public var proposed: Int
    public var skipped: Int
    public var failed: Int
    public var remaining: Int
    public var cancelRequested: Bool
    public var elapsedSeconds: Double
    public var lastError: String

    init(json: [String: JSONValue]) {
        id = json["runId"]?.stringValue ?? ""
        trigger = json["trigger"]?.stringValue ?? ""
        status = json["status"]?.stringValue ?? ""
        requested = json["requested"]?.intValue ?? 0
        processed = json["processed"]?.intValue ?? 0
        proposed = json["proposed"]?.intValue ?? 0
        skipped = json["skipped"]?.intValue ?? 0
        failed = json["failed"]?.intValue ?? 0
        remaining = json["remaining"]?.intValue ?? 0
        cancelRequested = json["cancelRequested"]?.boolValue ?? false
        if case let .number(value)? = json["elapsedSeconds"] {
            elapsedSeconds = value
        } else {
            elapsedSeconds = 0
        }
        lastError = json["lastError"]?.stringValue ?? ""
    }
}

public struct FixtureAIStatus: Sendable, Equatable {
    public var active: Bool
    public var requested: Int
    public var ready: Int
    public var run: FixtureAIRun?

    init(json: [String: JSONValue]) {
        active = json["active"]?.boolValue ?? false
        requested = json["requested"]?.intValue ?? 0
        ready = json["ready"]?.intValue ?? 0
        let runJSON = json["run"]?.objectValue ?? [:]
        run = runJSON.isEmpty ? nil : FixtureAIRun(json: runJSON)
    }
}

public struct FixtureStateMigrationReport: Sendable, Equatable {
    public var migrationID: String
    public var mode: String
    public var plannedDecisionInsertCount: Int
    public var plannedPickedCount: Int
    public var plannedHiddenCount: Int
    public var explicitPlacementCount: Int
    public var ancestorClosureCount: Int
    public var backupPath: String
    public var receiptPath: String
    public var applied: Bool
    public var idempotencyReplayed: Bool

    init(json: [String: JSONValue]) {
        migrationID = json["migrationId"]?.stringValue ?? ""
        mode = json["mode"]?.stringValue ?? ""
        plannedDecisionInsertCount = json["plannedDecisionInsertCount"]?.intValue ?? 0
        plannedPickedCount = json["plannedPickedCount"]?.intValue ?? 0
        plannedHiddenCount = json["plannedHiddenCount"]?.intValue ?? 0
        explicitPlacementCount = json["explicitPlacementCount"]?.intValue ?? 0
        ancestorClosureCount = json["ancestorClosureCount"]?.intValue ?? 0
        backupPath = json["backupPath"]?.stringValue ?? ""
        receiptPath = json["receiptPath"]?.stringValue ?? ""
        applied = json["applied"]?.boolValue ?? false
        idempotencyReplayed = json["idempotencyReplayed"]?.boolValue ?? false
    }
}

public struct PhotosIndexReconciliationReport: Sendable, Equatable {
    public var status: String
    public var stage: String
    public var indexedCount: Int
    public var importedCount: Int
    public var totalCount: Int
    public var missingMarkedCount: Int
    public var completedAt: String

    init(json: [String: JSONValue]) {
        status = json["status"]?.stringValue ?? ""
        stage = json["stage"]?.stringValue ?? ""
        indexedCount = json["indexedCount"]?.intValue ?? 0
        importedCount = json["importedCount"]?.intValue ?? 0
        totalCount = json["totalCount"]?.intValue ?? 0
        missingMarkedCount = json["missingMarkedCount"]?.intValue ?? 0
        completedAt = json["completedAt"]?.stringValue ?? ""
    }
}

public struct FixtureAssetState: Identifiable, Sendable, Equatable {
    public var fixtureID: String
    public var assetID: String
    public var placementState: FixturePlacementState
    public var eligibilityState: String
    public var source: String
    public var updatedAt: String
    public var beforePlacementState: FixturePlacementState
    public var beforeEligibilityState: String

    public var id: String { "\(fixtureID):\(assetID)" }

    init(json: [String: JSONValue]) {
        fixtureID = json["fixture_id"]?.stringValue ?? json["fixtureId"]?.stringValue ?? ""
        assetID = json["asset_id"]?.stringValue ?? json["assetId"]?.stringValue ?? ""
        placementState = FixturePlacementState(
            rawValue: json["placement_state"]?.stringValue
                ?? json["placementState"]?.stringValue
                ?? "undecided"
        ) ?? .undecided
        eligibilityState = json["eligibility_state"]?.stringValue
            ?? json["eligibilityState"]?.stringValue
            ?? "active"
        source = json["source"]?.stringValue ?? ""
        updatedAt = json["updated_at"]?.stringValue ?? json["updatedAt"]?.stringValue ?? ""
        beforePlacementState = FixturePlacementState(
            rawValue: json["before_placement_state"]?.stringValue
                ?? json["beforePlacementState"]?.stringValue
                ?? "undecided"
        ) ?? .undecided
        beforeEligibilityState = json["before_eligibility_state"]?.stringValue
            ?? json["beforeEligibilityState"]?.stringValue
            ?? "active"
    }
}

public struct EffectiveFixtureAccess: Identifiable, Sendable, Equatable {
    public var grantID: String
    public var sourceFixtureID: String
    public var sourceFixtureName: String
    public var provider: String
    public var externalIdentity: String
    public var subjectLabel: String
    public var inherited: Bool

    public var id: String { grantID }

    init(json: [String: JSONValue]) {
        grantID = json["grantId"]?.stringValue ?? ""
        sourceFixtureID = json["sourceFixtureId"]?.stringValue ?? ""
        sourceFixtureName = json["sourceFixtureName"]?.stringValue ?? ""
        provider = json["provider"]?.stringValue ?? ""
        externalIdentity = json["externalIdentity"]?.stringValue ?? ""
        subjectLabel = json["subjectLabel"]?.stringValue ?? ""
        inherited = json["inherited"]?.boolValue ?? false
    }
}

public actor FixtureWorkflowService {
    private let runner: OwnerActionRunner
    private let connectorIdentity: any OwnerConnectorIdentifying

    public init(
        runner: OwnerActionRunner,
        connectorIdentity: any OwnerConnectorIdentifying = StaticOwnerConnectorIdentity("max")
    ) {
        self.runner = runner
        self.connectorIdentity = connectorIdentity
    }

    public func tree(includeArchived: Bool = true) async throws -> [FixtureNode] {
        let result = try await run("fixture-tree-list", extra: [
            "includeArchived": .bool(includeArchived),
        ])
        return parseNodes(result["fixtures"])
    }

    public func fixtureStateMigrationPlan() async throws -> FixtureStateMigrationReport {
        let result = try await run("fixture-state-migration-plan", extra: [:])
        return FixtureStateMigrationReport(json: result["migration"]?.objectValue ?? [:])
    }

    public func applyFixtureStateMigration() async throws -> FixtureStateMigrationReport {
        let result = try await run("fixture-state-migration-apply", extra: [:])
        return FixtureStateMigrationReport(json: result["migration"]?.objectValue ?? [:])
    }

    public func candidateUniverse(fixtureID: String) async throws -> [String] {
        let result = try await run("fixture-candidate-universe", extra: [
            "fixtureId": .string(fixtureID),
        ])
        return result["candidateUniverse"]?.objectValue?["assetIds"]?.arrayValue?
            .compactMap(\.stringValue) ?? []
    }

    public func cullingWindow(
        fixtureID: String,
        view: FixtureCullingView = .undecided,
        views: [FixtureCullingView] = [],
        offset: Int = 0,
        limit: Int = 200,
        search: String = "",
        mediaTypes: [String] = [],
        ratings: [Int] = [],
        colors: [String] = []
    ) async throws -> FixtureCullingWindow {
        let result = try await run("fixture-culling-window", extra: [
            "fixtureId": .string(fixtureID),
            "view": .string(view.rawValue),
            "views": .array(views.map { .string($0.rawValue) }),
            "offset": .number(Double(max(0, offset))),
            "limit": .number(Double(max(1, min(500, limit)))),
            "search": .string(search),
            "mediaTypes": .array(mediaTypes.map(JSONValue.string)),
            "ratings": .array(ratings.map { .number(Double($0)) }),
            "colors": .array(colors.map(JSONValue.string)),
        ])
        return FixtureCullingWindow(
            json: result["cullingWindow"]?.objectValue ?? [:]
        )
    }

    public func reconcilePhotosIndex(
        dateFrom: String = "",
        dateTo: String = ""
    ) async throws -> PhotosIndexReconciliationReport {
        let connectorID = await connectorIdentity.connectorID()
        var payload: [String: JSONValue] = [
            "requestedConnector": .string(connectorID),
            "queuedAt": .string(ISO8601DateFormatter().string(from: Date())),
        ]
        let cleanDateFrom = dateFrom.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanDateTo = dateTo.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleanDateFrom.isEmpty {
            payload["dateFrom"] = .string(cleanDateFrom)
        }
        if !cleanDateTo.isEmpty {
            payload["dateTo"] = .string(cleanDateTo)
        }
        let completed = try await runner.submit(
            OwnerActionCreate(
                actionKind: "sidecar-photos-index-sync",
                target: connectorID,
                payload: payload
            ),
            idempotencyKey: [
                "native-photos-index-sync",
                connectorID,
                cleanDateFrom,
                cleanDateTo,
                UUID().uuidString,
            ]
                .joined(separator: ":")
        )
        guard let job = completed.result?["job"]?.objectValue else {
            throw APIErrorEnvelope(error: .init(
                code: "photos_index_result_missing",
                message: "The connector completed without a Photos index result."
            ))
        }
        return PhotosIndexReconciliationReport(json: job)
    }

    public func applyState(
        _ state: FixturePlacementState,
        assetIDs: [String],
        fixtureID: String,
        reason: String = ""
    ) async throws -> [FixtureAssetState] {
        let result = try await run("fixture-state-apply", extra: [
            "fixtureId": .string(fixtureID),
            "assetIds": .array(assetIDs.map(JSONValue.string)),
            "placementState": .string(state.rawValue),
            "reason": .string(reason),
        ])
        return result["fixtureState"]?.objectValue?["items"]?.arrayValue?
            .compactMap(\.objectValue)
            .map(FixtureAssetState.init(json:)) ?? []
    }

    public func reviewWindow(
        fixtureID: String,
        mode: FixtureReviewMode = .backfill,
        stateFilters: [String] = ["picked"],
        proposalAvailableOnly: Bool = false,
        mediaFilters: [String] = ["photos", "videos"],
        offset: Int = 0,
        limit: Int = 200,
        search: String = ""
    ) async throws -> FixtureReviewWindow {
        let result = try await run("fixture-review-window", extra: [
            "fixtureId": .string(fixtureID),
            "reviewMode": .string(mode.rawValue),
            "reviewStateFilters": .array(stateFilters.map(JSONValue.string)),
            "proposalAvailableOnly": .bool(proposalAvailableOnly),
            "mediaFilters": .array(mediaFilters.map(JSONValue.string)),
            "offset": .number(Double(max(0, offset))),
            "limit": .number(Double(max(1, min(500, limit)))),
            "search": .string(search),
        ])
        return FixtureReviewWindow(
            json: result["reviewWindow"]?.objectValue ?? [:]
        )
    }

    public func applyReview(
        _ action: FixtureReviewAction,
        fixtureID: String,
        assetIDs: [String],
        anchorAssetID: String,
        propagate: Bool = false,
        title: String? = nil,
        keywords: [String]? = nil,
        aiReasons: [String] = [],
        aiNote: String = ""
    ) async throws -> FixtureReviewResult {
        var extra: [String: JSONValue] = [
            "fixtureId": .string(fixtureID),
            "assetIds": .array(assetIDs.map(JSONValue.string)),
            "anchorAssetId": .string(anchorAssetID),
            "reviewAction": .string(action.rawValue),
            "propagate": .bool(propagate),
            "aiReasons": .array(aiReasons.map(JSONValue.string)),
            "aiNote": .string(aiNote),
        ]
        if let title {
            extra["title"] = .string(title)
        }
        if let keywords {
            extra["keywords"] = .array(keywords.map(JSONValue.string))
        }
        let result = try await run("fixture-review-apply", extra: extra)
        return FixtureReviewResult(
            json: result["reviewAction"]?.objectValue ?? [:]
        )
    }

    public func undoReview(operationID: String) async throws -> FixtureReviewUndoResult {
        let result = try await run("fixture-review-undo", extra: [
            "operationId": .string(operationID),
        ])
        return FixtureReviewUndoResult(
            json: result["reviewUndo"]?.objectValue ?? [:]
        )
    }

    public func aiStatus() async throws -> FixtureAIStatus {
        let result = try await run("fixture-ai-status", extra: [:])
        return FixtureAIStatus(json: result["ai"]?.objectValue ?? [:])
    }

    public func aiProposals(
        assetIDs: [String] = [],
        includeLoaded: Bool = true
    ) async throws -> [FixtureAIProposal] {
        let result = try await run("fixture-ai-proposals-ready", extra: [
            "assetIds": .array(assetIDs.map(JSONValue.string)),
            "includeLoaded": .bool(includeLoaded),
        ])
        return result["aiProposals"]?.objectValue?["items"]?.arrayValue?
            .compactMap(\.objectValue)
            .map(FixtureAIProposal.init(json:)) ?? []
    }

    public func markAIProposalsLoaded(_ proposalIDs: [String]) async throws -> Int {
        let result = try await run("fixture-ai-proposals-load", extra: [
            "proposalIds": .array(proposalIDs.map(JSONValue.string)),
        ])
        return result["aiProposals"]?.objectValue?["count"]?.intValue ?? 0
    }

    public func startAIPass() async throws -> FixtureAIStatus {
        _ = try await run("fixture-ai-pass-start", extra: [:])
        return try await aiStatus()
    }

    public func cancelAIPass() async throws -> FixtureAIStatus {
        _ = try await run("fixture-ai-pass-cancel", extra: [:])
        return try await aiStatus()
    }

    public func effectiveAccess(fixtureID: String) async throws -> [EffectiveFixtureAccess] {
        let result = try await run("fixture-access-effective", extra: [
            "fixtureId": .string(fixtureID),
        ])
        return result["access"]?.objectValue?["items"]?.arrayValue?
            .compactMap(\.objectValue)
            .map(EffectiveFixtureAccess.init(json:)) ?? []
    }

    public func configuration(fixtureID: String) async throws -> FixtureConfiguration {
        let result = try await run("fixture-configuration-get", extra: [
            "fixtureId": .string(fixtureID),
        ])
        return FixtureConfiguration(
            json: result["configuration"]?.objectValue ?? [:]
        )
    }

    public func configure(
        fixtureID: String,
        populationMode: String,
        candidateSource: [String: JSONValue],
        savedRule: [String: JSONValue],
        policy: FixturePolicyOverrides,
        templateKey: String,
        reason: String
    ) async throws -> FixtureConfiguration {
        let result = try await run("fixture-configuration-set", extra: [
            "fixtureId": .string(fixtureID),
            "populationMode": .string(populationMode),
            "candidateSource": .object(candidateSource),
            "savedRule": .object(savedRule),
            "policyOverrides": .object(policy.json),
            "templateKey": .string(templateKey),
            "reason": .string(reason),
        ])
        return FixtureConfiguration(
            json: result["configuration"]?.objectValue ?? [:]
        )
    }

    public func create(
        name: String,
        parentID: String? = nil,
        templateKey: String = ""
    ) async throws -> [FixtureNode] {
        try await runAndTree("fixture-create", extra: [
            "name": .string(name),
            "parentFixtureId": .string(parentID ?? ""),
            "templateKey": .string(templateKey),
            "tags": .array(templateKey.isEmpty ? [] : [.string(templateKey)]),
            "destinationDefaults": ["r2", "apple_photos"],
        ])
    }

    public func rename(id: String, name: String) async throws -> [FixtureNode] {
        try await runAndTree("fixture-rename", extra: [
            "fixtureId": .string(id), "name": .string(name),
        ])
    }

    public func move(id: String, parentID: String?) async throws -> [FixtureNode] {
        try await runAndTree("fixture-move", extra: [
            "fixtureId": .string(id), "parentFixtureId": .string(parentID ?? ""),
        ])
    }

    public func setArchived(id: String, archived: Bool) async throws -> [FixtureNode] {
        try await runAndTree(archived ? "fixture-archive" : "fixture-reopen", extra: [
            "fixtureId": .string(id),
        ])
    }

    public func search(
        fixtureID: String,
        query: String,
        limit: Int = 240
    ) async throws -> [FixtureAsset] {
        let result = try await run("fixture-search", extra: [
            "filters": ["query": .string(query)],
            "limit": .number(Double(limit)),
            "fixtureId": .string(fixtureID),
        ])
        let search = result["search"]?.objectValue
        return (search?["items"]?.arrayValue ?? []).compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixtureAsset(json: object)
        }
    }

    public func snapshot(
        fixtureID: String,
        assetIDs: [String],
        name: String
    ) async throws -> FixturePool {
        let result = try await run("fixture-pool-create", extra: [
            "fixtureId": .string(fixtureID),
            "selectedAssetIds": .array(assetIDs.map(JSONValue.string)),
            "name": .string(name),
            "criteria": ["source": "native-backstage"],
        ])
        let pool = result["pool"]?.objectValue ?? [:]
        return FixturePool(
            id: pool["poolId"]?.stringValue ?? "",
            name: pool["name"]?.stringValue ?? name,
            fixtureID: pool["fixtureId"]?.stringValue ?? fixtureID,
            assetCount: pool["assetCount"]?.intValue ?? assetIDs.count,
            snapshotHash: pool["snapshotHash"]?.stringValue ?? "",
            assets: parsePoolAssets(pool["assets"])
        )
    }

    public func openPool(id: String) async throws -> FixturePool {
        let result = try await run("fixture-pool-open", extra: [
            "poolId": .string(id),
        ])
        let pool = result["pool"]?.objectValue ?? [:]
        return FixturePool(
            id: pool["poolId"]?.stringValue ?? id,
            name: pool["name"]?.stringValue ?? id,
            fixtureID: pool["fixtureId"]?.stringValue ?? "",
            assetCount: pool["assetCount"]?.intValue ?? 0,
            snapshotHash: pool["snapshotHash"]?.stringValue ?? "",
            assets: parsePoolAssets(pool["assets"])
        )
    }

    public func pools(fixtureID: String, limit: Int = 50) async throws -> [FixturePoolSummary] {
        let result = try await run("fixture-pool-list", extra: [
            "fixtureId": .string(fixtureID),
            "limit": .number(Double(max(1, min(250, limit)))),
        ])
        return (result["pools"]?.arrayValue ?? []).compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixturePoolSummary(json: object)
        }
    }

    public func place(assetIDs: [String], fixtureIDs: [String], poolID: String = "") async throws -> [FixturePlacement] {
        let result = try await run("fixture-place-multi", extra: [
            "assetIds": .array(assetIDs.map(JSONValue.string)),
            "fixtureIds": .array(fixtureIDs.map(JSONValue.string)),
            "poolId": .string(poolID),
        ])
        return parsePlacements(result["ledger"])
    }

    public func placements(assetIDs: [String], fixtureID: String = "") async throws -> [FixturePlacement] {
        let result = try await run("fixture-placement-list", extra: [
            "assetIds": .array(assetIDs.map(JSONValue.string)),
            "fixtureId": .string(fixtureID),
        ])
        return parsePlacements(result["ledger"])
    }

    public func movePlacement(id: String, to fixtureID: String) async throws {
        _ = try await run("fixture-placement-move", extra: [
            "placementId": .string(id),
            "fixtureId": .string(fixtureID),
        ])
    }

    public func removePlacement(id: String) async throws {
        _ = try await run("fixture-placement-remove", extra: [
            "placementId": .string(id),
        ])
    }

    public func restorePlacement(id: String) async throws {
        _ = try await run("fixture-placement-restore", extra: [
            "placementId": .string(id),
        ])
    }

    private func runAndTree(_ mode: String, extra: [String: JSONValue]) async throws -> [FixtureNode] {
        let result = try await run(mode, extra: extra)
        return parseNodes(result["fixtures"])
    }

    private func run(_ mode: String, extra: [String: JSONValue]) async throws -> [String: JSONValue] {
        var manifest = extra
        manifest["mode"] = .string(mode)
        // Native Backstage resolves PhotoKit thumbnails itself. The connector
        // must not launch the signed bridge to attach redundant data URLs to
        // fixture reads or mutations; that made simple Review actions wait on
        // unrelated Photos objects and obscured their successful completion.
        manifest["includePreviews"] = .bool(false)
        manifest["launchWorkspace"] = .bool(false)
        let connectorID = await connectorIdentity.connectorID()
        let action = OwnerActionCreate(
            actionKind: "sidecar-culling-review",
            target: connectorID,
            payload: [
                "workflow": "universal-fixture-pipeline",
                "manifest": .object(manifest),
                "requestedConnector": .string(connectorID),
                "queuedAt": .string(ISO8601DateFormatter().string(from: Date())),
            ]
        )
        let completed = try await runner.submit(
            action,
            idempotencyKey: ["native-fixture", mode, UUID().uuidString].joined(separator: "-")
        )
        guard let result = completed.result else {
            throw APIErrorEnvelope(error: .init(
                code: "fixture_result_missing",
                message: "The connector completed without a fixture result."
            ))
        }
        return result
    }

    private func parseNodes(_ value: JSONValue?) -> [FixtureNode] {
        (value?.arrayValue ?? []).compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixtureNode(json: object)
        }
    }

    private func parsePlacements(_ value: JSONValue?) -> [FixturePlacement] {
        let rows = value?.objectValue?["items"]?.arrayValue ?? value?.arrayValue ?? []
        return rows.compactMap {
            guard let object = $0.objectValue else { return nil }
            return FixturePlacement(json: object)
        }
    }

    private func parsePoolAssets(_ value: JSONValue?) -> [FixturePoolAsset] {
        (value?.arrayValue ?? [])
            .compactMap { $0.objectValue }
            .map(FixturePoolAsset.init(json:))
            .sorted { $0.position < $1.position }
    }
}
