import Foundation

public enum JSONValue: Codable, Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value."
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .bool(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    public var stringValue: String? {
        guard case let .string(value) = self else { return nil }
        return value
    }

    public var intValue: Int? {
        guard case let .number(value) = self else { return nil }
        return Int(exactly: value)
    }

    public var boolValue: Bool? {
        guard case let .bool(value) = self else { return nil }
        return value
    }

    public var objectValue: [String: JSONValue]? {
        guard case let .object(value) = self else { return nil }
        return value
    }

    public var arrayValue: [JSONValue]? {
        guard case let .array(value) = self else { return nil }
        return value
    }
}

extension JSONValue: ExpressibleByStringLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
}

extension JSONValue: ExpressibleByIntegerLiteral {
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
}

extension JSONValue: ExpressibleByFloatLiteral {
    public init(floatLiteral value: Double) { self = .number(value) }
}

extension JSONValue: ExpressibleByBooleanLiteral {
    public init(booleanLiteral value: Bool) { self = .bool(value) }
}

extension JSONValue: ExpressibleByArrayLiteral {
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
}

extension JSONValue: ExpressibleByDictionaryLiteral {
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        self = .object(Dictionary(uniqueKeysWithValues: elements))
    }
}

extension JSONValue: ExpressibleByNilLiteral {
    public init(nilLiteral: ()) { self = .null }
}

public struct APIErrorEnvelope: Codable, Error, LocalizedError, CustomStringConvertible, Sendable, Equatable {
    public struct Detail: Codable, Sendable, Equatable {
        public var code: String
        public var message: String
        public var details: [String: String]?

        public init(code: String, message: String, details: [String: String]? = nil) {
            self.code = code
            self.message = message
            self.details = details
        }
    }

    public var error: Detail
    public init(error: Detail) { self.error = error }

    public var errorDescription: String? { error.message }
    public var description: String { error.message }
}

public struct OwnerPage: Codable, Sendable, Equatable {
    public var nextCursor: String?
    public var hasMore: Bool

    public init(nextCursor: String? = nil, hasMore: Bool = false) {
        self.nextCursor = nextCursor
        self.hasMore = hasMore
    }
}

public enum OwnerActionState: String, Codable, Sendable, CaseIterable {
    case queued, claimed, running, completed, failed, cancelled
}

public struct OwnerProgress: Codable, Sendable, Equatable {
    public var phase: String
    public var completed: Int
    public var total: Int
    public var percent: Double
    public var detail: String?

    public init(phase: String, completed: Int, total: Int, percent: Double, detail: String? = nil) {
        self.phase = phase
        self.completed = completed
        self.total = total
        self.percent = percent
        self.detail = detail
    }
}

public struct OwnerActionTiming: Codable, Sendable, Equatable {
    public var queuedAt: Date?
    public var locallyAwakenedAt: Date?
    public var claimedAt: Date?
    public var executedAt: Date?
    public var completedAt: Date?
    public var cancelledAt: Date?

    public init(
        queuedAt: Date? = nil,
        locallyAwakenedAt: Date? = nil,
        claimedAt: Date? = nil,
        executedAt: Date? = nil,
        completedAt: Date? = nil,
        cancelledAt: Date? = nil
    ) {
        self.queuedAt = queuedAt
        self.locallyAwakenedAt = locallyAwakenedAt
        self.claimedAt = claimedAt
        self.executedAt = executedAt
        self.completedAt = completedAt
        self.cancelledAt = cancelledAt
    }
}

public struct OwnerAction: Codable, Identifiable, Sendable, Equatable {
    public var id: String
    public var actionKind: String
    public var target: String
    public var state: OwnerActionState
    public var createdBy: String?
    public var createdAt: Date?
    public var updatedAt: Date?
    public var claimedAt: Date?
    public var completedAt: Date?
    public var payload: [String: JSONValue]?
    public var result: [String: JSONValue]?
    public var error: [String: JSONValue]?
    public var progress: OwnerProgress?
    public var timing: OwnerActionTiming?

