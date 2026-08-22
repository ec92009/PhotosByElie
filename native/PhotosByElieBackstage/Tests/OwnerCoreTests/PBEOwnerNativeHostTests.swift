import CryptoKit
import Foundation
import Testing
@testable import OwnerCore

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

    @Test("Native service owns the web-session lifecycle without a Python host")
    func nativeServiceLifecycle() async throws {
        let root = try makeWebRuntime()
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(!FileManager.default.fileExists(
            atPath: root.appendingPathComponent("scripts/local_server.py").path
        ))
        let readiness = PBEOwnerHostReadiness(
            ready: true,
            sourceIdentity: "source-one",
            catalogIdentity: "catalog-one",
            readinessIdentity: "readiness-one",
            fixtureRevision: "fixture-revision-one",
            lifecycleWriter: "pbb-79-waste-basket",
            capabilities: ["gallery.read", "waste-basket.x", "waste-basket.restore"]
        )
        let cloudSession = PBEOwnerSessionContract(
            id: "session-one",
            state: "ready",
            fixtureId: "expo",
            fixtureBreadcrumb: "Expo",
            sourceIdentity: readiness.sourceIdentity,
            catalogIdentity: readiness.catalogIdentity,
            readinessIdentity: readiness.readinessIdentity,
            fixtureRevision: readiness.fixtureRevision,
            capabilities: readiness.capabilities,
            lifecycleWriter: readiness.lifecycleWriter,
            createdAt: nil,
            expiresAt: Date().addingTimeInterval(600),
            closedAt: nil,
            leaseExpiresAt: nil
        )
        let service = PBEOwnerNativeHostService(
            api: OwnerAPIClient(baseURL: URL(string: "https://worker.test/api/v1")!),
            actionWaker: PBEOwnerNativeHostNoopWaker(),
            verifier: PBEOwnerFixedCloudVerifier(session: cloudSession),
            runtimeRoot: root,
            readinessProvider: { fixtureID in
                #expect(fixtureID == "expo")
                return readiness
            },
            galleryProvider: { session in
                #expect(session.fixtureId == "expo")
                return emptyGallery()
            },
            previewProvider: { _, assetID in
                PBEOwnerNativePreview(
                    assetId: assetID,
                    jpegData: Data([0xff, 0xd8, 0x01, 0xff, 0xd9]),
                    pixelWidth: 100,
                    pixelHeight: 80
                )
            }
        )
        let resolved = try await service.ensureReadiness(fixtureID: "expo")
        #expect(resolved == readiness)

        let attached = try await service.attach(
            sessionToken: "cloud-token-one",
            fixtureID: "expo"
        )
        let launchURL = try #require(attached.launchUrl)
        #expect(launchURL.host == "127.0.0.1")
        #expect(launchURL.port != nil)
        var pageRequest = URLRequest(url: launchURL)
        pageRequest.timeoutInterval = 2
        let (page, response) = try await URLSession.shared.data(for: pageRequest)
        #expect((response as? HTTPURLResponse)?.statusCode == 200)
        #expect(page == Data("<h1>Gallery</h1>".utf8))

        let status = try await service.status(sessionToken: "cloud-token-one")
        #expect(status.session.id == cloudSession.id)
        try await service.close(sessionToken: "cloud-token-one")
        await service.stopIfLaunched()
    }

    @Test("Web bundle loads and dispatches only exact attested files")
    func exactWebBundle() async throws {
        let root = try makeWebRuntime()
        defer { try? FileManager.default.removeItem(at: root) }
        let bundle = try PBEOwnerWebBundle(runtimeRoot: root)
        #expect(bundle.resourceCount == 2)
        #expect(bundle.identity.hasPrefix("pbe-web-runtime:sha256:"))
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

    @Test("Native session routes preserve host, bearer, handoff, and cookie authorities")
    func nativeSessionRoutes() async throws {
        let readiness = PBEOwnerHostReadiness(
            ready: true,
            sourceIdentity: "source-one",
            catalogIdentity: "catalog-one",
            readinessIdentity: "readiness-one",
            fixtureRevision: "fixture-revision-one",
            lifecycleWriter: "pbb-79-waste-basket",
            capabilities: ["gallery.read", "waste-basket.x", "waste-basket.restore"]
        )
        let cloudSession = PBEOwnerSessionContract(
            id: "session-one",
            state: "ready",
            fixtureId: "expo",
            fixtureBreadcrumb: "Expo",
            sourceIdentity: readiness.sourceIdentity,
            catalogIdentity: readiness.catalogIdentity,
            readinessIdentity: readiness.readinessIdentity,
            fixtureRevision: readiness.fixtureRevision,
            capabilities: readiness.capabilities,
            lifecycleWriter: readiness.lifecycleWriter,
            createdAt: nil,
            expiresAt: Date().addingTimeInterval(600),
            closedAt: nil,
            leaseExpiresAt: nil
        )
        let sessionHandler = PBEOwnerNativeSessionHTTPHandler(
            bootstrapSecret: "bootstrap-one",
            checkoutIdentity: "checkout-one",
            verifier: PBEOwnerFixedCloudVerifier(session: cloudSession),
            galleryProvider: { session in
                #expect(session.fixtureId == "expo")
                return PBEOwnerNativeGallery(
                    ok: true,
                    readOnly: true,
                    fixtureId: "expo",
                    fixtureBreadcrumb: "Expo",
                    candidateMode: "curated",
                    view: "picked",
                    offset: 0,
                    limit: 500,
                    count: 1,
                    nextOffset: 1,
                    hasNext: false,
                    truncated: false,
                    summary: .init(filtered: 1, universe: 1, undecided: 0, picked: 1, hidden: 0),
                    mediaAvailability: .init(photos: 1, videos: 0),
                    items: []
                )
            },
            previewProvider: { session, assetID in
                #expect(session.fixtureId == "expo")
                #expect(assetID == "asset-one")
                return PBEOwnerNativePreview(
                    assetId: assetID,
                    jpegData: Data([0xff, 0xd8, 0x01, 0xff, 0xd9]),
                    pixelWidth: 100,
                    pixelHeight: 80
                )
            },
            actionSubmitProvider: { session, payload, key in
                #expect(session.fixtureId == "expo")
                #expect(payload["action"]?.stringValue == "waste-basket-x")
                #expect(key == "browser-action-one")
                return ["ok": true, "requestId": "owner-action-one", "state": "queued"]
            },
            actionStatusProvider: { session, requestID in
                #expect(session.fixtureId == "expo")
                #expect(requestID == "owner-action-one")
                return ["ok": true, "requestId": "owner-action-one", "state": "running"]
            }
        ) { fixtureID in
            #expect(fixtureID == "expo")
            return readiness
        }
        let dispatcher = PBEOwnerNativeHostDispatcher(
            expectedHost: "127.0.0.1:9000",
            handler: sessionHandler.handler()
        )

        let bootstrapResponse = await dispatcher.dispatch(try request(
            jsonRequest(
                path: "/__photosbyelie/pbe-owner/host/bootstrap",
                headers: ["X-PBE-Host-Bootstrap": "bootstrap-one"],
                body: #"{"expectedCheckoutIdentity":"checkout-one"}"#
            )
        ))
        #expect(bootstrapResponse.statusCode == 201)
        let bootstrap = try JSONDecoder.ownerAPI.decode(
            PBEOwnerTestHostBootstrapEnvelope.self,
            from: bootstrapResponse.body
        )
        #expect(bootstrap.checkoutIdentity == "checkout-one")
        #expect(!bootstrap.hostAuthorization.isEmpty)
        #expect(bootstrapResponse.body.range(of: Data("bootstrap-one".utf8)) == nil)

        let replayedBootstrap = await dispatcher.dispatch(try request(
            jsonRequest(
                path: "/__photosbyelie/pbe-owner/host/bootstrap",
                headers: ["X-PBE-Host-Bootstrap": "bootstrap-one"],
                body: #"{"expectedCheckoutIdentity":"checkout-one"}"#
            )
        ))
        #expect(replayedBootstrap.statusCode == 401)

        let unauthorizedStart = await dispatcher.dispatch(try request(
            jsonRequest(
                path: "/__photosbyelie/pbe-owner/session/start",
                headers: ["Authorization": "Bearer cloud-token-one"],
                body: #"{"fixtureId":"expo"}"#
            )
        ))
        #expect(unauthorizedStart.statusCode == 401)

        let hostHeaders = [
            "Authorization": "Bearer cloud-token-one",
            "X-PBE-Host-Authorization": bootstrap.hostAuthorization,
        ]
        let startResponse = await dispatcher.dispatch(try request(
            jsonRequest(
                path: "/__photosbyelie/pbe-owner/session/start",
                headers: hostHeaders,
                body: #"{"fixtureId":"expo"}"#
            )
        ))
        #expect(startResponse.statusCode == 201)
        #expect(startResponse.body.range(of: Data("cloud-token-one".utf8)) == nil)
        let started = try JSONDecoder.ownerAPI.decode(
            PBEOwnerTestSessionEnvelope.self,
            from: startResponse.body
        )
        #expect(started.session.fixtureId == "expo")
        let fragment = try #require(started.launchUrl?.fragment)
        let encodedTicket = try #require(fragment.split(separator: "=", maxSplits: 1).last)
        let ticket = try #require(String(encodedTicket).removingPercentEncoding)

        let browserResponse = await dispatcher.dispatch(try request(
            jsonRequest(
                path: "/__photosbyelie/pbe-owner/browser/bootstrap",
                headers: ["Origin": "http://127.0.0.1:9000"],
                body: "{\"ticket\":\"\(ticket)\"}"
            )
        ))
        #expect(browserResponse.statusCode == 201)
        #expect(browserResponse.body.range(of: Data(ticket.utf8)) == nil)
        let setCookie = try #require(browserResponse.headers["Set-Cookie"])
        #expect(setCookie.hasPrefix("pbe_owner_browser_v2="))
        #expect(setCookie.contains("HttpOnly"))
        #expect(setCookie.contains("SameSite=Strict"))
        #expect(setCookie.contains("Path=/__photosbyelie/;"))
        #expect(!setCookie.contains("Path=/__photosbyelie/pbe-owner"))
        let cookie = String(setCookie.split(separator: ";", maxSplits: 1)[0])

        let statusResponse = await dispatcher.dispatch(try request(
            "GET /__photosbyelie/pbe-owner/session HTTP/1.1\r\n"
                + "Host: 127.0.0.1:9000\r\n"
                + "Cookie: pbe_owner_browser=retained-legacy; \(cookie)\r\n\r\n"
        ))
        #expect(statusResponse.statusCode == 200)

        let unauthorizedGallery = await dispatcher.dispatch(try request(
            "GET /__photosbyelie/pbe-owner/gallery HTTP/1.1\r\n"
                + "Host: 127.0.0.1:9000\r\n\r\n"
        ))
        #expect(unauthorizedGallery.statusCode == 401)

        let galleryResponse = await dispatcher.dispatch(try request(
            "GET /__photosbyelie/pbe-owner/gallery HTTP/1.1\r\n"
                + "Host: 127.0.0.1:9000\r\nCookie: \(cookie)\r\n\r\n"
        ))
        #expect(galleryResponse.statusCode == 200)
        let galleryJSON = try #require(
            JSONSerialization.jsonObject(with: galleryResponse.body) as? [String: Any]
        )
        let galleryBody = try #require(galleryJSON["gallery"] as? [String: Any])
        #expect(galleryBody["fixtureId"] as? String == "expo")
        #expect(galleryBody["readOnly"] as? Bool == true)

        let unauthorizedPreview = await dispatcher.dispatch(try request(
            "GET /__photosbyelie/source-preview/asset-one HTTP/1.1\r\n"
                + "Host: 127.0.0.1:9000\r\n\r\n"
        ))
        #expect(unauthorizedPreview.statusCode == 401)

        let previewResponse = await dispatcher.dispatch(try request(
            "GET /__photosbyelie/source-preview/asset-one HTTP/1.1\r\n"
                + "Host: 127.0.0.1:9000\r\nCookie: \(cookie)\r\n\r\n"
        ))
        #expect(previewResponse.statusCode == 200)
        #expect(previewResponse.headers["Content-Type"] == "image/jpeg")
        #expect(previewResponse.body == Data([0xff, 0xd8, 0x01, 0xff, 0xd9]))

        let pathInjection = await dispatcher.dispatch(try request(
            "GET /__photosbyelie/source-preview/asset%2Ftwo HTTP/1.1\r\n"
                + "Host: 127.0.0.1:9000\r\nCookie: \(cookie)\r\n\r\n"
        ))
        #expect(pathInjection.statusCode == 400)

        let missingIdempotency = await dispatcher.dispatch(try request(
            jsonRequest(
                path: "/__photosbyelie/pbe-owner/action",
                headers: [
                    "Cookie": cookie,
                    "Origin": "http://127.0.0.1:9000",
                ],
                body: #"{"action":"waste-basket-x","photo_id":"asset-one"}"#
            )
        ))
        #expect(missingIdempotency.statusCode == 400)

        let actionResponse = await dispatcher.dispatch(try request(
            jsonRequest(
                path: "/__photosbyelie/pbe-owner/action",
                headers: [
                    "Cookie": cookie,
                    "Idempotency-Key": "browser-action-one",
                    "Origin": "http://127.0.0.1:9000",
                ],
                body: #"{"action":"waste-basket-x","photo_id":"asset-one"}"#
            )
        ))
        #expect(actionResponse.statusCode == 202)

        let actionStatusResponse = await dispatcher.dispatch(try request(
            "GET /__photosbyelie/pbe-owner/action/status?requestId=owner-action-one HTTP/1.1\r\n"
                + "Host: 127.0.0.1:9000\r\nCookie: \(cookie)\r\n\r\n"
        ))
        #expect(actionStatusResponse.statusCode == 200)
        let actionStatusJSON = try #require(
            JSONSerialization.jsonObject(with: actionStatusResponse.body) as? [String: Any]
        )
        #expect(actionStatusJSON["state"] as? String == "running")

        let heartbeatResponse = await dispatcher.dispatch(try request(
            jsonRequest(
                path: "/__photosbyelie/pbe-owner/session/heartbeat",
                headers: [
                    "Cookie": cookie,
                    "Origin": "http://127.0.0.1:9000",
                ],
                body: "{}"
            )
        ))
        #expect(heartbeatResponse.statusCode == 200)

        let hostHeartbeat = await dispatcher.dispatch(try request(
            jsonRequest(
                path: "/__photosbyelie/pbe-owner/session/heartbeat",
                headers: hostHeaders,
                body: "{}"
            )
        ))
        #expect(hostHeartbeat.statusCode == 200)
        let hostHeartbeatJSON = try #require(
            JSONSerialization.jsonObject(with: hostHeartbeat.body) as? [String: Any]
        )
        #expect(hostHeartbeatJSON["latestAction"] is NSNull)

        let closeResponse = await dispatcher.dispatch(try request(
            jsonRequest(
                path: "/__photosbyelie/pbe-owner/session/close",
                headers: [
                    "Cookie": cookie,
                    "Origin": "http://127.0.0.1:9000",
                ],
                body: "{}"
            )
        ))
        #expect(closeResponse.statusCode == 200)
        #expect(closeResponse.headers["Set-Cookie"]?.contains("Max-Age=0") == true)

        let closedStatus = await dispatcher.dispatch(try request(
            "GET /__photosbyelie/pbe-owner/session HTTP/1.1\r\n"
                + "Host: 127.0.0.1:9000\r\nCookie: \(cookie)\r\n\r\n"
        ))
        #expect(closedStatus.statusCode == 401)
    }

    private func request(_ raw: String) throws -> PBEOwnerHTTPRequest {
        try PBEOwnerHTTPRequestParser().parse(Data(raw.utf8))
    }

    private func jsonRequest(
        path: String,
        headers: [String: String] = [:],
        body: String
    ) -> String {
        var lines = [
            "POST \(path) HTTP/1.1",
            "Host: 127.0.0.1:9000",
            "Content-Type: application/json",
            "Content-Length: \(body.utf8.count)",
        ]
        lines.append(contentsOf: headers.sorted(by: { $0.key < $1.key }).map { "\($0.key): \($0.value)" })
        return lines.joined(separator: "\r\n") + "\r\n\r\n" + body
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

private func emptyGallery() -> PBEOwnerNativeGallery {
    PBEOwnerNativeGallery(
        ok: true,
        readOnly: true,
        fixtureId: "expo",
        fixtureBreadcrumb: "Expo",
        candidateMode: "curated",
        view: "picked",
        offset: 0,
        limit: 500,
        count: 0,
        nextOffset: 0,
        hasNext: false,
        truncated: false,
        summary: .init(filtered: 0, universe: 0, undecided: 0, picked: 0, hidden: 0),
        mediaAvailability: .init(photos: 0, videos: 0),
        items: []
    )
}

private struct PBEOwnerNativeHostNoopWaker: OwnerActionWaking {
    func wake(actionID: String) async throws -> OwnerAction? {
        _ = actionID
        return nil
    }
}

private struct PBEOwnerTestHostBootstrapEnvelope: Decodable {
    var checkoutIdentity: String
    var hostAuthorization: String
}

private struct PBEOwnerTestSessionEnvelope: Decodable {
    var session: PBEOwnerSessionContract
    var launchUrl: URL?
}

private struct PBEOwnerFixedCloudVerifier: PBEOwnerCloudSessionVerifying {
    var session: PBEOwnerSessionContract

    func verify(token: String) async throws -> PBEOwnerSessionContract {
        guard token == "cloud-token-one" else {
            throw PBEOwnerNativeSessionFailure(
                code: "pbe_owner_session_required",
                statusCode: 401,
                message: "Expected the test bearer."
            )
        }
        return session
    }
}
