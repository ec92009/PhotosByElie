import Foundation

public enum FixtureSelectionAvailability: Sendable, Equatable {
    case loading
    case ready
    case unavailable(String)
}

public struct PBEOwnerFixtureSession: Sendable, Equatable {
    public let sessionID: String
    public let fixtureID: String
    public let fixtureBreadcrumb: String
    public let sourceIdentity: String
    public let catalogIdentity: String
    public let readinessIdentity: String
    public let capabilities: Set<String>
    public let lifecycleWriter: String
    public let expiresAt: Date

    public init(
        sessionID: String = "",
        fixtureID: String,
        fixtureBreadcrumb: String,
        sourceIdentity: String = "",
        catalogIdentity: String = "",
        readinessIdentity: String = "",
        capabilities: Set<String> = [],
        lifecycleWriter: String = "",
        expiresAt: Date
    ) {
        self.sessionID = sessionID
        self.fixtureID = fixtureID
        self.fixtureBreadcrumb = fixtureBreadcrumb
        self.sourceIdentity = sourceIdentity
        self.catalogIdentity = catalogIdentity
        self.readinessIdentity = readinessIdentity
        self.capabilities = capabilities
        self.lifecycleWriter = lifecycleWriter
        self.expiresAt = expiresAt
    }

    public var isActionable: Bool {
        !sessionID.isEmpty
            && !sourceIdentity.isEmpty
            && !catalogIdentity.isEmpty
            && !readinessIdentity.isEmpty
            && capabilities.isSuperset(
                of: ["gallery.read", "waste-basket.x", "waste-basket.restore"]
            )
            && lifecycleWriter == "pbb-79-waste-basket"
    }
}

public enum FixtureSelectionError: Error, Sendable, Equatable, LocalizedError {
    case unavailable(String)
    case unknownFixture
    case archivedFixture
    case ownerSessionActive(PBEOwnerFixtureSession)
    case invalidSessionExpiry
    case ownerSessionMismatch
    case invalidOwnerSessionContract

    public var errorDescription: String? {
        switch self {
        case let .unavailable(reason):
            reason
        case .unknownFixture:
            "That fixture is no longer available. Refresh the fixture tree before trying again."
        case .archivedFixture:
            "Archived fixtures cannot become the current fixture."
        case let .ownerSessionActive(session):
            "The PBE Owner session is using \(session.fixtureBreadcrumb). Close it or let it expire before changing fixtures."
        case .invalidSessionExpiry:
            "A PBE Owner session needs a future expiry time."
        case .ownerSessionMismatch:
            "The PBE Owner session does not match Backstage's current frozen fixture."
        case .invalidOwnerSessionContract:
            "PBE Owner did not return the required authentication, identity, readiness, and Waste Basket capabilities."
        }
    }
}

/// Owns the one stable fixture selection shared by every Backstage surface.
///
/// This type is deliberately presentation/session state only. It validates an
/// already-loaded fixture tree and never reads or mutates Owner workflow data.
public struct FixtureSelectionCoordinator: Sendable, Equatable {
    public static let expoFixtureID = "fixture-expo"

    public private(set) var selectedFixtureID: String?
    public private(set) var selectedFixtureBreadcrumb: String?
    public private(set) var preferredFixtureID: String?
    public private(set) var availability: FixtureSelectionAvailability = .loading
    public private(set) var notice: String?
    public private(set) var ownerSession: PBEOwnerFixtureSession?

    private var activeFixtureIDs = Set<String>()
    private var archivedFixtureIDs = Set<String>()
    private var breadcrumbsByFixtureID: [String: String] = [:]

    public init(lastUsedFixtureID: String? = nil) {
        let normalized = lastUsedFixtureID?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        preferredFixtureID = normalized?.isEmpty == false ? normalized : nil
    }

    public var fixtureScopedActionsAllowed: Bool {
        guard availability == .ready, let selectedFixtureID else { return false }
        return activeFixtureIDs.contains(selectedFixtureID)
    }

    public var chooserDisabled: Bool {
        availability != .ready || ownerSession != nil
    }

    public var chooserExplanation: String? {
        if let ownerSession {
            return "PBE Owner is using \(ownerSession.fixtureBreadcrumb). Close that session or let it expire to change fixtures."
        }
        switch availability {
        case .loading:
            return "Loading fixtures…"
        case .ready:
            return nil
        case let .unavailable(reason):
            return reason
        }
    }

    public mutating func beginLoading() {
        availability = .loading
        notice = nil
    }

    public mutating func cancelLoading() {
        guard let selectedFixtureID,
              activeFixtureIDs.contains(selectedFixtureID),
              breadcrumbsByFixtureID[selectedFixtureID] != nil else {
            markUnavailable(
                "Fixture loading was cancelled before a safe current fixture was available. Fixture-scoped actions are disabled."
            )
            return
        }
        selectedFixtureBreadcrumb = breadcrumbsByFixtureID[selectedFixtureID]
        availability = .ready
        notice = "Fixture refresh was cancelled. Backstage kept the previous current fixture."
    }

