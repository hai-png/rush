
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
  | { type: 'payment.settled'; merchOrderId: string; amount?: Money; raw: unknown; signatureValid: boolean; timestampMs: number; outRequestNo?: string; transId?: string }
  | { type: 'payment.failed'; merchOrderId: string; raw: unknown; signatureValid: boolean; timestampMs: number; outRequestNo?: string }
  | { type: 'refund.succeeded'; refundRequestNo: string; raw: unknown; signatureValid: boolean; timestampMs: number }
  | { type: 'refund.failed'; refundRequestNo: string; raw: unknown; signatureValid: boolean; timestampMs: number };

export type InAppCheckoutResult = {
  prepayId: string;
  receiveCode: string;
  merchOrderId: string;
};

export type MandateSignUrlResult = {
  mctContractNo: string; // 32-digit numeric, unique per subscription
  signUrl: string; // merchant:// deep link for the front-end SDK to invoke
};

export type MandateQueryResult = {
  status: 'active' | 'cancelled' | 'unknown';
  mandateTemplateId?: string;
  raw?: unknown;
};

export type DisburseResult =
  | { status: 'succeeded'; paymentOrderId: string }
  | { status: 'processing'; paymentOrderId?: string }
  | { status: 'failed'; error: string; permanent: boolean };

export interface PaymentProvider {
  readonly name: 'telebirr' | 'cbe';
  createCheckout(intent: PaymentIntent): Promise<CheckoutResult>;
  verifyPayment?(reference: string): Promise<PaymentStatusResult>;
  refund?(req: RefundRequest): Promise<RefundResult>;
  parseWebhook?(req: Request): Promise<WebhookEvent>;
  // InApp SDK (mobile only)
  createInAppOrder?(intent: PaymentIntent): Promise<InAppCheckoutResult>;
  // Subscription Payment
  buildMandateSignUrl?(opts: { mctContractNo: string; mandateTemplateId: string }): MandateSignUrlResult;
  queryMandate?(mctContractNo: string): Promise<MandateQueryResult>;
  cancelMandate?(mctContractNo: string): Promise<{ ok: boolean }>;
  disburse?(opts: { mctContractNo: string; merchOrderId: string; amount: Money; reason: string }): Promise<DisburseResult>;
}

class MockTelebirrProvider implements PaymentProvider {
  readonly name = 'telebirr' as const;
  async createCheckout(intent: PaymentIntent): Promise<CheckoutResult> {
    const url = new URL('/telebirr-stub', loadEnv().APP_BASE_URL);
    url.searchParams.set('order', intent.merchOrderId);
    url.searchParams.set('amount', intent.amount.toDecimalString());
    url.searchParams.set('title', intent.description);
    return { status: 'checkout', checkoutUrl: url.toString(), prepayId: `mock-${intent.merchOrderId}` };
  }
  async verifyPayment(_reference: string): Promise<PaymentStatusResult> {
    // The mock doesn't have a query endpoint — settlements come via webhook only.
    return { status: 'pending' };
  }
  async refund(req: RefundRequest): Promise<RefundResult> {
    // Mock always succeeds immediately.
    console.log(`[MockTelebirr] refund ${req.refundRequestNo} for ${req.merchOrderId}: ${req.amount.toString()} — ${req.reason}`);
    return { status: 'succeeded' };
  }
  async createInAppOrder(intent: PaymentIntent): Promise<InAppCheckoutResult> {
    // Mock returns the same shape as H5 checkout but with a receiveCode the
    console.log(`[MockTelebirr:InApp] createOrder for ${intent.merchOrderId}`);
    return {
      prepayId: `mock-inapp-${intent.merchOrderId}`,
      receiveCode: `RCV${Date.now()}`,
      merchOrderId: intent.merchOrderId,
    };
  }
  buildMandateSignUrl(opts: { mctContractNo: string; mandateTemplateId: string }): MandateSignUrlResult {
    // In mock mode, point at a local stub page that simulates the mandate-sign
    const env = loadEnv();
    const url = new URL('/telebirr-stub', env.APP_BASE_URL);
    url.searchParams.set('mandate', opts.mctContractNo);
    url.searchParams.set('template', opts.mandateTemplateId);
    return {
      mctContractNo: opts.mctContractNo,
      signUrl: url.toString(),
    };
  }
  async queryMandate(mctContractNo: string): Promise<MandateQueryResult> {
    console.log(`[MockTelebirr:Subscription] queryMandate ${mctContractNo}`);
    return { status: 'active' };
  }
  async cancelMandate(mctContractNo: string): Promise<{ ok: boolean }> {
    console.log(`[MockTelebirr:Subscription] cancelMandate ${mctContractNo}`);
    return { ok: true };
  }
  async disburse(opts: { mctContractNo: string; merchOrderId: string; amount: Money; reason: string }): Promise<DisburseResult> {
    console.log(`[MockTelebirr:Subscription] disburse ${opts.merchOrderId} for ${opts.mctContractNo}: ${opts.amount.toString()} — ${opts.reason}`);
    return { status: 'succeeded', paymentOrderId: `mock-disburse-${opts.merchOrderId}` };
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

    const signatureValid = payload.sign === 'mock-signature';
    const outRequestNo = payload.out_request_no ?? `orno-${Date.now()}`;

    if (payload.refund_request_no) {
      return payload.trade_status === 'Success'
        ? { type: 'refund.succeeded', refundRequestNo: payload.refund_request_no, raw: payload, signatureValid, timestampMs }
        : { type: 'refund.failed', refundRequestNo: payload.refund_request_no, raw: payload, signatureValid, timestampMs };
    }
    return payload.trade_status === 'Success'
      ? { type: 'payment.settled', merchOrderId: payload.merch_order_id, amount: Money.fromETBString(payload.total_amount), raw: payload, signatureValid, timestampMs, outRequestNo, transId: payload.trans_id }
      : { type: 'payment.failed', merchOrderId: payload.merch_order_id, raw: payload, signatureValid, timestampMs, outRequestNo };
  }
}

