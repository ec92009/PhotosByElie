import AppKit
import OwnerCore

/// Cohesive UI state for the external-editor round trip.
///
/// `BackstageViewModel` remains the composition boundary used by SwiftUI. This
/// holder keeps the edit job, immediate-action latches, status, and comparison
/// preview together so later coordinator extraction does not spread those
/// invariants across the application god node.
struct BackstageExternalEditWorkflowState {
    static let idleStatus = "Select Review photos to edit or combine in another app."

    var activeJob: ExternalEditJob?
    var returnReceipt: ExternalEditReturnReceipt?
    var sourceImages: [NSImage] = []
    var returnedImage: NSImage?
    var isPreparing = false
    var isImporting = false
    var status = idleStatus

    var isOperationInProgress: Bool {
        isPreparing || isImporting
    }

    var activeLabel: String? {
        guard let activeJob else { return nil }
        return Self.label(editorName: activeJob.editor.name, sources: activeJob.sources)
    }

    func selectionTouchesActiveJob(_ selectedAssetIDs: [String]) -> Bool {
        guard let activeJob else { return false }
        let activeIDs = Set(activeJob.sources.map(\.assetID))
        return !activeIDs.isDisjoint(with: selectedAssetIDs)
    }

    mutating func announce(_ message: String) {
        status = message
    }

    mutating func clearComparison() {
        returnReceipt = nil
        sourceImages = []
        returnedImage = nil
    }

    static func label(editorName: String, sources: [ExternalEditSource]) -> String {
        let filenames = sources.sorted { $0.position < $1.position }
            .map(\.originalFilename).filter { !$0.isEmpty }
        let subject = filenames.count == 1
            ? filenames[0]
            : "\(filenames.count.formatted()) source photos"
        return "\(editorName) · \(subject)"
    }
}
