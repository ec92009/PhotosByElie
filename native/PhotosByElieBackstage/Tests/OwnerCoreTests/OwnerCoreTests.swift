import Foundation
import Testing
@testable import OwnerCore

@Suite("OwnerCore contract")
struct OwnerCoreTests {
    @Test("Decodes the published action page fixture")
    func decodesActionPage() throws {
        let url = try #require(Bundle.module.url(forResource: "action-page", withExtension: "json", subdirectory: "Fixtures"))
        let page = try JSONDecoder.ownerAPI.decode(OwnerActionPage.self, from: Data(contentsOf: url))
        #expect(page.actions.count == 1)
        #expect(page.actions[0].actionKind == "fixture-operation")
        #expect(page.actions[0].progress?.total == 20)
        #expect(page.page.hasMore)
    }

    @Test("Creates canonical v1 requests with actor token and idempotency")
    func createsCanonicalRequest() async throws {
        let transport = RecordingTransport(response: """
        {"action":{"id":"owner-action-1","actionKind":"fixture-operation","target":"max","state":"queued"}}
        """)
        let client = OwnerAPIClient(baseURL: URL(string: "https://example.test/api/v1")!, transport: transport)
        await client.setAccessToken("short-lived")
        _ = try await client.createAction(
            OwnerActionCreate(actionKind: "fixture-operation", target: "max"),
            idempotencyKey: "fixture-create-1234"
        )
        let request = try #require(await transport.lastRequest())
        #expect(request.url?.path == "/api/v1/actions")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer short-lived")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "fixture-create-1234")
    }
}

private actor RecordingTransport: OwnerAPITransport {
    private var request: URLRequest?
    private let responseData: Data

    init(response: String) {
        responseData = Data(response.utf8)
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        self.request = request
        return (
            responseData,
            HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        )
    }

    func lastRequest() -> URLRequest? { request }
}

