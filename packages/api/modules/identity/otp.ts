import { createHash, randomInt } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { BadRequestError, RateLimitError, AppError } from '@addis/shared';
import { redis } from '../../infra/redis';

const OTP_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;
const SEND_LIMIT_PER_10MIN = 3;
const VERIFY_LIMIT_PER_10MIN = 10;
/** SMS send retry config. Each attempt waits backoffMs[i] before retrying. */
const SMS_BACKOFF_MS = [0, 500, 2000];
/** Maximum send attempts before giving up and surfacing the failure to the caller. */
const SMS_MAX_ATTEMPTS = SMS_BACKOFF_MS.length;

function hashCode(code: string) { return createHash('sha256').update(code).digest('hex'); }

/**
 * SMS delivery with bounded exponential backoff. The previous implementation called
 * `smsProvider.send(...).catch(() => false)` — a single attempt with no retry, and the
 * failure was swallowed silently. The caller (e.g. /auth/otp/send) received `sent: false`
 * but the OTP row was already inserted, so the user could not receive the code yet could
 * not request a new one without burning a send-rate-limit slot.
 *
 * We now retry up to SMS_MAX_ATTEMPTS times with backoff, and on terminal failure throw
 * an `AppError(503)` so the route handler can return a clear 503 to the client and the
 * user knows to try again. The OTP row is still inserted (so a retry of the SEND endpoint
 * would consume the prior code as before).
 */
async function sendSmsWithRetry(phone: string, message: string): Promise<boolean> {
  const { smsProvider } = await import('@addis/sms');
  for (let attempt = 0; attempt < SMS_MAX_ATTEMPTS; attempt++) {
    const backoff = SMS_BACKOFF_MS[attempt] ?? 0;
    if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
    try {
      const ok = await smsProvider.send(phone, message);
      if (ok) return true;
    } catch {
      // fall through to next attempt
    }
  }
  return false;
}

export const otpService = {
  async send(phone: string, purpose: import('@addis/shared').OtpPurpose) {
    const lockKey = `otp:send:lock:${phone}`;
    const acquired = await redis.set(lockKey, '1', { nx: true, ex: 2 });
    if (!acquired) throw new RateLimitError(2);

    const countKey = `otp:send:count:${phone}`;
    const count = await redis.incr(countKey);
    if (count === 1) await redis.expire(countKey, 600);
    if (count > SEND_LIMIT_PER_10MIN) throw new RateLimitError(await redis.ttl(countKey));

    // consume prior unconsumed codes for this phone+purpose
    await db.update(schema.otpCodes).set({ verified: true })
      .where(and(eq(schema.otpCodes.phone, phone), eq(schema.otpCodes.purpose, purpose), eq(schema.otpCodes.verified, false)));

    const code = String(randomInt(100000, 999999));
    await db.insert(schema.otpCodes).values({
      phone, purpose, codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000),
    });

    const sent = await sendSmsWithRetry(phone, `Your Addis Ride code is ${code}. Expires in ${OTP_TTL_MIN} minutes.`);
    if (!sent) {
      // Surface the failure as a 503 — the caller can retry the whole send, and the
      // rate-limit counter above is per-10min so a frustrated user cannot DoS the SMS
      // provider. We do NOT throw for the in-memory Redis fallback (dev mode without
      // SMS configured) because that would break local signup entirely.
      if (process.env.NODE_ENV === 'production' && process.env.AFRICAS_TALKING_API_KEY) {
        throw new AppError(503, 'SMS_DELIVERY_FAILED', 'Could not deliver OTP via SMS — please try again');
      }
    }

    /**
     * devCode is only returned when ALLOW_DEV_OTP is explicitly set to '1' or 'true'.
     *
     * Previously this leaked the OTP code in the response body whenever NODE_ENV !==
     * 'production' — which is dangerous if a staging environment is exposed to the
     * internet (anyone can read OTP codes for any phone). Even development environments
     * are safer with the OTP returned only behind an explicit opt-in flag, because the
     * developer may not realise the response includes the code.
     *
     * The new behaviour: devCode is undefined unless ALLOW_DEV_OTP=1 is set. The mobile
     * and web signup flows already handle `devCode: undefined` correctly (the UI just
     * tells the user "We sent a 6-digit code to {phone}").
     */
    const allowDevOtp = process.env.ALLOW_DEV_OTP === '1' || process.env.ALLOW_DEV_OTP === 'true';
    return { sent, devCode: allowDevOtp ? code : undefined };
  },

  async verify(phone: string, purpose: import('@addis/shared').OtpPurpose, code: string) {
    const verifyKey = `otp:verify:count:${phone}`;
    const count = await redis.incr(verifyKey);
    if (count === 1) await redis.expire(verifyKey, 600);
    if (count > VERIFY_LIMIT_PER_10MIN) throw new RateLimitError(await redis.ttl(verifyKey));

    const [row] = await db.select().from(schema.otpCodes)
      .where(and(eq(schema.otpCodes.phone, phone), eq(schema.otpCodes.purpose, purpose), eq(schema.otpCodes.verified, false), gt(schema.otpCodes.expiresAt, new Date())))
      .orderBy(schema.otpCodes.createdAt);
    if (!row) throw new BadRequestError('No active OTP for this phone');
    if (row.attempts >= row.maxAttempts) throw new BadRequestError('Too many attempts; request a new code');

    if (row.codeHash !== hashCode(code)) {
      await db.update(schema.otpCodes).set({ attempts: row.attempts + 1 }).where(eq(schema.otpCodes.id, row.id));
      throw new BadRequestError('Invalid code');
    }
    await db.update(schema.otpCodes).set({ verified: true }).where(eq(schema.otpCodes.id, row.id));
    return true;
  },
};
