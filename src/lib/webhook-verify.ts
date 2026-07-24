import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

// Twilio uses HMAC-SHA1 over the URL + POST params + auth token.
export function verifyTwilioSignature(req: NextRequest, authToken: string): boolean {
  const signature = req.headers.get('x-twilio-signature');
  if (!signature || !authToken) return false;

  const url = req.nextUrl.toString();
  const params: Record<string, string> = {};
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

// Resend uses Svix for webhook signing (HMAC-SHA256 over timestamp + msgId + body).
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
    } catch {  }
  }
  return false;
}

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

