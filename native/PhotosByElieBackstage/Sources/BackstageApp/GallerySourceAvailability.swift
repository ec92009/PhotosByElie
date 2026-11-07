import Foundation
import OwnerCore

extension BackstageViewModel {
    /// Only explicitly resolved sources in the bounded current page are
    /// reconciled. The recent-discovery subset is never used as a deletion list.
    func reconcileVisiblePhotoSources() async throws -> (checked: Int, unavailable: Int) {
        let fixtureID = selectedFixtureID
        let assets = Array(cullingAssets.prefix(500))
        let library = photoLibrary
        let store = sourceAvailabilityStore
        photoStatus = "Checking availability of \(assets.count.formatted()) Gallery photos…"
        let observations = try await library.sourceAvailability(
            identifiers: assets.map(\.photoLibraryIdentifier)
        )
        try Task.checkCancellation()
        guard selectedFixtureID == fixtureID else { throw CancellationError() }
        var availability: [String: Bool] = [:]
        for asset in assets {
            if let available = observations[asset.photoLibraryIdentifier] {
                availability[asset.id] = available
            }
        }
        if let store {
            let snapshot = availability
            _ = try await Task.detached(priority: .userInitiated) {
                try store.reconcile(snapshot)
            }.value
        }
        return (availability.count, availability.values.filter { !$0 }.count)
    }
}
