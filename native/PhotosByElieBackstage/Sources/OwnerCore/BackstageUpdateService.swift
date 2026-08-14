import CryptoKit
import Foundation

public protocol BackstageUpdateTransport: Sendable {
    func fetchManifest(from url: URL) async throws -> Data
    func download(
        from url: URL,
        to destination: URL,
        expectedFileSize: Int64,
        maximumFileSize: Int64,
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
        try await download(
            from: url,
            to: destination,
            expectedFileSize: BackstageUpdateResourceLimits.hardMaximumArchiveFileSize,
            maximumFileSize: BackstageUpdateResourceLimits.hardMaximumArchiveFileSize,
            requireExactSize: false,
            progress: progress
        )
    }

    public func download(
        from url: URL,
        to destination: URL,
        expectedFileSize: Int64,
        maximumFileSize: Int64,
        progress: @escaping @Sendable (Int64, Int64) -> Void
    ) async throws {
        try await download(
            from: url,
            to: destination,
            expectedFileSize: expectedFileSize,
            maximumFileSize: maximumFileSize,
            requireExactSize: true,
            progress: progress
        )
    }

    private func download(
        from url: URL,
        to destination: URL,
        expectedFileSize: Int64,
        maximumFileSize: Int64,
        requireExactSize: Bool,
        progress: @escaping @Sendable (Int64, Int64) -> Void
    ) async throws {
        let effectiveMaximum = min(
            expectedFileSize,
            maximumFileSize,
            BackstageUpdateResourceLimits.hardMaximumArchiveFileSize
        )
        guard effectiveMaximum > 0 else {
            throw BackstageUpdateError.downloadFailed("The permitted archive size is invalid.")
        }
        let (bytes, response) = try await session.bytes(from: url)
        try validate(response: response)
        let responseLength = response.expectedContentLength > 0 ? response.expectedContentLength : 0
        guard responseLength == 0 || responseLength <= effectiveMaximum else {
            throw BackstageUpdateError.downloadFailed(
                "The release response exceeds the declared or hard archive-size limit."
            )
        }

        let fileManager = FileManager.default
        try? fileManager.removeItem(at: destination)
        guard fileManager.createFile(atPath: destination.path, contents: nil) else {
            throw BackstageUpdateError.downloadFailed("The temporary archive could not be created.")
        }
        let handle = try FileHandle(forWritingTo: destination)
        var received: Int64 = 0
        var buffer = Data()
        buffer.reserveCapacity(65_536)
        var completed = false
        defer {
            try? handle.close()
            if !completed {
                try? fileManager.removeItem(at: destination)
            }
        }
        progress(0, requireExactSize ? expectedFileSize : responseLength)
        for try await byte in bytes {
            guard received < effectiveMaximum else {
                throw BackstageUpdateError.downloadFailed(
                    "The release response exceeded the declared or hard archive-size limit while downloading."
                )
            }
            buffer.append(byte)
            received += 1
            if buffer.count == 65_536 {
                try handle.write(contentsOf: buffer)
                buffer.removeAll(keepingCapacity: true)
                progress(received, requireExactSize ? expectedFileSize : responseLength)
            }
        }
        if !buffer.isEmpty {
            try handle.write(contentsOf: buffer)
        }
        if requireExactSize, received != expectedFileSize {
            throw BackstageUpdateError.downloadFailed(
                "The downloaded archive size did not match the release manifest."
            )
        }
        try handle.synchronize()
        completed = true
        progress(received, requireExactSize ? expectedFileSize : responseLength)
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

private enum BackstageBoundedProcess {
    static func run(
        executable: String,
        arguments: [String],
        maximumOutputSize: Int
    ) throws -> (status: Int32, output: Data) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        environment.removeValue(forKey: "ZIPINFO")
        environment.removeValue(forKey: "ZIPINFOOPT")
        environment["LANG"] = "C"
        environment["LC_ALL"] = "C"
        process.environment = environment
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        var output = Data()
        do {
            while let chunk = try pipe.fileHandleForReading.read(upToCount: 65_536),
                  !chunk.isEmpty {
                guard output.count <= maximumOutputSize - chunk.count else {
                    process.terminate()
                    process.waitUntilExit()
                    throw BackstageUpdateError.archiveInvalid(
                        "The archive inspection output exceeded its safety limit."
                    )
                }
                output.append(chunk)
            }
        } catch {
            if process.isRunning {
                process.terminate()
                process.waitUntilExit()
            }
            throw error
        }
        process.waitUntilExit()
        return (process.terminationStatus, output)
    }
}

private enum BackstageZipArchiveInspector {
    private static let maximumArchiveListingSize = 16 * 1_024 * 1_024

