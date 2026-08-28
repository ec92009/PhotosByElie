import Foundation
import SQLite3

public enum OwnerDatabaseError: Error, Equatable {
    case unavailable(String)
    case backupFailed(String)
    case migrationFailed(String)
}

public struct OwnerDatabaseStatus: Sendable, Equatable {
    public var path: URL
    public var schemaVersion: Int
    public var journalMode: String
    public var readOnly: Bool
}

public protocol OwnerDatabaseReading: Sendable {
    func inspect() throws -> OwnerDatabaseStatus
}

public final class OwnerDatabaseGate: OwnerDatabaseReading, @unchecked Sendable {
    public let databaseURL: URL
    public let backupDirectory: URL

    public init(databaseURL: URL, backupDirectory: URL? = nil) {
        self.databaseURL = databaseURL
        self.backupDirectory = backupDirectory
            ?? databaseURL.deletingLastPathComponent().appendingPathComponent("backups", isDirectory: true)
    }

    public func inspect() throws -> OwnerDatabaseStatus {
        var database: OpaquePointer?
        let result = sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READONLY, nil)
        guard result == SQLITE_OK, let database else {
            throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errstr(result)))
        }
        defer { sqlite3_close(database) }
        return OwnerDatabaseStatus(
            path: databaseURL,
            schemaVersion: try scalarInt(database, sql: "PRAGMA user_version"),
            journalMode: try scalarText(database, sql: "PRAGMA journal_mode"),
            readOnly: true
        )
    }

    public func migrate(
        to version: Int,
        statements: [String],
        expectedCurrentVersion: Int,
        identifier: String? = nil
    ) throws -> URL {
        let migrationIdentifier = identifier ?? "owner-v\(version)"
        guard migrationIdentifier.range(of: #"^[A-Za-z0-9._-]+$"#, options: .regularExpression) != nil else {
            throw OwnerDatabaseError.migrationFailed("Migration identifier is not portable.")
        }
        try FileManager.default.createDirectory(at: backupDirectory, withIntermediateDirectories: true)
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let backupURL = backupDirectory.appendingPathComponent("Owner-\(stamp).sqlite")
        try createVerifiedBackup(at: backupURL)

        var database: OpaquePointer?
        let result = sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READWRITE, nil)
        guard result == SQLITE_OK, let database else {
            throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errstr(result)))
        }
        defer { sqlite3_close(database) }

        do {
            guard try scalarInt(database, sql: "PRAGMA user_version") == expectedCurrentVersion else {
                throw OwnerDatabaseError.migrationFailed("Schema changed before migration.")
            }
            try execute(database, sql: "BEGIN IMMEDIATE")
            try execute(
                database,
                sql: """
                CREATE TABLE IF NOT EXISTS grdb_migrations (
                    identifier TEXT PRIMARY KEY NOT NULL
                )
                """
            )
            guard try scalarInt(
                database,
                sql: "SELECT COUNT(*) FROM grdb_migrations WHERE identifier = '\(migrationIdentifier)'"
            ) == 0 else {
                throw OwnerDatabaseError.migrationFailed("Migration was already applied.")
            }
            for statement in statements { try execute(database, sql: statement) }
            try execute(
                database,
                sql: "INSERT INTO grdb_migrations(identifier) VALUES ('\(migrationIdentifier)')"
            )
            try execute(database, sql: "PRAGMA user_version = \(version)")
            try execute(database, sql: "COMMIT")
        } catch {
            _ = try? execute(database, sql: "ROLLBACK")
            throw error
        }
        return backupURL
    }

    private func createVerifiedBackup(at destination: URL) throws {
        var source: OpaquePointer?
        var target: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &source, SQLITE_OPEN_READONLY, nil) == SQLITE_OK,
              let source else {
            throw OwnerDatabaseError.backupFailed("Could not open source database.")
        }
        defer { sqlite3_close(source) }
        guard sqlite3_open(destination.path, &target) == SQLITE_OK, let target else {
            throw OwnerDatabaseError.backupFailed("Could not open backup database.")
        }
        defer { sqlite3_close(target) }
        guard let backup = sqlite3_backup_init(target, "main", source, "main") else {
            throw OwnerDatabaseError.backupFailed("Could not initialize SQLite backup.")
        }
        let step = sqlite3_backup_step(backup, -1)
        let finish = sqlite3_backup_finish(backup)
        guard step == SQLITE_DONE && finish == SQLITE_OK else {
            throw OwnerDatabaseError.backupFailed("SQLite backup did not complete.")
        }
        guard try scalarText(target, sql: "PRAGMA integrity_check") == "ok" else {
            throw OwnerDatabaseError.backupFailed("Backup integrity check failed.")
        }
    }

    private func execute(_ database: OpaquePointer, sql: String) throws {
        var message: UnsafeMutablePointer<CChar>?
        let result = sqlite3_exec(database, sql, nil, nil, &message)
        guard result == SQLITE_OK else {
            let text = message.map { String(cString: $0) } ?? String(cString: sqlite3_errmsg(database))
            sqlite3_free(message)
            throw OwnerDatabaseError.migrationFailed(text)
        }
    }

    private func scalarInt(_ database: OpaquePointer, sql: String) throws -> Int {
        Int(try scalar(database, sql: sql) { sqlite3_column_int64($0, 0) })
    }

    private func scalarText(_ database: OpaquePointer, sql: String) throws -> String {
        try scalar(database, sql: sql) {
            guard let text = sqlite3_column_text($0, 0) else { return "" }
            return String(cString: text)
        }
    }

    private func scalar<T>(_ database: OpaquePointer, sql: String, read: (OpaquePointer) -> T) throws -> T {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else {
            throw OwnerDatabaseError.unavailable("SQLite query returned no row.")
        }
        return read(statement)
    }
}

/// Resolves the authoritative Owner-private database used by native Review.
///
/// The repository root follows the same precedence as the on-demand connector:
/// an explicit PBE_REPO_ROOT takes precedence over connector.json. The path is
/// intentionally the Owner-private SQLite under assets/owner-actions; a loose
/// Owner.sqlite at the repository root is not authoritative and must never be
/// selected by the native Review runtime.
public struct OwnerReviewDatabaseLocator: Sendable {
    private let configURL: URL
    private let environment: [String: String]

    public init(
        configURL: URL? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        self.configURL = configURL ?? URL(
            fileURLWithPath: NSHomeDirectory(),
            isDirectory: true
        ).appendingPathComponent(
            ".config/photosbyelie/connector.json",
            isDirectory: false
        )
        self.environment = environment
    }

    public func resolve() -> URL? {
        guard let root = environment["PBE_REPO_ROOT"]
            .map(Self.rootURL)
            ?? configuredRepoRoot() else {
            return nil
        }
        return root.appendingPathComponent(
            "assets/owner-actions/Owner.sqlite",
            isDirectory: false
        ).standardizedFileURL
    }

    private func configuredRepoRoot() -> URL? {
        guard let data = try? Data(contentsOf: configURL),
              let object = try? JSONSerialization.jsonObject(with: data),
              let payload = object as? [String: Any],
              let value = payload["repoRoot"] as? String else {
            return nil
        }
        return Self.rootURL(value)
    }

    private static func rootURL(_ value: String) -> URL? {
        let cleanValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanValue.isEmpty else { return nil }
        return URL(fileURLWithPath: cleanValue, isDirectory: true).standardizedFileURL
    }
}
