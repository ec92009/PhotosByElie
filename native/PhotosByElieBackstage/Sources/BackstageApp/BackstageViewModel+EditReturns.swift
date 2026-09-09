import Foundation
import OwnerCore

extension BackstageViewModel {
    func performExternalEditReturn(job: ExternalEditJob, sourceURL: URL) async {
        defer { externalEdit.isImporting = false }
        guard let externalEditJobStore else {
            announceExternalEdit("Owner.sqlite is unavailable for external editing.")
            return
        }
        do {
            let jobID = job.id
            let returnDate = Date()
            let receipt = try await Task.detached(priority: .userInitiated) {
                try externalEditJobStore.acceptReturnedFile(
                    jobID: jobID,
                    sourceURL: sourceURL,
                    now: returnDate
                )
            }.value
            externalEdit.pendingReturns.append(receipt)
            externalEdit.activeJob = nil
            announceExternalEdit("Return staged for comparison. Choose Keep original, Replace original, or Keep both in Edit Returns.")
            selection = .editReturns
        } catch {
            announceExternalEdit("Return failed: \(userFacingMessage(for: error))")
        }
    }

    func loadExternalEditReturns() {
        guard let externalEditJobStore, !selectedFixtureID.isEmpty else {
            externalEdit.pendingReturns = []
            externalEdit.announce("Choose a fixture to inspect returned edits.")
            return
        }
        do {
            externalEdit.pendingReturns = try externalEditJobStore.pendingReturns(
                fixtureID: selectedFixtureID
            )
            externalEdit.announce(externalEdit.pendingReturns.isEmpty
                ? "No returned edits are waiting for a decision in this fixture."
                : "\(externalEdit.pendingReturns.count.formatted()) returned edit\(externalEdit.pendingReturns.count == 1 ? " is" : "s are") waiting for a decision.")
        } catch {
            externalEdit.pendingReturns = []
            externalEdit.announce("Edit Returns could not be loaded: \(userFacingMessage(for: error))")
        }
    }

    func resolveExternalEditReturn(
        _ candidate: ExternalEditReturnCandidate,
        decision: ExternalEditReturnDecision
    ) {
        guard let externalEditJobStore,
              externalEdit.beginDecision(candidate.id, decision: decision) else { return }
        Task { [weak self] in
            guard let self else { return }
            do {
                let resolution = try await Task.detached(priority: .userInitiated) {
                    try externalEditJobStore.resolveReturn(
                        returnID: candidate.id,
                        decision: decision,
                        now: Date()
                    )
                }.value
                self.externalEdit.finishDecision(candidate.id)
                self.externalEdit.pendingReturns.removeAll { $0.id == candidate.id }
                if !resolution.destinationAssetID.isEmpty {
                    self.invalidateCurrentRenditionCaches(for: resolution.destinationAssetID)
                    await self.loadFixtureReviewWindow(preferredAssetID: resolution.destinationAssetID)
                }
                self.externalEdit.announce(Self.decisionReceipt(
                    resolution,
                    remaining: self.externalEdit.pendingReturns.count
                ))
            } catch {
                self.externalEdit.finishDecision(candidate.id)
                self.loadExternalEditReturns()
                self.externalEdit.announce("\(decision.label) failed. The comparison remains retryable. \(self.userFacingMessage(for: error))")
            }
        }
    }

    private static func decisionReceipt(
        _ resolution: ExternalEditReturnResolution,
        remaining: Int
    ) -> String {
        let result = switch resolution.decision {
        case .keepOriginal:
            "Kept the original. The returned candidate was resolved without changing the asset."
        case .replaceOriginal:
            "Replaced the original with a new candidate source version and returned it to Review."
        case .keepBoth:
            "Kept both. The returned file is a new linked asset awaiting Review."
        }
        return "\(result) \(remaining.formatted()) comparison\(remaining == 1 ? " remains" : "s remain")."
    }
}
