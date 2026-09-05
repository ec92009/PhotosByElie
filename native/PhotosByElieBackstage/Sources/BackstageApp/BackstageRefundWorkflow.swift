import Combine
import Foundation
import OwnerCore

/// Owns refund inputs, reconciliation and confirmation. The app coordinator
/// supplies cross-workflow admission and authentication recovery.
@MainActor
final class BackstageRefundWorkflow: ObservableObject {
    @Published var paidOrderRefundOrderID = ""
    @Published var paidOrderRefundReason = ""
    @Published private(set) var paidOrderRefundPreview: PaidOrderRefundPreview?
    @Published private(set) var paidOrderRefundStatus = "Enter an order ID to reconcile it with Stripe before refunding."
    @Published private(set) var isReconcilingPaidOrderRefund = false
    @Published private(set) var isPaidOrderRefundConfirmationPresented = false

    private let api: OwnerAPIClient
    var recoverFailure: @MainActor (Error) async -> String = { $0.localizedDescription }

    init(api: OwnerAPIClient) { self.api = api }

    func startPaidOrderRefundPreview() {
        guard let orderID = beginPaidOrderRefundPreview() else { return }
        Task { await reconcilePaidOrderRefund(orderID: orderID) }
    }

    func previewPaidOrderRefund() async {
        guard let orderID = beginPaidOrderRefundPreview() else { return }
        await reconcilePaidOrderRefund(orderID: orderID)
    }

    private func beginPaidOrderRefundPreview() -> String? {
        guard !isReconcilingPaidOrderRefund else { return nil }
        let orderID = paidOrderRefundOrderID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !orderID.isEmpty else {
            paidOrderRefundPreview = nil
            paidOrderRefundStatus = "Enter the exact PBE order ID first."
            return nil
        }
        isReconcilingPaidOrderRefund = true
        isPaidOrderRefundConfirmationPresented = false
        paidOrderRefundPreview = nil
        paidOrderRefundStatus = "Reconciling the order, payment, refund, and download state with Stripe…"
        return orderID
    }

    private func reconcilePaidOrderRefund(orderID: String) async {
        defer { isReconcilingPaidOrderRefund = false }
        do {
            let preview = try await api.previewPaidOrderRefund(orderId: orderID)
            guard paidOrderRefundOrderID.trimmingCharacters(in: .whitespacesAndNewlines) == orderID else {
                paidOrderRefundStatus = "Order changed. Check the new order before continuing."
                return
            }
            paidOrderRefundPreview = preview
            paidOrderRefundStatus = preview.eligible
                ? "Verified paid order. No download entitlement has been issued; a full refund is available."
                : (preview.ineligibleReason ?? "This order is not eligible for a pre-delivery refund.")
        } catch {
            let message = await recoverFailure(error)
            paidOrderRefundPreview = nil
            paidOrderRefundStatus = "Refund check failed: \(message)"
        }
    }

    func requestPaidOrderRefundConfirmation() {
        guard !isReconcilingPaidOrderRefund,
              paidOrderRefundPreview?.eligible == true,
              paidOrderRefundPreview?.orderId == paidOrderRefundOrderID.trimmingCharacters(in: .whitespacesAndNewlines),
              !paidOrderRefundReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        isPaidOrderRefundConfirmationPresented = true
    }

    func cancelPaidOrderRefundConfirmation() {
        isPaidOrderRefundConfirmationPresented = false
    }

    func confirmPaidOrderRefund() {
        guard isPaidOrderRefundConfirmationPresented, !isReconcilingPaidOrderRefund else { return }
        let orderID = paidOrderRefundOrderID.trimmingCharacters(in: .whitespacesAndNewlines)
        let reason = paidOrderRefundReason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard paidOrderRefundPreview?.eligible == true,
              paidOrderRefundPreview?.orderId == orderID, !reason.isEmpty else { return }
        isPaidOrderRefundConfirmationPresented = false
        isReconcilingPaidOrderRefund = true
        paidOrderRefundStatus = "Submitting the confirmed full refund to Stripe…"
        Task { await refundPaidOrder(orderID: orderID, reason: reason) }
    }

    private func refundPaidOrder(orderID: String, reason: String) async {
        defer { isReconcilingPaidOrderRefund = false }
        do {
            let result = try await api.refundPaidOrder(
                orderId: orderID,
                confirmationOrderId: orderID,
                reason: reason
            )
            guard paidOrderRefundOrderID.trimmingCharacters(in: .whitespacesAndNewlines) == orderID else {
                paidOrderRefundPreview = nil
                paidOrderRefundStatus = "Refund response received for \(orderID). Check the selected order separately."
                return
            }
            paidOrderRefundPreview = result
            paidOrderRefundStatus = result.refundStatus == "succeeded"
                ? "Stripe confirmed the full refund. Delivery and downloads are permanently blocked."
                : "Refund status: \(result.refundStatus). Refresh this order to reconcile again."
        } catch {
            let message = await recoverFailure(error)
            paidOrderRefundPreview = nil
            paidOrderRefundStatus = "Refund request failed: \(message). Check with Stripe before retrying."
        }
    }

}
