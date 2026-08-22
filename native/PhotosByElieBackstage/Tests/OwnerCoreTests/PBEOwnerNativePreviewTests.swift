import Foundation
import Testing
@testable import OwnerCore

@Suite("PBE Owner native source preview")
struct PBEOwnerNativePreviewTests {
    @Test("Preview reads only a browser-visible frozen-fixture asset")
    func visibleAssetPreview() async throws {
        let jpeg = Data([0xff, 0xd8, 0x01, 0xff, 0xd9])
        let service = PBEOwnerNativePreviewService(
            galleryProvider: { _ in gallery() },
            photoLibrary: PBEOwnerPreviewPhotoLibraryStub { identifier, maxPixel in
                #expect(identifier == "photos-one")
                #expect(maxPixel == 1_800)
                return PhotoPreview(
                    assetID: identifier,
                    jpegData: jpeg,
                    pixelWidth: 1_200,
                    pixelHeight: 800
                )
            }
        )

        let preview = try await service.preview(
            session: session(),
            assetID: "asset-one"
        )

        #expect(preview.assetId == "asset-one")
        #expect(preview.jpegData == jpeg)
        #expect(preview.pixelWidth == 1_200)
        #expect(preview.pixelHeight == 800)
    }

    @Test("Out-of-window and malformed PhotoKit replies fail closed")
    func previewFailures() async {
        let photoLibrary = PBEOwnerPreviewPhotoLibraryStub { identifier, _ in
            PhotoPreview(
                assetID: identifier,
                jpegData: Data("not-jpeg".utf8),
                pixelWidth: 100,
                pixelHeight: 100
            )
        }
        let service = PBEOwnerNativePreviewService(
            galleryProvider: { _ in gallery() },
            photoLibrary: photoLibrary
        )

        await expectFailure(code: "pbe_owner_fixture_mismatch") {
            _ = try await service.preview(session: session(), assetID: "asset-two")
        }
        await expectFailure(code: "pbe_owner_preview_invalid") {
            _ = try await service.preview(session: session(), assetID: "asset-one")
        }
    }

    @Test("Concurrent cards share one frozen gallery read and bound PhotoKit work")
    func concurrentCardsAreBounded() async throws {
        let galleryReads = PBEOwnerPreviewCounter()
        let photoReads = PBEOwnerPreviewCounter()
        let jpeg = Data([0xff, 0xd8, 0x01, 0xff, 0xd9])
        let service = PBEOwnerNativePreviewService(
            galleryProvider: { _ in
                await galleryReads.enter()
                await galleryReads.leave()
                return gallery()
            },
            photoLibrary: PBEOwnerPreviewPhotoLibraryStub { identifier, _ in
                await photoReads.enter()
                try await Task.sleep(for: .milliseconds(20))
                await photoReads.leave()
                return PhotoPreview(
                    assetID: identifier,
                    jpegData: jpeg,
                    pixelWidth: 1_200,
                    pixelHeight: 800
                )
            },
            maximumConcurrentPreviews: 4
        )

        let previews = try await withThrowingTaskGroup(
            of: PBEOwnerNativePreview.self,
            returning: [PBEOwnerNativePreview].self
        ) { group in
            for _ in 0..<12 {
                group.addTask {
                    try await service.preview(
                        session: session(),
                        assetID: "asset-one"
                    )
                }
            }
            var results: [PBEOwnerNativePreview] = []
            for try await preview in group { results.append(preview) }
            return results
        }

        #expect(previews.count == 12)
        #expect(await galleryReads.total == 1)
        #expect(await photoReads.total == 12)
        #expect(await photoReads.maximumActive == 4)
    }

    private func expectFailure(
        code: String,
        operation: () async throws -> Void
    ) async {
        do {
            try await operation()
            Issue.record("Expected preview failure \(code)")
        } catch let failure as PBEOwnerNativeSessionFailure {
            #expect(failure.code == code)
            #expect(!failure.message.contains("photos-one"))
        } catch {
            Issue.record("Unexpected preview error: \(error)")
        }
    }
}

private func gallery() -> PBEOwnerNativeGallery {
    PBEOwnerNativeGallery(
        ok: true,
        readOnly: true,
        fixtureId: "expo",
        fixtureBreadcrumb: "Root / Expo",
        candidateMode: "curated",
        view: "picked",
        offset: 0,
        limit: 500,
        count: 1,
        nextOffset: 1,
        hasNext: false,
        truncated: false,
        summary: .init(filtered: 1, universe: 1, undecided: 0, picked: 1, hidden: 0),
        mediaAvailability: .init(photos: 1, videos: 0),
        items: [
            PBEOwnerNativeGalleryItem(
                assetId: "asset-one",
                photoLibraryIdentifier: "photos-one",
                title: "One",
                filename: "one.jpg",
                mediaType: "photo",
                capturedAt: "2026-08-22T10:00:00Z",
                locationLabel: "",
                pixelWidth: 1_200,
                pixelHeight: 800,
                resourceFormat: "JPEG",
                originalByteCount: 1_024,
                placementState: "picked",
                eligibilityState: "active",
                rating: 0,
                color: "",
                editorialState: "unreviewed",
                keywords: []
            ),
        ]
    )
}

private func session() -> PBEOwnerSessionContract {
    PBEOwnerSessionContract(
        id: "session-one",
        state: "ready",
        fixtureId: "expo",
        fixtureBreadcrumb: "Root / Expo",
        sourceIdentity: "source-one",
        catalogIdentity: "catalog-one",
        readinessIdentity: "readiness-one",
        fixtureRevision: "revision-one",
        capabilities: ["gallery.read"],
        lifecycleWriter: "pbb-79-waste-basket",
        createdAt: nil,
        expiresAt: Date().addingTimeInterval(300),
        closedAt: nil,
        leaseExpiresAt: nil
    )
}

private actor PBEOwnerPreviewCounter {
    private(set) var total = 0
    private(set) var maximumActive = 0
    private var active = 0

    func enter() {
        total += 1
        active += 1
        maximumActive = max(maximumActive, active)
    }

    func leave() {
        active = max(0, active - 1)
    }
}

private struct PBEOwnerPreviewPhotoLibraryStub: PhotoLibraryServing {
    let operation: @Sendable (String, Int) async throws -> PhotoPreview

    init(
        operation: @escaping @Sendable (String, Int) async throws -> PhotoPreview
    ) {
        self.operation = operation
    }

    func authorization() -> PhotoLibraryAccess { .authorized }
    func requestAuthorization() async -> PhotoLibraryAccess { .authorized }
    func fetch(limit: Int) async -> [PhotoLibraryItem] { [] }

    func preview(
        localIdentifier: String,
        maxPixelSize: Int
    ) async throws -> PhotoPreview {
        try await operation(localIdentifier, maxPixelSize)
    }

    func exportOriginal(
        localIdentifier: String,
        to directory: URL
    ) async throws -> PhotoExportReceipt {
        _ = localIdentifier
        _ = directory
        throw PhotoLibraryError.exportFailed("not available in preview tests")
    }
}
