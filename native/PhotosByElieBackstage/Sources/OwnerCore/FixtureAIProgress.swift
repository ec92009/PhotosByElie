import Foundation

extension FixtureAIStatus {
    static func claimedStartResult(_ result: [String: JSONValue]) throws -> Self {
        let status = Self(json: result["ai"]?.objectValue ?? [:])
        guard let run = status.run, !run.id.isEmpty else {
            throw APIErrorEnvelope(error: .init(code: "ai_start_receipt_missing",
                message: "The AI launcher returned no durable run receipt. Check Activity and retry after the worker is available."))
        }
        return status
    }

    /// Durable worker errors outrank queued-count text, including after relaunch.
    public func progressMessage(starting: Bool = false, startupFailure: String? = nil, availableInReview: Int? = nil) -> String {
        if let run, active {
            return [
                "\(run.processed.formatted()) of \(run.requested.formatted()) processed",
                "\(run.proposed.formatted()) proposed", "\(run.failed.formatted()) failed",
                "\(run.remaining.formatted()) remaining", "\(Int(run.elapsedSeconds).formatted())s elapsed",
            ].joined(separator: " • ")
        }
        if let startupFailure { return startupFailure }
        if let run, run.status == "failed" || run.failed > 0 {
            let detail = run.lastError.isEmpty ? "Open the failed items in Review or Activity for details." : run.lastError
            return "AI pass finished with \(run.failed.formatted()) failed item(s). \(detail) Retry with Perform AI on the affected photos."
        }
        if let run, run.status == "cancelled" {
            return "AI pass cancelled. \(run.proposed.formatted()) proposals were saved; \(requested.formatted()) photos need attention."
        }
        if starting { return "Preparing selected previews and starting AI…" }
        if active { return "AI worker is active; checking its durable progress…" }
        if let count = availableInReview {
            return "\(count.formatted()) proposal\(count == 1 ? "" : "s") available in this Review view."
        }
        if ready > 0 { return "Across all fixtures: \(ready.formatted()) proposal\(ready == 1 ? "" : "s") ready." }
        if requested > 0 { return "\(requested.formatted()) photos need AI review. Select photos and choose Perform AI." }
        return "No AI run is active."
    }
}
