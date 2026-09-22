import Foundation
import OwnerCore

/// Captured selection and instructions also bound a retry to its original scope.
struct ReviewAIWork {
    var fixtureID: String
    var items: [FixtureReviewItem]
    var note: String
    var metadataIDs: Set<String>
    var visualIDs: Set<String>
    var prepared = false
}

/// Counts describe each independent pass; a metadata result is not a finished After.
struct ReviewAIBatchProgress {
    var metadataTotal: Int
    var visualTotal: Int
    var metadataProcessed = 0
    var metadataFailed = 0
    var visualReady = 0
    var visualFailed = 0
    var visualRefreshUnavailable = false
    var metadataReady: Int? = nil

    var summary: String {
        var lines: [String] = []
        if metadataTotal > 0 {
            if let metadataReady {
                lines.append("Titles / keywords: \(metadataReady) of \(metadataTotal) ready · \(metadataFailed) need attention")
            } else {
                let processed = min(metadataTotal, max(0, metadataProcessed))
                lines.append("Titles / keywords: \(processed) of \(metadataTotal) processed · \(metadataTotal - processed) remaining · \(metadataFailed) need attention")
            }
        }
        if visualTotal > 0 {
            let remaining = max(0, visualTotal - visualReady - visualFailed)
            lines.append("After images: \(visualReady) of \(visualTotal) ready · \(remaining) remaining · \(visualFailed) need attention")
            if visualRefreshUnavailable { lines.append("After counts last checked; refreshing progress is temporarily unavailable.") }
        }
        return lines.joined(separator: "\n")
    }
}

extension BackstageViewModel {
    var canPerformReviewAI: Bool {
        !isReviewMutationBlocked && !isAIPassActive && !isCloudWorkflowActive
            && !isUpdateOperationInProgress && !selectedReviewAssetIDs.isEmpty
            && selectedReviewAssetIDs.allSatisfy { id in
                reviewItems.contains { $0.id == id && $0.placementState == "picked" }
            }
    }

    /// Acquire interlocks before the first asynchronous boundary or provider call.
    func performReviewAI(retry: Bool = false) {
        guard !isReviewMutationBlocked, !isAIPassActive, !isCloudWorkflowActive,
              !isUpdateOperationInProgress else { return }
        let work: ReviewAIWork
        if retry {
            guard let failed = reviewAIRetry, failed.fixtureID == selectedFixtureID else { return }
            work = failed
        } else {
            guard canPerformReviewAI else { return }
            let ids = Set(selectedReviewAssetIDs)
            work = ReviewAIWork(fixtureID: selectedFixtureID,
                items: reviewItems.filter { ids.contains($0.id) }, note: reviewAINote,
                metadataIDs: ids, visualIDs: isREReviewScope ? ids : [])
        }
        for id in work.metadataIDs.union(work.visualIDs) { reviewAIProgress[id] = "Starting AI…" }
        cancelReviewMetadataAutosave()
        isPerformingReviewAI = true
        isRunningReview = true
        reviewAIRetry = nil
        reviewAIExecutionStatus = "Starting AI for \(work.items.count) photo(s)…"
        reviewAIExecutionStatus += "\n" + ReviewAIBatchProgress(metadataTotal: work.metadataIDs.count,
            visualTotal: work.visualIDs.count).summary
        reviewStatus = reviewAIExecutionStatus
        reviewAITask = Task { [weak self] in
            guard let self else { return }
            await self.executeReviewAI(work)
        }
    }

