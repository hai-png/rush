// account-deletion endpoint. Now appears in the SDK with the password
// requirement visible to clients.
const deleteAccountRoute = createRoute({
  method: 'post',
  path: '/delete',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ password: z.string().min(1) }) } } } },
  responses: {
    202: { description: 'Deletion scheduled (30-day grace period)' },
    401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Password incorrect' },
  },
});

accountRoutes.openapi(deleteAccountRoute, async (c) => {
  const body = c.req.valid('json');
  const session = c.get('session');
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) throw new UnauthorizedError();
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    throw new UnauthorizedError('Password incorrect');
  }
  await accountService.requestDeletion(session.userId);
  return c.body(null, 202);
});

accountRoutes.get('/export', async (c) => {
  const stream = await accountService.exportZip(c.get('session').userId);
  return new Response(stream as any, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="addis-ride-export.zip"' } });
});
