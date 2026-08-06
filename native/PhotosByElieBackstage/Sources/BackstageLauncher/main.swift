import BackstageUI
import Darwin
import OwnerCore

@main
struct PhotosByElieBackstageLauncher {
    static func main() async {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.first == "--control" else {
            BackstageApplication.main()
            return
        }

        let exitCode = await BackstageControlCLI.run(
            arguments: Array(arguments.dropFirst())
        )
        Darwin.exit(exitCode)
    }
}
