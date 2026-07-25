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

    let api: OwnerAPIClient

    init(api: OwnerAPIClient = OwnerAPIClient()) {
        self.api = api
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
}

