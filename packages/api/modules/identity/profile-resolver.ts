import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { NotFoundError } from '@addis/shared';

/**
 * Resolves the caller's user ID (from the session) to their rider_profiles.id.
 *
 * The subscriptions/payments/rides/seat_releases/seat_claims tables all have
 * `rider_id` FKs pointing at rider_profiles.id — NOT users.id. Routes that
 * receive `session.userId` and pass it directly as `riderId` to these tables
 * trigger FK constraint violations at runtime.
 *
 * This helper does the one-step lookup and throws NotFoundError if the caller
 * has no rider profile (e.g. a contractor or corporate_admin trying to use a
 * rider-only endpoint — requireRole('rider') should have caught this, but
 * defense-in-depth).
 */
export async function getRiderProfileId(userId: string): Promise<string> {
  const [profile] = await db.select({ id: schema.riderProfiles.id })
    .from(schema.riderProfiles)
    .where(eq(schema.riderProfiles.userId, userId));
  if (!profile) throw new NotFoundError('Rider profile not found');
  return profile.id;
}

/**
 * Resolves the caller's user ID to their contractor_profiles.id.
 * Same pattern as getRiderProfileId — the trips/shuttle_positions tables
 * reference contractor_profiles.id, not users.id.
 */
export async function getContractorProfileId(userId: string): Promise<string> {
  const [profile] = await db.select({ id: schema.contractorProfiles.id })
    .from(schema.contractorProfiles)
    .where(eq(schema.contractorProfiles.userId, userId));
  if (!profile) throw new NotFoundError('Contractor profile not found');
  return profile.id;
}
