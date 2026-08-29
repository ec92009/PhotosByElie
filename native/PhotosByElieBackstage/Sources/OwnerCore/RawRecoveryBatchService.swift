import Foundation

public enum RawRecoveryBatchError: Error, Sendable, Equatable, LocalizedError {
    case invalid(String)
    case unavailable(String)
    case activeBatch(String)

    public var errorDescription: String? {
        switch self {
        case .invalid(let message), .unavailable(let message), .activeBatch(let message):
            return message
        }
    }
}

public struct RawRecoveryBatchService: Sendable {
    public typealias CapacityProvider = @Sendable (URL) throws -> Int64
    public typealias Clock = @Sendable () -> Date

    private let photoLibrary: any PhotoLibraryServing
    private let capacityProvider: CapacityProvider
    private let clock: Clock

    public init(
        photoLibrary: any PhotoLibraryServing,
        capacityProvider: @escaping CapacityProvider = { try Self.availableCapacity(at: $0) },
        clock: @escaping Clock = Date.init
    ) {
        self.photoLibrary = photoLibrary
        self.capacityProvider = capacityProvider
        self.clock = clock
    }

    public func start(
        rootDirectory: URL,
        queueWindow: Int = 2_000,
        maxItemsThisRun: Int = 2_000,
        maxPixelSize: Int = 8_192,
        minimumPixels: Int = RawRecoveryPolicy.minimumPublicationPixels,
        reserveBytes: Int64 = 15_000_000_000
    ) async throws -> RawRecoveryBatchResult {
        try validate(
            rootDirectory: rootDirectory,
            queueWindow: queueWindow,
            maxItemsThisRun: maxItemsThisRun,
            maxPixelSize: maxPixelSize,
            minimumPixels: minimumPixels,
            reserveBytes: reserveBytes
        )
        try prepareRoot(rootDirectory)
        if let active = try loadManifest(rootDirectory: rootDirectory),
           [.running, .pausedCapacity, .pausedOperator].contains(active.state) {
            throw RawRecoveryBatchError.activeBatch(
                "RAW recovery batch \(active.batchID) is \(active.state.rawValue). Resume or cancel it before starting another 2,000-photo window."
            )
        }

        let ledger = try loadLedger(rootDirectory: rootDirectory)
        let excluded = Set(ledger.entries.keys)
        let candidates = try await photoLibrary.rawRecoveryCandidates(
            limit: queueWindow,
            excludingLocalIdentifiers: excluded
        )
        guard !candidates.isEmpty else {
            throw RawRecoveryBatchError.unavailable(
                "No unprocessed RAW-only Photos assets remain for a new recovery window."
            )
        }

        let timestamp = isoDate(clock())
        let batchID = "raw-\(compactDate(clock()))-\(UUID().uuidString.lowercased().prefix(8))"
        var manifest = RawRecoveryBatchManifest(
            batchID: batchID,
            createdAt: timestamp,
            updatedAt: timestamp,
            state: .running,
            queueWindow: queueWindow,
            maxPixelSize: maxPixelSize,
            minimumPixels: minimumPixels,
            reserveBytes: reserveBytes,
            outputRelativePath: "batches/\(batchID)",
            items: candidates.map { RawRecoveryBatchItem(candidate: $0) }
        )
        try save(manifest: manifest, rootDirectory: rootDirectory)
        return try await process(
            manifest: &manifest,
            rootDirectory: rootDirectory,
            maxItemsThisRun: maxItemsThisRun
        )
    }

    public func resume(
        rootDirectory: URL,
        maxItemsThisRun: Int = 2_000
    ) async throws -> RawRecoveryBatchResult {
        guard (1...2_000).contains(maxItemsThisRun) else {
            throw RawRecoveryBatchError.invalid("A resume run may process from 1 to 2,000 items.")
        }
        var manifest = try requiredManifest(rootDirectory: rootDirectory)
        guard [.running, .pausedCapacity, .pausedOperator].contains(manifest.state) else {
            return try result(
                manifest: manifest,
                rootDirectory: rootDirectory,
                processedThisRun: 0
            )
        }
        manifest.state = .running
        manifest.stopReason = ""
        manifest.updatedAt = isoDate(clock())
        try save(manifest: manifest, rootDirectory: rootDirectory)
        return try await process(
            manifest: &manifest,
            rootDirectory: rootDirectory,
            maxItemsThisRun: maxItemsThisRun
        )
    }

