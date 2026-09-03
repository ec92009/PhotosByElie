import AppKit
import ApplicationServices
import Foundation

private let bundleIdentifier = "com.photosbyelie.backstage"
private let smokeArgument = "--pbe-accessibility-smoke-read-only"

private struct SmokeFailure: Error, CustomStringConvertible {
    let description: String
}

private struct Surface {
    let sidebarTitle: String
    let identifierSuffix: String
    let heading: String
}

private let surfaces = [
    Surface(sidebarTitle: "Overview", identifierSuffix: "Overview", heading: "PhotosByElie Backstage"),
    Surface(sidebarTitle: "Activity", identifierSuffix: "Activity", heading: "Activity"),
    Surface(sidebarTitle: "Fixtures", identifierSuffix: "Fixtures", heading: "Fixtures"),
    Surface(sidebarTitle: "People & Access", identifierSuffix: "People & Access", heading: "People & Access"),
    Surface(sidebarTitle: "Gallery", identifierSuffix: "Culling", heading: "Gallery"),
    Surface(sidebarTitle: "Review", identifierSuffix: "Review", heading: "Review"),
    Surface(sidebarTitle: "Metadata", identifierSuffix: "Metadata", heading: "Metadata"),
    Surface(sidebarTitle: "Waste Basket", identifierSuffix: "Waste Basket", heading: "Waste Basket"),
    Surface(sidebarTitle: "Uploads", identifierSuffix: "Uploads", heading: "Uploads & website"),
    Surface(sidebarTitle: "Client Delivery", identifierSuffix: "Delivery", heading: "Client delivery"),
    Surface(sidebarTitle: "Storage Maintenance", identifierSuffix: "Publication", heading: "Storage maintenance"),
    Surface(sidebarTitle: "Updates", identifierSuffix: "Updates", heading: "Backstage updates"),
]

private func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
    return value
}

private func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String? {
    attribute(element, name) as? String
}

private func boolAttribute(_ element: AXUIElement, _ name: CFString) -> Bool? {
    attribute(element, name) as? Bool
}

private func elementAttribute(_ element: AXUIElement, _ name: CFString) -> AXUIElement? {
    guard let value = attribute(element, name),
          CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

private func children(of element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] ?? []
}

private func descendants(of root: AXUIElement, limit: Int = 20_000) -> [AXUIElement] {
    var result: [AXUIElement] = []
    var queue = children(of: root)
    var index = 0
    while index < queue.count, result.count < limit {
        let element = queue[index]
        index += 1
        result.append(element)
        queue.append(contentsOf: children(of: element))
    }
    return result
}

private func identifier(of element: AXUIElement) -> String? {
    stringAttribute(element, kAXIdentifierAttribute as CFString)
}

private func accessibleStrings(of element: AXUIElement) -> [String] {
    [
        stringAttribute(element, kAXTitleAttribute as CFString),
        stringAttribute(element, kAXDescriptionAttribute as CFString),
        stringAttribute(element, kAXValueAttribute as CFString),
        stringAttribute(element, kAXHelpAttribute as CFString),
    ].compactMap { $0 }
}

private func waitUntil(
    timeout: TimeInterval,
    interval: TimeInterval = 0.1,
    _ predicate: () -> Bool
) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
        if predicate() { return true }
        RunLoop.current.run(until: Date().addingTimeInterval(interval))
    } while Date() < deadline
    return predicate()
}

private func find(identifier target: String, in root: AXUIElement) -> AXUIElement? {
    ([root] + descendants(of: root)).first { identifier(of: $0) == target }
}

private func containsAccessibleString(_ target: String, in root: AXUIElement) -> Bool {
    ([root] + descendants(of: root)).contains { element in
        accessibleStrings(of: element).contains { value in
            value.localizedCaseInsensitiveContains(target)
        }
    }
}

private func ancestorOrSelfSupportingPress(_ element: AXUIElement) -> AXUIElement? {
    var candidate: AXUIElement? = element
    for _ in 0..<8 {
        guard let current = candidate else { return nil }
        var names: CFArray?
        if AXUIElementCopyActionNames(current, &names) == .success,
           let actions = names as? [String],
           actions.contains(kAXPressAction as String) {
            return current
        }
        candidate = elementAttribute(current, kAXParentAttribute as CFString)
    }
    return nil
}

private func press(_ element: AXUIElement, named name: String) throws {
    guard let actionable = ancestorOrSelfSupportingPress(element) else {
        throw SmokeFailure(description: "\(name) has no accessible press action.")
    }
    let result = AXUIElementPerformAction(actionable, kAXPressAction as CFString)
    guard result == .success else {
        throw SmokeFailure(description: "\(name) accessibility press failed with code \(result.rawValue).")
    }
}

private func selectedState(for element: AXUIElement) -> Bool? {
    var candidate: AXUIElement? = element
    for _ in 0..<8 {
        guard let current = candidate else { return nil }
        if let selected = boolAttribute(current, kAXSelectedAttribute as CFString) {
            return selected
        }
        candidate = elementAttribute(current, kAXParentAttribute as CFString)
    }
    return nil
}

private func sendCommandA() {
    let source = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
    down?.flags = .maskCommand
    up?.flags = .maskCommand
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
}

private func terminateExistingInstances() {
    for app in NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier) {
        _ = app.terminate()
    }
    _ = waitUntil(timeout: 5) {
        NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).isEmpty
    }
}

