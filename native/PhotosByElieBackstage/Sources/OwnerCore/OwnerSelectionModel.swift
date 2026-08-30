import Foundation

public enum OwnerSelectionDirection: Sendable {
    case previous
    case next
}

public struct OwnerSelectionModel<ID: Hashable & Sendable>: Sendable {
    public private(set) var orderedIDs: [ID]
    public private(set) var selectedIDs: Set<ID>
    public private(set) var anchorID: ID?
    public private(set) var focusedID: ID?

    public init(
        orderedIDs: [ID] = [],
        selectedIDs: Set<ID> = [],
        anchorID: ID? = nil,
        focusedID: ID? = nil
    ) {
        self.orderedIDs = orderedIDs
        self.selectedIDs = selectedIDs.intersection(orderedIDs)
        self.anchorID = anchorID
        self.focusedID = focusedID
    }

    /// The explicit selection in the same stable order as the current grid.
    ///
    /// Callers should not rebuild action targets from a separately recomputed
    /// filtered collection: a refresh can briefly make the button look enabled
    /// while yielding an empty action target. The selection model already owns
    /// the authoritative ordered item snapshot for zero, one, and batch actions.
    public var selectedInDisplayOrder: [ID] {
        orderedIDs.filter(selectedIDs.contains)
    }

    public mutating func replaceItems(_ ids: [ID]) {
        orderedIDs = ids
        selectedIDs.formIntersection(ids)
        if let anchorID, !ids.contains(anchorID) { self.anchorID = nil }
        if let focusedID, !ids.contains(focusedID) { self.focusedID = nil }
    }

    /// Reconciles the selection with a new visible order while guaranteeing a
    /// focused selection whenever at least one item remains visible.
    ///
    /// Existing visible selections survive intact. If every selected item was
    /// filtered out, the nearest following item is preferred, then the nearest
    /// preceding item. A newly loaded non-empty collection with no prior focus
    /// selects its first item.
    @discardableResult
    public mutating func replaceItemsEnsuringSelection(
        _ ids: [ID],
        direction: OwnerSelectionDirection = .next
    ) -> ID? {
        let previousIDs = orderedIDs
        let previousFocusedID = focusedID
            ?? anchorID
            ?? previousIDs.first(where: selectedIDs.contains)
        let previousIndex = previousFocusedID.flatMap(previousIDs.firstIndex(of:))
        replaceItems(ids)

        if !selectedIDs.isEmpty {
            let replacementFocus = focusedID.flatMap {
                selectedIDs.contains($0) ? $0 : nil
            } ?? ids.first(where: selectedIDs.contains)
            focusedID = replacementFocus
            if anchorID.map(selectedIDs.contains) != true {
                anchorID = replacementFocus
            }
            return replacementFocus
        }

        guard let fallback = nearestSurvivingID(
            in: ids,
            previousIDs: previousIDs,
            previousIndex: previousIndex,
            direction: direction
        ) else {
            anchorID = nil
            focusedID = nil
            return nil
        }
        selectedIDs = [fallback]
        anchorID = fallback
        focusedID = fallback
        return fallback
    }

    @discardableResult
    public mutating func replaceItems(
        _ ids: [ID],
        selectingSuccessorAfterRemoving removedID: ID,
        direction: OwnerSelectionDirection = .next
    ) -> ID? {
        let previousIDs = orderedIDs
        let removedIndex = previousIDs.firstIndex(of: removedID)
        replaceItems(ids)

        guard !ids.contains(removedID), selectedIDs.isEmpty, let removedIndex else {
            return focusedID
        }

        let remainingIDs = Set(ids)
        let successor = previousIDs
            .dropFirst(removedIndex + 1)
            .first(where: remainingIDs.contains)
        let predecessor = previousIDs[..<removedIndex]
            .reversed()
            .first(where: remainingIDs.contains)
        let replacement: ID? = switch direction {
        case .next:
            successor ?? predecessor
        case .previous:
            predecessor ?? successor
        }
        guard let replacement else {
            return nil
        }
        selectedIDs = [replacement]
        anchorID = replacement
        focusedID = replacement
        return replacement
    }

    public mutating func click(_ id: ID, extending: Bool, toggling: Bool) {
        guard orderedIDs.contains(id) else { return }
        if extending, let anchorID {
            selectedIDs = range(from: anchorID, through: id)
        } else if toggling {
            if selectedIDs.contains(id) {
                selectedIDs.remove(id)
            } else {
                selectedIDs.insert(id)
            }
            anchorID = id
        } else {
            selectedIDs = [id]
            anchorID = id
        }
        focusedID = id
    }

    public mutating func move(_ direction: OwnerSelectionDirection, extending: Bool) {
        move(by: direction == .previous ? -1 : 1, extending: extending)
    }

    public mutating func move(by delta: Int, extending: Bool) {
        guard !orderedIDs.isEmpty else { return }
        let currentIndex = focusedID.flatMap(orderedIDs.firstIndex(of:))
            ?? anchorID.flatMap(orderedIDs.firstIndex(of:))
            ?? 0
        let nextIndex = min(orderedIDs.count - 1, max(0, currentIndex + delta))
        let destination = orderedIDs[nextIndex]
        if extending, let anchorID {
            selectedIDs = range(from: anchorID, through: destination)
        } else {
            selectedIDs = [destination]
            anchorID = destination
        }
        focusedID = destination
    }

    public mutating func selectAll() {
        selectedIDs = Set(orderedIDs)
        anchorID = orderedIDs.first
        focusedID = orderedIDs.last
    }

    public mutating func clear() {
        selectedIDs.removeAll()
        anchorID = nil
        focusedID = nil
    }

    private func nearestSurvivingID(
        in ids: [ID],
        previousIDs: [ID],
        previousIndex: Int?,
        direction: OwnerSelectionDirection
    ) -> ID? {
        guard !ids.isEmpty else { return nil }
        guard let previousIndex else { return ids.first }
        let remainingIDs = Set(ids)
        let successor = previousIDs
            .dropFirst(previousIndex + 1)
            .first(where: remainingIDs.contains)
        let predecessor = previousIDs[..<previousIndex]
            .reversed()
            .first(where: remainingIDs.contains)
        return switch direction {
        case .next:
            successor ?? predecessor ?? ids.first
        case .previous:
            predecessor ?? successor ?? ids.first
        }
    }

    private func range(from start: ID, through end: ID) -> Set<ID> {
        guard let startIndex = orderedIDs.firstIndex(of: start),
              let endIndex = orderedIDs.firstIndex(of: end) else {
            return []
        }
        let bounds = min(startIndex, endIndex)...max(startIndex, endIndex)
        return Set(orderedIDs[bounds])
    }
}
