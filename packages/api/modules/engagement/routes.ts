// JSON straight to the service's `.set({ ...input })`, allowing the
// caller to write any JSON structure into the `prefs` jsonb column
// (including prototype-pollution-style keys). Now the structure is
// validated: prefs is a record of notification type -> partial channel
// map, and quietHoursStart/End are HH:MM strings.
const ChannelKeyZ = z.enum(['inApp', 'push', 'sms', 'email']);
const NotificationTypeZ = z.enum([
  'payment_received', 'payment_failed', 'refund_completed', 'refund_failed',
  'seat_claimed', 'seat_released', 'seat_release_expired',
  'subscription_expiring', 'subscription_expired', 'subscription_cancelled',
  'trip_departing', 'document_verified', 'document_rejected',
  'support_reply', 'support_resolved',
  'corporate_member_added', 'corporate_member_removed', 'corporate_reset',
  'general',
]);
const TimeOfDayZ = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');
const UpdatePreferencesInput = z.object({
  // FIX (ARCH-002 follow-up): z.record(...).partial() is not a valid Zod
  // method — .partial() is for object schemas, not records. The previous
  // code threw "z.record(...).partial is not a function" at module load,
  // which prevented the OpenAPI document from being generated (and would
  // have crashed the API at startup if the engagement routes were ever
  // loaded in a fresh process). The equivalent for "record with optional
  // values" is z.record(keySchema, valueSchema) — the values are already
  // optional in the sense that any key may be absent from the record.
  prefs: z.record(NotificationTypeZ, z.record(ChannelKeyZ, z.boolean())).optional(),
  quietHoursStart: TimeOfDayZ.nullable().optional(),
  quietHoursEnd: TimeOfDayZ.nullable().optional(),
}).strict();

engagementRoutes.patch('/notifications/preferences', async (c) => {
  const body = UpdatePreferencesInput.parse(await c.req.json());
  return c.json({ data: await engagementService.updatePreferences(c.get('session').userId, body) });
});

engagementRoutes.post('/devices', async (c) => {
  const body = z.object({ pushToken: z.string(), platform: z.enum(['ios', 'android', 'web']) }).parse(await c.req.json());
  const [row] = await db.insert(schema.devices).values({ userId: c.get('session').userId, ...body })
    .onConflictDoUpdate({ target: [schema.devices.userId, schema.devices.pushToken], set: { lastSeenAt: new Date() } }).returning();
  return c.json({ data: row }, 201);
});
engagementRoutes.delete('/devices', async (c) => {
  const { pushToken } = z.object({ pushToken: z.string() }).parse(await c.req.json());
  await db.delete(schema.devices).where(and(eq(schema.devices.userId, c.get('session').userId), eq(schema.devices.pushToken, pushToken)));
  return c.body(null, 204);
});