    func executeReviewAI(_ captured: ReviewAIWork) async {
        var work = captured
        var progress = ReviewAIBatchProgress(metadataTotal: work.metadataIDs.count, visualTotal: work.visualIDs.count)
        var visualLaunchFailures: Set<String> = []
        defer {
            isPerformingReviewAI = false
            isRunningReview = false
            reviewAITask = nil
        }
        let categories = VisualRepairDefectCategory.allCases
        if !work.prepared {
            do {
                _ = try await fixtureService.applyReview(.requestAI, fixtureID: work.fixtureID,
                    assetIDs: work.items.map(\.id), anchorAssetID: work.items.first?.id ?? "",
                    aiReasons: reviewAIReasonChoices.filter { $0 != "Other" }, aiNote: work.note,
                    visualAIReasons: work.visualIDs.isEmpty ? [] : categories.map(\.rawValue))
                work.prepared = true
            } catch {
                reviewAIExecutionStatus = "AI could not start: \(userFacingMessage(for: error)). Retry failed AI."
                reviewStatus = reviewAIExecutionStatus
                reviewAIRetry = work
                return
            }
        }
        var visualRuns: [String: VisualRepairProposal] = [:]
        // Each launch captures one bounded preview, then its worker runs independently.
        for item in work.items where work.visualIDs.contains(item.id) {
            publishReviewAIProgress(progress, stage: "Preparing After images · \(visualRuns.count + visualLaunchFailures.count) of \(progress.visualTotal) submitted")
            reviewAIProgress[item.id] = "Preparing visual repair…"
            do {
                let proposal = try await visualRepairService.generate(fixtureID: work.fixtureID,
                    assetID: item.id, sourceVersionID: item.sourceVersionID, categories: categories)
                visualRuns[item.id] = proposal
                reviewVisualProposals[item.id] = proposal
                reviewAIProgress[item.id] = "Visual repair running…"
            } catch {
                visualLaunchFailures.insert(item.id)
                reviewAIProgress[item.id] = "Visual repair failed: \(userFacingMessage(for: error))"
            }
            updateReviewAIVisualCounts(&progress, proposals: visualRuns, failures: visualLaunchFailures)
            if (visualRuns.count + visualLaunchFailures.count).isMultiple(of: 8) {
                await refreshReviewAIVisualProgress(fixtureID: work.fixtureID, proposals: &visualRuns,
                    failures: visualLaunchFailures, progress: &progress)
            }
        }
        updateReviewAIVisualCounts(&progress, proposals: visualRuns, failures: visualLaunchFailures)
        if !work.metadataIDs.isEmpty {
            publishReviewAIProgress(progress, stage: "Performing AI…")
            do {
                var status = try await fixtureService.startAIPass(assetIDs: work.metadataIDs.sorted(), fixtureID: work.fixtureID,
                    sourceVersionIDs: Dictionary(uniqueKeysWithValues: work.items.filter { work.metadataIDs.contains($0.id) }.map { ($0.id, $0.sourceVersionID) }))
                let runID = status.run?.id
                fixtureAIStatus = status
                let deadline = Date().addingTimeInterval(60 * 60)
                while status.active && Date() < deadline {
                    progress.metadataProcessed = status.run?.processed ?? 0
                    progress.metadataFailed = status.run?.failed ?? 0
                    await refreshReviewAIVisualProgress(fixtureID: work.fixtureID, proposals: &visualRuns, failures: visualLaunchFailures, progress: &progress)
                    publishReviewAIProgress(progress, stage: "Performing AI…")
                    try await Task.sleep(for: .seconds(2))
                    status = try await fixtureService.aiStatus()
                    guard status.run?.id == runID else {
                        throw OwnerActionRunError.failed("The AI run receipt changed; refresh before retrying.")
                    }
                    fixtureAIStatus = status
                }
                let proposals = try await fixtureService.aiProposals(assetIDs: work.metadataIDs.sorted(), includeLoaded: true)
                let completed = Set(proposals.filter { $0.runID == runID && ["ready", "loaded"].contains($0.status) }.map(\.assetID))
                for id in work.metadataIDs {
                    let message = completed.contains(id) ? "Metadata proposal ready" : "Metadata incomplete: \(status.run?.lastError.isEmpty == false ? status.run!.lastError : "retry failed AI")"
                    reviewAIProgress[id] = [message, reviewAIProgress[id]].compactMap { $0 }.joined(separator: " · ")
                }
                work.metadataIDs.subtract(completed)
                progress.metadataReady = progress.metadataTotal - work.metadataIDs.count
                progress.metadataFailed = work.metadataIDs.count
            } catch {
                progress.metadataReady = 0
                progress.metadataFailed = work.metadataIDs.count
                for id in work.metadataIDs {
                    reviewAIProgress[id] = "Metadata failed: \(userFacingMessage(for: error)) · \(reviewAIProgress[id] ?? "")"
                }
            }
        }
        await refreshReviewAIVisualProgress(fixtureID: work.fixtureID, proposals: &visualRuns, failures: visualLaunchFailures, progress: &progress)
        publishReviewAIProgress(progress, stage: "Checking After images…")
        for item in work.items where visualRuns[item.id] != nil {
            do {
                var proposal = visualRuns[item.id]!
                let deadline = Date().addingTimeInterval(20 * 60)
                while proposal.isGenerating && Date() < deadline {
                    publishReviewAIProgress(progress, stage: "Generating After images…")
                    try await Task.sleep(for: .seconds(3))
                    await refreshReviewAIVisualProgress(fixtureID: work.fixtureID, proposals: &visualRuns, failures: visualLaunchFailures, progress: &progress)
                    proposal = visualRuns[item.id]!
                    publishReviewAIProgress(progress, stage: "Generating After images…")
                }
                if proposal.derivedAvailable {
                    work.visualIDs.remove(item.id)
                    reviewAIProgress[item.id] = (work.metadataIDs.contains(item.id) ? "Metadata needs retry" : "Metadata proposal ready") + " · After ready"
                } else {
                    throw OwnerActionRunError.failed(proposal.generationError.isEmpty ? "Visual generation has not completed" : proposal.generationError)
                }
            } catch {
                reviewAIProgress[item.id] = (work.metadataIDs.contains(item.id) ? "Metadata needs retry" : "Metadata proposal ready") + " · Visual repair: \(userFacingMessage(for: error))"
            }
        }
        let failed = work.metadataIDs.union(work.visualIDs)
        reviewAIRetry = failed.isEmpty ? nil : work
        let finished = failed.isEmpty
            ? "AI complete. Review the proposals\(visualRuns.isEmpty ? "" : " and Before / After comparisons") before approving."
            : "AI finished with \(failed.count) photo(s) needing attention. Successful results are retained; Retry failed AI continues only incomplete parts."
        await loadFixtureReviewWindow(preferredAssetID: work.items.first?.id)
        // A timed-out component is attention-required, never silently reported as ready.
        progress.visualFailed = work.visualIDs.count
        progress.visualReady = progress.visualTotal - progress.visualFailed
        publishReviewAIProgress(progress, stage: finished)
    }

