import Foundation

/// Production owner of the explicit PBE Owner browser session. The loopback
/// listener and every local provider live inside Backstage; this service never
/// launches the retired Python web-session host.
public actor PBEOwnerNativeHostService: PBEOwnerHostServing {
    private struct HostBootstrapRequest: Encodable {
        var expectedCheckoutIdentity: String
    }

    private struct HostBootstrapEnvelope: Decodable {
        var ok: Bool
        var checkoutIdentity: String
        var hostAuthorization: String
    }

    private struct FixtureRequest: Encodable { var fixtureId: String }

    private struct ReadinessEnvelope: Decodable {
        var ok: Bool
        var ready: Bool
        var sourceIdentity: String
        var catalogIdentity: String
        var readinessIdentity: String
        var fixtureRevision: String
        var lifecycleWriter: String
        var capabilities: [String]
    }

    private let api: any OwnerActionServing
    private let photoLibrary: any PhotoLibraryServing
    private let connectorIdentity: any OwnerConnectorIdentifying
    private let actionWaker: any OwnerActionWaking
    private let verifier: any PBEOwnerCloudSessionVerifying
    private let sidecarDecisionService: (any SidecarDecisionServing)?
    private let runtimeRootOverride: URL?
    private let dataRootOverride: URL?
    private let connectorConfigURL: URL
    private let readinessOverride: PBEOwnerNativeSessionHTTPHandler.ReadinessProvider?
    private let galleryOverride: PBEOwnerNativeSessionHTTPHandler.GalleryProvider?
    private let previewOverride: PBEOwnerNativeSessionHTTPHandler.PreviewProvider?

    private var startTask: Task<Void, any Error>?
    private var server: PBEOwnerNativeHostServer?
    private var sessionHandler: PBEOwnerNativeSessionHTTPHandler?
    private var port: UInt16?
    private var hostAuthorization = ""

    public init(
        api: any OwnerActionServing,
        photoLibrary: any PhotoLibraryServing = PhotoKitLibraryService(),
        connectorIdentity: any OwnerConnectorIdentifying = LocalOwnerConnectorIdentity(),
        actionWaker: any OwnerActionWaking = OnDemandOwnerActionWaker(),
        verifier: any PBEOwnerCloudSessionVerifying = PBEOwnerCloudSessionVerifier(),
        sidecarDecisionService: (any SidecarDecisionServing)? = nil,
        runtimeRoot: URL? = nil,
        dataRoot: URL? = nil,
        connectorConfigURL: URL? = nil,
        readinessProvider: PBEOwnerNativeSessionHTTPHandler.ReadinessProvider? = nil,
        galleryProvider: PBEOwnerNativeSessionHTTPHandler.GalleryProvider? = nil,
        previewProvider: PBEOwnerNativeSessionHTTPHandler.PreviewProvider? = nil
    ) {
        self.api = api
        self.photoLibrary = photoLibrary
        self.connectorIdentity = connectorIdentity
        self.actionWaker = actionWaker
        self.verifier = verifier
        self.sidecarDecisionService = sidecarDecisionService
        self.runtimeRootOverride = runtimeRoot?.standardizedFileURL
        self.dataRootOverride = dataRoot?.standardizedFileURL
        self.connectorConfigURL = connectorConfigURL ?? URL(
            fileURLWithPath: NSHomeDirectory(),
            isDirectory: true
        ).appendingPathComponent(
            ".config/photosbyelie/connector.json",
            isDirectory: false
        )
        self.readinessOverride = readinessProvider
        self.galleryOverride = galleryProvider
        self.previewOverride = previewProvider
    }

    public func ensureReadiness(fixtureID: String) async throws -> PBEOwnerHostReadiness {
        try await ensureStarted()
        var lastError: (any Error)?
        for attempt in 0..<12 {
            do {
                let envelope: ReadinessEnvelope = try await invoke(
                    path: "/__photosbyelie/pbe-owner/readiness",
                    method: "GET",
                    query: [URLQueryItem(name: "fixtureId", value: fixtureID)]
                )
                guard envelope.ok, envelope.ready,
                      !envelope.sourceIdentity.isEmpty,
                      !envelope.catalogIdentity.isEmpty,
                      !envelope.readinessIdentity.isEmpty,
                      !envelope.fixtureRevision.isEmpty,
                      envelope.lifecycleWriter == "pbb-79-waste-basket",
                      Set(envelope.capabilities).isSuperset(
                        of: ["gallery.read", "waste-basket.x", "waste-basket.restore"]
                      ) else {
                    throw failure(
                        "pbe_owner_host_not_ready",
                        "The native PBE Owner host did not provide the required frozen fixture contract."
                    )
                }
                return PBEOwnerHostReadiness(
                    ready: true,
                    sourceIdentity: envelope.sourceIdentity,
                    catalogIdentity: envelope.catalogIdentity,
                    readinessIdentity: envelope.readinessIdentity,
                    fixtureRevision: envelope.fixtureRevision,
                    lifecycleWriter: envelope.lifecycleWriter,
                    capabilities: envelope.capabilities
                )
            } catch {
                lastError = error
                if attempt < 11 { try await Task.sleep(for: .milliseconds(250)) }
            }
        }
        throw lastError ?? failure(
            "pbe_owner_host_unavailable",
            "Backstage could not start its native PBE Owner host."
        )
    }

    public func attach(
        sessionToken: String,
        fixtureID: String
    ) async throws -> PBEOwnerHostSessionEnvelope {
        try await ensureStarted()
        return try await invoke(
            path: "/__photosbyelie/pbe-owner/session/start",
            method: "POST",
            token: sessionToken,
            body: try JSONEncoder.ownerAPI.encode(FixtureRequest(fixtureId: fixtureID))
        )
    }

    public func status(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope {
        try await invoke(
            path: "/__photosbyelie/pbe-owner/session",
            method: "GET",
            token: sessionToken
        )
    }

    public func heartbeat(sessionToken: String) async throws -> PBEOwnerHostSessionEnvelope {
        try await invoke(
            path: "/__photosbyelie/pbe-owner/session/heartbeat",
            method: "POST",
            token: sessionToken
        )
    }

    public func close(sessionToken: String) async throws {
        let _: PBEOwnerHostSessionEnvelope = try await invoke(
            path: "/__photosbyelie/pbe-owner/session/close",
            method: "POST",
            token: sessionToken
        )
    }

    public func stopIfLaunched() async {
        let pending = startTask
        startTask = nil
        pending?.cancel()
        if let pending { _ = try? await pending.value }
        server?.stop()
        server = nil
        sessionHandler = nil
        port = nil
        hostAuthorization = ""
    }

    private func ensureStarted() async throws {
        if server != nil, sessionHandler != nil, port != nil, !hostAuthorization.isEmpty {
            return
        }
        if let startTask {
            try await startTask.value
            return
        }
        let task = Task { try await self.startHost() }
        startTask = task
        do {
            try await task.value
            startTask = nil
        } catch {
            startTask = nil
            throw error
        }
    }

    private func startHost() async throws {
        let roots = PBEOwnerRuntimeRoots.resolve(
            environment: ProcessInfo.processInfo.environment,
            bundleRuntimeRoot: nil,
            connectorConfigURL: connectorConfigURL,
            homeDirectory: URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
        )
        let signedRuntimeRoot = Bundle.main.resourceURL?.appendingPathComponent(
            "OwnerRuntime",
            isDirectory: true
        )
        guard let runtimeRoot = runtimeRootOverride ?? signedRuntimeRoot,
              FileManager.default.fileExists(atPath: runtimeRoot.appendingPathComponent(
                "connector-runtime-manifest.json",
                isDirectory: false
              ).path) else {
            throw failure(
                "pbe_owner_runtime_missing",
                "Backstage cannot find its attested PBE Owner web runtime on this Mac."
            )
        }
        let dataRoot = dataRootOverride ?? roots.dataRoot
        guard dataRoot != nil
                || (readinessOverride != nil && galleryOverride != nil && previewOverride != nil) else {
            throw failure(
                "pbe_owner_data_root_missing",
                "Backstage cannot find the configured Owner SQLite data root on this Mac."
            )
        }

        let webBundle: PBEOwnerWebBundle
        do {
            webBundle = try PBEOwnerWebBundle(runtimeRoot: runtimeRoot)
        } catch {
            throw failure(
                "pbe_owner_runtime_invalid",
                "Backstage rejected its attested PBE Owner web runtime."
            )
        }
        let readinessProvider: PBEOwnerNativeSessionHTTPHandler.ReadinessProvider
        if let readinessOverride {
            readinessProvider = readinessOverride
        } else if let dataRoot {
            var additionalCapabilities = ["fixture.hide", "fixture.review"]
            if sidecarDecisionService != nil {
                additionalCapabilities += ["asset.rating", "asset.color"]
            }
            readinessProvider = PBEOwnerNativeReadinessService(
                dataRoot: dataRoot,
                additionalCapabilities: additionalCapabilities
            ).provider()
        } else {
            throw failure(
                "pbe_owner_data_root_missing",
                "Backstage cannot resolve native PBE Owner readiness without its SQLite data root."
            )
        }
        let galleryProvider: PBEOwnerNativeSessionHTTPHandler.GalleryProvider
        if let galleryOverride {
            galleryProvider = galleryOverride
        } else if let dataRoot {
            galleryProvider = PBEOwnerNativeGalleryService(dataRoot: dataRoot).provider()
        } else {
            throw failure(
                "pbe_owner_data_root_missing",
                "Backstage cannot resolve the native PBE Owner gallery without its SQLite data root."
            )
        }
        let previewProvider: PBEOwnerNativeSessionHTTPHandler.PreviewProvider
        if let previewOverride {
            previewProvider = previewOverride
        } else {
            previewProvider = PBEOwnerNativePreviewService(
                galleryProvider: galleryProvider,
                photoLibrary: photoLibrary
            ).provider()
        }
        let connectorID = await connectorIdentity.connectorID()
        let runner = OwnerActionRunner(api: api, waker: actionWaker)
        let nativeMutationProvider: PBEOwnerNativeActionService.NativeMutationProvider?
        if let dataRoot {
            let fixtureService = LocalFixtureReviewService(
                nativeDatabaseURL: dataRoot.appendingPathComponent(
                    "assets/owner-actions/Owner.sqlite",
                    isDirectory: false
                )
            )
            let sidecarDecisionService = self.sidecarDecisionService
            nativeMutationProvider = { session, operation, assetIDs, value, reason, key in
                var resultByAssetID = Dictionary(uniqueKeysWithValues: assetIDs.map { assetID in
                    (assetID, ["photoId": JSONValue.string(assetID), "ok": .bool(true)])
                })
                switch operation {
                case "fixture-hide", "fixture-review":
                    let placement: FixturePlacementState = operation == "fixture-hide"
                        ? .hidden
                        : .picked
                    let applied = try await Task.detached(priority: .userInitiated) {
                        try fixtureService.nativeApplyCullingState(
                            placement,
                            fixtureID: session.fixtureId,
                            assetIDs: assetIDs,
                            reason: reason.isEmpty ? "Hosted PBE Owner \(operation)" : reason
                        )
                    }.value
                    guard applied != nil else {
                        throw PBEOwnerNativeSessionFailure(
                            code: "pbe_owner_action_failed",
                            statusCode: 502,
                            message: "The native fixture writer did not return a result."
                        )
                    }
                    for item in applied ?? [] {
                        resultByAssetID[item.assetID]?["placement"] = .string(item.placementState.rawValue)
                    }
                case "rating-set":
                    guard let sidecarDecisionService,
                          let rating = value?.intValue,
                          (0...5).contains(rating) else {
                        throw PBEOwnerNativeSessionFailure(
                            code: "pbe_owner_action_invalid",
                            statusCode: 400,
                            message: "The hosted rating action is invalid."
                        )
                    }
                    let changes = try await sidecarDecisionService.applyDetailed(
                        assetIDs.map { SidecarDecision.rating($0, value: rating) },
                        idempotencyKey: key
                    )
                    for change in changes {
                        resultByAssetID[change.assetID]?["rating"] = JSONValue.number(Double(change.state.rating))
                        resultByAssetID[change.assetID]?["color"] = JSONValue.string(change.state.color)
                    }
                case "color-set":
                    guard let sidecarDecisionService,
                          let color = value?.stringValue.flatMap(SidecarColor.init(rawValue:)),
                          color != .none else {
                        throw PBEOwnerNativeSessionFailure(
                            code: "pbe_owner_action_invalid",
                            statusCode: 400,
                            message: "The hosted color action is invalid."
                        )
                    }
                    let changes = try await sidecarDecisionService.toggleColor(
                        color,
                        assetIDs: assetIDs,
                        idempotencyKey: key
                    )
                    for change in changes {
                        resultByAssetID[change.assetID]?["rating"] = JSONValue.number(Double(change.state.rating))
                        resultByAssetID[change.assetID]?["color"] = JSONValue.string(change.state.color)
                    }
                default:
                    throw PBEOwnerNativeSessionFailure(
                        code: "pbe_owner_action_forbidden",
                        statusCode: 403,
                        message: "The hosted Owner action is unavailable."
                    )
                }
                return [
                    "results": .array(assetIDs.map { assetID in
                        .object(resultByAssetID[assetID] ?? [
                            "photoId": .string(assetID),
                            "ok": true,
                        ])
                    }),
                ]
            }
        } else {
            nativeMutationProvider = nil
        }
        let actionService = PBEOwnerNativeActionService(
            api: api,
            runner: runner,
            connectorID: connectorID,
            galleryProvider: galleryProvider,
            nativeMutationProvider: nativeMutationProvider
        )
        let actionSubmitProvider = await actionService.submitProvider()
        let actionStatusProvider = await actionService.statusProvider()
        let bootstrapSecret = UUID().uuidString + UUID().uuidString
        let handler = PBEOwnerNativeSessionHTTPHandler(
            bootstrapSecret: bootstrapSecret,
            checkoutIdentity: webBundle.identity,
            verifier: verifier,
            galleryProvider: galleryProvider,
            previewProvider: previewProvider,
            actionSubmitProvider: actionSubmitProvider,
            actionStatusProvider: actionStatusProvider,
            readinessProvider: readinessProvider
        )
        let candidate = PBEOwnerNativeHostServer(
            webBundle: webBundle,
            handler: handler.handler()
        )
        do {
            let candidatePort = try await candidate.start()
            try Task.checkCancellation()
            let body = try JSONEncoder.ownerAPI.encode(HostBootstrapRequest(
                expectedCheckoutIdentity: webBundle.identity
            ))
            let bootstrap: HostBootstrapEnvelope = try await Self.invoke(
                handler: handler,
                port: candidatePort,
                hostAuthorization: "",
                path: "/__photosbyelie/pbe-owner/host/bootstrap",
                method: "POST",
                body: body,
                bootstrapSecret: bootstrapSecret
            )
            guard bootstrap.ok,
                  bootstrap.checkoutIdentity == webBundle.identity,
                  !bootstrap.hostAuthorization.isEmpty else {
                throw failure(
                    "pbe_owner_host_bootstrap_invalid",
                    "The native PBE Owner host bootstrap contract was invalid."
                )
            }
            try Task.checkCancellation()
            server = candidate
            sessionHandler = handler
            port = candidatePort
            hostAuthorization = bootstrap.hostAuthorization
        } catch {
            candidate.stop()
            throw error
        }
    }

    private func invoke<Response: Decodable>(
        path: String,
        method: String,
        token: String = "",
        body: Data? = nil,
        query: [URLQueryItem] = []
    ) async throws -> Response {
        guard let sessionHandler, let port, !hostAuthorization.isEmpty else {
            throw failure(
                "pbe_owner_host_unavailable",
                "The native PBE Owner host is not running."
            )
        }
        return try await Self.invoke(
            handler: sessionHandler,
            port: port,
            hostAuthorization: hostAuthorization,
            path: path,
            method: method,
            token: token,
            body: body,
            query: query
        )
    }

    private static func invoke<Response: Decodable>(
        handler: PBEOwnerNativeSessionHTTPHandler,
        port: UInt16,
        hostAuthorization: String,
        path: String,
        method: String,
        token: String = "",
        body: Data? = nil,
        query: [URLQueryItem] = [],
        bootstrapSecret: String = ""
    ) async throws -> Response {
        var components = URLComponents()
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        let target = components.string ?? path
        var headers = ["host": "127.0.0.1:\(port)"]
        if !hostAuthorization.isEmpty {
            headers["x-pbe-host-authorization"] = hostAuthorization
        }
        if !bootstrapSecret.isEmpty {
            headers["x-pbe-host-bootstrap"] = bootstrapSecret
        }
        if !token.isEmpty { headers["authorization"] = "Bearer \(token)" }
        let requestBody = body ?? (method == "POST" ? Data("{}".utf8) : Data())
        if method == "POST" { headers["content-type"] = "application/json" }
        guard let route = PBEOwnerNativeHostContract.route(method: method, path: path) else {
            throw failure(
                "pbe_owner_route_not_implemented",
                "The native PBE Owner control route is unavailable."
            )
        }
        let response = await handler.handle(
            PBEOwnerHTTPRequest(
                method: method,
                target: target,
                path: path,
                headers: headers,
                body: requestBody
            ),
            route: route
        )
        guard (200..<300).contains(response.statusCode) else {
            if let envelope = try? JSONDecoder.ownerAPI.decode(
                APIErrorEnvelope.self,
                from: response.body
            ) {
                throw envelope
            }
            throw failure(
                "pbe_owner_host_error",
                "The native PBE Owner host returned HTTP \(response.statusCode)."
            )
        }
        do {
            return try JSONDecoder.ownerAPI.decode(Response.self, from: response.body)
        } catch {
            throw failure(
                "pbe_owner_host_response_invalid",
                "The native PBE Owner host returned an invalid response."
            )
        }
    }

    private static func failure(_ code: String, _ message: String) -> APIErrorEnvelope {
        APIErrorEnvelope(error: .init(code: code, message: message))
    }

    private func failure(_ code: String, _ message: String) -> APIErrorEnvelope {
        Self.failure(code, message)
    }
}
