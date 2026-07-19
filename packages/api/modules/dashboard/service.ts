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

    const unreadRow = await db.select({ count: sql<number>`count(*)::int` }).from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), sql`${schema.notifications.readAt} is null`));
    const unread = unreadRow[0]?.count ?? 0;

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

    // Sum of (seats booked × route fare) across this contractor's completed trips in the
    // current calendar month. The previous version referenced `r.fare` without ever
    // aliasing a `routes` table into the FROM clause, so the query was invalid SQL and
    // always threw — the catch-all '0.00' literal masked the failure. The contractor
    // dashboard's "This month" tile always showed ETB 0.00.
    const earningsRow = await db.execute(sql`
      select coalesce(sum(t.seats_booked * r.fare), 0)::text as earnings
      from trips t
      inner join routes r on r.id = t.route_id
      where t.contractor_id = ${profile.id}
        and t.status = 'completed'
        and date_trunc('month', t.depart_time) = date_trunc('month', now())
    `);
    // postgres-js returns rows as an array; the type is RowList<unknown[]> so we cast.
    const earningsRows = earningsRow as unknown as Array<{ earnings?: string }>;
    const earnings = earningsRows[0]?.earnings ?? '0.00';

    // The contractor dashboard's "Start trip" button needs a default shuttle + route to
    // pre-fill the form. Previously the dashboard returned neither, and the page tried to
    // call `startTrip.mutate({ shuttleId: data.shuttleId, routeId: data.routeId, ... })`
    // with both undefined, which Zod validation in the API immediately rejected. Surface
    // the contractor's first active shuttle (most contractors operate a single vehicle)
    // and a default route so the button is actually clickable.
    const [shuttle] = await db.select({ id: schema.shuttles.id, plateNumber: schema.shuttles.plateNumber })
      .from(schema.shuttles)
      .where(and(eq(schema.shuttles.contractorId, profile.id), eq(schema.shuttles.isActive, true)))
      .limit(1);
    const [route] = await db.select({ id: schema.routes.id, name: schema.routes.name })
      .from(schema.routes)
      .where(eq(schema.routes.isActive, true))
      .limit(1);

    return {
      verificationStatus: profile.verificationStatus,
      rating: profile.rating,
      earningsThisMonth: earnings,
      defaultShuttleId: shuttle?.id ?? null,
      defaultShuttlePlate: shuttle?.plateNumber ?? null,
      defaultRouteId: route?.id ?? null,
      defaultRouteName: route?.name ?? null,
    };
  },

  async corporate(adminUserId: string) {
    const [corp] = await db.select().from(schema.corporates).where(eq(schema.corporates.adminUserId, adminUserId));
    if (!corp) return null;
    const memberRows = await db.select({ count: sql<number>`count(*)::int` }).from(schema.corporateMembers).where(eq(schema.corporateMembers.corporateId, corp.id));
    const memberCount = memberRows[0]?.count ?? 0;
    const pendingRows = await db.select({ count: sql<number>`count(*)::int` }).from(schema.corporateMembers)
      .where(and(eq(schema.corporateMembers.corporateId, corp.id), eq(schema.corporateMembers.approvalStatus, 'pending')));
    const pendingCount = pendingRows[0]?.count ?? 0;
    return { corporate: corp, memberCount, pendingApprovals: pendingCount };
  },
};
