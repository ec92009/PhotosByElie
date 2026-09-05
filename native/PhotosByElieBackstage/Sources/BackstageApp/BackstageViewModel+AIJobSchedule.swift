import Foundation
import OwnerCore

extension BackstageViewModel {
    func runAIJobSchedule() async {
        while !Task.isCancelled {
            if let day = BackstageAIJobSchedule.dueDay(now: Date(), enabled: nightlyAIJobsEnabled,
                lastAttemptDay: UserDefaults.standard.string(forKey: BackstageAIJobSchedule.lastAttemptKey)),
               authentication.phase == .authenticated, !isAIPassActive, !isUpdateOperationInProgress {
                // Persist before starting; repeated wall-clock hours and app relaunches
                // cannot duplicate a scheduled attempt. The action has its own interlock.
                UserDefaults.standard.set(day, forKey: BackstageAIJobSchedule.lastAttemptKey)
                await runAIProposalPass(trigger: "scheduled")
            }
            do { try await Task.sleep(for: .seconds(30)) } catch { return }
        }
    }
}
