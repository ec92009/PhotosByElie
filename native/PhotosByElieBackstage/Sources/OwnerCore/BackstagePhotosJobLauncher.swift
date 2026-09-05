import Foundation
import Security

/// Launch helpers from the installed signed bundle, never from a mutable
/// checkout or login-shell startup file when Photos authority is involved.
enum BackstagePhotosJobLauncher {
    static let bootstrap = "import runpy,sys;sys.path.insert(0,sys.argv[1]);sys.argv=sys.argv[2:];runpy.run_path(sys.argv[0],run_name='__main__')"

    static func requiresPhotos(_ action: OwnerAction) -> Bool {
        let mode = action.payload?["manifest"]?.objectValue?["mode"]?.stringValue ?? ""
        return action.actionKind == "sidecar-photos-index-sync"
            || action.actionKind == "sidecar-upload-publish"
            || (action.actionKind == "sidecar-culling-review" && [
                "photos-sync-run", "photos-sync-run-start", "fixture-photos-writeback-plan",
                "fixture-photos-writeback-commit", "fixture-ai-pass-start",
                "asset-upload-run-start", "asset-upload-run-resume",
            ].contains(mode))
    }

    static func verifySealedRuntime(_ root: URL) throws {
        guard let bundled = Bundle.main.resourceURL?.appendingPathComponent("OwnerRuntime"),
              root.standardizedFileURL == bundled.standardizedFileURL,
              Bundle.main.bundleIdentifier == "com.photosbyelie.backstage" else {
            throw OwnerActionRunError.failed("Photos jobs must run from the installed signed Backstage runtime.")
        }
        var code: SecStaticCode?
        var requirement: SecRequirement?
        let rule = "anchor apple generic and identifier \"com.photosbyelie.backstage\" and certificate leaf[subject.OU] = \"CB7FE399AL\""
        guard SecStaticCodeCreateWithPath(Bundle.main.bundleURL as CFURL, [], &code) == errSecSuccess,
              SecRequirementCreateWithString(rule as CFString, [], &requirement) == errSecSuccess,
              let code, let requirement,
              SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), requirement) == errSecSuccess else {
            throw OwnerActionRunError.failed("Backstage's sealed Photos job runtime failed signature verification.")
        }
    }

    static func plan(action: OwnerAction, launch: OnDemandOwnerActionWaker.LaunchPlan) async throws -> BackstagePhotosJobPlan {
        try verifySealedRuntime(launch.runtimeRoot)
        guard launch.pythonExecutable.standardizedFileURL.path == "/usr/bin/python3" else {
            throw OwnerActionRunError.failed("Photos jobs require the system Python interpreter.")
        }
        let data = try JSONEncoder.ownerAPI.encode(action)
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                do {
                    let process = Process(), input = Pipe(), output = Pipe()
                    process.executableURL = launch.pythonExecutable
                    process.arguments = ["-I", "-S", "-B", "-c", bootstrap,
                        launch.runtimeRoot.appendingPathComponent("scripts").path,
                        launch.runtimeRoot.appendingPathComponent("scripts/backstage_photos_job.py").path,
                        launch.dataRoot.path]
                    process.currentDirectoryURL = launch.runtimeRoot
                    process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
                    process.standardInput = input; process.standardOutput = output
                    process.standardError = FileHandle.nullDevice
                    try process.run()
                    let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
                    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 30, execute: timeout)
                    defer {
                        timeout.cancel()
                        if process.isRunning { process.terminate() }
                        try? input.fileHandleForWriting.close()
                        try? output.fileHandleForReading.close()
                    }
                    try input.fileHandleForWriting.write(contentsOf: data)
                    try input.fileHandleForWriting.close()
                    var result = Data()
                    while let chunk = try output.fileHandleForReading.read(upToCount: 65_536), !chunk.isEmpty {
                        result.append(chunk)
                        guard result.count <= 32 * 1024 * 1024 else {
                            throw OwnerActionRunError.failed("The Photos job plan exceeded its size limit.")
                        }
                    }
                    process.waitUntilExit()
                    guard process.terminationStatus == 0, result.count <= 32 * 1024 * 1024 else {
                        throw OwnerActionRunError.failed("Backstage could not resolve a bounded Photos job plan.")
                    }
                    try verifySealedRuntime(launch.runtimeRoot)
                    continuation.resume(returning: try JSONDecoder().decode(BackstagePhotosJobPlan.self, from: result))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
}
