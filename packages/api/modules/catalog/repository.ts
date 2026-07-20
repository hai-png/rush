import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { decodeCursor, encodeCursor } from '../../src/pagination';

export const catalogRepo = {
  async listRoutes(limit: number, cursor?: string) {
    const after = decodeCursor(cursor);
    const rows = await db.select().from(schema.routes)
      .where(and(eq(schema.routes.isActive, true), isNull(schema.routes.deletedAt), after ? gt(schema.routes.id, after) : undefined))
      .orderBy(schema.routes.id).limit(limit + 1);
    return paginate(rows, limit);
  },
  async listPlans() {
    return db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.isActive, true));
  },
  async listShuttles(limit: number, cursor?: string) {
    const after = decodeCursor(cursor);
    const rows = await db.select().from(schema.shuttles)
      .where(after ? gt(schema.shuttles.id, after) : undefined).orderBy(schema.shuttles.id).limit(limit + 1);
    return paginate(rows, limit);
  },
};

function paginate<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { rows: page, cursor: hasMore ? encodeCursor(page[page.length - 1]!.id) : undefined };
}
