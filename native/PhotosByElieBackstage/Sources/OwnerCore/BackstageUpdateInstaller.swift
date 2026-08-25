import Darwin
import Foundation

/// Performs the explicit installation step only after an update has passed the
/// read-only download and verification boundary.
public struct BackstageUpdateInstaller: Sendable {
    public static let canonicalBundleName = "PhotosByElie Backstage.app"

    private let signatureVerifier: any BackstageCodeSignatureVerifying
    private let applicationsDirectory: URL
    private let rollbackDirectory: URL

    private struct BundleIdentity: Equatable {
        let identifier: String
        let version: String
        let build: String
    }

    public init(
        signatureVerifier: any BackstageCodeSignatureVerifying = SystemBackstageCodeSignatureVerifier(),
        applicationsDirectory: URL = URL(fileURLWithPath: "/Applications", isDirectory: true),
        rollbackDirectory: URL? = nil
    ) {
        self.signatureVerifier = signatureVerifier
        self.applicationsDirectory = applicationsDirectory.standardizedFileURL
        self.rollbackDirectory = rollbackDirectory?.standardizedFileURL
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("PhotosByElie/Backstage/Rollback", isDirectory: true)
    }

    public var canonicalBundleURL: URL {
        applicationsDirectory.appendingPathComponent(Self.canonicalBundleName, isDirectory: true)
    }

    public func install(_ update: BackstageVerifiedUpdate) throws -> BackstageInstallationReceipt {
        let fileManager = FileManager.default
        let destination = canonicalBundleURL
        let staging = applicationsDirectory.appendingPathComponent(
            ".PhotosByElie Backstage.install-\(UUID().uuidString).app",
            isDirectory: true
        )
        var incumbentWasExchanged = false

        do {
            try requireExistingDirectory(applicationsDirectory)
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

            try? fileManager.removeItem(at: staging)
            return BackstageInstallationReceipt(
                manifest: update.manifest,
                installedBundleURL: destination,
                rollbackBundleURL: rollback
            )
        } catch {
            try? fileManager.removeItem(at: staging)
            if let updateError = error as? BackstageUpdateError { throw updateError }
            throw BackstageUpdateError.installationFailed(error.localizedDescription)
        }
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
