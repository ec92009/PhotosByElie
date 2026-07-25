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

    public mutating func replaceItems(_ ids: [ID]) {
        orderedIDs = ids
        selectedIDs.formIntersection(ids)
        if let anchorID, !ids.contains(anchorID) { self.anchorID = nil }
        if let focusedID, !ids.contains(focusedID) { self.focusedID = nil }
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
        guard !orderedIDs.isEmpty else { return }
        let currentIndex = focusedID.flatMap(orderedIDs.firstIndex(of:))
            ?? anchorID.flatMap(orderedIDs.firstIndex(of:))
            ?? 0
        let nextIndex: Int
        switch direction {
        case .previous: nextIndex = max(0, currentIndex - 1)
        case .next: nextIndex = min(orderedIDs.count - 1, currentIndex + 1)
        }
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

    private func range(from start: ID, through end: ID) -> Set<ID> {
        guard let startIndex = orderedIDs.firstIndex(of: start),
              let endIndex = orderedIDs.firstIndex(of: end) else {
            return []
        }
        let bounds = min(startIndex, endIndex)...max(startIndex, endIndex)
        return Set(orderedIDs[bounds])
    }
}
