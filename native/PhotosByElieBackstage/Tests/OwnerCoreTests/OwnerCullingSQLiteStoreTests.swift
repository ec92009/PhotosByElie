import Foundation
import SQLite3
import Testing
@testable import OwnerCore

@Suite("Owner Culling SQLite parity")
struct OwnerCullingSQLiteStoreTests {
    @Test("Canonical workflow stage gives fixture hiding sole precedence")
    func canonicalWorkflowStageHasOneVisibleWinner() {
        #expect(AssetWorkflowStage.resolve(
            placementState: "hidden",
            editorialState: "unreviewed"
        ) == .hiddenFromFixture)
        #expect(AssetWorkflowStage.resolve(
            placementState: "hidden",
            editorialState: "approved",
            deliveryState: "live",
            catalogState: "live",
            sold: true
        ) == .hiddenFromFixture)
        #expect(AssetWorkflowStage.resolve(
            placementState: "picked",
            editorialState: "unreviewed"
        ) == .awaitingReview)
        #expect(AssetWorkflowStage.resolve(
            placementState: "picked",
            editorialState: "requesting-ai"
        ) == .aiRequested)
        #expect(AssetWorkflowStage.resolve(
            placementState: "picked",
            editorialState: "unreviewed",
            proposalAvailable: true
        ) == .proposalReady)
        #expect(AssetWorkflowStage.resolve(
            placementState: "picked",
            editorialState: "approved",
            deliveryState: "needs-upload"
        ) == .needsUpload)
        #expect(AssetWorkflowStage.resolve(
            placementState: "picked",
            editorialState: "approved",
            deliveryState: "live"
        ) == .fullResolutionUploaded)
        #expect(AssetWorkflowStage.resolve(
            placementState: "picked",
            editorialState: "approved",
            deliveryState: "live",
            catalogState: "pending"
        ) == .publishing)
        #expect(AssetWorkflowStage.resolve(
            placementState: "picked",
            editorialState: "approved",
            deliveryState: "live",
            catalogState: "live"
        ) == .live)
        #expect(AssetWorkflowStage.resolve(
            placementState: "picked",
            editorialState: "approved",
            deliveryState: "live",
            catalogState: "live",
            sold: true
        ) == .sold)
    }

    @Test("Hidden assets do not also match editorial or delivery stages")
    func hiddenAssetsSuppressDownstreamStageFilters() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-canonical-stage-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        try execute(
            databaseURL,
            """
            INSERT INTO asset_editorial_state(asset_id, editorial_state)
              VALUES ('asset-2', 'approved');
            INSERT INTO asset_delivery_state(asset_id, delivery_state)
              VALUES ('asset-2', 'live');
            """
        )
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)

        let hidden = try store.cullingWindow(fixtureID: "fixture-expo", view: .hidden)
        #expect(hidden.items.map(\.id) == ["asset-2"])
        #expect(hidden.items.first?.workflowStage == .hiddenFromFixture)

        let editorial = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            editorialFilters: [.approved]
        )
        #expect(!editorial.items.map(\.id).contains("asset-2"))

        let delivery = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            deliveryFilters: [.live]
        )
        #expect(!delivery.items.map(\.id).contains("asset-2"))
    }

    @Test("Authoritative Culling window applies date and displayed-MP filters before summaries")
    func cullingWindowFiltersDateAndMegapixelsBeforeSummaries() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-date-mp-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        try execute(
            databaseURL,
            """
            UPDATE sidecar_assets
            SET captured_at = '2014-06-02T09:37:04Z', pixel_width = 2048, pixel_height = 1536
            WHERE asset_id = 'asset-1';
            UPDATE sidecar_assets
            SET captured_at = '2015-12-31T23:59:59Z', pixel_width = 6000, pixel_height = 4000
            WHERE asset_id = 'asset-2';
            """
        )
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)

        let byYear = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            dateFrom: "2014",
            dateTo: "2014"
        )
        #expect(byYear.items.map(\.id) == ["asset-1"])
        #expect(byYear.summary.filtered == 1)
        #expect(byYear.summary.universe == 1)

        let equalDisplayedMP = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            megapixelComparison: .equal,
            megapixelValue: 3.1
        )
        #expect(equalDisplayedMP.items.map(\.id) == ["asset-1"])

        let combined = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            dateFrom: "2015-12-31",
            dateTo: "2015-12-31",
            megapixelComparison: .atLeast,
            megapixelValue: 24
        )
        #expect(combined.items.map(\.id) == ["asset-2"])
        #expect(combined.summary.filtered == 1)
        #expect(combined.summary.universe == 1)
    }

    @Test("Fixture placement stays local and recomputes inherited eligibility")
    func appliesFixtureStateAndUndo() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-sqlite-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)

        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)
        let applied = try store.applyState(
            .hidden,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-2", "asset-1", "asset-2"],
            actor: "test-owner",
            reason: "manual exclude",
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        #expect(applied.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(applied.first?.beforePlacementState == .picked)
        #expect(applied.first?.placementState == .hidden)
        #expect(applied.first?.eligibilityState == "active")
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "hidden")
        #expect(try scalar(databaseURL, "SELECT pick_state FROM sidecar_decisions WHERE asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT eligibility_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-child' AND asset_id = 'asset-1'") == "dormant")
        #expect(try scalar(databaseURL, "SELECT count(*) FROM fixture_asset_decision_events") == "2")

        let undone = try store.undoState(
            applied,
            actor: "test-owner",
            now: Date(timeIntervalSince1970: 1_800_000_001)
        )
        #expect(undone.map(\.assetID) == ["asset-1", "asset-2"])
        #expect(undone.first?.beforePlacementState == .hidden)
        #expect(undone.first?.placementState == .picked)
        #expect(undone.first?.eligibilityState == "active")
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT eligibility_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-child' AND asset_id = 'asset-1'") == "active")
        #expect(try scalar(databaseURL, "SELECT count(*) FROM fixture_asset_decision_events") == "4")
    }

    @Test("Culling Undo fails closed after a later mutation")
    func undoConflictIsFailClosed() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-conflict-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)
        let applied = try store.applyState(.hidden, fixtureID: "fixture-expo", assetIDs: ["asset-1"])
        try execute(
            databaseURL,
            "UPDATE fixture_asset_decisions SET placement_state = 'picked', updated_at = 'later' WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'"
        )

        #expect(throws: OwnerCullingSQLiteError.self) {
            try store.undoState(applied)
        }
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT count(*) FROM fixture_asset_decision_events") == "1")
    }

    @Test("Culling apply is atomic when one requested asset is invalid")
    func invalidAssetRollsBackAllChanges() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-rollback-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)

        #expect(throws: OwnerCullingSQLiteError.self) {
            try store.applyState(
                .picked,
                fixtureID: "fixture-expo",
                assetIDs: ["asset-1", "missing-asset"]
            )
        }
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT count(*) FROM fixture_asset_decision_events") == "0")
    }

    @Test("Culling read parity applies fixture scope, filters, search, and pagination")
    func cullingWindowReadsCopiedFixture() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-window-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        try execute(
            databaseURL,
            """
            UPDATE sidecar_assets
               SET source_anchor = 'apple-photos-cloud://cloud-asset-1',
                   raw_json = '{"resourceFormat":"jpeg","originalByteCount":101}',
                   filename = 'A.JPG',
                   captured_at = '2026-01-01T01:00:00Z',
                   photos_title = 'First photo',
                   photos_keywords_json = '["Madrid"]',
                   location_label = 'Madrid, Spain',
                   location_keywords_json = '["Madrid","Spain"]',
                   pixel_width = 1200,
                   pixel_height = 800
             WHERE asset_id = 'asset-1';
            UPDATE sidecar_assets
               SET source_anchor = 'apple-photos://local-asset-2',
                   raw_json = '{"resourceFormat":"mov","originalByteCount":202}',
                   filename = 'B.MOV',
                   media_type = 'video',
                   captured_at = '2026-01-01T02:00:00Z',
                   photos_title = 'Second video',
                   location_label = 'Paris, France'
             WHERE asset_id = 'asset-2';
            UPDATE sidecar_decisions
               SET rating = 4, color = 'red', title = 'Decision video', keywords_json = '["night"]'
             WHERE asset_id = 'asset-2';
            INSERT INTO sidecar_upload_bridge_run_items(
              run_item_id, asset_id, upload_keys_json, updated_at
            ) VALUES (
              'run-item-1', 'asset-1', '[{"kind":"private-master","bytes":1001}]',
              '2026-01-01T07:00:00Z'
            );
            INSERT INTO sidecar_assets(
              asset_id, source_anchor, raw_json, filename, captured_at,
              photos_title, photos_keywords_json, location_label,
              location_keywords_json
            ) VALUES (
              'asset-3', 'apple-photos://local-asset-3',
              '{"resourceFormat":"jpeg"}', 'C.JPG', '2026-01-01T02:00:01Z',
              'Palace facade', '["Granada"]', 'Alhambrá, Granada, Spain',
              '["Alhambrá","Granada","Spain"]'
            );
            INSERT INTO sidecar_decisions(asset_id, title, keywords_json)
              VALUES ('asset-3', '', '[]');
            INSERT INTO sidecar_assets(asset_id, filename, captured_at)
              VALUES ('asset-missing', 'Missing.JPG', '2026-01-01T04:00:00Z'),
                     ('asset-tombstone', 'Tombstone.JPG', '2026-01-01T05:00:00Z');
            INSERT INTO sidecar_decisions(asset_id) VALUES ('asset-missing'), ('asset-tombstone');
            INSERT INTO fixture_asset_decisions(
              fixture_id, asset_id, placement_state, eligibility_state, created_at, updated_at
            ) VALUES
              ('fixture-expo', 'asset-3', 'undecided', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
              ('fixture-expo', 'asset-missing', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
              ('fixture-expo', 'asset-tombstone', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            UPDATE sidecar_assets SET missing_at = '2026-01-01T06:00:00Z' WHERE asset_id = 'asset-missing';
            INSERT INTO sidecar_tombstones(asset_id, tombstone_state)
              VALUES ('asset-tombstone', 'active');
            INSERT INTO asset_editorial_state(asset_id, editorial_state)
              VALUES ('asset-1', 'approved'),
                     ('asset-2', 'requesting-ai'),
                     ('asset-3', 'unreviewed');
            INSERT INTO asset_delivery_state(asset_id, delivery_state)
              VALUES ('asset-1', 'live'),
                     ('asset-2', 'failed'),
                     ('asset-3', 'needs-upload');
            INSERT INTO asset_ai_proposals(proposal_id, asset_id, status, attempt, created_at)
              VALUES ('proposal-2', 'asset-2', 'ready', 1, '2026-01-01T02:30:00Z');
            """
        )
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)

        let page = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            limit: 2
        )
        #expect(page.summary.universe == 3)
        #expect(page.summary.undecided == 1)
        #expect(page.summary.picked == 1)
        #expect(page.summary.hidden == 1)
        #expect(page.items.map(\.id) == ["asset-3", "asset-2"])
        #expect(page.nextOffset == 2)
        #expect(page.hasNext)

        let picked = try store.cullingWindow(fixtureID: "fixture-expo", view: .picked)
        #expect(picked.items.map(\.id) == ["asset-1"])
        #expect(picked.items.first?.photoLibraryIdentifier == "cloud-asset-1")
        #expect(picked.items.first?.originalByteCount == 1001)

        let redVideo = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            mediaTypes: ["videos"],
            ratings: [4],
            colors: ["red"]
        )
        #expect(redVideo.items.map(\.id) == ["asset-2"])

        let searched = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .undecided,
            search: "Alhambra"
        )
        #expect(searched.items.map(\.id) == ["asset-3"])
        #expect(searched.items.first?.title == "Palace facade")

        let child = try store.cullingWindow(fixtureID: "fixture-child", view: .allActive)
        #expect(child.items.map(\.id) == ["asset-1"])

        let liveApproved = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            editorialFilters: [.approved],
            deliveryFilters: [.live]
        )
        #expect(liveApproved.items.map(\.id) == ["asset-1"])
        #expect(liveApproved.items.first?.editorialState == "approved")
        #expect(liveApproved.items.first?.deliveryState == "live")

        let proposedFailure = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            editorialFilters: [.proposalAvailable],
            deliveryFilters: [.failed]
        )
        #expect(proposedFailure.items.isEmpty)

        let unavailable = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            sourceFilters: [.unavailable]
        )
        #expect(unavailable.items.map(\.id) == ["asset-missing"])
        #expect(unavailable.items.first?.sourceAvailable == false)

        let burst = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            burstsOnly: true
        )
        #expect(burst.items.map(\.id) == ["asset-3", "asset-2"])

        let redBurstFrame = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            colors: ["red"],
            burstsOnly: true
        )
        #expect(redBurstFrame.items.map(\.id) == ["asset-2"])
    }

    @Test("Gallery search ignores opaque IDs and includes camera and lens equipment")
    func cullingSearchUsesPublicFieldsAndEquipment() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-equipment-search-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        try execute(
            databaseURL,
            """
            UPDATE sidecar_assets
               SET filename = 'Canon-photo.jpg',
                   raw_json = '{}'
             WHERE asset_id = 'asset-1';
            INSERT INTO sidecar_assets(asset_id, source_anchor, filename, raw_json, captured_at)
              VALUES ('opaque-elf-token', 'apple-photos://opaque-token', 'Ordinary-photo.jpg', '{}', '2026-01-01T03:00:00Z');
            INSERT INTO sidecar_decisions(asset_id) VALUES ('opaque-elf-token');
            INSERT INTO sidecar_assets(asset_id, source_anchor, filename, photos_title, raw_json, captured_at)
              VALUES (
                'visible-partial-token', 'apple-photos://visible-partial-token',
                'Selfie-bookshelf.jpg', 'Brick Flowers on a Bookshelf', '{}',
                '2026-01-01T04:00:00Z'
              );
            INSERT INTO sidecar_decisions(asset_id, keywords_json)
              VALUES ('visible-partial-token', '["selfie","bookshelf","Delft"]');
            INSERT INTO fixture_asset_decisions(
              fixture_id, asset_id, placement_state, eligibility_state, created_at, updated_at
            ) VALUES (
              'fixture-expo', 'opaque-elf-token', 'undecided', 'active',
              '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
            );
            INSERT INTO fixture_asset_decisions(
              fixture_id, asset_id, placement_state, eligibility_state, created_at, updated_at
            ) VALUES (
              'fixture-expo', 'visible-partial-token', 'undecided', 'active',
              '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
            );
            """
        )
        try OwnerCurrentEquipmentSQLiteStore(databaseURL: databaseURL).upsert([
            "asset-1": OwnerCurrentEquipment(
                cameraBody: "Canon PowerShot ELPH 300 HS",
                lens: "4.3 - 21.5 mm"
            ),
        ], updatedAt: Date())
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)

        let commonSpelling = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            search: "elf"
        )
        #expect(commonSpelling.items.map(\.id) == ["asset-1"])

        let exactIdentity = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            search: "opaque-elf-token"
        )
        #expect(exactIdentity.items.map(\.id) == ["opaque-elf-token"])

        let camera = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            search: "Canon ELPH"
        )
        #expect(camera.items.map(\.id) == ["asset-1"])

        let lens = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            search: "21.5 mm"
        )
        #expect(lens.items.map(\.id) == ["asset-1"])
    }

    @Test("Live Expo elf and elph searches resolve only to the same Canon ELPH assets")
    func liveExpoEquipmentSearchAcceptance() throws {
        guard let path = ProcessInfo.processInfo.environment["PBE_OWNER_ACCEPTANCE_DB"],
              !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }

        let databaseURL = URL(fileURLWithPath: path)
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)
        let views = FixtureCullingView.selectableCases
        let elf = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            views: views,
            search: "elf"
        )
        let elph = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            views: views,
            search: "elph"
        )
        let elfIDs = Set(elf.items.map(\.id))
        let elphIDs = Set(elph.items.map(\.id))
        let equipment = try OwnerAssetSourceSQLiteStore(databaseURL: databaseURL)
            .metadata(assetIDs: Array(elphIDs))

        #expect(elf.summary.filtered >= elfIDs.count)
        #expect(elph.summary.filtered >= elphIDs.count)
        #expect(elfIDs == elphIDs)
        #expect(elfIDs.count >= 18)
        #expect(equipment.count == elphIDs.count)
        #expect(equipment.values.allSatisfy {
            [$0.cameraBody, $0.lens]
                .joined(separator: " ")
                .localizedCaseInsensitiveContains("elph")
        })
        print("Live Gallery acceptance: elf=\(elfIDs.count), elph=\(elphIDs.count), same Canon ELPH set")
    }

    @Test("Unavailable legacy cards retry only through one exact canonical identity sibling")
    func exactIdentityFallbackIsUniqueAndNeverUsesFilename() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-identity-fallback-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        try execute(
            databaseURL,
            """
            INSERT INTO sidecar_assets(asset_id, source_anchor, raw_json, filename, missing_at)
            VALUES
              ('legacy-exact', 'apple-photos://local-exact',
               '{"localIdentifier":"local-exact"}', 'Exact stale.JPG', '2026-01-02T00:00:00Z'),
              ('canonical-exact', 'apple-photos-cloud://cloud-exact',
               '{"localIdentifier":"local-exact","cloudIdentifier":"cloud-exact"}', 'Different.JPG', NULL),
              ('legacy-ambiguous', 'apple-photos://local-ambiguous',
               '{"localIdentifier":"local-ambiguous"}', 'Ambiguous stale.JPG', '2026-01-02T00:00:00Z'),
              ('canonical-ambiguous-a', 'apple-photos-cloud://cloud-ambiguous-a',
               '{"localIdentifier":"local-ambiguous","cloudIdentifier":"cloud-ambiguous-a"}', 'A.JPG', NULL),
              ('canonical-ambiguous-b', 'apple-photos-cloud://cloud-ambiguous-b',
               '{"localIdentifier":"local-ambiguous","cloudIdentifier":"cloud-ambiguous-b"}', 'B.JPG', NULL),
              ('legacy-filename-only', 'apple-photos://local-filename-only',
               '{"localIdentifier":"local-filename-only"}', 'Same Name.JPG', '2026-01-02T00:00:00Z'),
              ('canonical-filename-only', 'apple-photos-cloud://cloud-filename-only',
               '{"localIdentifier":"different-local","cloudIdentifier":"cloud-filename-only"}', 'Same Name.JPG', NULL);
            """
        )
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)

        let exact = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            search: "Exact stale",
            sourceFilters: [.unavailable]
        )
        #expect(exact.items.map(\.id) == ["legacy-exact"])
        #expect(exact.items.first?.photoLibraryIdentifier == "cloud-exact")
        #expect(exact.items.first?.sourceAvailable == false)

        let ambiguous = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            search: "Ambiguous stale",
            sourceFilters: [.unavailable]
        )
        #expect(ambiguous.items.first?.photoLibraryIdentifier == "local-ambiguous")

        let filenameOnly = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            search: "Same Name",
            sourceFilters: [.unavailable]
        )
        #expect(filenameOnly.items.first?.photoLibraryIdentifier == "local-filename-only")
    }

    @Test("Mixed-source Gallery collapses an unavailable alias into its exact available identity")
    func mixedSourceGalleryCollapsesExactUnavailableAlias() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-collapse-alias-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)
        try execute(
            databaseURL,
            """
            INSERT INTO sidecar_assets(asset_id, source_anchor, raw_json, filename, missing_at)
            VALUES
              ('legacy-duplicate', 'apple-photos://local-duplicate',
               '{"localIdentifier":"local-duplicate"}', 'IMG_5014.jpg', '2026-01-02T00:00:00Z'),
              ('canonical-duplicate', 'apple-photos-cloud://cloud-duplicate',
               '{"localIdentifier":"local-duplicate","cloudIdentifier":"cloud-duplicate"}',
               'IMG_5014.jpg', NULL);
            INSERT INTO sidecar_decisions(asset_id) VALUES
              ('legacy-duplicate'), ('canonical-duplicate');
            """
        )
        let store = OwnerCullingSQLiteStore(databaseURL: databaseURL)

        let mixed = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            search: "IMG_5014",
            sourceFilters: GallerySourceFilter.allCases
        )
        #expect(mixed.items.count == 1)
        #expect(mixed.items.first?.id == "canonical-duplicate")
        #expect(mixed.items.first?.sourceAvailable == true)
        #expect(mixed.summary.filtered == 1)
        #expect(mixed.summary.universe == 1)

        let unavailable = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            search: "IMG_5014",
            sourceFilters: [.unavailable]
        )
        #expect(unavailable.items.map(\.id) == ["legacy-duplicate"])
        #expect(unavailable.items.first?.sourceAvailable == false)
    }

    @Test("Live Expo mixed-source search collapses the IMG_5014 legacy alias")
    func liveMixedSourceGalleryCollapsesIMG5014Alias() throws {
        guard let path = ProcessInfo.processInfo.environment["PBE_OWNER_ACCEPTANCE_DB"],
              !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }

        let store = OwnerCullingSQLiteStore(databaseURL: URL(fileURLWithPath: path))
        let window = try store.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            views: FixtureCullingView.selectableCases,
            search: "IMG_5014",
            sourceFilters: GallerySourceFilter.allCases
        )

        #expect(window.items.count == 1)
        #expect(window.items.first?.sourceAvailable == true)
        #expect(window.summary.filtered == 1)
        print("Live Gallery acceptance: IMG_5014 resolved to one available Photos identity")
    }

    @Test("Fixture workflow uses native Culling reads without an Owner action")
    func cullingWorkflowUsesNativeRead() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-workflow-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)

        let localService = LocalFixtureReviewService(
            nativeDatabaseURL: databaseURL
        )
        let workflow = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: FailingCullingOwnerActionService(),
                waker: FailingCullingOwnerActionWaker()
            ),
            localReviewService: localService
        )

        let window = try await workflow.cullingWindow(
            fixtureID: "fixture-expo",
            view: .picked,
            limit: 1
        )
        #expect(window.items.map(\.id) == ["asset-1"])
    }

    @Test("Fixture workflow applies Culling placement through native SQLite without an Owner action")
    func cullingWorkflowUsesNativeWrite() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-culling-write-workflow-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        try makeCopiedFixtureDatabase(at: databaseURL)

        let localService = LocalFixtureReviewService(
            nativeDatabaseURL: databaseURL
        )
        let workflow = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: FailingCullingOwnerActionService(),
                waker: FailingCullingOwnerActionWaker()
            ),
            localReviewService: localService
        )

        let applied = try await workflow.applyState(
            .hidden,
            assetIDs: ["asset-1"],
            fixtureID: "fixture-expo",
            reason: "native culling write test"
        )
        #expect(applied.map(\.assetID) == ["asset-1"])
        #expect(applied.first?.beforePlacementState == .picked)
        #expect(applied.first?.placementState == .hidden)
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "hidden")

        let restored = try await workflow.undoState(
            applied,
            reason: "native culling undo test"
        )
        #expect(restored.first?.placementState == .picked)
        #expect(try scalar(databaseURL, "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try scalar(databaseURL, "SELECT count(*) FROM fixture_asset_decision_events") == "2")
    }
}

