import Foundation

public struct PhotosBridgeHealth: Sendable, Equatable {
    public var installed: Bool
    public var headless: Bool
    public var bundleIdentifier: String
    public var version: String
    public var photoAccess: String
    public var message: String

    public init(
        installed: Bool,
        headless: Bool,
        bundleIdentifier: String,
        version: String,
        photoAccess: String,
        message: String
    ) {
        self.installed = installed
        self.headless = headless
        self.bundleIdentifier = bundleIdentifier
        self.version = version
        self.photoAccess = photoAccess
        self.message = message
    }
}

public struct PhotosBridgeHealthService: Sendable {
    public typealias Runner = @Sendable (_ appURL: URL, _ resultURL: URL) throws -> Void

    private let appURL: URL
    private let runner: Runner

    public init(
        appURL: URL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Applications/PhotosByElie Photos Bridge.app"),
        runner: Runner? = nil
    ) {
        self.appURL = appURL
        self.runner = runner ?? PhotosBridgeHealthService.launch
    }

    public func probe() async -> PhotosBridgeHealth {
        await Task.detached(priority: .utility) {
            probeSynchronously()
        }.value
    }

    private func probeSynchronously() -> PhotosBridgeHealth {
        let plistURL = appURL.appendingPathComponent("Contents/Info.plist")
        guard let plist = NSDictionary(contentsOf: plistURL) as? [String: Any] else {
            return PhotosBridgeHealth(
                installed: false,
                headless: false,
                bundleIdentifier: "",
                version: "",
                photoAccess: "unavailable",
                message: "Signed Photos Bridge is not installed."
            )
        }
        let identifier = plist["CFBundleIdentifier"] as? String ?? ""
        let version = plist["CFBundleShortVersionString"] as? String ?? ""
        let headless = plist["LSUIElement"] as? Bool == true
        let resultURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-photos-bridge-health-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: resultURL) }
        do {
            try runner(appURL, resultURL)
            let data = try Data(contentsOf: resultURL)
            let body = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            let access = body["photoAccess"] as? String ?? "unknown"
            let ok = body["ok"] as? Bool == true
            return PhotosBridgeHealth(
                installed: true,
                headless: headless && (body["headless"] as? Bool == true),
                bundleIdentifier: body["bundleIdentifier"] as? String ?? identifier,
                version: version,
                photoAccess: access,
                message: ok
                    ? "Signed helper is ready."
                    : "Signed helper reported Photos access: \(access)."
            )
        } catch {
            return PhotosBridgeHealth(
                installed: true,
                headless: headless,
                bundleIdentifier: identifier,
                version: version,
                photoAccess: "unavailable",
                message: "Signed helper health check failed: \(error.localizedDescription)"
            )
        }
    }

    private static func launch(appURL: URL, resultURL: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = [
            "-W", "-n", appURL.path, "--args",
            "health", "--result-destination", resultURL.path,
        ]
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw NSError(
                domain: "PhotosBridgeHealth",
                code: Int(process.terminationStatus),
                userInfo: [NSLocalizedDescriptionKey: "Photos Bridge exited \(process.terminationStatus)."]
            )
        }
    }
}
