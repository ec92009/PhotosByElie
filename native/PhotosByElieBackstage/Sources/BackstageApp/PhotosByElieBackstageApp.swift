import OwnerCore
import SwiftUI

@main
struct PhotosByElieBackstageApp: App {
    @StateObject private var model = BackstageViewModel()

    var body: some Scene {
        WindowGroup("PhotosByElie Backstage") {
            NavigationSplitView {
                List(BackstageViewModel.Section.allCases, selection: $model.selection) { section in
                    Label(section.rawValue, systemImage: icon(for: section))
                }
                .navigationTitle("Backstage")
                .frame(minWidth: 210)
            } detail: {
                detail
                    .frame(minWidth: 760, minHeight: 560)
                    .toolbar {
                        ToolbarItem {
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(model.status == "Connected" ? .green : .orange)
                                    .frame(width: 9, height: 9)
                                Text(model.status).lineLimit(1)
                            }
                        }
                    }
            }
            .task { await model.refreshActions() }
        }
        .commands {
            CommandMenu("Backstage") {
                Button("Refresh Activity") {
                    Task { await model.refreshActions() }
                }
                .keyboardShortcut("r")
            }
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch model.selection ?? .overview {
        case .overview:
            ContentUnavailableView(
                "PhotosByElie Backstage",
                systemImage: "photo.on.rectangle.angled",
                description: Text("Max-first Owner workspace. Public and client sites remain independent.")
            )
        case .activity:
            ActivityView(model: model)
        default:
            WorkflowPlaceholder(section: model.selection ?? .overview)
        }
    }

    private func icon(for section: BackstageViewModel.Section) -> String {
        switch section {
        case .overview: "rectangle.grid.2x2"
        case .activity: "clock.arrow.circlepath"
        case .fixtures: "folder.badge.gearshape"
        case .access: "person.2"
        case .culling: "checkmark.rectangle.stack"
        case .metadata: "tag"
        case .wasteBasket: "trash"
        case .uploads: "arrow.up.circle"
        case .delivery: "shippingbox"
        case .publication: "globe"
        }
    }
}

private struct ActivityView: View {
    @ObservedObject var model: BackstageViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Activity").font(.largeTitle.bold())
                Spacer()
                Button("Refresh") { Task { await model.refreshActions() } }
                    .disabled(model.isRefreshing)
            }
            .padding()
            Table(model.actions) {
                TableColumn("Kind", value: \.actionKind)
                TableColumn("Target", value: \.target)
                TableColumn("State") { Text($0.state.rawValue.capitalized) }
                TableColumn("Progress") { action in
                    if let progress = action.progress {
                        ProgressView(value: progress.percent, total: 100)
                    } else {
                        Text("—")
                    }
                }
            }
        }
    }
}

private struct WorkflowPlaceholder: View {
    let section: BackstageViewModel.Section

    var body: some View {
        ContentUnavailableView(
            section.rawValue,
            systemImage: "hammer",
            description: Text("OwnerCore service boundary ready; native workflow screen pending parity implementation.")
        )
    }
}

