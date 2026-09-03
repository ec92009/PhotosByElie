import AppKit
import Foundation
import Testing
@testable import BackstageUI
@testable import OwnerCore

@Suite("Backstage external-edit workflow state")
struct BackstageExternalEditWorkflowStateTests {
    @Test("Busy latches and active-source blocking stay in one workflow state")
    func busyAndSelectionRules() {
        var state = BackstageExternalEditWorkflowState()
        #expect(!state.isOperationInProgress)
        #expect(!state.selectionTouchesActiveJob(["asset-1"]))

        state.activeJob = makeJob()
        state.isPreparing = true
        #expect(state.isOperationInProgress)
        #expect(state.selectionTouchesActiveJob(["asset-1"]))
        #expect(!state.selectionTouchesActiveJob(["asset-3"]))

        state.isPreparing = false
        state.isImporting = true
        #expect(state.isOperationInProgress)
    }

    @Test("Labels and comparison cleanup preserve the existing UI contract")
    func labelsAndComparisonCleanup() {
        let job = makeJob()
        var state = BackstageExternalEditWorkflowState(activeJob: job)
        state.sourceImages = [NSImage(size: NSSize(width: 10, height: 10))]
        state.returnedImage = NSImage(size: NSSize(width: 20, height: 20))
        state.announce("Returning finished image…")

        #expect(state.activeLabel == "Pixelmator Pro · 2 source photos")
        #expect(state.status == "Returning finished image…")

        state.clearComparison()
        #expect(state.sourceImages.isEmpty)
        #expect(state.returnedImage == nil)
        #expect(state.returnReceipt == nil)
    }

    private func makeJob() -> ExternalEditJob {
        ExternalEditJob(
            id: "edit-job-1",
            fixtureID: "fixture-expo",
            kind: .create,
            state: .editing,
            editor: ExternalEditorProfile(
                name: "Pixelmator Pro",
                bundleIdentifier: "com.pixelmatorteam.pixelmator.x",
                applicationURL: URL(fileURLWithPath: "/Applications/Pixelmator Pro.app")
            ),
            workingDirectory: URL(fileURLWithPath: "/tmp/edit-job-1", isDirectory: true),
            sources: [
                ExternalEditSource(
                    position: 1,
                    assetID: "asset-2",
                    photoLibraryIdentifier: "photo-2",
                    originalFilename: "IMG_0002.CR3"
                ),
                ExternalEditSource(
                    position: 0,
                    assetID: "asset-1",
                    photoLibraryIdentifier: "photo-1",
                    originalFilename: "IMG_0001.CR3"
                ),
            ],
            destinationAssetID: "asset-1",
            returnedFileURL: nil,
            returnedSourceVersionID: "",
            errorMessage: "",
            createdAt: Date(timeIntervalSince1970: 1),
            updatedAt: Date(timeIntervalSince1970: 1)
        )
    }
}
