import Foundation

public struct PBEOwnerHTTPResponse: Sendable, Equatable {
    public var statusCode: Int
    public var reasonPhrase: String
    public var headers: [String: String]
    public var body: Data

    public init(
        statusCode: Int,
        reasonPhrase: String,
        headers: [String: String] = [:],
        body: Data = Data()
    ) {
        self.statusCode = statusCode
        self.reasonPhrase = reasonPhrase
        self.headers = headers
        self.body = body
    }

    public static func json(
        statusCode: Int = 200,
        reasonPhrase: String = "OK",
        body: Data
    ) -> Self {
        Self(
            statusCode: statusCode,
            reasonPhrase: reasonPhrase,
            headers: ["Content-Type": "application/json; charset=utf-8"],
            body: body
        )
    }

    public func serialized() -> Data {
        var responseHeaders = headers
        responseHeaders["Content-Length"] = String(body.count)
        responseHeaders["Connection"] = "close"
        responseHeaders["Cache-Control"] = "no-store"
        var head = "HTTP/1.1 \(statusCode) \(reasonPhrase)\r\n"
        for (name, value) in responseHeaders.sorted(by: { $0.key < $1.key }) {
            head += "\(name): \(value)\r\n"
        }
        head += "\r\n"
        var data = Data(head.utf8)
        data.append(body)
        return data
    }
}

public struct PBEOwnerNativeHostDispatcher: Sendable {
    public typealias Handler = @Sendable (
        PBEOwnerHTTPRequest,
        PBEOwnerNativeHostRoute
    ) async -> PBEOwnerHTTPResponse

    private let expectedHost: String
    private let expectedOrigin: String
    private let handler: Handler

    public init(expectedHost: String, handler: @escaping Handler) {
        self.expectedHost = expectedHost
        self.expectedOrigin = "http://\(expectedHost)"
        self.handler = handler
    }

    public func dispatch(_ request: PBEOwnerHTTPRequest) async -> PBEOwnerHTTPResponse {
        guard request.headers["host"] == expectedHost else {
            return Self.error(403, "Forbidden", code: "host_mismatch")
        }
        guard let route = PBEOwnerNativeHostContract.route(
            method: request.method,
            path: request.path
        ) else {
            return Self.error(404, "Not Found", code: "route_not_found")
        }
        if request.method == "GET", !request.body.isEmpty {
            return Self.error(400, "Bad Request", code: "get_body_forbidden")
        }
        if request.method == "POST" {
            let contentType = request.headers["content-type"]?.lowercased() ?? ""
            guard contentType == "application/json"
                    || contentType.hasPrefix("application/json;") else {
                return Self.error(415, "Unsupported Media Type", code: "json_required")
            }
            if route.authority == .browserHandoff || route.authority == .browserSession {
                guard request.headers["origin"] == expectedOrigin else {
                    return Self.error(403, "Forbidden", code: "origin_mismatch")
                }
            }
        }
        return await handler(request, route)
    }

    public static func parserError(_ error: PBEOwnerHTTPRequestParserError) -> PBEOwnerHTTPResponse {
        switch error {
        case .unsupportedMethod:
            Self.error(405, "Method Not Allowed", code: "method_not_allowed")
        case .headTooLarge, .bodyTooLarge:
            Self.error(413, "Content Too Large", code: "request_too_large")
        case .unsupportedTransferEncoding:
            Self.error(400, "Bad Request", code: "transfer_encoding_forbidden")
        case .duplicateSensitiveHeader:
            Self.error(400, "Bad Request", code: "duplicate_sensitive_header")
        case .incomplete, .malformed, .bodyLengthMismatch:
            Self.error(400, "Bad Request", code: "malformed_request")
        }
    }

    private static func error(
        _ statusCode: Int,
        _ reasonPhrase: String,
        code: String
    ) -> PBEOwnerHTTPResponse {
        let escaped = code.replacingOccurrences(of: "\"", with: "\\\"")
        return .json(
            statusCode: statusCode,
            reasonPhrase: reasonPhrase,
            body: Data("{\"ok\":false,\"error\":{\"code\":\"\(escaped)\"}}".utf8)
        )
    }
}
