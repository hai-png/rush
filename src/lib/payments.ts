// Payment provider abstraction. Real Telebirr is used when creds are configured;
// otherwise a mock provider returns a fake checkout URL pointing at /telebirr-stub
// which simulates the redirect and fires the real webhook handler.
// CBE is manual bank transfer (no API).

import { Money } from '@/lib/money';
import { loadEnv } from '@/lib/env';
import { createSign, createVerify } from 'node:crypto';

export type PaymentIntent = {
  merchOrderId: string;
  amount: Money;
  description: string;
  notifyUrl: string;
  redirectUrl: string;
};

export type CheckoutResult =
  | { status: 'checkout'; checkoutUrl: string; prepayId?: string }
  | { status: 'manual'; instructions: string };

export type PaymentStatusResult = {
  status: 'pending' | 'completed' | 'failed';
  amount?: Money;
  raw?: unknown;
};

export type RefundRequest = {
  merchOrderId: string;
  refundRequestNo: string;
  amount: Money;
  reason: string;
};

export type RefundResult =
  | { status: 'succeeded' }
  | { status: 'processing'; retryAfterMs?: number }
  | { status: 'failed'; error: string; permanent: boolean };

export type WebhookEvent =
  | { type: 'payment.settled'; merchOrderId: string; amount?: Money; raw: unknown; signatureValid: boolean; timestampMs: number }
  | { type: 'payment.failed'; merchOrderId: string; raw: unknown; signatureValid: boolean; timestampMs: number }
  | { type: 'refund.succeeded'; refundRequestNo: string; raw: unknown; signatureValid: boolean; timestampMs: number }
  | { type: 'refund.failed'; refundRequestNo: string; raw: unknown; signatureValid: boolean; timestampMs: number };

export interface PaymentProvider {
  readonly name: 'telebirr' | 'cbe';
  createCheckout(intent: PaymentIntent): Promise<CheckoutResult>;
  verifyPayment?(reference: string): Promise<PaymentStatusResult>;
  refund?(req: RefundRequest): Promise<RefundResult>;
  parseWebhook?(req: Request): Promise<WebhookEvent>;
}

// ─── Mock Telebirr ──────────────────────────────────────────────────────────
// Returns a checkout URL pointing at /telebirr-stub?order=<merchOrderId>. The
// stub page simulates the user paying and POSTs to the real webhook endpoint.
class MockTelebirrProvider implements PaymentProvider {
  readonly name = 'telebirr' as const;
  async createCheckout(intent: PaymentIntent): Promise<CheckoutResult> {
    const url = new URL('/telebirr-stub', loadEnv().APP_BASE_URL);
    url.searchParams.set('order', intent.merchOrderId);
    url.searchParams.set('amount', intent.amount.toDecimalString());
    url.searchParams.set('title', intent.description);
    return { status: 'checkout', checkoutUrl: url.toString(), prepayId: `mock-${intent.merchOrderId}` };
  }
  async verifyPayment(reference: string): Promise<PaymentStatusResult> {
    // The mock doesn't have a query endpoint — settlements come via webhook only.
    return { status: 'pending' };
  }
  async refund(req: RefundRequest): Promise<RefundResult> {
    // Mock always succeeds immediately.
    console.log(`[MockTelebirr] refund ${req.refundRequestNo} for ${req.merchOrderId}: ${req.amount.toString()} — ${req.reason}`);
    return { status: 'succeeded' };
  }
  async parseWebhook(req: Request): Promise<WebhookEvent> {
    const raw = await req.text();
    let payload: any;
    try { payload = JSON.parse(raw); } catch { throw new Error('Invalid telebirr webhook JSON'); }

    const timestampMs = typeof payload.timestamp === 'number'
      ? payload.timestamp
      : typeof payload.timestamp === 'string' && payload.timestamp.trim() !== '' && !isNaN(Number(payload.timestamp))
        ? Number(payload.timestamp)
        : Date.now();
    if (Date.now() - timestampMs > 5 * 60_000) {
      throw new Error('Telebirr webhook timestamp too old (replay suspected)');
    }

    // Mock signatures are always considered valid (the stub page generates them).
    const signatureValid = payload.sign === 'mock-signature';

    if (payload.refund_request_no) {
      return payload.trade_status === 'Success'
        ? { type: 'refund.succeeded', refundRequestNo: payload.refund_request_no, raw: payload, signatureValid, timestampMs }
        : { type: 'refund.failed', refundRequestNo: payload.refund_request_no, raw: payload, signatureValid, timestampMs };
    }
    return payload.trade_status === 'Success'
      ? { type: 'payment.settled', merchOrderId: payload.merch_order_id, amount: Money.fromETBString(payload.total_amount), raw: payload, signatureValid, timestampMs }
      : { type: 'payment.failed', merchOrderId: payload.merch_order_id, raw: payload, signatureValid, timestampMs };
  }
}

