import Foundation
import SQLite3
import Testing
@testable import OwnerCore
@testable import BackstageUI

@Suite("Gallery source availability")
struct PhotoSourceAvailabilityTests {
    @Test("Exact observations preserve unchecked photos and editorial/delivery data; restoration is reversible")
    func exactReconciliation() throws {
        let fixture = try AvailabilityDatabase()
        let store = OwnerPhotoAvailabilitySQLiteStore(databaseURL: fixture.url)
        #expect(try store.reconcile(["deleted": false, "returned": true]) == 2)
        #expect(try fixture.scalar("SELECT missing_at FROM sidecar_assets WHERE asset_id='deleted'") != "")
        #expect(try fixture.scalar("SELECT missing_at FROM sidecar_assets WHERE asset_id='unchecked'") == "")
        #expect(try fixture.scalar("SELECT missing_at FROM sidecar_assets WHERE asset_id='returned'") == "")
        #expect(try fixture.scalar("SELECT decision FROM fixture_decisions") == "picked")
        #expect(try fixture.scalar("SELECT delivery FROM sold_assets") == "permanent-original")
        #expect(try store.reconcile(["deleted": false, "returned": true]) == 0)
        #expect(try store.reconcile(["deleted": true]) == 1)
        #expect(try fixture.scalar("SELECT missing_at FROM sidecar_assets WHERE asset_id='deleted'") == "")
        #expect(try store.reconcile([:]) == 0)
    }

    @Test("A failed observation batch rolls back and an oversized batch is rejected")
    func atomicAndBounded() throws {
        let fixture = try AvailabilityDatabase()
        try fixture.execute("CREATE TRIGGER stop_update BEFORE UPDATE ON sidecar_assets WHEN NEW.asset_id='returned' BEGIN SELECT RAISE(ABORT, 'busy'); END")
        let store = OwnerPhotoAvailabilitySQLiteStore(databaseURL: fixture.url)
        #expect(throws: (any Error).self) { try store.reconcile(["deleted": false, "returned": true]) }
        #expect(try fixture.scalar("SELECT missing_at FROM sidecar_assets WHERE asset_id='deleted'") == "")
        let tooMany = Dictionary(uniqueKeysWithValues: (0...500).map { ("asset-\($0)", false) })
        #expect(throws: (any Error).self) { try store.reconcile(tooMany) }
    }

    @Test("Gallery reconciles only exact identities in its snapshot and leaves unknown results alone")
    @MainActor
    func visibleSourcesOnly() async throws {
        let fixture = try AvailabilityDatabase()
        let library = AvailabilityLibrary(observations: ["photos-deleted": false, "not-requested": false])
        let model = makeModel(library, database: fixture.url)
        let result = try await model.reconcileVisiblePhotoSources()
        #expect(result.checked == 1 && result.unavailable == 1)
        #expect(library.requested == ["photos-deleted", "photos-unchecked"])
        #expect(try fixture.scalar("SELECT missing_at FROM sidecar_assets WHERE asset_id='deleted'") != "")
        #expect(try fixture.scalar("SELECT missing_at FROM sidecar_assets WHERE asset_id='unchecked'") == "")
    }

    @Test("Refresh acknowledges before delayed work, rejects duplicates and releases on failure")
    @MainActor
    func refreshInterlocks() async throws {
        let fixture = try AvailabilityDatabase()
        let library = AvailabilityLibrary(observations: [:], failAfterDelay: true)
        let model = makeModel(library, database: fixture.url)
        model.cullingStatus = "Stale preview failure"
        let task = Task { await model.refreshPhotosAndRecentIndex() }
        for _ in 0..<1_000 where library.calls == 0 { await Task.yield() }
        #expect(model.isReconcilingPhotosIndex)
        #expect(model.isPhotoLibraryOperationInProgress)
        #expect(model.cullingStatus != "Stale preview failure")
        await model.refreshPhotosAndRecentIndex()
        #expect(library.calls == 1)
        await task.value
        #expect(!model.isReconcilingPhotosIndex)
        #expect(!model.isPhotoLibraryOperationInProgress)
        #expect(model.cullingStatus.contains("source check failed"))
        #expect(try fixture.scalar("SELECT missing_at FROM sidecar_assets WHERE asset_id='deleted'") == "")
    }

