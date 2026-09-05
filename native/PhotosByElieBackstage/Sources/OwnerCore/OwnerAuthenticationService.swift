import Foundation

public enum OwnerAuthenticationPhase: String, Codable, Sendable, Equatable {
    case needsEnrollment
    case renewalFailed
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
    case incompleteEnrollmentHandoff
}

public actor OwnerAuthenticationService {
    private let api: OwnerAPIClient
    private let session: OwnerCredentialSession
    private let renewalLeeway: TimeInterval
    private var recoveryTask: Task<OwnerAuthenticationSnapshot, Never>?
    private var recoveryHandlerInstalled = false
    private var persistenceFailureSnapshot: OwnerAuthenticationSnapshot?

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
        if let persistenceFailureSnapshot {
            return persistenceFailureSnapshot
        }
        let credentials: OwnerCredentialSet?
        do {
            credentials = try await session.load()
        } catch {
            return await snapshotForCredentialLoadFailure(error)
        }
        guard let credentials else {
            return OwnerAuthenticationSnapshot(phase: .needsEnrollment)
        }
        guard let deviceCredential = credentials.deviceCredential,
              !deviceCredential.isEmpty else {
            return OwnerAuthenticationSnapshot(
                phase: .needsEnrollment,
                deviceId: credentials.deviceId
            )
        }
        guard credentials.accessToken != nil,
              let accessExpiresAt = credentials.accessExpiresAt,
              accessExpiresAt > now else {
            return OwnerAuthenticationSnapshot(
                phase: .renewalFailed,
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
        await preparePhotosJobSession().phase == .authenticated
    }

    /// Renew before issuing a new bounded Photos capability, never while consuming one.
    public func preparePhotosJobSession() async -> OwnerAuthenticationSnapshot {
        await installRecoveryHandlerIfNeeded()
        if let recoveryTask {
            return await recoveryTask.value
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
        return snapshot
    }

    private func restore(
        now: Date,
        forceRenewal: Bool
    ) async -> OwnerAuthenticationSnapshot {
        let loadedCredentials: OwnerCredentialSet?
        do {
            loadedCredentials = try await session.load()
        } catch {
            return await snapshotForCredentialLoadFailure(error)
        }
        guard var credentials = loadedCredentials else {
            persistenceFailureSnapshot = nil
            await api.setAccessToken(nil)
            return OwnerAuthenticationSnapshot(phase: .needsEnrollment)
        }
        guard let deviceCredential = credentials.deviceCredential,
              !deviceCredential.isEmpty else {
            credentials.accessToken = nil
            credentials.accessExpiresAt = nil
            let snapshot = OwnerAuthenticationSnapshot(
                phase: .needsEnrollment,
                deviceId: credentials.deviceId
            )
            _ = await persist(credentials, failureSnapshot: snapshot)
            await api.setAccessToken(nil)
            return snapshot
        }
        if !forceRenewal,
           persistenceFailureSnapshot == nil,
           let accessToken = credentials.accessToken,
           let accessExpiresAt = credentials.accessExpiresAt,
           accessExpiresAt.timeIntervalSince(now) > renewalLeeway {
            await api.setAccessToken(accessToken)
            return snapshot(for: credentials)
        }
        do {
            let tokens = try await api.exchangeDeviceCredential(
                deviceId: credentials.deviceId,
                deviceCredential: deviceCredential
            )
            credentials = applying(tokens, to: credentials)
            let authenticated = snapshot(for: credentials)
            let renewalFailed = OwnerAuthenticationSnapshot(
                phase: .renewalFailed,
                deviceId: credentials.deviceId
            )
            guard await persist(credentials, failureSnapshot: renewalFailed) else {
                await api.setAccessToken(nil)
                return renewalFailed
            }
            await api.setAccessToken(tokens.accessToken)
            return authenticated
        } catch {
            credentials.accessToken = nil
            credentials.accessExpiresAt = nil
            let phase: OwnerAuthenticationPhase
            if Self.isRejectedDeviceCredential(error) {
                credentials.deviceCredential = nil
                phase = .needsEnrollment
            } else {
                phase = .renewalFailed
            }
            let snapshot = OwnerAuthenticationSnapshot(
                phase: phase,
                deviceId: credentials.deviceId
            )
            _ = await persist(credentials, failureSnapshot: snapshot)
            await api.setAccessToken(nil)
            return snapshot
        }
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
        persistenceFailureSnapshot = nil
        await api.setAccessToken(tokens.accessToken)
        return snapshot(for: credentials)
    }

    public func beginNativeEnrollment(
        name: String,
        platform: String = "macOS",
        binding: String = UUID().uuidString
    ) async throws -> OwnerEnrollmentHandoff {
        try await api.beginOwnerEnrollmentHandoff(
            name: name,
            platform: platform,
            binding: binding
        )
    }

    public func claimNativeEnrollment(
        _ handoff: OwnerEnrollmentHandoff
    ) async throws -> OwnerAuthenticationSnapshot? {
        let claim = try await api.claimOwnerEnrollmentHandoff(handoff)
        guard claim.state == "completed" else { return nil }
        guard let deviceId = claim.device?.id,
              let deviceCredential = claim.deviceCredential,
              !deviceCredential.isEmpty else {
            throw OwnerAuthenticationError.incompleteEnrollmentHandoff
        }
        let tokens = try await api.exchangeDeviceCredential(
            deviceId: deviceId,
            deviceCredential: deviceCredential
        )
        let credentials = applying(tokens, to: OwnerCredentialSet(
            deviceId: deviceId,
            deviceCredential: deviceCredential,
            accessToken: nil,
            accessExpiresAt: nil
        ))
        try await session.save(credentials)
        persistenceFailureSnapshot = nil
        await api.setAccessToken(tokens.accessToken)
        return snapshot(for: credentials)
    }

    public func cancelNativeEnrollment(_ handoff: OwnerEnrollmentHandoff) async {
        _ = try? await api.cancelOwnerEnrollmentHandoff(handoff)
    }

    public func signOut() async throws -> OwnerAuthenticationSnapshot {
        try await api.logout()
        try await session.clear()
        persistenceFailureSnapshot = nil
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

    private static func isRejectedDeviceCredential(_ error: Error) -> Bool {
        guard let envelope = error as? APIErrorEnvelope else { return false }
        return envelope.error.code == "owner_device_credential_invalid"
    }

    private func persist(
        _ credentials: OwnerCredentialSet,
        failureSnapshot: OwnerAuthenticationSnapshot
    ) async -> Bool {
        do {
            try await session.save(credentials)
            persistenceFailureSnapshot = nil
            return true
        } catch {
            persistenceFailureSnapshot = failureSnapshot
            return false
        }
    }

    private func snapshotForCredentialLoadFailure(
        _ error: Error
    ) async -> OwnerAuthenticationSnapshot {
        await api.setAccessToken(nil)
        if error is DecodingError {
            let snapshot = OwnerAuthenticationSnapshot(phase: .needsEnrollment)
            do {
                try await session.clear()
                persistenceFailureSnapshot = nil
            } catch {
                persistenceFailureSnapshot = snapshot
            }
            return snapshot
        }
        let snapshot = OwnerAuthenticationSnapshot(phase: .renewalFailed)
        persistenceFailureSnapshot = snapshot
        return snapshot
    }
}
