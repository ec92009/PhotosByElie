import OwnerCore
import SwiftUI

struct FixtureHierarchyNode: Identifiable, Equatable {
    let id: String
    let name: String
    let isArchived: Bool
    let depth: Int
    let breadcrumbLabel: String
    let children: [FixtureHierarchyNode]

    var flattened: [FixtureHierarchyNode] {
        [self] + children.flatMap(\.flattened)
    }

    var menuLabel: String {
        String(repeating: "\u{2003}\u{2003}", count: depth) + name
    }

    func node(withID targetID: String) -> FixtureHierarchyNode? {
        if id == targetID { return self }
        return children.lazy.compactMap { $0.node(withID: targetID) }.first
    }
}

extension Array where Element == FixtureNode {
    func selectionHierarchy() -> [FixtureHierarchyNode] {
        func convert(_ fixture: FixtureNode, depth: Int, path: [String]) -> FixtureHierarchyNode {
            let breadcrumb = (path + [fixture.name]).joined(separator: " › ")
            return FixtureHierarchyNode(
                id: fixture.id,
                name: fixture.name,
                isArchived: fixture.isArchived,
                depth: depth,
                breadcrumbLabel: breadcrumb,
                children: fixture.children.map {
                    convert($0, depth: depth + 1, path: path + [fixture.name])
                }
            )
        }
        return map { convert($0, depth: 0, path: []) }
    }
}

struct FixtureHierarchyMenu: View {
    let title: String
    let roots: [FixtureHierarchyNode]
    @Binding var selection: String
    let emptySelectionLabel: String?
    let allowsSelection: (FixtureHierarchyNode) -> Bool

    init(
        _ title: String = "Fixture",
        roots: [FixtureHierarchyNode],
        selection: Binding<String>,
        emptySelectionLabel: String? = nil,
        allowsSelection: @escaping (FixtureHierarchyNode) -> Bool = { _ in true }
    ) {
        self.title = title
        self.roots = roots
        _selection = selection
        self.emptySelectionLabel = emptySelectionLabel
        self.allowsSelection = allowsSelection
    }

    var body: some View {
        Menu {
            if let emptySelectionLabel {
                Button {
                    selection = ""
                } label: {
                    Label(
                        emptySelectionLabel,
                        systemImage: selection.isEmpty ? "checkmark" : "line.3.horizontal.decrease"
                    )
                }
            }
            FixtureHierarchyMenuContent(
                nodes: roots,
                selectedID: selection,
                allowsSelection: allowsSelection,
                onSelection: { selection = $0 }
            )
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "folder")
                    .foregroundStyle(.secondary)
                Text(selectedLabel)
                    .lineLimit(1)
                    .truncationMode(.head)
                Image(systemName: "chevron.up.chevron.down")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityLabel("\(title): \(selectedLabel)")
        .backstageHelp("Choose the exact fixture target. The full fixture hierarchy is shown as an indented list.")
    }

    private var selectedLabel: String {
        if selection.isEmpty {
            return emptySelectionLabel ?? "Choose a fixture"
        }
        for root in roots {
            if let match = root.node(withID: selection) {
                return match.breadcrumbLabel
            }
        }
        return "Fixture unavailable"
    }
}

struct FixtureHierarchyMenuContent: View {
    let nodes: [FixtureHierarchyNode]
    let selectedID: String?
    let allowsSelection: (FixtureHierarchyNode) -> Bool
    let onSelection: (String) -> Void

    var body: some View {
        ForEach(nodes.flatMap(\.flattened)) { node in
            Button {
                onSelection(node.id)
            } label: {
                Label(
                    node.menuLabel,
                    systemImage: selectedID == node.id
                        ? "checkmark"
                        : (node.isArchived ? "archivebox" : "folder")
                )
            }
            .disabled(!allowsSelection(node))
            .accessibilityLabel(node.breadcrumbLabel)
            .accessibilityValue(selectedID == node.id ? "Current fixture" : "")
            .backstageHelp("Select \(node.breadcrumbLabel).")
        }
    }
}

struct FixturePicker: View {
    @ObservedObject var model: BackstageViewModel
    var isPreviewMode = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Label("Current fixture", systemImage: "scope")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 4)
                Button {
                    Task { await model.loadFixtures() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .disabled(model.isFixtureRefreshDisabled || isPreviewMode)
                .accessibilityLabel("Refresh fixtures")
                .backstageHelp("Reload the fixture hierarchy and validate the current stable fixture ID.")
            }

            currentFixtureSummary

            FixtureHierarchyMenu(
                "Current fixture",
                roots: model.fixtures.selectionHierarchy(),
                selection: Binding(
                    get: { model.selectedFixtureID },
                    set: { _ = model.selectFixture($0) }
                ),
                allowsSelection: { !$0.isArchived }
            )
            .disabled(model.isFixtureChooserDisabled || isPreviewMode)
            .frame(maxWidth: .infinity, alignment: .leading)

            if let explanation = model.fixtureChooserExplanation,
               model.fixtureSelectionAvailability != .ready {
                Text(explanation)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let notice = model.fixtureSelectionNotice {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var currentFixtureSummary: some View {
        switch model.fixtureSelectionAvailability {
        case .loading:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Loading fixtures…")
            }
            .foregroundStyle(.secondary)
        case .ready:
            Text(model.selectedFixtureBreadcrumb)
                .font(.callout.weight(.semibold))
                .lineLimit(1)
                .truncationMode(.head)
                .accessibilityLabel("Current fixture: \(model.selectedFixtureBreadcrumb)")
        case .unavailable:
            Label("Fixture unavailable", systemImage: "exclamationmark.triangle")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.orange)
                .accessibilityLabel("Current fixture unavailable")
        }
    }
}
