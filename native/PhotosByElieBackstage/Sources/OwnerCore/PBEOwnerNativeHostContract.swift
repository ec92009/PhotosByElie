import Foundation

public enum PBEOwnerNativeHostHTTPMethod: String, Sendable, Equatable {
    case get = "GET"
    case post = "POST"
}

public enum PBEOwnerNativeHostAuthority: String, Sendable, Equatable {
    case hostBootstrap
    case hostAuthorization
    case backstageSession
    case browserHandoff
    case browserSession
}

public struct PBEOwnerNativeHostRoute: Sendable, Equatable {
    public var method: PBEOwnerNativeHostHTTPMethod
    public var path: String
    public var authority: PBEOwnerNativeHostAuthority
    public var isPrefix: Bool

    public init(
        _ method: PBEOwnerNativeHostHTTPMethod,
        _ path: String,
        authority: PBEOwnerNativeHostAuthority,
        isPrefix: Bool = false
    ) {
        self.method = method
        self.path = path
        self.authority = authority
        self.isPrefix = isPrefix
    }

    public func matches(method requestedMethod: String, path requestedPath: String) -> Bool {
        guard method.rawValue == requestedMethod.uppercased() else { return false }
        return isPrefix ? requestedPath.hasPrefix(path) : requestedPath == path
    }
}

/// The deliberately small HTTP surface needed by the Backstage-launched PBE
/// Owner gallery. Legacy local Owner, import, R2, publication, and repair
/// endpoints are intentionally absent and must not be copied into the native
/// host as part of PBB-114.
public enum PBEOwnerNativeHostContract {
    public static let routes: [PBEOwnerNativeHostRoute] = [
        .init(.post, "/__photosbyelie/pbe-owner/host/bootstrap", authority: .hostBootstrap),
        .init(.get, "/__photosbyelie/pbe-owner/readiness", authority: .hostAuthorization),
        .init(.post, "/__photosbyelie/pbe-owner/session/start", authority: .backstageSession),
        .init(.post, "/__photosbyelie/pbe-owner/browser/bootstrap", authority: .browserHandoff),
        .init(.get, "/__photosbyelie/pbe-owner/session", authority: .browserSession),
        .init(.post, "/__photosbyelie/pbe-owner/session/heartbeat", authority: .browserSession),
        .init(.post, "/__photosbyelie/pbe-owner/session/close", authority: .browserSession),
        .init(.get, "/__photosbyelie/pbe-owner/gallery", authority: .browserSession),
        .init(.post, "/__photosbyelie/pbe-owner/action", authority: .browserSession),
        .init(.get, "/__photosbyelie/pbe-owner/action/status", authority: .browserSession),
        .init(.get, "/__photosbyelie/source-preview/", authority: .browserSession, isPrefix: true),
    ]

    public static func route(method: String, path: String) -> PBEOwnerNativeHostRoute? {
        routes.first { $0.matches(method: method, path: path) }
    }
}
