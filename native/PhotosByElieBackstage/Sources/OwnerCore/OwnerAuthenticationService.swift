import Foundation

public enum OwnerAuthenticationPhase: String, Codable, Sendable, Equatable {
    case needsEnrollment
    case authenticated
    case signedOut
}

public struct OwnerAuthenticationSnapshot: Sendable, Equatable {
    public var phase: OwnerAuthenticationPhase
    public var deviceId: String?
    public var accessExpiresAt: Date?

    public init(
        phase: OwnerAuthenticationPhase,
        deviceId: String? = nil,
        accessExpiresAt: Date? = nil
    ) {
        self.phase = phase
        self.deviceId = deviceId
        self.accessExpiresAt = accessExpiresAt
    }
}

public struct OwnerEnrollmentCode: Codable, Sendable, Equatable {
    public var deviceId: String
    public var deviceCredential: String

    public init(deviceId: String, deviceCredential: String) {
        self.deviceId = deviceId
        self.deviceCredential = deviceCredential
    }

    public static func decode(_ value: String) throws -> OwnerEnrollmentCode {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw OwnerAuthenticationError.invalidEnrollmentCode }
        let data: Data
        if trimmed.hasPrefix("{") {
            data = Data(trimmed.utf8)
        } else {
            var base64 = trimmed
                .replacingOccurrences(of: "-", with: "+")
                .replacingOccurrences(of: "_", with: "/")
            while base64.count.isMultiple(of: 4) == false { base64.append("=") }
            guard let decoded = Data(base64Encoded: base64) else {
                throw OwnerAuthenticationError.invalidEnrollmentCode
            }
            data = decoded
        }
        let result = try JSONDecoder.ownerAPI.decode(OwnerEnrollmentCode.self, from: data)
        guard result.deviceId.hasPrefix("owner-device-"),
              result.deviceId.count <= 96,
              result.deviceCredential.count >= 40,
              result.deviceCredential.count <= 256 else {
            throw OwnerAuthenticationError.invalidEnrollmentCode
        }
        return result
    }
}

public enum OwnerAuthenticationError: Error, Equatable {
    case invalidEnrollmentCode
}

public actor OwnerAuthenticationService {
    private let api: OwnerAPIClient
    private let session: OwnerCredentialSession
    private let renewalLeeway: TimeInterval
    private var recoveryTask: Task<OwnerAuthenticationSnapshot, Never>?
    private var recoveryHandlerInstalled = false

    public init(
        api: OwnerAPIClient,
        session: OwnerCredentialSession = OwnerCredentialSession(),
        renewalLeeway: TimeInterval = 90
    ) {
        self.api = api
        self.session = session
        self.renewalLeeway = renewalLeeway
    }

    public func bootstrap(now: Date = Date()) async -> OwnerAuthenticationSnapshot {
        await installRecoveryHandlerIfNeeded()
        return await restore(now: now, forceRenewal: false)
    }

    public func currentSnapshot(now: Date = Date()) async -> OwnerAuthenticationSnapshot {
        guard let credentials = try? await session.load() else {
            return OwnerAuthenticationSnapshot(phase: .needsEnrollment)
        }
        guard credentials.accessToken != nil,
              let accessExpiresAt = credentials.accessExpiresAt,
              accessExpiresAt > now else {
            return OwnerAuthenticationSnapshot(
                phase: .needsEnrollment,
                deviceId: credentials.deviceId
            )
        }
        return snapshot(for: credentials)
    }

    private func installRecoveryHandlerIfNeeded() async {
        guard !recoveryHandlerInstalled else { return }
        recoveryHandlerInstalled = true
        await api.setAuthenticationRecoveryHandler { [weak self] in
            guard let self else { return false }
            return await self.recoverRejectedSession()
        }
    }

    private func recoverRejectedSession() async -> Bool {
        if let recoveryTask {
            return await recoveryTask.value.phase == .authenticated
        }
        let task = Task { [weak self] in
            guard let self else {
                return OwnerAuthenticationSnapshot(phase: .needsEnrollment)
            }
            return await self.restore(now: Date(), forceRenewal: true)
        }
        recoveryTask = task
        let snapshot = await task.value
        recoveryTask = nil
        return snapshot.phase == .authenticated
    }

    private func restore(
        now: Date,
        forceRenewal: Bool
    ) async -> OwnerAuthenticationSnapshot {
        guard var credentials = try? await session.load() else {
            await api.setAccessToken(nil)
            return OwnerAuthenticationSnapshot(phase: .needsEnrollment)
        }
        if !forceRenewal,
           let accessToken = credentials.accessToken,
           let accessExpiresAt = credentials.accessExpiresAt,
           accessExpiresAt.timeIntervalSince(now) > renewalLeeway {
            await api.setAccessToken(accessToken)
            return snapshot(for: credentials)
        }
        if let deviceCredential = credentials.deviceCredential,
           let tokens = try? await api.exchangeDeviceCredential(
               deviceId: credentials.deviceId,
               deviceCredential: deviceCredential
           ) {
            credentials = applying(tokens, to: credentials)
            try? await session.save(credentials)
            await api.setAccessToken(tokens.accessToken)
            return snapshot(for: credentials)
        }
        credentials.accessToken = nil
        credentials.accessExpiresAt = nil
        try? await session.save(credentials)
        await api.setAccessToken(nil)
        return OwnerAuthenticationSnapshot(
            phase: .needsEnrollment,
            deviceId: credentials.deviceId
        )
    }

    public func enroll(code: String) async throws -> OwnerAuthenticationSnapshot {
        let enrollment = try OwnerEnrollmentCode.decode(code)
        let tokens = try await api.exchangeDeviceCredential(
            deviceId: enrollment.deviceId,
            deviceCredential: enrollment.deviceCredential
        )
        let credentials = applying(tokens, to: OwnerCredentialSet(
            deviceId: enrollment.deviceId,
            deviceCredential: enrollment.deviceCredential,
            accessToken: nil,
            accessExpiresAt: nil
        ))
        try await session.save(credentials)
        await api.setAccessToken(tokens.accessToken)
        return snapshot(for: credentials)
    }

    public func signOut() async throws -> OwnerAuthenticationSnapshot {
        try await api.logout()
        try await session.clear()
        await api.setAccessToken(nil)
        return OwnerAuthenticationSnapshot(phase: .signedOut)
    }

    private func applying(
        _ tokens: OwnerTokenBundle,
        to credentials: OwnerCredentialSet
    ) -> OwnerCredentialSet {
        var updated = credentials
        updated.accessToken = tokens.accessToken
        updated.accessExpiresAt = tokens.accessExpiresAt
        return updated
    }

    private func snapshot(for credentials: OwnerCredentialSet) -> OwnerAuthenticationSnapshot {
        OwnerAuthenticationSnapshot(
            phase: .authenticated,
            deviceId: credentials.deviceId,
            accessExpiresAt: credentials.accessExpiresAt
        )
    }
}