    func publishReviewAIProgress(_ progress: ReviewAIBatchProgress, stage: String) {
        reviewAIExecutionStatus = stage + "\n" + progress.summary
        reviewStatus = reviewAIExecutionStatus
    }

    private func updateReviewAIVisualCounts(_ progress: inout ReviewAIBatchProgress,
                                           proposals: [String: VisualRepairProposal], failures: Set<String>) {
        progress.visualReady = proposals.values.filter { $0.derivedAvailable }.count
        progress.visualFailed = failures.count + proposals.values.filter { !$0.derivedAvailable && !$0.isGenerating }.count
    }

    private func refreshReviewAIVisualProgress(fixtureID: String,
        proposals: inout [String: VisualRepairProposal], failures: Set<String>, progress: inout ReviewAIBatchProgress) async {
        guard proposals.values.contains(where: { $0.isGenerating }) else { return }
        do {
            let current = try await visualRepairService.proposals(fixtureID: fixtureID, assetIDs: proposals.keys.sorted())
            var found: Set<String> = []
            for updated in current {
                guard let expected = proposals[updated.assetID], updated.id == expected.id,
                      updated.fixtureID == fixtureID, updated.sourceVersionID == expected.sourceVersionID else { continue }
                found.insert(updated.assetID)
                proposals[updated.assetID] = updated
                reviewVisualProposals[updated.assetID] = updated
            }
            progress.visualRefreshUnavailable = !Set(proposals.keys).isSubset(of: found)
        } catch {
            progress.visualRefreshUnavailable = true
        }
        updateReviewAIVisualCounts(&progress, proposals: proposals, failures: failures)
    }
}
