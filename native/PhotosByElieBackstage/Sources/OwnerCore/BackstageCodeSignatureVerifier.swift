import Foundation

public struct SystemBackstageCodeSignatureVerifier: BackstageCodeSignatureVerifying, BackstageCurrentReleaseTrustReading, Sendable {
    public init() {}

    public func readTrust(bundleURL: URL) throws -> BackstageReleaseTrust {
        try readTrustMetadata(bundleURL: bundleURL)
    }

    public func verify(
        bundleURL: URL,
        expectedBundleIdentifier: String,
        trust: BackstageReleaseTrust
    ) throws {
        _ = try runCodesign(["--verify", "--deep", "--strict", bundleURL.path])
        guard let bundle = Bundle(url: bundleURL),
              (bundle.object(forInfoDictionaryKey: "CFBundleIdentifier") as? String) == expectedBundleIdentifier else {
            throw BackstageUpdateError.signatureMismatch("The downloaded bundle identifier is not the expected Backstage identity.")
        }
        let actualTrust = try readTrustMetadata(bundleURL: bundleURL)
        guard actualTrust.teamIdentifier == trust.teamIdentifier else {
            throw BackstageUpdateError.signatureMismatch("The downloaded bundle is signed by an unexpected Apple Developer team.")
        }
        guard actualTrust.signingIdentity == trust.signingIdentity else {
            throw BackstageUpdateError.signatureMismatch("The downloaded bundle is signed by an unexpected identity.")
        }
        guard actualTrust.designatedRequirement == trust.designatedRequirement else {
            throw BackstageUpdateError.signatureMismatch("The downloaded bundle designated requirement does not exactly match the release trust contract.")
        }
    }

    private func readTrustMetadata(bundleURL: URL) throws -> BackstageReleaseTrust {
        let details = try runCodesign(["-dvvv", bundleURL.path])
        guard signatureValue(named: "Signature", in: details) != "adhoc" else {
            throw BackstageUpdateError.signatureMismatch("The Backstage bundle is ad-hoc signed.")
        }
        guard let teamIdentifier = signatureValue(named: "TeamIdentifier", in: details),
              let signingIdentity = signatureValue(named: "Authority", in: details),
              !teamIdentifier.isEmpty,
              !signingIdentity.isEmpty else {
            throw BackstageUpdateError.signatureMismatch("The Backstage bundle did not expose a stable signing identity.")
        }
        let requirements = try runCodesign(["-d", "-r-", bundleURL.path])
        let designatedRequirement = requirements
            .split(separator: "\n", omittingEmptySubsequences: false)
            .compactMap { line -> String? in
                guard let range = line.range(of: "designated =>") else { return nil }
                return String(line[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            .first
        guard let designatedRequirement, !designatedRequirement.isEmpty else {
            throw BackstageUpdateError.signatureMismatch("The Backstage bundle did not expose a designated requirement.")
        }
        return BackstageReleaseTrust(
            teamIdentifier: teamIdentifier,
            signingIdentity: signingIdentity,
            designatedRequirement: designatedRequirement
        )
    }

    private func signatureValue(named name: String, in details: String) -> String? {
        let prefix = "\(name)="
        return details
            .split(separator: "\n", omittingEmptySubsequences: false)
            .first(where: { $0.hasPrefix(prefix) })
            .map { String($0.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    private func runCodesign(_ arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        process.arguments = arguments
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        try process.run()
        process.waitUntilExit()
        let output = String(data: outputPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let error = String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw BackstageUpdateError.signatureMismatch(
                "macOS code-signature verification failed: \(error.trimmingCharacters(in: .whitespacesAndNewlines))"
            )
        }
        return output + error
    }
}