    public init(
        id: String,
        actionKind: String,
        target: String,
        state: OwnerActionState,
        createdBy: String? = nil,
        createdAt: Date? = nil,
        updatedAt: Date? = nil,
        claimedAt: Date? = nil,
        completedAt: Date? = nil,
        payload: [String: JSONValue]? = nil,
        result: [String: JSONValue]? = nil,
        error: [String: JSONValue]? = nil,
        progress: OwnerProgress? = nil,
        timing: OwnerActionTiming? = nil
    ) {
        self.id = id
        self.actionKind = actionKind
        self.target = target
        self.state = state
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.claimedAt = claimedAt
        self.completedAt = completedAt
        self.payload = payload
        self.result = result
        self.error = error
        self.progress = progress
        self.timing = timing
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case actionKind
        case type
        case target
        case state
        case createdBy
        case createdAt
        case updatedAt
        case claimedAt
        case completedAt
        case payload
        case result
        case error
        case progress
        case timing
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        actionKind = try container.decodeIfPresent(String.self, forKey: .actionKind)
            ?? container.decodeIfPresent(String.self, forKey: .type)
            ?? "unknown"
        state = try container.decode(OwnerActionState.self, forKey: .state)
        payload = try container.decodeIfPresent([String: JSONValue].self, forKey: .payload)
        target = try container.decodeIfPresent(String.self, forKey: .target)
            ?? payload?["requestedConnector"]?.stringValue
            ?? "cloud"
        createdBy = try container.decodeIfPresent(String.self, forKey: .createdBy)
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        claimedAt = try container.decodeIfPresent(Date.self, forKey: .claimedAt)
        completedAt = try container.decodeIfPresent(Date.self, forKey: .completedAt)
        result = try container.decodeIfPresent([String: JSONValue].self, forKey: .result)
        error = try container.decodeIfPresent([String: JSONValue].self, forKey: .error)
        progress = try container.decodeIfPresent(OwnerProgress.self, forKey: .progress)
        timing = try container.decodeIfPresent(OwnerActionTiming.self, forKey: .timing)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(actionKind, forKey: .actionKind)
        try container.encode(target, forKey: .target)
        try container.encode(state, forKey: .state)
        try container.encodeIfPresent(createdBy, forKey: .createdBy)
        try container.encodeIfPresent(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
        try container.encodeIfPresent(claimedAt, forKey: .claimedAt)
        try container.encodeIfPresent(completedAt, forKey: .completedAt)
        try container.encodeIfPresent(payload, forKey: .payload)
        try container.encodeIfPresent(result, forKey: .result)
        try container.encodeIfPresent(error, forKey: .error)
        try container.encodeIfPresent(progress, forKey: .progress)
        try container.encodeIfPresent(timing, forKey: .timing)
    }
}

public struct OwnerActionPage: Codable, Sendable, Equatable {
    public var actions: [OwnerAction]
    public var page: OwnerPage
}

public struct OwnerTokenBundle: Codable, Sendable, Equatable {
    public var tokenType: String
    public var accessToken: String
    public var expiresIn: Int
    public var accessExpiresAt: Date
}

public struct OwnerDevice: Codable, Identifiable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var platform: String
    public var createdAt: Date
    public var lastUsedAt: Date?
    public var revokedAt: Date?
}

public struct OwnerConnector: Codable, Identifiable, Sendable, Equatable {
    public var id: String
    public var hostname: String?
    public var platform: String?
    public var version: String?
    public var lastSeenAt: Date?
    public var capabilities: [String]?
}

public struct OwnerJob: Codable, Identifiable, Sendable, Equatable {
    public var id: String
    public var status: OwnerActionState
    public var progress: OwnerProgress?
    public var createdAt: Date?
    public var updatedAt: Date?
}

public struct OwnerActionCreate: Codable, Sendable, Equatable {
    public var actionKind: String
    public var target: String
    public var payload: [String: JSONValue]

    public init(actionKind: String, target: String, payload: [String: JSONValue] = [:]) {
        self.actionKind = actionKind
        self.target = target
        self.payload = payload
    }
}

public struct OwnerActionEnvelope: Codable, Sendable, Equatable {
    public var action: OwnerAction
    public var idempotencyReplayed: Bool?
}
