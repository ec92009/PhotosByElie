import Testing
@testable import BackstageUI

@Suite("Installed Backstage accessibility smoke mode")
@MainActor
struct BackstageAccessibilitySmokeModeTests {
    @Test("Only the exact private launch argument enables read-only smoke mode")
    func exactLaunchArgument() {
        #expect(!BackstageAccessibilitySmokeMode.isEnabled(arguments: []))
        #expect(!BackstageAccessibilitySmokeMode.isEnabled(arguments: ["--accessibility-smoke"]))
        #expect(BackstageAccessibilitySmokeMode.isEnabled(arguments: [
            "/Applications/PhotosByElie Backstage.app/Contents/MacOS/PhotosByElieBackstage",
            BackstageAccessibilitySmokeMode.launchArgument,
        ]))
    }

    @Test("Smoke model is isolated and its keyboard command reaches the guarded handler")
    func isolatedModelAndSelectAllReceipt() {
        let model = BackstageAccessibilitySmokeMode.makeModel()

        #expect(model.isReadOnlyAccessibilitySmoke)
        #expect(model.selection == .overview)
        #expect(model.status == "Read-only accessibility smoke")

        model.selection = .culling
        #expect(model.selectAllCurrentContent())
        #expect(model.cullingStatus.contains("guarded Gallery handler"))
    }
}
