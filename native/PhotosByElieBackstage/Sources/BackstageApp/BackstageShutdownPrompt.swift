import AppKit

enum BackstageTerminationChoice: Equatable, Sendable {
    case waitAndQuit
    case detachAIPassAndQuit
    case cancelQuit
    case forceQuit
}

struct BackstageTerminationAction: Equatable, Sendable {
    var title: String
    var choice: BackstageTerminationChoice
    var isDestructive = false
    var isCancel = false
}

struct BackstageShutdownPromptModel: Equatable, Sendable {
    var workState: BackstageShutdownWorkState

    var messageText: String {
        "Backstage Can’t Quit Yet"
    }

    var informativeText: String {
        let reasonText = Self.joinedReasons(workState.activeReasons)
        var paragraphs = ["Backstage is still completing \(reasonText)."]
        if workState.canDetachAIPass {
            paragraphs.append(
                "The AI pass is running in an independent durable worker. Detaching stops Backstage monitoring, but the pass will continue in the background."
            )
        }
        paragraphs.append(
            "Force Quit skips the safety drain and may interrupt other in-flight work or leave it needing recovery."
        )
        return paragraphs.joined(separator: "\n\n")
    }

    var actions: [BackstageTerminationAction] {
        var values = [BackstageTerminationAction(
            title: "Wait and Quit",
            choice: .waitAndQuit
        )]
        if workState.canDetachAIPass {
            values.append(BackstageTerminationAction(
                title: workState.hasNonAIPassActiveWork
                    ? "Detach AI Pass and Wait"
                    : "Detach AI Pass and Quit",
                choice: .detachAIPassAndQuit
            ))
        }
        values.append(BackstageTerminationAction(
            title: "Cancel Quit",
            choice: .cancelQuit,
            isCancel: true
        ))
        values.append(BackstageTerminationAction(
            title: "Force Quit",
            choice: .forceQuit,
            isDestructive: true
        ))
        return values
    }

    func choice(for response: NSApplication.ModalResponse) -> BackstageTerminationChoice {
        let first = NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        let index = response.rawValue - first
        guard actions.indices.contains(index) else { return .cancelQuit }
        return actions[index].choice
    }

    private static func joinedReasons(_ reasons: [String]) -> String {
        switch reasons.count {
        case 0:
            return "active work"
        case 1:
            return reasons[0]
        case 2:
            return "\(reasons[0]) and \(reasons[1])"
        default:
            return "\(reasons.dropLast().joined(separator: ", ")), and \(reasons.last ?? "active work")"
        }
    }
}

enum BackstageTerminationDisposition: Equatable, Sendable {
    case cancel
    case terminateNow
    case terminateLater(detachAIPass: Bool)
    case alreadyPending
}

struct BackstageTerminationCoordinator: Sendable {
    private(set) var terminationReplyPending = false

    mutating func decide(
        workState: BackstageShutdownWorkState,
        choose: () -> BackstageTerminationChoice
    ) -> BackstageTerminationDisposition {
        guard !terminationReplyPending else { return .alreadyPending }
        guard workState.hasActiveWork else {
            terminationReplyPending = true
            return .terminateLater(detachAIPass: false)
        }
        switch choose() {
        case .waitAndQuit:
            terminationReplyPending = true
            return .terminateLater(detachAIPass: false)
        case .detachAIPassAndQuit:
            terminationReplyPending = true
            return .terminateLater(detachAIPass: true)
        case .cancelQuit:
            return .cancel
        case .forceQuit:
            return .terminateNow
        }
    }
}

@MainActor
enum BackstageShutdownAlert {
    static func present(for workState: BackstageShutdownWorkState) -> BackstageTerminationChoice {
        let prompt = BackstageShutdownPromptModel(workState: workState)
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = prompt.messageText
        alert.informativeText = prompt.informativeText
        for action in prompt.actions {
            let button = alert.addButton(withTitle: action.title)
            button.hasDestructiveAction = action.isDestructive
            if action.isCancel {
                button.keyEquivalent = "\u{1b}"
            }
        }
        return prompt.choice(for: alert.runModal())
    }
}
