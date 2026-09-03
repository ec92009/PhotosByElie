import Foundation
import OwnerCore
import Testing
@testable import BackstageUI

@Suite("Backstage update workflow state")
struct BackstageUpdateWorkflowStateTests {
    @Test("A newer release latches availability and requests immediate download")
    func updateDiscoveryStartsDownload() throws {
        var workflow = BackstageUpdateWorkflowState()
        let manifest = updateManifest()
        let serial = workflow.beginCheck()

        let download = workflow.resolveCheck(
            BackstageUpdateCheck(
                current: BackstageReleaseIdentity(
                    bundleIdentifier: BackstageReleaseManifest.bundleIdentifier,
                    version: "1.0",
                    build: "1"
                ),
                manifest: manifest,
                availability: .updateAvailable
            ),
            existingVerifiedUpdate: nil,
            serial: serial
        )

        #expect(download == manifest)
        #expect(workflow.state == .updateAvailable(manifest))
        #expect(workflow.isOperationInProgress)
    }

    @Test("A matching verified download is reused without another download")
    func verifiedDownloadIsReused() {
        var workflow = BackstageUpdateWorkflowState()
        let manifest = updateManifest()
        let verified = verifiedUpdate(manifest)
        workflow.replaceState(.verified(verified))
        let existing = workflow.existingVerifiedUpdate
        let serial = workflow.beginCheck()

        let download = workflow.resolveCheck(
            BackstageUpdateCheck(
                current: BackstageReleaseIdentity(),
                manifest: manifest,
                availability: .updateAvailable
            ),
            existingVerifiedUpdate: existing,
            serial: serial
        )

        #expect(download == nil)
        #expect(workflow.state == .verified(verified))
    }

    @Test("Stale download progress cannot replace newer failure state")
    func staleDownloadProgressIsIgnored() {
        var workflow = BackstageUpdateWorkflowState()
        let manifest = updateManifest()
        let serial = workflow.beginDownload(manifest)
        workflow.replaceState(.failed(message: "Offline", recovery: "Retry"))

        workflow.recordDownloadProgress(
            manifest: manifest,
            receivedBytes: 512,
            totalBytes: 1_024,
            serial: serial
        )

        #expect(workflow.state == .failed(message: "Offline", recovery: "Retry"))
    }

    @Test("Install latches before installer work and preserves the verified input")
    func installLatchesImmediately() throws {
        var workflow = BackstageUpdateWorkflowState()
        let verified = verifiedUpdate(updateManifest())
        workflow.replaceState(.verified(verified))

        let pendingOperation = workflow.beginInstall()
        let operation = try #require(pendingOperation)

        #expect(operation.update == verified)
        #expect(workflow.state == .installing(verified.manifest))
        #expect(workflow.isOperationInProgress)
    }

    @Test("Failure recovery is recorded only by the current operation")
    func failureOwnership() {
        var workflow = BackstageUpdateWorkflowState()
        let first = workflow.beginCheck()
        let second = workflow.beginDownload(updateManifest())

        workflow.fail(.downloadFailed("old"), serial: first)
        #expect(workflow.isOperationInProgress)

        workflow.fail(.downloadFailed("current"), serial: second)
        guard case let .failed(message, recovery) = workflow.state else {
            Issue.record("Current failure did not become visible.")
            return
        }
        #expect(message == "current")
        #expect(recovery.contains("Retry"))
    }

    private func updateManifest() -> BackstageReleaseManifest {
        BackstageReleaseManifest(
            version: "999.1",
            build: "9991",
            minimumOSVersion: "14.0",
            releaseNotes: "Synthetic update workflow test.",
            architectures: ["arm64"],
            downloadURL: URL(string: "https://updates.test/Backstage.zip")!,
            fileSize: 1_024,
            sha256: String(repeating: "a", count: 64),
            trust: BackstageReleaseTrust(
                teamIdentifier: "TESTTEAM",
                signingIdentity: "Apple Development: Test",
                designatedRequirement: "identifier com.photosbyelie.backstage"
            )
        )
    }

    private func verifiedUpdate(_ manifest: BackstageReleaseManifest) -> BackstageVerifiedUpdate {
        BackstageVerifiedUpdate(
            manifest: manifest,
            archiveURL: URL(fileURLWithPath: "/tmp/Backstage-update.zip"),
            bundleURL: URL(fileURLWithPath: "/tmp/PhotosByElie Backstage.app")
        )
    }
}
