import Foundation
import OwnerCore

extension BackstageViewModel {
    /// Only a pending result for this exact fixture and source changes Approve's target.
    func pendingReviewAfter(for item: FixtureReviewItem) -> VisualRepairProposal? {
        guard let proposal = reviewVisualProposals[item.id], proposal.status == .draft,
              proposal.assetID == item.id, proposal.fixtureID == selectedFixtureID,
              proposal.sourceVersionID == item.sourceVersionID else { return nil }
        return proposal
    }

    func requiresReviewAfter(for item: FixtureReviewItem) -> Bool {
        pendingReviewAfter(for: item) != nil || (isREReviewScope && !item.visualAIReasons.isEmpty)
    }

    var hasPendingReviewAI: Bool {
        selectedReviewAssetIDs.contains { id in
            let metadata = reviewProposalDrafts[id]
            return (metadata?.isProposal == true && metadata?.isHistoricalProposal == false)
                || reviewItems.first(where: { $0.id == id }).map { requiresReviewAfter(for: $0) } == true
        }
    }

    var canApproveReviewSelection: Bool {
        guard !isApprovingReview, !isRunningReview, !isPhotosMaintenanceActive, !isExternalEditOperationInProgress,
              !selectedReviewTouchesActiveExternalEdit, !isUpdateOperationInProgress,
              !isCloudWorkflowActive, !selectedReviewAssetIDs.isEmpty else { return false }
        if isAIPassActive && !isPerformingReviewAI { return false }
        return selectedReviewAssetIDs.allSatisfy { id in
            guard let item = reviewItems.first(where: { $0.id == id }) else { return false }
            if isLoadingVisualRepairProposals && reviewVisualProposals[id] == nil { return false }
            if isPerformingReviewAI {
                guard let batch = reviewAIBatch, batch.work.fixtureID == selectedFixtureID else { return false }
                if batch.ids.contains(id) {
                    guard batch.completeIDs.contains(id), !batch.approvedIDs.contains(id),
                          batch.work.items.first(where: { $0.id == id })?.sourceVersionID == item.sourceVersionID else { return false }
                    if batch.work.metadataIDs.contains(id) {
                        guard let draft = reviewProposalDrafts[id], draft.isProposal, !draft.isHistoricalProposal else { return false }
                    }
                }
            }
            if requiresReviewAfter(for: item) || (isPerformingReviewAI && reviewAIBatch?.work.visualIDs.contains(id) == true) {
                guard let proposal = pendingReviewAfter(for: item), !proposal.isGenerating,
                      !proposal.derivedSHA256.isEmpty, renderedVisualRepairProposal(for: item) != nil else { return false }
            }
            return true
        }
    }

    /// Reserve the action synchronously so repeated clicks cannot submit twice.
    func beginReviewApproval() {
        guard canApproveReviewSelection else { return }
        let capturedIDs = Set(selectedReviewAssetIDs)
        isApprovingReview = true
        isRunningReview = true
        reviewStatus = "Approving selected photos…"
        Task { [weak self] in
            guard let self else { return }
            self.isRunningReview = false
            self.isApprovingReview = false
            guard Set(self.selectedReviewAssetIDs) == capturedIDs else {
                self.reviewStatus = "Selection changed before approval. Review the selection and approve again."
                return
            }
            await self.applyReviewAction(.approve)
        }
    }

