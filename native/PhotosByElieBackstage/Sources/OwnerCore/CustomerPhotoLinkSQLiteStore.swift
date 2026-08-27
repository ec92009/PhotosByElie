import Foundation
import SQLite3

public enum CustomerPhotoLinkError: Error, Equatable, Sendable {
    case unavailable
    case noVerifiedPublication
    case ambiguousPublication
}

/// A customer URL, never an Owner URL, bootstrap token, local Photos ID fallback,
/// or arbitrary URL read from the private ledger.
public struct CustomerPhotoLink: Equatable, Sendable {
    public let url: URL

    public init(publishedMediaID: String) throws {
        guard !publishedMediaID.isEmpty,
              publishedMediaID.utf8.count <= 1_024,
              publishedMediaID == publishedMediaID.trimmingCharacters(in: .whitespacesAndNewlines),
              !publishedMediaID.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw CustomerPhotoLinkError.noVerifiedPublication }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "photos-by-elie.com"
        components.path = "/photo.html"
        components.queryItems = [URLQueryItem(name: "id", value: publishedMediaID)]
        // URLSearchParams treats a raw + as a space.
        components.percentEncodedQuery = components.percentEncodedQuery?
            .replacingOccurrences(of: "+", with: "%2B")
        guard let url = components.url else { throw CustomerPhotoLinkError.noVerifiedPublication }
        self.url = url
    }
}

public protocol CustomerPhotoLinkResolving: Sendable {
    func resolve(assetID: String, fixtureID: String) throws -> CustomerPhotoLink
}

/// No database creation, migration, Photos access, networking, or Owner session.
/// A local upload is not proof of publication. Match the fixture's live source
/// version to a verified public-catalog receipt, retaining an older live version
/// while a new editorial version is under review.
public struct CustomerPhotoLinkSQLiteStore: CustomerPhotoLinkResolving {
    private let databaseURL: URL
    private static let catalogURL = "https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite"

    public init(databaseURL: URL) {
        self.databaseURL = databaseURL.standardizedFileURL
    }

    public func resolve(assetID: String, fixtureID: String) throws -> CustomerPhotoLink {
        guard [assetID, fixtureID].allSatisfy({
            !$0.isEmpty && !$0.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        }) else {
            throw CustomerPhotoLinkError.noVerifiedPublication
        }
        var database: OpaquePointer?
        guard sqlite3_open_v2(
            databaseURL.path, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil
        ) == SQLITE_OK, let database else {
            if let database { sqlite3_close_v2(database) }
            throw CustomerPhotoLinkError.unavailable
        }
        defer { sqlite3_close_v2(database) }
        sqlite3_busy_timeout(database, 1_000)
        let sql = """
        SELECT catalog.media_id, catalog.public_url, catalog.catalog_sha256, catalog.verified_at
        FROM asset_publications AS publication
        JOIN fixtures AS fixture ON fixture.fixture_id = publication.fixture_id
        JOIN public_catalog_publications AS catalog
          ON catalog.asset_id = publication.asset_id
         AND catalog.source_version_hash = publication.source_version_hash
        WHERE publication.asset_id = ? AND publication.fixture_id = ?
          AND publication.state = 'live' AND publication.withdrawn_at IS NULL
          AND trim(publication.source_version_hash) <> ''
          AND fixture.archived_at IS NULL AND catalog.state = 'live'
          AND NOT EXISTS (
            SELECT 1 FROM sidecar_tombstones AS tombstone
            WHERE tombstone.asset_id = publication.asset_id AND tombstone.tombstone_state = 'active'
          )
          AND NOT EXISTS (
            SELECT 1 FROM media_lifecycle AS lifecycle
            WHERE lifecycle.media_id = catalog.media_id AND lifecycle.lifecycle_state <> 'active'
          )
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else { throw CustomerPhotoLinkError.unavailable }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (index, value) in [assetID, fixtureID].enumerated() {
            let result = value.withCString {
                sqlite3_bind_text(statement, Int32(index + 1), $0, -1, transient)
            }
            guard result == SQLITE_OK else { throw CustomerPhotoLinkError.unavailable }
        }
        var destination: CustomerPhotoLink?
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                let values = (0..<4).map {
                    guard let bytes = sqlite3_column_text(statement, Int32($0)) else { return "" }
                    return String(bytes: UnsafeBufferPointer(
                        start: bytes, count: Int(sqlite3_column_bytes(statement, Int32($0)))
                    ), encoding: .utf8) ?? ""
                }
                let dateParser = ISO8601DateFormatter()
                dateParser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                let fractionalDate = dateParser.date(from: values[3])
                dateParser.formatOptions = [.withInternetDateTime]
                guard values[1] == Self.catalogURL,
                      values[2].utf8.count == 64,
                      values[2].utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
                      fractionalDate != nil || dateParser.date(from: values[3]) != nil
                else { throw CustomerPhotoLinkError.noVerifiedPublication }
                let link = try CustomerPhotoLink(publishedMediaID: values[0])
                if let destination, destination != link {
                    throw CustomerPhotoLinkError.ambiguousPublication
                }
                destination = link
            case SQLITE_DONE:
                guard let destination else { throw CustomerPhotoLinkError.noVerifiedPublication }
                return destination
            default:
                throw CustomerPhotoLinkError.unavailable
            }
        }
    }
}