    public func status(rootDirectory: URL) throws -> RawRecoveryBatchResult {
        let manifest = try requiredManifest(rootDirectory: rootDirectory)
        return try result(
            manifest: manifest,
            rootDirectory: rootDirectory,
            processedThisRun: 0
        )
    }

    public func cancel(rootDirectory: URL) throws -> RawRecoveryBatchResult {
        var manifest = try requiredManifest(rootDirectory: rootDirectory)
        if manifest.state != .completed {
            manifest.state = .cancelled
            manifest.stopReason = "Cancelled explicitly between assets. Generated derivatives and receipts were retained."
            manifest.updatedAt = isoDate(clock())
            try save(manifest: manifest, rootDirectory: rootDirectory)
        }
        return try result(
            manifest: manifest,
            rootDirectory: rootDirectory,
            processedThisRun: 0
        )
    }

    private func process(
        manifest: inout RawRecoveryBatchManifest,
        rootDirectory: URL,
        maxItemsThisRun: Int
    ) async throws -> RawRecoveryBatchResult {
        let outputDirectory = rootDirectory.appendingPathComponent(
            manifest.outputRelativePath,
            isDirectory: true
        )
        try prepareDirectory(outputDirectory)
        var ledger = try loadLedger(rootDirectory: rootDirectory)
        var processed = 0

        for index in manifest.items.indices where manifest.items[index].state == .pending {
            if Task.isCancelled {
                manifest.state = .pausedOperator
                manifest.stopReason = "Paused safely between assets after cancellation."
                break
            }
            if processed >= maxItemsThisRun {
                manifest.state = .pausedOperator
                manifest.stopReason = "Reached the explicit per-run processing bound. Resume continues the same window."
                break
            }
            let available = try capacityProvider(rootDirectory)
            if available <= manifest.reserveBytes {
                manifest.state = .pausedCapacity
                manifest.stopReason = "Available storage reached the configured safety reserve. Remove processed derivatives or choose a larger destination, then resume."
                break
            }

            let candidate = manifest.items[index].candidate
            do {
                let receipt = try await photoLibrary.recoverRawJPEG(
                    localIdentifier: candidate.localIdentifier,
                    maxPixelSize: manifest.maxPixelSize,
                    minimumPixels: manifest.minimumPixels,
                    to: outputDirectory
                )
                let state: RawRecoveryBatchItemState = receipt.qualityAssessment?.blueCastSuspected == true
                    ? .quarantinedBlueCast
                    : .generated
                let updatedAt = isoDate(clock())
                manifest.items[index].state = state
                manifest.items[index].receiptRelativePath = "\(manifest.outputRelativePath)/\(receipt.receiptRelativePath)"
                manifest.items[index].updatedAt = updatedAt
                ledger.entries[candidate.localIdentifier] = RawRecoveryLedgerEntry(
                    localIdentifier: candidate.localIdentifier,
                    sourceFilename: candidate.filename,
                    batchID: manifest.batchID,
                    state: state,
                    receiptRelativePath: manifest.items[index].receiptRelativePath,
                    updatedAt: updatedAt
                )
                try save(ledger: ledger, rootDirectory: rootDirectory)
            } catch is CancellationError {
                manifest.state = .pausedOperator
                manifest.stopReason = "Paused safely while Photos cancelled the current asset. Resume retries that asset checksum-idempotently."
                manifest.updatedAt = isoDate(clock())
                try save(manifest: manifest, rootDirectory: rootDirectory)
                return try result(
                    manifest: manifest,
                    rootDirectory: rootDirectory,
                    processedThisRun: processed
                )
            } catch {
                manifest.items[index].state = .failed
                manifest.items[index].error = error.localizedDescription
                manifest.items[index].updatedAt = isoDate(clock())
            }
            processed += 1
            manifest.updatedAt = isoDate(clock())
            try save(manifest: manifest, rootDirectory: rootDirectory)
        }

        if manifest.items.allSatisfy({ $0.state != .pending }) {
            manifest.state = .completed
            manifest.stopReason = "The bounded recovery window finished. Every derivative remains Review-gated."
        } else if manifest.state == .running {
            manifest.state = .pausedOperator
            manifest.stopReason = "Paused safely between assets."
        }
        manifest.updatedAt = isoDate(clock())
        try save(manifest: manifest, rootDirectory: rootDirectory)
        return try result(
            manifest: manifest,
            rootDirectory: rootDirectory,
            processedThisRun: processed
        )
    }

