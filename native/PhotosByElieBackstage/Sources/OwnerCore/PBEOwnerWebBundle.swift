import CryptoKit
import Darwin
import Foundation

public struct PBEOwnerWebBundleResource: Sendable, Equatable {
    public var path: String
    public var mimeType: String
    public var data: Data
}

public enum PBEOwnerWebBundleError: Error, LocalizedError, Equatable {
    case unsafeRuntime(String)
    case invalidManifest(String)
    case invalidResource(String)

    public var errorDescription: String? {
        switch self {
        case .unsafeRuntime(let detail): "The PBE Owner web runtime is unsafe: \(detail)"
        case .invalidManifest(let detail): "The PBE Owner web manifest is invalid: \(detail)"
        case .invalidResource(let detail): "A PBE Owner web resource is invalid: \(detail)"
        }
    }
}

public struct PBEOwnerWebBundle: Sendable {
    private struct RuntimeManifest: Decodable {
        var schemaVersion: Int
        var kind: String
        var pbeOwnerWebBundle: WebManifest
    }

    private struct WebManifest: Decodable {
        var scopeManifest: String
        var entrypoints: [String]
        var files: [FileEntry]
    }

    private struct FileEntry: Decodable {
        var path: String
        var sha256: String
        var size: Int
        var mimeType: String
    }

    private static let manifestName = "connector-runtime-manifest.json"
    private static let manifestKind = "photosbyelie-owner-connector-runtime"
    private static let scopeManifest = "scripts/pbe_owner_web_bundle_paths.txt"
    private static let entrypoints = ["gallery.html", "photo.html"]
    private static let maximumFiles = 128
    private static let maximumManifestBytes = 2 * 1024 * 1024
    private static let maximumFileBytes = 8 * 1024 * 1024
    private static let maximumTotalBytes = 64 * 1024 * 1024
    private static let mimeTypes = [
        "css": "text/css; charset=utf-8",
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "jpg": "image/jpeg",
        "mjs": "text/javascript; charset=utf-8",
        "png": "image/png",
        "webmanifest": "application/manifest+json; charset=utf-8",
    ]

    private let resources: [String: PBEOwnerWebBundleResource]

    public init(runtimeRoot: URL) throws {
        let root = runtimeRoot.standardizedFileURL
        try Self.requireDirectory(root, label: "runtime root")
        let manifestURL = root.appendingPathComponent(Self.manifestName, isDirectory: false)
        try Self.requireRegularFile(manifestURL, beneath: root, label: Self.manifestName)
        let manifestAttributes = try FileManager.default.attributesOfItem(atPath: manifestURL.path)
        guard let manifestSize = manifestAttributes[.size] as? NSNumber,
              manifestSize.intValue <= Self.maximumManifestBytes else {
            throw PBEOwnerWebBundleError.invalidManifest("manifest is oversized")
        }
        let manifestData = try Data(contentsOf: manifestURL, options: [.mappedIfSafe])
        let manifest: RuntimeManifest
        do {
            manifest = try JSONDecoder().decode(RuntimeManifest.self, from: manifestData)
        } catch {
            throw PBEOwnerWebBundleError.invalidManifest("unreadable JSON")
        }
        guard manifest.schemaVersion == 2, manifest.kind == Self.manifestKind else {
            throw PBEOwnerWebBundleError.invalidManifest("unsupported schema or kind")
        }
        let web = manifest.pbeOwnerWebBundle
        guard web.scopeManifest == Self.scopeManifest,
              web.entrypoints == Self.entrypoints,
              !web.files.isEmpty,
              web.files.count <= Self.maximumFiles else {
            throw PBEOwnerWebBundleError.invalidManifest("unexpected scope, entrypoints, or file count")
        }

        var loaded: [String: PBEOwnerWebBundleResource] = [:]
        var totalBytes = 0
        for entry in web.files {
            let path = try Self.safePath(entry.path)
            guard loaded[path] == nil else {
                throw PBEOwnerWebBundleError.invalidManifest("duplicate path: \(path)")
            }
            guard entry.size >= 0, entry.size <= Self.maximumFileBytes,
                  totalBytes <= Self.maximumTotalBytes - entry.size else {
                throw PBEOwnerWebBundleError.invalidResource("oversized file: \(path)")
            }
            let pathExtension = (path as NSString).pathExtension.lowercased()
            guard Self.mimeTypes[pathExtension] == entry.mimeType else {
                throw PBEOwnerWebBundleError.invalidResource("unexpected MIME type: \(path)")
            }
            guard entry.sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
                throw PBEOwnerWebBundleError.invalidResource("invalid checksum: \(path)")
            }
            let fileURL = path.split(separator: "/").reduce(root) {
                $0.appendingPathComponent(String($1), isDirectory: false)
            }
            try Self.requireRegularFile(fileURL, beneath: root, label: path)
            let data = try Data(contentsOf: fileURL, options: [.mappedIfSafe])
            guard data.count == entry.size, Self.sha256(data) == entry.sha256 else {
                throw PBEOwnerWebBundleError.invalidResource("size or checksum mismatch: \(path)")
            }
            loaded[path] = PBEOwnerWebBundleResource(
                path: path,
                mimeType: entry.mimeType,
                data: data
            )
            totalBytes += data.count
        }
        guard Self.entrypoints.allSatisfy({ loaded[$0] != nil }) else {
            throw PBEOwnerWebBundleError.invalidManifest("entrypoint file missing")
        }
        resources = loaded
    }

    public func resource(forRequestPath requestPath: String) -> PBEOwnerWebBundleResource? {
        let path = requestPath == "/" ? "gallery.html" : String(requestPath.dropFirst())
        guard requestPath.hasPrefix("/"), !path.isEmpty,
              (try? Self.safePath(path)) != nil else { return nil }
        return resources[path]
    }

    public var resourceCount: Int { resources.count }

    private static func safePath(_ raw: String) throws -> String {
        guard !raw.isEmpty, !raw.hasPrefix("/"), !raw.contains("\\"), !raw.contains("\0") else {
            throw PBEOwnerWebBundleError.invalidManifest("unsafe path: \(raw)")
        }
        let components = raw.split(separator: "/", omittingEmptySubsequences: false)
        guard components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw PBEOwnerWebBundleError.invalidManifest("unsafe path: \(raw)")
        }
        return raw
    }

    private static func requireDirectory(_ url: URL, label: String) throws {
        var info = stat()
        guard lstat(url.path, &info) == 0,
              (info.st_mode & S_IFMT) == S_IFDIR else {
            throw PBEOwnerWebBundleError.unsafeRuntime(label)
        }
    }

    private static func requireRegularFile(_ url: URL, beneath root: URL, label: String) throws {
        var current = root
        let relative = url.path.dropFirst(root.path.count).split(separator: "/")
        for (index, component) in relative.enumerated() {
            current.appendPathComponent(String(component), isDirectory: false)
            var info = stat()
            let expected = index == relative.count - 1 ? S_IFREG : S_IFDIR
            guard lstat(current.path, &info) == 0,
                  (info.st_mode & S_IFMT) == expected else {
                throw PBEOwnerWebBundleError.unsafeRuntime(label)
            }
        }
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
