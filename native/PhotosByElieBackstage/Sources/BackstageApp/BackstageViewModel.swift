import Foundation
import OwnerCore

@MainActor
final class BackstageViewModel: ObservableObject {
    enum Section: String, CaseIterable, Identifiable {
        case overview = "Overview"
        case activity = "Activity"
        case fixtures = "Fixtures"
        case access = "People & Access"
        case culling = "Culling"
        case metadata = "Metadata"
        case wasteBasket = "Waste Basket"
        case uploads = "Uploads"
        case delivery = "Delivery"
        case publication = "Publication"
        var id: String { rawValue }
    }

    @Published var selection: Section? = .overview
    @Published var actions: [OwnerAction] = []
    @Published var status = "Not connected"
    @Published var isRefreshing = false
    @Published var photoAccess: PhotoLibraryAccess
    @Published var libraryItems: [PhotoLibraryItem] = []
    @Published var selectedPhotoIDs: Set<String> = []
    @Published var photoPreview: PhotoPreview?
    @Published var photoStatus = "Photo library not loaded."
    @Published var isLoadingPhotos = false
    @Published var fixtureID = ""
    @Published var metadataReport: MetadataGiveBackReport?
    @Published var metadataStatus = "Choose a fixture, then run the read-only preview."
    @Published var isRunningMetadata = false

    let api: OwnerAPIClient
    let photoLibrary: any PhotoLibraryServing
    let metadataService: MetadataGiveBackService

    init(
        api: OwnerAPIClient = OwnerAPIClient(),
        photoLibrary: any PhotoLibraryServing = PhotoKitLibraryService()
    ) {
        self.api = api
        self.photoLibrary = photoLibrary
        self.photoAccess = photoLibrary.authorization()
        self.metadataService = MetadataGiveBackService(runner: OwnerActionRunner(api: api))
    }

    func refreshActions() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            actions = try await api.listActions(limit: 50).actions
            status = "Connected"
        } catch {
            status = String(describing: error)
        }
    }

    func authorizeAndLoadPhotos() async {
        if photoLibrary.authorization() == .notDetermined {
            photoAccess = await photoLibrary.requestAuthorization()
        } else {
            photoAccess = photoLibrary.authorization()
        }
        await refreshPhotos()
    }

    func refreshPhotos() async {
        photoAccess = photoLibrary.authorization()
        guard [.authorized, .limited].contains(photoAccess) else {
            photoStatus = "Photos access is required for indexing, preview, and export."
            return
        }
        isLoadingPhotos = true
        defer { isLoadingPhotos = false }
        libraryItems = await photoLibrary.fetch(limit: 2_000)
        selectedPhotoIDs.formIntersection(Set(libraryItems.map(\.id)))
        photoStatus = "\(libraryItems.count.formatted()) recent Photos items indexed."
    }

    func loadPreview() async {
        guard let id = selectedPhotoIDs.first else {
            photoStatus = "Select one item to preview."
            return
        }
        do {
            photoPreview = try await photoLibrary.preview(localIdentifier: id, maxPixelSize: 1_600)
            photoStatus = "Preview prepared from Photos without exporting the original."
        } catch {
            photoStatus = String(describing: error)
        }
    }

    func exportSelected(to directory: URL) async {
        let ids = libraryItems.map(\.id).filter(selectedPhotoIDs.contains)
        guard !ids.isEmpty else {
            photoStatus = "Select one or more items to export."
            return
        }
        isLoadingPhotos = true
        defer { isLoadingPhotos = false }
        var receipts: [PhotoExportReceipt] = []
        var failures: [String] = []
        for id in ids {
            do {
                receipts.append(try await photoLibrary.exportOriginal(localIdentifier: id, to: directory))
            } catch {
                failures.append("\(id): \(error)")
            }
        }
        photoStatus = "\(receipts.count) originals exported with SHA-256 receipts"
            + (failures.isEmpty ? "." : "; \(failures.count) failed.")
    }

    func planMetadataGiveBack() async {
        await runMetadata(commit: false)
    }

    func commitMetadataGiveBack() async {
        await runMetadata(commit: true)
    }

    func retryMetadataFailures() async {
        guard let metadataReport else { return }
        isRunningMetadata = true
        defer { isRunningMetadata = false }
        do {
            let retried = try await metadataService.retryFailures(
                from: metadataReport,
                fixtureID: fixtureID
            )
            self.metadataReport = retried
            metadataStatus = reportStatus(retried)
        } catch {
            metadataStatus = String(describing: error)
        }
    }

    private func runMetadata(commit: Bool) async {
        let fixture = fixtureID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !fixture.isEmpty else {
            metadataStatus = "A fixture ID is required."
            return
        }
        isRunningMetadata = true
        defer { isRunningMetadata = false }
        do {
            let report = try await (commit
                ? metadataService.commit(fixtureID: fixture)
                : metadataService.plan(fixtureID: fixture))
            metadataReport = report
            metadataStatus = reportStatus(report)
        } catch {
            metadataStatus = String(describing: error)
        }
    }

    private func reportStatus(_ report: MetadataGiveBackReport) -> String {
        if report.isDryRun {
            return "\(report.readyCount) ready; \(report.blocked.count) blocked. Photos is unchanged."
        }
        return "\(report.verifiedCount) written and re-read as verified; \(report.failed.count) failed; \(report.blocked.count) blocked."
    }
}
