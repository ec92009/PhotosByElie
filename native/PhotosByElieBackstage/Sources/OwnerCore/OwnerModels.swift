import Foundation

public struct APIErrorEnvelope: Codable, Error, Sendable, Equatable {
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
        self.progress = progress
        self.timing = timing
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
    public var refreshToken: String
    public var refreshExpiresAt: Date
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
    public var payload: [String: String]

    public init(actionKind: String, target: String, payload: [String: String] = [:]) {
        self.actionKind = actionKind
        self.target = target
        self.payload = payload
    }
}

public struct OwnerActionEnvelope: Codable, Sendable, Equatable {
    public var action: OwnerAction
    public var idempotencyReplayed: Bool?
}

