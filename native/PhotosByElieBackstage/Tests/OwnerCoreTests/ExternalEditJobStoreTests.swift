import Foundation
import CoreGraphics
import ImageIO
import SQLite3
import Testing
@testable import OwnerCore
@testable import BackstageUI

@Suite("External editor round trips")
struct ExternalEditJobStoreTests {
    @Test("A returned After changes only its fixture edition and current preview")
    func fixtureSpecificReturnedImages() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let schema = Bundle.module.url(forResource: "fixture_editions_schema", withExtension: "sql", subdirectory: "Fixtures")!
        try fixture.execute(String(contentsOf: schema, encoding: .utf8))
        try fixture.execute("""
            INSERT INTO fixtures VALUES ('marketing');
            INSERT INTO fixture_asset_editions(fixture_id,asset_id,title,source_version_id,editorial_state,created_at,updated_at)
            VALUES ('fixture-expo','asset-1','Expo','source-asset-1','approved','',''),
                   ('marketing','asset-1','Marketing','source-asset-1','approved','','');
            """)
        let store = fixture.store
        let job = try store.createJob(fixtureID: "marketing", kind: .edit, editor: fixture.editor,
            sources: [fixture.source(position: 0, assetID: "asset-1")], now: fixture.date)
        _ = try store.recordLaunched(jobID: job.id, now: fixture.date)
        let returned = fixture.root.appendingPathComponent("finished.jpg")
        try Data("fixture After bytes".utf8).write(to: returned)
        let candidate = try store.acceptReturnedFile(jobID: job.id, sourceURL: returned, now: fixture.date)
        let receipt = try store.resolveReturn(returnID: candidate.id, decision: .replaceOriginal, now: fixture.date)
        #expect(try store.currentReturnedSource(assetID: "asset-1", fixtureID: "fixture-expo") == nil)
        #expect(try store.currentReturnedSource(assetID: "asset-1", fixtureID: "marketing")?.sourceVersionID == receipt.sourceVersionID)
        #expect(try store.resolveSources(assetIDs: ["asset-1"], fixtureID: "fixture-expo").first?.sourceVersionID == "source-asset-1")
        #expect(try store.resolveSources(assetIDs: ["asset-1"], fixtureID: "marketing").first?.sourceVersionID == receipt.sourceVersionID)
        #expect(try fixture.scalar("SELECT editorial_state FROM fixture_asset_editions WHERE fixture_id='fixture-expo'") == "approved")
        #expect(try fixture.scalar("SELECT editorial_state FROM fixture_asset_editions WHERE fixture_id='marketing'") == "unreviewed")
        #expect(try fixture.scalar("SELECT title FROM fixture_asset_editions WHERE fixture_id='fixture-expo'") == "Expo")
    }

    @Test("Normal Approve selects the After; Reject AI restores original approval; missing After never falls back", arguments: ["approve", "reject", "missing", "unrecorded"])
    @MainActor
    func reviewAIApprovalRoute(action: String) async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let api = ReviewApprovalTestAPI()
        let runner = OwnerActionRunner(api: api, waker: NoApprovalWake(), pollInterval: .milliseconds(1))
        let model = BackstageViewModel(photoLibrary: InertPhotoLibrary(),
            fixtureService: FixtureWorkflowService(runner: runner),
            visualRepairService: VisualRepairProposalService(runner: runner),
            workflowRecoveryStore: nil, currentImageSizeCache: nil, currentEquipmentCache: nil,
            equipmentBackfillStore: nil, externalEditJobStore: fixture.store, customerPhotoLinks: nil)
        model.installFixtureTree([FixtureNode(id: "fixture-expo", name: "RE")],
            preferredFixtureID: "fixture-expo", persistSelection: false)
        let file = Bundle.module.url(forResource: "proposed", withExtension: "png", subdirectory: "Fixtures/PBE144SyntheticOpenAI")!
        let data = try Data(contentsOf: file)
        let source = try #require(CGImageSourceCreateWithData(data as CFData, nil))
        let image = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
        var item = FixtureReviewItem(id: "asset-1", photoLibraryIdentifier: "asset-1",
            sourceVersionID: "source-asset-1", title: "Original", keywords: [], filename: "one.jpg", capturedAt: "",
            pixelWidth: image.width * 2, pixelHeight: image.height * 2)
        if action == "unrecorded" {
            item.visualAIRequest = ["sourceVersionId": .string(item.sourceVersionID), "reasons": .array(["contrast"])]
        }
        model.fixtureReviewWindow = FixtureReviewWindow(fixtureID: "fixture-expo", mode: .full,
            offset: 0, limit: 200, nextOffset: 0, hasNext: false,
            summary: FixtureReviewSummary(total: 1, unreviewed: 1, requestingAI: 0, proposed: 0, approved: 0), items: [item])
        model.reviewSelection = OwnerSelectionModel(orderedIDs: [item.id], selectedIDs: [item.id], anchorID: item.id, focusedID: item.id)
        model.reviewVisualProposals[item.id] = VisualRepairProposal(id: "p", fixtureID: "fixture-expo", assetID: item.id,
            sourceVersionID: item.sourceVersionID, defectCategories: [.contrast], ladderRung: 0, modelLadder: [],
            requestedGeneratorModel: "test", resolvedModel: "test", reasoningEffort: "", vision: true,
            attempt: 1, status: .draft, originalReference: "immutable-source-version://source-asset-1",
            derivedReference: file.absoluteString, derivedAvailable: action != "missing",
            derivedSHA256: VisualRepairRendition.digest(data), generatorReference: "test")
        if action == "unrecorded" { model.reviewVisualProposals.removeValue(forKey: item.id) }
        #expect(model.hasPendingReviewAI)
        if action == "reject" {
            model.rejectReviewAI()
            #expect(model.isRunningReview)
            model.rejectReviewAI() // duplicate click is suppressed synchronously
            for _ in 0..<400 where model.isRunningReview { try await Task.sleep(for: .milliseconds(5)) }
            #expect(!model.isRunningReview)
        } else {
            await model.applyReviewAction(.approve) // same route used by keyboard / Quick Look
        }
        let requests = await api.requests
        let mutations = requests.filter { $0["mode"]?.stringValue == "fixture-review-apply" }
        let decisions = requests.filter { $0["mode"]?.stringValue == "fixture-visual-repair-proposal-decide" }
        if action == "missing" || action == "unrecorded" {
            #expect(mutations.isEmpty && decisions.isEmpty)
            #expect(model.reviewStatus.contains("not ready"))
            #expect(try fixture.store.currentReturnedSource(assetID: item.id) == nil)
        } else if action == "reject" {
            #expect(decisions.count == 1 && decisions.first?["decision"]?.stringValue == "reject")
            #expect(mutations.count == 1 && mutations.first?["reviewAction"]?.stringValue == "request-ai")
            #expect(mutations.first?["aiReasons"]?.arrayValue?.isEmpty == true)
            #expect(try fixture.store.currentReturnedSource(assetID: item.id) == nil)
            #expect(!model.hasPendingReviewAI)
        } else {
            #expect(decisions.count == 1 && decisions.first?["decision"]?.stringValue == "accept")
            #expect(mutations.count == 1 && mutations.first?["reviewAction"]?.stringValue == "approve")
            let current = try #require(try fixture.store.currentReturnedSource(assetID: item.id))
            #expect(current.sourceVersionID != item.sourceVersionID)
            let output = try #require(CGImageSourceCreateWithURL(current.fileURL as CFURL, nil))
            let after = try #require(CGImageSourceCreateImageAtIndex(output, 0, nil))
            #expect(after.width == item.pixelWidth && after.height == item.pixelHeight)
        }
        #expect(!requests.contains { ($0["mode"]?.stringValue ?? "").contains("upload") })
    }

    @Test("AI return cannot supersede a source that changed after staging")
    func visualAfterRejectsRacingSource() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let job = try fixture.store.createJob(fixtureID: "fixture-expo", kind: .edit,
            editor: ExternalEditorProfile(name: VisualRepairRendition.label,
                bundleIdentifier: VisualRepairRendition.editorPrefix + "race", applicationURL: fixture.root),
            sources: [fixture.source(position: 0, assetID: "asset-1")], now: fixture.date)
        let file = fixture.root.appendingPathComponent("after.png")
        try Data("staged-image".utf8).write(to: file)
        let pending = try fixture.store.acceptReturnedFile(jobID: job.id, sourceURL: file, now: fixture.date)
        try fixture.execute("INSERT INTO asset_source_versions(version_id,asset_id,state,created_at) VALUES ('newer','asset-1','candidate','2099-01-01T00:00:00Z')")
        #expect(throws: ExternalEditJobError.self) {
            try fixture.store.resolveReturn(returnID: pending.id, decision: .replaceOriginal, now: fixture.date)
        }
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_returns") == "0")
        #expect(try fixture.scalar("SELECT state FROM external_edit_return_queue") == "pending")
    }

    @Test("AI After upscaling creates a versioned rendition, preserves the original and replays safely")
    func visualAfterRendition() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let file = Bundle.module.url(forResource: "proposed", withExtension: "png", subdirectory: "Fixtures/PBE144SyntheticOpenAI")!
        let data = try Data(contentsOf: file)
        let image = try #require(CGImageSourceCreateWithData(data as CFData, nil))
        let decoded = try #require(CGImageSourceCreateImageAtIndex(image, 0, nil))
        let item = FixtureReviewItem(id: "asset-1", photoLibraryIdentifier: "asset-1",
            sourceVersionID: "source-asset-1", title: "One", keywords: [], filename: "one.dng", capturedAt: "",
            pixelWidth: decoded.width * 2, pixelHeight: decoded.height * 2)
        let proposal = VisualRepairProposal(id: "visual-repair-test", fixtureID: "fixture-expo", assetID: item.id,
            sourceVersionID: item.sourceVersionID, defectCategories: [.contrast], ladderRung: 0, modelLadder: [],
            requestedGeneratorModel: "test", resolvedModel: "test", reasoningEffort: "", vision: true,
            attempt: 1, status: .draft, originalReference: "immutable-source-version://source-asset-1",
            derivedReference: file.absoluteString, derivedAvailable: true,
            derivedSHA256: VisualRepairRendition.digest(data), generatorReference: "test")
        var invalid = proposal
        invalid.derivedSHA256 = "wrong"
        #expect(throws: ExternalEditJobError.self) {
            try VisualRepairRendition.prepare(proposal: invalid, item: item, store: fixture.store, now: fixture.date)
        }
        #expect(try fixture.scalar("SELECT COUNT(*) FROM asset_source_versions") == "2")
        let result = try VisualRepairRendition.prepare(proposal: proposal, item: item, store: fixture.store, now: fixture.date)
        let output = try #require(CGImageSourceCreateWithURL(result.fileURL as CFURL, nil))
        let after = try #require(CGImageSourceCreateImageAtIndex(output, 0, nil))
        #expect(after.width == item.pixelWidth && after.height == item.pixelHeight)
        #expect(result.renditionLabel == "AI After · upscaled")
        #expect(try Data(contentsOf: file) == data)
        #expect(try fixture.scalar("SELECT rendered_fingerprint FROM asset_source_versions WHERE version_id = 'source-asset-1'") == "")
        #expect(try fixture.scalar("SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "unreviewed")
        #expect(try fixture.scalar("SELECT parent_source_version_id FROM external_edit_lineage WHERE child_source_version_id = '\(result.sourceVersionID)'") == item.sourceVersionID)
        let replay = try VisualRepairRendition.prepare(proposal: proposal, item: item, store: fixture.store, now: fixture.date)
        #expect(replay.sourceVersionID == result.sourceVersionID)
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_returns") == "1")
        try fixture.execute("INSERT INTO asset_source_versions(version_id,asset_id,state,created_at) VALUES ('newer','asset-1','candidate','2099-01-01T00:00:00Z')")
        #expect(throws: ExternalEditJobError.self) {
            try VisualRepairRendition.prepare(proposal: proposal, item: item, store: fixture.store, now: fixture.date)
        }
        #expect(throws: ExternalEditJobError.self) {
            try VisualRepairRendition.upscale(data, width: 0, height: 1)
        }
        #expect(throws: ExternalEditJobError.self) {
            try VisualRepairRendition.upscale(data, width: 1000, height: 1)
        }
    }

    @Test("One selected source stages before replacing the same asset")
    func singleSourceRoundTrip() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let store = fixture.store
        var job = try store.createJob(
            fixtureID: "fixture-expo",
            kind: .edit,
            editor: fixture.editor,
            sources: [fixture.source(position: 0, assetID: "asset-1")],
            now: fixture.date
        )
        #expect(try store.activeJob()?.id == job.id)

        let input = job.inputDirectory.appendingPathComponent("IMG_0001.DNG")
        try Data("raw-one".utf8).write(to: input)
        job = try store.recordPrepared(
            jobID: job.id,
            receipts: [PhotoExportReceipt(
                assetID: "photos-1",
                filename: "IMG_0001.DNG",
                destination: input,
                uniformTypeIdentifier: "com.adobe.raw-image",
                byteCount: 7,
                checksumSHA256: "source-checksum"
            )],
            now: fixture.date
        )
        job = try store.recordLaunched(jobID: job.id, now: fixture.date)
        #expect(job.state == .editing)

        let returned = fixture.root.appendingPathComponent("finished.tif")
        try Data("developed-one".utf8).write(to: returned)
        try fixture.execute("UPDATE asset_editorial_state SET editorial_state = 'approved' WHERE asset_id = 'asset-1'")
        let candidate = try store.acceptReturnedFile(
            jobID: job.id,
            sourceURL: returned,
            now: fixture.date
        )

        #expect(candidate.sources.map(\.assetID) == ["asset-1"])
        #expect(try store.activeJob() == nil)
        #expect(try fixture.scalar("SELECT COUNT(*) FROM asset_source_versions WHERE asset_id = 'asset-1'") == "1")
        #expect(try fixture.scalar("SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "approved")
        #expect(try store.currentReturnedSource(assetID: "asset-1") == nil)
        #expect(try store.pendingReturns(fixtureID: "fixture-expo").map(\.id) == [candidate.id])

        let receipt = try store.resolveReturn(
            returnID: candidate.id,
            decision: .replaceOriginal,
            now: fixture.date
        )
        #expect(receipt.destinationAssetID == "asset-1")
        #expect(!receipt.derivedAsset)
        #expect(try fixture.scalar("SELECT state FROM asset_source_versions WHERE version_id = '\(receipt.sourceVersionID)'") == "candidate")
        #expect(try fixture.scalar("SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "unreviewed")
        #expect(try fixture.scalar("SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = 'asset-1'") == "picked")
        #expect(try fixture.scalar("SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'") == "not-ready")
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_lineage WHERE child_source_version_id = '\(receipt.sourceVersionID)'") == "1")
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_asset_locks") == "0")
        #expect(FileManager.default.fileExists(atPath: receipt.fileURL.path))
        #expect(FileManager.default.fileExists(atPath: job.workingDirectory.appendingPathComponent("manifest.json").path))
        let current = try store.currentReturnedSource(assetID: "asset-1")
        #expect(current?.sourceVersionID == receipt.sourceVersionID)
        #expect(current?.fileURL == receipt.fileURL)
        #expect(current?.byteCount == candidate.byteCount)
    }

    @Test("A returned file is ignored once a newer source version exists")
    func staleReturnDoesNotOverrideNewerSource() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let store = fixture.store
        let job = try store.createJob(
            fixtureID: "fixture-expo",
            kind: .edit,
            editor: fixture.editor,
            sources: [fixture.source(position: 0, assetID: "asset-1")],
            now: fixture.date
        )
        _ = try store.recordLaunched(jobID: job.id, now: fixture.date)
        let returned = fixture.root.appendingPathComponent("finished.jpg")
        try Data("developed-one".utf8).write(to: returned)
        let candidate = try store.acceptReturnedFile(jobID: job.id, sourceURL: returned, now: fixture.date)
        _ = try store.resolveReturn(returnID: candidate.id, decision: .replaceOriginal, now: fixture.date)
        try fixture.execute(
            "INSERT INTO asset_source_versions(version_id, asset_id, state, created_at) "
                + "VALUES ('newer-photos-version', 'asset-1', 'candidate', '2030-01-01T00:00:00Z')"
        )

        #expect(try store.currentReturnedSource(assetID: "asset-1") == nil)
    }

    @Test("A return upgrades the legacy asset-based lineage table")
    func legacyLineageRoundTrip() throws {
        let fixture = try Fixture(legacyLineageSchema: true)
        defer { fixture.remove() }
        let store = fixture.store
        var job = try store.createJob(
            fixtureID: "fixture-expo",
            kind: .edit,
            editor: fixture.editor,
            sources: [fixture.source(position: 0, assetID: "asset-1")],
            now: fixture.date
        )
        let input = job.inputDirectory.appendingPathComponent("IMG_0001.DNG")
        try Data("raw-one".utf8).write(to: input)
        job = try store.recordPrepared(
            jobID: job.id,
            receipts: [PhotoExportReceipt(
                assetID: "photos-1",
                filename: "IMG_0001.DNG",
                destination: input,
                uniformTypeIdentifier: "com.adobe.raw-image",
                byteCount: 7,
                checksumSHA256: "source-checksum"
            )],
            now: fixture.date
        )
        _ = try store.recordLaunched(jobID: job.id, now: fixture.date)
        let returned = fixture.root.appendingPathComponent("finished.jpg")
        try Data("developed-one".utf8).write(to: returned)

        let candidate = try store.acceptReturnedFile(jobID: job.id, sourceURL: returned, now: fixture.date)
        let receipt = try store.resolveReturn(returnID: candidate.id, decision: .replaceOriginal, now: fixture.date)

        #expect(try fixture.scalar("SELECT COUNT(*) FROM pragma_table_info('external_edit_lineage') WHERE name = 'child_source_version_id'") == "1")
        #expect(try fixture.scalar("SELECT COUNT(*) FROM pragma_table_info('external_edit_lineage') WHERE name = 'destination_asset_id'") == "0")
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_lineage WHERE child_source_version_id = '\(receipt.sourceVersionID)'") == "1")
    }

    @Test("Every screen resolves the same ordered current source inputs")
    func resolvesCurrentSourcesForSharedUIEntryPoints() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }

        let sources = try fixture.store.resolveSources(assetIDs: ["asset-2", "asset-1", "asset-2"])

        #expect(sources.map(\.assetID) == ["asset-2", "asset-1"])
        #expect(sources.map(\.sourceVersionID) == ["source-asset-2", "source-asset-1"])
        #expect(sources.map(\.photoLibraryIdentifier) == ["asset-2", "asset-1"])
        #expect(sources.map(\.originalFilename) == ["two.dng", "one.dng"])
    }

    @Test("Several selected sources return as one derived asset with ordered lineage")
    func multipleSourceRoundTrip() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let store = fixture.store
        let job = try store.createJob(
            fixtureID: "fixture-expo",
            kind: .create,
            editor: fixture.editor,
            sources: [
                fixture.source(position: 0, assetID: "asset-1"),
                fixture.source(position: 1, assetID: "asset-2"),
            ],
            now: fixture.date
        )
        let inputs = try job.sources.map { source -> PhotoExportReceipt in
            let url = job.inputDirectory.appendingPathComponent("\(source.assetID).dng")
            let data = Data(source.assetID.utf8)
            try data.write(to: url)
            return PhotoExportReceipt(
                assetID: source.photoLibraryIdentifier,
                filename: url.lastPathComponent,
                destination: url,
                uniformTypeIdentifier: "com.adobe.raw-image",
                byteCount: Int64(data.count),
                checksumSHA256: "checksum-\(source.position)"
            )
        }
        _ = try store.recordPrepared(jobID: job.id, receipts: inputs, now: fixture.date)
        _ = try store.recordLaunched(jobID: job.id, now: fixture.date)
        let returned = fixture.root.appendingPathComponent("panorama.jpg")
        try Data("wide-panorama".utf8).write(to: returned)
        let candidate = try store.acceptReturnedFile(jobID: job.id, sourceURL: returned, now: fixture.date)
        let receipt = try store.resolveReturn(returnID: candidate.id, decision: .keepBoth, now: fixture.date)

        #expect(receipt.derivedAsset)
        #expect(receipt.destinationAssetID.hasPrefix("derived-"))
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_lineage WHERE child_source_version_id = '\(receipt.sourceVersionID)'") == "2")
        #expect(try fixture.scalar("SELECT group_concat(parent_asset_id, ',') FROM external_edit_lineage WHERE child_source_version_id = '\(receipt.sourceVersionID)' ORDER BY parent_position") == "asset-1,asset-2")
        #expect(try fixture.scalar("SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'fixture-expo' AND asset_id = '\(receipt.destinationAssetID)'") == "picked")
        #expect(try fixture.scalar("SELECT metadata_state FROM sidecar_decisions WHERE asset_id = '\(receipt.destinationAssetID)'") == "unreviewed")
    }

    @Test("Keep original is durable and idempotent without changing workflow state")
    func keepOriginalDoesNotMutateAsset() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try fixture.execute("UPDATE asset_editorial_state SET editorial_state = 'approved' WHERE asset_id = 'asset-1'")
        try fixture.execute("UPDATE asset_delivery_state SET delivery_state = 'live', source_version_hash = 'source-asset-1' WHERE asset_id = 'asset-1'")
        let job = try fixture.store.createJob(
            fixtureID: "fixture-expo",
            kind: .edit,
            editor: fixture.editor,
            sources: [fixture.source(position: 0, assetID: "asset-1")],
            now: fixture.date
        )
        _ = try fixture.store.recordLaunched(jobID: job.id, now: fixture.date)
        let returned = fixture.root.appendingPathComponent("same-name.jpg")
        try Data("returned".utf8).write(to: returned)
        let candidate = try fixture.store.acceptReturnedFile(jobID: job.id, sourceURL: returned, now: fixture.date)

        let first = try fixture.store.resolveReturn(
            returnID: candidate.id,
            decision: .keepOriginal,
            now: fixture.date
        )
        let repeated = try fixture.store.resolveReturn(
            returnID: candidate.id,
            decision: .keepOriginal,
            now: fixture.date
        )

        #expect(first == repeated)
        #expect(first.destinationAssetID.isEmpty)
        #expect(try fixture.scalar("SELECT COUNT(*) FROM asset_source_versions WHERE asset_id = 'asset-1'") == "1")
        #expect(try fixture.scalar("SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "approved")
        #expect(try fixture.scalar("SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'") == "live")
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_returns") == "0")
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_return_events") == "1")
        #expect(throws: ExternalEditJobError.self) {
            try fixture.store.resolveReturn(
                returnID: candidate.id,
                decision: .replaceOriginal,
                now: fixture.date
            )
        }
    }

    @Test("Keep both creates a linked review asset while preserving the live original")
    func keepBothPreservesOriginal() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try fixture.execute("UPDATE asset_editorial_state SET editorial_state = 'approved' WHERE asset_id = 'asset-1'")
        try fixture.execute("UPDATE asset_delivery_state SET delivery_state = 'live', source_version_hash = 'source-asset-1' WHERE asset_id = 'asset-1'")
        let job = try fixture.store.createJob(
            fixtureID: "fixture-expo",
            kind: .edit,
            editor: fixture.editor,
            sources: [fixture.source(position: 0, assetID: "asset-1")],
            now: fixture.date
        )
        _ = try fixture.store.recordLaunched(jobID: job.id, now: fixture.date)
        let returned = fixture.root.appendingPathComponent("finished.jpg")
        try Data("developed".utf8).write(to: returned)
        let candidate = try fixture.store.acceptReturnedFile(jobID: job.id, sourceURL: returned, now: fixture.date)

        let receipt = try fixture.store.resolveReturn(
            returnID: candidate.id,
            decision: .keepBoth,
            now: fixture.date
        )

        #expect(receipt.derivedAsset)
        #expect(receipt.destinationAssetID.hasPrefix("derived-"))
        #expect(try fixture.scalar("SELECT state FROM asset_source_versions WHERE version_id = 'source-asset-1'") == "candidate")
        #expect(try fixture.scalar("SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'") == "live")
        #expect(try fixture.scalar("SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'") == "approved")
        #expect(try fixture.scalar("SELECT editorial_state FROM asset_editorial_state WHERE asset_id = '\(receipt.destinationAssetID)'") == "unreviewed")
        #expect(try fixture.scalar("SELECT parent_asset_id FROM external_edit_lineage WHERE child_source_version_id = '\(receipt.sourceVersionID)'") == "asset-1")
    }

    @Test("A failed decision stays visible and succeeds after the staged file is restored")
    func failedDecisionRemainsRetryable() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let job = try fixture.store.createJob(
            fixtureID: "fixture-expo",
            kind: .edit,
            editor: fixture.editor,
            sources: [fixture.source(position: 0, assetID: "asset-1")],
            now: fixture.date
        )
        _ = try fixture.store.recordLaunched(jobID: job.id, now: fixture.date)
        let returned = fixture.root.appendingPathComponent("finished.jpg")
        try Data("developed".utf8).write(to: returned)
        let candidate = try fixture.store.acceptReturnedFile(jobID: job.id, sourceURL: returned, now: fixture.date)
        try Data("tampered!".utf8).write(to: candidate.returnedFileURL)

        #expect(throws: ExternalEditJobError.self) {
            try fixture.store.resolveReturn(
                returnID: candidate.id,
                decision: .replaceOriginal,
                now: fixture.date
            )
        }
        #expect(try fixture.store.pendingReturns(fixtureID: "fixture-expo").first?.errorMessage.isEmpty == false)
        try Data("developed".utf8).write(to: candidate.returnedFileURL)
        let retried = try fixture.store.resolveReturn(
            returnID: candidate.id,
            decision: .replaceOriginal,
            now: fixture.date
        )
        #expect(retried.destinationAssetID == "asset-1")
        #expect(try fixture.store.pendingReturns(fixtureID: "fixture-expo").isEmpty)
    }

    @Test("Duplicate returned filenames remain separate durable comparisons")
    func duplicateFilenamesRemainDistinct() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let returned = fixture.root.appendingPathComponent("finished.jpg")
        try Data("developed".utf8).write(to: returned)
        var ids: [String] = []
        for assetID in ["asset-1", "asset-2"] {
            let job = try fixture.store.createJob(
                fixtureID: "fixture-expo",
                kind: .edit,
                editor: fixture.editor,
                sources: [fixture.source(position: 0, assetID: assetID)],
                now: fixture.date
            )
            _ = try fixture.store.recordLaunched(jobID: job.id, now: fixture.date)
            ids.append(try fixture.store.acceptReturnedFile(
                jobID: job.id,
                sourceURL: returned,
                now: fixture.date
            ).id)
        }
        let restored = try ExternalEditJobSQLiteStore(
            databaseURL: fixture.databaseURL,
            jobsRoot: fixture.jobsRoot
        ).pendingReturns(fixtureID: "fixture-expo")
        #expect(Set(restored.map(\.id)) == Set(ids))
        #expect(Set(restored.map(\.returnedFileURL)).count == 2)
    }

    @Test("Only one active job exists and interrupted preparation recovers explicitly")
    func activeJobAndRecovery() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let store = fixture.store
        _ = try store.createJob(
            fixtureID: "fixture-expo",
            kind: .edit,
            editor: fixture.editor,
            sources: [fixture.source(position: 0, assetID: "asset-1")],
            now: fixture.date
        )
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_asset_locks") == "1")
        #expect(throws: ExternalEditJobError.self) {
            try store.createJob(
                fixtureID: "fixture-expo",
                kind: .edit,
                editor: fixture.editor,
                sources: [fixture.source(position: 0, assetID: "asset-2")],
                now: fixture.date
            )
        }
        #expect(try store.recoverInterruptedPreparation(now: fixture.date) == 1)
        #expect(try store.activeJob() == nil)
        #expect(try fixture.scalar("SELECT state FROM external_edit_jobs") == "failed")
        #expect(try fixture.scalar("SELECT COUNT(*) FROM external_edit_asset_locks") == "0")
    }
}

