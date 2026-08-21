import Foundation

public struct PBEOwnerHTTPRequest: Sendable, Equatable {
    public var method: String
    public var target: String
    public var path: String
    public var headers: [String: String]
    public var body: Data
}

public enum PBEOwnerHTTPRequestParserError: Error, Sendable, Equatable {
    case incomplete
    case headTooLarge
    case malformed
    case unsupportedMethod
    case unsupportedTransferEncoding
    case duplicateSensitiveHeader(String)
    case bodyTooLarge
    case bodyLengthMismatch
}

public struct PBEOwnerHTTPRequestParser: Sendable {
    public var maximumHeadBytes: Int
    public var maximumBodyBytes: Int
    public var maximumHeaderCount: Int

    public init(
        maximumHeadBytes: Int = 32 * 1024,
        maximumBodyBytes: Int = 5 * 1024 * 1024,
        maximumHeaderCount: Int = 64
    ) {
        self.maximumHeadBytes = maximumHeadBytes
        self.maximumBodyBytes = maximumBodyBytes
        self.maximumHeaderCount = maximumHeaderCount
    }

    public func parse(_ data: Data) throws -> PBEOwnerHTTPRequest {
        let marker = Data("\r\n\r\n".utf8)
        guard let boundary = data.range(of: marker) else {
            if data.count > maximumHeadBytes { throw PBEOwnerHTTPRequestParserError.headTooLarge }
            throw PBEOwnerHTTPRequestParserError.incomplete
        }
        guard boundary.lowerBound <= maximumHeadBytes,
              let head = String(data: data[..<boundary.lowerBound], encoding: .utf8)
        else { throw PBEOwnerHTTPRequestParserError.headTooLarge }
        let lines = head.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { throw PBEOwnerHTTPRequestParserError.malformed }
        let requestParts = requestLine.split(separator: " ", omittingEmptySubsequences: false)
        guard requestParts.count == 3, requestParts[2] == "HTTP/1.1" else {
            throw PBEOwnerHTTPRequestParserError.malformed
        }
        let method = String(requestParts[0]).uppercased()
        guard method == "GET" || method == "POST" else {
            throw PBEOwnerHTTPRequestParserError.unsupportedMethod
        }
        let target = String(requestParts[1])
        guard target.hasPrefix("/"), !target.contains("\0"),
              let components = URLComponents(string: "http://127.0.0.1\(target)"),
              let path = components.percentEncodedPath.removingPercentEncoding
        else { throw PBEOwnerHTTPRequestParserError.malformed }
        guard lines.count - 1 <= maximumHeaderCount else {
            throw PBEOwnerHTTPRequestParserError.malformed
        }
        let sensitive = Set([
            "authorization", "content-length", "content-type", "cookie", "host",
            "idempotency-key", "origin", "x-pbe-host-authorization", "x-pbe-host-bootstrap",
        ])
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard !line.hasPrefix(" "), !line.hasPrefix("\t"),
                  let separator = line.firstIndex(of: ":") else {
                throw PBEOwnerHTTPRequestParserError.malformed
            }
            let name = String(line[..<separator]).lowercased()
            guard !name.isEmpty,
                  name.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || $0 == "-" })
            else { throw PBEOwnerHTTPRequestParserError.malformed }
            if sensitive.contains(name), headers[name] != nil {
                throw PBEOwnerHTTPRequestParserError.duplicateSensitiveHeader(name)
            }
            headers[name] = String(line[line.index(after: separator)...])
                .trimmingCharacters(in: .whitespaces)
        }
        guard headers["transfer-encoding"] == nil else {
            throw PBEOwnerHTTPRequestParserError.unsupportedTransferEncoding
        }
        let length: Int
        if let raw = headers["content-length"] {
            guard let parsed = Int(raw), parsed >= 0 else { throw PBEOwnerHTTPRequestParserError.malformed }
            length = parsed
        } else {
            length = 0
        }
        guard length <= maximumBodyBytes else { throw PBEOwnerHTTPRequestParserError.bodyTooLarge }
        let body = Data(data[boundary.upperBound...])
        guard body.count == length else { throw PBEOwnerHTTPRequestParserError.bodyLengthMismatch }
        return PBEOwnerHTTPRequest(method: method, target: target, path: path, headers: headers, body: body)
    }
}
