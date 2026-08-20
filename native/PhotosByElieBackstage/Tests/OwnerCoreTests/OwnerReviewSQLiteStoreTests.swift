import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("Owner Review SQLite parity")
struct OwnerReviewSQLiteStoreTests {
    @Test("Hide and exact Undo stay inside one Swift SQLite transaction")
    func hideAndUndoCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-sqlite-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)

        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)
        let applied = try store.applyReview(
            .hide,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1", "asset-2", "asset-1"],
            anchorAssetID: "asset-2",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        #expect(applied.action == .hide)
        #expect(applied.fixtureID == "fixture-expo")
        #expect(applied.anchorAssetID == "asset-2")
        #expect(applied.changes.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(applied.changes.first?.review["placementState"]?.stringValue == "hidden")
        #expect(applied.changes.first?.review["proposalReady"]?.boolValue == false)
        #expect(applied.timing["localTransaction"]?.objectValue?["durationMs"] != nil)
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "hidden")
        #expect(try scalar(databaseURL, "SELECT eligibility_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "active")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "superseded")
        #expect(try scalar(databaseURL, "SELECT state FROM fixture_review_operations WHERE operation_id = '\(applied.operationID)'") == "applied")

        let undone = try store.undoReview(
            operationID: applied.operationID,
            now: Date(timeIntervalSince1970: 1_800_000_001)
        )
        #expect(!undone.alreadyUndone)
        #expect(undone.changes.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(undone.changes.first?.review["placementState"]?.stringValue == "picked")
        #expect(undone.changes.first?.review["proposalReady"]?.boolValue == true)
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "ready")
        #expect(try scalar(databaseURL, "SELECT state FROM fixture_review_operations WHERE operation_id = '\(applied.operationID)'") == "undone")

        let replay = try store.undoReview(operationID: applied.operationID)
        #expect(replay.alreadyUndone)
        #expect(replay.changes.isEmpty)
    }

    @Test("Local Review service can apply and undo through native SQLite without IPC")
    func localServiceUsesNativeSQLite() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-native-service-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)

        let service = LocalFixtureReviewService(
            endpoints: [],
            nativeDatabaseURL: databaseURL
        )
        let applied = try await service.applyReview(manifest: [
            "fixtureId": .string("fixture-expo"),
            "assetIds": .array([.string("asset-1")]),
            "anchorAssetId": .string("asset-1"),
            "reviewAction": .string("hide"),
            "propagate": .bool(false),
            "aiReasons": .array([]),
            "aiNote": .string(""),
        ])

        #expect(applied.action == .hide)
        #expect(applied.changes.map(\.assetID) == ["asset-1"])
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "hidden")

        let undone = try await service.undoReview(operationID: applied.operationID)
        #expect(!undone.alreadyUndone)
        #expect(undone.changes.map(\.assetID) == ["asset-1"])
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
    }

    @Test("Native Review service does not create a missing database")
    func localServiceMissingNativeDatabaseFailsClosed() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-native-missing-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        let service = LocalFixtureReviewService(
            endpoints: [],
            nativeDatabaseURL: databaseURL
        )

        await #expect(throws: APIErrorEnvelope.self) {
            try await service.applyReview(manifest: [
                "fixtureId": .string("fixture-expo"),
                "assetIds": .array([.string("asset-1")]),
                "reviewAction": .string("hide"),
            ])
        }
        #expect(!FileManager.default.fileExists(atPath: databaseURL.path))
    }

    @Test("Approve accepts the visible proposal and exact Undo restores it")
    func approveAndUndoCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-approve-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)

        let applied = try store.applyReview(
            .approve,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"],
            anchorAssetID: "asset-1",
            proposalID: "proposal-1",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        #expect(applied.action == .approve)
        #expect(applied.changes.first?.review["editorialState"]?.stringValue == "approved")
        #expect(applied.changes.first?.review["title"]?.stringValue == "Proposed title")
        #expect(applied.changes.first?.review["deliveryState"]?.stringValue == "needs-upload")
        #expect(applied.changes.first?.review["proposalReady"]?.boolValue == false)
        #expect(try scalar(databaseURL, "SELECT metadata_state FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "approved")
        #expect(try scalar(databaseURL, "SELECT title FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "Proposed title")
        #expect(try scalar(databaseURL, "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'") == "needs-upload")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "accepted")

        let undone = try store.undoReview(
            operationID: applied.operationID,
            now: Date(timeIntervalSince1970: 1_800_000_001)
        )
        #expect(!undone.alreadyUndone)
        #expect(undone.action == .approve)
        #expect(undone.changes.first?.review["editorialState"]?.stringValue == "unreviewed")
        #expect(undone.changes.first?.review["title"]?.stringValue == "Decision title")
        #expect(undone.changes.first?.review["deliveryState"]?.stringValue == "not-ready")
        #expect(undone.changes.first?.review["proposalReady"]?.boolValue == true)
        #expect(try scalar(databaseURL, "SELECT metadata_state FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "unreviewed")
        #expect(try scalar(databaseURL, "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'") == "not-ready")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "ready")
    }

    @Test("Return to Review clears approval and exact Undo restores it")
    func returnToReviewAndUndoCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-return-(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)

        _ = try store.applyReview(
            .approve,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"],
            anchorAssetID: "asset-1",
            proposalID: "proposal-1",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )
        let returned = try store.applyReview(
            .returnToReview,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"],
            anchorAssetID: "asset-1",
            now: Date(timeIntervalSince1970: 1_800_000_001)
        )

        #expect(returned.action == .returnToReview)
        #expect(returned.changes.first?.review["editorialState"]?.stringValue == "unreviewed")
        #expect(returned.changes.first?.review["title"]?.stringValue == "Proposed title")
        #expect(returned.changes.first?.review["deliveryState"]?.stringValue == "not-ready")
        #expect(try scalar(databaseURL, "SELECT metadata_state FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "unreviewed")
        #expect(try scalar(databaseURL, "SELECT approved_at IS NULL FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "1")
        #expect(try scalar(databaseURL, "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'") == "not-ready")

        let undone = try store.undoReview(
            operationID: returned.operationID,
            now: Date(timeIntervalSince1970: 1_800_000_002)
        )
        #expect(!undone.alreadyUndone)
        #expect(undone.action == .returnToReview)
        #expect(undone.changes.first?.review["editorialState"]?.stringValue == "approved")
        #expect(undone.changes.first?.review["deliveryState"]?.stringValue == "needs-upload")
        #expect(try scalar(databaseURL, "SELECT metadata_state FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "approved")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "accepted")

        try execute(
            databaseURL,
            "UPDATE asset_delivery_state SET delivery_state = 'live' WHERE asset_id = 'asset-1'"
        )
        #expect(throws: OwnerReviewSQLiteError.self) {
            try store.applyReview(
                .returnToReview,
                fixtureID: "fixture-expo",
                assetIDs: ["asset-1"],
                anchorAssetID: "asset-1"
            )
        }
        #expect(try scalar(databaseURL, "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "approved")
        #expect(try scalar(databaseURL, "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'") == "live")

        #expect(throws: OwnerReviewSQLiteError.self) {
            try store.applyReview(
                .returnToReview,
                fixtureID: "fixture-expo",
                assetIDs: ["asset-2"],
                anchorAssetID: "asset-2"
            )
        }
    }

    @Test("Approve refuses a superseded visible proposal")
    func approveProposalConflictIsFailClosed() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-approve-conflict-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)
        try execute(
            databaseURL,
            "UPDATE asset_ai_proposals SET status = 'superseded' WHERE proposal_id = 'proposal-1'"
        )

        #expect(throws: OwnerReviewSQLiteError.self) {
            try store.applyReview(
                .approve,
                fixtureID: "fixture-expo",
                assetIDs: ["asset-1"],
                anchorAssetID: "asset-1",
                proposalID: "proposal-1"
            )
        }
        #expect(try scalar(databaseURL, "SELECT metadata_state FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "unreviewed")
    }

    @Test("Request AI records reasons and exact Undo restores the prior proposal")
    func requestAIAndUndoCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-request-ai-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)

        let applied = try store.applyReview(
            .requestAI,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1", "asset-2", "asset-1"],
            anchorAssetID: "asset-1",
            aiReasons: ["better title", "better title", "location"],
            aiNote: "  Resolve the location and title.  ",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        #expect(applied.action == .requestAI)
        #expect(applied.changes.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(applied.changes.first?.review["editorialState"]?.stringValue == "requesting-ai")
        #expect(applied.changes.first?.review["aiReasons"]?.arrayValue?.map(\.stringValue) == ["better title", "location"])
        #expect(applied.changes.first?.review["aiNote"]?.stringValue == "Resolve the location and title.")
        #expect(applied.changes.first?.review["placementState"]?.stringValue == "picked")
        #expect(applied.changes.first?.review["proposalReady"]?.boolValue == false)
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "superseded")
        #expect(try scalar(databaseURL, "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "requesting-ai")

        let undone = try store.undoReview(
            operationID: applied.operationID,
            now: Date(timeIntervalSince1970: 1_800_000_001)
        )

        #expect(!undone.alreadyUndone)
        #expect(undone.action == .requestAI)
        #expect(undone.changes.first?.review["editorialState"]?.stringValue == "unreviewed")
        #expect(undone.changes.first?.review["aiReasons"]?.arrayValue?.isEmpty == true)
        #expect(undone.changes.first?.review["aiNote"]?.stringValue == "")
        #expect(undone.changes.first?.review["proposalReady"]?.boolValue == true)
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "ready")
        #expect(try scalar(databaseURL, "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "unreviewed")
    }

    @Test("Metadata edit preserves audit state and accepts a proposed draft on Undo")
    func editMetadataAndUndoCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-metadata-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        try execute(
            databaseURL,
            "UPDATE asset_editorial_state SET editorial_state = 'proposed' WHERE asset_id = 'asset-1'"
        )
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)

        let applied = try store.applyReview(
            .editMetadata,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"],
            anchorAssetID: "asset-1",
            title: "  Edited title  ",
            keywords: ["one", "one", "two"],
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        #expect(applied.action == .editMetadata)
        #expect(applied.changes.first?.review["editorialState"]?.stringValue == "unreviewed")
        #expect(applied.changes.first?.review["title"]?.stringValue == "Edited title")
        #expect(applied.changes.first?.review["keywords"]?.arrayValue?.map(\.stringValue) == ["one", "two"])
        #expect(applied.changes.first?.review["proposalReady"]?.boolValue == false)
        #expect(try scalar(databaseURL, "SELECT title FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "Edited title")
        #expect(try scalar(databaseURL, "SELECT keywords_json FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "[\"one\",\"two\"]")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "accepted")
        #expect(try scalar(databaseURL, "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "unreviewed")

        let undone = try store.undoReview(
            operationID: applied.operationID,
            now: Date(timeIntervalSince1970: 1_800_000_001)
        )

        #expect(!undone.alreadyUndone)
        #expect(undone.action == .editMetadata)
        #expect(undone.changes.first?.review["editorialState"]?.stringValue == "proposed")
        #expect(undone.changes.first?.review["title"]?.stringValue == "Decision title")
        #expect(undone.changes.first?.review["proposalReady"]?.boolValue == true)
        #expect(try scalar(databaseURL, "SELECT title FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "Decision title")
        #expect(try scalar(databaseURL, "SELECT keywords_json FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "[\"Decision\"]")
        #expect(try scalar(databaseURL, "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'") == "ready")
        #expect(try scalar(databaseURL, "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "proposed")
    }

    @Test("Title propagation follows the two-hour picked cohort and exact Undo")
    func propagateTitleAndUndoCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-propagate-title-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        try execute(
            databaseURL,
            "UPDATE asset_editorial_state SET editorial_state = 'requesting-ai', ai_reasons_json = '[\"location\"]', ai_note = 'check location', requested_at = '2026-01-01T00:00:00Z' WHERE asset_id = 'asset-2'"
        )
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)

        let applied = try store.applyReview(
            .propagateTitle,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"],
            anchorAssetID: "asset-1",
            title: "Shared title",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        #expect(applied.action == .propagateTitle)
        #expect(applied.propagated)
        #expect(applied.changes.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(applied.changes.allSatisfy { $0.review["title"]?.stringValue == "Shared title" })
        #expect(try scalar(databaseURL, "SELECT propagated FROM fixture_review_operations WHERE operation_id = '\(applied.operationID)'") == "1")
        #expect(try scalar(databaseURL, "SELECT title FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "Shared title")
        #expect(try scalar(databaseURL, "SELECT title FROM sidecar_decisions WHERE asset_id = 'asset-2'") == "Shared title")
        #expect(try scalar(databaseURL, "SELECT requested_at <> '2026-01-01T00:00:00Z' FROM asset_editorial_state WHERE asset_id = 'asset-2'") == "1")

        let undone = try store.undoReview(
            operationID: applied.operationID,
            now: Date(timeIntervalSince1970: 1_800_000_001)
        )

        #expect(!undone.alreadyUndone)
        #expect(undone.action == .propagateTitle)
        #expect(undone.changes.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(undone.changes.first?.review["title"]?.stringValue == "Decision title")
        #expect(undone.changes.last?.review["title"]?.stringValue == "Second title")
        #expect(try scalar(databaseURL, "SELECT title FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "Decision title")
        #expect(try scalar(databaseURL, "SELECT COALESCE(title, '') FROM sidecar_decisions WHERE asset_id = 'asset-2'") == "")
        #expect(try scalar(databaseURL, "SELECT requested_at FROM asset_editorial_state WHERE asset_id = 'asset-2'") == "2026-01-01T00:00:00Z")
    }

    @Test("Review read parity applies filters, proposal context, search, and pagination")
    func reviewWindowReadsCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-window-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        try execute(
            databaseURL,
            """
            UPDATE sidecar_assets
               SET media_type = 'video', photos_title = 'Second video', location_label = 'Madrid, Spain'
             WHERE asset_id = 'asset-2';
            INSERT INTO sidecar_assets(
              asset_id, source_anchor, raw_json, filename, photos_title,
              photos_keywords_json, location_label, location_keywords_json,
              captured_at, media_type
            ) VALUES
              ('asset-3', 'apple-photos://local-asset-3',
               '{"localIdentifier":"local-asset-3"}', 'C.JPG',
               'Palace facade', '["Granada"]', 'Alhambrá, Granada, Spain',
               '["Alhambrá","Granada","Spain"]', '2026-01-01T01:00:00Z', 'photo'),
              ('asset-missing', '', '{}', 'Missing.JPG', 'Missing', '[]', '', '[]',
               '2026-01-01T01:30:00Z', 'photo'),
              ('asset-tombstone', '', '{}', 'Tombstone.JPG', 'Tombstone', '[]', '', '[]',
               '2026-01-01T02:00:00Z', 'photo');
            INSERT INTO asset_editorial_state(asset_id, created_at, updated_at)
              VALUES ('asset-3', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                     ('asset-missing', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                     ('asset-tombstone', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO asset_delivery_state(asset_id, created_at, updated_at)
              VALUES ('asset-3', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                     ('asset-missing', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                     ('asset-tombstone', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO fixture_asset_decisions(
              fixture_id, asset_id, placement_state, eligibility_state, created_at, updated_at
            ) VALUES ('fixture-expo', 'asset-3', 'hidden', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                     ('fixture-expo', 'asset-missing', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                     ('fixture-expo', 'asset-tombstone', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            UPDATE sidecar_assets SET missing_at = '2026-01-01T03:00:00Z' WHERE asset_id = 'asset-missing';
            INSERT INTO sidecar_tombstones(asset_id, tombstone_state) VALUES ('asset-tombstone', 'active');
            INSERT INTO asset_ai_proposals(
              proposal_id, asset_id, run_id, attempt, status, proposed_title,
              proposed_keywords_json, reason, created_at
            ) VALUES ('proposal-2', 'asset-2', 'run-1', 1, 'loaded', 'Video proposal',
                      '["Madrid"]', 'Add video detail', '2026-01-01T00:30:00Z');
            """
        )
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)

        let page = try store.reviewWindow(
            fixtureID: "fixture-expo",
            limit: 1
        )
        #expect(page.reviewStateFilters == ["picked"])
        #expect(page.mediaFilters == ["photos", "videos"])
        #expect(page.summary.total == 2)
        #expect(page.items.map(\.id) == ["asset-1"])
        #expect(page.nextOffset == 1)
        #expect(page.hasNext)
        #expect(page.items.first?.photoLibraryIdentifier == "cloud-asset-1")

        _ = try store.applyReview(
            .approve,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"],
            anchorAssetID: "asset-1",
            proposalID: "proposal-1",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )
        let available = try store.reviewWindow(
            fixtureID: "fixture-expo",
            proposalAvailableOnly: true
        )
        #expect(available.items.map(\.id) == ["asset-2"])
        #expect(available.items.first?.proposalID == "proposal-2")
        #expect(available.items.first?.proposalReady == true)

        let videos = try store.reviewWindow(
            fixtureID: "fixture-expo",
            mediaFilters: ["videos"]
        )
        #expect(videos.items.map(\.id) == ["asset-2"])

        let hidden = try store.reviewWindow(
            fixtureID: "fixture-expo",
            mode: .full,
            stateFilters: ["hidden"],
            search: "Alhambra"
        )
        #expect(hidden.items.map(\.id) == ["asset-3"])
        #expect(hidden.items.first?.locationLabel == "Alhambrá, Granada, Spain")
        #expect(hidden.items.first?.locationKeywords == ["Alhambrá", "Granada", "Spain"])

        let all = try store.reviewWindow(
            fixtureID: "fixture-expo",
            mode: .full,
            stateFilters: nil
        )
        #expect(all.items.map(\.id) == ["asset-1", "asset-2", "asset-3"])
        #expect(all.summary.approved == 1)
    }

    @Test("Undo refuses a later mutation instead of overwriting it")
    func undoConflictIsFailClosed() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-conflict-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerReviewSQLiteStore(databaseURL: databaseURL)
        let applied = try store.applyReview(
            .hide,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"],
            anchorAssetID: "asset-1"
        )
        try execute(
            databaseURL,
            "UPDATE sidecar_decisions SET title = 'changed-after-hide' WHERE asset_id = 'asset-1'"
        )

        #expect(throws: OwnerReviewSQLiteError.self) {
            try store.undoReview(operationID: applied.operationID)
        }
        #expect(try scalar(databaseURL, "SELECT state FROM fixture_review_operations WHERE operation_id = '\(applied.operationID)'") == "applied")
        #expect(try scalar(databaseURL, "SELECT title FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "changed-after-hide")
    }
}

