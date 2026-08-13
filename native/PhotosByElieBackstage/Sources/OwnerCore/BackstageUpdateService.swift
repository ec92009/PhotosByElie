import CryptoKit
import Foundation

public protocol BackstageUpdateTransport: Sendable {
    func fetchManifest(from url: URL) async throws -> Data
    func download(
        from url: URL,
        to destination: URL,
        progress: @escaping @Sendable (Int64, Int64) -> Void
    ) async throws
}

public protocol BackstageUpdateArtifactExtracting: Sendable {
    func extractAppBundle(from archiveURL: URL, to directoryURL: URL) throws -> URL
}

public protocol BackstageCodeSignatureVerifying: Sendable {
    func verify(
        bundleURL: URL,
        expectedBundleIdentifier: String,
        trust: BackstageReleaseTrust
    ) throws
}

public protocol BackstageCurrentReleaseTrustReading: Sendable {
    func readTrust(bundleURL: URL) throws -> BackstageReleaseTrust
}

public struct URLSessionBackstageUpdateTransport: BackstageUpdateTransport, @unchecked Sendable {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func fetchManifest(from url: URL) async throws -> Data {
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return data
    }

    public func download(
        from url: URL,
        to destination: URL,
        progress: @escaping @Sendable (Int64, Int64) -> Void
    ) async throws {
        let (bytes, response) = try await session.bytes(from: url)
        try validate(response: response)
        let responseLength = response.expectedContentLength > 0 ? response.expectedContentLength : 0
        var received: Int64 = 0
        var data = Data()
        data.reserveCapacity(responseLength > 0 ? Int(responseLength) : 0)
        progress(0, responseLength)
        for try await byte in bytes {
            data.append(byte)
            received += 1
            if received % 65_536 == 0 || (responseLength > 0 && received == responseLength) {
                progress(received, responseLength)
            }
        }
        try data.write(to: destination, options: .atomic)
        progress(received, responseLength)
    }

    private func validate(response: URLResponse) throws {
        guard response.url?.scheme?.lowercased() == "https",
              let responseHost = response.url?.host,
              !responseHost.isEmpty else {
            throw BackstageUpdateError.network("The release server redirected to a non-HTTPS response.")
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw BackstageUpdateError.network("The release server returned HTTP \(status).")
        }
    }
}

public struct DittoBackstageUpdateArtifactExtractor: BackstageUpdateArtifactExtracting, Sendable {
    public init() {}

    public func extractAppBundle(from archiveURL: URL, to directoryURL: URL) throws -> URL {
        try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        process.arguments = ["-x", "-k", archiveURL.path, directoryURL.path]
        let errorPipe = Pipe()
        process.standardError = errorPipe
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let message = String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            throw BackstageUpdateError.archiveInvalid(
                "The downloaded Backstage archive could not be unpacked. \(message.trimmingCharacters(in: .whitespacesAndNewlines))"
            )
        }
        let bundles = FileManager.default.enumerator(
            at: directoryURL,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )?.compactMap { item -> URL? in
            guard let url = item as? URL, url.pathExtension == "app" else { return nil }
            return url
        } ?? []
        guard bundles.count == 1 else {
            throw BackstageUpdateError.archiveInvalid("The archive must contain exactly one macOS app bundle.")
        }
        return bundles[0]
    }
}

public struct BackstageUpdateService: Sendable {
    public let configuration: BackstageUpdateConfiguration
    private let transport: any BackstageUpdateTransport
    private let extractor: any BackstageUpdateArtifactExtracting
    private let signatureVerifier: any BackstageCodeSignatureVerifying
    private let currentTrustReader: any BackstageCurrentReleaseTrustReading
    private let currentBundleURL: URL?
    private let cacheDirectory: URL

    public init(
        configuration: BackstageUpdateConfiguration = BackstageUpdateConfiguration(bundle: .main),
        transport: any BackstageUpdateTransport = URLSessionBackstageUpdateTransport(),
        extractor: any BackstageUpdateArtifactExtracting = DittoBackstageUpdateArtifactExtractor(),
        signatureVerifier: any BackstageCodeSignatureVerifying = SystemBackstageCodeSignatureVerifier(),
        currentTrustReader: any BackstageCurrentReleaseTrustReading = SystemBackstageCodeSignatureVerifier(),
        currentBundleURL: URL? = Bundle.main.bundleURL,
        cacheDirectory: URL? = nil
    ) {
        self.configuration = configuration
        self.transport = transport
        self.extractor = extractor
        self.signatureVerifier = signatureVerifier
        self.currentTrustReader = currentTrustReader
        self.currentBundleURL = currentBundleURL
        self.cacheDirectory = cacheDirectory
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("PhotosByElie/Backstage/Updates", isDirectory: true)
    }

