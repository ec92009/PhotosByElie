import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Routes an explicitly approved AI After through the existing versioned edit-return pipeline.
/// Upscaling changes pixel dimensions, not the amount of photographic detail.
public enum VisualRepairRendition {
    public static let editorPrefix = "com.photosbyelie.backstage.visual-repair."
    public static let label = "AI After · upscaled"

    public static func prepare(
        proposal: VisualRepairProposal,
        item: FixtureReviewItem,
        store: any ExternalEditJobStoring,
        now: Date = Date()
    ) throws -> ExternalEditReturnedSource {
        guard proposal.assetID == item.id, proposal.status.isComparable,
              proposal.derivedAvailable, !proposal.isGenerating,
              !proposal.derivedSHA256.isEmpty,
              let input = URL(string: proposal.derivedReference), input.isFileURL,
              VisualRepairComparisonState.isRenderableReference(proposal.derivedReference),
              !input.hasDirectoryPath,
              try input.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true
        else { throw ExternalEditJobError.invalidReturnedFile }
        let data = try Data(contentsOf: input)
        guard digest(data) == proposal.derivedSHA256 else { throw ExternalEditJobError.invalidReturnedFile }
        let existing = try store.visualRepairJob(proposalID: proposal.id)
        if let existing, !existing.returnedSourceVersionID.isEmpty {
            guard let current = try store.currentReturnedSource(assetID: item.id),
                  current.sourceVersionID == existing.returnedSourceVersionID,
                  existing.fixtureID == proposal.fixtureID,
                  existing.sources.first?.sourceVersionID == proposal.sourceVersionID
            else { throw ExternalEditJobError.invalidSources }
            return current
        }
        let sources = try store.resolveSources(assetIDs: [item.id])
        guard sources.count == 1, sources[0].sourceVersionID == proposal.sourceVersionID,
              item.sourceVersionID == proposal.sourceVersionID else { throw ExternalEditJobError.invalidSources }
        // Validate and render before acquiring an edit job so invalid images never leave a lock.
        let rendered = try upscale(data, width: item.pixelWidth, height: item.pixelHeight)
        let job = try existing ?? store.createJob(
            fixtureID: proposal.fixtureID, kind: .edit,
            editor: ExternalEditorProfile(name: label, bundleIdentifier: editorPrefix + proposal.id,
                applicationURL: Bundle.main.bundleURL), sources: sources, now: now)
        guard job.fixtureID == proposal.fixtureID, job.sources == sources else {
            throw ExternalEditJobError.invalidSources
        }
        let pending = try store.pendingReturns(fixtureID: proposal.fixtureID).first { $0.jobID == job.id }
        let candidate: ExternalEditReturnCandidate
        if let pending {
            candidate = pending
        } else {
            let output = job.returnDirectory.appendingPathComponent("AI-After-upscaled.png")
            try rendered.write(to: output, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: output.path)
            candidate = try store.acceptReturnedFile(jobID: job.id, sourceURL: output, now: now)
        }
        let result = try store.resolveReturn(returnID: candidate.id, decision: .replaceOriginal, now: now)
        guard let current = try store.currentReturnedSource(assetID: item.id),
              current.sourceVersionID == result.sourceVersionID else { throw ExternalEditJobError.invalidReturnedFile }
        return current
    }

    /// Render a clearly identified, lossless PNG at the original dimensions using high-quality interpolation.
    public static func upscale(_ data: Data, width: Int, height: Int) throws -> Data {
        guard width > 0, height > 0, width <= 30_000, height <= 30_000,
              width * height <= 100_000_000,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              width >= image.width, height >= image.height,
              abs(Double(width) / Double(height) - Double(image.width) / Double(image.height)) < 0.01,
              let color = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: 0, space: color,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { throw ExternalEditJobError.invalidReturnedFile }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let result = context.makeImage() else { throw ExternalEditJobError.invalidReturnedFile }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.png.identifier as CFString, 1, nil)
        else { throw ExternalEditJobError.invalidReturnedFile }
        let properties: [CFString: Any] = [kCGImagePropertyTIFFDictionary: [
            kCGImagePropertyTIFFSoftware: "PhotosByElie Backstage",
            kCGImagePropertyTIFFImageDescription: "AI After, explicitly upscaled from \(image.width)x\(image.height) to \(width)x\(height). Original photographic detail is not restored."
        ]]
        CGImageDestinationAddImage(destination, result, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw ExternalEditJobError.invalidReturnedFile }
        return output as Data
    }

    public static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
