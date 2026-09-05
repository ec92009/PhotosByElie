import Foundation

/// The durable upload run tracks item receipts; the Owner action also owns
/// the bounded Photos capability through the final metadata give-back step.
actor NativeUploadExecutionMonitor {
    private let runner: OwnerActionRunner
    private var actions: [String: String] = [:]

    init(runner: OwnerActionRunner) { self.runner = runner }

    func record(runID: String, actionID: String) { actions[runID] = actionID }

    func status(_ snapshot: NativeUploadRun) async throws -> NativeUploadRun {
        guard let actionID = actions[snapshot.runID] else { return snapshot }
        var run = snapshot
        do {
            let action = try await runner.currentAction(id: actionID)
            switch action.state {
            case .failed, .cancelled:
                throw OwnerActionRunError.failed(action.error?["message"]?.stringValue
                    ?? "The app-owned upload action failed or was cancelled; completed receipts remain valid.")
            case .completed:
                actions.removeValue(forKey: run.runID)
            case .queued, .claimed, .running:
                // Metadata give-back is part of the same bounded Photos job.
                // Keep progress/cancellation admission active until it exits.
                if run.isFinished { run.status = "running" }
            }
        } catch {
            actions.removeValue(forKey: run.runID)
            throw error
        }
        return run
    }

}
