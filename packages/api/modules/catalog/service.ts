import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@addis/db';
import { NotFoundError, ConflictError } from '@addis/shared';
import { catalogRepo } from './repository';
import { CreateRouteInput, UpdateRouteInput, CreatePlanInput, UpdatePlanInput, CreateShuttleInput, UpdateShuttleInput } from './types';

export const catalogService = {
  listRoutes: catalogRepo.listRoutes,
  listPlans: catalogRepo.listPlans,
  listShuttles: catalogRepo.listShuttles,

  async getRoute(id: string) {
    const [r] = await db.select().from(schema.routes).where(eq(schema.routes.id, id));
    if (!r) throw new NotFoundError('Route not found');
    return r;
  },

  async createRoute(input: z.infer<typeof CreateRouteInput>) {
    try {
      const [row] = await db.insert(schema.routes).values(input as any).returning();
      return row;
    } catch (e: any) { if (e.code === '23505') throw new ConflictError('Route name already exists'); throw e; }
  },
  async updateRoute(id: string, input: z.infer<typeof UpdateRouteInput>) {
    const [row] = await db.update(schema.routes).set({ ...input, updatedAt: new Date() } as any).where(eq(schema.routes.id, id)).returning();
    if (!row) throw new NotFoundError('Route not found');
    return row;
  },
  async deleteRoute(id: string) {
    const [row] = await db.update(schema.routes).set({ deletedAt: new Date(), isActive: false }).where(eq(schema.routes.id, id)).returning();
    if (!row) throw new NotFoundError('Route not found');
  },

  async createPlan(input: z.infer<typeof CreatePlanInput>) {
    try {
      const [row] = await db.insert(schema.subscriptionPlans).values(input as any).returning();
      return row;
    } catch (e: any) { if (e.code === '23505') throw new ConflictError('Plan name already exists'); throw e; }
  },
  async updatePlan(id: string, input: z.infer<typeof UpdatePlanInput>) {
    const [row] = await db.update(schema.subscriptionPlans).set({ ...input, updatedAt: new Date() } as any).where(eq(schema.subscriptionPlans.id, id)).returning();
    if (!row) throw new NotFoundError('Plan not found');
    return row;
  },
  async deletePlan(id: string) {
    const [row] = await db.update(schema.subscriptionPlans).set({ isActive: false }).where(eq(schema.subscriptionPlans.id, id)).returning();
    if (!row) throw new NotFoundError('Plan not found');
  },

  async createShuttle(input: z.infer<typeof CreateShuttleInput>) {
    try {
      const [row] = await db.insert(schema.shuttles).values(input as any).returning();
      return row;
    } catch (e: any) { if (e.code === '23505') throw new ConflictError('Plate number already registered'); throw e; }
  },
  async updateShuttle(id: string, input: z.infer<typeof UpdateShuttleInput>) {
    const [row] = await db.update(schema.shuttles).set({ ...input, updatedAt: new Date() } as any).where(eq(schema.shuttles.id, id)).returning();
    if (!row) throw new NotFoundError('Shuttle not found');
    return row;
  },
  async deleteShuttle(id: string) {
    const [row] = await db.update(schema.shuttles).set({ isActive: false }).where(eq(schema.shuttles.id, id)).returning();
    if (!row) throw new NotFoundError('Shuttle not found');
  },
};