    static func validate(
        archiveURL: URL,
        limits: BackstageUpdateResourceLimits
    ) throws {
        let pathResult = try BackstageBoundedProcess.run(
            executable: "/usr/bin/zipinfo",
            arguments: ["-1", archiveURL.path],
            maximumOutputSize: maximumArchiveListingSize
        )
        guard pathResult.status == 0,
              let listing = String(data: pathResult.output, encoding: .utf8) else {
            throw BackstageUpdateError.archiveInvalid(
                "The downloaded archive could not be inspected safely before extraction."
            )
        }

        var entryCount = 0
        var appRoot: String?
        var metadataRoots: Set<String> = []
        for rawPath in listing.split(whereSeparator: \Character.isNewline) {
            let path = String(rawPath)
            entryCount += 1
            guard entryCount <= limits.maximumExtractedEntryCount else {
                throw BackstageUpdateError.archiveInvalid(
                    "The archive exceeds the \(limits.maximumExtractedEntryCount)-entry safety limit."
                )
            }
            guard path.utf8.count <= 4_096,
                  !path.hasPrefix("/"),
                  !path.contains("\\"),
                  !path.contains("\0") else {
                throw BackstageUpdateError.archiveInvalid("The archive contains an unsafe entry path.")
            }
            var components = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            if components.last == "" { components.removeLast() }
            guard !components.isEmpty,
                  components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
                throw BackstageUpdateError.archiveInvalid("The archive contains an unsafe entry path.")
            }

            if components[0] == "__MACOSX" {
                guard components.count > 1 else {
                    throw BackstageUpdateError.archiveInvalid("The archive contains an invalid metadata root.")
                }
                let metadataRoot = components[1].hasPrefix("._")
                    ? String(components[1].dropFirst(2))
                    : components[1]
                metadataRoots.insert(metadataRoot)
                continue
            }

            let root = components[0]
            guard root.hasSuffix(".app") else {
                throw BackstageUpdateError.archiveInvalid(
                    "The archive may contain only one top-level macOS app bundle."
                )
            }
            if let appRoot {
                guard appRoot == root else {
                    throw BackstageUpdateError.archiveInvalid(
                        "The archive contains more than one top-level app bundle."
                    )
                }
            } else {
                appRoot = root
            }
            guard !components.dropFirst().contains(where: { $0.hasSuffix(".app") }) else {
                throw BackstageUpdateError.archiveInvalid(
                    "The archive contains a nested app bundle outside the one-app contract."
                )
            }
        }
        guard entryCount > 0, let appRoot else {
            throw BackstageUpdateError.archiveInvalid("The archive does not contain a macOS app bundle.")
        }
        guard metadataRoots.allSatisfy({ $0 == appRoot }) else {
            throw BackstageUpdateError.archiveInvalid(
                "The archive contains metadata outside the declared app bundle."
            )
        }

        let sizeResult = try BackstageBoundedProcess.run(
            executable: "/usr/bin/zipinfo",
            arguments: ["-l", archiveURL.path],
            maximumOutputSize: maximumArchiveListingSize
        )
        guard sizeResult.status == 0,
              let sizeListing = String(data: sizeResult.output, encoding: .utf8) else {
            throw BackstageUpdateError.archiveInvalid(
                "The archive sizes could not be inspected safely before extraction."
            )
        }
        var sizedEntryCount = 0
        var totalUncompressedSize: Int64 = 0
        for line in sizeListing.split(whereSeparator: \Character.isNewline) {
            let fields = line.split(whereSeparator: \Character.isWhitespace)
            guard fields.count >= 4,
                  fields[0].count == 10,
                  fields[1].contains("."),
                  fields[2].count == 3,
                  let size = Int64(fields[3]) else {
                continue
            }
            sizedEntryCount += 1
            guard size <= limits.maximumExtractedRegularFileSize,
                  totalUncompressedSize <= limits.maximumExtractedRegularFileSize - size else {
                throw BackstageUpdateError.archiveInvalid(
                    "The archive declares more than \(limits.maximumExtractedRegularFileSize) bytes of uncompressed content."
                )
            }
            totalUncompressedSize += size
        }
        guard sizedEntryCount == entryCount else {
            throw BackstageUpdateError.archiveInvalid(
                "The archive central directory could not be inspected completely."
            )
        }
    }
}

public struct DittoBackstageUpdateArtifactExtractor: BackstageUpdateArtifactExtracting, Sendable {
    private let limits: BackstageUpdateResourceLimits

    public init(limits: BackstageUpdateResourceLimits = .standard) {
        self.limits = limits
    }

