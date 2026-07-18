import { Hono } from 'hono';
import { z } from 'zod';
import { EthiopianPhone } from '@addis/shared';
import { identityService } from './service';
import { otpService } from './otp';
import { requireRole } from '../../src/middleware/auth';
import { db, schema } from '@addis/db';
import { eq } from 'drizzle-orm';

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
  const { phone, password } = z.object({ phone: EthiopianPhone, password: z.string() }).parse(await c.req.json());
  const ip = c.req.header('x-forwarded-for');
  const ua = c.req.header('user-agent');
  const { user, accessToken, requiresTosAcceptance } = await identityService.login(phone, password, ua, ip);
  return c.json({ data: { accessToken, expiresIn: 1800, user: { id: user.id, role: user.role, phone: user.phone }, requiresTosAcceptance } });
});

identityRoutes.post('/refresh', async (c) => {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!bearer) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing token', requestId: c.get('requestId') } }, 401);
  const { user } = await identityService.verifySession(bearer);
  const { accessToken } = await identityService.login(user.phone, '', undefined, undefined).catch(() => ({ accessToken: null }));
  // Refresh reissues without re-checking password: mint a new short-lived token for the same session.
  const fresh = await identityService.reissueToken(user.id);
  return c.json({ data: { accessToken: fresh, expiresIn: 1800 } });
});

identityRoutes.post('/logout', async (c) => {
  const session = c.get('session');
  if (session?.jti) await db.delete(schema.sessions).where(eq(schema.sessions.jti, session.jti));
  return c.body(null, 204);
});

identityRoutes.get('/me', async (c) => {
  const session = c.get('session');
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  return c.json({ data: user });
});

identityRoutes.post('/change-password', async (c) => {
  const session = c.get('session');
  const { oldPassword, newPassword } = z.object({ oldPassword: z.string(), newPassword: z.string().min(10) }).parse(await c.req.json());
  await identityService.changePassword(session.userId, oldPassword, newPassword);
  return c.body(null, 204);
});

identityRoutes.get('/sessions', async (c) => {
  const session = c.get('session');
  const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, session.userId));
  return c.json({ data: rows });
});
identityRoutes.delete('/sessions/:id', async (c) => {
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

identityRoutes.post('/2fa/setup', requireRole('platform_admin', 'corporate_admin'), async (c) => c.json({ data: await identityService.setup2fa(c.get('session').userId) }));
identityRoutes.post('/2fa/verify', requireRole('platform_admin', 'corporate_admin'), async (c) => {
  const { code } = z.object({ code: z.string().length(6) }).parse(await c.req.json());
  return c.json({ data: await identityService.verify2fa(c.get('session').userId, code) });
});
identityRoutes.post('/2fa/disable', requireRole('platform_admin', 'corporate_admin'), async (c) => {
  const { password } = z.object({ password: z.string() }).parse(await c.req.json());
  await identityService.disable2fa(c.get('session').userId, password);
  return c.body(null, 204);
});

identityRoutes.route('/contractors', (await import('./documents.routes')).documentRoutes);
import { and } from 'drizzle-orm';
