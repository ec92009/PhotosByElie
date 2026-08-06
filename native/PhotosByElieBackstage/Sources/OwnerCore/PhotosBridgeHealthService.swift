import Foundation

public struct PhotosBridgeHealth: Sendable, Equatable {
    public var installed: Bool
    public var headless: Bool
    public var bundleIdentifier: String
    public var version: String
    public var build: String
    public var photoAccess: String
    public var compatible: Bool
    public var message: String

    public init(
        installed: Bool,
        headless: Bool,
        bundleIdentifier: String,
        version: String,
        build: String,
        photoAccess: String,
        compatible: Bool,
        message: String
    ) {
        self.installed = installed
        self.headless = headless
        self.bundleIdentifier = bundleIdentifier
        self.version = version
        self.build = build
        self.photoAccess = photoAccess
        self.compatible = compatible
        self.message = message
    }
}

public struct PhotosBridgeHealthService: Sendable {
    public typealias Runner = @Sendable (_ appURL: URL, _ resultURL: URL) throws -> Void

    private let appURL: URL
    private let runner: Runner
    private let expectedBundleIdentifier: String
    private let expectedVersion: String
    private let expectedBuild: String

    public init(
        appURL: URL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Applications/PhotosByElie Photos Bridge.app"),
        expectedBundleIdentifier: String? = nil,
        expectedVersion: String? = nil,
        expectedBuild: String? = nil,
        runner: Runner? = nil
    ) {
        self.appURL = appURL
        self.runner = runner ?? PhotosBridgeHealthService.launch
        self.expectedBundleIdentifier = expectedBundleIdentifier
            ?? (Bundle.main.object(forInfoDictionaryKey: "PBEPhotosBridgeBundleIdentifier") as? String ?? "")
        self.expectedVersion = expectedVersion
            ?? (Bundle.main.object(forInfoDictionaryKey: "PBEPhotosBridgeVersion") as? String ?? "")
        self.expectedBuild = expectedBuild
            ?? (Bundle.main.object(forInfoDictionaryKey: "PBEPhotosBridgeBuild") as? String ?? "")
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
                build: "",
                photoAccess: "unavailable",
                compatible: false,
                message: "Signed Photos Bridge is not installed."
            )
        }
        let identifier = plist["CFBundleIdentifier"] as? String ?? ""
        let version = plist["CFBundleShortVersionString"] as? String ?? ""
        let build = plist["CFBundleVersion"] as? String ?? ""
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
            let reportedIdentifier = body["bundleIdentifier"] as? String ?? identifier
            let compatible = isCompatible(
                identifier: reportedIdentifier,
                version: version,
                build: build
            )
            return PhotosBridgeHealth(
                installed: true,
                headless: headless && (body["headless"] as? Bool == true),
                bundleIdentifier: reportedIdentifier,
                version: version,
                build: build,
                photoAccess: access,
                compatible: compatible,
                message: healthMessage(
                    ok: ok,
                    access: access,
                    compatible: compatible,
                    version: version,
                    build: build
                )
            )
        } catch {
            return PhotosBridgeHealth(
                installed: true,
                headless: headless,
                bundleIdentifier: identifier,
                version: version,
                build: build,
                photoAccess: "unavailable",
                compatible: isCompatible(
                    identifier: identifier,
                    version: version,
                    build: build
                ),
                message: "Signed helper health check failed: \(error.localizedDescription)"
            )
        }
    }

    private func isCompatible(identifier: String, version: String, build: String) -> Bool {
        (expectedBundleIdentifier.isEmpty || identifier == expectedBundleIdentifier)
            && (expectedVersion.isEmpty || version == expectedVersion)
            && (expectedBuild.isEmpty || build == expectedBuild)
    }

    private func healthMessage(
        ok: Bool,
        access: String,
        compatible: Bool,
        version: String,
        build: String
    ) -> String {
        guard compatible else {
            let expected = expectedVersion.isEmpty
                ? "the installed Backstage release"
                : "Backstage \(expectedVersion) build \(expectedBuild)"
            return "Photos Bridge \(version) build \(build) is incompatible with \(expected). Install the matching signed helper."
        }
        guard ok, access == "authorized" else {
            return "Signed helper reported Photos access: \(access). Grant Full Access to PhotosByElie Photos Bridge in System Settings."
        }
        return "Signed helper is compatible and authorized."
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
