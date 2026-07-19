import { getSession } from '../../src/context';
import { TypedHono } from '../../src/typed-hono';
import { z } from 'zod';
import { EthiopianPhone } from '@addis/shared';
import { identityService } from './service';
import { otpService } from './otp';
import { requireRole, requireAuth } from '../../src/middleware/auth';
import { db, schema } from '@addis/db';
import { eq, and } from 'drizzle-orm';

export const identityRoutes = new TypedHono();

const RegisterInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rider'),
    name: z.string().min(2),
    phone: EthiopianPhone,
    password: z.string().min(10),
    homeArea: z.string(),
    workArea: z.string(),
    /** 6-digit OTP the caller must have already had sent via POST /auth/otp/send
     *  with purpose=signup_verification. The register endpoint verifies it before
     *  creating the user, otherwise `phoneVerified` was permanently false AND the
     *  OTP send/verify endpoints were dead code from the signup flow's perspective
     *  (anyone could register with any phone number they didn't control). */
    otp: z.string().length(6),
  }),
  z.object({
    kind: z.literal('contractor'),
    name: z.string().min(2),
    phone: EthiopianPhone,
    password: z.string().min(10),
    licenseNumber: z.string(),
    experienceYears: z.number().int().min(0),
    otp: z.string().length(6),
  }),
]);

identityRoutes.post('/register', async (c) => {
  const body = RegisterInput.parse(await c.req.json());
  // Verify the OTP BEFORE creating the user — if verification fails, we don't
  // leave a half-created user row behind, and we don't leak which phones are
  // already registered (the verify call throws BadRequestError on bad code,
  // regardless of whether a user with this phone exists).
  await otpService.verify(body.phone, 'signup_verification', body.otp);
  const { otp: _otp, ...rest } = body;
  const result = body.kind === 'rider'
    ? await identityService.registerRider(rest as Extract<typeof body, { kind: 'rider' }>)
    : await identityService.registerContractor(rest as Extract<typeof body, { kind: 'contractor' }>);
  // Mark the user's phone as verified now that the OTP check passed.
  await db.update(schema.users).set({ phoneVerified: true, updatedAt: new Date() }).where(eq(schema.users.id, result.user.id));
  return c.json({ data: result }, 201);
});

identityRoutes.post('/token', async (c) => {
  const { phone, password, code } = z.object({ phone: EthiopianPhone, password: z.string(), code: z.string().length(6).optional() }).parse(await c.req.json());
  const ip = c.req.header('x-forwarded-for');
  const ua = c.req.header('user-agent');
  const { user, accessToken, requiresTosAcceptance } = await identityService.login(phone, password, ua, ip, code);
  return c.json({ data: { accessToken, expiresIn: 1800, user: { id: user.id, role: user.role, phone: user.phone }, requiresTosAcceptance } });
});

identityRoutes.post('/refresh', async (c) => {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!bearer) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing token', requestId: c.get('requestId') } }, 401);
  const { user } = await identityService.verifySession(bearer);
  // Refresh reissues without re-checking password: mint a new short-lived token for the same session.
  const fresh = await identityService.reissueToken(user.id);
  return c.json({ data: { accessToken: fresh, expiresIn: 1800 } });
});

identityRoutes.post('/logout', async (c) => {
  const session = getSession(c);
  if (session?.jti) await db.delete(schema.sessions).where(eq(schema.sessions.jti, session.jti));
  return c.body(null, 204);
});

identityRoutes.get('/me', requireAuth, async (c) => {
  const session = getSession(c);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) return c.json({ error: { code: 'NOT_FOUND', message: 'User not found', requestId: c.get('requestId') } }, 404);
  const { passwordHash: _ph, twoFactorSecret: _tfs, ...safe } = user;
  return c.json({ data: safe });
});

identityRoutes.post('/change-password', requireAuth, async (c) => {
  const session = getSession(c);
  const { oldPassword, newPassword } = z.object({ oldPassword: z.string(), newPassword: z.string().min(10) }).parse(await c.req.json());
  await identityService.changePassword(session.userId, oldPassword, newPassword);
  return c.body(null, 204);
});

identityRoutes.get('/sessions', requireAuth, async (c) => {
  const session = getSession(c);
  const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, session.userId));
  return c.json({ data: rows });
});
identityRoutes.delete('/sessions/:id', requireAuth, async (c) => {
  const session = getSession(c);
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

identityRoutes.post('/2fa/setup', requireRole('platform_admin', 'corporate_admin'), async (c) => c.json({ data: await identityService.setup2fa(getSession(c).userId) }));
identityRoutes.post('/2fa/verify', requireRole('platform_admin', 'corporate_admin'), async (c) => {
  const { code } = z.object({ code: z.string().length(6) }).parse(await c.req.json());
  return c.json({ data: await identityService.verify2fa(getSession(c).userId, code) });
});
identityRoutes.post('/2fa/disable', requireRole('platform_admin', 'corporate_admin'), async (c) => {
  const { password } = z.object({ password: z.string() }).parse(await c.req.json());
  await identityService.disable2fa(getSession(c).userId, password);
  return c.body(null, 204);
});

identityRoutes.route('/contractors', (await import('./documents.routes')).documentRoutes);
