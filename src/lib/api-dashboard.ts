import { db } from "@/lib/db";

export async function GET_rider({ session }: any) {
  const [activeSubs, rides, payments, openTickets, unreadNotifs] =
    await Promise.all([
      db.subscription.findMany({
        where: { userId: session.id, status: "active" },
        include: { plan: true },
        orderBy: { endDate: "asc" },
      }),
      db.ride.findMany({
        where: { userId: session.id },
        include: { trip: { include: { route: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      db.payment.findMany({
        where: { userId: session.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      db.supportTicket.count({
        where: { userId: session.id, status: { in: ["open", "in_progress"] } },
      }),
      db.notification.count({ where: { userId: session.id, readAt: null } }),
    ]);
  return {
    data: {
      activeSubs,
      rides,
      recentPayments: payments,
      openTickets,
      unreadNotifs,
    },
  };
}

export async function GET_contractor({ session }: any) {
  const [shuttles, upcomingTrips, completedRides] = await Promise.all([
    db.shuttle.findMany({ where: { contractorId: session.id } }),
    db.trip.findMany({
      where: {
        driverId: session.id,
        status: "scheduled",
        departureAt: { gt: new Date() },
      },
      include: { route: true, shuttle: true },
      orderBy: { departureAt: "asc" },
      take: 10,
    }),
    db.ride.count({
      where: { trip: { driverId: session.id }, status: "completed" },
    }),
  ]);
  const profile = await db.contractorProfile.findUnique({
    where: { userId: session.id },
  });
  return { data: { profile, shuttles, upcomingTrips, completedRides } };
}

export async function GET_corporate({ session }: any) {
  const corp = await db.corporate.findUnique({
    where: { adminUserId: session.id },
    include: {
      members: {
        include: { user: { select: { name: true, phone: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      _count: { select: { subscriptions: true } },
    },
  });
  return { data: corp };
}

export async function GET_admin() {
  const [users, payments, subs, tickets, auditLogs] = await Promise.all([
    db.user.count(),
    db.payment.count(),
    db.subscription.count(),
    db.supportTicket.count({
      where: { status: { in: ["open", "in_progress"] } },
    }),
    db.auditLog.count(),
  ]);
  const recentPayments = await db.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      user: { select: { name: true, phone: true } },
      subscription: { include: { plan: true } },
    },
  });
  return {
    data: {
      counts: { users, payments, subs, tickets, auditLogs },
      recentPayments,
    },
  };
}

export async function GET_rider_active_trip({ session }: any) {
  const activeRide = await db.ride.findFirst({
    where: { userId: session.id, status: "boarded" },
    include: {
      trip: {
        include: {
          route: true,
          shuttle: { include: { contractor: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return { data: activeRide };
}
