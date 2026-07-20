import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { NotFoundError } from '@addis/shared';

export async function getRiderProfileId(userId: string): Promise<string> {
  const [profile] = await db.select({ id: schema.riderProfiles.id })
    .from(schema.riderProfiles)
    .where(eq(schema.riderProfiles.userId, userId));
  if (!profile) throw new NotFoundError('Rider profile not found');
  return profile.id;
}

export async function getContractorProfileId(userId: string): Promise<string> {
  const [profile] = await db.select({ id: schema.contractorProfiles.id })
    .from(schema.contractorProfiles)
    .where(eq(schema.contractorProfiles.userId, userId));
  if (!profile) throw new NotFoundError('Contractor profile not found');
  return profile.id;
}
