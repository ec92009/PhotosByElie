import Foundation
import Security

public protocol CredentialVault: Sendable {
    func read(account: String) throws -> Data?
    func write(_ data: Data, account: String) throws
    func delete(account: String) throws
}

public enum KeychainVaultError: Error, Equatable {
    case unexpectedStatus(OSStatus)
}

public struct KeychainVault: CredentialVault {
    public let service: String

    public init(service: String = "com.photosbyelie.backstage") {
        self.service = service
    }

    public func read(account: String) throws -> Data? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainVaultError.unexpectedStatus(status) }
        return item as? Data
    }

    public func write(_ data: Data, account: String) throws {
        let query = baseQuery(account: account)
        let attributes = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainVaultError.unexpectedStatus(updateStatus)
        }
        var newItem = query
        newItem[kSecValueData as String] = data
        let addStatus = SecItemAdd(newItem as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw KeychainVaultError.unexpectedStatus(addStatus) }
    }

    public func delete(account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainVaultError.unexpectedStatus(status)
        }
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
    }
}

public struct OwnerCredentialSet: Codable, Sendable, Equatable {
    public var deviceId: String
    public var deviceCredential: String?
    public var accessToken: String?
    public var accessExpiresAt: Date?
}

public actor OwnerCredentialSession {
    public static let account = "owner-session-v1"

    private let vault: CredentialVault
    private let encoder = JSONEncoder.ownerAPI
    private let decoder = JSONDecoder.ownerAPI

    public init(vault: CredentialVault = KeychainVault()) {
        self.vault = vault
    }

    public func load() throws -> OwnerCredentialSet? {
        guard let data = try vault.read(account: Self.account) else { return nil }
        return try decoder.decode(OwnerCredentialSet.self, from: data)
    }

    public func save(_ credentials: OwnerCredentialSet) throws {
        try vault.write(try encoder.encode(credentials), account: Self.account)
    }

    public func clear() throws {
        try vault.delete(account: Self.account)
    }
}
