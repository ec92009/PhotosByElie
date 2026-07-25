import Foundation

public struct AccessPerson: Codable, Identifiable, Sendable, Equatable {
    public var email: String
    public var displayName: String?
    public var roles: [String]?
    public var groupIds: [String]?
    public var realEstateClients: [String]?
    public var notes: String?
    public var fixture: Bool?
    public var disabledAt: String?

    public var id: String { email }
    public var isDisabled: Bool { disabledAt != nil }

    public init(
        email: String,
        displayName: String = "",
        roles: [String] = ["user"],
        groupIds: [String] = [],
        realEstateClients: [String] = [],
        notes: String = "",
        fixture: Bool = false
    ) {
        self.email = email.lowercased()
        self.displayName = displayName
        self.roles = roles
        self.groupIds = groupIds
        self.realEstateClients = realEstateClients
        self.notes = notes
        self.fixture = fixture
    }
}

public struct AccessGalleryDefaults: Codable, Sendable, Equatable {
    public var watermarked: Bool?
    public var saleEnabled: Bool?
    public var downloads: Bool?
    public var pdf: Bool?
    public var video: Bool?
    public var memberOriginals: Bool?
    public var ownerOriginals: Bool?

    public init(
        watermarked: Bool = true,
        saleEnabled: Bool = false,
        downloads: Bool = true,
        pdf: Bool = false,
        video: Bool = false,
        memberOriginals: Bool = false,
        ownerOriginals: Bool = true
    ) {
        self.watermarked = watermarked
        self.saleEnabled = saleEnabled
        self.downloads = downloads
        self.pdf = pdf
        self.video = video
        self.memberOriginals = memberOriginals
        self.ownerOriginals = ownerOriginals
    }
}

public struct AccessGroup: Codable, Identifiable, Sendable, Equatable {
    public var id: String
    public var label: String?
    public var kind: String?
    public var galleryKind: String?
    public var galleryKey: String?
    public var accessPolicy: String?
    public var capabilities: [String]?
    public var galleryDefaults: AccessGalleryDefaults?
    public var fixture: Bool?
    public var state: String?

    public var isArchived: Bool { state == "archived" }

    public init(
        id: String,
        label: String,
        kind: String = "event",
        galleryKind: String = "event",
        galleryKey: String? = nil,
        accessPolicy: String = "",
        capabilities: [String] = ["view_gallery", "view_watermarked"],
        galleryDefaults: AccessGalleryDefaults = .init(),
        fixture: Bool = false
    ) {
        self.id = id
        self.label = label
        self.kind = kind
        self.galleryKind = galleryKind
        self.galleryKey = galleryKey ?? id
        self.accessPolicy = accessPolicy
        self.capabilities = capabilities
        self.galleryDefaults = galleryDefaults
        self.fixture = fixture
    }
}

public struct AccessControlState: Codable, Sendable, Equatable {
    public var people: [AccessPerson]?
    public var audienceGroups: [AccessGroup]?
    // The ACS state endpoint returns option descriptors here (for example
    // {"id":"manage_access","label":"Manage access"}), not only stable IDs.
    // Keep the payload lossless because Backstage does not currently render
    // these option catalogs.
    public var capabilities: [JSONValue]?
    public var roles: [JSONValue]?
    public var fixtureEvents: [JSONValue]?
    public var auditEvents: [JSONValue]?

    public var allPeople: [AccessPerson] { people ?? [] }
    public var allGroups: [AccessGroup] { audienceGroups ?? [] }

    public init(
        people: [AccessPerson] = [],
        audienceGroups: [AccessGroup] = [],
        capabilities: [JSONValue] = [],
        roles: [JSONValue] = [],
        fixtureEvents: [JSONValue] = [],
        auditEvents: [JSONValue] = []
    ) {
        self.people = people
        self.audienceGroups = audienceGroups
        self.capabilities = capabilities
        self.roles = roles
        self.fixtureEvents = fixtureEvents
        self.auditEvents = auditEvents
    }
}

private struct AccessPersonEnvelope: Codable { let user: AccessPerson }
private struct AccessGroupEnvelope: Codable { let group: AccessGroup }
private struct AccessFixtureSeedEnvelope: Codable { let fixtures: [JSONValue]? }

public actor AccessControlService {
    private let api: OwnerAPIClient

    public init(api: OwnerAPIClient) {
        self.api = api
    }

    public func load() async throws -> AccessControlState {
        try await api.request(path: "/acs/state")
    }

    public func save(person: AccessPerson) async throws -> AccessPerson {
        let envelope: AccessPersonEnvelope = try await api.request(
            path: "/acs/people",
            body: person,
            idempotencyKey: "person-\(person.email.lowercased())-\(UUID().uuidString)"
        )
        return envelope.user
    }

    public func disable(personID: String) async throws -> AccessPerson {
        let envelope: AccessPersonEnvelope = try await api.request(
            path: "/acs/people/\(personID.urlPathEncoded)/disable",
            body: [String: String](),
            idempotencyKey: "disable-person-\(personID.lowercased())-\(UUID().uuidString)"
        )
        return envelope.user
    }

    public func save(group: AccessGroup) async throws -> AccessGroup {
        let envelope: AccessGroupEnvelope = try await api.request(
            path: "/acs/groups",
            body: group,
            idempotencyKey: "group-\(group.id)-\(UUID().uuidString)"
        )
        return envelope.group
    }

    public func archive(groupID: String) async throws -> AccessGroup {
        let envelope: AccessGroupEnvelope = try await api.request(
            path: "/acs/groups/\(groupID.urlPathEncoded)/archive",
            body: [String: String](),
            idempotencyKey: "archive-group-\(groupID)-\(UUID().uuidString)"
        )
        return envelope.group
    }

    @discardableResult
    public func seedFixtureGroups() async throws -> [JSONValue] {
        let envelope: AccessFixtureSeedEnvelope = try await api.request(
            path: "/fixtures/seed",
            body: [String: String](),
            idempotencyKey: "seed-fixture-access-\(UUID().uuidString)"
        )
        return envelope.fixtures ?? []
    }
}

private extension String {
    var urlPathEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? self
    }
}
