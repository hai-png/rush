// straight to the service's `.set({ ...input })`, a mass-assignment
// vulnerability. A corporate admin could send
// `{ corporateId: "other-corp", userId: "attacker-id", ridesUsedThisMonth: 0 }`
// and the service would write all of it — moving a member to a different
// corporate, changing the user pointer, or resetting ride counts. Now only
// approvalStatus and isActive are accepted.
const UpdateMemberInput = z.object({
  approvalStatus: z.enum(['approved', 'rejected', 'pending']).optional(),
  isActive: z.boolean().optional(),
}).strict();

corporateRoutes.patch('/members/:id', requireRole('corporate_admin'), async (c) => {
  const body = UpdateMemberInput.parse(await c.req.json());
  return c.json({ data: await corporateService.updateMember(c.get('session').userId, c.req.param('id'), body) });
});
corporateRoutes.delete('/members/:id', requireRole('corporate_admin'), async (c) => { await corporateService.removeMember(c.get('session').userId, c.req.param('id')); return c.body(null, 204); });

corporateRoutes.post('/invites', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.generateInvite(c.get('session').userId) }));

corporateRoutes.post('/onboard', requireRole('rider'), async (c) => {
  const body = z.object({
    /** Either a signed invite token (preferred — time-limited) or a raw
     *  corporate code (legacy — accepted for backward compat but logged). */
    invite: z.string().optional(),
    corporateCode: z.string().optional(),
    employeeId: z.string(),
  }).parse(await c.req.json());

  let code: string;
  if (body.invite) {
    // H41: verify the signed invite token (signature + expiry)
    // FIX (SEC-008 / ARCH-015): use loadEnv() so the secret is validated.
    const { timingSafeEqual, createHmac } = await import('node:crypto');
    const { loadEnv } = await import('@addis/shared');
    const env = loadEnv();
    const decoded = Buffer.from(body.invite, 'base64url').toString();
    const lastDot = decoded.lastIndexOf('.');
    if (lastDot < 0) return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid invite token', requestId: c.get('requestId') } }, 400);
    const payload = decoded.slice(0, lastDot);
    const sig = decoded.slice(lastDot + 1);
    const expected = createHmac('sha256', env.NEXTAUTH_SECRET).update(payload).digest('hex');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid invite signature', requestId: c.get('requestId') } }, 400);
    }
    let parsed: { code?: string; expiresAt?: number };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Malformed invite token', requestId: c.get('requestId') } }, 400);
    }
    if (typeof parsed.expiresAt !== 'number' || Date.now() > parsed.expiresAt) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invite token expired', requestId: c.get('requestId') } }, 400);
    }
    if (typeof parsed.code !== 'string' || !parsed.code) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invite token missing code', requestId: c.get('requestId') } }, 400);
    }
    code = parsed.code;
  } else if (body.corporateCode) {
    // Legacy: raw corporate code (no expiry). Accepted for backward compat
    // with old invite URLs, but new invites should use the signed token.
    code = body.corporateCode;
  } else {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Either invite or corporateCode is required', requestId: c.get('requestId') } }, 400);
  }

  return c.json({ data: await corporateService.onboardRider(c.get('session').userId, { corporateCode: code, employeeId: body.employeeId }) }, 201);
});
corporateRoutes.get('/me', requireRole('rider'), async (c) => c.json({ data: await corporateService.myMembership(c.get('session').userId) }));
