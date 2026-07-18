import { createHash, randomInt } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { BadRequestError, RateLimitError } from '@addis/shared';
import { redis } from '../../infra/redis';

const OTP_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;
const SEND_LIMIT_PER_10MIN = 3;
const VERIFY_LIMIT_PER_10MIN = 10;

function hashCode(code: string) { return createHash('sha256').update(code).digest('hex'); }

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

    const { smsProvider } = await import('@addis/sms');
    const sent = await smsProvider.send(phone, `Your Addis Ride code is ${code}. Expires in ${OTP_TTL_MIN} minutes.`).catch(() => false);
    return { sent, devCode: process.env.NODE_ENV !== 'production' ? code : undefined };
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
