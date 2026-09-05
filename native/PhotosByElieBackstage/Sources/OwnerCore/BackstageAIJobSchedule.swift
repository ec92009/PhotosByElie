import Foundation

/// A local, opt-in schedule. Missed runs remain queued for the next scheduled
/// window or the explicit Run AI action; launching the app never starts a catch-up.
public enum BackstageAIJobSchedule {
    public static let enabledKey = "backstage.requestedAI.nightlyEnabled"
    public static let lastAttemptKey = "backstage.requestedAI.lastScheduledDay"

    public static func dueDay(now: Date, enabled: Bool, lastAttemptDay: String?) -> String? {
        guard enabled else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Madrid")!
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: now)
        guard parts.hour == 2, (parts.minute ?? 60) < 5,
              let year = parts.year, let month = parts.month, let day = parts.day else { return nil }
        let key = String(format: "%04d-%02d-%02d", year, month, day)
        return key == lastAttemptDay ? nil : key
    }
}