    public func extractAppBundle(from archiveURL: URL, to directoryURL: URL) throws -> URL {
        try BackstageZipArchiveInspector.validate(archiveURL: archiveURL, limits: limits)
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        var completed = false
        defer {
            if !completed {
                try? fileManager.removeItem(at: directoryURL)
            }
        }
        let result = try BackstageBoundedProcess.run(
            executable: "/usr/bin/ditto",
            arguments: ["-x", "-k", archiveURL.path, directoryURL.path],
            maximumOutputSize: 65_536
        )
        guard result.status == 0 else {
            let message = String(data: result.output, encoding: .utf8) ?? ""
            throw BackstageUpdateError.archiveInvalid(
                "The downloaded Backstage archive could not be unpacked. \(message.trimmingCharacters(in: .whitespacesAndNewlines))"
            )
        }
        let bundles = fileManager.enumerator(
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
        completed = true
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
    private let limits: BackstageUpdateResourceLimits

    public init(
        configuration: BackstageUpdateConfiguration = BackstageUpdateConfiguration(bundle: .main),
        transport: any BackstageUpdateTransport = URLSessionBackstageUpdateTransport(),
        extractor: (any BackstageUpdateArtifactExtracting)? = nil,
        signatureVerifier: any BackstageCodeSignatureVerifying = SystemBackstageCodeSignatureVerifier(),
        currentTrustReader: any BackstageCurrentReleaseTrustReading = SystemBackstageCodeSignatureVerifier(),
        currentBundleURL: URL? = Bundle.main.bundleURL,
        cacheDirectory: URL? = nil,
        limits: BackstageUpdateResourceLimits = .standard
    ) {
        self.configuration = configuration
        self.transport = transport
        self.extractor = extractor ?? DittoBackstageUpdateArtifactExtractor(limits: limits)
        self.signatureVerifier = signatureVerifier
        self.currentTrustReader = currentTrustReader
        self.currentBundleURL = currentBundleURL
        self.cacheDirectory = cacheDirectory
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("PhotosByElie/Backstage/Updates", isDirectory: true)
        self.limits = limits
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
        try manifest.validate(maximumFileSize: limits.maximumArchiveFileSize)
        try enforceStableSigningContract(manifest)
        return try makeCheck(current: current, manifest: manifest)
    }

    public func makeCheck(
        current: BackstageReleaseIdentity,
        manifest: BackstageReleaseManifest
    ) throws -> BackstageUpdateCheck {
        try manifest.validate(maximumFileSize: limits.maximumArchiveFileSize)
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
            try await transport.download(
                from: manifest.downloadURL,
                to: archiveURL,
                expectedFileSize: manifest.fileSize,
                maximumFileSize: limits.maximumArchiveFileSize,
                progress: progress
            )
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
            try BackstageZipArchiveInspector.validate(
                archiveURL: archiveURL,
                limits: limits
            )
            let bundleURL = try extractor.extractAppBundle(from: archiveURL, to: extractionURL)
            let extractionPath = extractionURL.resolvingSymlinksInPath().standardizedFileURL.path + "/"
            let bundlePath = bundleURL.resolvingSymlinksInPath().standardizedFileURL.path
            guard bundlePath.hasPrefix(extractionPath) else {
                throw BackstageUpdateError.archiveInvalid(
                    "The archive extractor returned an app bundle outside the isolated update directory."
                )
            }
            try validateExtractedTree(at: extractionURL)
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
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func validateExtractedTree(at extractionURL: URL) throws {
        let fileManager = FileManager.default
        let resourceKeys: Set<URLResourceKey> = [
            .isDirectoryKey,
            .isRegularFileKey,
            .isSymbolicLinkKey,
            .fileSizeKey,
        ]
        var enumerationError: Error?
        guard let enumerator = fileManager.enumerator(
            at: extractionURL,
            includingPropertiesForKeys: Array(resourceKeys),
            options: [],
            errorHandler: { _, error in
                enumerationError = error
                return false
            }
        ) else {
            throw BackstageUpdateError.archiveInvalid("The extracted archive could not be inspected.")
        }

        let extractionPath = extractionURL.resolvingSymlinksInPath().standardizedFileURL.path + "/"
        var entryCount = 0
        var regularFileSize: Int64 = 0
        for case let entryURL as URL in enumerator {
            entryCount += 1
            guard entryCount <= limits.maximumExtractedEntryCount else {
                throw BackstageUpdateError.archiveInvalid(
                    "The extracted archive exceeds the \(limits.maximumExtractedEntryCount)-entry safety limit."
                )
            }
            let values = try entryURL.resourceValues(forKeys: resourceKeys)
            if values.isSymbolicLink == true {
                let destination = try fileManager.destinationOfSymbolicLink(atPath: entryURL.path)
                let lexicalTarget = URL(
                    fileURLWithPath: destination,
                    relativeTo: destination.hasPrefix("/") ? nil : entryURL.deletingLastPathComponent()
                ).standardizedFileURL.path
                let resolvedTarget = entryURL.resolvingSymlinksInPath().standardizedFileURL.path
                guard lexicalTarget.hasPrefix(extractionPath),
                      resolvedTarget.hasPrefix(extractionPath) else {
                    throw BackstageUpdateError.archiveInvalid(
                        "The extracted archive contains a link outside the isolated update directory."
                    )
                }
            } else if values.isRegularFile == true {
                let size = Int64(values.fileSize ?? 0)
                guard size >= 0,
                      size <= limits.maximumExtractedRegularFileSize - regularFileSize else {
                    throw BackstageUpdateError.archiveInvalid(
                        "The extracted archive exceeds the \(limits.maximumExtractedRegularFileSize)-byte regular-file safety limit."
                    )
                }
                regularFileSize += size
            } else if values.isDirectory != true {
                throw BackstageUpdateError.archiveInvalid(
                    "The extracted archive contains an unsupported filesystem entry."
                )
            }
        }
        if enumerationError != nil {
            throw BackstageUpdateError.archiveInvalid("The extracted archive could not be inspected completely.")
        }
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