    public func check(current: BackstageReleaseIdentity) async throws -> BackstageUpdateCheck {
        guard let manifestURL = configuration.manifestURL else {
            throw BackstageUpdateError.configurationMissing
        }
        guard manifestURL.scheme?.lowercased() == "https",
              let manifestHost = manifestURL.host,
              !manifestHost.isEmpty,
              manifestURL.user == nil,
              manifestURL.password == nil else {
            throw BackstageUpdateError.invalidManifest("The configured release-manifest endpoint must be HTTPS.")
        }
        let data = try await transport.fetchManifest(from: manifestURL)
        let manifest: BackstageReleaseManifest
        do {
            manifest = try JSONDecoder().decode(BackstageReleaseManifest.self, from: data)
        } catch {
            throw BackstageUpdateError.invalidManifest("The cloud release manifest is not valid JSON: \(error.localizedDescription)")
        }
        try manifest.validate()
        try enforceStableSigningContract(manifest)
        return try makeCheck(current: current, manifest: manifest)
    }

    public func makeCheck(
        current: BackstageReleaseIdentity,
        manifest: BackstageReleaseManifest
    ) throws -> BackstageUpdateCheck {
        try manifest.validate()
        guard current.bundleIdentifier == BackstageReleaseManifest.bundleIdentifier else {
            return BackstageUpdateCheck(
                current: current,
                manifest: manifest,
                availability: .incompatible
            )
        }
        guard let versionOrder = BackstageReleaseNumber.compare(current.version, manifest.version),
              let buildOrder = BackstageReleaseNumber.compare(current.build, manifest.build) else {
            throw BackstageUpdateError.invalidManifest("The installed Backstage version/build is not comparable.")
        }
        if versionOrder == .orderedDescending || (versionOrder == .orderedSame && buildOrder == .orderedDescending) {
            return BackstageUpdateCheck(current: current, manifest: manifest, availability: .downgradeRejected)
        }
        if versionOrder == .orderedSame && buildOrder == .orderedSame {
            return BackstageUpdateCheck(current: current, manifest: manifest, availability: .current)
        }
        guard let minimumOS = Self.operatingSystemVersion(manifest.minimumOSVersion) else {
            throw BackstageUpdateError.invalidManifest("Manifest minimumOSVersion is not comparable on this platform.")
        }
        guard ProcessInfo.processInfo.isOperatingSystemAtLeast(minimumOS) else {
            return BackstageUpdateCheck(current: current, manifest: manifest, availability: .incompatible)
        }
        return BackstageUpdateCheck(current: current, manifest: manifest, availability: .updateAvailable)
    }

