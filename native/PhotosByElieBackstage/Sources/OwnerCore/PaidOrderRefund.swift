import Foundation

public struct PaidOrderRefundFailure: Codable, Equatable, Sendable {
    public let code: String
    public let message: String
}

public struct PaidOrderRefundPreview: Codable, Equatable, Sendable {
    public let orderId: String
    public let amount: Int
    public let currency: String
    public let paymentStatus: String
    public let deliveryState: String
    public let entitlementState: String
    public let refundStatus: String
    public let refundId: String?
    public let eligible: Bool
    public let ineligibleReason: String?
    public let consequence: String
    public let updatedAt: Date?
    public let failure: PaidOrderRefundFailure?
}

public struct PaidOrderRefundEnvelope: Codable, Equatable, Sendable {
    public let refund: PaidOrderRefundPreview
}

public struct PaidOrderRefundRequest: Codable, Equatable, Sendable {
    public let confirmationOrderId: String
    public let reason: String

    public init(confirmationOrderId: String, reason: String) {
        self.confirmationOrderId = confirmationOrderId
        self.reason = reason
    }
}