private struct Fixture {
    let root: URL
    let databaseURL: URL
    let jobsRoot: URL
    let date = Date(timeIntervalSince1970: 1_800_000_000)

    init(legacyLineageSchema: Bool = false) throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("external-edit-\(UUID().uuidString)", isDirectory: true)
        databaseURL = root.appendingPathComponent("Owner.sqlite")
        jobsRoot = root.appendingPathComponent("Jobs", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var database: OpaquePointer?
        guard sqlite3_open(databaseURL.path, &database) == SQLITE_OK, let database else {
            throw ExternalEditJobError.databaseUnavailable
        }
        defer { sqlite3_close_v2(database) }
        guard sqlite3_exec(database, Self.schema, nil, nil, nil) == SQLITE_OK else {
            throw ExternalEditJobError.database(String(cString: sqlite3_errmsg(database)))
        }
        if legacyLineageSchema {
            guard sqlite3_exec(database, Self.legacyLineageSchema, nil, nil, nil) == SQLITE_OK else {
                throw ExternalEditJobError.database(String(cString: sqlite3_errmsg(database)))
            }
        }
    }

    var store: ExternalEditJobSQLiteStore {
        ExternalEditJobSQLiteStore(databaseURL: databaseURL, jobsRoot: jobsRoot)
    }