private func makeCopiedFixtureDatabase(at url: URL) throws {
    var database: OpaquePointer?
    guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else {
        throw OwnerDatabaseError.unavailable("could not create copied fixture database")
    }
    defer { sqlite3_close(database) }
    let schema = """
    PRAGMA foreign_keys = ON;
    CREATE TABLE fixtures (
      fixture_id TEXT PRIMARY KEY,
      parent_fixture_id TEXT,
      archived_at TEXT
    );
    CREATE TABLE sidecar_assets (
      asset_id TEXT PRIMARY KEY,
      source_anchor TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      filename TEXT NOT NULL DEFAULT '',
      photos_title TEXT,
      photos_keywords_json TEXT NOT NULL DEFAULT '[]',
      location_label TEXT NOT NULL DEFAULT '',
      location_keywords_json TEXT NOT NULL DEFAULT '[]',
      captured_at TEXT,
      missing_at TEXT,
      media_type TEXT NOT NULL DEFAULT 'photo'
    );
    CREATE TABLE sidecar_tombstones (
      asset_id TEXT PRIMARY KEY,
      tombstone_state TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE sidecar_decisions (
      asset_id TEXT PRIMARY KEY,
      rating INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '',
      pick_state TEXT NOT NULL DEFAULT 'undecided',
      metadata_state TEXT NOT NULL DEFAULT 'unreviewed',
      title TEXT,
      caption TEXT,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      last_action TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE asset_editorial_state (
      asset_id TEXT PRIMARY KEY,
      editorial_state TEXT NOT NULL DEFAULT 'unreviewed',
      ai_reasons_json TEXT NOT NULL DEFAULT '[]',
      ai_note TEXT NOT NULL DEFAULT '',
      ai_attempt_count INTEGER NOT NULL DEFAULT 0,
      ai_last_error TEXT NOT NULL DEFAULT '',
      ai_preview_path TEXT NOT NULL DEFAULT '',
      requested_at TEXT,
      proposed_at TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE asset_delivery_state (
      asset_id TEXT PRIMARY KEY,
      delivery_state TEXT NOT NULL DEFAULT 'not-ready',
      source_version_hash TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE fixture_asset_decisions (
      fixture_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      placement_state TEXT NOT NULL DEFAULT 'undecided',
      eligibility_state TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'native',
      last_action TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (fixture_id, asset_id)
    );
    CREATE TABLE fixture_asset_decision_events (
      event_id TEXT PRIMARY KEY,
      fixture_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      before_state TEXT NOT NULL,
      after_state TEXT NOT NULL,
      before_eligibility TEXT NOT NULL,
      after_eligibility TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE asset_editorial_events (
      event_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      fixture_id TEXT,
      action TEXT NOT NULL,
      before_state TEXT NOT NULL,
      after_state TEXT NOT NULL,
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE fixture_review_operations (
      operation_id TEXT PRIMARY KEY,
      fixture_id TEXT NOT NULL,
      action TEXT NOT NULL,
      anchor_asset_id TEXT NOT NULL,
      propagated INTEGER NOT NULL DEFAULT 0,
      asset_ids_json TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'applied',
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      undone_at TEXT
    );
    CREATE TABLE asset_ai_proposals (
      proposal_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      previous_title TEXT NOT NULL DEFAULT '',
      previous_keywords_json TEXT NOT NULL DEFAULT '[]',
      proposed_title TEXT NOT NULL,
      proposed_keywords_json TEXT NOT NULL DEFAULT '[]',
      confidence TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      requested_generator_model TEXT NOT NULL DEFAULT '',
      resolved_model TEXT NOT NULL DEFAULT '',
      reasoning_effort TEXT NOT NULL DEFAULT '',
      vision INTEGER NOT NULL DEFAULT 0,
      model_ladder TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    INSERT INTO fixtures(fixture_id, parent_fixture_id, archived_at)
      VALUES ('fixture-expo', NULL, NULL);
    INSERT INTO sidecar_assets(asset_id, source_anchor, raw_json, filename, photos_title, photos_keywords_json, captured_at)
      VALUES ('asset-1', 'apple-photos-cloud://cloud-asset-1', '{"localIdentifier":"local-asset-1"}', 'A.JPG', 'Original title', '["Original"]', '2026-01-01T00:00:00Z'),
             ('asset-2', 'apple-photos://local-asset-2', '{"localIdentifier":"local-asset-2"}', 'B.MOV', 'Second title', '["Second"]', '2026-01-01T00:30:00Z');
    INSERT INTO sidecar_decisions(asset_id, title, keywords_json, created_at, updated_at)
      VALUES ('asset-1', 'Decision title', '["Decision"]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO asset_editorial_state(asset_id, created_at, updated_at)
      VALUES ('asset-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             ('asset-2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO asset_delivery_state(asset_id, created_at, updated_at)
      VALUES ('asset-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             ('asset-2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO fixture_asset_decisions(
      fixture_id, asset_id, placement_state, eligibility_state, created_at, updated_at
    ) VALUES ('fixture-expo', 'asset-1', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             ('fixture-expo', 'asset-2', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO asset_ai_proposals(
      proposal_id, asset_id, run_id, attempt, status, proposed_title, created_at
    ) VALUES ('proposal-1', 'asset-1', 'run-1', 1, 'ready', 'Proposed title', '2026-01-01T00:00:00Z');
    """
    guard sqlite3_exec(database, schema, nil, nil, nil) == SQLITE_OK else {
        throw OwnerDatabaseError.unavailable("could not seed copied fixture database")
    }
}

private func execute(_ databaseURL: URL, _ sql: String) throws {
    var database: OpaquePointer?
    guard sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK,
          let database else {
        throw OwnerDatabaseError.unavailable("test database unavailable")
    }
    defer { sqlite3_close(database) }
    guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
        throw OwnerDatabaseError.unavailable("test SQL failed")
    }
}

private func scalar(_ databaseURL: URL, _ sql: String) throws -> String {
    var database: OpaquePointer?
    guard sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK,
          let database else {
        throw OwnerDatabaseError.unavailable("test database unavailable")
    }
    defer { sqlite3_close(database) }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
          let statement else {
        throw OwnerDatabaseError.unavailable("test statement unavailable")
    }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW,
          let text = sqlite3_column_text(statement, 0) else {
        throw OwnerDatabaseError.unavailable("test scalar unavailable")
    }
    return String(cString: text)
}
