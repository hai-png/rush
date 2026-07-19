import { Hono } from 'hono';
import { z } from 'zod';
import { EthiopianPhone } from '@addis/shared';
import { identityService } from './service';
import { otpService } from './otp';
import { requireRole, requireAuth } from '../../src/middleware/auth';
import { db, schema } from '@addis/db';
import { eq, and } from 'drizzle-orm';

export const identityRoutes = new Hono();

const RegisterInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rider'), name: z.string().min(2), phone: EthiopianPhone, password: z.string().min(10), homeArea: z.string(), workArea: z.string() }),
  z.object({ kind: z.literal('contractor'), name: z.string().min(2), phone: EthiopianPhone, password: z.string().min(10), licenseNumber: z.string(), experienceYears: z.number().int().min(0) }),
]);

identityRoutes.post('/register', async (c) => {
  const body = RegisterInput.parse(await c.req.json());
  const result = body.kind === 'rider' ? await identityService.registerRider(body) : await identityService.registerContractor(body);
  return c.json({ data: result }, 201);
});

identityRoutes.post('/token', async (c) => {
  const { phone, password, code } = z.object({ phone: EthiopianPhone, password: z.string(), code: z.string().length(6).optional() }).parse(await c.req.json());
  const ip = c.req.header('x-forwarded-for');
  const ua = c.req.header('user-agent');
  const { user, accessToken, requiresTosAcceptance } = await identityService.login(phone, password, ua, ip, code);
  return c.json({ data: { accessToken, expiresIn: 2592000, user: { id: user.id, role: user.role, phone: user.phone }, requiresTosAcceptance } });
});

identityRoutes.post('/refresh', async (c) => {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!bearer) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing token', requestId: c.get('requestId') } }, 401);
  const { user, jti } = await identityService.verifySession(bearer);
  // Refresh reissues without re-checking password: mint a new short-lived token
  // for a NEW session, deleting the old session row (rotation). The previous
  // implementation left the old session row in place, so a stolen token
  // remained valid for up to 30 minutes even after a legitimate refresh.
  const fresh = await identityService.reissueToken(user.id, jti);
  return c.json({ data: { accessToken: fresh, expiresIn: 2592000 } });
});

identityRoutes.post('/logout', async (c) => {
  const session = c.get('session');
  if (session?.jti) await db.delete(schema.sessions).where(eq(schema.sessions.jti, session.jti));
  return c.body(null, 204);
});

identityRoutes.get('/me', requireAuth, async (c) => {
  const session = c.get('session');
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) return c.json({ error: { code: 'NOT_FOUND', message: 'User not found', requestId: c.get('requestId') } }, 404);
  const { passwordHash: _ph, twoFactorSecret: _tfs, ...safe } = user;
  return c.json({ data: safe });
});

identityRoutes.post('/change-password', requireAuth, async (c) => {
  const session = c.get('session');
  const { oldPassword, newPassword } = z.object({ oldPassword: z.string(), newPassword: z.string().min(10) }).parse(await c.req.json());
  await identityService.changePassword(session.userId, oldPassword, newPassword);
  return c.body(null, 204);
});

identityRoutes.get('/sessions', requireAuth, async (c) => {
  const session = c.get('session');
  const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, session.userId));
  return c.json({ data: rows });
});
identityRoutes.delete('/sessions/:id', requireAuth, async (c) => {
  const session = c.get('session');
  await db.delete(schema.sessions).where(and(eq(schema.sessions.id, c.req.param('id')), eq(schema.sessions.userId, session.userId)));
  return c.body(null, 204);
});

identityRoutes.post('/otp/send', async (c) => {
  const { phone, purpose } = z.object({ phone: EthiopianPhone, purpose: z.enum(['signup_verification', 'password_reset', 'phone_change']) }).parse(await c.req.json());
  return c.json({ data: await otpService.send(phone, purpose) });
});
identityRoutes.post('/otp/verify', async (c) => {
  const { phone, purpose, code } = z.object({ phone: EthiopianPhone, purpose: z.enum(['signup_verification', 'password_reset', 'phone_change']), code: z.string().length(6) }).parse(await c.req.json());
  await otpService.verify(phone, purpose, code);
  return c.body(null, 204);
});

identityRoutes.post('/password/reset', async (c) => {
  const { phone } = z.object({ phone: EthiopianPhone }).parse(await c.req.json());
  return c.json({ data: await otpService.send(phone, 'password_reset') });
});
identityRoutes.post('/password/reset/confirm', async (c) => {
  const { phone, code, newPassword } = z.object({ phone: EthiopianPhone, code: z.string().length(6), newPassword: z.string().min(10) }).parse(await c.req.json());
  await otpService.verify(phone, 'password_reset', code);
  await identityService.resetPassword(phone, newPassword);
  return c.body(null, 204);
});

// H9 fix: 2FA routes are now available to ALL authenticated users (was admin-only).
// Riders and contractors handle payments and PII — they should be able to opt into
// 2FA for their own accounts. The requireRole restriction was an unnecessary gate
// that left rider/contractor accounts less secure than admin accounts.
identityRoutes.post('/2fa/setup', requireAuth, async (c) => {
  // currentCode is required ONLY when 2FA is already enabled (rotation flow).
  // First-time setup does not require it.
  const { currentCode } = z.object({ currentCode: z.string().length(6).optional() }).parse(await c.req.json());
  return c.json({ data: await identityService.setup2fa(c.get('session').userId, currentCode) });
});
identityRoutes.post('/2fa/verify', requireAuth, async (c) => {
  const { code } = z.object({ code: z.string().length(6) }).parse(await c.req.json());
  return c.json({ data: await identityService.verify2fa(c.get('session').userId, code) });
});
identityRoutes.post('/2fa/disable', requireAuth, async (c) => {
  const { password, code } = z.object({ password: z.string(), code: z.string().length(6).optional() }).parse(await c.req.json());
  await identityService.disable2fa(c.get('session').userId, password, code);
  return c.body(null, 204);
});

identityRoutes.route('/contractors', (await import('./documents.routes')).documentRoutes);
