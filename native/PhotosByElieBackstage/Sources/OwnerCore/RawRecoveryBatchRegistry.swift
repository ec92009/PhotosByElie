import CryptoKit
import Foundation

public struct RawRecoveryResolvedDerivative: Sendable, Equatable {
    public var ledgerEntry: RawRecoveryLedgerEntry
    public var receipt: RawRecoveryReceipt
    public var jpegURL: URL
}

public struct RawRecoveryRegistrySnapshot: Sendable {
    public var rootDirectory: URL
    public var ledger: RawRecoveryLedger

    public func entry(localIdentifier: String) -> RawRecoveryLedgerEntry? {
        guard let entry = ledger.entries[localIdentifier],
              [.generated, .quarantinedBlueCast].contains(entry.state) else { return nil }
        return entry
    }

    public func resolvedDerivative(
        localIdentifier: String,
        verifyChecksum: Bool = false
    ) -> RawRecoveryResolvedDerivative? {
        guard let entry = entry(localIdentifier: localIdentifier) else { return nil }
        return RawRecoveryBatchRegistry.resolve(
            entry: entry,
            localIdentifier: localIdentifier,
            rootDirectory: rootDirectory,
            verifyChecksum: verifyChecksum
        )
    }
}

public enum RawRecoveryBatchRegistry {
    public static var defaultRootDirectory: URL {
        BackstagePreviewIPCConstants.defaultExportDirectory()
            .deletingLastPathComponent()
            .appendingPathComponent("raw-recovery-batches", isDirectory: true)
    }

    public static func resolvedDerivative(
        localIdentifier: String,
        rootDirectory: URL = defaultRootDirectory,
        verifyChecksum: Bool = false
    ) -> RawRecoveryResolvedDerivative? {
        snapshot(rootDirectory: rootDirectory)?.resolvedDerivative(
            localIdentifier: localIdentifier,
            verifyChecksum: verifyChecksum
        )
    }

    public static func snapshot(
        rootDirectory: URL = defaultRootDirectory
    ) -> RawRecoveryRegistrySnapshot? {
        let ledgerURL = rootDirectory.appendingPathComponent("raw-recovery-ledger.json")
        guard let ledgerData = try? Data(contentsOf: ledgerURL),
              let ledger = try? JSONDecoder().decode(RawRecoveryLedger.self, from: ledgerData)
        else { return nil }
        return RawRecoveryRegistrySnapshot(rootDirectory: rootDirectory, ledger: ledger)
    }

    fileprivate static func resolve(
        entry: RawRecoveryLedgerEntry,
        localIdentifier: String,
        rootDirectory: URL,
        verifyChecksum: Bool
    ) -> RawRecoveryResolvedDerivative? {
        let receiptURL = rootDirectory.appendingPathComponent(entry.receiptRelativePath)
        guard let receiptData = try? Data(contentsOf: receiptURL),
              let receipt = try? JSONDecoder().decode(RawRecoveryReceipt.self, from: receiptData),
              receipt.localIdentifier == localIdentifier else { return nil }
        let jpegURL = receiptURL.deletingLastPathComponent().appendingPathComponent(receipt.relativePath)
        let safeRoot = rootDirectory.standardizedFileURL.path
        let safeJPEG = jpegURL.standardizedFileURL.path
        guard safeJPEG.hasPrefix(safeRoot + "/"),
              FileManager.default.fileExists(atPath: safeJPEG) else { return nil }
        if verifyChecksum,
           sha256(of: jpegURL) != receipt.checksumSHA256 {
            return nil
        }
        return RawRecoveryResolvedDerivative(
            ledgerEntry: entry,
            receipt: receipt,
            jpegURL: jpegURL
        )
    }

    private static func sha256(of url: URL) -> String? {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