    var editor: ExternalEditorProfile {
        ExternalEditorProfile(
            name: "Fixture Editor",
            bundleIdentifier: "test.editor",
            applicationURL: URL(fileURLWithPath: "/Applications/Fixture Editor.app")
        )
    }

    func source(position: Int, assetID: String) -> ExternalEditSource {
        ExternalEditSource(
            position: position,
            assetID: assetID,
            sourceVersionID: "source-\(assetID)",
            photoLibraryIdentifier: "photos-\(assetID)",
            originalFilename: "\(assetID).dng"
        )
    }

    func scalar(_ sql: String) throws -> String {
        var database: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK,
              let database else { throw ExternalEditJobError.databaseUnavailable }
        defer { sqlite3_close_v2(database) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
              let statement else { throw ExternalEditJobError.databaseUnavailable }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { return "" }
        return sqlite3_column_text(statement, 0).map(String.init(cString:)) ?? String(sqlite3_column_int64(statement, 0))
    }

    func execute(_ sql: String) throws {
        var database: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK,
              let database else { throw ExternalEditJobError.databaseUnavailable }
        defer { sqlite3_close_v2(database) }
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw ExternalEditJobError.database(String(cString: sqlite3_errmsg(database)))
        }
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    private static let schema = """
    PRAGMA foreign_keys = ON;
    CREATE TABLE fixtures(fixture_id TEXT PRIMARY KEY);
    INSERT INTO fixtures VALUES ('fixture-expo');
    CREATE TABLE sidecar_assets(
      asset_id TEXT PRIMARY KEY, source_anchor TEXT NOT NULL, media_type TEXT,
      filename TEXT, photos_title TEXT, photos_keywords_json TEXT NOT NULL DEFAULT '[]',
      location_keywords_json TEXT NOT NULL DEFAULT '[]', metadata_seed_keywords_json TEXT NOT NULL DEFAULT '[]',
      raw_json TEXT NOT NULL DEFAULT '{}', missing_at TEXT, indexed_at TEXT, updated_at TEXT
    );
    INSERT INTO sidecar_assets(asset_id, source_anchor, media_type, filename) VALUES
      ('asset-1', 'apple-photos://asset-1', 'photo', 'one.dng'),
      ('asset-2', 'apple-photos://asset-2', 'photo', 'two.dng');
    CREATE TABLE sidecar_decisions(
      asset_id TEXT PRIMARY KEY, rating INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '',
      pick_state TEXT NOT NULL DEFAULT 'picked', metadata_state TEXT NOT NULL DEFAULT 'unreviewed',
      title TEXT, keywords_json TEXT NOT NULL DEFAULT '[]', last_action TEXT, created_at TEXT, updated_at TEXT,
      FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    INSERT INTO sidecar_decisions(asset_id, title) VALUES ('asset-1', 'One'), ('asset-2', 'Two');
    CREATE TABLE sidecar_tombstones(asset_id TEXT PRIMARY KEY, tombstone_state TEXT NOT NULL);
    CREATE TABLE asset_editorial_state(
      asset_id TEXT PRIMARY KEY, editorial_state TEXT NOT NULL, ai_reasons_json TEXT NOT NULL DEFAULT '[]',
      ai_note TEXT NOT NULL DEFAULT '', ai_attempt_count INTEGER NOT NULL DEFAULT 0,
      ai_last_error TEXT NOT NULL DEFAULT '', requested_at TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT,
      FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    INSERT INTO asset_editorial_state(asset_id, editorial_state) VALUES ('asset-1', 'unreviewed'), ('asset-2', 'unreviewed');
    CREATE TABLE asset_delivery_state(
      asset_id TEXT PRIMARY KEY, delivery_state TEXT NOT NULL, source_version_hash TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT,
      FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    INSERT INTO asset_delivery_state(asset_id, delivery_state) VALUES ('asset-1', 'not-ready'), ('asset-2', 'not-ready');
    CREATE TABLE asset_source_versions(
      version_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, metadata_fingerprint TEXT NOT NULL DEFAULT '',
      rendered_fingerprint TEXT NOT NULL DEFAULT '', source_exists INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'candidate', created_at TEXT NOT NULL, approved_at TEXT, live_at TEXT, superseded_at TEXT,
      FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    INSERT INTO asset_source_versions(version_id, asset_id, state, created_at) VALUES
      ('source-asset-1', 'asset-1', 'candidate', '2026-01-01T00:00:00Z'),
      ('source-asset-2', 'asset-2', 'candidate', '2026-01-01T00:00:00Z');
    CREATE TABLE fixture_asset_placements(
      placement_id TEXT PRIMARY KEY, fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL,
      state TEXT NOT NULL, placed_at TEXT, updated_at TEXT,
      FOREIGN KEY(fixture_id) REFERENCES fixtures(fixture_id), FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    CREATE TABLE fixture_asset_decisions(
      fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL, placement_state TEXT NOT NULL,
      eligibility_state TEXT NOT NULL, source TEXT NOT NULL, last_action TEXT NOT NULL,
      created_at TEXT, updated_at TEXT, PRIMARY KEY(fixture_id, asset_id),
      FOREIGN KEY(fixture_id) REFERENCES fixtures(fixture_id), FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    INSERT INTO fixture_asset_decisions VALUES
      ('fixture-expo', 'asset-1', 'picked', 'active', 'native', '', '', ''),
      ('fixture-expo', 'asset-2', 'picked', 'active', 'native', '', '', '');
    CREATE TABLE sidecar_mock_uploads(
      asset_id TEXT PRIMARY KEY, mock_state TEXT NOT NULL, mock_run_id TEXT,
      uploaded_at TEXT, updated_at TEXT,
      FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
    );
    """

    private static let legacyLineageSchema = """
    CREATE TABLE external_edit_lineage (
      destination_asset_id TEXT NOT NULL,
      parent_position INTEGER NOT NULL,
      parent_asset_id TEXT NOT NULL,
      parent_source_version_id TEXT NOT NULL DEFAULT '',
      job_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(destination_asset_id, parent_position),
      FOREIGN KEY(destination_asset_id) REFERENCES sidecar_assets(asset_id),
      FOREIGN KEY(parent_asset_id) REFERENCES sidecar_assets(asset_id),
      FOREIGN KEY(job_id) REFERENCES external_edit_jobs(job_id)
    );
    """
}

private struct NoApprovalWake: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? { throw CancellationError() }
}

