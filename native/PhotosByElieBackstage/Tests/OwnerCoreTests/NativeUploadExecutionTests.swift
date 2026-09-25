import Foundation
import Testing
@testable import OwnerCore

@Suite("App-owned upload execution")
struct NativeUploadExecutionTests {
    @Test("An uploaded run remains unfinished during registration and can resume with no uploads left")
    func publicContinuationStages() async throws {
        let api = UploadExecutionAPI()
        await api.setPublicStage("registration", status: "running", remaining: 1)
        let service = FixtureDeliveryService(runner: OwnerActionRunner(api: api, waker: UploadExecutionWaker()))
        let registering = try await service.nativeUploadStatus(runID: "run-one")
        #expect(registering.processed == 1)
        #expect(!registering.isFinished)
        #expect(registering.publicationPhaseLabel == "Registering exact public previews")
        await api.setPublicStage("verification", status: "failed", remaining: 1)
        let failed = try await service.nativeUploadStatus(runID: "run-one")
        #expect(failed.canResume)
        #expect(failed.publicationPhase == "verification")
        await api.setPublicStage("verification", status: "cancelled", remaining: 1)
        #expect(try await service.nativeUploadStatus(runID: "run-one").canResume)
    }

    @Test("Start returns a durable run before execution and waits for give-back before completion")
    func durableRunBeforeExecution() async throws {
        let api = UploadExecutionAPI()
        let service = FixtureDeliveryService(runner: OwnerActionRunner(api: api, waker: UploadExecutionWaker()))
        let run = try await service.startNativeUpload(assetIDs: ["one"])
        #expect(run.runID == "run-one")
        #expect(run.status == "queued")
        let requests = await api.manifests
        #expect(requests.count == 2)
        #expect(requests[0]["prepareOnly"]?.boolValue == true)
        #expect(requests[1]["runId"]?.stringValue == "run-one")
        #expect(requests[1]["assetIds"] == nil)
        let finishing = try await service.nativeUploadStatus(runID: run.runID)
        #expect(!finishing.isFinished)
        #expect(finishing.processed == 1)
        await api.setExecution(.completed)
        #expect(try await service.nativeUploadStatus(runID: run.runID).isFinished)
    }

    @Test("Execution failures remain actionable instead of becoming empty success receipts")
    func executionFailure() async throws {
        let api = UploadExecutionAPI()
        let service = FixtureDeliveryService(runner: OwnerActionRunner(api: api, waker: UploadExecutionWaker()))
        let run = try await service.startNativeUpload(assetIDs: ["one"])
        await api.setExecution(.failed)
        await #expect(throws: OwnerActionRunError.failed("Photos authorization expired")) {
            try await service.nativeUploadStatus(runID: run.runID)
        }
    }
}

private struct UploadExecutionWaker: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? { nil }
}

private actor UploadExecutionAPI: OwnerActionServing {
    var manifests: [[String: JSONValue]] = []
    private var actions: [String: OwnerAction] = [:]
    private var executionState: OwnerActionState = .running
    private var publicStage = ""
    private var publicStatus = "completed"
    private var publicRemaining = 0
    func setExecution(_ state: OwnerActionState) { executionState = state }
    func setPublicStage(_ stage: String, status: String, remaining: Int) {
        publicStage = stage; publicStatus = status; publicRemaining = remaining
    }

    func createAction(_ request: OwnerActionCreate, idempotencyKey: String) async throws -> OwnerActionEnvelope {
        let manifest = request.payload["manifest"]?.objectValue ?? [:]
        manifests.append(manifest)
        let execution = manifest["mode"]?.stringValue == "asset-upload-run-start" && manifest["runId"] != nil
        let id = execution ? "execution" : "action-\(manifests.count)"
        let prepared = manifest["prepareOnly"]?.boolValue == true
        let action = OwnerAction(id: id, actionKind: request.actionKind, target: "max", state: execution ? .queued : .completed,
            result: ["uploadRun": ["runId": "run-one", "status": .string(prepared ? "queued" : publicStatus),
                "publicationPhase": .string(publicStage), "requested": 1,
                "processed": .number(prepared ? 0 : 1), "remaining": .number(prepared ? 1 : Double(publicRemaining))]])
        actions[id] = action
        return OwnerActionEnvelope(action: action, idempotencyReplayed: false)
    }

    func getAction(id: String) async throws -> OwnerAction {
        if id == "execution" {
            return OwnerAction(id: id, actionKind: "sidecar-culling-review", target: "max", state: executionState,
                error: executionState == .failed ? ["message": "Photos authorization expired"] : nil)
        }
        guard let action = actions[id] else { throw URLError(.badServerResponse) }
        return action
    }
}
