import Foundation

public enum CullingGridLayout {
    public static let minimumColumnWidth = 84.0
    public static let spacing = 8.0
    public static let maximumColumns = 10

    public static func maximumColumnsThatFit(width: Double) -> Int {
        guard width > 0 else { return 1 }
        let count = Int((width + spacing) / (minimumColumnWidth + spacing))
        return min(maximumColumns, max(1, count))
    }

    public static func clampedColumnCount(_ requested: Int, width: Double) -> Int {
        min(max(1, requested), maximumColumnsThatFit(width: width))
    }

    public static func columnWidth(width: Double, columns: Int) -> Double {
        let count = max(1, columns)
        let available = width - (Double(count - 1) * spacing)
        return max(minimumColumnWidth, available / Double(count))
    }
}

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

    public static var selectableCases: [Self] { [.photos, .videos] }
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

    public static var selectableCases: [Self] { [.undecided, .picked, .rejected] }
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

    public static var selectableCases: [Self] {
        [.none, .red, .yellow, .green, .blue, .purple]
    }
}

public struct CullingQuery: Sendable, Equatable {
    public var search: String
    public var media: Set<CullingMediaFilter>
    public var pick: Set<CullingPickFilter>
    public var ratings: Set<Int>
    public var colors: Set<CullingColorFilter>

    public init(
        search: String = "",
        media: Set<CullingMediaFilter> = Set(CullingMediaFilter.selectableCases),
        pick: Set<CullingPickFilter> = Set(CullingPickFilter.selectableCases),
        ratings: Set<Int> = Set(0...5),
        colors: Set<CullingColorFilter> = Set(CullingColorFilter.selectableCases)
    ) {
        self.search = search
        self.media = media
        self.pick = pick
        self.ratings = ratings
        self.colors = colors
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

    public init(
        total: Int,
        filtered: Int,
        undecided: Int,
        picked: Int,
        rejected: Int,
        photos: Int,
        videos: Int
    ) {
        self.total = total
        self.filtered = filtered
        self.undecided = undecided
        self.picked = picked
        self.rejected = rejected
        self.photos = photos
        self.videos = videos
    }
}

public struct CullingWorkspaceResult: Sendable, Equatable {
    public var items: [CullingCandidate]
    public var summary: CullingSummary
    public var offset: Int
    public var limit: Int

    public init(
        items: [CullingCandidate],
        summary: CullingSummary,
        offset: Int,
        limit: Int
    ) {
        self.items = items
        self.summary = summary
        self.offset = offset
        self.limit = limit
    }

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
    public static func captureDate(_ value: String) -> Date? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: trimmed) {
            return date
        }

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: trimmed)
    }

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
        let mediaFilter: CullingMediaFilter = media == "video" ? .videos : .photos
        guard query.media.contains(mediaFilter) else { return false }
        let pickFilter = normalizedPick(candidate.decision.pickState)
        guard query.pick.contains(pickFilter) else { return false }
        guard query.ratings.contains(candidate.decision.rating) else { return false }
        let colorFilter = CullingColorFilter(
            rawValue: candidate.decision.color.isEmpty ? "none" : candidate.decision.color
        ) ?? .none
        guard query.colors.contains(colorFilter) else { return false }
        return true
    }

    private static func normalizedMedia(_ value: String) -> String {
        value.lowercased().contains("video") ? "video" : "photo"
    }

    private static func normalizedPick(_ value: String) -> CullingPickFilter {
        switch value.lowercased() {
        case "picked", "pick", "included":
            .picked
        case "hidden", "rejected", "reject", "excluded":
            .rejected
        default:
            .undecided
        }
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

    /// Suggests visible burst frames that are safe candidates for a bulk hide.
    ///
    /// The selection is deliberately inclusive: the operator can Command-click
    /// any false positives away before pressing H. The second displayed frame
    /// remains unselected as the likely keeper, matching the normal two-frame
    /// capture cadence while making longer visible bursts quick to reduce.
    public static func burstRejectCandidates(
        containing focusedID: String,
        in orderedItems: [CullingTimedItem],
        maximumSpan: TimeInterval = 60
    ) -> [String] {
        guard let focusedIndex = orderedItems.firstIndex(where: { $0.id == focusedID }),
              let focusedDate = orderedItems[focusedIndex].capturedAt else {
            return []
        }
        var lower = focusedIndex
        while lower > 0,
              let previous = orderedItems[lower - 1].capturedAt,
              abs(previous.timeIntervalSince(focusedDate)) <= maximumSpan {
            lower -= 1
        }
        var upper = focusedIndex
        while upper + 1 < orderedItems.count,
              let next = orderedItems[upper + 1].capturedAt,
              abs(next.timeIntervalSince(focusedDate)) <= maximumSpan {
            upper += 1
        }
        let burstIDs = orderedItems[lower...upper].map(\.id)
        guard burstIDs.count > 1 else { return [] }
        return burstIDs.enumerated().compactMap { index, id in
            index == 1 ? nil : id
        }
    }

    /// Selects likely duplicate frames inside each capture-time burst.
    ///
    /// A missing timestamp or a gap larger than `maximumGap` ends the current
    /// burst. Standalone frames are never selected. Within every real burst,
    /// the second frame remains unselected as the likely keeper while the
    /// first, third, and later frames become reversible hide candidates.
    public static func burstRejectCandidates(
        in orderedItems: [CullingTimedItem],
        maximumGap: TimeInterval = 2
    ) -> [String] {
        var candidates: [String] = []
        var group: [CullingTimedItem] = []

        func appendCandidates() {
            guard group.count > 1 else {
                group.removeAll(keepingCapacity: true)
                return
            }
            candidates.append(
                contentsOf: group.enumerated().compactMap { index, item in
                    index == 1 ? nil : item.id
                }
            )
            group.removeAll(keepingCapacity: true)
        }

        for item in orderedItems {
            guard let capturedAt = item.capturedAt else {
                appendCandidates()
                continue
            }
            if let previous = group.last?.capturedAt,
               abs(capturedAt.timeIntervalSince(previous)) > maximumGap {
                appendCandidates()
            }
            group.append(item)
        }
        appendCandidates()
        return candidates
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
