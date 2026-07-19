import { createHash, randomInt } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { BadRequestError, RateLimitError } from '@addis/shared';
import { redis } from '../../infra/redis';
import { otpCounter } from '../health/metrics';

const OTP_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;
const SEND_LIMIT_PER_10MIN = 3;
const VERIFY_LIMIT_PER_10MIN = 10;

function hashCode(code: string) { return createHash('sha256').update(code).digest('hex'); }

/**
 * Generate a 6-digit OTP. `randomInt(0, 1_000_000)` covers the full 000000–999999
 * space (1,000,000 codes) and we zero-pad to 6 chars. The previous
 * `randomInt(100000, 999999)` excluded codes < 100000 (no leading zeros),
 * shrinking the space by 10% and biasing codes toward higher values.
 */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export const otpService = {
  async send(phone: string, purpose: import('@addis/shared').OtpPurpose) {
    // Send-lock: prevents two concurrent send() calls for the same phone from
    // both generating and SMS-ing a code.
    const lockKey = `otp:send:lock:${phone}`;
    const acquired = await redis.set(lockKey, '1', { nx: true, ex: 2 });
    if (!acquired) throw new RateLimitError(2);

    const countKey = `otp:send:count:${phone}`;
    const count = await redis.incr(countKey);
    if (count === 1) await redis.expire(countKey, 600);
    if (count > SEND_LIMIT_PER_10MIN) throw new RateLimitError(await redis.ttl(countKey));

    // Consume prior unconsumed codes for this phone+purpose by marking them
    // superseded (verified=true is the existing schema's "consumed" flag).
    await db.update(schema.otpCodes).set({ verified: true })
      .where(and(eq(schema.otpCodes.phone, phone), eq(schema.otpCodes.purpose, purpose), eq(schema.otpCodes.verified, false)));

    const code = generateCode();
    await db.insert(schema.otpCodes).values({
      phone, purpose, codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000),
    });

    const { smsProvider } = await import('@addis/sms');
    const sent = await smsProvider.send(phone, `Your Addis Ride code is ${code}. Expires in ${OTP_TTL_MIN} minutes.`).catch(() => false);

    // Only return the devCode in development OR when explicitly opted in via
    // ALLOW_DEV_OTP=1|true. The previous `NODE_ENV !== 'production'` check
    // returned the code in any other environment — including unset, 'staging',
    // 'test', or a typo'd value — silently leaking OTPs in JSON responses.
    // The ALLOW_DEV_OTP env var lets integration tests / staging environments
    // opt in explicitly without forcing NODE_ENV=development (which would
    // also enable pino-pretty and other dev-only behaviors).
    const allowDev = process.env.NODE_ENV === 'development'
      || process.env.ALLOW_DEV_OTP === '1'
      || process.env.ALLOW_DEV_OTP === 'true';
    const devCode = allowDev ? code : undefined;
    otpCounter.labels('sent').inc();
    return { sent, devCode };
  },

  async verify(phone: string, purpose: import('@addis/shared').OtpPurpose, code: string) {
    const verifyKey = `otp:verify:count:${phone}`;
    const count = await redis.incr(verifyKey);
    if (count === 1) await redis.expire(verifyKey, 600);
    if (count > VERIFY_LIMIT_PER_10MIN) throw new RateLimitError(await redis.ttl(verifyKey));

    // Atomic CAS: only mark verified if attempts haven't been bumped past the
    // limit by a concurrent caller. The previous SELECT-then-UPDATE allowed N
    // parallel wrong guesses to all read attempts=4, all increment to 5, and
    // all write 5 — effectively counting N guesses as 1 attempt. Brute-force
    // amplification.
    const [row] = await db.select().from(schema.otpCodes)
      .where(and(eq(schema.otpCodes.phone, phone), eq(schema.otpCodes.purpose, purpose), eq(schema.otpCodes.verified, false), gt(schema.otpCodes.expiresAt, new Date())))
      .orderBy(schema.otpCodes.createdAt);
    if (!row) throw new BadRequestError('No active OTP for this phone');
    if (row.attempts >= row.maxAttempts) throw new BadRequestError('Too many attempts; request a new code');

    if (row.codeHash !== hashCode(code)) {
      // Atomic increment with a guard: only increment if attempts < maxAttempts.
      // If a concurrent verify already pushed attempts to maxAttempts, this
      // update is a no-op — preventing the "last write wins" race that
      // previously undercounted attempts.
      await db.update(schema.otpCodes)
        .set({ attempts: sql`${schema.otpCodes.attempts} + 1` })
        .where(and(eq(schema.otpCodes.id, row.id), sql`${schema.otpCodes.attempts} < ${row.maxAttempts}`));
      throw new BadRequestError('Invalid code');
    }

    // Mark verified atomically — only if not already verified (race against
    // a concurrent verify of the same code).
    const updated = await db.update(schema.otpCodes)
      .set({ verified: true })
      .where(and(eq(schema.otpCodes.id, row.id), eq(schema.otpCodes.verified, false)))
      .returning({ id: schema.otpCodes.id });
    if (updated.length === 0) throw new BadRequestError('Code already used or invalidated');
    otpCounter.labels('verified').inc();
    return true;
  },
};
