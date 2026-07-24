// helpers for Twilio and Resend.
//
// These verify that incoming webhooks are genuinely from Twilio/Resend and
// not forged. Without verification, an attacker could POST fake SMS delivery
// receipts or email bounce events.
//
// Usage:
//   if (!verifyTwilioSignature(req, TWILIO_AUTH_TOKEN)) throw new ForbiddenError();
//   if (!verifyResendSignature(req, RESEND_WEBHOOK_SECRET)) throw new ForbiddenError();

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

// Twilio uses HMAC-SHA1 over the URL + POST params + auth token.
// See: https://www.twilio.com/docs/usage/webhooks/webhooks-security
export function verifyTwilioSignature(req: NextRequest, authToken: string): boolean {
  const signature = req.headers.get('x-twilio-signature');
  if (!signature || !authToken) return false;

  // Build the validation string: URL + sorted POST params.
  const url = req.nextUrl.toString();
  const params: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => { params[k] = v; });
  // Note: for POST body params, we'd need to parse the body. For status callbacks,
  // Twilio sends params in the body (form-encoded). This helper assumes the caller
  // has already merged body params into the `params` object.
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) {
    data += k + params[k];
  }

  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Resend uses Svix for webhook signing (HMAC-SHA256 over timestamp + msgId + body).
// See: https://resend.com/docs/dashboard/webhooks
// Format: headers 'svix-id', 'svix-timestamp', 'svix-signature'
// Signature: 'v1,base64(hmac-sha256(secret, '{svix-id}.{svix-timestamp}.{body}'))'
export function verifyResendSignature(
  req: NextRequest,
  body: string,
  webhookSecret: string,
): boolean {
  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature || !webhookSecret) return false;

  // Check timestamp freshness (5-min window).
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(svixTimestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) return false;

  const signedPayload = `${svixId}.${svixTimestamp}.${body}`;
  const expected = createHmac('sha256', webhookSecret).update(signedPayload).digest('base64');

  // svix-signature is a comma-separated list of 'v1,signature' pairs.
  const signatures = svixSignature.split(' ').map(s => s.replace('v1,', ''));
  for (const sig of signatures) {
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch { /* try next */ }
  }
  return false;
}

// CRITICAL FIX (H-13): Twilio signature verification that includes POST body
// params. Twilio's signature is HMAC-SHA1 over URL + sorted(POST params + query
// params). The original verifyTwilioSignature only included query params, which
// allowed an attacker to POST arbitrary body values with a valid query-string
// signature. This new function accepts the pre-parsed body params and merges
// them with the query params before computing the HMAC.
export function verifyTwilioSignatureWithBody(
  req: NextRequest,
  authToken: string,
  bodyParams: Record<string, string>,
): boolean {
  const signature = req.headers.get('x-twilio-signature');
  if (!signature || !authToken) return false;

  const url = req.nextUrl.toString();
  const params: Record<string, string> = { ...bodyParams };
  req.nextUrl.searchParams.forEach((v, k) => { params[k] = v; });

  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) {
    data += k + params[k];
  }

  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