//   - Sort keys lexicographically, join as k=v&k=v
class TelebirrProvider implements PaymentProvider {
  readonly name = 'telebirr' as const;
  private env = loadEnv();

  private get apiBase(): string {
    return this.env.TELEBIRR_ENV === 'production'
      ? 'https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway'
      : 'https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway';
  }

  private get webBase(): string {
    // Testbed ends with `?` (the URL builder appends `&field=...`).
    return this.env.TELEBIRR_ENV === 'production'
      ? 'https://superapp.ethiomobilemoney.et:38443/payment/web/paygate?'
      : 'https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?';
  }

  // Excluded from signing per Telebirr docs. Note: `biz_content` is excluded
  private static EXCLUDE_FIELDS = new Set([
    'sign', 'sign_type', 'header', 'refund_info',
    'openType', 'raw_request', 'biz_content', 'wallet_reference_data',
  ]);

  private buildStringToSign(req: Record<string, any>): string {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(req)) {
      if (TelebirrProvider.EXCLUDE_FIELDS.has(k)) continue;
      if (v === undefined || v === null || v === '') continue;
      flat[k] = String(v);
    }
    // biz_content is excluded as a key, but its children are flattened + signed.
    const biz = req.biz_content;
    if (biz && typeof biz === 'object') {
      for (const [k, v] of Object.entries(biz)) {
        if (TelebirrProvider.EXCLUDE_FIELDS.has(k)) continue;
        if (v === undefined || v === null || v === '') continue;
        flat[k] = String(v);
      }
    }
    return Object.keys(flat)
      .sort()
      .map((k) => `${k}=${flat[k]}`)
      .join('&');
  }

  private signTelebirr(req: Record<string, any>): string {
    const data = this.buildStringToSign(req);
    return createSign('sha256')
      .update(data, 'utf8')
      .sign({
        key: this.env.TELEBIRR_PRIVATE_KEY,
        padding: 1, // RSA_PKCS1_PSS_PADDING
        saltLength: 0, // RSA_PSS_SALTLEN_DIGEST
      })
      .toString('base64');
  }

  private verifyTelebirr(payload: Record<string, any>, signatureBase64: string): boolean {
    const data = this.buildStringToSign(payload);
    try {
      return createVerify('sha256')
        .update(data, 'utf8')
        .verify({
          key: this.env.TELEBIRR_PUBLIC_KEY,
          padding: 1, // RSA_PKCS1_PSS_PADDING
          saltLength: 0,
        }, signatureBase64, 'base64');
    } catch {
      return false;
    }
  }

  private createNonceStr(): string {
    return randomUUID().replace(/-/g, '');
  }

  private createTimestamp(): string {
    return Math.floor(Date.now() / 1000).toString();
  }

  private cachedToken: { token: string; expiresAt: number } | null = null;

  private async applyFabricToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.token;
    }
    const res = await fetch(`${this.apiBase}/payment/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-APP-Key': this.env.TELEBIRR_FABRIC_APP_ID,
      },
      body: JSON.stringify({ appSecret: this.env.TELEBIRR_APP_SECRET }),
    });
    if (!res.ok) {
      throw new Error(`applyFabricToken HTTP ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as { token: string; expirationDate?: string };
    // expirationDate is yyyyMMddHHmmss; fall back to 1h if absent.
    const expiresAt = data.expirationDate ? this.parseTelebirrDate(data.expirationDate) : Date.now() + 3600_000;
    this.cachedToken = { token: data.token, expiresAt };
    return data.token;
  }

  private parseTelebirrDate(s: string): number {
    // yyyyMMddHHmmss -> epoch ms
    const y = +s.slice(0, 4);
    const mo = +s.slice(4, 6) - 1;
    const d = +s.slice(6, 8);
    const h = +s.slice(8, 10);
    const mi = +s.slice(10, 12);
    const se = +s.slice(12, 14);
    return Date.UTC(y, mo, d, h, mi, se);
  }

  private async callBusinessApi<T = any>(
    endpoint: string,
    bizContent: Record<string, any>,
    method: string,
  ): Promise<T> {
    const token = await this.applyFabricToken();
    const req: Record<string, any> = {
      timestamp: this.createTimestamp(),
      nonce_str: this.createNonceStr(),
      method,
      version: '1.0',
      biz_content: bizContent,
    };
    req.sign = this.signTelebirr(req);
    req.sign_type = 'SHA256WithRSA';

    const res = await fetch(`${this.apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-APP-Key': this.env.TELEBIRR_FABRIC_APP_ID,
        'Authorization': token, // already includes 'Bearer '
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      throw new Error(`Telebirr ${endpoint} HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async createCheckout(intent: PaymentIntent): Promise<CheckoutResult> {
    const bizContent = {
      appid: this.env.TELEBIRR_MERCHANT_APP_ID,
      merch_code: this.env.TELEBIRR_MERCHANT_CODE,
      merch_order_id: intent.merchOrderId,
      title: intent.description,
      total_amount: intent.amount.toDecimalString(),
      trans_currency: 'ETB',
      timeout_express: '120m',
      notify_url: intent.notifyUrl,
      redirect_url: intent.redirectUrl,
      payee_type: '5000', // H5 sample value; confirm with ET
    };

    const response = await this.callBusinessApi<{
      result: string;
      code: string;
      msg: string;
      biz_content: { prepay_id: string; merch_order_id: string };
      sign: string;
    }>('/payment/v1/merchant/preOrder', bizContent, 'payment.preorder');

    if (response.result !== 'SUCCESS' || response.code !== '0') {
      throw new Error(`Telebirr preOrder failed: ${response.msg} (code ${response.code})`);
    }

    const checkoutUrl = this.buildCheckoutUrl(response.biz_content.prepay_id, response.sign);
    return {
      status: 'checkout',
      checkoutUrl,
      prepayId: response.biz_content.prepay_id,
    };
  }

  private buildCheckoutUrl(prepayId: string, sign: string): string {
    // Per the docs, the checkout URL is the webBase + a sorted query string
    const timestamp = this.createTimestamp();
    const nonceStr = this.createNonceStr();
    const queryString = [
      `appid=${this.env.TELEBIRR_MERCHANT_APP_ID}`,
      `merch_code=${this.env.TELEBIRR_MERCHANT_CODE}`,
      `nonce_str=${nonceStr}`,
      `prepay_id=${prepayId}`,
      `timestamp=${timestamp}`,
      `sign=${sign}`,
      `sign_type=SHA256WithRSA`,
    ].join('&');
    return `${this.webBase}${queryString}&version=1.0&trade_type=Checkout`;
  }

  async createInAppOrder(intent: PaymentIntent): Promise<InAppCheckoutResult> {
    const bizContent = {
      appid: this.env.TELEBIRR_MERCHANT_APP_ID,
      merch_code: this.env.TELEBIRR_MERCHANT_CODE,
      merch_order_id: intent.merchOrderId,
      title: intent.description,
      total_amount: intent.amount.toDecimalString(),
      trans_currency: 'ETB',
      timeout_express: '120m',
      notify_url: intent.notifyUrl,
      payee_type: '3000', // InApp uses 3000 (H5 uses 5000) per docs
    };

    // Note: docs have an inconsistency — spec table says /payment/v1/inapp/createOrder,
    let response: any;
    try {
      response = await this.callBusinessApi<{
        result: string;
        code: string;
        msg: string;
        biz_content: { prepay_id: string; receive_code: string; merch_order_id: string };
      }>('/payment/v1/inapp/createOrder', bizContent, 'payment.inapp.createOrder');
    } catch (e) {
      // Fall back to the sample-code path on 404.
      response = await this.callBusinessApi<{
        result: string;
        code: string;
        msg: string;
        biz_content: { prepay_id: string; receive_code: string; merch_order_id: string };
      }>('/payment/v1/merchant/inapp/createOrder', bizContent, 'payment.inapp.createOrder');
    }

    if (response.result !== 'SUCCESS' || response.code !== '0') {
      throw new Error(`Telebirr InApp createOrder failed: ${response.msg} (code ${response.code})`);
    }

    return {
      prepayId: response.biz_content.prepay_id,
      receiveCode: response.biz_content.receive_code,
      merchOrderId: response.biz_content.merch_order_id,
    };
  }

  async verifyPayment(reference: string): Promise<PaymentStatusResult> {
    const bizContent = {
      appid: this.env.TELEBIRR_MERCHANT_APP_ID,
      merch_code: this.env.TELEBIRR_MERCHANT_CODE,
      merch_order_id: reference,
    };
    const response = await this.callBusinessApi<{
      result: string;
      code: string;
      msg: string;
      biz_content: {
        trade_status: string;
        total_amount?: string;
        trans_id?: string;
      };
    }>('/payment/v1/merchant/queryOrder', bizContent, 'payment.query');

    if (response.result !== 'SUCCESS') {
      return { status: 'pending', raw: response };
    }

    // ORDER_CLOSED, ACCEPTED, REFUNDING, REFUND_SUCCESS, REFUND_FAILED
    let status: 'pending' | 'completed' | 'failed' = 'pending';
    if (response.biz_content.trade_status === 'PAY_SUCCESS') status = 'completed';
    else if (response.biz_content.trade_status === 'PAY_FAILED' || response.biz_content.trade_status === 'ORDER_CLOSED') status = 'failed';

    const amount = response.biz_content.total_amount
      ? Money.fromETBString(response.biz_content.total_amount)
      : undefined;
    return { status, amount, raw: response };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const bizContent = {
      appid: this.env.TELEBIRR_MERCHANT_APP_ID,
      merch_code: this.env.TELEBIRR_MERCHANT_CODE,
      merch_order_id: req.merchOrderId,
      refund_request_no: req.refundRequestNo,
      refund_reason: req.reason,
      actual_amount: req.amount.toDecimalString(),
      trans_currency: 'ETB',
    };
    try {
      const response = await this.callBusinessApi<{
        result: string;
        code: string;
        msg: string;
        biz_content: {
          refund_status: string;
          refund_amount?: string;
        };
      }>('/payment/v1/merchant/refund', bizContent, 'payment.refund');

      if (response.result !== 'SUCCESS') {
        return { status: 'failed', error: response.msg || 'Unknown error', permanent: false };
      }

      const st = response.biz_content.refund_status;
      if (st === 'REFUND_SUCCESS' || st === 'REFUND_DUPLICATED') return { status: 'succeeded' };
      if (st === 'REFUNDING') return { status: 'processing', retryAfterMs: 15 * 60_000 };
      return {
        status: 'failed',
        error: `Refund ${st}`,
        permanent: st === 'REFUND_FAILED',
      };
    } catch (e) {
      return { status: 'failed', error: (e as Error).message, permanent: false };
    }
  }

  buildMandateSignUrl(opts: { mctContractNo: string; mandateTemplateId: string }): MandateSignUrlResult {
    const params = new URLSearchParams({
      mctShortCode: this.env.TELEBIRR_MERCHANT_CODE,
      mctContractNo: opts.mctContractNo,
      mandateTemplateId: opts.mandateTemplateId,
      thirdAppId: this.env.TELEBIRR_MERCHANT_APP_ID,
    });
    return {
      mctContractNo: opts.mctContractNo,
      signUrl: `merchant://10000000016?${params.toString()}`,
    };
  }

  async queryMandate(mctContractNo: string): Promise<MandateQueryResult> {
    const bizContent = {
      appid: this.env.TELEBIRR_MERCHANT_APP_ID,
      merch_code: this.env.TELEBIRR_MERCHANT_CODE,
      mct_contract_no: mctContractNo,
    };
    try {
      const response = await this.callBusinessApi<{
        result: string;
        code: string;
        msg: string;
        biz_content: {
          mandate_status?: string; // ACTIVE, CANCELLED, etc.
          mandate_template_id?: string;
        };
      }>('/payment/v1/mandates/query', bizContent, 'payment.queryMandate');

      if (response.result !== 'SUCCESS') {
        return { status: 'unknown', raw: response };
      }
      const st = (response.biz_content.mandate_status ?? '').toUpperCase();
      return {
        status: st === 'ACTIVE' ? 'active' : st === 'CANCELLED' ? 'cancelled' : 'unknown',
        mandateTemplateId: response.biz_content.mandate_template_id,
        raw: response,
      };
    } catch (e) {
      return { status: 'unknown', raw: { error: (e as Error).message } };
    }
  }

  async cancelMandate(mctContractNo: string): Promise<{ ok: boolean }> {
    const bizContent = {
      appid: this.env.TELEBIRR_MERCHANT_APP_ID,
      merch_code: this.env.TELEBIRR_MERCHANT_CODE,
      mct_contract_no: mctContractNo,
    };
    try {
      const response = await this.callBusinessApi<{
        result: string;
        code: string;
        msg: string;
      }>('/payment/v1/mandateContract/cancel', bizContent, 'payment.cancelMandate');
      return { ok: response.result === 'SUCCESS' };
    } catch {
      return { ok: false };
    }
  }

  async disburse(opts: { mctContractNo: string; merchOrderId: string; amount: Money; reason: string }): Promise<DisburseResult> {
    const bizContent = {
      appid: this.env.TELEBIRR_MERCHANT_APP_ID,
      merch_code: this.env.TELEBIRR_MERCHANT_CODE,
      mct_contract_no: opts.mctContractNo,
      merch_order_id: opts.merchOrderId,
      disburse_amount: opts.amount.toDecimalString(),
      trans_currency: 'ETB',
      disburse_reason: opts.reason,
    };
    try {
      const response = await this.callBusinessApi<{
        result: string;
        code: string;
        msg: string;
        biz_content: {
          payment_order_id?: string;
          disburse_status?: string; // SUCCESS, PROCESSING, FAILED
        };
      }>('/payment/v1/merchant/disburseOrder', bizContent, 'payment.disbursement');

      if (response.result !== 'SUCCESS') {
        return { status: 'failed', error: response.msg || 'Unknown error', permanent: false };
      }
      const st = (response.biz_content.disburse_status ?? '').toUpperCase();
      const paymentOrderId = response.biz_content.payment_order_id ?? '';
      if (st === 'SUCCESS') return { status: 'succeeded', paymentOrderId };
      if (st === 'PROCESSING') return { status: 'processing', paymentOrderId };
      return { status: 'failed', error: `Disburse ${st}`, permanent: st === 'FAILED' };
    } catch (e) {
      return { status: 'failed', error: (e as Error).message, permanent: false };
    }
  }

  async parseWebhook(req: Request): Promise<WebhookEvent> {
    const raw = await req.text();
    let payload: any;
    try { payload = JSON.parse(raw); } catch { throw new Error('Invalid telebirr webhook JSON'); }

    const ts = typeof payload.timestamp === 'number'
      ? payload.timestamp
      : typeof payload.timestamp === 'string' && payload.timestamp.trim() !== '' && !isNaN(Number(payload.timestamp))
        ? Number(payload.timestamp)
        : undefined;
    if (ts === undefined) {
      throw new Error('Telebirr webhook missing numeric timestamp — possible replay');
    }
    const timestampMs = ts < 1e12 ? ts * 1000 : ts; // seconds -> ms
    if (Date.now() - timestampMs > 5 * 60_000) {
      throw new Error('Telebirr webhook timestamp too old (replay suspected)');
    }

    let signatureValid = false;
    if (typeof payload.sign === 'string' && payload.sign && this.env.TELEBIRR_PUBLIC_KEY) {
      signatureValid = this.verifyTelebirr(payload, payload.sign);
    }

    const outRequestNo = payload.out_request_no ?? payload.trans_id ?? `orno-${Date.now()}`;

    if (payload.refund_request_no) {
      // Refund notify (rare — refunds usually sync via refund() response)
      return payload.trade_status === 'Completed' || payload.trade_status === 'REFUND_SUCCESS'
        ? { type: 'refund.succeeded', refundRequestNo: payload.refund_request_no, raw: payload, signatureValid, timestampMs }
        : { type: 'refund.failed', refundRequestNo: payload.refund_request_no, raw: payload, signatureValid, timestampMs };
    }

    return payload.trade_status === 'Completed' || payload.trade_status === 'Success' || payload.trade_status === 'PAY_SUCCESS'
      ? { type: 'payment.settled', merchOrderId: payload.merch_order_id, amount: Money.fromETBString(payload.total_amount), raw: payload, signatureValid, timestampMs, outRequestNo, transId: payload.trans_id }
      : { type: 'payment.failed', merchOrderId: payload.merch_order_id, raw: payload, signatureValid, timestampMs, outRequestNo };
  }
}

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