    @MainActor
    private func makeModel(_ library: AvailabilityLibrary, database: URL) -> BackstageViewModel {
        let model = BackstageViewModel(
            photoLibrary: library, workflowRecoveryStore: nil,
            sourceAvailabilityStore: OwnerPhotoAvailabilitySQLiteStore(databaseURL: database),
            currentImageSizeCache: nil, currentEquipmentCache: nil, equipmentBackfillStore: nil,
            externalEditJobStore: nil, customerPhotoLinks: nil
        )
        model.installFixtureTree(
            [FixtureNode(id: "availability-fixture", name: "Availability")],
            preferredFixtureID: "availability-fixture", persistSelection: false
        )
        model.fixtureCullingWindow = FixtureCullingWindow(json: [
            "fixtureId": "availability-fixture",
            "items": .array([("deleted", "photos-deleted"), ("unchecked", "photos-unchecked")].map { id, local in
                .object(["assetId": .string(id), "photoLibraryIdentifier": .string(local), "mediaType": "photo"])
            })
        ])
        return model
    }

    @Test("Cancelling a delayed source check releases refresh without marking sources missing")
    @MainActor
    func cancellationPreservesSources() async throws {
        let fixture = try AvailabilityDatabase()
        let library = AvailabilityLibrary(observations: [:], failAfterDelay: true)
        let model = makeModel(library, database: fixture.url)
        let task = Task { await model.refreshPhotosAndRecentIndex() }
        for _ in 0..<1_000 where library.calls == 0 { await Task.yield() }
        task.cancel()
        await task.value
        #expect(!model.isPhotoLibraryOperationInProgress)
        #expect(model.cullingStatus == "Gallery refresh cancelled.")
        #expect(try fixture.scalar("SELECT missing_at FROM sidecar_assets WHERE asset_id='deleted'") == "")
    }
}

private final class AvailabilityLibrary: PhotoLibraryServing, @unchecked Sendable {
    private let lock = NSLock()
    private let observations: [String: Bool]
    private let failAfterDelay: Bool
    private var requests: [[String]] = []
    var requested: [String] { lock.withLock { requests.last ?? [] } }
    var calls: Int { lock.withLock { requests.count } }
    init(observations: [String: Bool], failAfterDelay: Bool = false) {
        self.observations = observations
        self.failAfterDelay = failAfterDelay
    }
    func authorization() -> PhotoLibraryAccess { .authorized }
    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }
    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }
    func sourceAvailability(identifiers: [String]) async throws -> [String: Bool] {
        lock.withLock { requests.append(identifiers) }
        if failAfterDelay {
            try await Task.sleep(for: .milliseconds(100))
            throw PhotoLibraryError.accessDenied
        }
        return observations
    }
    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }
    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }
}

private final class AvailabilityDatabase {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("availability-\(UUID().uuidString).sqlite")
    private var database: OpaquePointer?
    init() throws {
        guard sqlite3_open(url.path, &database) == SQLITE_OK else { throw PhotoLibraryError.accessDenied }
        try execute("""
            CREATE TABLE sidecar_assets(asset_id TEXT PRIMARY KEY, missing_at TEXT);
            INSERT INTO sidecar_assets VALUES ('deleted', ''), ('unchecked', ''), ('returned', 'previous');
            CREATE TABLE fixture_decisions(decision TEXT); INSERT INTO fixture_decisions VALUES ('picked');
            CREATE TABLE sold_assets(delivery TEXT); INSERT INTO sold_assets VALUES ('permanent-original');
            """)
    }
    deinit { sqlite3_close(database); try? FileManager.default.removeItem(at: url) }
    func execute(_ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw OwnerDatabaseError.unavailable(String(cString: sqlite3_errmsg(database)))
        }
    }
    func scalar(_ sql: String) throws -> String {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
            throw OwnerDatabaseError.unavailable("Could not read test database")
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW, let text = sqlite3_column_text(statement, 0) else { return "" }
        return String(cString: text)
    }
}
