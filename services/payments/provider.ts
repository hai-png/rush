import type { Money, PaymentMethod } from '@addis/shared';

export type PaymentIntent = {
  merchOrderId: string; amount: Money; description: string;
  notifyUrl: string; redirectUrl: string;
};
export type BankTransferInstructions = { accountNumber: string; accountName: string; bankBranch: string; reference: string; amount: string };
export type CheckoutResult =
  | { status: 'checkout'; checkoutUrl: string; prepayId: string }
  | { status: 'manual'; instructions: BankTransferInstructions };
export type PaymentStatusResult = {
  status: 'pending' | 'completed' | 'failed';

  amount?: Money | undefined;
  raw?: unknown | undefined;
};
export type RefundRequest = { merchOrderId: string; refundRequestNo: string; amount: Money; reason: string };
export type RefundResult =
  | { status: 'succeeded' }
  | { status: 'processing'; retryAfterMs: number }
  | { status: 'failed'; error: string; permanent: boolean };
export type WebhookEvent =
  | { type: 'payment.settled'; merchOrderId: string; amount: Money; raw: unknown; signatureValid: boolean; timestampMs?: number }
  | { type: 'payment.failed'; merchOrderId: string; raw: unknown; signatureValid: boolean; timestampMs?: number }
  | { type: 'refund.succeeded'; refundRequestNo: string; raw: unknown; signatureValid: boolean; timestampMs?: number }
  | { type: 'refund.failed'; refundRequestNo: string; raw: unknown; signatureValid: boolean; timestampMs?: number };

export interface PaymentProvider {
  readonly name: PaymentMethod;
  createCheckout(intent: PaymentIntent): Promise<CheckoutResult>;
  verifyPayment(reference: string): Promise<PaymentStatusResult>;
  refund(req: RefundRequest): Promise<RefundResult>;
  parseWebhook(req: Request): Promise<WebhookEvent>;
}
