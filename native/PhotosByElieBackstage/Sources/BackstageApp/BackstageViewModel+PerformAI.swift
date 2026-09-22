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
        reviewStatus = reviewAIExecutionStatus
        reviewAITask = Task { [weak self] in
            guard let self else { return }
            await self.executeReviewAI(work)
        }
    }

    func executeReviewAI(_ captured: ReviewAIWork) async {
        var work = captured
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
                reviewAIRetry = work
                return
            }
        }
        var visualRuns: [String: VisualRepairProposal] = [:]
        // Each launch captures one bounded preview, then its worker runs independently.
        for item in work.items where work.visualIDs.contains(item.id) {
            reviewAIProgress[item.id] = "Preparing visual repair…"
            do {
                let proposal = try await visualRepairService.generate(fixtureID: work.fixtureID,
                    assetID: item.id, sourceVersionID: item.sourceVersionID, categories: categories)
                visualRuns[item.id] = proposal
                reviewVisualProposals[item.id] = proposal
                reviewAIProgress[item.id] = "Visual repair running…"
            } catch {
                reviewAIProgress[item.id] = "Visual repair failed: \(userFacingMessage(for: error))"
            }
        }
        if !work.metadataIDs.isEmpty {
            reviewAIExecutionStatus = "Performing title and keyword AI for \(work.metadataIDs.count) photo(s)…"
            do {
                var status = try await fixtureService.startAIPass(assetIDs: work.metadataIDs.sorted(), fixtureID: work.fixtureID,
                    sourceVersionIDs: Dictionary(uniqueKeysWithValues: work.items.filter { work.metadataIDs.contains($0.id) }.map { ($0.id, $0.sourceVersionID) }))
                let runID = status.run?.id
                fixtureAIStatus = status
                let deadline = Date().addingTimeInterval(60 * 60)
                while status.active && Date() < deadline {
                    reviewAIExecutionStatus = "Performing AI · \(status.run?.processed ?? 0)/\(status.run?.requested ?? work.metadataIDs.count) metadata results"
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
            } catch {
                for id in work.metadataIDs {
                    reviewAIProgress[id] = "Metadata failed: \(userFacingMessage(for: error)) · \(reviewAIProgress[id] ?? "")"
                }
            }
        }
        for item in work.items where visualRuns[item.id] != nil {
            do {
                var proposal = visualRuns[item.id]!
                let deadline = Date().addingTimeInterval(20 * 60)
                while proposal.isGenerating && Date() < deadline {
                    reviewAIExecutionStatus = "Generating After for \(item.filename)…"
                    try await Task.sleep(for: .seconds(3))
                    let current = try await visualRepairService.proposals(fixtureID: work.fixtureID, assetIDs: [item.id])
                    guard let updated = current.first(where: { $0.id == proposal.id }) else {
                        throw OwnerActionRunError.failed("Visual run receipt unavailable")
                    }
                    proposal = updated
                    reviewVisualProposals[item.id] = proposal
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
        reviewAIExecutionStatus = finished
        reviewStatus = finished
    }
}
