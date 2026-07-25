import Foundation

public enum CullingMediaFilter: String, CaseIterable, Sendable {
    case all
    case photos
    case videos

    public var label: String {
        switch self {
        case .all: "All media"
        case .photos: "Photos"
        case .videos: "Videos"
        }
    }
}

public enum CullingPickFilter: String, CaseIterable, Sendable {
    case all
    case undecided
    case picked
    case rejected

    public var label: String {
        switch self {
        case .all: "All decisions"
        case .undecided: "Undecided"
        case .picked: "Picked"
        case .rejected: "Rejected"
        }
    }
}

public enum CullingColorFilter: String, CaseIterable, Sendable {
    case all
    case none
    case red
    case yellow
    case green
    case blue
    case purple

    public var label: String {
        switch self {
        case .all: "All colors"
        case .none: "No color"
        default: rawValue.capitalized
        }
    }
}

public struct CullingQuery: Sendable, Equatable {
    public var search: String
    public var media: CullingMediaFilter
    public var pick: CullingPickFilter
    public var rating: Int?
    public var color: CullingColorFilter

    public init(
        search: String = "",
        media: CullingMediaFilter = .all,
        pick: CullingPickFilter = .all,
        rating: Int? = nil,
        color: CullingColorFilter = .all
    ) {
        self.search = search
        self.media = media
        self.pick = pick
        self.rating = rating
        self.color = color
    }
}

public struct CullingCandidate: Identifiable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var filename: String
    public var mediaType: String
    public var decision: SidecarDecisionState

    public init(
        id: String,
        title: String = "",
        filename: String,
        mediaType: String,
        decision: SidecarDecisionState? = nil
    ) {
        self.id = id
        self.title = title
        self.filename = filename
        self.mediaType = mediaType
        self.decision = decision ?? SidecarDecisionState(assetId: id)
    }
}

public struct CullingSummary: Sendable, Equatable {
    public var total: Int
    public var filtered: Int
    public var undecided: Int
    public var picked: Int
    public var rejected: Int
    public var photos: Int
    public var videos: Int
}

public struct CullingWorkspaceResult: Sendable, Equatable {
    public var items: [CullingCandidate]
    public var summary: CullingSummary
    public var offset: Int
    public var limit: Int

    public var hasPrevious: Bool { offset > 0 }
    public var hasNext: Bool { offset + items.count < summary.filtered }
    public var visibleRange: ClosedRange<Int>? {
        guard !items.isEmpty else { return nil }
        return (offset + 1)...(offset + items.count)
    }
}

public struct CullingTimedItem: Identifiable, Sendable, Equatable {
    public var id: String
    public var capturedAt: Date?

    public init(id: String, capturedAt: Date?) {
        self.id = id
        self.capturedAt = capturedAt
    }
}

public enum CullingWorkspace {
    public static func evaluate(
        _ candidates: [CullingCandidate],
        query: CullingQuery,
        offset: Int = 0,
        limit: Int = 200
    ) -> CullingWorkspaceResult {
        let filtered = candidates.filter { matches($0, query: query) }
        let boundedLimit = max(1, min(500, limit))
        let boundedOffset = min(max(0, offset), max(0, filtered.count - 1))
        let end = min(filtered.count, boundedOffset + boundedLimit)
        let window = boundedOffset < end ? Array(filtered[boundedOffset..<end]) : []
        let states = candidates.map(\.decision.pickState)
        return CullingWorkspaceResult(
            items: window,
            summary: CullingSummary(
                total: candidates.count,
                filtered: filtered.count,
                undecided: states.count(where: { $0 == "undecided" }),
                picked: states.count(where: { $0 == "picked" }),
                rejected: states.count(where: { $0 == "rejected" }),
                photos: candidates.count(where: { normalizedMedia($0.mediaType) == "photo" }),
                videos: candidates.count(where: { normalizedMedia($0.mediaType) == "video" })
            ),
            offset: filtered.isEmpty ? 0 : boundedOffset,
            limit: boundedLimit
        )
    }

    private static func matches(_ candidate: CullingCandidate, query: CullingQuery) -> Bool {
        let terms = query.search
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .split(whereSeparator: \.isWhitespace)
        let haystack = (
            [candidate.title, candidate.filename, candidate.decision.title]
                + candidate.decision.keywords
        )
        .joined(separator: " ")
        .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        guard terms.allSatisfy({ haystack.contains($0) }) else { return false }

        let media = normalizedMedia(candidate.mediaType)
        if query.media == .photos, media != "photo" { return false }
        if query.media == .videos, media != "video" { return false }
        if query.pick != .all, candidate.decision.pickState != query.pick.rawValue { return false }
        if let rating = query.rating, candidate.decision.rating != rating { return false }
        switch query.color {
        case .all:
            break
        case .none:
            if !candidate.decision.color.isEmpty { return false }
        default:
            if candidate.decision.color != query.color.rawValue { return false }
        }
        return true
    }

    private static func normalizedMedia(_ value: String) -> String {
        value.lowercased().contains("video") ? "video" : "photo"
    }

    public static func burst(
        containing focusedID: String,
        in orderedItems: [CullingTimedItem],
        maximumGap: TimeInterval = 2
    ) -> [String] {
        guard let focusedIndex = orderedItems.firstIndex(where: { $0.id == focusedID }),
              orderedItems[focusedIndex].capturedAt != nil else {
            return orderedItems.contains(where: { $0.id == focusedID }) ? [focusedID] : []
        }
        var lower = focusedIndex
        while lower > 0,
              let current = orderedItems[lower].capturedAt,
              let previous = orderedItems[lower - 1].capturedAt,
              abs(current.timeIntervalSince(previous)) <= maximumGap {
            lower -= 1
        }
        var upper = focusedIndex
        while upper + 1 < orderedItems.count,
              let current = orderedItems[upper].capturedAt,
              let next = orderedItems[upper + 1].capturedAt,
              abs(next.timeIntervalSince(current)) <= maximumGap {
            upper += 1
        }
        return orderedItems[lower...upper].map(\.id)
    }
}

public extension FixtureNode {
    func path(to fixtureID: String) -> [FixtureNode]? {
        if id == fixtureID { return [self] }
        for child in children {
            if let childPath = child.path(to: fixtureID) {
                return [self] + childPath
            }
        }
        return nil
    }
}

public extension Array where Element == FixtureNode {
    func path(to fixtureID: String) -> [FixtureNode] {
        for root in self {
            if let path = root.path(to: fixtureID) { return path }
        }
        return []
    }
}
