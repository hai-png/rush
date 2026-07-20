import { createSign, createVerify } from 'node:crypto';
import { Money, loadEnv } from '@addis/shared';
import type { PaymentProvider, PaymentIntent, CheckoutResult, PaymentStatusResult, RefundRequest, RefundResult, WebhookEvent } from './provider';

const BASE_URLS = {
  testbed: 'https://developerportal.ethiotelebirr.et',
  production: 'https://superapp.ethiomobilemoney.et',
};

export class TelebirrProvider implements PaymentProvider {
  readonly name = 'telebirr' as const;
  private env = loadEnv();
  private base = BASE_URLS[this.env.TELEBIRR_ENV];
  private cfg = {
    timeoutExpress: '120m',
    businessType: 'BuyGoods',
    payeeIdentifierType: '04',
    tradeType: 'Web',
    currency: 'ETB',
    version: '1.0',
  };

  private canonicalize(payload: Record<string, unknown>): string {
    return Object.keys(payload).filter(k => k !== 'sign').sort().map(k => `${k}=${JSON.stringify(payload[k])}`).join('&');
  }

  private sign(payload: Record<string, unknown>): string {
    const signer = createSign('RSA-SHA256');
    signer.update(this.canonicalize(payload));
    return signer.sign(this.env.TELEBIRR_PRIVATE_KEY!, 'base64');
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
      total_amount: intent.amount.toString(),
      trans_currency: this.cfg.currency,
      trade_type: this.cfg.tradeType,
      timeout_express: this.cfg.timeoutExpress,
      business_type: this.cfg.businessType,
      payee_identifier_type: this.cfg.payeeIdentifierType,
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
      refund_amount: req.amount.toString(),
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
    try { payload = JSON.parse(raw); }
    catch { throw new Error('Invalid telebirr webhook JSON'); }

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
        signatureValid = verifier.verify(this.env.TELEBIRR_PUBLIC_KEY!, payload.sign, 'base64');
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
