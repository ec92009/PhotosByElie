import AppKit
import CryptoKit
import Foundation
import ImageIO
import SQLite3
import Testing
import UniformTypeIdentifiers
@testable import BackstageUI
@testable import OwnerCore

private actor RecordingLocalFixtureReviewService: LocalFixtureReviewServing {
    private(set) var applyManifests: [[String: JSONValue]] = []
    private(set) var undoOperationIDs: [String] = []

    func applyReview(manifest: [String: JSONValue]) async throws -> FixtureReviewResult {
        applyManifests.append(manifest)
        return FixtureReviewResult(json: [
            "operationId": "reviewop-local",
            "fixtureId": manifest["fixtureId"] ?? "",
            "action": manifest["reviewAction"] ?? "hide",
            "anchorAssetId": manifest["anchorAssetId"] ?? "",
            "propagated": manifest["propagate"] ?? false,
            "items": [],
        ])
    }

    func undoReview(operationID: String) async throws -> FixtureReviewUndoResult {
        undoOperationIDs.append(operationID)
        return FixtureReviewUndoResult(json: [
            "operationId": .string(operationID),
            "fixtureId": "fixture-expo",
            "action": "hide",
            "alreadyUndone": false,
            "items": [],
        ])
    }
}

@Suite("OwnerCore contract")
struct OwnerCoreTests {
    @Test("PhotoKit cloud identifiers fail closed before native lookup")
    func photoKitCloudIdentifiersFailClosed() {
        let valid = "59647679-9EB0-46ED-9C2B-C98F61B58733:001:AZ69uAIW4v3U2XVypE0h8yYVh8mQ"
        #expect(PhotoLibraryIdentifier.cloudValue(from: valid) == valid)
        #expect(
            PhotoLibraryIdentifier.cloudValue(from: "apple-photos-cloud://\(valid)") == valid
        )

