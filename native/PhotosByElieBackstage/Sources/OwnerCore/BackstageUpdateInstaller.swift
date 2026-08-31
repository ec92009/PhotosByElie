import Darwin
import Foundation

public protocol BackstageUpdateInstalling: Sendable {
    func install(_ update: BackstageVerifiedUpdate) throws -> BackstageInstallationReceipt
}

@usableFromInline
func removeInstallerOwnedStagingBundle(at bundleURL: URL) throws {
    let fileManager = FileManager.default
    var directories = [bundleURL]
    if let enumerator = fileManager.enumerator(
        at: bundleURL,
        includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
        options: []
    ) {
        for case let candidate as URL in enumerator {
            let values = try candidate.resourceValues(forKeys: [
                .isDirectoryKey,
                .isSymbolicLinkKey,
            ])
            if values.isDirectory == true, values.isSymbolicLink != true {
                directories.append(candidate)
            }
        }
    }
    for directory in directories {
        let attributes = try fileManager.attributesOfItem(atPath: directory.path)
        let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0o700
        if permissions & 0o200 == 0 {
            try fileManager.setAttributes(
                [.posixPermissions: permissions | 0o200],
                ofItemAtPath: directory.path
            )
        }
    }
    try fileManager.removeItem(at: bundleURL)
}

/// Performs the explicit installation step only after an update has passed the
/// read-only download and verification boundary.
public struct BackstageUpdateInstaller: Sendable {
    public static let canonicalBundleName = "PhotosByElie Backstage.app"
    public static let stagingBundlePrefix = ".PhotosByElie Backstage.install-"
    public static let stagingBundleSuffix = ".app"
    public static let defaultStaleStagingAge: TimeInterval = 15 * 60

    private let signatureVerifier: any BackstageCodeSignatureVerifying
    private let applicationsDirectory: URL
    private let rollbackDirectory: URL
    private let staleStagingAge: TimeInterval
    private let now: @Sendable () -> Date
    private let removeStagingBundle: @Sendable (URL) throws -> Void

    private struct BundleIdentity: Equatable {
        let identifier: String
        let version: String
        let build: String
    }

    public init(
        signatureVerifier: any BackstageCodeSignatureVerifying = SystemBackstageCodeSignatureVerifier(),
        applicationsDirectory: URL = URL(fileURLWithPath: "/Applications", isDirectory: true),
        rollbackDirectory: URL? = nil,
        staleStagingAge: TimeInterval = Self.defaultStaleStagingAge,
        now: @escaping @Sendable () -> Date = Date.init,
        removeStagingBundle: @escaping @Sendable (URL) throws -> Void = {
            try removeInstallerOwnedStagingBundle(at: $0)
        }
    ) {
        self.signatureVerifier = signatureVerifier
        self.applicationsDirectory = applicationsDirectory.standardizedFileURL
        self.rollbackDirectory = rollbackDirectory?.standardizedFileURL
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("PhotosByElie/Backstage/Rollback", isDirectory: true)
        self.staleStagingAge = max(1, staleStagingAge)
        self.now = now
        self.removeStagingBundle = removeStagingBundle
    }

    public var canonicalBundleURL: URL {
        applicationsDirectory.appendingPathComponent(Self.canonicalBundleName, isDirectory: true)
    }

    public func install(_ update: BackstageVerifiedUpdate) throws -> BackstageInstallationReceipt {
        let fileManager = FileManager.default
        let destination = canonicalBundleURL
        let staging = applicationsDirectory.appendingPathComponent(
            "\(Self.stagingBundlePrefix)\(UUID().uuidString)\(Self.stagingBundleSuffix)",
            isDirectory: true
        )
        var incumbentWasExchanged = false

        do {
            try requireExistingDirectory(applicationsDirectory)
            let reconciledStaging = try reconcileStaleStagingBundles(
                trust: update.manifest.trust
            )
            try verifyArchive(update)
            try verifyBundle(update.bundleURL, manifest: update.manifest)
            try copyBundle(from: update.bundleURL, to: staging)
            try verifyBundle(staging, manifest: update.manifest)

            let rollback = try preserveIncumbentIfPresent(
                at: destination,
                trust: update.manifest.trust
            )
            if fileManager.fileExists(atPath: destination.path) {
                try atomicExchange(staging, destination)
                incumbentWasExchanged = true
            } else {
                try atomicMove(staging, destination)
            }

            do {
                try verifyBundle(destination, manifest: update.manifest)
            } catch {
                if incumbentWasExchanged {
                    try atomicExchange(staging, destination)
                } else if fileManager.fileExists(atPath: destination.path) {
                    try atomicMove(destination, staging)
                }
                throw BackstageUpdateError.installationFailed(
                    "The installed bundle failed post-swap verification and the previous installation was restored: \(error.localizedDescription)"
                )
            }

            if fileManager.fileExists(atPath: staging.path) {
                do {
                    try removeStagingBundle(staging)
                } catch {
                    throw BackstageUpdateError.installationFailed(
                        "The canonical update is installed, but its verified prior staging bundle could not be removed. Keep using the canonical app and audit \(staging.path) before another install."
                    )
                }
            }
            return BackstageInstallationReceipt(
                manifest: update.manifest,
                installedBundleURL: destination,
                rollbackBundleURL: rollback,
                reconciledStagingBundleURLs: reconciledStaging
            )
        } catch {
            if fileManager.fileExists(atPath: staging.path) {
                try? removeStagingBundle(staging)
            }
            if let updateError = error as? BackstageUpdateError { throw updateError }
            throw BackstageUpdateError.installationFailed(error.localizedDescription)
        }
    }

