import CryptoKit
import Foundation

public protocol OwnerAPITransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionOwnerTransport: OwnerAPITransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        return (data, http)
    }
}

public struct PBEOwnerHostReadiness: Codable, Sendable, Equatable {
    public var ready: Bool
    public var sourceIdentity: String
    public var catalogIdentity: String
    public var readinessIdentity: String
    public var fixtureRevision: String
    public var lifecycleWriter: String
    public var capabilities: [String]
}

public struct PBEOwnerSessionContract: Codable, Sendable, Equatable {
    public var id: String
    public var state: String
    public var fixtureId: String
    public var fixtureBreadcrumb: String
    public var sourceIdentity: String
    public var catalogIdentity: String
    public var readinessIdentity: String
    public var fixtureRevision: String
    public var capabilities: [String]
    public var lifecycleWriter: String
    public var createdAt: Date?
    public var expiresAt: Date
    public var closedAt: String?
    public var leaseExpiresAt: Date?
}

public struct PBEOwnerSessionMintRequest: Codable, Sendable, Equatable {
    public var fixtureId: String
    public var fixtureBreadcrumb: String
    public var sourceIdentity: String
    public var catalogIdentity: String
    public var readinessIdentity: String
    public var fixtureRevision: String

    public init(
        fixtureId: String,
        fixtureBreadcrumb: String,
        sourceIdentity: String,
        catalogIdentity: String,
        readinessIdentity: String,
        fixtureRevision: String
    ) {
        self.fixtureId = fixtureId
        self.fixtureBreadcrumb = fixtureBreadcrumb
        self.sourceIdentity = sourceIdentity
        self.catalogIdentity = catalogIdentity
        self.readinessIdentity = readinessIdentity
        self.fixtureRevision = fixtureRevision
    }
}

public struct PBEOwnerSessionMintEnvelope: Codable, Sendable, Equatable {
    public var ok: Bool
    public var tokenType: String
    public var sessionToken: String
    public var session: PBEOwnerSessionContract
}

public struct PBEOwnerHostSessionEnvelope: Codable, Sendable, Equatable {
    public var ok: Bool
    public var session: PBEOwnerSessionContract
    public var launchUrl: URL?
}