    @discardableResult
    public mutating func restore(
        from fixtures: [FixtureNode],
        now: Date = Date()
    ) -> String? {
        expireOwnerSessionIfNeeded(at: now)
        index(fixtures)

        if let ownerSession {
            guard activeFixtureIDs.contains(ownerSession.fixtureID) else {
                markUnavailable(
                    "The fixture frozen for the PBE Owner session is missing or archived. Fixture-scoped actions are unavailable until the session closes."
                )
                return nil
            }
            applySelection(ownerSession.fixtureID)
            availability = .ready
            notice = nil
            return selectedFixtureID
        }

        if let preferredFixtureID,
           activeFixtureIDs.contains(preferredFixtureID) {
            applySelection(preferredFixtureID)
            availability = .ready
            notice = nil
            return selectedFixtureID
        }

        let fallbackReason: String
        if let preferredFixtureID,
           archivedFixtureIDs.contains(preferredFixtureID) {
            fallbackReason = "The last-used fixture is archived, so Backstage is using Expo."
        } else if preferredFixtureID != nil {
            fallbackReason = "The last-used fixture is no longer available, so Backstage is using Expo."
        } else {
            fallbackReason = "No last-used fixture was found, so Backstage is using Expo."
        }

        guard activeFixtureIDs.contains(Self.expoFixtureID) else {
            let reason = archivedFixtureIDs.contains(Self.expoFixtureID)
                ? "Expo is archived, so Backstage cannot choose a safe fallback. Fixture-scoped actions are unavailable."
                : "Expo is missing, so Backstage cannot choose a safe fallback. Fixture-scoped actions are unavailable."
            markUnavailable(reason)
            return nil
        }

        applySelection(Self.expoFixtureID)
        preferredFixtureID = Self.expoFixtureID
        availability = .ready
        notice = fallbackReason
        return selectedFixtureID
    }

    public mutating func selectFixture(
        _ fixtureID: String,
        now: Date = Date()
    ) throws {
        expireOwnerSessionIfNeeded(at: now)
        if let ownerSession {
            throw FixtureSelectionError.ownerSessionActive(ownerSession)
        }
        guard availability == .ready else {
            throw FixtureSelectionError.unavailable(
                chooserExplanation ?? "Fixtures are unavailable."
            )
        }
        guard !archivedFixtureIDs.contains(fixtureID) else {
            throw FixtureSelectionError.archivedFixture
        }
        guard activeFixtureIDs.contains(fixtureID) else {
            throw FixtureSelectionError.unknownFixture
        }
        applySelection(fixtureID)
        preferredFixtureID = fixtureID
        notice = nil
    }

    public mutating func beginPBEOwnerSession(
        expiresAt: Date,
        now: Date = Date()
    ) throws -> PBEOwnerFixtureSession {
        expireOwnerSessionIfNeeded(at: now)
        if let ownerSession {
            throw FixtureSelectionError.ownerSessionActive(ownerSession)
        }
        guard expiresAt > now else {
            throw FixtureSelectionError.invalidSessionExpiry
        }
        guard fixtureScopedActionsAllowed,
              let fixtureID = selectedFixtureID,
              let breadcrumb = selectedFixtureBreadcrumb else {
            throw FixtureSelectionError.unavailable(
                chooserExplanation ?? "Choose an available fixture before starting PBE Owner."
            )
        }
        let session = PBEOwnerFixtureSession(
            fixtureID: fixtureID,
            fixtureBreadcrumb: breadcrumb,
            expiresAt: expiresAt
        )
        ownerSession = session
        notice = nil
        return session
    }

    public mutating func beginPBEOwnerSession(
        _ session: PBEOwnerFixtureSession,
        now: Date = Date()
    ) throws -> PBEOwnerFixtureSession {
        expireOwnerSessionIfNeeded(at: now)
        if let ownerSession {
            throw FixtureSelectionError.ownerSessionActive(ownerSession)
        }
        guard session.expiresAt > now else {
            throw FixtureSelectionError.invalidSessionExpiry
        }
        guard session.isActionable else {
            throw FixtureSelectionError.invalidOwnerSessionContract
        }
        guard fixtureScopedActionsAllowed,
              session.fixtureID == selectedFixtureID,
              session.fixtureBreadcrumb == selectedFixtureBreadcrumb else {
            throw FixtureSelectionError.ownerSessionMismatch
        }
        ownerSession = session
        notice = nil
        return session
    }

    public mutating func closePBEOwnerSession() {
        guard ownerSession != nil else { return }
        ownerSession = nil
        notice = "PBE Owner session closed. Fixture selection is available again."
    }

    @discardableResult
    public mutating func expireOwnerSessionIfNeeded(at now: Date = Date()) -> Bool {
        guard let ownerSession, ownerSession.expiresAt <= now else { return false }
        self.ownerSession = nil
        notice = "PBE Owner session expired. Fixture selection is available again."
        return true
    }

    public mutating func markUnavailable(_ reason: String) {
        availability = .unavailable(reason)
        selectedFixtureID = nil
        selectedFixtureBreadcrumb = nil
        notice = nil
    }

    private mutating func index(_ fixtures: [FixtureNode]) {
        activeFixtureIDs = []
        archivedFixtureIDs = []
        breadcrumbsByFixtureID = [:]
        var seenFixtureIDs = Set<String>()

        func visit(_ fixture: FixtureNode, path: [String]) {
            guard !fixture.id.isEmpty,
                  seenFixtureIDs.insert(fixture.id).inserted else { return }
            let breadcrumb = (path + [fixture.name]).joined(separator: " › ")
            breadcrumbsByFixtureID[fixture.id] = breadcrumb
            if fixture.isArchived {
                archivedFixtureIDs.insert(fixture.id)
            } else {
                activeFixtureIDs.insert(fixture.id)
            }
            for child in fixture.children {
                visit(child, path: path + [fixture.name])
            }
        }

        for root in fixtures {
            visit(root, path: [])
        }
    }

    private mutating func applySelection(_ fixtureID: String) {
        selectedFixtureID = fixtureID
        selectedFixtureBreadcrumb = breadcrumbsByFixtureID[fixtureID]
    }
}
