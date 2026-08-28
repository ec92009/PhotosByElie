import Foundation

public protocol OwnerConnectorIdentifying: Sendable {
    func connectorID() async -> String
}

public struct StaticOwnerConnectorIdentity: OwnerConnectorIdentifying {
    private let value: String

    public init(_ value: String) {
        self.value = Self.clean(value) ?? "max"
    }

    public func connectorID() async -> String {
        value
    }

    fileprivate static func clean(_ value: String) -> String? {
        let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !candidate.isEmpty, candidate.count <= 64 else { return nil }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789_-")
        guard candidate.unicodeScalars.allSatisfy(allowed.contains) else { return nil }
        return candidate
    }
}

/// Identifies the explicitly selected connector authority without contacting a
/// daemon or reading its credential-bearing config. Max remains the production
/// writer until a separate authority migration injects another target.
public struct LocalOwnerConnectorIdentity: OwnerConnectorIdentifying {
    private let value: String

    public init(target: String = "max") {
        value = StaticOwnerConnectorIdentity.clean(target) ?? "max"
    }

    public func connectorID() async -> String {
        value
    }
}
