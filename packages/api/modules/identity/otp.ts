import { createHash, randomInt } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { BadRequestError, RateLimitError } from '@addis/shared';
import { redis } from '../../infra/redis';
import { otpCounter } from '../health/metrics';

const OTP_TTL_MIN = 5;
const SEND_LIMIT_PER_10MIN = 3;
const VERIFY_LIMIT_PER_10MIN = 10;

function hashCode(code: string) { return createHash('sha256').update(code).digest('hex'); }

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export const otpService = {
  async send(phone: string, purpose: import('@addis/shared').OtpPurpose) {
    // SEC-003: refuse to send OTPs to soft-deleted users. The check is silent
    // (returns 200) to avoid user-enumeration of deleted accounts, but no SMS
    // is sent and no OTP row is written — saving SMS budget and preventing
    // notification leaks to recycled phone numbers.
    const [existing] = await db.select({ id: schema.users.id, isActive: schema.users.isActive, deletedAt: schema.users.deletedAt })
      .from(schema.users).where(eq(schema.users.phone, phone));
    if (existing && (!existing.isActive || existing.deletedAt)) {
      // For signup_verification, the user shouldn't exist at all — proceed.
      // For password_reset / phone_change, refuse silently.
      if (purpose !== 'signup_verification') {
        return { sent: true, devCode: undefined };
      }
    }

    const lockKey = `otp:send:lock:${phone}`;
    const acquired = await redis.set(lockKey, '1', { nx: true, ex: 2 });
    if (!acquired) throw new RateLimitError(2);

    const countKey = `otp:send:count:${phone}`;
    const count = await redis.incr(countKey);
    if (count === 1) await redis.expire(countKey, 600);
    if (count > SEND_LIMIT_PER_10MIN) throw new RateLimitError(await redis.ttl(countKey));

    await db.update(schema.otpCodes).set({ verified: true })
      .where(and(eq(schema.otpCodes.phone, phone), eq(schema.otpCodes.purpose, purpose), eq(schema.otpCodes.verified, false)));

    const code = generateCode();
    await db.insert(schema.otpCodes).values({
      phone, purpose, codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000),
    });

    const { smsProvider } = await import('@addis/sms');
    const sent = await smsProvider.send(phone, `Your Addis Ride code is ${code}. Expires in ${OTP_TTL_MIN} minutes.`).catch(() => false);

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

    const [row] = await db.select().from(schema.otpCodes)
      .where(and(eq(schema.otpCodes.phone, phone), eq(schema.otpCodes.purpose, purpose), eq(schema.otpCodes.verified, false), gt(schema.otpCodes.expiresAt, new Date())))
      .orderBy(schema.otpCodes.createdAt);
    if (!row) throw new BadRequestError('No active OTP for this phone');
    if (row.attempts >= row.maxAttempts) throw new BadRequestError('Too many attempts; request a new code');

    if (row.codeHash !== hashCode(code)) {

      await db.update(schema.otpCodes)
        .set({ attempts: sql`${schema.otpCodes.attempts} + 1` })
        .where(and(eq(schema.otpCodes.id, row.id), sql`${schema.otpCodes.attempts} < ${row.maxAttempts}`));
      throw new BadRequestError('Invalid code');
    }

    const updated = await db.update(schema.otpCodes)
      .set({ verified: true })
      .where(and(eq(schema.otpCodes.id, row.id), eq(schema.otpCodes.verified, false)))
      .returning({ id: schema.otpCodes.id });
    if (updated.length === 0) throw new BadRequestError('Code already used or invalidated');
    otpCounter.labels('verified').inc();
    return true;
  },
};