    public func auditStagingBundles(
        trust: BackstageReleaseTrust
    ) throws -> [BackstageInstallerStagingBundle] {
        try requireExistingDirectory(applicationsDirectory)
        let fileManager = FileManager.default
        let candidates = try fileManager.contentsOfDirectory(
            at: applicationsDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey],
            options: [.skipsSubdirectoryDescendants]
        ).filter { isExactStagingBundleName($0.lastPathComponent) }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

        return candidates.map { candidate in
            let values = try? candidate.resourceValues(forKeys: [
                .contentModificationDateKey,
                .isDirectoryKey,
            ])
            let age = max(
                0,
                now().timeIntervalSince(values?.contentModificationDate ?? .distantPast)
            )
            guard values?.isDirectory == true else {
                return BackstageInstallerStagingBundle(
                    bundleURL: candidate,
                    version: nil,
                    build: nil,
                    ageSeconds: age,
                    state: .unsafe,
                    detail: "The installer-shaped path is not an app directory and was retained."
                )
            }
            let identity: BundleIdentity
            do {
                identity = try readIdentity(candidate)
            } catch {
                return BackstageInstallerStagingBundle(
                    bundleURL: candidate,
                    version: nil,
                    build: nil,
                    ageSeconds: age,
                    state: .unsafe,
                    detail: "The installer-shaped bundle has no complete Backstage identity and was retained."
                )
            }
            guard identity.identifier == BackstageReleaseManifest.bundleIdentifier else {
                return BackstageInstallerStagingBundle(
                    bundleURL: candidate,
                    version: identity.version,
                    build: identity.build,
                    ageSeconds: age,
                    state: .unsafe,
                    detail: "The installer-shaped bundle has the wrong bundle identifier and was retained."
                )
            }
            do {
                try signatureVerifier.verify(
                    bundleURL: candidate,
                    expectedBundleIdentifier: identity.identifier,
                    trust: trust
                )
            } catch {
                return BackstageInstallerStagingBundle(
                    bundleURL: candidate,
                    version: identity.version,
                    build: identity.build,
                    ageSeconds: age,
                    state: .unsafe,
                    detail: "The installer-shaped Backstage bundle failed signature verification and was retained."
                )
            }
            if age < staleStagingAge {
                return BackstageInstallerStagingBundle(
                    bundleURL: candidate,
                    version: identity.version,
                    build: identity.build,
                    ageSeconds: age,
                    state: .active,
                    detail: "The verified staging bundle is recent enough to belong to an active install and was retained."
                )
            }
            return BackstageInstallerStagingBundle(
                bundleURL: candidate,
                version: identity.version,
                build: identity.build,
                ageSeconds: age,
                state: .staleVerified,
                detail: "The verified installer-owned staging bundle is stale and can be reconciled."
            )
        }
    }

    private func reconcileStaleStagingBundles(
        trust: BackstageReleaseTrust
    ) throws -> [URL] {
        let inventory = try auditStagingBundles(trust: trust)
        if let active = inventory.first(where: { $0.state == .active }) {
            throw BackstageUpdateError.installationFailed(
                "A recent verified Backstage staging bundle may belong to an active install. It was retained at \(active.bundleURL.path); retry after the active install finishes or the stale-age boundary passes."
            )
        }
        if let unsafe = inventory.first(where: { $0.state == .unsafe }) {
            throw BackstageUpdateError.installationFailed(
                "An unsafe installer-shaped bundle was retained at \(unsafe.bundleURL.path). Audit its identity and signature before another install."
            )
        }
        var reconciled: [URL] = []
        for stale in inventory where stale.state == .staleVerified {
            do {
                try removeStagingBundle(stale.bundleURL)
                reconciled.append(stale.bundleURL)
            } catch {
                throw BackstageUpdateError.installationFailed(
                    "The verified stale Backstage staging bundle could not be removed at \(stale.bundleURL.path). The canonical app and rollback were left untouched; reconcile that exact path before retrying."
                )
            }
        }
        return reconciled
    }

    private func isExactStagingBundleName(_ name: String) -> Bool {
        guard name.hasPrefix(Self.stagingBundlePrefix),
              name.hasSuffix(Self.stagingBundleSuffix) else {
            return false
        }
        let start = name.index(name.startIndex, offsetBy: Self.stagingBundlePrefix.count)
        let end = name.index(name.endIndex, offsetBy: -Self.stagingBundleSuffix.count)
        return UUID(uuidString: String(name[start..<end])) != nil
    }

    private func verifyArchive(_ update: BackstageVerifiedUpdate) throws {
        let attributes = try FileManager.default.attributesOfItem(atPath: update.archiveURL.path)
        guard let size = attributes[.size] as? NSNumber,
              size.int64Value == update.manifest.fileSize else {
            throw BackstageUpdateError.installationFailed(
                "The verified archive changed size before installation; the incumbent app was not touched."
            )
        }
        let checksum = try BackstageUpdateService.sha256(of: update.archiveURL)
        guard checksum.caseInsensitiveCompare(update.manifest.sha256) == .orderedSame else {
            throw BackstageUpdateError.installationFailed(
                "The verified archive checksum changed before installation; the incumbent app was not touched."
            )
        }
    }

    private func verifyBundle(_ bundleURL: URL, manifest: BackstageReleaseManifest) throws {
        let identity = try readIdentity(bundleURL)
        guard identity.identifier == manifest.bundleIdentifier,
              identity.version == manifest.version,
              identity.build == manifest.build else {
            throw BackstageUpdateError.installationFailed(
                "The staged app Info.plist identity or exact version/build does not match the verified release."
            )
        }
        try signatureVerifier.verify(
            bundleURL: bundleURL,
            expectedBundleIdentifier: manifest.bundleIdentifier,
            trust: manifest.trust
        )
    }

    private func preserveIncumbentIfPresent(
        at incumbentURL: URL,
        trust: BackstageReleaseTrust
    ) throws -> URL? {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: incumbentURL.path) else { return nil }
        let identity = try readIdentity(incumbentURL)
        guard identity.identifier == BackstageReleaseManifest.bundleIdentifier else {
            throw BackstageUpdateError.installationFailed(
                "The incumbent canonical app is incomplete or has the wrong identity; it was not replaced."
            )
        }
        try signatureVerifier.verify(
            bundleURL: incumbentURL,
            expectedBundleIdentifier: identity.identifier,
            trust: trust
        )

        try fileManager.createDirectory(at: rollbackDirectory, withIntermediateDirectories: true)
        let rollback = rollbackDirectory.appendingPathComponent(
            "PhotosByElie Backstage-v\(identity.version)-build-\(identity.build)-\(UUID().uuidString).app",
            isDirectory: true
        )
        do {
            try copyBundle(from: incumbentURL, to: rollback)
            let copiedIdentity = try readIdentity(rollback)
            guard copiedIdentity == identity else {
                throw BackstageUpdateError.installationFailed(
                    "The previous app could not be preserved as a complete rollback bundle."
                )
            }
            try signatureVerifier.verify(
                bundleURL: rollback,
                expectedBundleIdentifier: identity.identifier,
                trust: trust
            )
            return rollback
        } catch {
            try? fileManager.removeItem(at: rollback)
            throw error
        }
    }

    private func readIdentity(_ bundleURL: URL) throws -> BundleIdentity {
        let plistURL = bundleURL.appendingPathComponent("Contents/Info.plist")
        let data: Data
        do {
            data = try Data(contentsOf: plistURL)
        } catch {
            throw BackstageUpdateError.installationFailed(
                "The app bundle is incomplete because Contents/Info.plist is unreadable."
            )
        }
        guard let plist = try PropertyListSerialization.propertyList(
            from: data,
            options: [],
            format: nil
        ) as? [String: Any],
        let identifier = plist["CFBundleIdentifier"] as? String,
        let version = plist["CFBundleShortVersionString"] as? String,
        let build = plist["CFBundleVersion"] as? String else {
            throw BackstageUpdateError.installationFailed(
                "The app bundle Info.plist does not contain a complete identity and version."
            )
        }
        return BundleIdentity(identifier: identifier, version: version, build: build)
    }

    private func requireExistingDirectory(_ url: URL) throws {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw BackstageUpdateError.installationFailed(
                "The canonical Applications directory is unavailable; no installation was attempted."
            )
        }
    }

    private func copyBundle(from source: URL, to destination: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        process.arguments = ["--rsrc", "--extattr", "--acl", source.path, destination.path]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let message = String(data: output.prefix(16_384), encoding: .utf8) ?? "unknown ditto failure"
            throw BackstageUpdateError.installationFailed(
                "The complete app bundle could not be staged: \(message.trimmingCharacters(in: .whitespacesAndNewlines))"
            )
        }
    }

    private func atomicExchange(_ first: URL, _ second: URL) throws {
        let result = first.path.withCString { firstPath in
            second.path.withCString { secondPath in
                renameatx_np(AT_FDCWD, firstPath, AT_FDCWD, secondPath, UInt32(RENAME_SWAP))
            }
        }
        guard result == 0 else {
            throw BackstageUpdateError.installationFailed(
                "The staged app could not atomically replace the incumbent (errno \(errno)); the incumbent was left in place."
            )
        }
    }

    private func atomicMove(_ source: URL, _ destination: URL) throws {
        let result = source.path.withCString { sourcePath in
            destination.path.withCString { destinationPath in
                rename(sourcePath, destinationPath)
            }
        }
        guard result == 0 else {
            throw BackstageUpdateError.installationFailed(
                "The staged app could not be moved to the canonical path (errno \(errno))."
            )
        }
    }
}

extension BackstageUpdateInstaller: BackstageUpdateInstalling {}