    public func downloadAndVerify(
        current: BackstageReleaseIdentity,
        manifest: BackstageReleaseManifest,
        progress: @escaping @Sendable (Int64, Int64) -> Void = { _, _ in }
    ) async throws -> BackstageVerifiedUpdate {
        let check = try makeCheck(current: current, manifest: manifest)
        switch check.availability {
        case .updateAvailable:
            break
        case .current:
            throw BackstageUpdateError.noUpdateAvailable
        case .downgradeRejected:
            throw BackstageUpdateError.downgradeRejected
        case .incompatible:
            throw BackstageUpdateError.incompatible("The available Backstage build is not compatible with this installation or Mac.")
        }

        try enforceStableSigningContract(manifest)

        let fileManager = FileManager.default
        let temporaryRoot = cacheDirectory.appendingPathComponent(".download-\(UUID().uuidString)", isDirectory: true)
        let archiveURL = temporaryRoot.appendingPathComponent("Backstage-update.zip")
        let extractionURL = temporaryRoot.appendingPathComponent("extracted", isDirectory: true)
        do {
            try fileManager.createDirectory(at: temporaryRoot, withIntermediateDirectories: true)
            try await transport.download(from: manifest.downloadURL, to: archiveURL, progress: progress)
            let attributes = try fileManager.attributesOfItem(atPath: archiveURL.path)
            guard let size = attributes[.size] as? NSNumber, size.int64Value == manifest.fileSize else {
                throw BackstageUpdateError.downloadFailed("The downloaded archive size did not match the release manifest.")
            }
            let actualChecksum = try Self.sha256(of: archiveURL)
            guard actualChecksum.caseInsensitiveCompare(manifest.sha256) == .orderedSame else {
                throw BackstageUpdateError.checksumMismatch(
                    expected: manifest.sha256.lowercased(),
                    actual: actualChecksum
                )
            }
            let bundleURL = try extractor.extractAppBundle(from: archiveURL, to: extractionURL)
            let extractionPath = extractionURL.resolvingSymlinksInPath().standardizedFileURL.path + "/"
            let bundlePath = bundleURL.resolvingSymlinksInPath().standardizedFileURL.path
            guard bundlePath.hasPrefix(extractionPath) else {
                throw BackstageUpdateError.archiveInvalid(
                    "The archive extractor returned an app bundle outside the isolated update directory."
                )
            }
            try verifyBundle(bundleURL, manifest: manifest)
            let finalRoot = cacheDirectory.appendingPathComponent(
                "Backstage-\(manifest.version)-\(manifest.build)-\(UUID().uuidString)",
                isDirectory: true
            )
            let temporaryPath = temporaryRoot.resolvingSymlinksInPath().standardizedFileURL.path + "/"
            guard bundlePath.hasPrefix(temporaryPath) else {
                throw BackstageUpdateError.archiveInvalid(
                    "The verified app bundle was not contained in the isolated update directory."
                )
            }
            let relativeBundlePath = String(bundlePath.dropFirst(temporaryPath.count))
            try fileManager.moveItem(at: temporaryRoot, to: finalRoot)
            return BackstageVerifiedUpdate(
                manifest: manifest,
                archiveURL: finalRoot.appendingPathComponent("Backstage-update.zip"),
                bundleURL: finalRoot.appendingPathComponent(relativeBundlePath)
            )
        } catch {
            try? fileManager.removeItem(at: temporaryRoot)
            if let updateError = error as? BackstageUpdateError { throw updateError }
            throw BackstageUpdateError.downloadFailed(error.localizedDescription)
        }
    }

    public static func sha256(of url: URL) throws -> String {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func operatingSystemVersion(_ value: String) -> OperatingSystemVersion? {
        let components = value.split(separator: ".").compactMap { Int($0) }
        guard components.count == value.split(separator: ".").count,
              (1...3).contains(components.count) else { return nil }
        return OperatingSystemVersion(
            majorVersion: components[0],
            minorVersion: components.count > 1 ? components[1] : 0,
            patchVersion: components.count > 2 ? components[2] : 0
        )
    }

    private func verifyBundle(_ bundleURL: URL, manifest: BackstageReleaseManifest) throws {
        guard let bundle = Bundle(url: bundleURL),
              let bundleIdentifier = bundle.object(forInfoDictionaryKey: "CFBundleIdentifier") as? String,
              let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
              let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String else {
            throw BackstageUpdateError.signatureMismatch("The verified archive does not contain a readable Backstage app bundle.")
        }
        guard bundleIdentifier == manifest.bundleIdentifier else {
            throw BackstageUpdateError.signatureMismatch("The downloaded app bundle identifier does not match the stable Backstage identity.")
        }
        guard version == manifest.version, build == manifest.build else {
            throw BackstageUpdateError.signatureMismatch("The downloaded app version/build does not match the release manifest.")
        }
        try signatureVerifier.verify(
            bundleURL: bundleURL,
            expectedBundleIdentifier: manifest.bundleIdentifier,
            trust: manifest.trust
        )
    }

    private func enforceStableSigningContract(_ manifest: BackstageReleaseManifest) throws {
        guard let currentBundleURL, currentBundleURL.pathExtension == "app" else { return }
        do {
            let currentTrust = try currentTrustReader.readTrust(bundleURL: currentBundleURL)
            guard currentTrust.teamIdentifier == manifest.trust.teamIdentifier,
                  currentTrust.signingIdentity == manifest.trust.signingIdentity,
                  currentTrust.designatedRequirement == manifest.trust.designatedRequirement else {
                throw BackstageUpdateError.incompatible(
                    "The update signing contract differs from the running app; it was blocked to preserve Keychain, Photos, and connector identity."
                )
            }
        } catch let error as BackstageUpdateError {
            throw error
        } catch {
            throw BackstageUpdateError.signatureMismatch(
                "The running Backstage signing contract could not be established; the update was not downloaded."
            )
        }
    }
}
