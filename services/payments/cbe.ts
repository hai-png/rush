import { loadEnv } from '@addis/shared';
import type { PaymentProvider, PaymentIntent, CheckoutResult, PaymentStatusResult, RefundRequest, RefundResult, WebhookEvent } from './provider';

/** Manual bank-transfer reconciliation — no live API. Admin verifies via UI. */
export class CbeBirrProvider implements PaymentProvider {
  readonly name = 'cbe' as const;
  private env = loadEnv();

  async createCheckout(intent: PaymentIntent): Promise<CheckoutResult> {
    return {
      status: 'manual',
      instructions: {
        accountNumber: this.env.CBE_ACCOUNT_NUMBER ?? '',
        accountName: this.env.CBE_ACCOUNT_NAME ?? '',
        bankBranch: this.env.CBE_BANK_BRANCH ?? '',
        reference: `CBE${intent.merchOrderId.slice(0, 24)}`,
        amount: intent.amount.toString(),
      },
    };
  }
  async verifyPayment(): Promise<PaymentStatusResult> { return { status: 'pending' }; }
  async refund(_req: RefundRequest): Promise<RefundResult> {
    return { status: 'failed', error: 'CBE refunds require manual bank reversal by admin', permanent: true };
  }
  async parseWebhook(): Promise<WebhookEvent> { throw new Error('CBE has no live webhook in v1'); }
}