        for invalid in [
            "",
            "upload-1",
            "59647679-9EB0-46ED-9C2B-C98F61B58733",
            "59647679-9EB0-46ED-9C2B-C98F61B58733:1:AZ69uAIW4v3U2XVypE0h8yYVh8mQ",
            "59647679-9EB0-46ED-9C2B-C98F61B58733:001:",
            "59647679-9EB0-46ED-9C2B-C98F61B58733:001:not valid whitespace",
            "apple-photos-cloud://",
        ] {
            #expect(PhotoLibraryIdentifier.cloudValue(from: invalid) == nil)
        }
    }

    @Test("Quick Look close handling is scoped to the configured panel")
    @MainActor
    func quickLookCloseHandlingIsScoped() {
        let configuredPanel = NSWindow(
            contentRect: .zero,
            styleMask: [],
            backing: .buffered,
            defer: true
        )
        let otherWindow = NSWindow(
            contentRect: .zero,
            styleMask: [],
            backing: .buffered,
            defer: true
        )

        #expect(
            BackstageQuickLookCoordinator.isConfiguredQuickLookPanel(
                configuredPanel,
                configuredPanel: configuredPanel
            )
        )
        #expect(
            !BackstageQuickLookCoordinator.isConfiguredQuickLookPanel(
                otherWindow,
                configuredPanel: configuredPanel
            )
        )
        #expect(
            !BackstageQuickLookCoordinator.isConfiguredQuickLookPanel(
                configuredPanel,
                configuredPanel: nil
            )
        )
    }

    @Test("Only the newest asynchronous Quick Look presentation remains current")
    @MainActor
    func quickLookPresentationGenerationRejectsStaleWork() {
        let coordinator = BackstageQuickLookCoordinator()
        let first = coordinator.beginPresentation()
        let second = coordinator.beginPresentation()

        #expect(!coordinator.isCurrentPresentation(first))
        #expect(coordinator.isCurrentPresentation(second))
    }

    @Test("Quick Look workflow handoff removes the outgoing process-wide owner")
    @MainActor
    func quickLookWorkflowHandoffHasOneOwner() {
        let outgoing = BackstageQuickLookCoordinator()
        let incoming = BackstageQuickLookCoordinator()

        outgoing.claimSharedPreviewPanelOwnership()
        #expect(outgoing.ownsSharedPreviewPanel)

        incoming.claimSharedPreviewPanelOwnership()
        #expect(!outgoing.ownsSharedPreviewPanel)
        #expect(incoming.ownsSharedPreviewPanel)

        // A delayed onDisappear from the old workflow must not dismiss or
        // steal the panel now owned by the incoming workflow.
        outgoing.dismiss()
        #expect(incoming.ownsSharedPreviewPanel)
    }

    @Test("Quick Look title uses the same filename as its metadata snapshot")
    @MainActor
    func quickLookTitleUsesMetadataFilename() {
        let url = URL(fileURLWithPath: "/tmp/opaque-asset-id.jpg")
        let metadata = BackstageQuickLookMetadata(
            assetID: "asset-1",
            filename: "IMG_4478.jpg",
            title: "Photo title",
            keywords: [],
            locationLabel: "",
            capturedAt: "",
            rating: 0,
            color: "",
            state: "undecided",
            shortcutHint: ""
        )

        #expect(BackstageQuickLookCoordinator.previewTitle(for: url, metadata: metadata) == "IMG_4478.jpg")
        #expect(BackstageQuickLookCoordinator.previewTitle(for: url, metadata: nil) == "opaque-asset-id.jpg")
    }

    @Test("Quick Look remains managed by its originating desktop Space")
    @MainActor
    func quickLookUsesOriginSpaceCollectionBehavior() {
        let behavior = BackstageQuickLookCoordinator.originSpaceCollectionBehavior(
            from: [.canJoinAllSpaces, .moveToActiveSpace, .fullScreenAuxiliary]
        )

        #expect(behavior.contains(.managed))
        #expect(behavior.contains(.fullScreenAuxiliary))
        #expect(!behavior.contains(.canJoinAllSpaces))
        #expect(!behavior.contains(.moveToActiveSpace))
    }

    @Test("Quick Look preserves arrow axes and uses the live grid row stride")
    func quickLookNavigationUsesGridRowStride() {
        #expect(BackstageQuickLookShortcut.navigationShortcut(forKeyCode: 123) == .previous)
        #expect(BackstageQuickLookShortcut.navigationShortcut(forKeyCode: 124) == .next)
        #expect(BackstageQuickLookShortcut.navigationShortcut(forKeyCode: 126) == .previousRow)
        #expect(BackstageQuickLookShortcut.navigationShortcut(forKeyCode: 125) == .nextRow)
        #expect(BackstageQuickLookShortcut.navigationShortcut(forKeyCode: 0) == nil)

        #expect(BackstageQuickLookShortcut.previous.selectionDelta(rowStride: 6) == -1)
        #expect(BackstageQuickLookShortcut.next.selectionDelta(rowStride: 6) == 1)
        #expect(BackstageQuickLookShortcut.previousRow.selectionDelta(rowStride: 6) == -6)
        #expect(BackstageQuickLookShortcut.nextRow.selectionDelta(rowStride: 6) == 6)
        #expect(BackstageQuickLookShortcut.previousRow.ownerSelectionDirection == .previous)
        #expect(BackstageQuickLookShortcut.nextRow.ownerSelectionDirection == .next)
    }

    @Test("Every Quick Look maps 0–9 through the shared global decision vocabulary")
    func quickLookDecisionShortcutsAreCanonical() {
        let expected: [BackstageQuickLookShortcut] = [
            .rating(0),
            .rating(1),
            .rating(2),
            .rating(3),
            .rating(4),
            .rating(5),
            .color(.red),
            .color(.yellow),
            .color(.green),
            .color(.blue),
        ]

        for (value, shortcut) in zip(0...9, expected) {
            let parsed = BackstageQuickLookShortcut.shortcut(
                forKeyCode: 0,
                charactersIgnoringModifiers: String(value),
                modifierFlags: []
            )
            #expect(parsed == shortcut)
            #expect(parsed?.isGlobalDecisionMutation == true)
        }
        #expect(!BackstageQuickLookShortcut.hide.isGlobalDecisionMutation)
        #expect(!BackstageQuickLookShortcut.next.isGlobalDecisionMutation)
    }

    @Test("Quick Look recognizes plain Command-Z as undo without stealing modified variants")
    func quickLookRecognizesUndoShortcut() {
        #expect(
            BackstageQuickLookShortcut.shortcut(
                forKeyCode: 6,
                charactersIgnoringModifiers: "z",
                modifierFlags: .command
            ) == .undo
        )
        #expect(
            BackstageQuickLookShortcut.shortcut(
                forKeyCode: 6,
                charactersIgnoringModifiers: "z",
                modifierFlags: [.command, .shift]
            ) == nil
        )
        #expect(
            BackstageQuickLookShortcut.shortcut(
                forKeyCode: 6,
                charactersIgnoringModifiers: "z",
                modifierFlags: [.command, .option]
            ) == nil
        )
    }

    @Test("Quick Look source size is truthful for photos, video, and partial metadata")
    func quickLookSourceSizeFormatting() {
        let photo = BackstageQuickLookSourceSize(
            mediaType: "photo",
            pixelWidth: 2_048,
            pixelHeight: 4_096,
            byteCount: 4_000_000,
            currentImageByteCount: 3_000_000
        )
        #expect(photo.displayValue.contains("2048 × 4096"))
        #expect(photo.displayValue.contains("8.4 MP"))
        #expect(!photo.displayValue.contains("4 MB"))
        #expect(photo.currentImageSizeDisplayValue == "3 MB")
        #expect(photo.accessibilityValue.contains("2048 by 4096 pixels"))
        #expect(!photo.accessibilityValue.localizedCaseInsensitiveContains("file size"))

        let video = BackstageQuickLookSourceSize(
            mediaType: "video",
            pixelWidth: 3_840,
            pixelHeight: 2_160,
            byteCount: 120_000_000
        )
        #expect(video.displayValue.contains("3840 × 2160"))
        #expect(video.displayValue.contains("120 MB"))
        #expect(!video.displayValue.contains("MP"))
        #expect(video.accessibilityValue.hasPrefix("Video source."))
        #expect(video.currentImageSizeDisplayValue == nil)

        #expect(BackstageQuickLookSourceSize.unavailable.displayValue ==
            "Dimensions unavailable / Megapixels unavailable")
        #expect(BackstageQuickLookSourceSize.unavailable.currentImageSizeDisplayValue == nil)
        #expect(!BackstageQuickLookSourceSize.unavailable.accessibilityValue
            .localizedCaseInsensitiveContains("file size"))
    }

    @Test("Complete Photos source bytes remain distinct from encoded preview bytes")
    func completeSourceByteProvenance() throws {
        let sourceData = try #require(Data(base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        ))
        let known = try PhotoKitLibraryService.previewFromImageData(
            sourceData,
            localIdentifier: "photo-known",
            maxPixelSize: 180,
            currentImageByteCount: Int64(sourceData.count)
        )
        #expect(known.currentImageByteCount == Int64(sourceData.count))
        #expect(known.currentImageByteCount != Int64(known.jpegData.count))

        let renderedRaster = try PhotoKitLibraryService.previewFromImageData(
            sourceData,
            localIdentifier: "photo-rendered-raster",
            maxPixelSize: 180
        )
        #expect(renderedRaster.currentImageByteCount == nil)
    }

    @Test("Complete Photos source previews recover EXIF equipment metadata")
    func completeSourcePreviewRecoversEquipmentMetadata() throws {
        let pixel = try #require(Data(base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        ))
        let source = try #require(CGImageSourceCreateWithData(pixel as CFData, nil))
        let encoded = NSMutableData()
        let destination = try #require(CGImageDestinationCreateWithData(
            encoded,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ))
        CGImageDestinationAddImageFromSource(destination, source, 0, [
            kCGImagePropertyTIFFDictionary: [
                kCGImagePropertyTIFFModel: "Canon EOS R5",
            ],
            kCGImagePropertyExifDictionary: [
                kCGImagePropertyExifLensModel: "RF24-70mm F2.8 L IS USM",
                kCGImagePropertyExifFocalLength: 35.0,
                kCGImagePropertyExifFocalLenIn35mmFilm: 35,
            ],
        ] as CFDictionary)
        #expect(CGImageDestinationFinalize(destination))

        let preview = try PhotoKitLibraryService.previewFromImageData(
            encoded as Data,
            localIdentifier: "photo-with-equipment",
            maxPixelSize: 180,
            currentImageByteCount: Int64(encoded.length)
        )

        #expect(preview.cameraBody == "Canon EOS R5")
        #expect(preview.lens == "RF24-70mm F2.8 L IS USM")
        #expect(preview.focalLength == "35 mm")
    }

    @Test("Current-image size cache is compatible and never changes original provenance")
    func currentImageSizeCachePreservesOriginalMetadata() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-current-image-size-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        var database: OpaquePointer?
        #expect(sqlite3_open(databaseURL.path, &database) == SQLITE_OK)
        #expect(sqlite3_exec(database, #"""
        CREATE TABLE sidecar_assets(
          asset_id TEXT PRIMARY KEY,
          raw_json TEXT NOT NULL DEFAULT '{}'
        );
        INSERT INTO sidecar_assets VALUES
          ('photo-1', '{"originalByteCount":4000000}'),
          ('photo-2', '{"originalByteCount":5000000}');
        """#, nil, nil, nil) == SQLITE_OK)
        sqlite3_close(database)

        let store = OwnerCurrentImageSizeSQLiteStore(databaseURL: databaseURL)
        #expect(try store.values(assetIDs: ["photo-1"]) == [:])
        try store.upsert(
            ["photo-1": 3_000_000, "photo-2": 6_000_000],
            updatedAt: Date(timeIntervalSince1970: 2_000_000_000)
        )
        #expect(try store.values(assetIDs: ["photo-2", "photo-1", "photo-1"]) == [
            "photo-1": 3_000_000,
            "photo-2": 6_000_000,
        ])
        try store.upsert(["photo-1": 3_500_000], updatedAt: Date())
        #expect(try store.values(assetIDs: ["photo-1"]) == ["photo-1": 3_500_000])

        #expect(sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK)
        var statement: OpaquePointer?
        #expect(sqlite3_prepare_v2(
            database,
            "SELECT raw_json FROM sidecar_assets WHERE asset_id = 'photo-1'",
            -1,
            &statement,
            nil
        ) == SQLITE_OK)
        #expect(sqlite3_step(statement) == SQLITE_ROW)
        let rawJSON = sqlite3_column_text(statement, 0).map(String.init(cString:))
        #expect(rawJSON == #"{"originalByteCount":4000000}"#)
        sqlite3_finalize(statement)
        sqlite3_close(database)
    }

    @Test("Current-equipment cache merges learned values without changing original metadata")
    func currentEquipmentCachePreservesOriginalMetadata() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-current-equipment-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        var database: OpaquePointer?
        #expect(sqlite3_open(databaseURL.path, &database) == SQLITE_OK)
        #expect(sqlite3_exec(database, #"""
        CREATE TABLE sidecar_assets(
          asset_id TEXT PRIMARY KEY,
          media_type TEXT,
          pixel_width INTEGER,
          pixel_height INTEGER,
          raw_json TEXT NOT NULL DEFAULT '{}'
        );
        INSERT INTO sidecar_assets VALUES
          ('photo-41892', 'photo', 4000, 3000, '{"originalByteCount":4000000}');
        """#, nil, nil, nil) == SQLITE_OK)
        sqlite3_close(database)

        let cache = OwnerCurrentEquipmentSQLiteStore(databaseURL: databaseURL)
        #expect(try cache.values(assetIDs: ["photo-41892"]) == [:])
        try cache.upsert([
            "photo-41892": OwnerCurrentEquipment(
                cameraBody: "  CANON   POWERSHOT ELPH  ",
                focalLength: "5 mm"
            ),
        ], updatedAt: Date(timeIntervalSince1970: 2_000_000_000))
        try cache.upsert([
            "photo-41892": OwnerCurrentEquipment(lens: "Canon compact lens"),
        ], updatedAt: Date())

        #expect(try cache.values(assetIDs: ["photo-41892", "photo-41892"]) == [
            "photo-41892": OwnerCurrentEquipment(
                cameraBody: "CANON POWERSHOT ELPH",
                lens: "Canon compact lens",
                focalLength: "5 mm"
            ),
        ])
        let metadata = try OwnerAssetSourceSQLiteStore(databaseURL: databaseURL)
            .metadata(assetIDs: ["photo-41892"])
        #expect(metadata["photo-41892"]?.cameraBody == "CANON POWERSHOT ELPH")
        #expect(metadata["photo-41892"]?.lens == "Canon compact lens")
        #expect(metadata["photo-41892"]?.focalLength == "5 mm")

        database = nil
        #expect(sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK)
        var statement: OpaquePointer?
        #expect(sqlite3_prepare_v2(
            database,
            "SELECT raw_json FROM sidecar_assets WHERE asset_id = 'photo-41892'",
            -1,
            &statement,
            nil
        ) == SQLITE_OK)
        #expect(sqlite3_step(statement) == SQLITE_ROW)
        let rawJSON = sqlite3_column_text(statement, 0).map(String.init(cString:))
        #expect(rawJSON == #"{"originalByteCount":4000000}"#)
        sqlite3_finalize(statement)
        sqlite3_close(database)
    }

    @Test("Owner source metadata lookup is read-only and asset scoped")
    func ownerSourceMetadataLookup() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-source-metadata-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        var database: OpaquePointer?
        #expect(sqlite3_open(databaseURL.path, &database) == SQLITE_OK)
        let sql = #"""
        CREATE TABLE sidecar_assets(
          asset_id TEXT PRIMARY KEY,
          media_type TEXT,
          pixel_width INTEGER,
          pixel_height INTEGER,
          raw_json TEXT NOT NULL DEFAULT '{}'
        );
        INSERT INTO sidecar_assets VALUES
          ('photo-1', 'photo', 2048, 4096, '{"originalByteCount":4000000}'),
          ('video-1', 'video', 3840, 2160, '{}'),
          ('other', 'photo', 1, 1, '{}');
        """#
        #expect(sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK)
        sqlite3_close(database)

        let metadata = try OwnerAssetSourceSQLiteStore(databaseURL: databaseURL)
            .metadata(assetIDs: ["video-1", "photo-1", "photo-1"])

        #expect(metadata.keys.sorted() == ["photo-1", "video-1"])
        #expect(metadata["photo-1"] == OwnerAssetSourceMetadata(
            mediaType: "photo",
            pixelWidth: 2_048,
            pixelHeight: 4_096,
            originalByteCount: 4_000_000
        ))
        #expect(metadata["video-1"]?.mediaType == "video")
        #expect(metadata["video-1"]?.originalByteCount == 0)
    }

    @Test("Owner source metadata lookup safely spans SQLite variable batches")
    func ownerSourceMetadataLookupBatchesLargeScopes() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-source-metadata-batches-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        var database: OpaquePointer?
        #expect(sqlite3_open(databaseURL.path, &database) == SQLITE_OK)
        #expect(sqlite3_exec(database, #"""
        CREATE TABLE sidecar_assets(
          asset_id TEXT PRIMARY KEY,
          filename TEXT,
          media_type TEXT,
          pixel_width INTEGER,
          pixel_height INTEGER,
          raw_json TEXT NOT NULL DEFAULT '{}'
        );
        WITH RECURSIVE sequence(value) AS (
          SELECT 1
          UNION ALL
          SELECT value + 1 FROM sequence WHERE value < 450
        )
        INSERT INTO sidecar_assets
          SELECT printf('asset-%03d', value), printf('photo-%03d.jpg', value),
                 'photo', 100, 100,
                 '{"cameraMetadata":{"model":"Canon PowerShot ELPH 300 HS"}}'
          FROM sequence;
        """#, nil, nil, nil) == SQLITE_OK)
        sqlite3_close(database)

        let assetIDs = (1...450).map { String(format: "asset-%03d", $0) }
        let metadata = try OwnerAssetSourceSQLiteStore(databaseURL: databaseURL)
            .metadata(assetIDs: assetIDs)

        #expect(metadata.count == 450)
        #expect(metadata["asset-450"]?.cameraBody == "Canon PowerShot ELPH 300 HS")
    }

    @Test("Owner source metadata joins immutable catalog equipment by exact asset ID")
    func ownerSourceMetadataIncludesCatalogEquipment() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-equipment-metadata-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let ownerURL = root.appendingPathComponent("Owner.sqlite")
        let catalogURL = root.appendingPathComponent("photosbyelie.sqlite")
        var database: OpaquePointer?
        #expect(sqlite3_open(ownerURL.path, &database) == SQLITE_OK)
        #expect(sqlite3_exec(database, #"""
        CREATE TABLE sidecar_assets(
          asset_id TEXT PRIMARY KEY,
          filename TEXT,
          media_type TEXT,
          pixel_width INTEGER,
          pixel_height INTEGER,
          raw_json TEXT NOT NULL DEFAULT '{}'
        );
        INSERT INTO sidecar_assets VALUES
          ('asset-1', 'direct.jpg', 'photo', 5568, 3712, '{}'),
          ('asset-legacy', 'legacy.jpg', 'photo', 5568, 3712, '{}'),
          ('private-only', 'private.jpg', 'photo', 100, 100, '{}');
        """#, nil, nil, nil) == SQLITE_OK)
        sqlite3_close(database)

        database = nil
        #expect(sqlite3_open(catalogURL.path, &database) == SQLITE_OK)
        #expect(sqlite3_exec(database, #"""
        CREATE TABLE cameras(camera_id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE lenses(lens_id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE media_items(
          media_id TEXT PRIMARY KEY,
          camera_id INTEGER,
          lens_id INTEGER,
          focal_length TEXT,
          source_file_id INTEGER
        );
        CREATE TABLE source_files(source_file_id INTEGER PRIMARY KEY, filename TEXT);
        INSERT INTO cameras VALUES (1, 'NIKON CORPORATION NIKON D500');
        INSERT INTO lenses VALUES (1, 'Tokina atx-i 11-20mm F2.8 CF');
        INSERT INTO source_files VALUES (1, 'direct.jpg'), (2, 'legacy.jpg');
        INSERT INTO media_items VALUES
          ('asset-1', 1, 1, '12.0 mm / 18 mm equivalent', 1),
          ('catalog-legacy', 1, 1, '12.0 mm / 18 mm equivalent', 2),
          ('catalog-only', 1, 1, '12.0 mm', NULL);
        """#, nil, nil, nil) == SQLITE_OK)
        sqlite3_close(database)

        let metadata = try OwnerAssetSourceSQLiteStore(
            databaseURL: ownerURL,
            catalogURL: catalogURL
        ).metadata(assetIDs: ["asset-1", "asset-legacy", "private-only", "catalog-only"])

        #expect(metadata.keys.sorted() == ["asset-1", "asset-legacy", "private-only"])
        #expect(metadata["asset-1"]?.cameraBody == "NIKON CORPORATION NIKON D500")
        #expect(metadata["asset-1"]?.lens == "Tokina atx-i 11-20mm F2.8 CF")
        #expect(metadata["asset-1"]?.focalLength == "12.0 mm / 18 mm equivalent")
        #expect(metadata["asset-legacy"]?.cameraBody == "NIKON CORPORATION NIKON D500")
        #expect(metadata["asset-legacy"]?.lens == "Tokina atx-i 11-20mm F2.8 CF")
        #expect(metadata["private-only"]?.cameraBody == "")
    }

    @Test("Quick Look equipment normalizes full, partial, and absent metadata")
    func quickLookEquipmentFormatting() {
        #expect(
            BackstageQuickLookEquipment(
                cameraBody: "NIKON CORPORATION NIKON D500",
                lens: "Tokina atx-i 11-20mm F2.8 CF",
                focalLength: "12.0 mm / 18 mm equivalent"
            ).displayValue == "NIKON D500 with TOKINA ZOOM 11-20 at 12mm"
        )
        #expect(
            BackstageQuickLookEquipment(
                cameraBody: "",
                lens: "Tokina atx-i 11-20mm F2.8 CF",
                focalLength: "12 mm"
            ).displayValue == "TOKINA ZOOM 11-20 at 12mm"
        )
        #expect(
            BackstageQuickLookEquipment(
                cameraBody: "NIKON D500",
                lens: "",
                focalLength: ""
            ).displayValue == "NIKON D500"
        )
        #expect(
            BackstageQuickLookEquipment(
                cameraBody: "",
                lens: "",
                focalLength: ""
            ).displayValue == nil
        )
    }

    @Test("Upload plan enriches canonical previews from local source metadata")
    func uploadPlanUsesLocalSourceMetadata() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("upload-source-metadata-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        var database: OpaquePointer?
        #expect(sqlite3_open(databaseURL.path, &database) == SQLITE_OK)
        let sql = #"""
        CREATE TABLE sidecar_assets(
          asset_id TEXT PRIMARY KEY,
          media_type TEXT,
          pixel_width INTEGER,
          pixel_height INTEGER,
          raw_json TEXT NOT NULL DEFAULT '{}'
        );
        INSERT INTO sidecar_assets VALUES
          ('asset-1', 'photo', 2048, 4096, '{"originalByteCount":4000000}');
        """#
        #expect(sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK)
        sqlite3_close(database)

        let action = OwnerAction(
            id: "owner-action-upload-source",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: ["uploadPlan": [
                "fixtureId": "fixture-expo",
                "fixtureName": "Expo",
                "cloudAllowed": true,
                "items": [[
                    "assetId": "asset-1",
                    "photoLibraryIdentifier": "photos-asset-1",
                    "filename": "one.jpg",
                ]],
            ]]
        )
        let api = ScriptedOwnerActionAPI(completed: [action])
        let service = FixtureDeliveryService(
            runner: OwnerActionRunner(
                api: api,
                waker: UnavailableWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            nativeDatabaseURL: databaseURL
        )

        let plan = try await service.nativeUploadPlan(fixtureID: "fixture-expo")

        #expect(plan.items.first?.pixelWidth == 2_048)
        #expect(plan.items.first?.pixelHeight == 4_096)
        #expect(plan.items.first?.originalByteCount == 4_000_000)
    }

    @Test("Visual repair scope is limited to RE roots and descendants")
    func visualRepairScopeGuards() {
        let re = FixtureNode(
            id: "fixture-re",
            name: "RE",
            templateKey: "real-estate",
            children: [FixtureNode(id: "fixture-re-child", name: "La Concha")]
        )
        let expo = FixtureNode(id: "fixture-expo", name: "Expo", templateKey: "expo")
        #expect(VisualRepairScope.isREReview(path: [re]))
        #expect(VisualRepairScope.isREReview(path: [re, re.children[0]]))
        #expect(!VisualRepairScope.isREReview(path: [expo]))
        #expect(!VisualRepairScope.isREReview(path: []))
    }

    @Test("Visual comparison stays read-only and exposes missing proposal state")
    func visualRepairComparisonState() {
        let unavailable = VisualRepairComparisonState(
            originalReference: "immutable-source-version://source-1"
        )
        #expect(unavailable.isReadOnly)
        #expect(!unavailable.proposalAvailable)
        #expect(unavailable.proposedReference.isEmpty)
        #expect(unavailable.message.contains("not configured"))

        let proposal = VisualRepairProposal(
            id: "proposal-1",
            fixtureID: "fixture-re",
            assetID: "asset-1",
            sourceVersionID: "source-1",
            defectCategories: [.contrast],
            ladderRung: 1,
            modelLadder: [VisualRepairModelLadderRung(model: "gpt-5.4-mini", effort: "low")],
            requestedGeneratorModel: "gpt-5.4-mini",
            resolvedModel: "gpt-5.4-mini",
            reasoningEffort: "low",
            vision: true,
            attempt: 1,
            status: .draft,
            originalReference: "immutable-source-version://source-1",
            derivedReference: "synthetic://visual-repair/derived/one",
            derivedAvailable: true,
            generatorReference: "synthetic-generator://synthetic"
        )
        let comparison = VisualRepairComparisonState(
            originalReference: proposal.originalReference,
            proposal: proposal
        )
        #expect(comparison.isReadOnly)
        #expect(!comparison.proposalAvailable)
        #expect(comparison.proposedReference.isEmpty)
        #expect(comparison.message.contains("not configured"))
    }

    @Test("Visual comparison accepts SHA-bound local synthetic artifacts")
    func visualRepairRenderedArtifactState() throws {
        let renderedURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-144-\(UUID().uuidString).png")
        try Data("synthetic-rendered-artifact".utf8).write(to: renderedURL)
        defer { try? FileManager.default.removeItem(at: renderedURL) }
        let proposal = VisualRepairProposal(
            id: "proposal-rendered",
            fixtureID: "fixture-re",
            assetID: "asset-synthetic",
            sourceVersionID: "source-synthetic-v1",
            defectCategories: VisualRepairDefectCategory.allCases,
            ladderRung: 1,
            modelLadder: [VisualRepairModelLadderRung(model: "gpt-5.6-luna", effort: "max")],
            requestedGeneratorModel: "gpt-5.6-luna",
            resolvedModel: "gpt-5.6-luna",
            reasoningEffort: "max",
            vision: true,
            attempt: 1,
            status: .draft,
            originalReference: "immutable-source-version://source-synthetic-v1",
            originalPreviewReference: renderedURL.absoluteString,
            originalPreviewSHA256: "before-sha256",
            derivedReference: renderedURL.absoluteString,
            derivedAvailable: true,
            derivedSHA256: "after-sha256",
            generatorReference: "openai-synthetic://built-in-imagegen/pbe-144"
        )
        let comparison = VisualRepairComparisonState(
            originalReference: proposal.originalReference,
            proposal: proposal
        )
        #expect(VisualRepairComparisonState.isRenderableReference(proposal.originalPreviewReference))
        #expect(comparison.proposalAvailable)
        #expect(comparison.proposedReference == renderedURL.absoluteString)
        #expect(comparison.isReadOnly)
    }

    @Test("Decodes the published action page fixture")
    func decodesActionPage() throws {
        let url = try #require(Bundle.module.url(forResource: "action-page", withExtension: "json", subdirectory: "Fixtures"))
        let page = try JSONDecoder.ownerAPI.decode(OwnerActionPage.self, from: Data(contentsOf: url))
        #expect(page.actions.count == 1)
        #expect(page.actions[0].actionKind == "fixture-operation")
        #expect(page.actions[0].progress?.total == 20)
        #expect(page.page.hasMore)
    }

    @Test("Backstage updater compares a signed release manifest without inventing an endpoint")
    func backstageUpdateManifestAndVersionComparison() throws {
        let manifest = try backstageUpdateManifestFixture()
        try manifest.validate()
        #expect(manifest.architectures == ["arm64"])
        var legacyUniversal = manifest
        legacyUniversal.architectures = ["arm64", "x86_64"]
        try legacyUniversal.validate()
        let current = BackstageReleaseIdentity(
            bundleIdentifier: "com.photosbyelie.backstage",
            version: "219.1",
            build: "77"
        )
        let service = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(manifestURL: manifest.downloadURL),
            transport: StubBackstageUpdateTransport(manifestData: Data(), artifactData: Data()),
            extractor: StubBackstageArtifactExtractor(),
            signatureVerifier: StubBackstageSignatureVerifier()
        )
        #expect(try service.makeCheck(current: current, manifest: manifest).availability == .updateAvailable)

        var same = manifest
        same.version = "219.1"
        same.build = "77"
        #expect(try service.makeCheck(current: current, manifest: same).availability == .current)

        var older = manifest
        older.version = "219.0"
        older.build = "76"
        #expect(try service.makeCheck(current: current, manifest: older).availability == .downgradeRejected)

        var futureOS = manifest
        futureOS.minimumOSVersion = "999.0"
        #expect(try service.makeCheck(current: current, manifest: futureOS).availability == .incompatible)

        let wrongIdentity = BackstageReleaseIdentity(
            bundleIdentifier: "com.photosbyelie.backstage.canvas",
            version: "219.1",
            build: "77"
        )
        #expect(try service.makeCheck(current: wrongIdentity, manifest: manifest).availability == .incompatible)
    }

    @Test("Backstage updater rejects ambiguous manifest values")
    func backstageUpdateManifestValidationFailsClosed() throws {
        let manifest = try backstageUpdateManifestFixture()
        var invalidManifests: [BackstageReleaseManifest] = []

        var negativeVersion = manifest
        negativeVersion.version = "-1.0"
        invalidManifests.append(negativeVersion)

        var negativeBuild = manifest
        negativeBuild.build = "-1"
        invalidManifests.append(negativeBuild)

        var missingNotes = manifest
        missingNotes.releaseNotes = "  \n"
        invalidManifests.append(missingNotes)

        var insecureDownload = manifest
        insecureDownload.downloadURL = try #require(URL(string: "http://updates.test/backstage.zip"))
        invalidManifests.append(insecureDownload)

        var paddedTrust = manifest
        paddedTrust.trust.teamIdentifier += " "
        invalidManifests.append(paddedTrust)

        var oversizedArchive = manifest
        oversizedArchive.fileSize = BackstageUpdateResourceLimits.hardMaximumArchiveFileSize + 1
        invalidManifests.append(oversizedArchive)

        var intelOnlyArchitecture = manifest
        intelOnlyArchitecture.architectures = ["x86_64"]
        invalidManifests.append(intelOnlyArchitecture)

        for invalidManifest in invalidManifests {
            #expect(throws: BackstageUpdateError.self) {
                try invalidManifest.validate()
            }
        }
    }

    @Test("Backstage URL transport stops an undeclared streaming overrun and removes partial bytes")
    func backstageUpdateTransportRejectsStreamingOverrun() async throws {
        let manifest = try backstageUpdateManifestFixture()
        StreamingBackstageURLProtocol.setResponse(Data(repeating: 0x41, count: 18))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StreamingBackstageURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-stream-overrun-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(manifestURL: manifest.downloadURL),
            transport: URLSessionBackstageUpdateTransport(session: session),
            extractor: StubBackstageArtifactExtractor(),
            signatureVerifier: StubBackstageSignatureVerifier(),
            cacheDirectory: root
        )

        do {
            _ = try await service.downloadAndVerify(
                current: BackstageReleaseIdentity(
                    bundleIdentifier: "com.photosbyelie.backstage",
                    version: "219.1",
                    build: "77"
                ),
                manifest: manifest
            )
            Issue.record("An archive byte beyond the declared size unexpectedly downloaded.")
        } catch let error as BackstageUpdateError {
            #expect(error.localizedDescription.contains("exceeded"))
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    @Test("Backstage updater fetches and validates the configured manifest")
    func backstageUpdateChecksConfiguredManifest() async throws {
        let manifest = try backstageUpdateManifestFixture()
        let service = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(manifestURL: manifest.downloadURL),
            transport: StubBackstageUpdateTransport(
                manifestData: try JSONEncoder().encode(manifest),
                artifactData: Data()
            ),
            extractor: StubBackstageArtifactExtractor(),
            signatureVerifier: StubBackstageSignatureVerifier(),
            currentBundleURL: nil
        )
        let result = try await service.check(
            current: BackstageReleaseIdentity(
                bundleIdentifier: "com.photosbyelie.backstage",
                version: "219.1",
                build: "77"
            )
        )
        #expect(result.availability == .updateAvailable)
        #expect(result.manifest == manifest)
    }

    @Test("Backstage updater blocks a signer change before offering a download")
    func backstageUpdateRejectsChangedCurrentSigner() async throws {
        let manifest = try backstageUpdateManifestFixture()
        var differentTrust = manifest.trust
        differentTrust.teamIdentifier = "OTHERTEAM"
        let service = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(manifestURL: manifest.downloadURL),
            transport: StubBackstageUpdateTransport(
                manifestData: try JSONEncoder().encode(manifest),
                artifactData: Data()
            ),
            extractor: StubBackstageArtifactExtractor(),
            signatureVerifier: StubBackstageSignatureVerifier(),
            currentTrustReader: StubBackstageCurrentTrustReader(trust: differentTrust),
            currentBundleURL: URL(fileURLWithPath: "/tmp/PhotosByElie Backstage.app")
        )

        do {
            _ = try await service.check(
                current: BackstageReleaseIdentity(
                    bundleIdentifier: "com.photosbyelie.backstage",
                    version: "219.1",
                    build: "77"
                )
            )
            Issue.record("A changed signing team unexpectedly passed the update check.")
        } catch let error as BackstageUpdateError {
            #expect(error.localizedDescription.contains("signing contract differs"))
            #expect(error.recoveryGuidance.contains("Keep this installation"))
        }
    }

    @Test("Backstage updater verifies cache bytes and bundle metadata before offering an update")
    func backstageUpdateDownloadAndVerify() async throws {
        let (manifest, artifactData) = try backstageUpdateManifestAndArtifactFixture()
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-update-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let progress = LockedProgress()
        let service = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(manifestURL: manifest.downloadURL),
            transport: StubBackstageUpdateTransport(
                manifestData: try JSONEncoder().encode(manifest),
                artifactData: artifactData
            ),
            extractor: StubBackstageArtifactExtractor(version: manifest.version, build: manifest.build),
            signatureVerifier: StubBackstageSignatureVerifier(),
            cacheDirectory: root
        )
        let verified = try await service.downloadAndVerify(
            current: BackstageReleaseIdentity(
                bundleIdentifier: "com.photosbyelie.backstage",
                version: "219.1",
                build: "77"
            ),
            manifest: manifest
        ) { received, total in
            progress.append(received: received, total: total)
        }

        #expect(FileManager.default.fileExists(atPath: verified.archiveURL.path))
        #expect(FileManager.default.fileExists(atPath: verified.bundleURL.path))
        #expect(progress.values.last?.received == manifest.fileSize)
        #expect(progress.values.last?.total == manifest.fileSize)
    }

    @Test("Backstage updater blocks checksum and signature failures with recovery guidance")
    func backstageUpdateVerificationFailuresAreSafe() async throws {
        let (manifest, artifactData) = try backstageUpdateManifestAndArtifactFixture()
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-update-failure-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        var badChecksum = manifest
        badChecksum.sha256 = String(repeating: "0", count: 64)
        let checksumService = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(manifestURL: manifest.downloadURL),
            transport: StubBackstageUpdateTransport(manifestData: Data(), artifactData: artifactData),
            extractor: StubBackstageArtifactExtractor(version: manifest.version, build: manifest.build),
            signatureVerifier: StubBackstageSignatureVerifier(),
            cacheDirectory: root
        )
        do {
            _ = try await checksumService.downloadAndVerify(
                current: BackstageReleaseIdentity(bundleIdentifier: "com.photosbyelie.backstage", version: "219.1", build: "77"),
                manifest: badChecksum
            )
            Issue.record("Checksum mismatch unexpectedly verified.")
        } catch let error as BackstageUpdateError {
            #expect(error.recoveryGuidance.contains("running app"))
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)

        let signatureService = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(manifestURL: manifest.downloadURL),
            transport: StubBackstageUpdateTransport(manifestData: Data(), artifactData: artifactData),
            extractor: StubBackstageArtifactExtractor(version: manifest.version, build: manifest.build),
            signatureVerifier: FailingBackstageSignatureVerifier(),
            cacheDirectory: root
        )
        do {
            _ = try await signatureService.downloadAndVerify(
                current: BackstageReleaseIdentity(bundleIdentifier: "com.photosbyelie.backstage", version: "219.1", build: "77"),
                manifest: manifest
            )
            Issue.record("Signature mismatch unexpectedly verified.")
        } catch let error as BackstageUpdateError {
            #expect(error.localizedDescription.contains("signature"))
            #expect(error.recoveryGuidance.contains("temporary archive was removed"))
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)

        let escapingExtractorService = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(manifestURL: manifest.downloadURL),
            transport: StubBackstageUpdateTransport(
                manifestData: Data(),
                artifactData: artifactData
            ),
            extractor: EscapingBackstageArtifactExtractor(),
            signatureVerifier: StubBackstageSignatureVerifier(),
            cacheDirectory: root
        )
        do {
            _ = try await escapingExtractorService.downloadAndVerify(
                current: BackstageReleaseIdentity(
                    bundleIdentifier: "com.photosbyelie.backstage",
                    version: "219.1",
                    build: "77"
                ),
                manifest: manifest
            )
            Issue.record("An extracted bundle outside the update directory unexpectedly verified.")
        } catch let error as BackstageUpdateError {
            #expect(error.localizedDescription.contains("outside the isolated update directory"))
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    @Test("Backstage installer atomically replaces only the canonical app and retains rollback")
    func backstageInstallerReplacesCanonicalAppAndRetainsRollback() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-installer-success-\(UUID().uuidString)", isDirectory: true)
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        let rollback = root.appendingPathComponent("Rollback", isDirectory: true)
        let verifiedRoot = root.appendingPathComponent("Verified", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: verifiedRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        var manifest = try backstageUpdateManifestFixture()
        let incumbent = applications.appendingPathComponent(BackstageUpdateInstaller.canonicalBundleName)
        let candidate = verifiedRoot.appendingPathComponent("Candidate.app", isDirectory: true)
        let archive = verifiedRoot.appendingPathComponent("Backstage-update.zip")
        try createSyntheticBackstageApp(at: incumbent, version: "219.1", build: "77")
        try createSyntheticBackstageApp(at: candidate, version: manifest.version, build: manifest.build)
        let readOnlyRuntime = incumbent
            .appendingPathComponent("Contents/Resources/OwnerRuntime", isDirectory: true)
        try FileManager.default.createDirectory(at: readOnlyRuntime, withIntermediateDirectories: true)
        try Data("sealed runtime".utf8).write(
            to: readOnlyRuntime.appendingPathComponent("runtime.txt")
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o555],
            ofItemAtPath: readOnlyRuntime.path
        )
        try Data("verified archive".utf8).write(to: archive)
        manifest.fileSize = Int64(try Data(contentsOf: archive).count)
        manifest.sha256 = try BackstageUpdateService.sha256(of: archive)

        let installer = BackstageUpdateInstaller(
            signatureVerifier: StubBackstageSignatureVerifier(),
            applicationsDirectory: applications,
            rollbackDirectory: rollback
        )
        let receipt = try installer.install(BackstageVerifiedUpdate(
            manifest: manifest,
            archiveURL: archive,
            bundleURL: candidate
        ))

        #expect(
            receipt.installedBundleURL.resolvingSymlinksInPath()
                == incumbent.resolvingSymlinksInPath()
        )
        #expect(try syntheticBackstageBuild(at: incumbent) == manifest.build)
        let rollbackURL = try #require(receipt.rollbackBundleURL)
        #expect(try syntheticBackstageBuild(at: rollbackURL) == "77")
        let visibleApps = try FileManager.default.contentsOfDirectory(
            at: applications,
            includingPropertiesForKeys: nil
        ).filter { $0.pathExtension == "app" && !$0.lastPathComponent.hasPrefix(".") }
        #expect(
            visibleApps.map { $0.resolvingSymlinksInPath() }
                == [incumbent.resolvingSymlinksInPath()]
        )
        #expect(receipt.reconciledStagingBundleURLs.isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath: applications.path).allSatisfy {
            !$0.hasPrefix(BackstageUpdateInstaller.stagingBundlePrefix)
        })
        let rollbackRuntime = rollbackURL
            .appendingPathComponent("Contents/Resources/OwnerRuntime", isDirectory: true)
        #expect(FileManager.default.fileExists(atPath: rollbackRuntime.path))
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: rollbackRuntime.path
        )
    }

    @Test("Backstage installer reconciles only verified stale interrupted stages")
    func backstageInstallerReconcilesVerifiedStaleStages() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-installer-stale-\(UUID().uuidString)", isDirectory: true)
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        let rollback = root.appendingPathComponent("Rollback", isDirectory: true)
        let verifiedRoot = root.appendingPathComponent("Verified", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: verifiedRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        var manifest = try backstageUpdateManifestFixture()
        let incumbent = applications.appendingPathComponent(BackstageUpdateInstaller.canonicalBundleName)
        let candidate = verifiedRoot.appendingPathComponent("Candidate.app", isDirectory: true)
        let archive = verifiedRoot.appendingPathComponent("Backstage-update.zip")
        let stale = applications.appendingPathComponent(
            "\(BackstageUpdateInstaller.stagingBundlePrefix)\(UUID().uuidString).app",
            isDirectory: true
        )
        let unrelated = applications.appendingPathComponent(
            "\(BackstageUpdateInstaller.stagingBundlePrefix)not-a-uuid.app",
            isDirectory: true
        )
        try createSyntheticBackstageApp(at: incumbent, version: "219.1", build: "77")
        try createSyntheticBackstageApp(at: candidate, version: manifest.version, build: manifest.build)
        try createSyntheticBackstageApp(at: stale, version: "218.4", build: "70")
        try createSyntheticBackstageApp(at: unrelated, version: "1.0", build: "1")
        try Data("verified archive".utf8).write(to: archive)
        manifest.fileSize = Int64(try Data(contentsOf: archive).count)
        manifest.sha256 = try BackstageUpdateService.sha256(of: archive)
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-3_600)],
            ofItemAtPath: stale.path
        )

        let installer = BackstageUpdateInstaller(
            signatureVerifier: StubBackstageSignatureVerifier(),
            applicationsDirectory: applications,
            rollbackDirectory: rollback,
            staleStagingAge: 900,
            now: { now }
        )
        let inventory = try installer.auditStagingBundles(trust: manifest.trust)
        #expect(inventory.map(\.state) == [.staleVerified])
        let receipt = try installer.install(BackstageVerifiedUpdate(
            manifest: manifest,
            archiveURL: archive,
            bundleURL: candidate
        ))

        #expect(
            receipt.reconciledStagingBundleURLs.map(\.lastPathComponent)
                == [stale.lastPathComponent]
        )
        #expect(!FileManager.default.fileExists(atPath: stale.path))
        #expect(FileManager.default.fileExists(atPath: unrelated.path))
        #expect(try syntheticBackstageBuild(at: incumbent) == manifest.build)
        #expect(try syntheticBackstageBuild(at: #require(receipt.rollbackBundleURL)) == "77")
    }

    @Test("Backstage installer retains a recent stage as an active install")
    func backstageInstallerRetainsRecentActiveStage() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-installer-active-\(UUID().uuidString)", isDirectory: true)
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        let rollback = root.appendingPathComponent("Rollback", isDirectory: true)
        let verifiedRoot = root.appendingPathComponent("Verified", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: verifiedRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        var manifest = try backstageUpdateManifestFixture()
        let incumbent = applications.appendingPathComponent(BackstageUpdateInstaller.canonicalBundleName)
        let candidate = verifiedRoot.appendingPathComponent("Candidate.app", isDirectory: true)
        let archive = verifiedRoot.appendingPathComponent("Backstage-update.zip")
        let active = applications.appendingPathComponent(
            "\(BackstageUpdateInstaller.stagingBundlePrefix)\(UUID().uuidString).app",
            isDirectory: true
        )
        try createSyntheticBackstageApp(at: incumbent, version: "219.1", build: "77")
        try createSyntheticBackstageApp(at: candidate, version: manifest.version, build: manifest.build)
        try createSyntheticBackstageApp(at: active, version: "219.1", build: "77")
        try Data("verified archive".utf8).write(to: archive)
        manifest.fileSize = Int64(try Data(contentsOf: archive).count)
        manifest.sha256 = try BackstageUpdateService.sha256(of: archive)
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-60)],
            ofItemAtPath: active.path
        )

        let installer = BackstageUpdateInstaller(
            signatureVerifier: StubBackstageSignatureVerifier(),
            applicationsDirectory: applications,
            rollbackDirectory: rollback,
            staleStagingAge: 900,
            now: { now }
        )
        do {
            _ = try installer.install(BackstageVerifiedUpdate(
                manifest: manifest,
                archiveURL: archive,
                bundleURL: candidate
            ))
            Issue.record("A concurrent installer stage unexpectedly allowed another install.")
        } catch let error as BackstageUpdateError {
            #expect(error.localizedDescription.contains("active install"))
        }
        #expect(FileManager.default.fileExists(atPath: active.path))
        #expect(try syntheticBackstageBuild(at: incumbent) == "77")
        #expect(!FileManager.default.fileExists(atPath: rollback.path))
    }

    @Test("Backstage installer retains an unsafe wrong-identity stage")
    func backstageInstallerRetainsUnsafeWrongIdentityStage() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-installer-unsafe-\(UUID().uuidString)", isDirectory: true)
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        let rollback = root.appendingPathComponent("Rollback", isDirectory: true)
        let verifiedRoot = root.appendingPathComponent("Verified", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: verifiedRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        var manifest = try backstageUpdateManifestFixture()
        let incumbent = applications.appendingPathComponent(BackstageUpdateInstaller.canonicalBundleName)
        let candidate = verifiedRoot.appendingPathComponent("Candidate.app", isDirectory: true)
        let archive = verifiedRoot.appendingPathComponent("Backstage-update.zip")
        let unsafe = applications.appendingPathComponent(
            "\(BackstageUpdateInstaller.stagingBundlePrefix)\(UUID().uuidString).app",
            isDirectory: true
        )
        try createSyntheticBackstageApp(at: incumbent, version: "219.1", build: "77")
        try createSyntheticBackstageApp(at: candidate, version: manifest.version, build: manifest.build)
        try createSyntheticBackstageApp(
            at: unsafe,
            version: "1.0",
            build: "1",
            identifier: "com.example.not-backstage"
        )
        try Data("verified archive".utf8).write(to: archive)
        manifest.fileSize = Int64(try Data(contentsOf: archive).count)
        manifest.sha256 = try BackstageUpdateService.sha256(of: archive)
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-3_600)],
            ofItemAtPath: unsafe.path
        )

        let installer = BackstageUpdateInstaller(
            signatureVerifier: StubBackstageSignatureVerifier(),
            applicationsDirectory: applications,
            rollbackDirectory: rollback,
            staleStagingAge: 900,
            now: { now }
        )
        let inventory = try installer.auditStagingBundles(trust: manifest.trust)
        #expect(inventory.map(\.state) == [.unsafe])
        #expect(throws: BackstageUpdateError.self) {
            try installer.install(BackstageVerifiedUpdate(
                manifest: manifest,
                archiveURL: archive,
                bundleURL: candidate
            ))
        }
        #expect(FileManager.default.fileExists(atPath: unsafe.path))
        #expect(try syntheticBackstageBuild(at: incumbent) == "77")
    }

    @Test("Backstage installer surfaces a stale-stage cleanup failure before replacement")
    func backstageInstallerSurfacesStaleStageCleanupFailure() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-installer-cleanup-failure-\(UUID().uuidString)", isDirectory: true)
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        let rollback = root.appendingPathComponent("Rollback", isDirectory: true)
        let verifiedRoot = root.appendingPathComponent("Verified", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: verifiedRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        var manifest = try backstageUpdateManifestFixture()
        let incumbent = applications.appendingPathComponent(BackstageUpdateInstaller.canonicalBundleName)
        let candidate = verifiedRoot.appendingPathComponent("Candidate.app", isDirectory: true)
        let archive = verifiedRoot.appendingPathComponent("Backstage-update.zip")
        let stale = applications.appendingPathComponent(
            "\(BackstageUpdateInstaller.stagingBundlePrefix)\(UUID().uuidString).app",
            isDirectory: true
        )
        try createSyntheticBackstageApp(at: incumbent, version: "219.1", build: "77")
        try createSyntheticBackstageApp(at: candidate, version: manifest.version, build: manifest.build)
        try createSyntheticBackstageApp(at: stale, version: "218.4", build: "70")
        try Data("verified archive".utf8).write(to: archive)
        manifest.fileSize = Int64(try Data(contentsOf: archive).count)
        manifest.sha256 = try BackstageUpdateService.sha256(of: archive)
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-3_600)],
            ofItemAtPath: stale.path
        )

        let installer = BackstageUpdateInstaller(
            signatureVerifier: StubBackstageSignatureVerifier(),
            applicationsDirectory: applications,
            rollbackDirectory: rollback,
            staleStagingAge: 900,
            now: { now },
            removeStagingBundle: { _ in
                throw CocoaError(.fileWriteNoPermission)
            }
        )
        do {
            _ = try installer.install(BackstageVerifiedUpdate(
                manifest: manifest,
                archiveURL: archive,
                bundleURL: candidate
            ))
            Issue.record("A stale-stage cleanup failure unexpectedly allowed replacement.")
        } catch let error as BackstageUpdateError {
            #expect(error.localizedDescription.contains("canonical app and rollback were left untouched"))
        }
        #expect(FileManager.default.fileExists(atPath: stale.path))
        #expect(try syntheticBackstageBuild(at: incumbent) == "77")
        #expect(!FileManager.default.fileExists(atPath: rollback.path))
    }

    @Test("Backstage installer surfaces post-swap cleanup failure and preserves recovery")
    func backstageInstallerSurfacesPostSwapCleanupFailure() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-installer-post-swap-cleanup-\(UUID().uuidString)", isDirectory: true)
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        let rollback = root.appendingPathComponent("Rollback", isDirectory: true)
        let verifiedRoot = root.appendingPathComponent("Verified", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: verifiedRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        var manifest = try backstageUpdateManifestFixture()
        let incumbent = applications.appendingPathComponent(BackstageUpdateInstaller.canonicalBundleName)
        let candidate = verifiedRoot.appendingPathComponent("Candidate.app", isDirectory: true)
        let archive = verifiedRoot.appendingPathComponent("Backstage-update.zip")
        try createSyntheticBackstageApp(at: incumbent, version: "219.1", build: "77")
        try createSyntheticBackstageApp(at: candidate, version: manifest.version, build: manifest.build)
        try Data("verified archive".utf8).write(to: archive)
        manifest.fileSize = Int64(try Data(contentsOf: archive).count)
        manifest.sha256 = try BackstageUpdateService.sha256(of: archive)

        let installer = BackstageUpdateInstaller(
            signatureVerifier: StubBackstageSignatureVerifier(),
            applicationsDirectory: applications,
            rollbackDirectory: rollback,
            removeStagingBundle: { _ in
                throw CocoaError(.fileWriteNoPermission)
            }
        )
        do {
            _ = try installer.install(BackstageVerifiedUpdate(
                manifest: manifest,
                archiveURL: archive,
                bundleURL: candidate
            ))
            Issue.record("A post-swap cleanup failure was silently ignored.")
        } catch let error as BackstageUpdateError {
            #expect(error.localizedDescription.contains("canonical update is installed"))
            #expect(error.localizedDescription.contains("audit"))
        }

        #expect(try syntheticBackstageBuild(at: incumbent) == manifest.build)
        let rollbackApps = try FileManager.default.contentsOfDirectory(
            at: rollback,
            includingPropertiesForKeys: nil
        ).filter { $0.pathExtension == "app" }
        #expect(rollbackApps.count == 1)
        #expect(try syntheticBackstageBuild(at: #require(rollbackApps.first)) == "77")
        let installerStages = try FileManager.default.contentsOfDirectory(
            at: applications,
            includingPropertiesForKeys: nil
        ).filter { $0.lastPathComponent.hasPrefix(BackstageUpdateInstaller.stagingBundlePrefix) }
        #expect(installerStages.count == 1)
        #expect(try syntheticBackstageBuild(at: #require(installerStages.first)) == "77")
    }

    @Test("Backstage installer restores the incumbent when post-swap verification fails")
    func backstageInstallerRestoresIncumbentAfterFailedPostSwapVerification() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-installer-restore-\(UUID().uuidString)", isDirectory: true)
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        let rollback = root.appendingPathComponent("Rollback", isDirectory: true)
        let verifiedRoot = root.appendingPathComponent("Verified", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: verifiedRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        var manifest = try backstageUpdateManifestFixture()
        let incumbent = applications.appendingPathComponent(BackstageUpdateInstaller.canonicalBundleName)
        let candidate = verifiedRoot.appendingPathComponent("Candidate.app", isDirectory: true)
        let archive = verifiedRoot.appendingPathComponent("Backstage-update.zip")
        try createSyntheticBackstageApp(at: incumbent, version: "219.1", build: "77")
        try createSyntheticBackstageApp(at: candidate, version: manifest.version, build: manifest.build)
        try Data("verified archive".utf8).write(to: archive)
        manifest.fileSize = Int64(try Data(contentsOf: archive).count)
        manifest.sha256 = try BackstageUpdateService.sha256(of: archive)

        let installer = BackstageUpdateInstaller(
            signatureVerifier: FailingInstalledCandidateSignatureVerifier(
                canonicalPath: incumbent.path,
                candidateBuild: manifest.build
            ),
            applicationsDirectory: applications,
            rollbackDirectory: rollback
        )
        #expect(throws: BackstageUpdateError.self) {
            try installer.install(BackstageVerifiedUpdate(
                manifest: manifest,
                archiveURL: archive,
                bundleURL: candidate
            ))
        }
        #expect(try syntheticBackstageBuild(at: incumbent) == "77")
        #expect(try FileManager.default.contentsOfDirectory(atPath: applications.path).allSatisfy {
            !$0.hasPrefix(".PhotosByElie Backstage.install-")
        })
    }

    @Test("Backstage installer rejects changed archive bytes without touching the incumbent")
    func backstageInstallerRejectsChangedArchiveBeforeStaging() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-installer-checksum-\(UUID().uuidString)", isDirectory: true)
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        let rollback = root.appendingPathComponent("Rollback", isDirectory: true)
        let verifiedRoot = root.appendingPathComponent("Verified", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: verifiedRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        var manifest = try backstageUpdateManifestFixture()
        let incumbent = applications.appendingPathComponent(BackstageUpdateInstaller.canonicalBundleName)
        let candidate = verifiedRoot.appendingPathComponent("Candidate.app", isDirectory: true)
        let archive = verifiedRoot.appendingPathComponent("Backstage-update.zip")
        try createSyntheticBackstageApp(at: incumbent, version: "219.1", build: "77")
        try createSyntheticBackstageApp(at: candidate, version: manifest.version, build: manifest.build)
        try Data("verified archive".utf8).write(to: archive)
        manifest.fileSize = Int64(try Data(contentsOf: archive).count)
        manifest.sha256 = try BackstageUpdateService.sha256(of: archive)
        try Data("changed archive!".utf8).write(to: archive)

        let installer = BackstageUpdateInstaller(
            signatureVerifier: StubBackstageSignatureVerifier(),
            applicationsDirectory: applications,
            rollbackDirectory: rollback
        )
        #expect(throws: BackstageUpdateError.self) {
            try installer.install(BackstageVerifiedUpdate(
                manifest: manifest,
                archiveURL: archive,
                bundleURL: candidate
            ))
        }
        #expect(try syntheticBackstageBuild(at: incumbent) == "77")
        #expect(!FileManager.default.fileExists(atPath: rollback.path))
    }

    @Test("Backstage installer leaves an incomplete canonical app untouched")
    func backstageInstallerRejectsIncompleteIncumbentWithoutReplacement() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-installer-incomplete-incumbent-\(UUID().uuidString)", isDirectory: true)
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        let rollback = root.appendingPathComponent("Rollback", isDirectory: true)
        let verifiedRoot = root.appendingPathComponent("Verified", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: verifiedRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        var manifest = try backstageUpdateManifestFixture()
        let incumbent = applications.appendingPathComponent(BackstageUpdateInstaller.canonicalBundleName)
        let incumbentMarker = incumbent.appendingPathComponent("incomplete-marker")
        let candidate = verifiedRoot.appendingPathComponent("Candidate.app", isDirectory: true)
        let archive = verifiedRoot.appendingPathComponent("Backstage-update.zip")
        try FileManager.default.createDirectory(at: incumbent, withIntermediateDirectories: true)
        try Data("keep me".utf8).write(to: incumbentMarker)
        try createSyntheticBackstageApp(at: candidate, version: manifest.version, build: manifest.build)
        try Data("verified archive".utf8).write(to: archive)
        manifest.fileSize = Int64(try Data(contentsOf: archive).count)
        manifest.sha256 = try BackstageUpdateService.sha256(of: archive)

        let installer = BackstageUpdateInstaller(
            signatureVerifier: StubBackstageSignatureVerifier(),
            applicationsDirectory: applications,
            rollbackDirectory: rollback
        )
        #expect(throws: BackstageUpdateError.self) {
            try installer.install(BackstageVerifiedUpdate(
                manifest: manifest,
                archiveURL: archive,
                bundleURL: candidate
            ))
        }
        #expect(FileManager.default.fileExists(atPath: incumbentMarker.path))
        #expect(!FileManager.default.fileExists(atPath: rollback.path))
        #expect(try FileManager.default.contentsOfDirectory(atPath: applications.path).allSatisfy {
            !$0.hasPrefix(".PhotosByElie Backstage.install-")
        })
    }

    @Test("Backstage updater rejects excessive extracted bytes before signature verification and cleans up")
    func backstageUpdateRejectsExcessiveExtractedSize() async throws {
        let (manifest, artifactData) = try backstageUpdateManifestAndArtifactFixture()
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-update-extracted-size-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(manifestURL: manifest.downloadURL),
            transport: StubBackstageUpdateTransport(
                manifestData: Data(),
                artifactData: artifactData
            ),
            extractor: StubBackstageArtifactExtractor(
                version: manifest.version,
                build: manifest.build,
                extraFileCount: 1,
                extraFileSize: 8_192
            ),
            signatureVerifier: FailingBackstageSignatureVerifier(),
            cacheDirectory: root,
            limits: BackstageUpdateResourceLimits(
                maximumArchiveFileSize: manifest.fileSize,
                maximumExtractedRegularFileSize: 4_096,
                maximumExtractedEntryCount: 100
            )
        )

        do {
            _ = try await service.downloadAndVerify(
                current: BackstageReleaseIdentity(
                    bundleIdentifier: "com.photosbyelie.backstage",
                    version: "219.1",
                    build: "77"
                ),
                manifest: manifest
            )
            Issue.record("An oversized extracted tree unexpectedly reached signature verification.")
        } catch let error as BackstageUpdateError {
            #expect(error.localizedDescription.contains("regular-file safety limit"))
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    @Test("Backstage updater rejects excessive extracted entries and cleans up")
    func backstageUpdateRejectsExcessiveExtractedEntries() async throws {
        let (manifest, artifactData) = try backstageUpdateManifestAndArtifactFixture()
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-update-extracted-count-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(manifestURL: manifest.downloadURL),
            transport: StubBackstageUpdateTransport(
                manifestData: Data(),
                artifactData: artifactData
            ),
            extractor: StubBackstageArtifactExtractor(
                version: manifest.version,
                build: manifest.build,
                extraFileCount: 10
            ),
            signatureVerifier: FailingBackstageSignatureVerifier(),
            cacheDirectory: root,
            limits: BackstageUpdateResourceLimits(
                maximumArchiveFileSize: manifest.fileSize,
                maximumExtractedRegularFileSize: 10_000,
                maximumExtractedEntryCount: 10
            )
        )

        do {
            _ = try await service.downloadAndVerify(
                current: BackstageReleaseIdentity(
                    bundleIdentifier: "com.photosbyelie.backstage",
                    version: "219.1",
                    build: "77"
                ),
                manifest: manifest
            )
            Issue.record("An extracted tree with too many entries unexpectedly reached signature verification.")
        } catch let error as BackstageUpdateError {
            #expect(error.localizedDescription.contains("entry safety limit"))
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    @Test("Backstage updater rejects ZIP-declared expansion before invoking the extractor")
    func backstageUpdateRejectsZipBombBeforeExtraction() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-update-zip-bomb-\(UUID().uuidString)", isDirectory: true)
        let sourceApp = root.appendingPathComponent("Oversized.app", isDirectory: true)
        let contents = sourceApp.appendingPathComponent("Contents", isDirectory: true)
        let archive = root.appendingPathComponent("oversized.zip")
        let cache = root.appendingPathComponent("cache", isDirectory: true)
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        try Data(repeating: 0x5a, count: 1_024).write(
            to: contents.appendingPathComponent("payload.bin")
        )
        try createZipArchive(sourceApp: sourceApp, destination: archive)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        var manifest = try backstageUpdateManifestFixture()
        manifest.fileSize = Int64(
            try #require(
                (try FileManager.default.attributesOfItem(atPath: archive.path)[.size] as? NSNumber)?.int64Value
            )
        )
        manifest.sha256 = try BackstageUpdateService.sha256(of: archive)
        let extractorCall = LockedFlag()
        let service = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(manifestURL: manifest.downloadURL),
            transport: StubBackstageUpdateTransport(
                manifestData: Data(),
                artifactData: try Data(contentsOf: archive)
            ),
            extractor: RecordingBackstageArtifactExtractor(called: extractorCall),
            signatureVerifier: StubBackstageSignatureVerifier(),
            cacheDirectory: cache,
            limits: BackstageUpdateResourceLimits(
                maximumArchiveFileSize: manifest.fileSize,
                maximumExtractedRegularFileSize: 512,
                maximumExtractedEntryCount: 100
            )
        )

        do {
            _ = try await service.downloadAndVerify(
                current: BackstageReleaseIdentity(
                    bundleIdentifier: "com.photosbyelie.backstage",
                    version: "219.1",
                    build: "77"
                ),
                manifest: manifest
            )
            Issue.record("A ZIP declaring excessive expansion unexpectedly reached the extractor.")
        } catch let error as BackstageUpdateError {
            #expect(error.localizedDescription.contains("uncompressed content"))
        }
        #expect(!extractorCall.value())
        #expect(try FileManager.default.contentsOfDirectory(atPath: cache.path).isEmpty)
    }

    @Test("Backstage updater reports the missing authoritative endpoint as a safe blocker")
    func backstageUpdateEndpointIsExplicit() async throws {
        let service = BackstageUpdateService(
            configuration: BackstageUpdateConfiguration(),
            transport: StubBackstageUpdateTransport(manifestData: Data(), artifactData: Data()),
            extractor: StubBackstageArtifactExtractor(),
            signatureVerifier: StubBackstageSignatureVerifier()
        )
        do {
            _ = try await service.check(
                current: BackstageReleaseIdentity(bundleIdentifier: "com.photosbyelie.backstage", version: "219.1", build: "77")
            )
            Issue.record("Missing release endpoint unexpectedly proceeded.")
        } catch let error as BackstageUpdateError {
            #expect(error == .configurationMissing)
            #expect(error.recoveryGuidance.contains("approved HTTPS manifest"))
        }
    }

    @Test("Decodes legacy queued actions without canonical v1 aliases")
    func decodesLegacyActionPage() throws {
        let page = try JSONDecoder.ownerAPI.decode(
            OwnerActionPage.self,
            from: Data("""
            {
              "actions":[{
                "id":"legacy-action-1",
                "type":"photo-moderation",
                "state":"completed",
                "payload":{"requestedConnector":"max"}
              }],
              "page":{"hasMore":false}
            }
            """.utf8)
        )

        #expect(page.actions[0].actionKind == "photo-moderation")
        #expect(page.actions[0].target == "max")
        #expect(page.actions[0].state == .completed)
    }

    @Test("Owner action failures remain useful outside OwnerCore")
    func ownerActionFailuresAreLocalized() {
        #expect(
            OwnerActionRunError.failed("The connector rejected this action.").localizedDescription
                == "The connector rejected this action."
        )
        #expect(
            OwnerActionRunError.timedOut.localizedDescription
                == "The audited Owner action is taking longer than expected. It remains durable and can be checked in Activity."
        )
        #expect(
            OwnerActionRunError.invalidActionID.localizedDescription
                == "The audited Owner action did not return a valid action ID."
        )
    }

    @Test("Owner action enqueue returns before terminal polling")
    func ownerActionEnqueueReturnsQueuedAction() async throws {
        let wakeRecorder = OwnerActionWakeRecorder()
        let runner = OwnerActionRunner(
            api: PendingOwnerActionAPI(),
            waker: RecordingWaker(recorder: wakeRecorder),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        )
        let action = try await runner.enqueue(
            OwnerActionCreate(
                actionKind: "photo-moderation",
                target: "max",
                payload: ["operation": .string("waste-basket-x")]
            )
        )

        #expect(action.id == "owner-action-pending-fixture-tree")
        #expect(action.state == .queued)
        #expect(await wakeRecorder.waitForValues(count: 1) == [action.id])
    }

    @Test("Generated endpoints and examples match the published contract")
    func generatedContractAndExamples() throws {
        #expect(OwnerContract.openAPIVersion == "1.2.0")
        #expect(OwnerContract.endpoints[.createAction]?.method == "POST")
        #expect(OwnerContract.endpoints[.listActions]?.path == "/actions")
        #expect(OwnerContract.endpoints[.createOwnerTokens]?.path == "/auth/tokens")
        #expect(OwnerContract.endpoints[.beginOwnerEnrollmentHandoff]?.path == "/enrollment-handoffs")
        #expect(OwnerContract.schemaNames.contains("ErrorEnvelope"))
        #expect(Set(OwnerContract.exampleSections) == [
            "authentication", "pagination", "error", "idempotency", "progress",
        ])

        let url = try #require(Bundle.module.url(
            forResource: "owner-api-examples",
            withExtension: "json",
            subdirectory: "Fixtures"
        ))
        let payload = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        #expect(payload?["authentication"] != nil)
        #expect(payload?["pagination"] != nil)
        #expect(payload?["error"] != nil)
        #expect(payload?["idempotency"] != nil)
        #expect(payload?["progress"] != nil)
    }

    @Test("Dense selection preserves anchor for shift click and keyboard ranges")
    func denseSelectionRanges() {
        var selection = OwnerSelectionModel(orderedIDs: ["a", "b", "c", "d", "e"])
        selection.click("b", extending: false, toggling: false)
        selection.click("d", extending: true, toggling: false)
        #expect(selection.selectedIDs == ["b", "c", "d"])
        #expect(selection.anchorID == "b")

        selection.move(.next, extending: true)
        #expect(selection.selectedIDs == ["b", "c", "d", "e"])
        #expect(selection.anchorID == "b")

        selection.click("c", extending: false, toggling: true)
        #expect(selection.selectedIDs == ["b", "d", "e"])
    }

    @Test("Grid movement extends anchored selection by rows")
    func gridSelectionRanges() {
        let ids = (0..<20).map { "asset-\($0)" }
        var selection = OwnerSelectionModel(orderedIDs: ids)
        selection.click("asset-6", extending: false, toggling: false)
        selection.move(by: 5, extending: true)
        #expect(selection.selectedIDs == Set((6...11).map { "asset-\($0)" }))
        #expect(selection.anchorID == "asset-6")
        #expect(selection.focusedID == "asset-11")

        selection.move(by: -5, extending: false)
        #expect(selection.selectedIDs == ["asset-6"])
        #expect(selection.anchorID == "asset-6")
    }

    @Test("Explicit action targets preserve zero, one, and many display order")
    func explicitSelectionActionTargets() {
        var selection = OwnerSelectionModel(orderedIDs: ["a", "b", "c", "d"])
        #expect(selection.selectedInDisplayOrder.isEmpty)

        selection.click("c", extending: false, toggling: false)
        #expect(selection.selectedInDisplayOrder == ["c"])

        selection.click("a", extending: false, toggling: true)
        selection.click("d", extending: false, toggling: true)
        #expect(selection.selectedInDisplayOrder == ["a", "c", "d"])
    }

    @Test("Filtered decisions select the next surviving card")
    func filteredDecisionSelectsSuccessor() {
        var selection = OwnerSelectionModel(orderedIDs: ["a", "b", "c", "d"])
        selection.click("b", extending: false, toggling: false)

        let successor = selection.replaceItems(
            ["a", "c", "d"],
            selectingSuccessorAfterRemoving: "b"
        )
        #expect(successor == "c")
        #expect(selection.selectedIDs == ["c"])
        #expect(selection.anchorID == "c")
        #expect(selection.focusedID == "c")

        selection.click("d", extending: false, toggling: false)
        let predecessor = selection.replaceItems(
            ["a", "c"],
            selectingSuccessorAfterRemoving: "d"
        )
        #expect(predecessor == "c")
        #expect(selection.selectedIDs == ["c"])
    }

    @Test("Culling grid keeps 84-point cards and adapts column count")
    func cullingGridLayout() {
        #expect(CullingGridLayout.maximumColumnsThatFit(width: 83) == 1)
        #expect(CullingGridLayout.maximumColumnsThatFit(width: 84) == 1)
        #expect(CullingGridLayout.maximumColumnsThatFit(width: 176) == 2)
        #expect(CullingGridLayout.maximumColumnsThatFit(width: 1_000) == 10)
        #expect(CullingGridLayout.clampedColumnCount(5, width: 360) == 4)
        #expect(CullingGridLayout.clampedColumnCount(3, width: 1_000) == 3)
        #expect(CullingGridLayout.columnWidth(width: 360, columns: 4) == 84)
        #expect(CullingGridLayout.columnWidth(width: 500, columns: 4) == 119)
        for width in stride(from: 84.0, through: 1_200.0, by: 37.0) {
            let columns = CullingGridLayout.clampedColumnCount(10, width: width)
            let occupied = CullingGridLayout.columnWidth(width: width, columns: columns)
                * Double(columns)
                + CullingGridLayout.spacing * Double(columns - 1)
            #expect(occupied <= width + 0.001)
        }
    }

    @Test("Ten-item culling rehearsal preserves scope and composes filters")
    func tenItemCullingRehearsal() {
        let candidates = (0..<10).map { index in
            CullingCandidate(
                id: "asset-\(index)",
                title: index == 7 ? "Séville Plaza" : "Travel \(index)",
                filename: "IMG_\(index).\(index == 8 ? "MOV" : "JPG")",
                mediaType: index == 8 ? "video" : "photo",
                decision: SidecarDecisionState(
                    assetId: "asset-\(index)",
                    rating: index == 7 ? 4 : 0,
                    color: index == 7 ? "green" : "",
                    pickState: index == 7 || index == 8 ? "picked" : "undecided",
                    keywords: index == 7 ? ["Seville", "Spain"] : []
                )
            )
        }
        let result = CullingWorkspace.evaluate(
            candidates,
            query: CullingQuery(
                search: "seville",
                media: [.photos],
                pick: [.picked],
                ratings: [4],
                colors: [.green]
            )
        )

        #expect(result.items.map(\.id) == ["asset-7"])
        #expect(result.summary.total == 10)
        #expect(result.summary.filtered == 1)
        #expect(result.summary.picked == 2)
        #expect(result.summary.photos == 9)
        #expect(result.summary.videos == 1)
    }

    @Test("Culling search matches the exact asset identity used by workflow handoffs")
    func cullingSearchMatchesAssetIdentity() {
        let candidate = CullingCandidate(
            id: "DD8DB4CF-EF10-4CFB-BA2D-D9B4FF58509C:001:AdEJR/GC0fQdeE9oehWYwvEQL5Hk",
            title: "Untitled",
            filename: "20141102 1602 26919.jpg",
            mediaType: "photo",
            decision: SidecarDecisionState(
                assetId: "DD8DB4CF-EF10-4CFB-BA2D-D9B4FF58509C:001:AdEJR/GC0fQdeE9oehWYwvEQL5Hk",
                pickState: "picked"
            )
        )

        let result = CullingWorkspace.evaluate(
            [candidate],
            query: CullingQuery(
                search: candidate.id,
                media: [.photos],
                pick: [.picked],
                ratings: [0],
                colors: [.none]
            )
        )

        #expect(result.items.map(\.id) == [candidate.id])

        let partialIdentity = CullingWorkspace.evaluate(
            [candidate],
            query: CullingQuery(
                search: "EJR",
                media: [.photos],
                pick: [.picked],
                ratings: [0],
                colors: [.none]
            )
        )
        #expect(partialIdentity.items.isEmpty)
    }

    @Test("Culling grid preserves server equipment matches without opaque ID substrings")
    func cullingGridSearchesEquipmentButNotPartialIdentity() {
        let equipment = CullingCandidate(
            id: "asset-camera",
            title: "Untitled",
            filename: "camera-photo.jpg",
            mediaType: "photo",
            cameraBody: "Canon PowerShot ELPH 300 HS",
            lens: "4.3 - 21.5 mm",
            focalLength: "4.3 mm"
        )
        let opaqueIdentity = CullingCandidate(
            id: "opaque-elf-token",
            title: "Brick Flowers on a Bookshelf",
            filename: "selfie-flower-photo.jpg",
            mediaType: "photo",
            decision: SidecarDecisionState(
                assetId: "opaque-elf-token",
                keywords: ["Delft", "self-playing piano"]
            )
        )

        let commonSpelling = CullingWorkspace.evaluate(
            [equipment, opaqueIdentity],
            query: CullingQuery(search: "elf")
        )
        #expect(commonSpelling.items.map(\.id) == [equipment.id])

        let canonicalSpelling = CullingWorkspace.evaluate(
            [equipment, opaqueIdentity],
            query: CullingQuery(search: "elph")
        )
        #expect(canonicalSpelling.items.map(\.id) == [equipment.id])
    }

    @Test("Still-only Culling universes expose only the Photos control")
    func stillOnlyCullingMediaAvailability() {
        #expect(
            CullingMediaFilter.availableCases(in: ["photo", "image/jpeg", "still"])
                == [.photos]
        )
    }

    @Test("Video-only Culling universes expose only the Videos control")
    func videoOnlyCullingMediaAvailability() {
        #expect(
            CullingMediaFilter.availableCases(in: ["video", "quicktime-video"])
                == [.videos]
        )
    }

    @Test("Mixed Culling universes retain both media controls in stable order")
    func mixedCullingMediaAvailability() {
        #expect(
            CullingMediaFilter.availableCases(in: ["video", "photo", "video"])
                == [.photos, .videos]
        )
    }

    @Test("Stale media selection normalizes to a visible valid candidate type")
    func staleCullingMediaSelectionCannotHideValidCandidates() {
        let candidates = [
            CullingCandidate(id: "still", filename: "STILL.JPG", mediaType: "photo"),
        ]
        let available = CullingMediaFilter.availableCases(
            in: candidates.map(\.mediaType)
        )
        let normalized = CullingMediaFilter.normalizedSelection(
            [.videos],
            availableCases: available
        )
        let result = CullingWorkspace.evaluate(
            candidates,
            query: CullingQuery(media: normalized)
        )

        #expect(normalized == [.photos])
        #expect(result.items.map(\.id) == ["still"])
    }

    @Test("Empty Culling universes reset media selection to a safe neutral state")
    func emptyCullingMediaAvailabilityResetsSelection() {
        #expect(
            CullingMediaFilter.normalizedSelection(
                [.videos],
                availableCases: []
            ) == Set(CullingMediaFilter.selectableCases)
        )
    }

    @Test("Fixture hidden states match the rejected culling filter")
    func fixtureHiddenMatchesRejectedFilter() {
        let candidates = [
            CullingCandidate(
                id: "hidden",
                filename: "hidden.jpg",
                mediaType: "photo",
                decision: SidecarDecisionState(assetId: "hidden", pickState: "hidden")
            ),
            CullingCandidate(
                id: "open",
                filename: "open.jpg",
                mediaType: "photo",
                decision: SidecarDecisionState(assetId: "open", pickState: "undecided")
            ),
        ]

        let rejected = CullingWorkspace.evaluate(
            candidates,
            query: CullingQuery(pick: [.rejected])
        )
        let undecided = CullingWorkspace.evaluate(
            candidates,
            query: CullingQuery(pick: [.undecided])
        )

        #expect(rejected.items.map(\.id) == ["hidden"])
        #expect(undecided.items.map(\.id) == ["open"])
    }

    @Test("Large culling rehearsal uses deterministic bounded windows")
    func largeCullingRehearsal() {
        let candidates = (0..<1_140).map { index in
            CullingCandidate(
                id: "asset-\(index)",
                filename: "IMG_\(index).JPG",
                mediaType: "photo",
                decision: SidecarDecisionState(
                    assetId: "asset-\(index)",
                    pickState: index.isMultiple(of: 3) ? "picked" : "undecided"
                )
            )
        }
        let first = CullingWorkspace.evaluate(
            candidates,
            query: CullingQuery(pick: [.picked]),
            offset: 0,
            limit: 200
        )
        let second = CullingWorkspace.evaluate(
            candidates,
            query: CullingQuery(pick: [.picked]),
            offset: 200,
            limit: 200
        )

        #expect(first.summary.total == 1_140)
        #expect(first.summary.filtered == 380)
        #expect(first.items.count == 200)
        #expect(first.visibleRange == 1...200)
        #expect(first.hasNext)
        #expect(!first.hasPrevious)
        #expect(second.items.count == 180)
        #expect(second.visibleRange == 201...380)
        #expect(!second.hasNext)
        #expect(second.hasPrevious)
        #expect(Set(first.items.map(\.id)).isDisjoint(with: second.items.map(\.id)))
    }

    @Test("Fixture paths preserve the source hierarchy")
    func fixturePaths() {
        let tree = [
            FixtureNode(json: [
                "fixtureId": .string("expo"),
                "name": .string("Expo"),
                "children": .array([]),
            ]),
            FixtureNode(json: [
                "fixtureId": .string("re"),
                "name": .string("RE"),
                "children": .array([
                    .object([
                        "fixtureId": .string("la-concha"),
                        "name": .string("La Concha"),
                        "children": .array([
                            .object([
                                "fixtureId": .string("apartment-1"),
                                "name": .string("Apartment 1"),
                            ]),
                        ]),
                    ]),
                ]),
            ]),
        ]

        #expect(tree.path(to: "apartment-1").map(\.name) == ["RE", "La Concha", "Apartment 1"])
        #expect(tree.path(to: "missing").isEmpty)
    }

    @Test("Burst selection stays contiguous around the focused frame")
    func burstSelection() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let items = [
            CullingTimedItem(id: "a", capturedAt: base),
            CullingTimedItem(id: "b", capturedAt: base.addingTimeInterval(10)),
            CullingTimedItem(id: "c", capturedAt: base.addingTimeInterval(11)),
            CullingTimedItem(id: "d", capturedAt: base.addingTimeInterval(12.5)),
            CullingTimedItem(id: "e", capturedAt: base.addingTimeInterval(30)),
        ]

        #expect(CullingWorkspace.burst(containing: "c", in: items) == ["b", "c", "d"])
        #expect(CullingWorkspace.burst(containing: "missing", in: items).isEmpty)
    }

    @Test("Burst hide candidates keep the second visible frame")
    func burstRejectCandidatesKeepSecondFrame() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let items = [
            CullingTimedItem(id: "first", capturedAt: base),
            CullingTimedItem(id: "keeper", capturedAt: base.addingTimeInterval(1)),
            CullingTimedItem(id: "third", capturedAt: base.addingTimeInterval(20)),
            CullingTimedItem(id: "bridge", capturedAt: base.addingTimeInterval(75)),
            CullingTimedItem(id: "outside", capturedAt: base.addingTimeInterval(150)),
        ]

        #expect(
            CullingWorkspace.burstRejectCandidates(
                containing: "first",
                in: items
            ) == ["first", "third"]
        )
        #expect(
            CullingWorkspace.burstRejectCandidates(
                containing: "outside",
                in: items
            ).isEmpty
        )
    }

    @Test("Visible burst candidates respect capture-time boundaries")
    func visibleBurstRejectCandidatesRespectCaptureTime() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let items = [
            CullingTimedItem(id: "a-first", capturedAt: base),
            CullingTimedItem(id: "a-keeper", capturedAt: base.addingTimeInterval(1)),
            CullingTimedItem(id: "a-third", capturedAt: base.addingTimeInterval(2)),
            CullingTimedItem(id: "standalone", capturedAt: base.addingTimeInterval(30)),
            CullingTimedItem(id: "b-first", capturedAt: base.addingTimeInterval(90)),
            CullingTimedItem(id: "b-keeper", capturedAt: base.addingTimeInterval(91)),
            CullingTimedItem(id: "missing-time", capturedAt: nil),
        ]

        #expect(
            CullingWorkspace.burstRejectCandidates(
                in: items
            ) == ["a-first", "a-third", "b-first"]
        )
        #expect(
            CullingWorkspace.burstRejectCandidates(
                in: [CullingTimedItem(id: "only", capturedAt: base)]
            ).isEmpty
        )
        #expect(CullingWorkspace.burstRejectCandidates(in: []).isEmpty)
    }

    @Test("Review burst selection keeps the likely survivor and ignores singleton gaps")
    func reviewBurstRejectCandidates() {
        let items = [
            FixtureReviewItem(
                id: "review-first",
                photoLibraryIdentifier: "photos-review-first",
                title: "First",
                keywords: [],
                filename: "first.jpg",
                capturedAt: "2026-08-17T10:00:00Z"
            ),
            FixtureReviewItem(
                id: "review-keeper",
                photoLibraryIdentifier: "photos-review-keeper",
                title: "Keeper",
                keywords: [],
                filename: "keeper.jpg",
                capturedAt: "2026-08-17T10:00:01Z"
            ),
            FixtureReviewItem(
                id: "review-third",
                photoLibraryIdentifier: "photos-review-third",
                title: "Third",
                keywords: [],
                filename: "third.jpg",
                capturedAt: "2026-08-17T10:00:02Z"
            ),
            FixtureReviewItem(
                id: "review-singleton",
                photoLibraryIdentifier: "photos-review-singleton",
                title: "Singleton",
                keywords: [],
                filename: "singleton.jpg",
                capturedAt: "2026-08-17T10:01:00Z"
            ),
        ]

        #expect(
            CullingWorkspace.reviewBurstRejectCandidates(in: items)
                == ["review-first", "review-third"]
        )
        #expect(
            CullingWorkspace.reviewBurstRejectCandidates(in: Array(items.suffix(1)))
                .isEmpty
        )
    }

    @Test("Burst capture dates parse durable Owner timestamps")
    func burstCaptureDateParsing() throws {
        let standard = try #require(CullingWorkspace.captureDate("2022-12-16T16:44:38Z"))
        let fractional = try #require(CullingWorkspace.captureDate("2022-12-16T16:44:38.125Z"))

        #expect(abs(fractional.timeIntervalSince(standard) - 0.125) < 0.001)
        #expect(CullingWorkspace.captureDate("") == nil)
    }

    @Test("Creates canonical v1 requests with actor token and idempotency")
    func createsCanonicalRequest() async throws {
        let transport = RecordingTransport(response: """
        {"action":{"id":"owner-action-1","actionKind":"fixture-operation","target":"max","state":"queued"}}
        """)
        let client = OwnerAPIClient(baseURL: URL(string: "https://example.test/api/v1")!, transport: transport)
        await client.setAccessToken("short-lived")
        _ = try await client.createAction(
            OwnerActionCreate(actionKind: "fixture-operation", target: "max"),
            idempotencyKey: "fixture-create-1234"
        )
        let request = try #require(await transport.lastRequest())
        #expect(request.url?.path == "/api/v1/actions")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer short-lived")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "fixture-create-1234")
    }

    @Test("Paid order refund requires the exact confirmation payload and stable request idempotency")
    func paidOrderRefundRequestContract() async throws {
        let transport = RecordingTransport(response: """
        {
          "refund": {
            "orderId": "PBE-20260904-REFUND",
            "amount": 1600,
            "currency": "usd",
            "paymentStatus": "paid",
            "deliveryState": "delivery_failed",
            "entitlementState": "unavailable",
            "refundStatus": "succeeded",
            "refundId": "re_refund",
            "eligible": false,
            "ineligibleReason": "This order is already fully refunded.",
            "consequence": "No refund can be started while this order is in its current state.",
            "updatedAt": "2026-09-04T20:00:00Z",
            "failure": null
          }
        }
        """)
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        await client.setAccessToken("enrolled-device-session")

        let refund = try await client.refundPaidOrder(
            orderId: "PBE-20260904-REFUND",
            confirmationOrderId: "PBE-20260904-REFUND",
            reason: "Buyer requested cancellation before delivery."
        )

        #expect(refund.refundStatus == "succeeded")
        let request = try #require(await transport.lastRequest())
        #expect(request.url?.path == "/api/v1/orders/PBE-20260904-REFUND/refund")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer enrolled-device-session")
        #expect(
            request.value(forHTTPHeaderField: "Idempotency-Key")
                == "photosbyelie-refund-request-PBE-20260904-REFUND"
        )
        let body = try #require(request.httpBody)
        let payload = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(payload["confirmationOrderId"] == "PBE-20260904-REFUND")
        #expect(payload["reason"] == "Buyer requested cancellation before delivery.")
    }

    @Test("Inspects read-only Owner SQLite and backs up before migration")
    func databaseGateBackupAndMigration() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-core-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        var database: OpaquePointer?
        #expect(sqlite3_open(databaseURL.path, &database) == SQLITE_OK)
        #expect(sqlite3_exec(database, "CREATE TABLE sample(id TEXT PRIMARY KEY); PRAGMA user_version = 1;", nil, nil, nil) == SQLITE_OK)
        sqlite3_close(database)

        let gate = OwnerDatabaseGate(databaseURL: databaseURL)
        let before = try gate.inspect()
        #expect(before.readOnly)
        #expect(before.schemaVersion == 1)
        let backup = try gate.migrate(
            to: 2,
            statements: ["ALTER TABLE sample ADD COLUMN title TEXT NOT NULL DEFAULT '';"],
            expectedCurrentVersion: 1,
            identifier: "add-sample-title"
        )
        #expect(FileManager.default.fileExists(atPath: backup.path))
        #expect(try gate.inspect().schemaVersion == 2)
        #expect(try scalar(databaseURL, "SELECT COUNT(*) FROM grdb_migrations WHERE identifier = 'add-sample-title'") == "1")
        #expect(try scalar(backup, "PRAGMA integrity_check") == "ok")
    }

    @Test("A failed migration rolls back schema and migration history")
    func failedMigrationRollsBack() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-core-rollback-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Owner.sqlite")
        var database: OpaquePointer?
        #expect(sqlite3_open(databaseURL.path, &database) == SQLITE_OK)
        #expect(sqlite3_exec(database, "CREATE TABLE sample(id TEXT PRIMARY KEY); PRAGMA user_version = 1;", nil, nil, nil) == SQLITE_OK)
        sqlite3_close(database)

        let gate = OwnerDatabaseGate(databaseURL: databaseURL)
        #expect(throws: OwnerDatabaseError.self) {
            try gate.migrate(
                to: 2,
                statements: ["ALTER TABLE missing ADD COLUMN title TEXT;"],
                expectedCurrentVersion: 1,
                identifier: "will-fail"
            )
        }
        #expect(try gate.inspect().schemaVersion == 1)
        #expect(try scalar(databaseURL, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'grdb_migrations'") == "0")
    }

    @Test("Native Review database locator selects Owner-private SQLite")
    func nativeReviewDatabaseLocator() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("owner-review-locator-\(UUID().uuidString)", isDirectory: true)
        let configuredRoot = root.appendingPathComponent("configured", isDirectory: true)
        let environmentRoot = root.appendingPathComponent("environment", isDirectory: true)
        let configURL = root.appendingPathComponent("connector.json")
        try FileManager.default.createDirectory(
            at: configuredRoot.appendingPathComponent("assets/owner-actions", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: environmentRoot.appendingPathComponent("assets/owner-actions", isDirectory: true),
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: root) }
        let configuredDatabase = configuredRoot.appendingPathComponent(
            "assets/owner-actions/Owner.sqlite",
            isDirectory: false
        )
        let environmentDatabase = environmentRoot.appendingPathComponent(
            "assets/owner-actions/Owner.sqlite",
            isDirectory: false
        )
        try Data("configured".utf8).write(to: configuredDatabase)
        try Data("environment".utf8).write(to: environmentDatabase)
        let config = try JSONSerialization.data(withJSONObject: ["repoRoot": configuredRoot.path])
        try config.write(to: configURL)

        let configured = OwnerReviewDatabaseLocator(
            configURL: configURL,
            environment: [:]
        )
        #expect(configured.resolve() == configuredDatabase.standardizedFileURL)

        let environment = OwnerReviewDatabaseLocator(
            configURL: configURL,
            environment: ["PBE_REPO_ROOT": environmentRoot.path]
        )
        #expect(environment.resolve() == environmentDatabase.standardizedFileURL)
        #expect(environment.resolve()?.path.contains("assets/owner-actions/Owner.sqlite") == true)
    }

    @Test("Credential session round trips and clears device-only state")
    func credentialSessionRoundTrip() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        let credentials = OwnerCredentialSet(
            deviceId: "max-native",
            deviceCredential: "one-time-device-secret",
            accessToken: "short-lived",
            accessExpiresAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
        try await session.save(credentials)
        #expect(try await session.load() == credentials)
        try await session.clear()
        #expect(try await session.load() == nil)
    }

    @Test("Corrupted credential storage returns to enrollment")
    func corruptedCredentialStorageRequiresEnrollment() async throws {
        let vault = MemoryCredentialVault()
        try vault.write(Data("not-owner-credentials".utf8), account: OwnerCredentialSession.account)
        let session = OwnerCredentialSession(vault: vault)
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: RoutingTransport(responses: [:])
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        let snapshot = await service.bootstrap()
        #expect(snapshot.phase == .needsEnrollment)
        #expect(try vault.read(account: OwnerCredentialSession.account) == nil)
    }

    @Test("Temporary Keychain read failure retains the renewal path")
    func credentialReadFailureRetainsRenewalPath() async {
        let vault = ControlledFailureCredentialVault(failReads: true)
        let service = OwnerAuthenticationService(
            api: OwnerAPIClient(
                baseURL: URL(string: "https://example.test/api/v1")!,
                transport: RoutingTransport(responses: [:])
            ),
            session: OwnerCredentialSession(vault: vault)
        )

        #expect(await service.bootstrap().phase == .renewalFailed)
        #expect(await service.currentSnapshot().phase == .renewalFailed)
    }

    @Test("Token-only storage cannot bypass device enrollment")
    func tokenWithoutDeviceCredentialRequiresEnrollment() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        try await session.save(OwnerCredentialSet(
            deviceId: "owner-device-incomplete",
            deviceCredential: nil,
            accessToken: "unexpired-but-unbound",
            accessExpiresAt: Date(timeIntervalSince1970: 1_900_000_000)
        ))
        let transport = SequencedRoutingTransport(responses: [
            "/api/v1/actions": [
                .init(status: 200, body: """
                {"actions":[],"page":{"hasMore":false}}
                """),
            ],
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        let snapshot = await service.bootstrap(now: Date(timeIntervalSince1970: 1_800_000_000))
        #expect(snapshot.phase == .needsEnrollment)
        _ = try await client.listActions()
        let requests = await transport.requests()
        #expect(requests.last?.value(forHTTPHeaderField: "Authorization") == nil)
        let saved = try #require(try await session.load())
        #expect(saved.accessToken == nil)
        #expect(saved.accessExpiresAt == nil)
    }

    @Test("One-time enrollment stores the device credential and a short-lived access token")
    func credentialEnrollment() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        let transport = RoutingTransport(responses: [
            "/api/v1/auth/tokens": """
            {
              "tokenType":"Bearer",
              "accessToken":"access-one",
              "expiresIn":900,
              "accessExpiresAt":"2026-07-25T10:15:00.000Z"
            }
            """,
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)
        let enrollment = OwnerEnrollmentCode(
            deviceId: "owner-device-max",
            deviceCredential: String(repeating: "s", count: 48)
        )
        let encoded = try JSONEncoder.ownerAPI.encode(enrollment)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        let snapshot = try await service.enroll(code: encoded)
        #expect(snapshot.phase == .authenticated)
        #expect(snapshot.deviceId == "owner-device-max")
        let saved = try #require(try await session.load())
        #expect(saved.deviceCredential == String(repeating: "s", count: 48))
        #expect(saved.accessToken == "access-one")
        let request = try #require(await transport.requests().first)
        #expect(request.url?.path == "/api/v1/auth/tokens")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test("Owner API dates accept production fractional seconds and explicit timezone variants")
    func ownerAPIDateVariants() throws {
        struct Envelope: Decodable { let accessExpiresAt: Date }

        let values: [(String, TimeInterval)] = [
            ("2026-07-25T10:15:00.000Z", 1_784_974_500),
            ("2026-07-25T10:15:00Z", 1_784_974_500),
            ("2026-07-25T12:15:00.125+02:00", 1_784_974_500.125),
            ("2026-07-25T12:15:00+02:00", 1_784_974_500),
        ]
        for (value, expectedTimestamp) in values {
            let data = Data(#"{"accessExpiresAt":"\#(value)"}"#.utf8)
            let decoded = try JSONDecoder.ownerAPI.decode(Envelope.self, from: data)
            #expect(abs(decoded.accessExpiresAt.timeIntervalSince1970 - expectedTimestamp) < 0.000_001)
        }
    }

    @Test("Native enrollment keeps the claim secret off the browser URL and stores only a completed credential")
    func nativeEnrollmentHandoff() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        let transport = SequencedRoutingTransport(responses: [
            "/api/v1/enrollment-handoffs": [
                .init(status: 201, body: """
                {
                  "ok":true,
                  "handoff":{
                    "id":"owner-enrollment-one",
                    "state":"pending",
                    "claimSecret":"native-claim-secret",
                    "binding":"native-binding",
                    "authorizationURL":"https://auth.example.test/api/owner/enrollment-handoffs/owner-enrollment-one/authorize",
                    "expiresAt":"2030-03-17T17:46:40Z"
                  }
                }
                """),
            ],
            "/api/v1/enrollment-handoffs/owner-enrollment-one/claim": [
                .init(status: 202, body: #"{"ok":true,"state":"pending"}"#),
                .init(status: 201, body: """
                {
                  "ok":true,
                  "state":"completed",
                  "device":{
                    "id":"owner-device-native",
                    "name":"Max",
                    "platform":"macOS",
                    "createdAt":"2026-08-28T08:00:00Z"
                  },
                  "deviceCredential":"native-device-credential-0123456789012345678901234567890123456789"
                }
                """),
            ],
            "/api/v1/auth/tokens": [
                .init(status: 201, body: """
                {
                  "tokenType":"Bearer",
                  "accessToken":"native-access",
                  "expiresIn":900,
                  "accessExpiresAt":"2030-03-17T17:46:40Z"
                }
                """),
            ],
            "/api/v1/devices": [
                .init(status: 200, body: """
                {
                  "ok":true,
                  "devices":[{
                    "id":"owner-device-native",
                    "name":"Max",
                    "platform":"macOS",
                    "createdAt":"2026-08-28T08:00:00Z",
                    "lastUsedAt":"",
                    "revokedAt":""
                  }]
                }
                """),
            ],
            "/api/v1/devices/owner-device-native/revoke": [
                .init(status: 200, body: """
                {
                  "ok":true,
                  "device":{
                    "id":"owner-device-native",
                    "name":"Max",
                    "platform":"macOS",
                    "createdAt":"2026-08-28T08:00:00Z",
                    "revokedAt":"2026-08-28T08:05:00Z"
                  }
                }
                """),
            ],
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        let handoff = try await service.beginNativeEnrollment(
            name: "Max",
            binding: "native-binding"
        )
        #expect(handoff.authorizationURL.query == nil)
        #expect(handoff.authorizationURL.absoluteString.contains(handoff.claimSecret) == false)
        #expect(try await session.load() == nil)
        #expect(try await service.claimNativeEnrollment(handoff) == nil)
        #expect(try await session.load() == nil)

        let snapshot = try #require(try await service.claimNativeEnrollment(handoff))
        #expect(snapshot.phase == .authenticated)
        #expect(snapshot.deviceId == "owner-device-native")
        let saved = try #require(try await session.load())
        #expect(saved.deviceCredential?.hasPrefix("native-device-credential-") == true)
        #expect(saved.accessToken == "native-access")
        let devices = try await client.listOwnerDevices()
        #expect(devices.map(\.name) == ["Max"])
        #expect(devices.first?.lastUsedAt == nil)
        #expect(devices.first?.revokedAt == nil)
        #expect(try await client.revokeOwnerDevice(id: "owner-device-native").revokedAt != nil)
        let requests = await transport.requests()
        #expect(requests.map(\.url?.path) == [
            "/api/v1/enrollment-handoffs",
            "/api/v1/enrollment-handoffs/owner-enrollment-one/claim",
            "/api/v1/enrollment-handoffs/owner-enrollment-one/claim",
            "/api/v1/auth/tokens",
            "/api/v1/devices",
            "/api/v1/devices/owner-device-native/revoke",
        ])
        #expect(requests.prefix(4).allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == nil })
        #expect(requests.suffix(2).allSatisfy {
            $0.value(forHTTPHeaderField: "Authorization") == "Bearer native-access"
        })
    }

    @Test("Owner API dates reject malformed or timezone-free values")
    func ownerAPIDateVariantsFailClosed() throws {
        struct Envelope: Decodable { let accessExpiresAt: Date }

        for value in ["2026-07-25 10:15:00Z", "2026-07-25T10:15:00", "not-a-date"] {
            let data = Data(#"{"accessExpiresAt":"\#(value)"}"#.utf8)
            #expect(throws: DecodingError.self) {
                try JSONDecoder.ownerAPI.decode(Envelope.self, from: data)
            }
        }
    }

    @Test("Launch bootstrap re-authenticates the Keychain device credential")
    func credentialBootstrapRefresh() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        try await session.save(OwnerCredentialSet(
            deviceId: "owner-device-max",
            deviceCredential: String(repeating: "d", count: 48),
            accessToken: "expired-access",
            accessExpiresAt: Date(timeIntervalSince1970: 1_700_000_000)
        ))
        let transport = RoutingTransport(responses: [
            "/api/v1/auth/tokens": """
            {
              "tokenType":"Bearer",
              "accessToken":"access-two",
              "expiresIn":900,
              "accessExpiresAt":"2026-07-25T10:15:00Z"
            }
            """,
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        let snapshot = await service.bootstrap(now: Date(timeIntervalSince1970: 1_800_000_000))
        #expect(snapshot.phase == .authenticated)
        let saved = try #require(try await session.load())
        #expect(saved.accessToken == "access-two")
        #expect(await transport.requests().map(\.url?.path) == ["/api/v1/auth/tokens"])
    }

    @Test("Transient renewal failure retains enrollment for retry")
    func credentialBootstrapRetainsEnrollmentAfterTransientFailure() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        let deviceCredential = String(repeating: "d", count: 48)
        try await session.save(OwnerCredentialSet(
            deviceId: "owner-device-max",
            deviceCredential: deviceCredential,
            accessToken: "expired-access",
            accessExpiresAt: Date(timeIntervalSince1970: 1_700_000_000)
        ))
        let transport = SequencedRoutingTransport(responses: [
            "/api/v1/auth/tokens": [
                .init(status: 503, body: """
                {"error":{"code":"owner_token_auth_unavailable","message":"Native Owner token issuance is not configured."}}
                """),
            ],
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        let snapshot = await service.bootstrap(now: Date(timeIntervalSince1970: 1_800_000_000))
        #expect(snapshot.phase == .renewalFailed)
        #expect(snapshot.deviceId == "owner-device-max")
        let saved = try #require(try await session.load())
        #expect(saved.deviceCredential == deviceCredential)
        #expect(saved.accessToken == nil)
        #expect(saved.accessExpiresAt == nil)
        #expect(await service.currentSnapshot().phase == .renewalFailed)
    }

    @Test("Network renewal failure retains enrollment for retry")
    func credentialBootstrapRetainsEnrollmentAfterNetworkFailure() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        let deviceCredential = String(repeating: "d", count: 48)
        try await session.save(OwnerCredentialSet(
            deviceId: "owner-device-max",
            deviceCredential: deviceCredential,
            accessToken: nil,
            accessExpiresAt: nil
        ))
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: RoutingTransport(responses: [:])
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        let snapshot = await service.bootstrap()
        #expect(snapshot.phase == .renewalFailed)
        let saved = try #require(try await session.load())
        #expect(saved.deviceCredential == deviceCredential)
        #expect(saved.accessToken == nil)
    }

    @Test("Retained enrollment authenticates on a later retry")
    func credentialBootstrapRetrySucceeds() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        let deviceCredential = String(repeating: "d", count: 48)
        try await session.save(OwnerCredentialSet(
            deviceId: "owner-device-max",
            deviceCredential: deviceCredential,
            accessToken: nil,
            accessExpiresAt: nil
        ))
        let transport = SequencedRoutingTransport(responses: [
            "/api/v1/auth/tokens": [
                .init(status: 503, body: """
                {"error":{"code":"owner_token_auth_unavailable","message":"Try again later."}}
                """),
                .init(status: 201, body: """
                {
                  "tokenType":"Bearer",
                  "accessToken":"access-after-retry",
                  "expiresIn":900,
                  "accessExpiresAt":"2030-03-17T17:46:40Z"
                }
                """),
            ],
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        #expect(await service.bootstrap().phase == .renewalFailed)
        let retried = await service.bootstrap()
        #expect(retried.phase == .authenticated)
        let saved = try #require(try await session.load())
        #expect(saved.deviceCredential == deviceCredential)
        #expect(saved.accessToken == "access-after-retry")
        #expect(await transport.requests().map(\.url?.path) == [
            "/api/v1/auth/tokens",
            "/api/v1/auth/tokens",
        ])
    }

    @Test("Rejected device credential requires fresh enrollment")
    func credentialBootstrapRejectsInvalidEnrollment() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        try await session.save(OwnerCredentialSet(
            deviceId: "owner-device-revoked",
            deviceCredential: String(repeating: "r", count: 48),
            accessToken: "expired-access",
            accessExpiresAt: Date(timeIntervalSince1970: 1_700_000_000)
        ))
        let transport = SequencedRoutingTransport(responses: [
            "/api/v1/auth/tokens": [
                .init(status: 401, body: """
                {"error":{"code":"owner_device_credential_invalid","message":"The Backstage device credential is invalid or revoked."}}
                """),
            ],
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        let snapshot = await service.bootstrap(now: Date(timeIntervalSince1970: 1_800_000_000))
        #expect(snapshot.phase == .needsEnrollment)
        #expect(snapshot.deviceId == "owner-device-revoked")
        let saved = try #require(try await session.load())
        #expect(saved.deviceCredential == nil)
        #expect(saved.accessToken == nil)
        #expect(saved.accessExpiresAt == nil)
        #expect(await service.currentSnapshot().phase == .needsEnrollment)
    }

    @Test("Failed credential persistence never authenticates an issued token")
    func credentialPersistenceFailureFailsClosed() async throws {
        let original = OwnerCredentialSet(
            deviceId: "owner-device-max",
            deviceCredential: String(repeating: "d", count: 48),
            accessToken: "expired-access",
            accessExpiresAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let stored = try JSONEncoder.ownerAPI.encode(original)
        let vault = ControlledFailureCredentialVault(value: stored, failWrites: true)
        let session = OwnerCredentialSession(vault: vault)
        let transport = SequencedRoutingTransport(responses: [
            "/api/v1/auth/tokens": [
                .init(status: 201, body: """
                {
                  "tokenType":"Bearer",
                  "accessToken":"must-not-be-used",
                  "expiresIn":900,
                  "accessExpiresAt":"2030-03-17T17:46:40Z"
                }
                """),
            ],
            "/api/v1/actions": [
                .init(status: 200, body: """
                {"actions":[],"page":{"hasMore":false}}
                """),
            ],
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        #expect(
            await service.bootstrap(now: Date(timeIntervalSince1970: 1_800_000_000)).phase
                == .renewalFailed
        )
        #expect(await service.currentSnapshot().phase == .renewalFailed)
        _ = try await client.listActions()
        let requests = await transport.requests()
        #expect(requests.last?.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(vault.value() == stored)
    }

    @Test("Rejected credential remains enrollment-required when persistence fails")
    func rejectedCredentialPersistenceFailureStillNeedsEnrollment() async throws {
        let original = OwnerCredentialSet(
            deviceId: "owner-device-revoked",
            deviceCredential: String(repeating: "r", count: 48),
            accessToken: nil,
            accessExpiresAt: nil
        )
        let vault = ControlledFailureCredentialVault(
            value: try JSONEncoder.ownerAPI.encode(original),
            failWrites: true
        )
        let session = OwnerCredentialSession(vault: vault)
        let transport = SequencedRoutingTransport(responses: [
            "/api/v1/auth/tokens": [
                .init(status: 401, body: """
                {"error":{"code":"owner_device_credential_invalid","message":"The Backstage device credential is invalid or revoked."}}
                """),
            ],
        ])
        let service = OwnerAuthenticationService(
            api: OwnerAPIClient(
                baseURL: URL(string: "https://example.test/api/v1")!,
                transport: transport
            ),
            session: session
        )

        #expect(await service.bootstrap().phase == .needsEnrollment)
        #expect(await service.currentSnapshot().phase == .needsEnrollment)
    }

    @Test("Expired native access recovers once and retries the original request")
    func credentialRequestRecovery() async throws {
        let vault = MemoryCredentialVault()
        let session = OwnerCredentialSession(vault: vault)
        try await session.save(OwnerCredentialSet(
            deviceId: "owner-device-max",
            deviceCredential: String(repeating: "d", count: 48),
            accessToken: "access-one",
            accessExpiresAt: Date(timeIntervalSince1970: 1_900_000_000)
        ))
        let transport = SequencedRoutingTransport(responses: [
            "/api/v1/actions": [
                .init(status: 401, body: """
                {"error":{"code":"google_login_required","message":"Google login has expired."}}
                """),
                .init(status: 200, body: """
                {"actions":[],"page":{"hasMore":false}}
                """),
            ],
            "/api/v1/auth/tokens": [
                .init(status: 200, body: """
                {
                  "tokenType":"Bearer",
                  "accessToken":"access-two",
                  "expiresIn":900,
                  "accessExpiresAt":"2030-03-17T17:46:40Z"
                }
                """),
            ],
        ])
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = OwnerAuthenticationService(api: client, session: session)

        #expect(await service.bootstrap(now: Date(timeIntervalSince1970: 1_800_000_000)).phase == .authenticated)
        let page = try await client.listActions()
        #expect(page.actions.isEmpty)

        let requests = await transport.requests()
        #expect(requests.map(\.url?.path) == [
            "/api/v1/actions",
            "/api/v1/auth/tokens",
            "/api/v1/actions",
        ])
        #expect(requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer access-one")
        #expect(requests[1].value(forHTTPHeaderField: "Authorization") == nil)
        #expect(requests[2].value(forHTTPHeaderField: "Authorization") == "Bearer access-two")
        let saved = try #require(try await session.load())
        #expect(saved.accessToken == "access-two")
    }

    @Test("Metadata give-back uses Worker action, dry-run gate, and verified receipts")
    func metadataGiveBackDryRun() async throws {
        let completed = OwnerAction(
            id: "owner-action-1",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "photosWriteback": [
                    "mode": "dry-run",
                    "count": 2,
                    "blockedCount": 1,
                    "items": [],
                    "blocked": [[
                        "fixtureId": "fixture-family",
                        "assetId": "asset-3",
                        "reason": "same-version R2 delivery is not verified",
                    ]],
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [completed])
        let runner = OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        )
        let service = MetadataGiveBackService(runner: runner)

        let report = try await service.plan(
            fixtureID: "fixture-family",
            assetIDs: ["asset-b", " asset-a ", "asset-b"]
        )

        #expect(report.isDryRun)
        #expect(report.fixtureID == "fixture-family")
        #expect(report.readyCount == 2)
        #expect(report.blocked.map(\.assetID) == ["asset-3"])
        let request = try #require(await api.requests().first)
        #expect(request.actionKind == "sidecar-culling-review")
        #expect(request.target == "max")
        #expect(request.payload["requestedConnector"]?.stringValue == "max")
        #expect(
            request.payload["manifest"]?.objectValue?["mode"]?.stringValue
                == "fixture-photos-writeback-plan"
        )
        #expect(
            request.payload["manifest"]?.objectValue?["includePreviews"]?.boolValue
                == false
        )
        #expect(
            request.payload["manifest"]?.objectValue?["fixtureId"]?.stringValue
                == "fixture-family"
        )
        #expect(
            request.payload["manifest"]?.objectValue?["assetIds"]?.arrayValue?.compactMap(\.stringValue)
                == ["asset-a", "asset-b"]
        )
        let idempotencyKey = try #require(await api.idempotencyKeys().first)
        #expect(idempotencyKey.count >= 8)
        #expect(idempotencyKey.count <= 160)
        #expect(idempotencyKey.unicodeScalars.allSatisfy { (0x21...0x7e).contains($0.value) })
    }

    @Test("Metadata give-back retries only independently failed asset IDs")
    func metadataGiveBackRetriesFailuresOnly() async throws {
        let first = OwnerAction(
            id: "owner-action-1",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "photosWriteback": [
                    "mode": "commit",
                    "writtenCount": 1,
                    "failedCount": 1,
                    "written": [[
                        "assetId": "asset-ok",
                        "fixtureIds": ["fixture-family"],
                        "checksumSha256": "abc123",
                    ]],
                    "failed": [[
                        "assetId": "asset-retry",
                        "error": "Photos verification failed",
                    ]],
                    "blocked": [],
                ],
            ]
        )
        let second = OwnerAction(
            id: "owner-action-2",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "photosWriteback": [
                    "mode": "commit",
                    "writtenCount": 1,
                    "failedCount": 0,
                    "written": [[
                        "assetId": "asset-retry",
                        "fixtureIds": ["fixture-family"],
                        "checksumSha256": "def456",
                    ]],
                    "failed": [],
                    "blocked": [],
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [first, second])
        let runner = OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        )
        let service = MetadataGiveBackService(runner: runner)

        let initial = try await service.commit(fixtureID: "fixture-family")
        #expect(initial.fixtureID == "fixture-family")
        #expect(initial.verifiedCount == 1)
        #expect(initial.failedAssetIDs == ["asset-retry"])
        let retried = try await service.retryFailures(
            from: initial,
            fixtureID: "fixture-family"
        )
        #expect(retried.verifiedCount == 1)
        #expect(retried.failed.isEmpty)

        do {
            _ = try await service.retryFailures(
                from: initial,
                fixtureID: "fixture-other"
            )
            Issue.record("Expected a fixture-bound retry failure")
        } catch let error as MetadataGiveBackError {
            #expect(error == .fixtureMismatch)
        }

        let requests = await api.requests()
        #expect(requests.count == 2)
        let retryManifest = requests[1].payload["manifest"]?.objectValue
        #expect(
            retryManifest?["assetIds"]?.arrayValue?.compactMap(\.stringValue)
                == ["asset-retry"]
        )
    }

    @Test("Native ACS saves normalized people with inherited groups")
    func nativeAccessControlSave() async throws {
        let transport = RecordingTransport(response: """
        {"user":{"email":"avery@example.test","displayName":"Avery","roles":["user"],"groupIds":["family"]}}
        """)
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = AccessControlService(api: client)

        let saved = try await service.save(person: AccessPerson(
            email: "AVERY@EXAMPLE.TEST",
            displayName: "Avery",
            groupIds: ["family"]
        ))

        #expect(saved.email == "avery@example.test")
        #expect(saved.groupIds == ["family"])
        let request = try #require(await transport.lastRequest())
        #expect(request.url?.path == "/api/v1/acs/people")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key")?.hasPrefix("person-avery@example.test-") == true)
    }

    @Test("Native ACS accepts structured role and capability catalogs")
    func nativeAccessControlLoadStructuredOptions() async throws {
        let transport = RecordingTransport(response: """
        {
          "people":[{"email":"avery@example.test","displayName":"Avery","roles":["user"],"groupIds":["family"]}],
          "audienceGroups":[{"id":"family","label":"Family","kind":"family","capabilities":["view_gallery"]}],
          "roles":[{"id":"user","label":"User","capabilities":["view_public"]}],
          "capabilities":[{"id":"manage_access","label":"Manage access"}],
          "fixtureEvents":[],
          "auditEvents":[]
        }
        """)
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let state = try await AccessControlService(api: client).load()

        #expect(state.allPeople.map(\.email) == ["avery@example.test"])
        #expect(state.allGroups.map(\.id) == ["family"])
        #expect(state.roles?.first?.objectValue?["id"]?.stringValue == "user")
        #expect(state.capabilities?.first?.objectValue?["id"]?.stringValue == "manage_access")
    }

    @Test("Native fixture creation stays behind an opaque audited action")
    func nativeFixtureCreation() async throws {
        let terminal = OwnerAction(
            id: "owner-action-fixture",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "fixtures": [[
                    "fixtureId": "fixture-family",
                    "name": "Family",
                    "state": "active",
                    "children": [[
                        "fixtureId": "fixture-blood",
                        "name": "Blood",
                        "parentFixtureId": "fixture-family",
                        "state": "active",
                        "children": [],
                    ]],
                ]],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let tree = try await service.create(
            name: "Blood",
            parentID: "fixture-family",
            templateKey: "family"
        )

        #expect(tree.flatMap(\.flattened).map(\.id) == ["fixture-family", "fixture-blood"])
        let request = try #require(await api.requests().first)
        #expect(request.actionKind == "sidecar-culling-review")
        #expect(request.target == "max")
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-create")
        #expect(manifest?["parentFixtureId"]?.stringValue == "fixture-family")
        #expect(manifest?["destinationDefaults"]?.arrayValue?.compactMap(\.stringValue) == ["r2", "apple_photos"])
    }

    @Test("Native fixture work targets the enrolled local connector")
    func nativeFixtureUsesLocalConnectorIdentity() async throws {
        let terminal = OwnerAction(
            id: "owner-action-local-fixture-tree",
            actionKind: "sidecar-culling-review",
            target: "david",
            state: .completed,
            result: ["fixtures": []]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: api,
                waker: UnavailableWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            connectorIdentity: StaticOwnerConnectorIdentity("David")
        )

        _ = try await service.tree()

        let request = try #require(await api.requests().first)
        #expect(request.target == "david")
        #expect(request.payload["requestedConnector"]?.stringValue == "david")
        #expect(request.payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-tree-list")
    }

    @Test("Fixture tree uses a bounded refresh timeout without changing shared action timeout")
    func nativeFixtureTreeUsesBoundedRefreshTimeout() async throws {
        let service = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: PendingOwnerActionAPI(),
                waker: UnavailableWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            fixtureTreeTimeout: .milliseconds(20)
        )

        do {
            _ = try await service.tree()
            Issue.record("Expected the fixture tree refresh to time out")
        } catch let error as OwnerActionRunError {
            #expect(error == .timedOut)
        }
    }

    @Test("Fixture tree timeout cancels a delayed local wake")
    func nativeFixtureTreeCancelsDelayedWake() async throws {
        let service = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: PendingOwnerActionAPI(),
                waker: DelayedWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            fixtureTreeTimeout: .milliseconds(20)
        )

        do {
            _ = try await service.tree()
            Issue.record("Expected the delayed fixture-tree wake to time out")
        } catch let error as OwnerActionRunError {
            #expect(error == .timedOut)
        }
    }

    @Test("Native fixture state migration remains an explicit audited action")
    func nativeFixtureStateMigrationPlan() async throws {
        let terminal = OwnerAction(
            id: "owner-action-fixture-migration-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "migration": .object([
                    "migrationId": "fixture-state-v1",
                    "mode": "dry-run",
                    "plannedDecisionInsertCount": 42,
                    "plannedPickedCount": 30,
                    "plannedHiddenCount": 12,
                    "explicitPlacementCount": 7,
                    "ancestorClosureCount": 11,
                    "applied": false,
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let report = try await service.fixtureStateMigrationPlan()

        #expect(report.migrationID == "fixture-state-v1")
        #expect(report.mode == "dry-run")
        #expect(report.plannedDecisionInsertCount == 42)
        #expect(report.plannedPickedCount == 30)
        #expect(report.plannedHiddenCount == 12)
        #expect(!report.applied)
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-state-migration-plan")
    }

    @Test("Native fixture policy editor persists independent dimensions")
    func nativeFixturePolicyConfiguration() async throws {
        let terminal = OwnerAction(
            id: "owner-action-fixture-policy",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "configuration": .object([
                    "fixtureId": "fixture-expo",
                    "populationMode": "rule-based",
                    "candidateSource": ["kind": "photos-library"],
                    "savedRule": ["query": "Paris"],
                    "templateKey": "expo",
                    "policy": [
                        "configured": [
                            "visibility": "public",
                            "searchable": true,
                            "retention": "public-preview",
                            "delivery": "public",
                            "download": false,
                            "commerce": "retail",
                        ],
                        "effective": [
                            "visibility": "public",
                            "searchable": true,
                            "retention": "public-preview",
                            "delivery": "public",
                            "download": false,
                            "commerce": "retail",
                        ],
                        "revision": 3,
                    ],
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let configuration = try await service.configure(
            fixtureID: "fixture-expo",
            populationMode: "rule-based",
            candidateSource: ["kind": "photos-library"],
            savedRule: ["query": "Paris"],
            policy: FixturePolicyOverrides(
                visibility: "public",
                searchable: true,
                retention: "public-preview",
                delivery: "public",
                download: false,
                commerce: "retail"
            ),
            templateKey: "expo",
            reason: "test"
        )

        #expect(configuration.revision == 3)
        #expect(configuration.effectivePolicy.commerce == "retail")
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-configuration-set")
        #expect(manifest?["populationMode"]?.stringValue == "rule-based")
        #expect(manifest?["policyOverrides"]?.objectValue?["searchable"]?.boolValue == true)
    }

    @Test("Native fixture policy preserves inherited dimensions as unset overrides")
    func nativeFixturePolicyInheritance() async throws {
        let terminal = OwnerAction(
            id: "owner-action-fixture-policy-inheritance",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "configuration": .object([
                    "fixtureId": "fixture-child",
                    "policy": [
                        "configured": ["commerce": "free-sharing"],
                        "effective": [
                            "visibility": "private",
                            "searchable": false,
                            "retention": "private-master",
                            "delivery": "granted",
                            "download": true,
                            "commerce": "free-sharing",
                        ],
                        "revision": 4,
                    ],
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let configuration = try await service.configure(
            fixtureID: "fixture-child",
            populationMode: "parent-subset",
            candidateSource: ["kind": "parent-effective"],
            savedRule: [:],
            policy: FixturePolicyOverrides(commerce: "free-sharing"),
            templateKey: "",
            reason: "test inheritance"
        )

        #expect(configuration.configuredPolicy.visibility == nil)
        #expect(configuration.configuredPolicy.delivery == nil)
        #expect(configuration.configuredPolicy.commerce == "free-sharing")
        #expect(configuration.effectivePolicy.delivery == "granted")
        let request = try #require(await api.requests().first)
        let overrides = request.payload["manifest"]?.objectValue?["policyOverrides"]?.objectValue
        #expect(overrides?.count == 1)
        #expect(overrides?["commerce"]?.stringValue == "free-sharing")
    }

    @Test("Native fixture culling requests a bounded full-universe window")
    func nativeFixtureCullingWindow() async throws {
        let terminal = OwnerAction(
            id: "owner-action-fixture-culling-window",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "cullingWindow": .object([
                    "fixtureId": "fixture-expo",
                    "candidateMode": "photos-library",
                    "view": "undecided",
                    "offset": 0,
                    "limit": 200,
                    "nextOffset": 1,
                    "hasNext": true,
                    "summary": .object([
                        "filtered": 1140,
                        "universe": 3551,
                        "undecided": 1140,
                        "picked": 2200,
                        "hidden": 211,
                    ]),
                    "mediaAvailability": .object([
                        "photos": 3400,
                        "videos": 151,
                    ]),
                    "items": .array([.object([
                        "assetId": "asset-newest",
                        "photoLibraryIdentifier": "photos-newest",
                        "title": "Newest",
                        "filename": "NEWEST.HEIC",
                        "mediaType": "photo",
                        "capturedAt": "2026-07-26T12:00:00Z",
                        "pixelWidth": 6000,
                        "pixelHeight": 4000,
                        "resourceFormat": "HEIC",
                        "originalByteCount": 12_345_678,
                        "placementState": "undecided",
                        "eligibilityState": "active",
                        "rating": 4,
                        "color": "green",
                        "editorialState": "unreviewed",
                        "keywords": ["Madrid"],
                    ])]),
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let window = try await service.cullingWindow(
            fixtureID: "fixture-expo",
            view: .allActive,
            views: [.undecided, .picked],
            offset: 0,
            limit: 200,
            search: "Madrid",
            mediaTypes: ["photo"],
            ratings: [4],
            colors: ["green"]
        )

        #expect(window.fixtureID == "fixture-expo")
        #expect(window.summary.universe == 3551)
        #expect(window.summary.filtered == 1140)
        #expect(window.mediaAvailability?.photos == 3400)
        #expect(window.mediaAvailability?.videos == 151)
        #expect(window.availableMediaFilters == [.photos, .videos])
        #expect(window.items.map(\.id) == ["asset-newest"])
        #expect(window.items.first?.photoLibraryIdentifier == "photos-newest")
        #expect(window.items.first?.placementState == .undecided)
        #expect(window.items.first?.rating == 4)
        #expect(window.items.first?.pixelWidth == 6000)
        #expect(window.items.first?.pixelHeight == 4000)
        #expect(window.items.first?.resourceFormat == "HEIC")
        #expect(window.items.first?.originalByteCount == 12_345_678)
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-culling-window")
        #expect(manifest?["fixtureId"]?.stringValue == "fixture-expo")
        #expect(
            manifest?["views"]?.arrayValue?.compactMap(\.stringValue)
                == ["undecided", "picked"]
        )
        #expect(manifest?["limit"]?.intValue == 200)
        #expect(manifest?["search"]?.stringValue == "Madrid")
    }

    @Test("Native Photos reconciliation uses the enrolled connector and signed full index action")
    func nativePhotosIndexReconciliation() async throws {
        let terminal = OwnerAction(
            id: "owner-action-photos-index",
            actionKind: "sidecar-photos-index-sync",
            target: "david",
            state: .completed,
            result: [
                "job": .object([
                    "mode": "range",
                    "status": "done",
                    "stage": "Complete",
                    "indexedCount": 52_400,
                    "importedCount": 52_400,
                    "totalCount": 52_400,
                    "missingMarkedCount": 17,
                    "photosMediaItemCount": 57_000,
                    "photosImageCount": 55_000,
                    "photosVideoCount": 2_000,
                    "eligibleStillCount": 52_400,
                    "excludedStillCount": 2_600,
                    "excludedStillFormatCounts": .object(["RAW": .number(2_500)]),
                    "completedAt": "2026-07-28T12:00:00Z",
                    "discoveryCheckpoint": .object([
                        "captureDate": "2026-07-28T11:59:00Z",
                    ]),
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: api,
                waker: UnavailableWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            connectorIdentity: StaticOwnerConnectorIdentity("David")
        )

        let report = try await service.reconcilePhotosIndex(
            dateFrom: "2026-06-13T00:00:00Z",
            dateTo: "2026-07-29T00:00:00Z"
        )

        #expect(report.status == "done")
        #expect(report.mode == "range")
        #expect(report.checkpointCaptureDate == "2026-07-28T11:59:00Z")
        #expect(report.indexedCount == 52_400)
        #expect(report.importedCount == 52_400)
        #expect(report.totalCount == 52_400)
        #expect(report.missingMarkedCount == 17)
        #expect(report.photosMediaItemCount == 57_000)
        #expect(report.photosVideoCount == 2_000)
        #expect(report.eligibleStillCount == 52_400)
        #expect(report.excludedStillFormatCounts["RAW"] == 2_500)
        let request = try #require(await api.requests().first)
        #expect(request.actionKind == "sidecar-photos-index-sync")
        #expect(request.target == "david")
        #expect(request.payload["requestedConnector"]?.stringValue == "david")
        #expect(request.payload["queuedAt"]?.stringValue?.isEmpty == false)
        #expect(request.payload["dateFrom"]?.stringValue == "2026-06-13T00:00:00Z")
        #expect(request.payload["dateTo"]?.stringValue == "2026-07-29T00:00:00Z")
        #expect(request.payload["mode"]?.stringValue == "range")
        #expect(request.payload["manifest"] == nil)
    }

    @Test("Native Photos reconciliation defaults to incremental and full audit is explicit")
    func nativePhotosIndexReconciliationModes() async throws {
        let incrementalTerminal = OwnerAction(
            id: "owner-action-photos-incremental",
            actionKind: "sidecar-photos-index-sync",
            target: "david",
            state: .completed,
            result: ["job": .object(["status": "done", "mode": "incremental"])]
        )
        let incrementalAPI = ScriptedOwnerActionAPI(completed: [incrementalTerminal])
        let incrementalService = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: incrementalAPI,
                waker: UnavailableWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            connectorIdentity: StaticOwnerConnectorIdentity("David")
        )

        _ = try await incrementalService.reconcilePhotosIndex()
        let incrementalRequest = try #require(await incrementalAPI.requests().first)
        #expect(incrementalRequest.payload["mode"]?.stringValue == "incremental")
        #expect(incrementalRequest.payload["fullLibrary"] == nil)
        #expect(incrementalRequest.payload["dateFrom"] == nil)

        let fullTerminal = OwnerAction(
            id: "owner-action-photos-full",
            actionKind: "sidecar-photos-index-sync",
            target: "david",
            state: .completed,
            result: ["job": .object(["status": "done", "mode": "full"])]
        )
        let fullAPI = ScriptedOwnerActionAPI(completed: [fullTerminal])
        let fullService = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: fullAPI,
                waker: UnavailableWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            connectorIdentity: StaticOwnerConnectorIdentity("David")
        )

        _ = try await fullService.reconcilePhotosIndex(fullLibrary: true)
        let fullRequest = try #require(await fullAPI.requests().first)
        #expect(fullRequest.payload["mode"]?.stringValue == "full")
        #expect(fullRequest.payload["fullLibrary"]?.boolValue == true)
        #expect(fullRequest.payload["dateFrom"] == nil)
    }

    @Test("Fixture culling keeps H fixture-local and X globally scoped")
    func fixtureCullingActionSemantics() {
        #expect(
            FixtureCullingSemantics.mutation(
                for: .exclude,
                currentFixtureID: ""
            ) == .unavailable
        )
        #expect(
            FixtureCullingSemantics.mutation(
                for: .exclude,
                currentFixtureID: "fixture-root"
            ) == .fixtureState(.hidden)
        )
        #expect(
            FixtureCullingSemantics.mutation(
                for: .exclude,
                currentFixtureID: "fixture-child"
            ) == .fixtureState(.hidden)
        )
        #expect(
            FixtureCullingSemantics.mutation(
                for: .include,
                currentFixtureID: "fixture-child"
            ) == .fixtureState(.picked)
        )
        #expect(
            FixtureCullingSemantics.mutation(
                for: .clear,
                currentFixtureID: "fixture-child"
            ) == .fixtureState(.undecided)
        )
        #expect(
            FixtureCullingSemantics.mutation(
                for: .tombstone,
                currentFixtureID: ""
            ) == .globalTombstone
        )
    }

    @Test("Native fixture Review is chronological and actions stay connector-audited")
    func nativeFixtureReviewWorkflow() async throws {
        let windowAction = OwnerAction(
            id: "owner-action-fixture-review-window",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "reviewWindow": .object([
                    "fixtureId": "fixture-expo",
                    "mode": "full",
                    "offset": 0,
                    "limit": 200,
                    "nextOffset": 1,
                    "hasNext": true,
                    "summary": .object([
                        "total": 420,
                        "unreviewed": 300,
                        "requestingAI": 100,
                        "proposed": 20,
                        "approved": 80,
                    ]),
                    "items": .array([.object([
                        "assetId": "asset-oldest",
                        "photoLibraryIdentifier": "photos-oldest",
                        "title": "Oldest",
                        "caption": "",
                        "keywords": ["Paris"],
                        "filename": "OLDEST.HEIC",
                        "mediaType": "photo",
                        "capturedAt": "2025-01-01T12:00:00Z",
                        "rating": 3,
                        "color": "yellow",
                        "placementState": "picked",
                        "editorialState": "requesting-ai",
                        "aiReasons": ["weak title"],
                        "aiNote": "Name the landmark.",
                        "aiAttemptCount": 1,
                        "aiLastError": "",
                        "proposalReady": true,
                        "proposalContextAvailable": true,
                        "proposalId": "proposal-oldest",
                        "proposedTitle": "A better title",
                        "proposedKeywords": ["Paris", "France"],
                        "proposalReason": "Improve title",
                        "proposalStatus": "ready",
                        "requestedGeneratorModel": "codex-gpt-5.6-luna-max-vision",
                        "resolvedModel": "gpt-5.6-luna",
                        "reasoningEffort": "max",
                        "vision": true,
                        "modelLadder": [
                            "codex-gpt-5.4-mini",
                            "codex-gpt-5.6-luna-max-vision",
                            "codex-gpt-5.6-sol-high-vision",
                        ],
                        "deliveryState": "not-ready",
                    ])]),
                ]),
            ]
        )
        let applyAction = OwnerAction(
            id: "owner-action-fixture-review-apply",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "reviewAction": .object([
                    "operationId": "reviewop-test",
                    "fixtureId": "fixture-expo",
                    "action": "request-ai",
                    "anchorAssetId": "asset-oldest",
                    "propagated": true,
                    "timing": .object([
                        "localTransaction": .object(["durationMs": 2.0]),
                    ]),
                    "items": .array([.object([
                        "assetId": "asset-oldest",
                        "before": .object(["editorialState": "unreviewed"]),
                        "after": .object(["editorialState": "requesting-ai"]),
                    ])]),
                ]),
            ]
        )
        let undoAction = OwnerAction(
            id: "owner-action-fixture-review-undo",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "reviewUndo": .object([
                    "operationId": "reviewop-test",
                    "fixtureId": "fixture-expo",
                    "action": "request-ai",
                    "alreadyUndone": false,
                    "timing": .object([
                        "localTransaction": .object(["durationMs": 3.0]),
                    ]),
                    "items": .array([.object([
                        "assetId": "asset-oldest",
                        "before": .object(["editorialState": "requesting-ai"]),
                        "after": .object(["editorialState": "unreviewed"]),
                        "review": .object([
                            "placementState": "picked",
                            "editorialState": "unreviewed",
                            "proposalReady": false,
                        ]),
                    ])]),
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [windowAction, applyAction, undoAction])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let window = try await service.reviewWindow(
            fixtureID: "fixture-expo",
            mode: .full,
            stateFilters: ["approved", "hidden", "picked"],
            proposalAvailableOnly: true,
            mediaFilters: ["photos"],
            limit: 200
        )
        #expect(window.mode == .full)
        #expect(window.summary.total == 420)
        #expect(window.summary.approved == 80)
        #expect(window.items.first?.id == "asset-oldest")
        #expect(window.items.first?.placementState == "picked")
        #expect(window.items.first?.aiReasons == ["weak title"])
        #expect(window.items.first?.proposalReady == true)
        #expect(window.items.first?.proposalContextAvailable == true)
        #expect(window.items.first?.proposalID == "proposal-oldest")
        #expect(window.items.first?.proposedTitle == "A better title")
        #expect(window.items.first?.proposedKeywords == ["Paris", "France"])
        #expect(window.items.first?.proposalStatus == "ready")
        #expect(window.items.first?.requestedGeneratorModel == "codex-gpt-5.6-luna-max-vision")
        #expect(window.items.first?.resolvedModel == "gpt-5.6-luna")
        #expect(window.items.first?.reasoningEffort == "max")
        #expect(window.items.first?.vision == true)
        #expect(window.items.first?.modelLadder == [
            "codex-gpt-5.4-mini",
            "codex-gpt-5.6-luna-max-vision",
            "codex-gpt-5.6-sol-high-vision",
        ])

        let result = try await service.applyReview(
            .requestAI,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-oldest"],
            anchorAssetID: "asset-oldest",
            propagate: true,
            aiReasons: ["weak title"],
            aiNote: "Name the landmark."
        )
        #expect(result.action == .requestAI)
        #expect(result.operationID == "reviewop-test")
        #expect(result.propagated)
        #expect(result.changes.map(\.assetID) == ["asset-oldest"])
        #expect(result.timing["localTransaction"]?.objectValue?["durationMs"]?.intValue == 2)
        let undone = try await service.undoReview(operationID: result.operationID)
        #expect(undone.operationID == "reviewop-test")
        #expect(!undone.alreadyUndone)
        #expect(undone.changes.map(\.assetID) == ["asset-oldest"])
        #expect(undone.timing["localTransaction"]?.objectValue?["durationMs"]?.intValue == 3)
        #expect(undone.changes.first?.review["placementState"]?.stringValue == "picked")
        let requests = await api.requests()
        #expect(requests.count == 3)
        let reviewManifest = requests[0].payload["manifest"]?.objectValue
        #expect(reviewManifest?["mode"]?.stringValue == "fixture-review-window")
        #expect(reviewManifest?["reviewMode"]?.stringValue == "full")
        #expect(
            reviewManifest?["reviewStateFilters"]?.arrayValue?.compactMap(\.stringValue)
                == ["approved", "hidden", "picked"]
        )
        #expect(reviewManifest?["proposalAvailableOnly"]?.boolValue == true)
        #expect(
            reviewManifest?["mediaFilters"]?.arrayValue?.compactMap(\.stringValue)
                == ["photos"]
        )
        #expect(reviewManifest?["includePreviews"]?.boolValue == false)
        #expect(reviewManifest?["launchWorkspace"]?.boolValue == false)
        let applyManifest = requests[1].payload["manifest"]?.objectValue
        #expect(applyManifest?["mode"]?.stringValue == "fixture-review-apply")
        #expect(applyManifest?["reviewAction"]?.stringValue == "request-ai")
        #expect(applyManifest?["propagate"]?.boolValue == true)
        #expect(applyManifest?["includePreviews"]?.boolValue == false)
        #expect(applyManifest?["launchWorkspace"]?.boolValue == false)
        let undoManifest = requests[2].payload["manifest"]?.objectValue
        #expect(undoManifest?["mode"]?.stringValue == "fixture-review-undo")
        #expect(undoManifest?["operationId"]?.stringValue == "reviewop-test")
        #expect(undoManifest?["includePreviews"]?.boolValue == false)
        #expect(undoManifest?["launchWorkspace"]?.boolValue == false)
    }

    @Test("Native Review mutations use the local service without an Owner action")
    func nativeReviewMutationsUseLocalService() async throws {
        let api = ScriptedOwnerActionAPI(completed: [])
        let local = RecordingLocalFixtureReviewService()
        let service = FixtureWorkflowService(
            runner: OwnerActionRunner(
                api: api,
                waker: UnavailableWaker(),
                pollInterval: .milliseconds(1),
                timeout: .seconds(1)
            ),
            localReviewService: local
        )

        let applied = try await service.applyReview(
            .hide,
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1", "asset-2"],
            anchorAssetID: "asset-2"
        )
        let undone = try await service.undoReview(operationID: applied.operationID)

        #expect(applied.operationID == "reviewop-local")
        #expect(undone.operationID == "reviewop-local")
        #expect(await api.requests().isEmpty)
        let manifests = await local.applyManifests
        #expect(manifests.count == 1)
        #expect(manifests[0]["fixtureId"]?.stringValue == "fixture-expo")
        #expect(manifests[0]["assetIds"]?.arrayValue?.compactMap(\.stringValue) == ["asset-1", "asset-2"])
        #expect(manifests[0]["reviewAction"]?.stringValue == "hide")
        #expect(await local.undoOperationIDs == ["reviewop-local"])
    }

    @Test("Native requested AI proposals remain draft-only and connector-audited")
    func nativeRequestedAIProposalWorkflow() async throws {
        let statusAction = OwnerAction(
            id: "owner-action-fixture-ai-status",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "ai": .object([
                    "active": false,
                    "requested": 2,
                    "ready": 1,
                    "run": .object([
                        "runId": "airun-1",
                        "trigger": "scheduled",
                        "status": "completed-with-errors",
                        "requested": 2,
                        "processed": 2,
                        "proposed": 1,
                        "skipped": 0,
                        "failed": 1,
                        "remaining": 0,
                        "elapsedSeconds": 8.5,
                    ]),
                ]),
            ]
        )
        let proposalAction = OwnerAction(
            id: "owner-action-fixture-ai-proposals",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "aiProposals": .object([
                    "items": .array([.object([
                        "proposalId": "aip-1",
                        "status": "ready",
                        "assetId": "asset-1",
                        "runId": "airun-1",
                        "attempt": 1,
                        "canonicalTitle": "Manual title",
                        "canonicalKeywords": ["Paris"],
                        "proposedTitle": "Evening in Paris",
                        "proposedKeywords": ["Paris", "Evening"],
                        "confidence": "high",
                        "reason": "Visible city landmark.",
                        "needsOwnerContext": false,
                        "requestReasons": ["weak title"],
                        "requestNote": "Name the landmark.",
                        "requestedGeneratorModel": "codex-gpt-5.6-luna-max-vision",
                        "resolvedModel": "gpt-5.6-luna",
                        "reasoningEffort": "max",
                        "vision": true,
                        "modelLadder": [
                            "codex-gpt-5.4-mini",
                            "codex-gpt-5.6-luna-max-vision",
                            "codex-gpt-5.6-sol-high-vision",
                        ],
                    ])]),
                ]),
            ]
        )
        let loadedAction = OwnerAction(
            id: "owner-action-fixture-ai-load",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "aiProposals": .object([
                    "count": 1,
                    "proposalIds": ["aip-1"],
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [
            statusAction,
            proposalAction,
            loadedAction,
        ])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let status = try await service.aiStatus()
        #expect(!status.active)
        #expect(status.ready == 1)
        #expect(status.run?.failed == 1)
        let proposals = try await service.aiProposals(includeLoaded: true)
        #expect(proposals.count == 1)
        #expect(proposals[0].canonicalTitle == "Manual title")
        #expect(proposals[0].proposedTitle == "Evening in Paris")
        #expect(proposals[0].requestedGeneratorModel == "codex-gpt-5.6-luna-max-vision")
        #expect(proposals[0].resolvedModel == "gpt-5.6-luna")
        #expect(proposals[0].reasoningEffort == "max")
        #expect(proposals[0].vision == true)
        #expect(proposals[0].modelLadder == [
            "codex-gpt-5.4-mini",
            "codex-gpt-5.6-luna-max-vision",
            "codex-gpt-5.6-sol-high-vision",
        ])
        #expect(try await service.markAIProposalsLoaded(["aip-1"]) == 1)

        let requests = await api.requests()
        #expect(requests.count == 3)
        let statusManifest = requests[0].payload["manifest"]?.objectValue
        #expect(statusManifest?["mode"]?.stringValue == "fixture-ai-status")
        let proposalManifest = requests[1].payload["manifest"]?.objectValue
        #expect(proposalManifest?["mode"]?.stringValue == "fixture-ai-proposals-ready")
        #expect(proposalManifest?["includeLoaded"]?.boolValue == true)
        let loadManifest = requests[2].payload["manifest"]?.objectValue
        #expect(loadManifest?["mode"]?.stringValue == "fixture-ai-proposals-load")
        #expect(loadManifest?["proposalIds"]?.arrayValue?.compactMap(\.stringValue) == ["aip-1"])
    }

    @Test("Fixture archive state follows the connector archivedAt contract")
    func nativeFixtureArchiveState() {
        let active = FixtureNode(json: [
            "fixtureId": "fixture-active",
            "name": "Active",
            "archivedAt": "",
        ])
        let archived = FixtureNode(json: [
            "fixtureId": "fixture-archived",
            "name": "Archived",
            "archivedAt": "2026-07-25T15:25:59Z",
        ])

        #expect(!active.isArchived)
        #expect(archived.isArchived)
    }

    @Test("Fixture snapshot preserves its immutable native culling order")
    func nativeFixtureSnapshotOrder() async throws {
        let terminal = OwnerAction(
            id: "owner-action-pool",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "pool": .object([
                    "poolId": "pool-ordered",
                    "fixtureId": "fixture-family",
                    "name": "Family selects",
                    "assetCount": 2,
                    "snapshotHash": "stable-hash",
                    "assets": .array([
                        .object([
                            "assetId": "asset-b",
                            "sourceIdentity": "photos-b",
                            "photoLibraryIdentifier": "photos-b",
                            "sourceKind": "apple_photos",
                            "position": 0,
                            "title": "Second captured, first selected",
                            "filename": "B.JPG",
                            "mediaType": "photo",
                        ]),
                        .object([
                            "assetId": "asset-a",
                            "sourceIdentity": "photos-a",
                            "photoLibraryIdentifier": "photos-a",
                            "sourceKind": "apple_photos",
                            "position": 1,
                            "title": "First captured, second selected",
                            "filename": "A.MOV",
                            "mediaType": "video",
                        ]),
                    ]),
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let pool = try await service.snapshot(
            fixtureID: "fixture-family",
            assetIDs: ["asset-b", "asset-a"],
            name: "Family selects"
        )

        #expect(pool.id == "pool-ordered")
        #expect(pool.fixtureID == "fixture-family")
        #expect(pool.snapshotHash == "stable-hash")
        #expect(pool.assets.map(\.id) == ["asset-b", "asset-a"])
        #expect(pool.assets.map(\.position) == [0, 1])
        #expect(pool.assets.map(\.mediaType) == ["photo", "video"])
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["selectedAssetIds"]?.arrayValue?.compactMap(\.stringValue) == ["asset-b", "asset-a"])
    }

    @Test("Native fixtures reopen saved culling snapshots after an app restart")
    func nativeFixtureSavedSnapshots() async throws {
        let listed = OwnerAction(
            id: "owner-action-pool-list",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "pools": .array([
                    .object([
                        "poolId": "pool-recent",
                        "fixtureId": "fixture-expo",
                        "name": "Native selection",
                        "assetCount": 3,
                        "snapshotHash": "snapshot-hash",
                        "state": "active",
                        "createdAt": "2026-07-25T18:00:00Z",
                    ]),
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [listed])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let pools = try await service.pools(fixtureID: "fixture-expo")

        #expect(pools.map(\.id) == ["pool-recent"])
        #expect(pools.first?.assetCount == 3)
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-pool-list")
        #expect(manifest?["fixtureId"]?.stringValue == "fixture-expo")
    }

    @Test("Native culling batches decisions through the canonical API")
    func nativeCullingBatch() async throws {
        let transport = RecordingTransport(response: """
        {"ok":true,"appliedCount":2}
        """)
        let client = OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        )
        let service = SidecarDecisionService(api: client)

        _ = try await service.apply([
            .pick("asset-1", action: .pick),
            .pick("asset-2", action: .reject),
            .rating("asset-3", value: 5),
        ], idempotencyKey: "culling-batch-1")

        let request = try #require(await transport.lastRequest())
        #expect(request.url?.path == "/api/v1/sidecar/decisions/apply-batch")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "culling-batch-1")
        let body = try #require(request.httpBody)
        let payload = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        let decisions = try #require(payload?["decisions"] as? [[String: Any]])
        #expect(decisions.map { $0["action"] as? String } == ["pick", "reject", "rating"])
        #expect(decisions.last?["rating"] as? Int == 5)
    }

    @Test("Color assignment clears only when every target already has that color")
    func sidecarColorToggleTarget() {
        #expect(SidecarColor.green.toggleTarget(for: ["green"]) == .none)
        #expect(SidecarColor.green.toggleTarget(for: ["green", "green"]) == .none)
        #expect(SidecarColor.green.toggleTarget(for: ["green", "blue"]) == .green)
        #expect(SidecarColor.green.toggleTarget(for: [""]) == .green)
        #expect(SidecarColor.green.toggleTarget(for: []) == .green)
        #expect(SidecarColor.none.toggleTarget(for: [""]) == .none)
    }

    @Test("Color toggle queries authoritative state before clearing a repeated color")
    func sidecarColorToggleUsesAuthoritativeState() async throws {
        let transport = RoutingTransport(responses: [
            "/api/v1/sidecar/decisions/query": """
            {
              "ok": true,
              "decisions": {
                "asset-1": {
                  "assetId": "asset-1",
                  "rating": 0,
                  "color": "green",
                  "pickState": "undecided",
                  "metadataState": "unreviewed",
                  "title": "",
                  "keywords": [],
                  "tombstoneState": "",
                  "updatedAt": "2026-08-26T10:00:00Z"
                }
              }
            }
            """,
            "/api/v1/sidecar/decisions/apply": """
            {
              "ok": true,
              "assetId": "asset-1",
              "state": {
                "assetId": "asset-1",
                "rating": 0,
                "color": "",
                "pickState": "undecided",
                "metadataState": "unreviewed",
                "title": "",
                "keywords": [],
                "tombstoneState": "",
                "updatedAt": "2026-08-26T10:00:01Z"
              },
              "before": {
                "assetId": "asset-1",
                "rating": 0,
                "color": "green",
                "pickState": "undecided",
                "metadataState": "unreviewed",
                "title": "",
                "keywords": [],
                "tombstoneState": "",
                "updatedAt": "2026-08-26T10:00:00Z"
              },
              "changedFamilies": ["color"]
            }
            """,
        ])
        let service = SidecarDecisionService(api: OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: transport
        ))

        let changes = try await service.toggleColor(
            .green,
            assetIDs: ["asset-1"],
            idempotencyKey: "toggle-green-off"
        )

        #expect(changes.first?.state.color == "")
        let requests = await transport.requests()
        #expect(requests.map { $0.url?.path } == [
            "/api/v1/sidecar/decisions/query",
            "/api/v1/sidecar/decisions/apply",
        ])
        let applyBody = try #require(requests.last?.httpBody)
        let applyPayload = try JSONSerialization.jsonObject(with: applyBody) as? [String: Any]
        #expect(applyPayload?["action"] as? String == "color")
        #expect(applyPayload?["color"] as? String == "")
    }

    @Test("Native culling reloads preserved decisions and captures reversible before state")
    func nativeCullingStateAndUndoEvidence() async throws {
        let applyTransport = RecordingTransport(response: """
        {
          "ok": true,
          "items": [{
            "assetId": "asset-1",
            "state": {
              "assetId": "asset-1",
              "rating": 4,
              "color": "purple",
              "pickState": "picked",
              "metadataState": "unreviewed",
              "title": "",
              "keywords": [],
              "tombstoneState": "",
              "updatedAt": "2026-07-25T14:00:00Z"
            },
            "before": {
              "assetId": "asset-1",
              "rating": 0,
              "color": "",
              "pickState": "undecided",
              "metadataState": "unreviewed",
              "title": "",
              "keywords": [],
              "tombstoneState": "",
              "updatedAt": ""
            },
            "changedFamilies": ["color"]
          }]
        }
        """)
        let applyService = SidecarDecisionService(api: OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: applyTransport
        ))

        let changes = try await applyService.applyDetailed([
            .color("asset-1", value: .purple),
        ], idempotencyKey: "native-color")

        #expect(changes.first?.state.color == "purple")
        #expect(changes.first?.before.color == "")
        #expect(changes.first?.changedFamilies == ["color"])
        let applyRequest = try #require(await applyTransport.lastRequest())
        let applyBody = try #require(applyRequest.httpBody)
        let applyPayload = try JSONSerialization.jsonObject(with: applyBody) as? [String: Any]
        #expect(applyPayload?["action"] as? String == "color")
        #expect(applyPayload?["color"] as? String == "purple")

        let queryTransport = RecordingTransport(response: """
        {
          "ok": true,
          "decisions": {
            "asset-1": {
              "assetId": "asset-1",
              "rating": 4,
              "color": "purple",
              "pickState": "picked",
              "metadataState": "unreviewed",
              "title": "",
              "keywords": [],
              "tombstoneState": "",
              "updatedAt": "2026-07-25T14:00:00Z"
            }
          }
        }
        """)
        let queryService = SidecarDecisionService(api: OwnerAPIClient(
            baseURL: URL(string: "https://example.test/api/v1")!,
            transport: queryTransport
        ))

        let states = try await queryService.queryStates(assetIDs: ["asset-1"])
        #expect(states["asset-1"]?.pickState == "picked")
        #expect(states["asset-1"]?.rating == 4)
    }

    @Test("Native metadata edits retain the Worker and Max authority gate")
    func nativeMetadataEdit() async throws {
        let terminal = OwnerAction(
            id: "owner-action-metadata",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: ["ok": true]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = MetadataReviewService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        _ = try await service.update(
            assetID: "asset-1",
            title: "Verified title",
            caption: "Morning at the museum",
            keywords: ["Paris", "paris", "museum"]
        )

        let request = try #require(await api.requests().first)
        #expect(request.actionKind == "photo-moderation")
        #expect(request.target == "max")
        #expect(request.payload["operation"]?.stringValue == "update-photo-metadata")
        #expect(request.payload["photo_id"]?.stringValue == "asset-1")
        #expect(request.payload["caption"]?.stringValue == "Morning at the museum")
        #expect(request.payload["keywords"]?.arrayValue?.compactMap(\.stringValue) == ["Paris", "museum"])
    }

    @Test("Native metadata edits and blacklist replacements return reversible before state")
    func nativeMetadataHistory() async throws {
        let metadata = OwnerAction(
            id: "owner-action-metadata-history",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: [
                "result": [
                    "previous_metadata": [
                        "photo_id": "asset-1",
                        "title": "Before",
                        "caption": "Original caption",
                        "keywords": ["Paris", "Museum"],
                    ],
                    "metadata": [
                        "photo_id": "asset-1",
                        "title": "After",
                        "caption": "New caption",
                        "keywords": ["Paris", "Architecture"],
                    ],
                ],
            ]
        )
        let blacklist = OwnerAction(
            id: "owner-action-blacklist-history",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: [
                "result": [
                    "previous_keywords": ["AI"],
                    "keywords": ["AI", "Stained"],
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [metadata, blacklist])
        let service = MetadataReviewService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let edit = try await service.updateDetailed(
            assetID: "asset-1",
            title: "After",
            caption: "New caption",
            keywords: ["Paris", "Architecture"]
        )
        #expect(edit.before.title == "Before")
        #expect(edit.before.caption == "Original caption")
        #expect(edit.before.keywords == ["Paris", "Museum"])
        #expect(edit.after.title == "After")

        let terms = try await service.replaceBlacklistDetailed(["AI", "Stained"])
        #expect(terms.before == ["AI"])
        #expect(terms.after == ["AI", "Stained"])
    }

    @Test("Native fixture placements stay reversible and audited")
    func nativeFixturePlacements() async throws {
        let terminal = OwnerAction(
            id: "owner-action-placement",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "ledger": .object([
                    "items": .array([.object([
                        "placementId": "placement-1",
                        "assetId": "asset-1",
                        "fixtureId": "fixture-family",
                        "breadcrumbLabel": "Friends / Family",
                        "state": "active",
                    ])]),
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = FixtureWorkflowService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let placements = try await service.place(
            assetIDs: ["asset-1"],
            fixtureIDs: ["fixture-family"]
        )

        #expect(placements.map(\.id) == ["placement-1"])
        #expect(placements.first?.breadcrumbLabel == "Friends / Family")
        let request = try #require(await api.requests().first)
        let manifest = request.payload["manifest"]?.objectValue
        #expect(manifest?["mode"]?.stringValue == "fixture-place-multi")
        #expect(manifest?["assetIds"]?.arrayValue?.compactMap(\.stringValue) == ["asset-1"])
    }

    @Test("Native model ladder saves the selected OpenAI order through Max")
    func nativeModelLadderSave() async throws {
        let terminal = OwnerAction(
            id: "owner-action-model-ladder",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: [
                "result": .object([
                    "previous_model_ladder": .array([.string("codex-gpt-5.4-mini")]),
                    "model_ladder": .array([
                        .string("codex-gpt-5.6-sol-high-vision"),
                        .string("codex-gpt-5.4-mini"),
                    ]),
                ]),
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let service = MetadataReviewService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))
        let selected = [
            MetadataModelLadderRung.catalog[2],
            MetadataModelLadderRung.catalog[0],
            MetadataModelLadderRung(model: "gpt-custom-one", effort: "medium"),
            MetadataModelLadderRung(model: "gpt-custom-two", effort: "xhigh"),
        ]

        let change = try await service.replaceModelLadderDetailed(selected)

        #expect(change.before == [MetadataModelLadderRung(model: "gpt-5.4-mini", effort: "low")])
        #expect(change.after == [
            MetadataModelLadderRung(model: "gpt-5.6-sol", effort: "high"),
            MetadataModelLadderRung(model: "gpt-5.4-mini", effort: "low"),
        ])
        let request = try #require(await api.requests().first)
        #expect(request.payload["operation"]?.stringValue == "save-title-keyword-model-ladder")
        #expect(request.payload["target"] == nil)
        let payloadRungs = request.payload["model_ladder"]?.arrayValue?.compactMap(\.objectValue) ?? []
        #expect(payloadRungs.map { $0["model"]?.stringValue } == ["gpt-5.6-sol", "gpt-5.4-mini", "gpt-custom-one", "gpt-custom-two"])
        #expect(payloadRungs.map { $0["effort"]?.stringValue } == ["high", "low", "medium", "xhigh"])
        #expect(payloadRungs.allSatisfy { $0["vision"]?.boolValue == true })
    }

    @Test("Native lifecycle loads private titles and restores through moderation")
    func nativeLifecycleRestore() async throws {
        let ledger = OwnerAction(
            id: "owner-action-lifecycle-list",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "lifecycle": [
                    "hiddenCount": 1,
                    "discardedCount": 1,
                    "items": [[
                        "mediaId": "photo-hidden",
                        "state": "hidden",
                        "title": "Private saved title",
                        "filename": "IMG_4228.HEIC",
                        "capturedAt": "2026-07-24T18:45:00Z",
                        "photoLibraryIdentifier": "photos-hidden",
                        "mediaType": "photo",
                        "sourceSlug": "france",
                        "updatedAt": "2026-07-25T00:00:00Z",
                    ]],
                ],
            ]
        )
        let restored = OwnerAction(
            id: "owner-action-lifecycle-restore",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: ["ok": true]
        )
        let moved = OwnerAction(
            id: "owner-action-lifecycle-move",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: ["ok": true]
        )
        let emptied = OwnerAction(
            id: "owner-action-lifecycle-empty",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: ["ok": true]
        )
        let selectedEmptied = OwnerAction(
            id: "owner-action-lifecycle-empty-selected",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: ["ok": true]
        )
        let api = ScriptedOwnerActionAPI(completed: [ledger, restored, moved, selectedEmptied, emptied])
        let service = LifecycleService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let state = try await service.ledger()
        #expect(state.items.map(\.title) == ["Private saved title"])
        #expect(state.items.map(\.filename) == ["IMG_4228.HEIC"])
        #expect(state.items.map(\.capturedAt) == ["2026-07-24T18:45:00Z"])
        #expect(state.items.map(\.photoLibraryIdentifier) == ["photos-hidden"])
        _ = try await service.restore(mediaIDs: ["photo-hidden"])

        let requests = await api.requests()
        #expect(requests[0].payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-lifecycle-list")
        #expect(
            requests[0].payload["manifest"]?.objectValue?["states"]?.arrayValue?.compactMap(\.stringValue)
                == ["hidden"]
        )
        #expect(requests[1].actionKind == "photo-moderation")
        #expect(requests[1].payload["operation"]?.stringValue == "waste-basket-restore")
        #expect(requests[1].payload["photoIds"]?.arrayValue?.compactMap(\.stringValue) == ["photo-hidden"])
        #expect(requests[1].payload["requestKey"]?.stringValue?.hasPrefix("native-lifecycle:waste-basket-restore:") == true)

        _ = try await service.moveToWasteBasket(mediaIDs: ["photo-x"], fixtureID: "fixture-expo")
        _ = try await service.emptyWasteBasket(mediaIDs: ["photo-hidden"], confirmed: true)
        _ = try await service.emptyWasteBasket(confirmed: true)
        let finalRequests = await api.requests()
        #expect(finalRequests[2].payload["operation"]?.stringValue == "waste-basket-x")
        #expect(finalRequests[2].payload["source"]?.stringValue == "backstage-culling")
        #expect(finalRequests[2].payload["requestKey"]?.stringValue?.hasPrefix("native-lifecycle:waste-basket-x:") == true)
        #expect(finalRequests[3].payload["operation"]?.stringValue == "waste-basket-empty")
        #expect(finalRequests[3].payload["photoIds"]?.arrayValue?.compactMap(\.stringValue) == ["photo-hidden"])
        #expect(finalRequests[3].payload["confirmed"]?.boolValue == true)
        #expect(finalRequests[3].payload["confirmationToken"]?.stringValue == "EMPTY_WASTE_BASKET")
        #expect(finalRequests[4].payload["operation"]?.stringValue == "waste-basket-empty")
        #expect(finalRequests[4].payload["photoIds"]?.arrayValue?.isEmpty == true)
    }

    @Test("Native lifecycle queues X and Empty before terminal reconciliation")
    func nativeLifecycleQueuesDestructiveActions() async throws {
        let queuedX = OwnerAction(
            id: "owner-action-lifecycle-queued-x",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: ["ok": true]
        )
        let queuedEmpty = OwnerAction(
            id: "owner-action-lifecycle-queued-empty",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: ["ok": true]
        )
        let api = ScriptedOwnerActionAPI(completed: [queuedX, queuedEmpty])
        let service = LifecycleService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let x = try await service.enqueueMoveToWasteBasket(
            mediaIDs: [" photo-2 ", "photo-1", "photo-2"],
            fixtureID: "fixture-expo"
        )
        let empty = try await service.enqueueEmptyWasteBasket(
            mediaIDs: ["photo-2"],
            confirmed: true
        )

        #expect(x.state == .queued)
        #expect(empty.state == .queued)
        #expect(try await service.awaitCompletion(of: x).state == .completed)
        #expect(try await service.awaitCompletion(of: empty).state == .completed)

        let requests = await api.requests()
        #expect(requests.count == 2)
        #expect(requests[0].payload["operation"]?.stringValue == "waste-basket-x")
        #expect(requests[0].payload["photoIds"]?.arrayValue?.compactMap(\.stringValue) == ["photo-1", "photo-2"])
        #expect(requests[0].payload["fixtureId"]?.stringValue == "fixture-expo")
        #expect(requests[1].payload["operation"]?.stringValue == "waste-basket-empty")
        #expect(requests[1].payload["confirmed"]?.boolValue == true)
        #expect(requests[1].payload["confirmationToken"]?.stringValue == "EMPTY_WASTE_BASKET")
    }

    @Test("Lifecycle receipts report affected skipped and failed X items")
    func lifecycleActionReceipts() {
        let mixed = OwnerAction(
            id: "owner-action-lifecycle-receipt",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: [
                "result": [
                    "items": [
                        ["status": "applied"],
                        ["status": "already-recoverable"],
                        ["status": "conflict"],
                    ],
                ],
            ]
        )
        #expect(
            LifecycleActionReceipt.summarize(mixed, requestedCount: 3)
                == LifecycleActionReceipt(affected: 1, skipped: 1, failed: 1)
        )

        let completedWithoutItems = OwnerAction(
            id: "owner-action-lifecycle-fallback",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            result: ["ok": true]
        )
        #expect(
            LifecycleActionReceipt.summarize(completedWithoutItems, requestedCount: 2)
                == LifecycleActionReceipt(affected: 2, skipped: 0, failed: 0)
        )
    }

    @Test("Owner action decoding preserves connector phase timing receipts")
    func decodesConnectorPhaseTimingReceipts() throws {
        let action = try JSONDecoder.ownerAPI.decode(
            OwnerAction.self,
            from: Data(
                """
                {
                  "id": "owner-action-lifecycle-timing",
                  "actionKind": "photo-moderation",
                  "target": "max",
                  "state": "completed",
                  "timing": {
                    "queuedAt": "2026-08-18T10:00:00.000Z",
                    "completedAt": "2026-08-18T10:00:00.500Z",
                    "connector": {
                      "schema": "photosbyelie.ownerActionTiming.v1",
                      "actionId": "owner-action-lifecycle-timing",
                      "startedAt": "2026-08-18T10:00:00.100Z",
                      "endedAt": "2026-08-18T10:00:00.500Z",
                      "elapsedMs": 400.0,
                      "outcome": "submitted",
                      "phases": {
                        "action.execute": {
                          "startedAt": "2026-08-18T10:00:00.100Z",
                          "endedAt": "2026-08-18T10:00:00.150Z",
                          "elapsedMs": 50.0,
                          "outcome": "ok"
                        },
                        "lifecycle.local-moderation": {
                          "startedAt": "2026-08-18T10:00:00.200Z",
                          "endedAt": "2026-08-18T10:00:00.500Z",
                          "elapsedMs": 300.0,
                          "outcome": "ok"
                        }
                      }
                    }
                  }
                }
                """.utf8
            )
        )

        #expect(action.connectorTiming?.schema == "photosbyelie.ownerActionTiming.v1")
        #expect(action.connectorTiming?.latestPhaseName == "lifecycle.local-moderation")
        #expect(action.connectorTiming?.slowestPhaseName == "lifecycle.local-moderation")
        #expect(action.connectorTiming?.slowestPhaseElapsedMs == 300.0)
        #expect(action.diagnosticPhaseName == "lifecycle.local-moderation")
        #expect(action.diagnosticPhaseElapsedMs == 300.0)
    }

    @Test("Owner action completion reports queued and terminal updates")
    func ownerActionCompletionReportsUpdates() async throws {
        let terminal = OwnerAction(
            id: "owner-action-update-receipt",
            actionKind: "photo-moderation",
            target: "max",
            state: .completed,
            progress: OwnerProgress(
                phase: "projection-update",
                completed: 1,
                total: 1,
                percent: 100
            )
        )
        let api = ScriptedOwnerActionAPI(completed: [terminal])
        let runner = OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        )
        let recorder = OwnerActionUpdateRecorder()

        _ = try await runner.awaitCompletion(
            of: OwnerAction(
                id: terminal.id,
                actionKind: terminal.actionKind,
                target: terminal.target,
                state: .queued
            ),
            onUpdate: { action in recorder.append(action) }
        )

        #expect(recorder.states == [.queued, .completed])
        #expect(recorder.phases == ["queued", "projection-update"])
    }

    @Test("Native delivery keeps fixture upload and publication as separate actions")
    func nativeFixtureDeliveryAndPublication() async throws {
        let deliveryPlan = OwnerAction(
            id: "owner-action-delivery-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "delivery": [
                    "fixtureId": "fixture-expo",
                    "approvedCount": 1,
                    "completeCount": 0,
                    "items": [[
                        "assetId": "asset-1",
                        "approved": true,
                        "complete": false,
                        "destinations": ["r2", "apple_photos"],
                        "receipts": [
                            "r2": [
                                "status": "verified",
                                "items": [[
                                    "object_key": "private/fixture-expo/asset-1.jpg",
                                    "checksum_sha256": "1234567890abcdef",
                                    "verified_at": "2026-07-25T10:00:00Z",
                                ]],
                            ],
                            "apple_photos": [
                                "status": "verified",
                                "items": [[
                                    "object_key": "local://asset-1",
                                    "checksum_sha256": "fedcba0987654321",
                                    "verified_at": "2026-07-25T10:00:01Z",
                                ]],
                            ],
                        ],
                    ]],
                ],
            ]
        )
        let delivered = OwnerAction(
            id: "owner-action-delivery",
            actionKind: "sidecar-upload-publish",
            target: "max",
            state: .completed,
            result: [
                "result": [
                    "ok": true,
                    "status": "completed",
                    "summary": ["processedCount": 1, "failedCount": 0],
                ],
            ]
        )
        let publication = OwnerAction(
            id: "owner-action-publication-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "publication": [
                    "fixtureId": "fixture-expo",
                    "eligible": [["assetId": "asset-1"]],
                    "blocked": [],
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [deliveryPlan, delivered, publication])
        let service = FixtureDeliveryService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let plan = try await service.plan(fixtureID: "fixture-expo")
        #expect(plan.retryableIDs == ["asset-1"])
        #expect(plan.items[0].r2Evidence.contains("private/fixture-expo/asset-1.jpg"))
        #expect(plan.items[0].r2Evidence.contains("sha256:1234567890ab"))
        #expect(plan.items[0].photosEvidence.contains("local://asset-1"))
        #expect(plan.items[0].photosEvidence.contains("verified 2026-07-25T10:00:01Z"))
        let report = try await service.deliver(
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"]
        )
        #expect(report.ok)
        let gate = try await service.publicationPlan(
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1"]
        )
        #expect(gate.eligibleIDs == ["asset-1"])

        let requests = await api.requests()
        #expect(requests[0].payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-delivery-plan")
        #expect(requests[1].actionKind == "sidecar-upload-publish")
        #expect(requests[1].payload["workflow"]?.stringValue == "fixture-delivery")
        #expect(requests[2].payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-publication-plan")
    }

    @Test("Native upload recovery previews queue health before exact run adoption")
    func nativeFixtureUploadRecovery() async throws {
        let health = OwnerAction(
            id: "owner-action-upload-health",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "uploadHealth": [
                    "fixtureId": "fixture-expo",
                    "activeAssetCount": 3,
                    "bridgeQueuedCount": 2,
                    "uploadableItemCount": 1,
                    "fullyCoveredItemCount": 1,
                    "partiallyCoveredItemCount": 0,
                    "metadataBlockedQueuedCount": 0,
                ],
            ]
        )
        let adoption = OwnerAction(
            id: "owner-action-adoption-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "uploadRunAdoption": [
                    "runId": "ub-1",
                    "fixtureId": "fixture-expo",
                    "items": [["assetId": "asset-1"]],
                    "blocked": [["assetId": "asset-2", "reason": "editorial state changed"]],
                    "applied": false,
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [health, adoption])
        let service = FixtureDeliveryService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let queue = try await service.uploadHealth(fixtureID: "fixture-expo")
        #expect(queue.uploadableCount == 1)
        #expect(queue.coveredCount == 1)
        let plan = try await service.adoptionPlan(
            runID: "ub-1",
            fixtureID: "fixture-expo",
            assetIDs: ["asset-1", "asset-2"]
        )
        #expect(plan.eligibleIDs == ["asset-1"])
        #expect(plan.blocked["asset-2"] == "editorial state changed")
        #expect(!plan.applied)

        let requests = await api.requests()
        #expect(requests[0].payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-upload-health")
        #expect(requests[1].payload["manifest"]?.objectValue?["mode"]?.stringValue == "fixture-upload-run-adoption-plan")
    }

    @Test("Native upload publishes verified assets and exposes reconciliation progress")
    func nativeUploadAndR2Safety() async throws {
        let eligibility = OwnerAction(
            id: "owner-action-upload-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "uploadPlan": [
                    "fixtureId": "fixture-expo",
                    "fixtureName": "Expo",
                    "cloudAllowed": true,
                    "pickedCount": 12,
                    "approvedCount": 9,
                    "needsReviewCount": 3,
                    "needsUploadCount": 2,
                    "liveCount": 7,
                    "mediaUploadedCount": 7,
                    "liveOnWebsiteCount": 7,
                    "offset": 0,
                    "limit": 200,
                    "hasNext": false,
                    "items": [[
                        "assetId": "asset-1",
                        "photoLibraryIdentifier": "photos-asset-1",
                        "title": "One",
                        "filename": "one.jpg",
                        "capturedAt": "2026-07-28T10:00:00Z",
                        "deliveryState": "needs-upload",
                        "errorText": "",
                    ], [
                        "assetId": "asset-2",
                        "photoLibraryIdentifier": "photos-asset-2",
                        "title": "Two",
                        "filename": "two.jpg",
                        "capturedAt": "2026-07-28T09:00:00Z",
                        "deliveryState": "failed",
                        "errorText": "network",
                    ]],
                ],
            ]
        )
        let started = OwnerAction(
            id: "owner-action-upload-start",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "uploadRun": [
                    "runId": "uplrun-1",
                    "status": "queued",
                    "count": 2,
                    "concurrency": 4,
                    "started": true,
                ],
            ]
        )
        let status = OwnerAction(
            id: "owner-action-upload-status",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "uploadRun": [
                    "runId": "uplrun-1",
                    "status": "completed-with-errors",
                    "requested": 2,
                    "processed": 2,
                    "live": 1,
                    "failed": 1,
                    "remaining": 0,
                    "concurrency": 4,
                    "items": [
                        ["asset_id": "asset-1", "status": "live", "error_text": ""],
                        ["asset_id": "asset-2", "status": "failed", "error_text": "network"],
                    ],
                ],
            ]
        )
        let reconciliation = OwnerAction(
            id: "owner-action-r2-plan",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "reconciliation": [
                    "runId": "r2rec-1",
                    "mode": "plan",
                    "scanned": 3,
                    "protected": 1,
                    "quarantined": 1,
                    "restored": 0,
                    "eligibleDelete": 1,
                    "deleted": 0,
                    "actions": [[
                        "bucket": "photosbyelie-private",
                        "key": "masters/sold.jpg",
                        "assetId": "asset-1",
                        "sold": true,
                        "referenced": true,
                        "action": "protected",
                    ]],
                ],
            ]
        )
        let photosSync = OwnerAction(
            id: "owner-action-photos-sync",
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .completed,
            result: [
                "photosSync": [
                    "attached": false,
                    "requested": 25,
                    "scanned": 24,
                    "elapsedSeconds": 2.5,
                    "failures": [["assetId": "asset-failed", "error": "transient"]],
                    "changes": [
                        "baseline": 20,
                        "unchanged": 1,
                        "metadataOnly": 1,
                        "appearance": 1,
                        "sourceMissing": 1,
                        "sourceReturned": 0,
                    ],
                ],
            ]
        )
        let api = ScriptedOwnerActionAPI(completed: [eligibility, started, status, reconciliation, photosSync])
        let service = FixtureDeliveryService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let plan = try await service.nativeUploadPlan(fixtureID: "fixture-expo")
        #expect(plan.fixtureName == "Expo")
        #expect(plan.needsUploadCount == 2)
        #expect(plan.needsReviewCount == 3)
        #expect(plan.approvedOnlyCount == 0)
        #expect(plan.publishingCount == 0)
        #expect(plan.fullResolutionUploadedCount == 0)
        #expect(plan.failedHealthCount == 0)
        #expect(plan.items[0].photoLibraryIdentifier == "photos-asset-1")
        #expect(plan.items[0].workflowStage == .needsUpload)
        #expect(FixtureReviewAction.returnToReview.rawValue == "return-to-review")
        #expect(plan.items[1].deliveryState == "failed")
        #expect(plan.items[1].errorText == "network")
        let run = try await service.startNativeUpload(
            assetIDs: ["asset-1", "asset-2"],
            limit: 50,
            concurrency: 4
        )
        #expect(run.runID == "uplrun-1")
        #expect(run.requested == 2)
        let completed = try await service.nativeUploadStatus(runID: run.runID)
        #expect(completed.isFinished)
        #expect(completed.live == 1)
        #expect(completed.failed == 1)
        #expect(completed.items[1].errorText == "network")
        #expect(completed.items[0].workflowStage == .fullResolutionUploaded)
        #expect(completed.items[1].workflowStage == .needsUpload)
        let safety = try await service.r2Reconciliation()
        #expect(safety.protected == 1)
        #expect(safety.eligibleDelete == 1)
        #expect(safety.items.first?.sold == true)
        let sync = try await service.syncPhotos(limit: 25)
        #expect(sync.scanned == 24)
        #expect(sync.metadataOnly == 1)
        #expect(sync.appearance == 1)
        #expect(sync.sourceMissing == 1)
        #expect(sync.failed == 1)
        #expect(sync.elapsedSeconds == 2.5)

        let requests = await api.requests()
        #expect(requests[0].payload["manifest"]?.objectValue?["mode"]?.stringValue == "asset-upload-plan")
        #expect(requests[0].payload["manifest"]?.objectValue?["fixtureId"]?.stringValue == "fixture-expo")
        #expect(requests[1].payload["manifest"]?.objectValue?["mode"]?.stringValue == "asset-upload-run-start")
        #expect(requests[2].payload["manifest"]?.objectValue?["mode"]?.stringValue == "asset-upload-run-status")
        #expect(requests[3].payload["manifest"]?.objectValue?["mode"]?.stringValue == "r2-reconciliation-plan")
        #expect(requests[4].payload["manifest"]?.objectValue?["mode"]?.stringValue == "photos-sync-run")
        #expect(requests[4].payload["manifest"]?.objectValue?["limit"]?.intValue == 25)
    }

    @Test("Native long-running publication operations expose checkpointed cancellation")
    func nativePublicationCancellationContracts() async throws {
        func action(_ id: String, _ result: [String: JSONValue]) -> OwnerAction {
            OwnerAction(
                id: id,
                actionKind: "sidecar-culling-review",
                target: "max",
                state: .completed,
                result: result
            )
        }
        let responses: [OwnerAction] = [
            action("upload-cancel", ["uploadRun": [
                "runId": "uplrun-1", "status": "running", "requested": 2,
                "processed": 1, "remaining": 1, "cancelRequested": true,
            ]]),
            action("photos-start", ["photosSync": [
                "runId": "photos-sync-1", "status": "running", "stage": "Reading metadata",
                "requested": 25, "scanned": 0, "remaining": 25,
            ]]),
            action("photos-status", ["photosSync": [
                "runId": "photos-sync-1", "status": "running", "stage": "Classifying changes",
                "requested": 25, "scanned": 12, "remaining": 13,
            ]]),
            action("photos-cancel", ["photosSync": [
                "runId": "photos-sync-1", "status": "cancelled", "stage": "Stopped safely",
                "requested": 25, "scanned": 12, "remaining": 13, "cancelRequested": true,
            ]]),
            action("r2-start", ["reconciliation": [
                "runId": "r2rec-1", "mode": "commit", "status": "running", "stage": "Queued",
                "requested": 10, "scanned": 0, "remaining": 10,
            ]]),
            action("r2-status", ["reconciliation": [
                "runId": "r2rec-1", "mode": "commit", "status": "running", "stage": "Checking object 4 of 10",
                "requested": 10, "scanned": 4, "remaining": 6,
            ]]),
            action("r2-cancel", ["reconciliation": [
                "runId": "r2rec-1", "mode": "commit", "status": "cancelled", "stage": "Stopped safely",
                "requested": 10, "scanned": 4, "remaining": 6, "cancelRequested": true,
            ]]),
        ]
        let api = ScriptedOwnerActionAPI(completed: responses)
        let service = FixtureDeliveryService(runner: OwnerActionRunner(
            api: api,
            waker: UnavailableWaker(),
            pollInterval: .milliseconds(1),
            timeout: .seconds(1)
        ))

        let upload = try await service.cancelNativeUpload(runID: "uplrun-1")
        #expect(upload.cancelRequested)
        let photosStart = try await service.startPhotosSync(limit: 25)
        let photosStatus = try await service.photosSyncStatus(runID: photosStart.runID)
        let photosStopped = try await service.cancelPhotosSync(runID: photosStart.runID)
        #expect(photosStatus.stage == "Classifying changes")
        #expect(photosStopped.isFinished)
        #expect(photosStopped.remaining == 13)
        let r2Start = try await service.startR2Reconciliation(commit: true)
        let r2Status = try await service.r2ReconciliationStatus(runID: r2Start.runID)
        let r2Stopped = try await service.cancelR2Reconciliation(runID: r2Start.runID)
        #expect(r2Status.scanned == 4)
        #expect(r2Stopped.isFinished)
        #expect(r2Stopped.cancelRequested)

        let requests = await api.requests()
        let modes = requests.compactMap {
            $0.payload["manifest"]?.objectValue?["mode"]?.stringValue
        }
        #expect(modes == [
            "asset-upload-run-cancel",
            "photos-sync-run-start",
            "photos-sync-run-status",
            "photos-sync-run-cancel",
            "r2-reconciliation-run-start",
            "r2-reconciliation-run-status",
            "r2-reconciliation-run-cancel",
        ])
    }

    @Test("Review AI requests update the loaded editorial summary")
    func reviewSummaryTracksAIRequestTransition() {
        var summary = FixtureReviewSummary(
            total: 10,
            unreviewed: 8,
            requestingAI: 1,
            proposed: 1,
            approved: 0
        )
        summary.applyEditorialStateTransition(
            from: "unreviewed",
            to: "requesting-ai"
        )
        #expect(summary.total == 10)
        #expect(summary.unreviewed == 7)
        #expect(summary.requestingAI == 2)
        #expect(summary.proposed == 1)
        summary.applyEditorialStateTransition(
            from: "requesting-ai",
            to: "requesting-ai"
        )
        #expect(summary.requestingAI == 2)
    }

    @Test("Review summary makes Hidden exclusive from editorial stages")
    func reviewSummaryTracksCanonicalHiddenTransition() {
        var summary = FixtureReviewSummary(
            total: 1,
            unreviewed: 1,
            requestingAI: 0,
            proposed: 0,
            approved: 0
        )
        summary.applyWorkflowStageTransition(
            from: .awaitingReview,
            to: .hiddenFromFixture
        )
        #expect(summary.unreviewed == 0)
        #expect(summary.hidden == 1)
        summary.applyWorkflowStageTransition(
            from: .hiddenFromFixture,
            to: .awaitingReview
        )
        #expect(summary.unreviewed == 1)
        #expect(summary.hidden == 0)
    }

    @Test("Connector identity is explicit and requires neither daemon nor credential config")
    func connectorIdentityUsesExplicitAuthorityTarget() async {
        #expect(await LocalOwnerConnectorIdentity().connectorID() == "max")
        #expect(await LocalOwnerConnectorIdentity(target: "David_2").connectorID() == "david_2")
        #expect(await LocalOwnerConnectorIdentity(target: "not valid!").connectorID() == "max")
    }

    @Test("Backstage control health is native, structured, and helper-free")
    func backstageControlHealthIsMachineReadable() async throws {
        let release = BackstageReleaseIdentity(
            bundleIdentifier: "com.photosbyelie.backstage",
            version: "218.0",
            build: "75"
        )
        let service = BackstageControlService(
            release: release,
            photoLibrary: StaticPhotoLibrary(access: .notDetermined),
            connectorIdentity: StaticOwnerConnectorIdentity("max"),
            authenticationSnapshot: {
                OwnerAuthenticationSnapshot(
                    phase: .authenticated,
                    deviceId: "owner-device-test"
                )
            }
        )

        let health = await service.health(command: "release verify")
        #expect(health.ok)
        #expect(health.schemaVersion == 2)
        #expect(health.command == "release verify")
        #expect(health.photoLibraryAccess == "not_determined")
        #expect(health.ownerAuthenticated)
        #expect(health.connectorID == "max")
        #expect(health.message == "Backstage release metadata is complete; no standalone Photos helper is required.")

        let photosHealth = await service.health(command: "photos health")
        #expect(!photosHealth.ok)
        #expect(photosHealth.message.contains("not_determined"))

        let authorizedService = BackstageControlService(
            release: release,
            photoLibrary: StaticPhotoLibrary(access: .authorized),
            connectorIdentity: StaticOwnerConnectorIdentity("max"),
            authenticationSnapshot: {
                OwnerAuthenticationSnapshot(
                    phase: .authenticated,
                    deviceId: "owner-device-test"
                )
            }
        )
        let authorizedPhotosHealth = await authorizedService.health(command: "photos health")
        #expect(authorizedPhotosHealth.ok)
        #expect(authorizedPhotosHealth.photoLibraryAccess == "authorized")
        #expect(authorizedPhotosHealth.message == "Backstage control health is ready.")

        let encoded = try JSONEncoder.ownerAPI.encode(health)
        let encodedText = try #require(String(data: encoded, encoding: .utf8))
        #expect(!encodedText.contains("\"helper\":"))
        #expect(!encodedText.contains("Bridge"))
        let decoded = try JSONDecoder.ownerAPI.decode(BackstageControlHealth.self, from: encoded)
        #expect(decoded.schemaVersion == health.schemaVersion)
        #expect(decoded.command == health.command)
        #expect(abs(decoded.checkedAt.timeIntervalSince(health.checkedAt)) < 1)
        #expect(decoded.ok == health.ok)
        #expect(decoded.release == health.release)
        #expect(decoded.photoLibraryAccess == health.photoLibraryAccess)
        #expect(decoded.ownerSession == health.ownerSession)
        #expect(decoded.ownerAuthenticated == health.ownerAuthenticated)
        #expect(decoded.connectorID == health.connectorID)
        #expect(decoded.message == health.message)
    }

    @Test("Backstage CLI runs an Owner-authenticated originals preflight without CUA")
    func backstageControlRunsRealEstateOriginalsPreflight() async throws {
        let itemsURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-originals-preflight-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: itemsURL) }
        let expectedItem = RealEstateOriginalsPreflightRequest.Item(
            photoId: "corine-re-2026-la-concha-1-apt-8ab1-d5h-3043",
            albumSlug: "re-2026-la-concha-1-apt-8ab1",
            sourceFile: "D5H_3043.JPG",
            title: "La Concha 1 Apt 8AB1 - 01",
            sortIndex: 1
        )
        try JSONEncoder.ownerAPI.encode([expectedItem]).write(to: itemsURL)

        let expectedReport = RealEstateOriginalsPreflight(
            checkedAt: "2026-08-07T10:00:00.000Z",
            ok: true,
            galleryKey: "corine-real-estate",
            requestedCount: 1,
            availableCount: 1,
            missingCount: 0,
            totalBytes: 1234,
            items: [.init(
                photoId: expectedItem.photoId,
                name: "001-La-Concha-D5H_3043.JPG",
                contentType: "image/jpeg",
                available: true,
                bytes: 1234
            )],
            message: "Selected originals are available for an authorized download session."
        )
        let service = BackstageControlService(realEstateOriginalsPreflight: { request in
            guard request.galleryKey == "corine-real-estate",
                  request.items == [expectedItem] else {
                throw APIErrorEnvelope(error: .init(
                    code: "unexpected_request",
                    message: "The CLI request did not match the items file."
                ))
            }
            return RealEstateOriginalsPreflightEnvelope(preflight: expectedReport)
        })
        let output = LockedStringOutput()

        let exitCode = await BackstageControlCLI.run(
            arguments: [
                "real-estate", "originals", "preflight",
                "--gallery", "corine-real-estate",
                "--items-file", itemsURL.path,
            ],
            service: service,
            output: { output.append($0) }
        )

        #expect(exitCode == 0)
        let payload = try #require(output.values().last)
        let decoded = try JSONDecoder.ownerAPI.decode(
            RealEstateOriginalsPreflight.self,
            from: Data(payload.utf8)
        )
        #expect(decoded == expectedReport)
        #expect(decoded.mode == "read-only")
    }

    @Test("Backstage CLI uses stable exit codes for unavailable originals and invalid arguments")
    func backstageControlPreflightExitCodesAreStable() async throws {
        let itemsURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-originals-preflight-missing-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: itemsURL) }
        let item = RealEstateOriginalsPreflightRequest.Item(
            photoId: "corine-re-2026-la-concha-missing",
            albumSlug: "re-2026-la-concha-1-apt-8ab1"
        )
        try JSONEncoder.ownerAPI.encode([item]).write(to: itemsURL)
        let report = RealEstateOriginalsPreflight(
            checkedAt: "2026-08-07T10:00:00.000Z",
            ok: false,
            galleryKey: "corine-real-estate",
            requestedCount: 1,
            availableCount: 0,
            missingCount: 1,
            totalBytes: 0,
            items: [.init(
                photoId: item.photoId,
                name: "001-missing.jpg",
                contentType: "image/jpeg",
                available: false
            )],
            message: "1 selected original is not ready in private storage."
        )
        let service = BackstageControlService(realEstateOriginalsPreflight: { _ in
            RealEstateOriginalsPreflightEnvelope(preflight: report)
        })

        let missingExitCode = await BackstageControlCLI.run(
            arguments: [
                "real-estate", "originals", "preflight",
                "--gallery", "corine-real-estate",
                "--items-file", itemsURL.path,
            ],
            service: service,
            output: { _ in }
        )
        #expect(missingExitCode == 2)

        let output = LockedStringOutput()
        let invalidExitCode = await BackstageControlCLI.run(
            arguments: ["real-estate", "originals", "preflight", "--gallery", "corine-real-estate"],
            service: service,
            output: { output.append($0) }
        )
        #expect(invalidExitCode == 64)
        let payload = try #require(output.values().last)
        #expect(payload.contains("invalid_arguments"))
        #expect(payload.contains("--items-file"))
    }
}

@Suite("Retired Photos Bridge lifecycle")
struct RetiredPhotosBridgeLifecycleTests {
    @Test("Launch retirement moves every legacy live root into one recoverable archive")
    func retiresAllLegacyLiveRoots() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbb-92-retirement-\(UUID().uuidString)", isDirectory: true)
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        let retirementRoot = applications.appendingPathComponent("Retired", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        for name in RetiredPhotosBridgeService.liveArtifactNames {
            let artifact = applications.appendingPathComponent(name, isDirectory: true)
            try FileManager.default.createDirectory(at: artifact, withIntermediateDirectories: true)
            try Data(name.utf8).write(to: artifact.appendingPathComponent("marker"))
        }
        let historical = applications.appendingPathComponent(
            "PhotosByElie Retired Bridge Artifacts/older-audit",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: historical, withIntermediateDirectories: true)

        let result = try RetiredPhotosBridgeService(
            applicationsDirectory: applications,
            retirementRoot: retirementRoot,
            retirementFolderName: "candidate-229.4"
        ).retireInstalledArtifacts()

        #expect(result.retiredNames == RetiredPhotosBridgeService.liveArtifactNames)
        let archive = try #require(result.archiveDirectory)
        for name in RetiredPhotosBridgeService.liveArtifactNames {
            #expect(!FileManager.default.fileExists(
                atPath: applications.appendingPathComponent(name).path
            ))
            #expect(FileManager.default.fileExists(
                atPath: archive.appendingPathComponent(name + "/marker").path
            ))
        }
        #expect(FileManager.default.fileExists(atPath: historical.path))
    }

    @Test("Launch retirement is a no-op when no legacy live root exists")
    func noLegacyRootIsNoOp() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbb-92-noop-\(UUID().uuidString)", isDirectory: true)
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        let retirementRoot = applications.appendingPathComponent("Retired", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let result = try RetiredPhotosBridgeService(
            applicationsDirectory: applications,
            retirementRoot: retirementRoot,
            retirementFolderName: "candidate-229.4"
        ).retireInstalledArtifacts()

        #expect(result.archiveDirectory == nil)
        #expect(result.retiredNames.isEmpty)
        #expect(!FileManager.default.fileExists(atPath: retirementRoot.path))
    }
}

@Suite("PBE Owner host and session contract")
struct PBEOwnerHostContractTests {
    private let sessionJSON = """
    {
      "ok": true,
      "tokenType": "Bearer",
      "sessionToken": "short-lived-pbe-token",
      "session": {
        "id": "pbe-owner-session-one",
        "state": "ready",
        "fixtureId": "fixture-la-concha",
        "fixtureBreadcrumb": "RE › La Concha",
        "sourceIdentity": "owner-sqlite:sha256:abc",
        "catalogIdentity": "catalog-sqlite:sha256:def",
        "readinessIdentity": "pbe-readiness:sha256:ghi",
        "fixtureRevision": "fixture-revision:sha256:jkl",
        "capabilities": ["gallery.read", "waste-basket.x", "waste-basket.restore"],
        "lifecycleWriter": "pbb-79-waste-basket",
        "createdAt": "2030-01-01T11:55:00Z",
        "expiresAt": "2030-01-01T12:00:00Z",
        "closedAt": ""
      }
    }
    """

    @Test("Host launch rejects dirty, hidden, and stray Python code")
    func checkoutIdentityFailsClosed() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-owner-checkout-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("scripts", isDirectory: true),
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: root) }

        try "node_modules/\nscripts/ignored_shadow.py\n".write(
            to: root.appendingPathComponent(".gitignore"),
            atomically: true,
            encoding: .utf8
        )
        try ":(glob)scripts/**/*.py\n".write(
            to: root.appendingPathComponent("scripts/pbe_owner_host_tracked_paths.txt"),
            atomically: true,
            encoding: .utf8
        )
        for name in ["local_server.py", "pbe_owner_session.py", "waste_basket_gateway.py"] {
            try "# \(name)\n".write(
                to: root.appendingPathComponent("scripts/\(name)"),
                atomically: true,
                encoding: .utf8
            )
        }
        try runGit(root, ["init", "-q"])
        try runGit(root, ["config", "user.name", "PBE Test"])
        try runGit(root, ["config", "user.email", "pbe-test@example.invalid"])
        try runGit(root, ["add", "."])
        try runGit(root, ["commit", "-qm", "fixture"])

        let cleanIdentity = try PBEOwnerCheckoutIdentity.verified(repositoryRoot: root)
        #expect(cleanIdentity.range(
            of: "^git:[0-9a-f]{40,64}:pbe-host-sha256:[0-9a-f]{64}$",
            options: .regularExpression
        ) != nil)

        let ignored = root.appendingPathComponent("node_modules/example/index.js")
        try FileManager.default.createDirectory(
            at: ignored.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try "ignored dependency\n".write(to: ignored, atomically: true, encoding: .utf8)
        #expect(try PBEOwnerCheckoutIdentity.verified(repositoryRoot: root) == cleanIdentity)

        let bytecodeCache = root.appendingPathComponent(
            "scripts/__pycache__/local_server.cpython-314.pyc"
        )
        try FileManager.default.createDirectory(
            at: bytecodeCache.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data("isolated launch cache".utf8).write(to: bytecodeCache)
        #expect(try PBEOwnerCheckoutIdentity.verified(repositoryRoot: root) == cleanIdentity)

        let importShadow = root.appendingPathComponent("scripts/json.py")
        try "raise RuntimeError('executed before attestation')\n".write(
            to: importShadow,
            atomically: true,
            encoding: .utf8
        )
        let localHost = PBEOwnerLocalHostService(
            transport: RoutingTransport(responses: [:]),
            repositoryRoot: root
        )
        do {
            _ = try await localHost.ensureReadiness(fixtureID: "fixture-la-concha")
            Issue.record("Backstage launched a host with an untracked scripts/json.py")
        } catch let error as APIErrorEnvelope {
            #expect(error.error.code == "pbe_owner_checkout_stray_import")
        }
        await localHost.stopIfLaunched()
        try FileManager.default.removeItem(at: importShadow)

        let ignoredShadow = root.appendingPathComponent("scripts/ignored_shadow.py")
        try "raise RuntimeError('ignored shadow')\n".write(
            to: ignoredShadow,
            atomically: true,
            encoding: .utf8
        )
        do {
            _ = try PBEOwnerCheckoutIdentity.verified(repositoryRoot: root)
            Issue.record("An ignored Python import shadow was accepted")
        } catch let error as APIErrorEnvelope {
            #expect(error.error.code == "pbe_owner_checkout_stray_import")
        }
        try FileManager.default.removeItem(at: ignoredShadow)

        let strayExecutable = root.appendingPathComponent("scripts/stray-host-helper")
        try "#!/bin/sh\nexit 0\n".write(
            to: strayExecutable,
            atomically: true,
            encoding: .utf8
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: strayExecutable.path
        )
        do {
            _ = try PBEOwnerCheckoutIdentity.verified(repositoryRoot: root)
            Issue.record("An untracked executable in the Python host scope was accepted")
        } catch let error as APIErrorEnvelope {
            #expect(error.error.code == "pbe_owner_checkout_stray_import")
        }
        try FileManager.default.removeItem(at: strayExecutable)

        let host = root.appendingPathComponent("scripts/local_server.py")
        try "# dirty tracked host\n".write(to: host, atomically: true, encoding: .utf8)
        do {
            _ = try PBEOwnerCheckoutIdentity.verified(repositoryRoot: root)
            Issue.record("A dirty tracked host checkout was accepted")
        } catch let error as APIErrorEnvelope {
            #expect(error.error.code == "pbe_owner_checkout_dirty")
        }

        try runGit(root, ["checkout", "--", "scripts/local_server.py"])
        try runGit(root, ["update-index", "--assume-unchanged", "scripts/local_server.py"])
        try "# hidden tracked host change\n".write(to: host, atomically: true, encoding: .utf8)
        do {
            _ = try PBEOwnerCheckoutIdentity.verified(repositoryRoot: root)
            Issue.record("An assume-unchanged tracked host mutation was accepted")
        } catch let error as APIErrorEnvelope {
            #expect(error.error.code == "pbe_owner_checkout_content_mismatch")
        }
    }

    @Test("Installed runtime attestation rejects tampering and symlinks")
    func installedRuntimeIdentityFailsClosed() throws {
        let fixtureRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-owner-runtime-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: fixtureRoot, withIntermediateDirectories: true)
        defer {
            makeWritable(fixtureRoot)
            try? FileManager.default.removeItem(at: fixtureRoot)
        }

        func makeRuntime(named name: String) throws -> URL {
            let root = fixtureRoot.appendingPathComponent(name, isDirectory: true)
            let scripts = root.appendingPathComponent("scripts", isDirectory: true)
            try FileManager.default.createDirectory(at: scripts, withIntermediateDirectories: true)
            let files: [String: Data] = [
                "scripts/pbe_owner_host_tracked_paths.txt": Data("gallery.html\n".utf8),
                "scripts/local_server.py": Data("# local host\n".utf8),
                "scripts/pbe_owner_session.py": Data("# session host\n".utf8),
                "scripts/waste_basket_gateway.py": Data("# waste basket\n".utf8),
                "gallery.html": Data("<!doctype html><title>Owner runtime</title>\n".utf8),
            ]
            var entries: [[String: Any]] = []
            for path in files.keys.sorted() {
                let data = try #require(files[path])
                let destination = root.appendingPathComponent(path)
                try data.write(to: destination)
                try FileManager.default.setAttributes(
                    [.posixPermissions: 0o444],
                    ofItemAtPath: destination.path
                )
                entries.append([
                    "path": path,
                    "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
                    "size": data.count,
                    "mode": "0444",
                ])
            }
            let manifest: [String: Any] = [
                "schemaVersion": 2,
                "kind": "photosbyelie-owner-connector-runtime",
                "sourceRevision": String(repeating: "a", count: 40),
                "files": entries,
                "pbeOwnerHost": [
                    "scopeManifest": "scripts/pbe_owner_host_tracked_paths.txt",
                    "files": files.keys.sorted(),
                ],
            ]
            let manifestURL = root.appendingPathComponent("connector-runtime-manifest.json")
            try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted])
                .write(to: manifestURL)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o444],
                ofItemAtPath: manifestURL.path
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o555],
                ofItemAtPath: scripts.path
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o555],
                ofItemAtPath: root.path
            )
            return root
        }

        let clean = try makeRuntime(named: "clean")
        #expect(
            try PBEOwnerCheckoutIdentity.verified(repositoryRoot: clean)
                == "runtime:\(String(repeating: "a", count: 40)):pbe-host-sha256:"
                + "75a383e01ec8dc07680edda4b442b1318fc525f09113cebe866ac2f9a5a4c615"
        )

        let tampered = try makeRuntime(named: "tampered")
        let tamperedGallery = tampered.appendingPathComponent("gallery.html")
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: tampered.path
        )
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: tamperedGallery.path)
        try "tampered\n".write(to: tamperedGallery, atomically: true, encoding: .utf8)
        #expect(throws: APIErrorEnvelope.self) {
            try PBEOwnerCheckoutIdentity.verified(repositoryRoot: tampered)
        }

        let symlinked = try makeRuntime(named: "symlinked")
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: symlinked.path)
        let symlinkedGallery = symlinked.appendingPathComponent("gallery.html")
        try FileManager.default.removeItem(at: symlinkedGallery)
        try FileManager.default.createSymbolicLink(
            at: symlinkedGallery,
            withDestinationURL: clean.appendingPathComponent("gallery.html")
        )
        #expect(throws: APIErrorEnvelope.self) {
            try PBEOwnerCheckoutIdentity.verified(repositoryRoot: symlinked)
        }
    }

    @Test("Installed Owner runtime and mutable data root resolve independently")
    func installedRuntimeUsesSplitRoots() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-owner-split-root-\(UUID().uuidString)", isDirectory: true)
        let bundleRuntime = root.appendingPathComponent("signed-app/OwnerRuntime", isDirectory: true)
        let dataRoot = root.appendingPathComponent("mutable-data", isDirectory: true)
        let configURL = root.appendingPathComponent("connector.json")
        try FileManager.default.createDirectory(
            at: bundleRuntime.appendingPathComponent("scripts", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: dataRoot.appendingPathComponent("assets/owner-actions", isDirectory: true),
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: root) }
        try Data().write(to: bundleRuntime.appendingPathComponent("scripts/local_server.py"))
        try Data().write(to: dataRoot.appendingPathComponent("assets/owner-actions/Owner.sqlite"))
        try JSONSerialization.data(withJSONObject: [
            "repoRoot": dataRoot.path,
            "runtimeRoot": root.appendingPathComponent("stale-runtime").path,
        ]).write(to: configURL)

        let roots = PBEOwnerRuntimeRoots.resolve(
            environment: [:],
            bundleRuntimeRoot: bundleRuntime,
            connectorConfigURL: configURL,
            homeDirectory: root.appendingPathComponent("home", isDirectory: true)
        )
        #expect(roots.runtimeRoot == bundleRuntime.standardizedFileURL)
        #expect(roots.dataRoot == dataRoot.standardizedFileURL)
        #expect(!FileManager.default.fileExists(
            atPath: dataRoot.appendingPathComponent("scripts/pbe_owner_host_tracked_paths.txt").path
        ))
    }

    @Test("On-demand Owner connector plans require the sealed runtime and mutable Owner data")
    func onDemandOwnerConnectorPlanIsBounded() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-owner-on-demand-(UUID().uuidString)", isDirectory: true)
        let runtimeRoot = root.appendingPathComponent("runtime", isDirectory: true)
        let dataRoot = root.appendingPathComponent("data", isDirectory: true)
        let configURL = root.appendingPathComponent("connector.json")
        let pythonURL = root.appendingPathComponent("python3")
        try FileManager.default.createDirectory(
            at: runtimeRoot.appendingPathComponent("scripts", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: dataRoot.appendingPathComponent("assets/owner-actions", isDirectory: true),
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("#!/usr/bin/env python3\n".utf8).write(
            to: runtimeRoot.appendingPathComponent("scripts/new_owner_connector.py")
        )
        try Data().write(to: dataRoot.appendingPathComponent("assets/owner-actions/Owner.sqlite"))
        try Data("{}\n".utf8).write(to: configURL)
        try Data().write(to: pythonURL)

        let plan = try OnDemandOwnerActionWaker.makeLaunchPlan(
            runtimeRoot: runtimeRoot,
            dataRoot: dataRoot,
            configURL: configURL,
            pythonExecutable: pythonURL
        )
        #expect(plan.scriptURL == runtimeRoot.appendingPathComponent("scripts/new_owner_connector.py"))
        #expect(plan.dataRoot == dataRoot)
        #expect(throws: APIErrorEnvelope.self) {
            try OnDemandOwnerActionWaker.makeLaunchPlan(
                runtimeRoot: runtimeRoot,
                dataRoot: dataRoot,
                configURL: root.appendingPathComponent("missing.json"),
                pythonExecutable: pythonURL
            )
        }
    }

    private func makeWritable(_ root: URL) {
        guard FileManager.default.fileExists(atPath: root.path) else { return }
        if let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) {
            let paths = enumerator.allObjects.compactMap { $0 as? URL }
                .sorted { $0.pathComponents.count > $1.pathComponents.count }
            for path in paths {
                try? FileManager.default.setAttributes(
                    [.posixPermissions: path.hasDirectoryPath ? 0o700 : 0o600],
                    ofItemAtPath: path.path
                )
            }
        }
        try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
    }

    @Test("Backstage bearer mints a fully bound short-lived session")
    func mintRequestCarriesEveryBinding() async throws {
        let transport = RoutingTransport(responses: [
            "/api/v1/pbe-owner/sessions": sessionJSON,
        ])
        let api = OwnerAPIClient(
            baseURL: URL(string: "https://worker.test/api/v1")!,
            transport: transport
        )
        await api.setAccessToken("backstage-device-access")
        let response = try await api.mintPBEOwnerSession(.init(
            fixtureId: "fixture-la-concha",
            fixtureBreadcrumb: "RE › La Concha",
            sourceIdentity: "owner-sqlite:sha256:abc",
            catalogIdentity: "catalog-sqlite:sha256:def",
            readinessIdentity: "pbe-readiness:sha256:ghi",
            fixtureRevision: "fixture-revision:sha256:jkl"
        ))
        #expect(response.session.lifecycleWriter == "pbb-79-waste-basket")
        #expect(response.sessionToken == "short-lived-pbe-token")
        let request = try #require(await transport.requests().first)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer backstage-device-access")
        let body = try #require(request.httpBody)
        let payload = try JSONSerialization.jsonObject(with: body) as? [String: String]
        #expect(payload?["fixtureId"] == "fixture-la-concha")
        #expect(payload?["sourceIdentity"] == "owner-sqlite:sha256:abc")
        #expect(payload?["catalogIdentity"] == "catalog-sqlite:sha256:def")
        #expect(payload?["readinessIdentity"] == "pbe-readiness:sha256:ghi")
        #expect(payload?["fixtureRevision"] == "fixture-revision:sha256:jkl")
    }

    @Test("Local host attach uses authorization header and never a token query")
    func hostAttachKeepsTokenOutOfURL() async throws {
        let localSession = sessionJSON
            .replacingOccurrences(of: "\"tokenType\": \"Bearer\",", with: "")
            .replacingOccurrences(of: "\"sessionToken\": \"short-lived-pbe-token\",", with: "")
            .replacingOccurrences(
                of: "\"createdAt\": \"2030-01-01T11:55:00Z\",",
                with: "\"leaseExpiresAt\": \"2030-01-01T11:57:00Z\","
            )
            .replacingOccurrences(
                of: "\"closedAt\": \"\"",
                with: "\"closedAt\": \"\""
            )
            .replacingOccurrences(
                of: "\n    }\n    ",
                with: "\n    },\n      \"launchUrl\": \"http://127.0.0.1:8000/gallery.html?gallery=pbe-owner#pbe_owner_ticket=one-time-opaque-handoff\"\n    "
            )
        let transport = RoutingTransport(responses: [
            "/__photosbyelie/pbe-owner/session/start": localSession,
        ])
        let host = PBEOwnerLocalHostService(
            baseURL: URL(string: "http://127.0.0.1:43119/__photosbyelie/pbe-owner")!,
            transport: transport,
            repositoryRoot: FileManager.default.temporaryDirectory,
            hostAuthorization: "preauthenticated-test-host"
        )
        let attached = try await host.attach(
            sessionToken: "short-lived-pbe-token",
            fixtureID: "fixture-la-concha"
        )
        #expect(attached.session.fixtureId == "fixture-la-concha")
        let request = try #require(await transport.requests().first)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer short-lived-pbe-token")
        #expect(request.value(forHTTPHeaderField: "X-PBE-Host-Authorization") == "preauthenticated-test-host")
        #expect(request.url?.query?.contains("token") != true)
        #expect(request.url?.fragment == nil)
    }

    @Test("Actionable fixture lease rejects missing identities and fixture drift")
    func fixtureLeaseFailsClosed() throws {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let fixtures = [
            FixtureNode(id: "fixture-expo", name: "Expo"),
            FixtureNode(id: "fixture-la-concha", name: "La Concha"),
        ]
        var coordinator = FixtureSelectionCoordinator(lastUsedFixtureID: "fixture-la-concha")
        coordinator.restore(from: fixtures, now: now)
        let incomplete = PBEOwnerFixtureSession(
            sessionID: "session-one",
            fixtureID: "fixture-la-concha",
            fixtureBreadcrumb: "La Concha",
            expiresAt: now.addingTimeInterval(300)
        )
        #expect(throws: FixtureSelectionError.invalidOwnerSessionContract) {
            try coordinator.beginPBEOwnerSession(incomplete, now: now)
        }

        let drifted = PBEOwnerFixtureSession(
            sessionID: "session-one",
            fixtureID: "fixture-expo",
            fixtureBreadcrumb: "Expo",
            sourceIdentity: "owner-sqlite:sha256:abc",
            catalogIdentity: "catalog-sqlite:sha256:def",
            readinessIdentity: "pbe-readiness:sha256:ghi",
            fixtureRevision: "fixture-revision:sha256:jkl",
            capabilities: ["gallery.read", "waste-basket.x", "waste-basket.restore"],
            lifecycleWriter: "pbb-79-waste-basket",
            expiresAt: now.addingTimeInterval(300)
        )
        #expect(throws: FixtureSelectionError.ownerSessionMismatch) {
            try coordinator.beginPBEOwnerSession(drifted, now: now)
        }
    }
}

private func runGit(_ root: URL, _ arguments: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
    process.arguments = ["-C", root.path] + arguments
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        throw CocoaError(.fileWriteUnknown)
    }
}

private final class LockedStringOutput: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func append(_ value: String) {
        lock.withLock { storage.append(value) }
    }

    func values() -> [String] {
        lock.withLock { storage }
    }
}

private func backstageUpdateManifestFixture() throws -> BackstageReleaseManifest {
    let url = try #require(Bundle.module.url(
        forResource: "backstage-release-update",
        withExtension: "json",
        subdirectory: "Fixtures"
    ))
    return try JSONDecoder().decode(BackstageReleaseManifest.self, from: Data(contentsOf: url))
}

private func backstageUpdateManifestAndArtifactFixture() throws -> (
    manifest: BackstageReleaseManifest,
    artifactData: Data
) {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("pbe-update-archive-fixture-\(UUID().uuidString)", isDirectory: true)
    let sourceApp = root.appendingPathComponent("PhotosByElie Backstage.app", isDirectory: true)
    let contents = sourceApp.appendingPathComponent("Contents", isDirectory: true)
    let archive = root.appendingPathComponent("Backstage.zip")
    try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
    try Data([0x50, 0x42, 0x45]).write(to: contents.appendingPathComponent("fixture.bin"))
    try createZipArchive(sourceApp: sourceApp, destination: archive)
    defer { try? FileManager.default.removeItem(at: root) }

    var manifest = try backstageUpdateManifestFixture()
    let attributes = try FileManager.default.attributesOfItem(atPath: archive.path)
    manifest.fileSize = try #require((attributes[.size] as? NSNumber)?.int64Value)
    manifest.sha256 = try BackstageUpdateService.sha256(of: archive)
    return (manifest, try Data(contentsOf: archive))
}

private struct StubBackstageUpdateTransport: BackstageUpdateTransport {
    let manifestData: Data
    let artifactData: Data

    func fetchManifest(from url: URL) async throws -> Data { manifestData }

    func download(
        from url: URL,
        to destination: URL,
        expectedFileSize: Int64,
        maximumFileSize: Int64,
        progress: @escaping @Sendable (Int64, Int64) -> Void
    ) async throws {
        let size = Int64(artifactData.count)
        guard size == expectedFileSize, size <= maximumFileSize else {
            throw BackstageUpdateError.downloadFailed("Synthetic bounded download rejected its size.")
        }
        progress(0, expectedFileSize)
        try artifactData.write(to: destination, options: .atomic)
        progress(size, expectedFileSize)
    }
}

private struct StubBackstageArtifactExtractor: BackstageUpdateArtifactExtracting {
    var version = "219.2"
    var build = "78"
    var extraFileCount = 0
    var extraFileSize = 0

    func extractAppBundle(from archiveURL: URL, to directoryURL: URL) throws -> URL {
        let app = directoryURL.appendingPathComponent("PhotosByElie Backstage.app", isDirectory: true)
        let contents = app.appendingPathComponent("Contents", isDirectory: true)
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        let plist: [String: Any] = [
            "CFBundleIdentifier": "com.photosbyelie.backstage",
            "CFBundleShortVersionString": version,
            "CFBundleVersion": build,
            "CFBundlePackageType": "APPL",
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: contents.appendingPathComponent("Info.plist"))
        for index in 0..<extraFileCount {
            try Data(repeating: UInt8(index % 255), count: extraFileSize).write(
                to: contents.appendingPathComponent("extra-\(index).bin")
            )
        }
        return app
    }
}

private struct EscapingBackstageArtifactExtractor: BackstageUpdateArtifactExtracting {
    func extractAppBundle(from archiveURL: URL, to directoryURL: URL) throws -> URL {
        URL(fileURLWithPath: "/tmp/PhotosByElie Outside.app", isDirectory: true)
    }
}

private struct RecordingBackstageArtifactExtractor: BackstageUpdateArtifactExtracting {
    let called: LockedFlag

    func extractAppBundle(from archiveURL: URL, to directoryURL: URL) throws -> URL {
        called.set()
        throw BackstageUpdateError.archiveInvalid("Extractor should not have been invoked.")
    }
}

private struct StubBackstageSignatureVerifier: BackstageCodeSignatureVerifying {
    func verify(
        bundleURL: URL,
        expectedBundleIdentifier: String,
        trust: BackstageReleaseTrust
    ) throws {}
}

private struct StubBackstageCurrentTrustReader: BackstageCurrentReleaseTrustReading {
    let trust: BackstageReleaseTrust

    func readTrust(bundleURL: URL) throws -> BackstageReleaseTrust { trust }
}

private struct FailingBackstageSignatureVerifier: BackstageCodeSignatureVerifying {
    func verify(
        bundleURL: URL,
        expectedBundleIdentifier: String,
        trust: BackstageReleaseTrust
    ) throws {
        throw BackstageUpdateError.signatureMismatch("Synthetic signature mismatch.")
    }
}

private struct FailingInstalledCandidateSignatureVerifier: BackstageCodeSignatureVerifying {
    let canonicalPath: String
    let candidateBuild: String

    func verify(
        bundleURL: URL,
        expectedBundleIdentifier: String,
        trust: BackstageReleaseTrust
    ) throws {
        let build = try? syntheticBackstageBuild(at: bundleURL)
        if bundleURL.path == canonicalPath, build == candidateBuild {
            throw BackstageUpdateError.signatureMismatch("Synthetic post-swap signature failure.")
        }
    }
}

private struct ProgressSample: Sendable {
    let received: Int64
    let total: Int64
}

private final class LockedProgress: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var values: [ProgressSample] = []

    func append(received: Int64, total: Int64) {
        lock.withLock { values.append(ProgressSample(received: received, total: total)) }
    }
}

private final class StreamingBackstageURLProtocol: URLProtocol, @unchecked Sendable {
    private static let fixture = LockedDataFixture()

    static func setResponse(_ data: Data) {
        fixture.set(data)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let client, let url = request.url else { return }
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: nil
        )!
        client.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client.urlProtocol(self, didLoad: Self.fixture.get())
        client.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private final class LockedDataFixture: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()

    func set(_ data: Data) {
        lock.withLock { self.data = data }
    }

    func get() -> Data {
        lock.withLock { data }
    }
}

private final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var storage = false

    func set() {
        lock.withLock { storage = true }
    }

    func value() -> Bool {
        lock.withLock { storage }
    }
}

private func createZipArchive(sourceApp: URL, destination: URL) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
    process.arguments = [
        "-c", "-k", "--sequesterRsrc", "--keepParent",
        sourceApp.path, destination.path,
    ]
    let pipe = Pipe()
    process.standardError = pipe
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        let message = String(
            data: pipe.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        throw BackstageUpdateError.archiveInvalid("Synthetic ZIP creation failed: \(message)")
    }
}

private func createSyntheticBackstageApp(
    at appURL: URL,
    version: String,
    build: String,
    identifier: String = BackstageReleaseManifest.bundleIdentifier
) throws {
    let contents = appURL.appendingPathComponent("Contents", isDirectory: true)
    try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
    let plist: [String: Any] = [
        "CFBundleIdentifier": identifier,
        "CFBundleShortVersionString": version,
        "CFBundleVersion": build,
        "CFBundlePackageType": "APPL",
    ]
    let data = try PropertyListSerialization.data(
        fromPropertyList: plist,
        format: .xml,
        options: 0
    )
    try data.write(to: contents.appendingPathComponent("Info.plist"))
    try Data("bundle payload \(version) \(build)".utf8).write(
        to: contents.appendingPathComponent("payload.bin")
    )
}

private func syntheticBackstageBuild(at appURL: URL) throws -> String {
    let data = try Data(contentsOf: appURL.appendingPathComponent("Contents/Info.plist"))
    let plist = try #require(
        PropertyListSerialization.propertyList(from: data, options: [], format: nil)
            as? [String: Any]
    )
    return try #require(plist["CFBundleVersion"] as? String)
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
    guard sqlite3_step(statement) == SQLITE_ROW else {
        throw OwnerDatabaseError.unavailable("test scalar unavailable")
    }
    return String(cString: sqlite3_column_text(statement, 0))
}

private struct StaticPhotoLibrary: PhotoLibraryServing {
    let access: PhotoLibraryAccess

    func authorization() -> PhotoLibraryAccess { access }

    func requestAuthorization() async -> PhotoLibraryAccess { access }

    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(localIdentifier: String, maxPixelSize: Int) async throws -> PhotoPreview {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }

    func exportOriginal(localIdentifier: String, to directory: URL) async throws -> PhotoExportReceipt {
        throw PhotoLibraryError.assetNotFound(localIdentifier)
    }
}

private final class MemoryCredentialVault: CredentialVault, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]

    func read(account: String) throws -> Data? {
        lock.withLock { values[account] }
    }

    func write(_ data: Data, account: String) throws {
        lock.withLock { values[account] = data }
    }

    func delete(account: String) throws {
        lock.withLock { _ = values.removeValue(forKey: account) }
    }
}

private final class ControlledFailureCredentialVault: CredentialVault, @unchecked Sendable {
    private let lock = NSLock()
    private var storedValue: Data?
    private let failReads: Bool
    private let failWrites: Bool
    private let failDeletes: Bool

    init(
        value: Data? = nil,
        failReads: Bool = false,
        failWrites: Bool = false,
        failDeletes: Bool = false
    ) {
        storedValue = value
        self.failReads = failReads
        self.failWrites = failWrites
        self.failDeletes = failDeletes
    }

    func read(account: String) throws -> Data? {
        if failReads { throw URLError(.cannotLoadFromNetwork) }
        return lock.withLock { storedValue }
    }

    func write(_ data: Data, account: String) throws {
        if failWrites { throw URLError(.cannotWriteToFile) }
        lock.withLock { storedValue = data }
    }

    func delete(account: String) throws {
        if failDeletes { throw URLError(.cannotRemoveFile) }
        lock.withLock { storedValue = nil }
    }

    func value() -> Data? {
        lock.withLock { storedValue }
    }
}

private actor RecordingTransport: OwnerAPITransport {
    private var request: URLRequest?
    private let responseData: Data

    init(response: String) {
        responseData = Data(response.utf8)
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        self.request = request
        return (
            responseData,
            HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        )
    }

    func lastRequest() -> URLRequest? { request }
}

private actor RoutingTransport: OwnerAPITransport {
    private let responses: [String: Data]
    private var recorded: [URLRequest] = []

    init(responses: [String: String]) {
        self.responses = responses.mapValues { Data($0.utf8) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        recorded.append(request)
        let path = request.url?.path ?? ""
        guard let data = responses[path] else {
            throw URLError(.resourceUnavailable)
        }
        return (
            data,
            HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        )
    }

    func requests() -> [URLRequest] { recorded }
}

private struct SequencedTransportResponse: Sendable {
    let status: Int
    let body: String
}

private actor SequencedRoutingTransport: OwnerAPITransport {
    private var responses: [String: [SequencedTransportResponse]]
    private var recorded: [URLRequest] = []

    init(responses: [String: [SequencedTransportResponse]]) {
        self.responses = responses
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        recorded.append(request)
        let path = request.url?.path ?? ""
        guard var routeResponses = responses[path], !routeResponses.isEmpty else {
            throw URLError(.resourceUnavailable)
        }
        let response = routeResponses.removeFirst()
        responses[path] = routeResponses
        return (
            Data(response.body.utf8),
            HTTPURLResponse(url: request.url!, statusCode: response.status, httpVersion: nil, headerFields: nil)!
        )
    }

    func requests() -> [URLRequest] { recorded }
}

private struct UnavailableWaker: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? {
        throw URLError(.cannotConnectToHost)
    }
}

private struct DelayedWaker: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? {
        try await Task.sleep(for: .seconds(10))
        return nil
    }
}

private actor OwnerActionWakeRecorder {
    private var actionIDs: [String] = []

    func append(_ actionID: String) {
        actionIDs.append(actionID)
    }

    func values() -> [String] {
        actionIDs
    }

    func waitForValues(
        count: Int,
        timeout: Duration = .seconds(1)
    ) async -> [String] {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while actionIDs.count < count, clock.now < deadline {
            try? await Task.sleep(for: .milliseconds(1))
        }
        return actionIDs
    }
}

private struct RecordingWaker: OwnerActionWaking {
    let recorder: OwnerActionWakeRecorder

    func wake(actionID: String) async throws -> OwnerAction? {
        await recorder.append(actionID)
        return nil
    }
}

private final class OwnerActionUpdateRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [OwnerAction] = []

    func append(_ action: OwnerAction) {
        lock.lock()
        values.append(action)
        lock.unlock()
    }

    var states: [OwnerActionState] {
        lock.lock()
        defer { lock.unlock() }
        return values.map(\.state)
    }

    var phases: [String] {
        lock.lock()
        defer { lock.unlock() }
        return values.map(\.diagnosticPhaseName)
    }
}

private actor PendingOwnerActionAPI: OwnerActionServing {
    func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String
    ) async throws -> OwnerActionEnvelope {
        OwnerActionEnvelope(
            action: OwnerAction(
                id: "owner-action-pending-fixture-tree",
                actionKind: action.actionKind,
                target: action.target,
                state: .queued
            ),
            idempotencyReplayed: false
        )
    }

    func getAction(id: String) async throws -> OwnerAction {
        OwnerAction(
            id: id,
            actionKind: "sidecar-culling-review",
            target: "max",
            state: .queued
        )
    }
}

private actor ScriptedOwnerActionAPI: OwnerActionServing {
    private var completed: [OwnerAction]
    private var created: [OwnerActionCreate] = []
    private var keys: [String] = []

    init(completed: [OwnerAction]) {
        self.completed = completed
    }

    func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String
    ) async throws -> OwnerActionEnvelope {
        created.append(action)
        keys.append(idempotencyKey)
        let index = created.count - 1
        let terminal = completed[index]
        return OwnerActionEnvelope(
            action: OwnerAction(
                id: terminal.id,
                actionKind: action.actionKind,
                target: action.target,
                state: .queued
            ),
            idempotencyReplayed: false
        )
    }

    func getAction(id: String) async throws -> OwnerAction {
        guard let action = completed.first(where: { $0.id == id }) else {
            throw URLError(.resourceUnavailable)
        }
        return action
    }

    func requests() -> [OwnerActionCreate] { created }
    func idempotencyKeys() -> [String] { keys }
}
@Suite("PBE Owner native host route contract")
struct PBEOwnerNativeHostContractTests {
    @Test("Native host parser accepts one bounded HTTP request")
    func parsesBoundedRequest() throws {
        let request = try PBEOwnerHTTPRequestParser().parse(Data(
            "POST /__photosbyelie/pbe-owner/action?x=1 HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}".utf8
        ))
        #expect(request.method == "POST")
        #expect(request.path == "/__photosbyelie/pbe-owner/action")
        #expect(request.body == Data("{}".utf8))
    }

    @Test("Native host parser rejects request smuggling boundaries")
    func rejectsAmbiguousRequests() {
        let duplicateLength = Data(
            "POST / HTTP/1.1\r\nContent-Length: 0\r\nContent-Length: 0\r\n\r\n".utf8
        )
        #expect(throws: PBEOwnerHTTPRequestParserError.duplicateSensitiveHeader("content-length")) {
            try PBEOwnerHTTPRequestParser().parse(duplicateLength)
        }
        let chunked = Data("POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n".utf8)
        #expect(throws: PBEOwnerHTTPRequestParserError.unsupportedTransferEncoding) {
            try PBEOwnerHTTPRequestParser().parse(chunked)
        }
    }

    @Test("Native host exposes only the actionable gallery session surface")
    func exactRoutes() {
        let routes = PBEOwnerNativeHostContract.routes
        #expect(routes.count == 11)
        #expect(PBEOwnerNativeHostContract.route(
            method: "POST",
            path: "/__photosbyelie/pbe-owner/browser/bootstrap"
        )?.authority == .browserHandoff)
        #expect(PBEOwnerNativeHostContract.route(
            method: "GET",
            path: "/__photosbyelie/source-preview/asset-123"
        )?.authority == .browserSession)
        #expect(PBEOwnerNativeHostContract.route(
            method: "POST",
            path: "/__photosbyelie/source-preview/asset-123"
        ) == nil)
    }

    @Test("Legacy local Owner endpoints are not native host routes")
    func legacyRoutesStayAbsent() {
        for (method, path) in [
            ("POST", "/__photosbyelie/photo-action"),
            ("GET", "/__photosbyelie/title-keyword-review-queue"),
            ("POST", "/__photosbyelie/r2-fix"),
            ("POST", "/__photosbyelie/apple-photos/import"),
            ("POST", "/__photosbyelie/source-edit"),
            ("POST", "/__photosbyelie/publish-prices"),
            ("POST", "/__photosbyelie/new-owner-connector"),
            ("POST", "/__photosbyelie/pbe-owner/action/projection-retry"),
        ] {
            #expect(PBEOwnerNativeHostContract.route(method: method, path: path) == nil)
        }
    }
}