    private func result(
        manifest: RawRecoveryBatchManifest,
        rootDirectory: URL,
        processedThisRun: Int
    ) throws -> RawRecoveryBatchResult {
        let states = manifest.items.map(\.state)
        return RawRecoveryBatchResult(
            ok: true,
            batchID: manifest.batchID,
            state: manifest.state,
            queued: manifest.items.count,
            pending: states.count { $0 == .pending },
            generated: states.count { $0 == .generated },
            quarantinedBlueCast: states.count { $0 == .quarantinedBlueCast },
            failed: states.count { $0 == .failed },
            disposed: states.count {
                $0 == .disposedAfterUpload || $0 == .disposedAfterRejection
            },
            processedThisRun: processedThisRun,
            availableCapacityBytes: try capacityProvider(rootDirectory),
            reserveBytes: manifest.reserveBytes,
            destination: rootDirectory.path,
            stopReason: manifest.stopReason
        )
    }

    private func validate(
        rootDirectory: URL,
        queueWindow: Int,
        maxItemsThisRun: Int,
        maxPixelSize: Int,
        minimumPixels: Int,
        reserveBytes: Int64
    ) throws {
        guard rootDirectory.isFileURL,
              rootDirectory.path.hasPrefix("/"),
              rootDirectory.path != "/" else {
            throw RawRecoveryBatchError.invalid("The RAW recovery destination must be a specific absolute local directory.")
        }
        guard (1...2_000).contains(queueWindow),
              (1...queueWindow).contains(maxItemsThisRun) else {
            throw RawRecoveryBatchError.invalid("A RAW recovery window may contain from 1 to 2,000 items.")
        }
        guard (256...8_192).contains(maxPixelSize),
              (1...100_000_000).contains(minimumPixels) else {
            throw RawRecoveryBatchError.invalid("RAW recovery pixel bounds are invalid.")
        }
        guard reserveBytes >= 1_000_000_000 else {
            throw RawRecoveryBatchError.invalid("The storage safety reserve must be at least 1 GB.")
        }
    }

    private func requiredManifest(rootDirectory: URL) throws -> RawRecoveryBatchManifest {
        guard let manifest = try loadManifest(rootDirectory: rootDirectory) else {
            throw RawRecoveryBatchError.unavailable("No RAW recovery batch manifest exists at this destination.")
        }
        return manifest
    }

    private func prepareRoot(_ root: URL) throws {
        try prepareDirectory(root)
        try prepareDirectory(root.appendingPathComponent("batches", isDirectory: true))
    }

    private func prepareDirectory(_ directory: URL) throws {
        let manager = FileManager.default
        try manager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
    }

    private func loadManifest(rootDirectory: URL) throws -> RawRecoveryBatchManifest? {
        let url = rootDirectory.appendingPathComponent("active-batch.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(RawRecoveryBatchManifest.self, from: Data(contentsOf: url))
    }

    private func loadLedger(rootDirectory: URL) throws -> RawRecoveryLedger {
        let url = rootDirectory.appendingPathComponent("raw-recovery-ledger.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return RawRecoveryLedger() }
        return try JSONDecoder().decode(RawRecoveryLedger.self, from: Data(contentsOf: url))
    }

    private func save(manifest: RawRecoveryBatchManifest, rootDirectory: URL) throws {
        let activeURL = rootDirectory.appendingPathComponent("active-batch.json")
        try writePrivate(manifest, to: activeURL)
        let batchURL = rootDirectory
            .appendingPathComponent(manifest.outputRelativePath, isDirectory: true)
            .appendingPathComponent("batch-manifest.json")
        try prepareDirectory(batchURL.deletingLastPathComponent())
        try writePrivate(manifest, to: batchURL)
    }

    private func save(ledger: RawRecoveryLedger, rootDirectory: URL) throws {
        try writePrivate(
            ledger,
            to: rootDirectory.appendingPathComponent("raw-recovery-ledger.json")
        )
    }

    private func writePrivate<T: Encodable>(_ value: T, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(value).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    public static func availableCapacity(at directory: URL) throws -> Int64 {
        let values = try directory.resourceValues(forKeys: [
            .volumeAvailableCapacityForImportantUsageKey,
            .volumeAvailableCapacityKey,
        ])
        if let available = values.volumeAvailableCapacity {
            return Int64(available)
        }
        if let important = values.volumeAvailableCapacityForImportantUsage {
            return important
        }
        throw RawRecoveryBatchError.unavailable("Available storage could not be measured for the RAW recovery destination.")
    }

    private func isoDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func compactDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        return formatter.string(from: date)
    }
}