private func launch(_ appURL: URL, arguments: [String]) async throws -> NSRunningApplication {
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.arguments = arguments
    configuration.activates = true
    return try await NSWorkspace.shared.openApplication(
        at: appURL,
        configuration: configuration
    )
}

@main
private enum BackstageAccessibilitySmokeRunner {
    static func main() async {
        let appPath = CommandLine.arguments.dropFirst().first
            ?? "/Applications/PhotosByElie Backstage.app"
        let appURL = URL(fileURLWithPath: appPath, isDirectory: true)
        var smokeApplication: NSRunningApplication?

        do {
            guard AXIsProcessTrusted() else {
                throw SmokeFailure(description: "The terminal host is not trusted for macOS Accessibility automation.")
            }
            guard let bundle = Bundle(url: appURL),
                  bundle.bundleIdentifier == bundleIdentifier else {
                throw SmokeFailure(description: "Expected the signed Backstage app at \(appPath).")
            }
            let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
            let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"

            terminateExistingInstances()
            let launched = try await launch(appURL, arguments: [smokeArgument])
            smokeApplication = launched
            let applicationElement = AXUIElementCreateApplication(launched.processIdentifier)

            guard waitUntil(timeout: 12, {
                !(attribute(applicationElement, kAXWindowsAttribute as CFString) as? [AXUIElement] ?? []).isEmpty
            }) else {
                throw SmokeFailure(description: "The read-only smoke window did not appear.")
            }

            guard containsAccessibleString("Read-only installed-app accessibility smoke", in: applicationElement),
                  find(identifier: "backstage.smoke.busy-state", in: applicationElement) != nil else {
                throw SmokeFailure(description: "The app did not enter its isolated read-only accessibility mode.")
            }

            for surface in surfaces {
                let sidebarIdentifier = "backstage.sidebar.\(surface.identifierSuffix)"
                guard let sidebarElement = find(identifier: sidebarIdentifier, in: applicationElement) else {
                    throw SmokeFailure(description: "Missing runtime sidebar element \(surface.sidebarTitle).")
                }
                try press(sidebarElement, named: surface.sidebarTitle)

                let workspaceIdentifier = "backstage.workspace.\(surface.identifierSuffix)"
                guard waitUntil(timeout: 5, {
                    find(identifier: workspaceIdentifier, in: applicationElement) != nil
                        && containsAccessibleString(surface.heading, in: applicationElement)
                }) else {
                    throw SmokeFailure(description: "\(surface.sidebarTitle) did not expose its runtime workspace and heading.")
                }
                guard selectedState(for: sidebarElement) == true else {
                    throw SmokeFailure(description: "\(surface.sidebarTitle) did not expose selected state after navigation.")
                }
                print("PASS surface: \(surface.sidebarTitle)")
            }

            guard let gallery = find(identifier: "backstage.sidebar.Culling", in: applicationElement) else {
                throw SmokeFailure(description: "Gallery sidebar element disappeared before keyboard smoke.")
            }
            try press(gallery, named: "Gallery")
            _ = launched.activate(options: [.activateAllWindows])
            sendCommandA()
            guard waitUntil(timeout: 3, {
                containsAccessibleString("Keyboard Select All reached the guarded Gallery handler", in: applicationElement)
            }) else {
                throw SmokeFailure(description: "Command-A did not reach the guarded Gallery Select All handler.")
            }
            print("PASS keyboard: Command-A reached guarded Gallery Select All")

            guard let uploads = find(identifier: "backstage.sidebar.Uploads", in: applicationElement) else {
                throw SmokeFailure(description: "Uploads sidebar element disappeared before disabled-state smoke.")
            }
            try press(uploads, named: "Uploads")
            guard waitUntil(timeout: 3, {
                ([applicationElement] + descendants(of: applicationElement)).contains { element in
                    accessibleStrings(of: element).contains(where: { $0.contains("Upload selection") })
                        && boolAttribute(element, kAXEnabledAttribute as CFString) == false
                }
            }) else {
                throw SmokeFailure(description: "Uploads did not expose its disabled primary action.")
            }
            print("PASS state: disabled Upload selection")

            guard let updates = find(identifier: "backstage.sidebar.Updates", in: applicationElement) else {
                throw SmokeFailure(description: "Updates sidebar element disappeared before failure-state smoke.")
            }
            try press(updates, named: "Updates")
            guard waitUntil(timeout: 3, {
                containsAccessibleString("Failed safely", in: applicationElement)
            }) else {
                throw SmokeFailure(description: "Updates did not expose the synthetic safe failure state.")
            }
            print("PASS state: busy, selected, disabled, and failed states")

            print("PASS installed accessibility smoke: Backstage v\(version) build \(build)")
            _ = launched.terminate()
            smokeApplication = nil
            _ = waitUntil(timeout: 5) { launched.isTerminated }
            _ = try await launch(appURL, arguments: [])
        } catch {
            if let smokeApplication {
                _ = smokeApplication.terminate()
                _ = waitUntil(timeout: 5) { smokeApplication.isTerminated }
            }
            try? await Task.sleep(for: .milliseconds(250))
            _ = try? await launch(appURL, arguments: [])
            fputs("FAIL installed accessibility smoke: \(error)\n", stderr)
            exit(1)
        }
    }
}
