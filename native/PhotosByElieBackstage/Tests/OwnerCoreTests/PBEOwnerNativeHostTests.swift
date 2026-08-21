import CryptoKit
import Foundation
import OwnerCore
import Testing

@Suite("PBE Owner native HTTP host")
struct PBEOwnerNativeHTTPHostTests {
    @Test("Parser waits for the declared body and rejects non-ASCII header names")
    func parserBoundaries() {
        let partial = Data(
            "POST / HTTP/1.1\r\nContent-Length: 2\r\n\r\n{".utf8
        )
        #expect(throws: PBEOwnerHTTPRequestParserError.incomplete) {
            try PBEOwnerHTTPRequestParser().parse(partial)
        }
        let nonASCIIHeader = Data(
            "GET / HTTP/1.1\r\nHöst: local\r\n\r\n".utf8
        )
        #expect(throws: PBEOwnerHTTPRequestParserError.malformed) {
            try PBEOwnerHTTPRequestParser().parse(nonASCIIHeader)
        }
        let controlValue = Data(
            "GET / HTTP/1.1\r\nHost: local\u{7f}\r\n\r\n".utf8
        )
        #expect(throws: PBEOwnerHTTPRequestParserError.malformed) {
            try PBEOwnerHTTPRequestParser().parse(controlValue)
        }
    }

    @Test("Dispatcher denies unknown hosts, routes, and browser origins")
    func dispatcherFailsClosed() async throws {
        let dispatcher = PBEOwnerNativeHostDispatcher(expectedHost: "127.0.0.1:9000") {
            _, _ in
            .json(statusCode: 202, reasonPhrase: "Accepted", body: Data("{\"ok\":true}".utf8))
        }
        let wrongHost = try request(
            "GET /__photosbyelie/pbe-owner/readiness HTTP/1.1\r\nHost: localhost:9000\r\n\r\n"
        )
        #expect(await dispatcher.dispatch(wrongHost).statusCode == 403)

        let unknown = try request(
            "GET /__photosbyelie/private HTTP/1.1\r\nHost: 127.0.0.1:9000\r\n\r\n"
        )
        #expect(await dispatcher.dispatch(unknown).statusCode == 404)

        let wrongOrigin = try request(
            "POST /__photosbyelie/pbe-owner/action HTTP/1.1\r\n"
                + "Host: 127.0.0.1:9000\r\n"
                + "Origin: http://example.com\r\n"
                + "Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{}"
        )
        #expect(await dispatcher.dispatch(wrongOrigin).statusCode == 403)
    }

    @Test("Dispatcher delegates one exact authorized route")
    func dispatcherDelegates() async throws {
        let dispatcher = PBEOwnerNativeHostDispatcher(expectedHost: "127.0.0.1:9000") {
            _, route in
            #expect(route.authority == .browserSession)
            return .json(statusCode: 202, reasonPhrase: "Accepted", body: Data("{\"ok\":true}".utf8))
        }
        let accepted = try request(
            "POST /__photosbyelie/pbe-owner/action HTTP/1.1\r\n"
                + "Host: 127.0.0.1:9000\r\n"
                + "Origin: http://127.0.0.1:9000\r\n"
                + "Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{}"
        )
        #expect(await dispatcher.dispatch(accepted).statusCode == 202)
    }

    @Test("Server binds an ephemeral loopback port and serves only the dispatcher")
    func loopbackServer() async throws {
        let server = PBEOwnerNativeHostServer { _, route in
            #expect(route.authority == .hostAuthorization)
            return .json(body: Data("{\"ok\":true}".utf8))
        }
        let port = try await server.start()
        defer { server.stop() }
        #expect(port > 0)

        var request = URLRequest(
            url: URL(string: "http://127.0.0.1:\(port)/__photosbyelie/pbe-owner/readiness")!
        )
        request.timeoutInterval = 2
        let (data, response) = try await URLSession.shared.data(for: request)
        #expect((response as? HTTPURLResponse)?.statusCode == 200)
        #expect(data == Data("{\"ok\":true}".utf8))
    }

    @Test("Web bundle loads and dispatches only exact attested files")
    func exactWebBundle() async throws {
        let root = try makeWebRuntime()
        defer { try? FileManager.default.removeItem(at: root) }
        let bundle = try PBEOwnerWebBundle(runtimeRoot: root)
        #expect(bundle.resourceCount == 2)
        #expect(bundle.resource(forRequestPath: "/")?.path == "gallery.html")
        #expect(bundle.resource(forRequestPath: "/photo.html")?.path == "photo.html")
        #expect(bundle.resource(forRequestPath: "/owner.html") == nil)
        #expect(bundle.resource(forRequestPath: "/../gallery.html") == nil)

        let dispatcher = PBEOwnerNativeHostDispatcher(
            expectedHost: "127.0.0.1:9000",
            webBundle: bundle
        ) { _, _ in
            .json(statusCode: 500, reasonPhrase: "Unexpected", body: Data())
        }
        let response = await dispatcher.dispatch(try request(
            "GET /gallery.html HTTP/1.1\r\nHost: 127.0.0.1:9000\r\n\r\n"
        ))
        #expect(response.statusCode == 200)
        #expect(response.headers["Content-Type"] == "text/html; charset=utf-8")
        #expect(response.body == Data("<h1>Gallery</h1>".utf8))
        let bodyResponse = await dispatcher.dispatch(try request(
            "GET /gallery.html HTTP/1.1\r\nHost: 127.0.0.1:9000\r\nContent-Length: 1\r\n\r\nx"
        ))
        #expect(bodyResponse.statusCode == 400)
    }

    @Test("Web bundle rejects checksum drift and symlinked resources")
    func webBundleTampering() throws {
        let checksumRoot = try makeWebRuntime()
        defer { try? FileManager.default.removeItem(at: checksumRoot) }
        try Data("tampered".utf8).write(to: checksumRoot.appendingPathComponent("gallery.html"))
        #expect(throws: PBEOwnerWebBundleError.self) {
            try PBEOwnerWebBundle(runtimeRoot: checksumRoot)
        }

        let symlinkRoot = try makeWebRuntime()
        defer { try? FileManager.default.removeItem(at: symlinkRoot) }
        let photo = symlinkRoot.appendingPathComponent("photo.html")
        try FileManager.default.removeItem(at: photo)
        try FileManager.default.createSymbolicLink(
            at: photo,
            withDestinationURL: symlinkRoot.appendingPathComponent("gallery.html")
        )
        #expect(throws: PBEOwnerWebBundleError.self) {
            try PBEOwnerWebBundle(runtimeRoot: symlinkRoot)
        }
    }

    private func request(_ raw: String) throws -> PBEOwnerHTTPRequest {
        try PBEOwnerHTTPRequestParser().parse(Data(raw.utf8))
    }

    private func makeWebRuntime() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pbe-owner-web-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let files = [
            ("gallery.html", "<h1>Gallery</h1>"),
            ("photo.html", "<h1>Photo</h1>"),
        ]
        var entries: [[String: Any]] = []
        for (path, content) in files {
            let data = Data(content.utf8)
            try data.write(to: root.appendingPathComponent(path))
            entries.append([
                "path": path,
                "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
                "size": data.count,
                "mimeType": "text/html; charset=utf-8",
            ])
        }
        let manifest: [String: Any] = [
            "schemaVersion": 2,
            "kind": "photosbyelie-owner-connector-runtime",
            "pbeOwnerWebBundle": [
                "scopeManifest": "scripts/pbe_owner_web_bundle_paths.txt",
                "entrypoints": ["gallery.html", "photo.html"],
                "files": entries,
            ],
        ]
        let manifestData = try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys])
        try manifestData.write(to: root.appendingPathComponent("connector-runtime-manifest.json"))
        return root
    }
}