    /// All approval entry points use this route when any selected photo has a pending After.
    func approveReviewAfterSelection() async {
        guard canApproveReviewSelection else { return }
        let ids = selectedReviewAssetIDs
        let items = reviewItems.filter { ids.contains($0.id) }
        guard !items.isEmpty else { return }
        // Preflight every pending result before any approval; never silently approve an original
        // when its requested After is incomplete, stale, missing or corrupt.
        for item in items where requiresReviewAfter(for: item) {
            guard let proposal = pendingReviewAfter(for: item), !proposal.isGenerating,
                  renderedVisualRepairProposal(for: item) != nil, !proposal.derivedSHA256.isEmpty else {
                reviewStatus = "After for \(item.filename) is not ready. Retry AI or Reject AI before approving the original."
                return
            }
        }
        guard let store = externalEditJobStore else {
            reviewStatus = "After approval is unavailable: the local rendition store is not configured."
            return
        }
        cancelReviewEnrichment()
        preserveCurrentReviewDraft()
        let drafts = reviewProposalDrafts
        let proposals = Dictionary(uniqueKeysWithValues: items.compactMap { item in
            pendingReviewAfter(for: item).map { (item.id, $0) }
        })
        let fixtureID = selectedFixtureID
        let countryEnabled = fixtureReviewWindow?.countryWriteEnabled == true
        cancelReviewMetadataAutosave()
        isApprovingReview = true
        isRunningReview = true
        reviewStatus = "Preparing and approving After images…"
        defer { isRunningReview = false; isApprovingReview = false }
        do {
            for item in items {
                if let proposal = proposals[item.id] {
                    _ = try await Task.detached(priority: .userInitiated) {
                        try VisualRepairRendition.prepare(proposal: proposal, item: item, store: store)
                    }.value
                    invalidateCurrentRenditionCaches(for: item.id)
                    // Rows stay mounted after approval, so onAppear will not reload
                    // their cleared cache. Load the new fixture rendition explicitly.
                    await loadReviewThumbnail(for: item)
                    reviewVisualProposals[item.id] = try await visualRepairService.decide(.accept,
                        fixtureID: fixtureID, proposalID: proposal.id,
                        idempotencyKey: "backstage-visual-use-after-\(proposal.id)")
                }
                let draft = drafts[item.id]
                _ = try await fixtureService.applyReview(.approve, fixtureID: fixtureID,
                    assetIDs: [item.id], anchorAssetID: item.id,
                    title: draft?.title ?? item.title, keywords: draft?.keywords ?? item.keywords,
                    country: countryEnabled ? (draft?.country ?? item.country) : nil,
                    proposalID: draft?.isProposal == true && draft?.hasManualEdits == false ? draft?.proposalID : nil)
                if reviewAIBatch?.work.fixtureID == fixtureID, reviewAIBatch?.ids.contains(item.id) == true {
                    reviewAIBatch?.approvedIDs.insert(item.id)
                }
                reviewProposalDrafts.removeValue(forKey: item.id)
            }
            await loadFixtureReviewWindow(preferredAssetID: ids.first)
            reviewStatus = "Approved for Uploads. AI After images use the original dimensions; originals retained. Nothing uploaded."
        } catch {
            for item in items {
                invalidateCurrentRenditionCaches(for: item.id)
                await loadReviewThumbnail(for: item)
            }
            await loadFixtureReviewWindow(preferredAssetID: ids.first)
            reviewStatus = "Approval needs attention: \(userFacingMessage(for: error)). Completed approvals are retained."
        }
    }

    /// Withdraw pending AI proposals through the existing audited request-withdrawal action.
    /// Neither accepted image versions nor accepted metadata are rolled back.
    func rejectReviewAI() {
        guard !isReviewMutationBlocked, hasPendingReviewAI else { return }
        let ids = selectedReviewAssetIDs.filter { id in
            let draft = reviewProposalDrafts[id]
            return (draft?.isProposal == true && draft?.isHistoricalProposal == false)
                || reviewItems.first(where: { $0.id == id }).map { requiresReviewAfter(for: $0) } == true
        }
        let proposals = reviewItems.filter { ids.contains($0.id) }.compactMap { pendingReviewAfter(for: $0) }
        guard !proposals.contains(where: \.isGenerating) else { return }
        let fixtureID = selectedFixtureID
        cancelReviewEnrichment()
        cancelReviewMetadataAutosave()
        isRunningReview = true
        reviewStatus = "Rejecting AI results…"
        Task { [weak self] in
            guard let self else { return }
            defer { self.isRunningReview = false }
            do {
                for proposal in proposals {
                    self.reviewVisualProposals[proposal.assetID] = try await self.visualRepairService.decide(.reject,
                        fixtureID: fixtureID, proposalID: proposal.id,
                        idempotencyKey: "backstage-visual-reject-\(proposal.id)")
                }
                // Empty reasons and note withdraw the request and supersede pending metadata,
                // preserving the stored title, keywords, country, original and upload receipts.
                _ = try await self.fixtureService.applyReview(.requestAI, fixtureID: fixtureID,
                    assetIDs: ids, anchorAssetID: ids.first ?? "")
                for id in ids {
                    self.reviewProposalDrafts.removeValue(forKey: id)
                    self.reviewProposalConflictIDs.remove(id)
                    self.reviewAIProgress.removeValue(forKey: id)
                    self.reviewAIRetry?.metadataIDs.remove(id)
                    self.reviewAIRetry?.visualIDs.remove(id)
                }
                if self.reviewAIRetry?.metadataIDs.isEmpty == true && self.reviewAIRetry?.visualIDs.isEmpty == true {
                    self.reviewAIRetry = nil
                }
                self.reviewAIExecutionStatus = ""
                self.syncReviewDraft()
                await self.loadFixtureReviewWindow(preferredAssetID: ids.first)
                self.reviewStatus = "AI rejected. Approve will use the original. Nothing approved or uploaded."
            } catch {
                self.reviewStatus = "Could not finish rejecting AI: \(self.userFacingMessage(for: error)). Retry Reject AI."
            }
        }
    }
}