// ─── Real Telebirr ──────────────────────────────────────────────────────────
class TelebirrProvider implements PaymentProvider {
  readonly name = 'telebirr' as const;
  private env = loadEnv();
  private base = this.env.TELEBIRR_ENV === 'production'
    ? 'https://superapp.ethiomobilemoney.et'
    : 'https://developerportal.ethiotelebirr.et';

  private canonicalize(payload: Record<string, unknown>): string {
    return Object.keys(payload).filter(k => k !== 'sign').sort().map(k => `${k}=${JSON.stringify(payload[k])}`).join('&');
  }

  private sign(payload: Record<string, unknown>): string {
    
    const signer = createSign('RSA-SHA256');
    signer.update(this.canonicalize(payload));
    return signer.sign(this.env.TELEBIRR_PRIVATE_KEY, 'base64');
  }

  private async applyFabricToken(): Promise<string> {
    const res = await fetch(`${this.base}/hcp/fabric/accessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.env.TELEBIRR_FABRIC_APP_ID, appSecret: this.env.TELEBIRR_APP_SECRET }),
    });
    if (!res.ok) throw new Error(`telebirr token request failed: ${res.status}`);
    const json = await res.json();
    return json.token as string;
  }

  async createCheckout(intent: PaymentIntent): Promise<CheckoutResult> {
    const token = await this.applyFabricToken();
    const body = {
      merch_order_id: intent.merchOrderId,
      merchant_app_id: this.env.TELEBIRR_MERCHANT_APP_ID,
      merchant_code: this.env.TELEBIRR_MERCHANT_CODE,
      title: intent.description,
      total_amount: intent.amount.toDecimalString(),
      trans_currency: 'ETB',
      trade_type: 'Web',
      timeout_express: '120m',
      business_type: 'BuyGoods',
      payee_identifier_type: '04',
      notify_url: intent.notifyUrl,
      redirect_url: intent.redirectUrl,
    };
    const sign = this.sign(body);
    const res = await fetch(`${this.base}/payment/v1/merchant/createOrder`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, sign }),
    });
    if (!res.ok) throw new Error(`telebirr createOrder failed: ${res.status}`);
    const json = await res.json();
    return { status: 'checkout', checkoutUrl: json.checkoutUrl, prepayId: json.prepayId };
  }

  async verifyPayment(reference: string): Promise<PaymentStatusResult> {
    const token = await this.applyFabricToken();
    const res = await fetch(`${this.base}/payment/v1/merchant/queryOrder?merch_order_id=${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { status: 'pending' };
    const json = await res.json();
    const status = json.trade_status === 'Success' ? 'completed' : json.trade_status === 'Fail' ? 'failed' : 'pending';
    const amountStr = json.total_amount ?? json.trade_amount ?? json.amount;
    const amount = typeof amountStr === 'string' ? Money.fromETBString(amountStr) : undefined;
    return { status, amount, raw: json };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const token = await this.applyFabricToken();
    const body = {
      merch_order_id: req.merchOrderId,
      refund_request_no: req.refundRequestNo,
      refund_amount: req.amount.toDecimalString(),
      reason: req.reason,
    };
    const sign = this.sign(body);
    try {
      const res = await fetch(`${this.base}/payment/v1/merchant/refundOrder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, sign }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.code === 'SUCCESS') return { status: 'succeeded' };
      if (json.code === 'REFUND_DUPLICATED') return { status: 'succeeded' };
      if (json.code === 'REFUND_PROCESSING') return { status: 'processing', retryAfterMs: 15 * 60_000 };
      const permanent = json.code === 'INSUFFICIENT_BALANCE' || json.code === 'ACCOUNT_FROZEN';
      return { status: 'failed', error: json.message ?? `HTTP ${res.status}`, permanent };
    } catch (e) {
      return { status: 'failed', error: (e as Error).message, permanent: false };
    }
  }

  async parseWebhook(req: Request): Promise<WebhookEvent> {
    
    const raw = await req.text();
    let payload: any;
    try { payload = JSON.parse(raw); } catch { throw new Error('Invalid telebirr webhook JSON'); }

    const timestampMs = typeof payload.timestamp === 'number'
      ? payload.timestamp
      : typeof payload.timestamp === 'string' && payload.timestamp.trim() !== '' && !isNaN(Number(payload.timestamp))
        ? Number(payload.timestamp)
        : undefined;
    if (timestampMs === undefined) {
      throw new Error('Telebirr webhook missing numeric timestamp — possible replay');
    }
    if (Date.now() - timestampMs > 5 * 60_000) {
      throw new Error('Telebirr webhook timestamp too old (replay suspected)');
    }

    let signatureValid = false;
    if (typeof payload.sign === 'string' && payload.sign) {
      const verifier = createVerify('RSA-SHA256');
      verifier.update(this.canonicalize(payload));
      try {
        signatureValid = verifier.verify(this.env.TELEBIRR_PUBLIC_KEY, payload.sign, 'base64');
      } catch {
        signatureValid = false;
      }
    }

    if (payload.refund_request_no) {
      return payload.trade_status === 'Success'
        ? { type: 'refund.succeeded', refundRequestNo: payload.refund_request_no, raw: payload, signatureValid, timestampMs }
        : { type: 'refund.failed', refundRequestNo: payload.refund_request_no, raw: payload, signatureValid, timestampMs };
    }
    return payload.trade_status === 'Success'
      ? { type: 'payment.settled', merchOrderId: payload.merch_order_id, amount: Money.fromETBString(payload.total_amount), raw: payload, signatureValid, timestampMs }
      : { type: 'payment.failed', merchOrderId: payload.merch_order_id, raw: payload, signatureValid, timestampMs };
  }
}

// ─── CBE manual bank transfer ───────────────────────────────────────────────
class CbeProvider implements PaymentProvider {
  readonly name = 'cbe' as const;
  async createCheckout(intent: PaymentIntent): Promise<CheckoutResult> {
    const env = loadEnv();
    const instructions = [
      `Transfer exactly ${intent.amount.toString()} to:`,
      `  Account: ${env.CBE_ACCOUNT_NUMBER || '(not configured)'}`,
      `  Name: ${env.CBE_ACCOUNT_NAME || '(not configured)'}`,
      `  Branch: ${env.CBE_BANK_BRANCH || '(not configured)'}`,
      `  Reference: ${intent.merchOrderId}`,
      ``,
      `After transferring, your payment will be reconciled manually within 1 business day.`,
    ].join('\n');
    return { status: 'manual', instructions };
  }
}

// ─── Registry ───────────────────────────────────────────────────────────────
let cachedProviders: Record<string, PaymentProvider> | null = null;
export function getPaymentProvider(method: 'telebirr' | 'cbe'): PaymentProvider {
  if (!cachedProviders) {
    const env = loadEnv();
    cachedProviders = {
      telebirr: env.TELEBIRR_ENV === 'mock' ? new MockTelebirrProvider() : new TelebirrProvider(),
      cbe: new CbeProvider(),
    };
  }
  return cachedProviders[method]!;
}