public protocol PBEOwnerHostServing: Sendable {
    func ensureReadiness(fixtureID: String) async throws -> PBEOwnerHostReadiness
    func attach(sessionToken: String, fixtureID: String) async throws -> PBEOwnerHostSessionEnvelope
    func status(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope
    func heartbeat(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope
    func close(sessionToken: String) async throws
    func stopIfLaunched() async
}

enum PBEOwnerCheckoutIdentity {
    private static let scopeManifest = "scripts/pbe_owner_host_tracked_paths.txt"
    private static let runtimeManifestName = "connector-runtime-manifest.json"
    private static let runtimeManifestKind = "photosbyelie-owner-connector-runtime"
    private static let runtimeManifestSchemaVersion = 2
    private static let pythonImportExtensions: Set<String> = [
        "bundle", "dylib", "pth", "py", "pyc", "pyo", "so",
    ]
    private static let requiredPaths = [
        scopeManifest,
        "scripts/local_server.py",
        "scripts/pbe_owner_session.py",
        "scripts/waste_basket_gateway.py",
    ]

    static func verified(repositoryRoot: URL) throws -> String {
        let standardizedRoot = repositoryRoot.standardizedFileURL
        let runtimeManifest = standardizedRoot.appendingPathComponent(runtimeManifestName)
        if FileManager.default.fileExists(atPath: runtimeManifest.path)
            || isSymbolicLink(runtimeManifest)
            || isSymbolicLink(standardizedRoot) {
            return try verifiedRuntime(standardizedRoot)
        }
        return try verifiedGitCheckout(standardizedRoot.resolvingSymlinksInPath())
    }

    private static func verifiedGitCheckout(_ root: URL) throws -> String {
        let pathspecs = try hostPathspecs(repositoryRoot: root)
        do {
            let topLevel = try git(root, ["rev-parse", "--show-toplevel"]).text
            guard URL(fileURLWithPath: topLevel, isDirectory: true)
                .standardizedFileURL.resolvingSymlinksInPath() == root else {
                throw VerificationFailure.invalidRepository
            }
            let revision = try git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).text.lowercased()
            guard revision.range(of: "^[0-9a-f]{40,64}$", options: .regularExpression) != nil else {
                throw VerificationFailure.invalidRepository
            }

            let tracked = Set(try git(root, ["ls-files", "-z", "--"] + pathspecs).nulStrings)
            guard Set(requiredPaths).isSubset(of: tracked) else {
                throw VerificationFailure.invalidRepository
            }
            let trackedScripts = Set(try git(root, [
                "ls-files", "-z", "--", "scripts",
            ]).nulStrings)
            try assertNoStrayPythonHostContent(
                repositoryRoot: root,
                trackedScripts: trackedScripts
            )
            let status = try git(root, [
                "status", "--porcelain=v1", "-z", "--untracked-files=no", "--",
            ] + pathspecs).data
            guard status.isEmpty else {
                throw APIErrorEnvelope(error: .init(
                    code: "pbe_owner_checkout_dirty",
                    message: "PBE Owner requires a clean tracked host checkout."
                ))
            }

            let tree = try git(root, ["ls-tree", "-r", "-z", "HEAD", "--"] + tracked.sorted()).nulStrings
            var entries: [String: (mode: String, objectID: String)] = [:]
            for entry in tree {
                let fields = entry.split(separator: "\t", maxSplits: 1).map(String.init)
                guard fields.count == 2 else { throw VerificationFailure.invalidRepository }
                let metadata = fields[0].split(separator: " ", maxSplits: 2).map(String.init)
                guard metadata.count == 3, metadata[1] == "blob" else {
                    throw VerificationFailure.invalidRepository
                }
                entries[fields[1]] = (metadata[0], metadata[2])
            }
            guard Set(requiredPaths).isSubset(of: Set(entries.keys)) else {
                throw VerificationFailure.invalidRepository
            }
            let paths = entries.keys.sorted()
            let actualHashes = try git(root, ["hash-object", "--"] + paths).textLines
            guard actualHashes.count == paths.count else {
                throw VerificationFailure.invalidRepository
            }
            for (path, actualHash) in zip(paths, actualHashes) {
                guard entries[path]?.objectID == actualHash.lowercased() else {
                    throw APIErrorEnvelope(error: .init(
                        code: "pbe_owner_checkout_content_mismatch",
                        message: "PBE Owner host files do not match the verified commit."
                    ))
                }
            }

            var hasher = SHA256()
            for path in paths {
                guard let entry = entries[path] else { throw VerificationFailure.invalidRepository }
                hasher.update(data: Data(path.utf8))
                hasher.update(data: Data([0]))
                hasher.update(data: Data(entry.mode.utf8))
                hasher.update(data: Data([0]))
                hasher.update(data: Data(entry.objectID.utf8))
                hasher.update(data: Data([10]))
            }
            let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
            return "git:\(revision):pbe-host-sha256:\(digest)"
        } catch let error as APIErrorEnvelope {
            throw error
        } catch {
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_checkout_identity_unavailable",
                message: "Backstage could not verify the tracked PBE Owner host checkout."
            ))
        }
    }

    private struct RuntimeManifest: Decodable {
        struct FileEntry: Decodable {
            var path: String
            var sha256: String
            var size: Int
            var mode: String
        }

        struct OwnerHost: Decodable {
            var scopeManifest: String
            var files: [String]
        }

        var schemaVersion: Int
        var kind: String
        var sourceRevision: String
        var files: [FileEntry]
        var pbeOwnerHost: OwnerHost
    }

    private static func verifiedRuntime(_ standardizedRoot: URL) throws -> String {
        do {
            guard !isSymbolicLink(standardizedRoot) else {
                throw VerificationFailure.invalidRepository
            }
            let root = standardizedRoot.resolvingSymlinksInPath()
            let manifestURL = root.appendingPathComponent(runtimeManifestName)
            guard !isSymbolicLink(manifestURL),
                  FileManager.default.fileExists(atPath: manifestURL.path),
                  try permissions(manifestURL) == 0o444 else {
                throw VerificationFailure.invalidRuntime("manifest")
            }
            let manifest = try JSONDecoder().decode(
                RuntimeManifest.self,
                from: Data(contentsOf: manifestURL)
            )
            guard manifest.schemaVersion == runtimeManifestSchemaVersion,
                  manifest.kind == runtimeManifestKind,
                  manifest.sourceRevision.range(
                    of: "^[0-9a-f]{40,64}$",
                    options: .regularExpression
                  ) != nil,
                  manifest.pbeOwnerHost.scopeManifest == scopeManifest,
                  !manifest.files.isEmpty,
                  !manifest.pbeOwnerHost.files.isEmpty,
                  try permissions(root) == 0o555 else {
                throw VerificationFailure.invalidRuntime("header")
            }

            var entries: [String: RuntimeManifest.FileEntry] = [:]
            for entry in manifest.files {
                let relative = try safeRuntimePath(entry.path)
                guard entries[relative] == nil,
                      ["0444", "0555"].contains(entry.mode),
                      entry.size >= 0,
                      entry.sha256.range(
                        of: "^[0-9a-f]{64}$",
                        options: .regularExpression
                      ) != nil else {
                    throw VerificationFailure.invalidRuntime("entry metadata: \(entry.path)")
                }
                guard let expectedPermissions = Int(entry.mode, radix: 8) else {
                    throw VerificationFailure.invalidRepository
                }
                let fileURL = root.appendingPathComponent(relative)
                guard !isSymbolicLink(fileURL),
                      FileManager.default.fileExists(atPath: fileURL.path),
                      try permissions(fileURL) == expectedPermissions,
                      try fileSize(fileURL) == entry.size,
                      try sha256(fileURL) == entry.sha256.lowercased() else {
                    throw VerificationFailure.invalidRuntime("entry content: \(entry.path)")
                }
                entries[relative] = entry
            }

            let hostPaths = try manifest.pbeOwnerHost.files.map(safeRuntimePath).sorted()
            guard Set(hostPaths).count == hostPaths.count,
                  Set(requiredPaths).isSubset(of: Set(hostPaths)),
                  Set(hostPaths).isSubset(of: Set(entries.keys)) else {
                throw VerificationFailure.invalidRuntime("host scope")
            }
            try verifyRuntimeContents(root: root, manifestURL: manifestURL, entries: entries)

            var hasher = SHA256()
            for path in hostPaths {
                guard let entry = entries[path] else {
                    throw VerificationFailure.invalidRuntime("host entry: \(path)")
                }
                hasher.update(data: Data(path.utf8))
                hasher.update(data: Data([0]))
                hasher.update(data: Data(entry.mode.utf8))
                hasher.update(data: Data([0]))
                hasher.update(data: Data(entry.sha256.lowercased().utf8))
                hasher.update(data: Data([10]))
            }
            let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
            return "runtime:\(manifest.sourceRevision):pbe-host-sha256:\(digest)"
        } catch let error as APIErrorEnvelope {
            throw error
        } catch {
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_runtime_identity_unavailable",
                message: "Backstage could not verify the installed PBE Owner runtime."
            ))
        }
    }

    private static func verifyRuntimeContents(
        root: URL,
        manifestURL: URL,
        entries: [String: RuntimeManifest.FileEntry]
    ) throws {
        let keys: [URLResourceKey] = [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]
        var enumerationFailed = false
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: keys,
            options: [],
            errorHandler: { _, _ in
                enumerationFailed = true
                return false
            }
        ) else {
            throw VerificationFailure.invalidRuntime("enumerator")
        }
        let canonicalManifestURL = manifestURL.resolvingSymlinksInPath()
        var actualFiles = Set<String>()
        while let candidate = enumerator.nextObject() as? URL {
            let values = try candidate.resourceValues(forKeys: Set(keys))
            guard values.isSymbolicLink != true else {
                throw VerificationFailure.invalidRuntime("symlink: \(candidate.path)")
            }
            let canonicalCandidate = candidate.resolvingSymlinksInPath()
            if canonicalCandidate == canonicalManifestURL { continue }
            let rootPrefix = root.path + "/"
            guard canonicalCandidate.path.hasPrefix(rootPrefix) else {
                throw VerificationFailure.invalidRuntime("outside runtime: \(candidate.path)")
            }
            let relative = String(canonicalCandidate.path.dropFirst(rootPrefix.count))
            if values.isDirectory == true {
                guard try permissions(candidate) == 0o555 else {
                    throw VerificationFailure.invalidRuntime("directory permissions: \(relative)")
                }
                continue
            }
            guard values.isRegularFile == true, entries[relative] != nil else {
                throw VerificationFailure.invalidRuntime("unexpected file: \(relative)")
            }
            actualFiles.insert(relative)
        }
        guard !enumerationFailed, actualFiles == Set(entries.keys) else {
            throw VerificationFailure.invalidRuntime("file set")
        }
    }

    private static func safeRuntimePath(_ value: String) throws -> String {
        guard !value.isEmpty,
              !(value as NSString).isAbsolutePath,
              !value.split(separator: "/", omittingEmptySubsequences: false).contains(where: {
                $0.isEmpty || $0 == "." || $0 == ".."
              }) else {
            throw VerificationFailure.invalidRepository
        }
        return value
    }

    private static func isSymbolicLink(_ url: URL) -> Bool {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return attributes?[.type] as? FileAttributeType == .typeSymbolicLink
    }

    private static func permissions(_ url: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue else {
            throw VerificationFailure.invalidRepository
        }
        return permissions
    }

    private static func fileSize(_ url: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let size = (attributes[.size] as? NSNumber)?.intValue else {
            throw VerificationFailure.invalidRepository
        }
        return size
    }

    private static func sha256(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty {
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func assertNoStrayPythonHostContent(
        repositoryRoot: URL,
        trackedScripts: Set<String>
    ) throws {
        let fileManager = FileManager.default
        let scriptsRoot = repositoryRoot.appendingPathComponent("scripts", isDirectory: true)
        var enumerationFailed = false
        guard let enumerator = fileManager.enumerator(
            at: scriptsRoot,
            includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
            options: [],
            errorHandler: { _, _ in
                enumerationFailed = true
                return false
            }
        ) else {
            throw VerificationFailure.invalidRepository
        }

        while let candidate = enumerator.nextObject() as? URL {
            let scopedComponents = candidate.pathComponents.suffix(enumerator.level)
            guard !scopedComponents.isEmpty else {
                throw VerificationFailure.invalidRepository
            }
            let relativePath = (["scripts"] + scopedComponents).joined(separator: "/")
            if trackedScripts.contains(relativePath) { continue }

            let values = try candidate.resourceValues(forKeys: [
                .isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey,
            ])
            let attributes = try fileManager.attributesOfItem(atPath: candidate.path)
            let fileType = attributes[.type] as? FileAttributeType
            let isSymbolicLink = values.isSymbolicLink == true || fileType == .typeSymbolicLink
            if values.isDirectory == true, !isSymbolicLink { continue }

            let isRegular = values.isRegularFile == true || fileType == .typeRegular
            let suffix = candidate.pathExtension.lowercased()
            let relativeComponents = relativePath.split(separator: "/").map(String.init)
            let isNeutralizedCacheBytecode = relativeComponents.contains("__pycache__")
                && ["pyc", "pyo"].contains(suffix)
                && isRegular
            if isNeutralizedCacheBytecode { continue }

            guard let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue else {
                throw VerificationFailure.invalidRepository
            }
            if isSymbolicLink
                || !isRegular
                || pythonImportExtensions.contains(suffix)
                || permissions & 0o111 != 0 {
                throw APIErrorEnvelope(error: .init(
                    code: "pbe_owner_checkout_stray_import",
                    message: "PBE Owner requires a scripts import scope without stray executable content."
                ))
            }
        }
        guard !enumerationFailed else { throw VerificationFailure.invalidRepository }
    }

    private static func hostPathspecs(repositoryRoot: URL) throws -> [String] {
        let manifest = repositoryRoot.appendingPathComponent(scopeManifest)
        let contents = try String(contentsOf: manifest, encoding: .utf8)
        var pathspecs = requiredPaths
        for line in contents.split(whereSeparator: { $0.isNewline }) {
            let value = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty, !value.hasPrefix("#"), !pathspecs.contains(value) {
                pathspecs.append(value)
            }
        }
        return pathspecs
    }

    private static func git(_ root: URL, _ arguments: [String]) throws -> GitOutput {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-C", root.path] + arguments
        process.standardOutput = output
        process.standardError = FileHandle(forWritingAtPath: "/dev/null")
        try process.run()
        process.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0 else { throw VerificationFailure.gitFailed }
        return GitOutput(data: data)
    }

    private struct GitOutput {
        var data: Data
        var text: String {
            String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        var textLines: [String] {
            text.split(whereSeparator: { $0.isNewline }).map(String.init)
        }
        var nulStrings: [String] {
            data.split(separator: 0).map { String(decoding: $0, as: UTF8.self) }
        }
    }

    private enum VerificationFailure: Error {
        case gitFailed
        case invalidRepository
        case invalidRuntime(String)
    }
}

struct PBEOwnerRuntimeRoots: Equatable {
    private struct ConnectorConfig: Decodable {
        var repoRoot: String
        var runtimeRoot: String?
    }

    var runtimeRoot: URL?
    var dataRoot: URL?

    static func resolve(
        environment: [String: String],
        bundleRuntimeRoot: URL?,
        connectorConfigURL: URL,
        homeDirectory: URL,
        fileManager: FileManager = .default
    ) -> PBEOwnerRuntimeRoots {
        let configExists = fileManager.fileExists(atPath: connectorConfigURL.path)
        let config: ConnectorConfig? = {
            guard configExists,
                  let data = try? Data(contentsOf: connectorConfigURL) else { return nil }
            return try? JSONDecoder().decode(ConnectorConfig.self, from: data)
        }()

        let environmentRuntime = environment["PBE_OWNER_RUNTIME_ROOT"]
            ?? environment["PBE_CONNECTOR_RUNTIME_ROOT"]
        let runtimeCandidates: [URL?] = [
            environmentRuntime.map { URL(fileURLWithPath: $0, isDirectory: true) },
            bundleRuntimeRoot,
            config?.runtimeRoot.map { URL(fileURLWithPath: $0, isDirectory: true) },
            configExists ? nil : homeDirectory.appendingPathComponent("Dev/PhotosByElie", isDirectory: true),
            configExists ? nil : homeDirectory.appendingPathComponent("MDev/PhotosByElie", isDirectory: true),
        ]
        let dataCandidates: [URL?] = [
            environment["PBE_REPO_ROOT"].map { URL(fileURLWithPath: $0, isDirectory: true) },
            config?.repoRoot.isEmpty == false
                ? URL(fileURLWithPath: config?.repoRoot ?? "", isDirectory: true)
                : nil,
            configExists ? nil : homeDirectory.appendingPathComponent("Dev/PhotosByElie", isDirectory: true),
            configExists ? nil : homeDirectory.appendingPathComponent("MDev/PhotosByElie", isDirectory: true),
        ]
        return PBEOwnerRuntimeRoots(
            runtimeRoot: firstExisting(
                runtimeCandidates,
                marker: "scripts/local_server.py",
                fileManager: fileManager
            ),
            dataRoot: firstExisting(
                dataCandidates,
                marker: "assets/owner-actions/Owner.sqlite",
                fileManager: fileManager
            )
        )
    }

    private static func firstExisting(
        _ candidates: [URL?],
        marker: String,
        fileManager: FileManager
    ) -> URL? {
        candidates.compactMap { $0 }.first(where: {
            fileManager.fileExists(atPath: $0.appendingPathComponent(marker).path)
        })?.standardizedFileURL
    }
}

public actor PBEOwnerLocalHostService: PBEOwnerHostServing {
    private struct ReadinessEnvelope: Codable {
        var ok: Bool
        var ready: Bool
        var sourceIdentity: String
        var catalogIdentity: String
        var readinessIdentity: String
        var fixtureRevision: String
        var lifecycleWriter: String
        var capabilities: [String]
    }

    private struct FixtureRequest: Codable { var fixtureId: String }

    private struct HostDescriptor: Codable {
        var port: Int
        var checkoutIdentity: String
        var protocolVersion: Int
    }

    private struct HostBootstrapRequest: Codable { var expectedCheckoutIdentity: String }
    private struct HostBootstrapEnvelope: Codable {
        var ok: Bool
        var checkoutIdentity: String
        var hostAuthorization: String
    }

    private var baseURL: URL
    private let transport: OwnerAPITransport
    private let decoder = JSONDecoder.ownerAPI
    private let encoder = JSONEncoder.ownerAPI
    private let runtimeRoot: URL?
    private let dataRoot: URL?
    private var launchedProcess: Process?
    private var hostAuthorization: String
    private var bootstrapDescriptorURL: URL?

    public init(
        baseURL: URL? = nil,
        transport: OwnerAPITransport = URLSessionOwnerTransport(),
        repositoryRoot: URL? = nil,
        runtimeRoot: URL? = nil,
        dataRoot: URL? = nil,
        connectorConfigURL: URL? = nil,
        hostAuthorization: String = ""
    ) {
        self.baseURL = baseURL ?? URL(string: "http://127.0.0.1:0/__photosbyelie/pbe-owner")!
        self.transport = transport
        let home = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
        let defaultConfig = home.appendingPathComponent(
            ".config/photosbyelie/connector.json",
            isDirectory: false
        )
        let bundleRuntime = Bundle.main.resourceURL?.appendingPathComponent(
            "OwnerRuntime",
            isDirectory: true
        )
        let roots = PBEOwnerRuntimeRoots.resolve(
            environment: ProcessInfo.processInfo.environment,
            bundleRuntimeRoot: bundleRuntime,
            connectorConfigURL: connectorConfigURL ?? defaultConfig,
            homeDirectory: home
        )
        self.runtimeRoot = runtimeRoot ?? repositoryRoot ?? roots.runtimeRoot
        self.dataRoot = dataRoot ?? repositoryRoot ?? roots.dataRoot
        self.hostAuthorization = hostAuthorization
    }

    public func ensureReadiness(fixtureID: String) async throws -> PBEOwnerHostReadiness {
        if hostAuthorization.isEmpty {
            try await launchHostAndBootstrap()
        }
        for _ in 0..<12 {
            if let readiness = try? await readiness(fixtureID: fixtureID) { return readiness }
            try await Task.sleep(for: .milliseconds(250))
        }
        throw APIErrorEnvelope(error: .init(
            code: "pbe_owner_host_unavailable",
            message: "Backstage could not attach to the local PBE host. Verify the PhotosByElie checkout and Owner.sqlite on this Mac."
        ))
    }

    public func attach(sessionToken: String, fixtureID: String) async throws -> PBEOwnerHostSessionEnvelope {
        try await send(
            path: "/session/start",
            method: "POST",
            token: sessionToken,
            body: FixtureRequest(fixtureId: fixtureID)
        )
    }

    public func status(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope {
        try await send(path: "/session", method: "GET", token: sessionToken, body: Optional<String>.none)
    }

    public func heartbeat(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope {
        try await send(path: "/session/heartbeat", method: "POST", token: sessionToken, body: Optional<String>.none)
    }

    public func close(sessionToken: String) async throws {
        let _: PBEOwnerHostSessionEnvelope = try await send(
            path: "/session/close",
            method: "POST",
            token: sessionToken,
            body: Optional<String>.none
        )
    }

    public func stopIfLaunched() async {
        guard let launchedProcess else { return }
        if launchedProcess.isRunning { launchedProcess.terminate() }
        self.launchedProcess = nil
        if let bootstrapDescriptorURL {
            try? FileManager.default.removeItem(at: bootstrapDescriptorURL)
        }
        self.bootstrapDescriptorURL = nil
        hostAuthorization = ""
    }

    private func readiness(fixtureID: String) async throws -> PBEOwnerHostReadiness {
        let envelope: ReadinessEnvelope = try await send(
            path: "/readiness",
            method: "GET",
            token: "",
            body: Optional<String>.none,
            query: [URLQueryItem(name: "fixtureId", value: fixtureID)]
        )
        guard envelope.ok, envelope.ready,
              !envelope.sourceIdentity.isEmpty,
              !envelope.catalogIdentity.isEmpty,
              !envelope.readinessIdentity.isEmpty,
              !envelope.fixtureRevision.isEmpty,
              envelope.lifecycleWriter == "pbb-79-waste-basket",
              Set(envelope.capabilities).isSuperset(
                of: ["gallery.read", "waste-basket.x", "waste-basket.restore"]
              )
        else {
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_host_not_ready",
                message: "The local PBE host did not provide the required source, catalog, readiness, and Waste Basket contract."
            ))
        }
        return PBEOwnerHostReadiness(
            ready: envelope.ready,
            sourceIdentity: envelope.sourceIdentity,
            catalogIdentity: envelope.catalogIdentity,
            readinessIdentity: envelope.readinessIdentity,
            fixtureRevision: envelope.fixtureRevision,
            lifecycleWriter: envelope.lifecycleWriter,
            capabilities: envelope.capabilities
        )
    }

    private func launchHostAndBootstrap() async throws {
        if launchedProcess?.isRunning == true { return }
        guard let runtimeRoot,
              FileManager.default.fileExists(
                atPath: runtimeRoot.appendingPathComponent("scripts/local_server.py").path
              ) else {
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_runtime_missing",
                message: "Backstage cannot find its installed PBE Owner runtime on this Mac."
            ))
        }
        let expectedCheckoutIdentity = try PBEOwnerCheckoutIdentity.verified(repositoryRoot: runtimeRoot)
        guard let dataRoot,
              FileManager.default.fileExists(
                atPath: dataRoot.appendingPathComponent("assets/owner-actions/Owner.sqlite").path
              ) else {
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_data_root_missing",
                message: "Backstage cannot find the configured Owner.sqlite data root on this Mac."
            ))
        }
        let descriptorURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-owner-host-\(UUID().uuidString).json")
        let bytecodeCacheURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-owner-python-cache-\(UUID().uuidString)", isDirectory: true)
        let process = Process()
        // Use macOS's bundled Python explicitly.  Resolving `python3` through
        // the Backstage PATH can select a Homebrew Python whose extension
        // modules are not compatible with the system libraries on this Mac
        // (notably Python 3.14's `pyexpat` against `/usr/lib/libexpat`).
        // The immutable host runtime is kept compatible with Apple's Python;
        // Homebrew remains available in PATH for host subprocesses such as
        // Node-based catalog helpers.
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = [
            "-E", "-B", "-X", "pycache_prefix=\(bytecodeCacheURL.path)",
            runtimeRoot.appendingPathComponent("scripts/local_server.py").path,
            "0", "--bind", "127.0.0.1",
            "--backstage-bootstrap-file", descriptorURL.path,
        ]
        process.currentDirectoryURL = dataRoot
        var environment = ProcessInfo.processInfo.environment
        for key in environment.keys where key.hasPrefix("PYTHON") {
            environment.removeValue(forKey: key)
        }
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        environment["PBE_CONNECTOR_RUNTIME_ROOT"] = runtimeRoot.path
        environment["PBE_REPO_ROOT"] = dataRoot.path
        let launchCheckoutIdentity = try PBEOwnerCheckoutIdentity.verified(repositoryRoot: runtimeRoot)
        guard launchCheckoutIdentity == expectedCheckoutIdentity else {
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_checkout_changed",
                message: "The PBE Owner checkout changed while Backstage prepared the local host."
            ))
        }
        let bootstrapSecret = "\(UUID().uuidString)\(UUID().uuidString)"
        environment["PBE_BACKSTAGE_BOOTSTRAP_SECRET"] = bootstrapSecret
        process.environment = environment
        process.standardOutput = FileHandle(forWritingAtPath: "/dev/null")
        process.standardError = FileHandle(forWritingAtPath: "/dev/null")
        do {
            try process.run()
            launchedProcess = process
            bootstrapDescriptorURL = descriptorURL
            var descriptor: HostDescriptor?
            for _ in 0..<30 {
                if let data = try? Data(contentsOf: descriptorURL),
                   let decoded = try? decoder.decode(HostDescriptor.self, from: data) {
                    descriptor = decoded
                    break
                }
                if !process.isRunning { break }
                try await Task.sleep(for: .milliseconds(100))
            }
            guard let descriptor,
                  descriptor.protocolVersion == 1,
                  (1...65_535).contains(descriptor.port),
                  descriptor.checkoutIdentity == expectedCheckoutIdentity else {
                throw APIErrorEnvelope(error: .init(
                    code: "pbe_owner_host_identity_mismatch",
                    message: "The launched PBE host did not prove the expected checkout identity."
                ))
            }
            baseURL = URL(string: "http://127.0.0.1:\(descriptor.port)/__photosbyelie/pbe-owner")!
            let bootstrap: HostBootstrapEnvelope = try await sendBootstrap(
                secret: bootstrapSecret,
                expectedCheckoutIdentity: expectedCheckoutIdentity
            )
            guard bootstrap.ok,
                  bootstrap.checkoutIdentity == expectedCheckoutIdentity,
                  !bootstrap.hostAuthorization.isEmpty else {
                throw APIErrorEnvelope(error: .init(
                    code: "pbe_owner_host_bootstrap_invalid",
                    message: "The launched PBE host bootstrap contract was invalid."
                ))
            }
            hostAuthorization = bootstrap.hostAuthorization
            try? FileManager.default.removeItem(at: descriptorURL)
            bootstrapDescriptorURL = nil
        } catch {
            if process.isRunning { process.terminate() }
            launchedProcess = nil
            try? FileManager.default.removeItem(at: descriptorURL)
            bootstrapDescriptorURL = nil
            throw error
        }
    }

    private func sendBootstrap(
        secret: String,
        expectedCheckoutIdentity: String
    ) async throws -> HostBootstrapEnvelope {
        let endpoint = baseURL.appendingPathComponent("host/bootstrap")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(secret, forHTTPHeaderField: "X-PBE-Host-Bootstrap")
        request.httpBody = try encoder.encode(HostBootstrapRequest(
            expectedCheckoutIdentity: expectedCheckoutIdentity
        ))
        let (data, response) = try await transport.data(for: request)
        guard (200..<300).contains(response.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_host_bootstrap_failed",
                message: "Backstage could not authenticate the launched PBE host."
            ))
        }
        return try decoder.decode(HostBootstrapEnvelope.self, from: data)
    }

    private func send<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        token: String,
        body: Body?,
        query: [URLQueryItem] = []
    ) async throws -> Response {
        let endpoint = baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.queryItems = query.isEmpty ? nil : query
        guard let requestURL = components?.url else { throw URLError(.badURL) }
        var request = URLRequest(url: requestURL)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !hostAuthorization.isEmpty {
            request.setValue(hostAuthorization, forHTTPHeaderField: "X-PBE-Host-Authorization")
        }
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else if method == "POST" {
            request.httpBody = Data("{}".utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await transport.data(for: request)
        guard (200..<300).contains(response.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw APIErrorEnvelope(error: .init(
                code: "pbe_owner_host_error",
                message: "The local PBE host returned HTTP \(response.statusCode)."
            ))
        }
        return try decoder.decode(Response.self, from: data)
    }

}

public actor OwnerAPIClient {
    public typealias AuthenticationRecoveryHandler = @Sendable () async -> Bool

    public static let productionBaseURL = URL(string: "https://auth.photos-by-elie.com/api/v1")!

    private let baseURL: URL
    private let transport: OwnerAPITransport
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var accessToken: String?
    private var authenticationRecoveryHandler: AuthenticationRecoveryHandler?

    public init(
        baseURL: URL = OwnerAPIClient.productionBaseURL,
        transport: OwnerAPITransport = URLSessionOwnerTransport()
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.encoder = JSONEncoder.ownerAPI
        self.decoder = JSONDecoder.ownerAPI
    }

    public func setAccessToken(_ token: String?) {
        accessToken = token
    }

    public func setAuthenticationRecoveryHandler(
        _ handler: AuthenticationRecoveryHandler?
    ) {
        authenticationRecoveryHandler = handler
    }

    public func listActions(
        limit: Int = 50,
        cursor: String? = nil,
        state: OwnerActionState? = nil
    ) async throws -> OwnerActionPage {
        var query = [URLQueryItem(name: "limit", value: String(max(1, min(200, limit))))]
        if let cursor, !cursor.isEmpty { query.append(.init(name: "cursor", value: cursor)) }
        if let state { query.append(.init(name: "state", value: state.rawValue)) }
        return try await send(path: "/actions", query: query)
    }

    public func getAction(id: String) async throws -> OwnerAction {
        let envelope: OwnerActionEnvelope = try await send(path: "/actions/\(id.urlPathEncoded)")
        return envelope.action
    }

    public func createAction(
        _ action: OwnerActionCreate,
        idempotencyKey: String = UUID().uuidString
    ) async throws -> OwnerActionEnvelope {
        try await send(
            path: "/actions",
            method: "POST",
            body: action,
            idempotencyKey: idempotencyKey
        )
    }

    public func cancelAction(
        id: String,
        reason: String,
        idempotencyKey: String = UUID().uuidString
    ) async throws -> OwnerAction {
        struct Cancellation: Codable { let reason: String }
        let envelope: OwnerActionEnvelope = try await send(
            path: "/actions/\(id.urlPathEncoded)/cancel",
            method: "POST",
            body: Cancellation(reason: reason),
            idempotencyKey: idempotencyKey
        )
        return envelope.action
    }

    public func exchangeDeviceCredential(
        deviceId: String,
        deviceCredential: String
    ) async throws -> OwnerTokenBundle {
        struct Exchange: Codable {
            let deviceId: String
            let deviceCredential: String
        }
        return try await send(
            path: "/auth/tokens",
            method: "POST",
            body: Exchange(
                deviceId: deviceId,
                deviceCredential: deviceCredential
            ),
            authenticated: false
        )
    }

    public func logout() async throws {
        struct Logout: Codable {}
        let _: EmptyResponse = try await send(
            path: "/auth/logout",
            method: "POST",
            body: Logout(),
            authenticated: false
        )
        accessToken = nil
    }

    public func mintPBEOwnerSession(
        _ request: PBEOwnerSessionMintRequest
    ) async throws -> PBEOwnerSessionMintEnvelope {
        try await send(
            path: "/pbe-owner/sessions",
            method: "POST",
            body: request
        )
    }

    public func closePBEOwnerSession(
        id: String,
        sessionToken: String
    ) async throws -> PBEOwnerHostSessionEnvelope {
        try await send(
            path: "/pbe-owner/sessions/\(id.urlPathEncoded)/close",
            method: "POST",
            body: Optional<String>.none,
            authenticated: false,
            authorizationToken: sessionToken
        )
    }

    public func request<Response: Decodable>(
        path: String,
        query: [URLQueryItem] = []
    ) async throws -> Response {
        try await send(path: path, query: query)
    }

    public func request<Body: Encodable, Response: Decodable>(
        path: String,
        method: String = "POST",
        body: Body,
        idempotencyKey: String? = nil
    ) async throws -> Response {
        try await send(
            path: path,
            method: method,
            body: body,
            idempotencyKey: idempotencyKey
        )
    }

    private func send<Response: Decodable>(
        path: String,
        query: [URLQueryItem] = [],
        authenticated: Bool = true,
        authorizationToken: String? = nil
    ) async throws -> Response {
        try await send(
            path: path,
            method: "GET",
            query: query,
            body: Optional<String>.none,
            authenticated: authenticated,
            authorizationToken: authorizationToken
        )
    }

    private func send<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        query: [URLQueryItem] = [],
        body: Body?,
        idempotencyKey: String? = nil,
        authenticated: Bool = true,
        authorizationToken: String? = nil
    ) async throws -> Response {
        var components = URLComponents(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }
        if let authorizationToken, !authorizationToken.isEmpty {
            request.setValue("Bearer \(authorizationToken)", forHTTPHeaderField: "Authorization")
        } else if authenticated, let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        var (data, response) = try await transport.data(for: request)
        if authenticated,
           authorizationToken == nil,
           response.statusCode == 401,
           let authenticationRecoveryHandler,
           await authenticationRecoveryHandler() {
            if let accessToken {
                request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
            } else {
                request.setValue(nil, forHTTPHeaderField: "Authorization")
            }
            (data, response) = try await transport.data(for: request)
        }
        guard (200..<300).contains(response.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) {
                throw envelope
            }
            throw URLError(.badServerResponse)
        }
        if Response.self == EmptyResponse.self && data.isEmpty {
            return EmptyResponse() as! Response
        }
        return try decoder.decode(Response.self, from: data)
    }
}

private struct EmptyResponse: Codable {}

private extension String {
    var urlPathEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? self
    }
}

public extension JSONDecoder {
    static var ownerAPI: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

public extension JSONEncoder {
    static var ownerAPI: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
