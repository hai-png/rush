import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

// Twilio uses HMAC-SHA1 over the URL + POST params + auth token.
// See: https://www.twilio.com/docs/usage/webhooks/webhooks-security
export function verifyTwilioSignature(req: NextRequest, authToken: string): boolean {
  const signature = req.headers.get('x-twilio-signature');
  if (!signature || !authToken) return false;

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
