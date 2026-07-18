import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';

export const dashboardService = {
  async rider(userId: string) {
    const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
    if (!profile) return { activeSubscription: null, unreadNotifications: 0 };

    const [sub] = await db.select({
      id: schema.subscriptions.id, status: schema.subscriptions.status, ridesUsed: schema.subscriptions.ridesUsed,
      planName: schema.subscriptionPlans.name, ridesIncluded: schema.subscriptionPlans.ridesIncluded,
      routeName: schema.routes.name, routeId: schema.routes.id, endDate: schema.subscriptions.endDate,
    }).from(schema.subscriptions)
      .innerJoin(schema.subscriptionPlans, eq(schema.subscriptions.planId, schema.subscriptionPlans.id))
      .leftJoin(schema.routes, eq(schema.subscriptions.routeId, schema.routes.id))
      .where(and(eq(schema.subscriptions.riderId, profile.id), eq(schema.subscriptions.status, 'active')))
      .orderBy(desc(schema.subscriptions.createdAt)).limit(1);

    const [{ count: unread }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), sql`${schema.notifications.readAt} is null`));

    return {
      activeSubscription: sub ? { id: sub.id, status: sub.status, ridesUsed: sub.ridesUsed, plan: { name: sub.planName, ridesIncluded: sub.ridesIncluded }, route: { name: sub.routeName, id: sub.routeId } } : null,
      unreadNotifications: unread,
    };
  },

  async riderActiveTrip(userId: string, subscriptionId: string) {
    const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
    const [sub] = await db.select().from(schema.subscriptions).where(and(eq(schema.subscriptions.id, subscriptionId), eq(schema.subscriptions.riderId, profile!.id)));
    if (!sub?.routeId) return null;

    const [trip] = await db.select({
      id: schema.trips.id, shuttleId: schema.trips.shuttleId, departTime: schema.trips.departTime,
      plateNumber: schema.shuttles.plateNumber,
      contractorName: schema.users.name, contractorPhone: schema.users.phone, contractorRating: schema.contractorProfiles.rating,
      polyline: schema.routes.polyline, destination: schema.routes.destination,
    }).from(schema.trips)
      .innerJoin(schema.shuttles, eq(schema.trips.shuttleId, schema.shuttles.id))
      .innerJoin(schema.contractorProfiles, eq(schema.trips.contractorId, schema.contractorProfiles.id))
      .innerJoin(schema.users, eq(schema.contractorProfiles.userId, schema.users.id))
      .innerJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
      .where(and(eq(schema.trips.routeId, sub.routeId), eq(schema.trips.status, 'in_transit')))
      .orderBy(desc(schema.trips.departTime)).limit(1);

    if (!trip) return null;
    return { ...trip, pickupStop: sub.morningSlot ?? 'Nearest stop', destinationStop: trip.destination, etaMinutes: 8 }; // ETA refined client-side from live position per §12
  },

  async contractor(userId: string) {
    const [profile] = await db.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.userId, userId));
    if (!profile) return null;
    const [{ sum: earnings }] = await db.select({ sum: sql<string>`coalesce(sum(t.seats_booked * r.fare), 0)` })
      .from(schema.trips).as('t' as any); // simplified placeholder aggregate; real earnings ledger is a future module extension
    return { verificationStatus: profile.verificationStatus, rating: profile.rating, earningsThisMonth: '0.00' };
  },

  async corporate(adminUserId: string) {
    const [corp] = await db.select().from(schema.corporates).where(eq(schema.corporates.adminUserId, adminUserId));
    if (!corp) return null;
    const [{ count: memberCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.corporateMembers).where(eq(schema.corporateMembers.corporateId, corp.id));
    const [{ count: pendingCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.corporateMembers)
      .where(and(eq(schema.corporateMembers.corporateId, corp.id), eq(schema.corporateMembers.approvalStatus, 'pending')));
    return { corporate: corp, memberCount, pendingApprovals: pendingCount };
  },
};