private actor ReviewApprovalTestAPI: OwnerActionServing {
    private(set) var requests: [[String: JSONValue]] = []
    func createAction(_ action: OwnerActionCreate, idempotencyKey: String) async throws -> OwnerActionEnvelope {
        let manifest = action.payload["manifest"]?.objectValue ?? [:]
        requests.append(manifest)
        var result: [String: JSONValue] = [:]
        switch manifest["mode"]?.stringValue {
        case "fixture-review-apply": result = ["reviewAction": .object(["changes": .array([])])]
        case "fixture-visual-repair-proposal-decide":
            result = ["visualRepairProposal": .object(["proposalId": "p", "assetId": "asset-1",
                "fixtureId": "fixture-expo", "sourceVersionId": "source-asset-1",
                "status": .string(manifest["decision"]?.stringValue == "reject" ? "rejected" : "accepted")])]
        case "fixture-review-window": result = ["reviewWindow": .object(["fixtureId": "fixture-expo", "items": .array([])])]
        case "fixture-ai-status": result = ["ai": .object(["active": false])]
        default: break
        }
        return OwnerActionEnvelope(action: OwnerAction(id: UUID().uuidString, actionKind: action.actionKind,
            target: action.target, state: .completed, result: result))
    }
    func getAction(id: String) async throws -> OwnerAction { throw CancellationError() }
}
