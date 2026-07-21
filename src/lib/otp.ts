// OTP service — phone-based one-time codes for signup verification, password
// In dev (NODE_ENV !== 'production'), the code is logged to the console and
// also returned to the caller so the test UI can display it. In production
// the code is only sent via SMS (mocked here as a console log).
import { db } from '@/lib/db';
import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { BadRequestError, RateLimitError } from '@/lib/errors';
import { EthiopianPhone } from '@/lib/phone';

const OTP_TTL_MIN = 5;

export type OtpPurpose = 'signup_verification' | 'password_reset' | 'phone_change';

export async function sendOtp(rawPhone: string, purpose: OtpPurpose): Promise<{ devCode?: string }> {
  const phone = EthiopianPhone.normalize(rawPhone);
  // Invalidate previous unverified codes for this phone+purpose.
  await db.otpCode.updateMany({
    where: { phone, purpose, verified: false },
    data: { expiresAt: new Date(0) },
  });

  // Rate-limit: max 3 unverified codes per phone per 10 min.
  const recent = await db.otpCode.count({
    where: {
      phone,
      purpose,
      createdAt: { gt: new Date(Date.now() - 10 * 60_000) },
    },
  });
  if (recent >= 3) {
    throw new RateLimitError(60, 'Too many OTP requests. Wait 10 minutes.');
  }

  const code = (100000 + randomInt(900000)).toString();
  const codeHash = await hashPassword(code);
  await db.otpCode.create({
    data: {
      phone,
      purpose,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000),
    },
  });

  // In dev, return the code so the UI can auto-fill. In prod, send via SMS.
  // SMS is mocked either way (console.log).
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[OTP] ${phone} (${purpose}): ${code}`);
  }
  return { devCode: process.env.NODE_ENV === 'production' ? undefined : code };
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
    await db.otpCode.update({ where: { id: otp.id }, data: { attempts: otp.attempts + 1 } });
    throw new BadRequestError('Invalid code');
  }

  await db.otpCode.update({ where: { id: otp.id }, data: { verified: true } });
}
