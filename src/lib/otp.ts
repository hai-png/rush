import { db } from '@/lib/db';
import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { BadRequestError, RateLimitError } from '@/lib/errors';
import { EthiopianPhone } from '@/lib/phone';

const OTP_TTL_MIN = 5;

export type OtpPurpose = 'signup_verification' | 'password_reset' | 'phone_change' | 'phone_change_current';

export async function sendOtp(rawPhone: string, purpose: OtpPurpose): Promise<{ devCode?: string }> {
  const phone = EthiopianPhone.normalize(rawPhone);
  await db.otpCode.updateMany({
    where: { phone, purpose, verified: false },
    data: { expiresAt: new Date(0) },
  });

  const code = (100000 + randomInt(900000)).toString();

  // 3-per-10-min limit. SQLite's serialized writer means the COUNT and CREATE
  await db.$transaction(async (tx) => {
    const recent = await tx.otpCode.count({
      where: {
        phone,
        purpose,
        createdAt: { gt: new Date(Date.now() - 10 * 60_000) },
      },
    });
    if (recent >= 3) {
      throw new RateLimitError(60, 'Too many OTP requests. Wait 10 minutes.');
    }
    const codeHash = await hashPassword(code);
    await tx.otpCode.create({
      data: {
        phone,
        purpose,
        codeHash,
        expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000),
      },
    });
  });

  if (process.env.NODE_ENV !== 'production' && process.env.OTP_DEBUG === '1') {
    console.log(`[OTP] ${phone} (${purpose}): ${code}`);
  }
  return { devCode: (process.env.NODE_ENV !== 'production' && process.env.OTP_DEBUG === '1') ? code : undefined };
}

export async function verifyOtp(rawPhone: string, purpose: OtpPurpose, code: string): Promise<void> {
  const phone = EthiopianPhone.normalize(rawPhone);
  const [otp] = await db.otpCode.findMany({
    where: { phone, purpose, verified: false },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  if (!otp) throw new BadRequestError('No active OTP. Request a new one.');
  if (otp.expiresAt < new Date()) throw new BadRequestError('OTP expired. Request a new one.');
  if (otp.attempts >= otp.maxAttempts) throw new BadRequestError('Too many attempts. Request a new code.');

  const ok = await verifyPassword(code, otp.codeHash);
  if (!ok) {
    await db.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new BadRequestError('Invalid code');
  }

  const result = await db.otpCode.updateMany({
    where: { id: otp.id, verified: false },
    data: { verified: true },
  });
  if (result.count === 0) throw new BadRequestError('Code already used');
}

