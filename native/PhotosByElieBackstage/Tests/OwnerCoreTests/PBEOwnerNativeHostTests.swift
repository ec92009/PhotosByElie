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

    private func request(_ raw: String) throws -> PBEOwnerHTTPRequest {
        try PBEOwnerHTTPRequestParser().parse(Data(raw.utf8))
    }
}