private struct FailingCullingOwnerActionService: OwnerActionServing {
    func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String
    ) async throws -> OwnerActionEnvelope {
        throw OwnerActionRunError.failed("native Culling operation unexpectedly crossed the Owner action boundary")
    }

    func getAction(id: String) async throws -> OwnerAction {
        throw OwnerActionRunError.failed("native Culling operation unexpectedly polled an Owner action")
    }
}

private struct FailingCullingOwnerActionWaker: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? {
        throw OwnerActionRunError.failed("native Culling operation unexpectedly woke the connector")
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
      candidate_mode TEXT NOT NULL DEFAULT 'inherited',
      archived_at TEXT
    );
    CREATE TABLE sidecar_assets (
      asset_id TEXT PRIMARY KEY,
      source_anchor TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      filename TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'photo',
      captured_at TEXT NOT NULL DEFAULT '',
      pixel_width INTEGER NOT NULL DEFAULT 0,
      pixel_height INTEGER NOT NULL DEFAULT 0,
      photos_title TEXT NOT NULL DEFAULT '',
      photos_keywords_json TEXT NOT NULL DEFAULT '[]',
      location_label TEXT NOT NULL DEFAULT '',
      location_keywords_json TEXT NOT NULL DEFAULT '[]',
      missing_at TEXT
    );
    CREATE TABLE sidecar_decisions (
      asset_id TEXT PRIMARY KEY,
      rating INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '',
      pick_state TEXT NOT NULL DEFAULT 'undecided',
      metadata_state TEXT NOT NULL DEFAULT 'unreviewed',
      title TEXT NOT NULL DEFAULT '',
      keywords_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE sidecar_tombstones (
      asset_id TEXT PRIMARY KEY,
      tombstone_state TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE sidecar_upload_bridge_run_items (
      run_item_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      upload_keys_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE asset_editorial_state (
      asset_id TEXT PRIMARY KEY,
      editorial_state TEXT NOT NULL DEFAULT 'unreviewed'
    );
    CREATE TABLE asset_delivery_state (
      asset_id TEXT PRIMARY KEY,
      delivery_state TEXT NOT NULL DEFAULT 'not-ready'
    );
    CREATE TABLE asset_ai_proposals (
      proposal_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      attempt INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE asset_source_versions (
      version_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      source_exists INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'candidate',
      created_at TEXT NOT NULL DEFAULT ''
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
    INSERT INTO fixtures(fixture_id, parent_fixture_id, archived_at)
      VALUES ('fixture-expo', NULL, NULL), ('fixture-child', 'fixture-expo', NULL);
    INSERT INTO sidecar_assets(asset_id)
      VALUES ('asset-1'), ('asset-2');
    INSERT INTO sidecar_decisions(asset_id, pick_state)
      VALUES ('asset-1', 'picked'), ('asset-2', 'undecided');
    INSERT INTO fixture_asset_decisions(
      fixture_id, asset_id, placement_state, eligibility_state, created_at, updated_at
    ) VALUES
      ('fixture-expo', 'asset-1', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('fixture-expo', 'asset-2', 'hidden', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('fixture-child', 'asset-1', 'picked', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
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
