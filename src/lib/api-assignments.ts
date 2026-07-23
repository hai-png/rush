
import { db } from '@/lib/db';
import { z } from 'zod';
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

export async function GET_pickups({ params }: any) {
  const pickups = await db.pickupLocation.findMany({
    where: { routeId: params.id, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  return { data: pickups };
}

const PickupInput = z.object({
  name: z.string().min(1).max(100),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  estimatedPickupTime: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

export async function POST_pickup({ session, params, body, ipAddress, userAgent }: any) {
  if (session.role !== 'platform_admin') throw new ForbiddenError('Admin only');
  const input = PickupInput.parse(body);
  const route = await db.route.findUnique({ where: { id: params.id } });
  if (!route) throw new NotFoundError('Route not found');
  // Strip undefined optionals so Prisma doesn't choke on { lat: undefined, lng: undefined }.
  const data: Record<string, unknown> = { name: input.name, sortOrder: input.sortOrder, routeId: params.id };
  if (input.lat !== undefined) data.lat = input.lat;
  if (input.lng !== undefined) data.lng = input.lng;
  if (input.estimatedPickupTime !== undefined) data.estimatedPickupTime = input.estimatedPickupTime;
  const pickup = await db.pickupLocation.create({ data: data as any });
  await audit({ actorId: session.id, action: 'pickup.created', entityType: 'pickup_location', entityId: pickup.id, after: input, ipAddress, userAgent });
  return { status: 201, data: pickup };
}

export async function DELETE_pickup({ session, params, ipAddress, userAgent }: any) {
  if (session.role !== 'platform_admin') throw new ForbiddenError('Admin only');
  await db.pickupLocation.update({ where: { id: params.id }, data: { isActive: false } });
  await audit({ actorId: session.id, action: 'pickup.deleted', entityType: 'pickup_location', entityId: params.id, ipAddress, userAgent });
  return { data: { id: params.id, isActive: false } };
}

export async function GET_assignments({ session }: any) {
  const now = new Date();
  const assignments = await db.routeAssignment.findMany({
    where: {
      status: { in: ['active', 'accepted'] },
      monthStart: { lte: now },
      monthEnd: { gte: now },
    },
    include: {
      route: { include: { pickups: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } } },
      shuttle: true,
      contractor: { select: { name: true, phone: true, contractorProfile: { select: { rating: true, verificationStatus: true } } } },
      _count: { select: { rides: true } },
    },
    orderBy: { monthStart: 'desc' },
    take: 50,
  });
  return { data: assignments };
}

export async function GET_assignment({ params }: any) {
  const assignment = await db.routeAssignment.findUnique({
    where: { id: params.id },
    include: {
      route: { include: { pickups: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } } },
      shuttle: true,
      contractor: { select: { name: true, phone: true } },
      trips: { orderBy: { departureAt: 'asc' }, take: 30 },
    },
  });
  if (!assignment) throw new NotFoundError('Assignment not found');
  return { data: assignment };
}

const AssignmentInput = z.object({
  routeId: z.string().min(1),
  contractorId: z.string().min(1),
  shuttleId: z.string().min(1),
  monthStart: z.string().datetime().optional(), // defaults to current month
  schedulePattern: z.object({
    days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])),
    windows: z.array(z.enum(['morning', 'evening'])),
  }),
});

export async function POST_assignment({ session, body, ipAddress, userAgent }: any) {
  if (session.role !== 'platform_admin') throw new ForbiddenError('Admin only');
  const input = AssignmentInput.parse(body);

  const [route, shuttle] = await Promise.all([
    db.route.findUnique({ where: { id: input.routeId } }),
    db.shuttle.findUnique({ where: { id: input.shuttleId } }),
  ]);
  if (!route || !route.isActive) throw new NotFoundError('Route not found');
  if (!shuttle) throw new NotFoundError('Shuttle not found');
  if (shuttle.contractorId !== input.contractorId) {
    throw new BadRequestError('Shuttle does not belong to this contractor');
  }

  const contractor = await db.user.findUnique({
    where: { id: input.contractorId },
    include: { contractorProfile: true },
  });
  if (!contractor || contractor.role !== 'contractor') {
    throw new NotFoundError('Contractor not found');
  }
  if (contractor.contractorProfile?.verificationStatus !== 'verified') {
    throw new BadRequestError('Contractor is not verified');
  }

  // Compute month start/end
  const now = new Date();
  const monthStart = input.monthStart ? new Date(input.monthStart) : new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59);

  const existing = await db.routeAssignment.findUnique({
    where: { routeId_contractorId_monthStart: { routeId: input.routeId, contractorId: input.contractorId, monthStart } },
  });
  if (existing) throw new ConflictError('Assignment already exists for this route+contractor+month');

  const assignment = await db.routeAssignment.create({
    data: {
      routeId: input.routeId,
      contractorId: input.contractorId,
      shuttleId: input.shuttleId,
      monthStart,
      monthEnd,
      schedulePattern: JSON.stringify(input.schedulePattern),
      status: 'assigned',
      maxSeats: shuttle.capacity,
      assignedById: session.id,
    },
    include: { route: true, shuttle: true, contractor: { select: { name: true } } },
  });

  await generateTripsFromAssignment(assignment);

  await audit({ actorId: session.id, action: 'assignment.created', entityType: 'route_assignment', entityId: assignment.id, after: input, ipAddress, userAgent });
  return { status: 201, data: assignment };
}

export async function generateTripsFromAssignment(assignment: any): Promise<number> {
  const pattern = JSON.parse(assignment.schedulePattern);
  const { days, windows } = pattern;
  if (!days || !windows || days.length === 0 || windows.length === 0) return 0;

  // P2 / BIZ-054: load active holidays so we skip trip generation on those dates.
  const holidays = await db.holiday.findMany({
    where: { isActive: true, date: { gte: assignment.monthStart, lte: assignment.monthEnd } },
    select: { date: true },
  });
  const holidayDates = new Set(holidays.map(h => h.date.toDateString()));

  // Walk through each day from monthStart to monthEnd
  const trips: any[] = [];
  const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const targetDays = new Set(days.map((d: string) => dayMap[d]));

  const cursor = new Date(assignment.monthStart);
  const end = new Date(assignment.monthEnd);

  while (cursor <= end) {
    if (targetDays.has(cursor.getDay()) && !holidayDates.has(cursor.toDateString())) {
      for (const window of windows) {
        const departureAt = new Date(cursor);
        // Morning = 7:30 AM, Evening = 5:30 PM
        if (window === 'morning') {
          departureAt.setHours(7, 30, 0, 0);
        } else {
          departureAt.setHours(17, 30, 0, 0);
        }
        trips.push({
          routeId: assignment.routeId,
          shuttleId: assignment.shuttleId,
          driverId: assignment.contractorId,
          departureAt,
          window,
          status: 'scheduled',
          assignmentId: assignment.id,
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (trips.length === 0) return 0;

  let created = 0;
  for (const trip of trips) {
    try {
      await db.trip.create({ data: trip });
      created++;
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
    }
  }
  logger.info({ assignmentId: assignment.id, created, total: trips.length, holidaysSkipped: holidayDates.size }, '[assignment] generated trips');
  return created;
}

export async function POST_accept_assignment({ session, params, ipAddress, userAgent }: any) {
  const assignment = await db.routeAssignment.findUnique({ where: { id: params.id } });
  if (!assignment) throw new NotFoundError('Assignment not found');
  if (assignment.contractorId !== session.id && session.role !== 'platform_admin') {
    throw new ForbiddenError('Not your assignment');
  }
  if (assignment.status !== 'assigned') throw new ConflictError(`Assignment is ${assignment.status}, not assigned`);

  // Transition assigned → accepted (contractor acknowledged) → active (trips
  // generated). For now we accept + activate in one step, but the 'accepted'
  // intermediate status is preserved per the schema's status comment.
  await db.routeAssignment.update({
    where: { id: params.id },
    data: { status: 'accepted', acceptedAt: new Date() },
  });
  // P0-10 / BIZ-012: pass the FULL assignment object (re-fetched with the new status),
  // not the ID string. generateTripsFromAssignment reads assignment.schedulePattern,
  // assignment.monthStart, etc. — passing assignment.id made all those undefined and
  // JSON.parse(undefined) threw silently inside the .catch() swallower.
  const freshAssignment = await db.routeAssignment.findUnique({ where: { id: params.id } });
  if (freshAssignment) {
    await generateTripsFromAssignment(freshAssignment).catch((err) => {
      // Don't silently swallow — log loudly. Trip generation failing is a real problem.
      logger.error({ err: (err as Error).message, assignmentId: params.id }, '[assignment.accept] trip generation failed');
    });
  }
  await db.routeAssignment.update({ where: { id: params.id }, data: { status: 'active' } });
  await audit({ actorId: session.id, action: 'assignment.accepted', entityType: 'route_assignment', entityId: params.id, ipAddress, userAgent });
  return { data: { id: params.id, status: 'active' } };
}

export async function POST_reject_assignment({ session, params, body, ipAddress, userAgent }: any) {
  const assignment = await db.routeAssignment.findUnique({
    where: { id: params.id },
    include: { route: true },
  });
  if (!assignment) throw new NotFoundError('Assignment not found');
  if (assignment.contractorId !== session.id && session.role !== 'platform_admin') {
    throw new ForbiddenError('Not your assignment');
  }
  if (assignment.status !== 'assigned') throw new ConflictError(`Assignment is ${assignment.status}, not assigned`);

  const { reason } = z.object({ reason: z.string().min(1).max(500) }).parse(body);
  await db.routeAssignment.update({
    where: { id: params.id },
    data: { status: 'cancelled' },
  });
  // Cancel all generated trips AND their booked rides (P0 / BIZ-011).
  // Notify affected riders.
  const tripsToCancel = await db.trip.findMany({
    where: { assignmentId: params.id, status: 'scheduled' },
    select: { id: true },
  });
  if (tripsToCancel.length > 0) {
    const tripIds = tripsToCancel.map(t => t.id);
    const ridesToCancel = await db.ride.findMany({
      where: { tripId: { in: tripIds }, status: { in: ['booked', 'boarded'] } },
      select: { id: true, userId: true, tripId: true, subscriptionId: true },
    });
    await db.$transaction(async (tx) => {
      await tx.ride.updateMany({
        where: { id: { in: ridesToCancel.map(r => r.id) } },
        data: { status: 'cancelled' },
      });
      await tx.trip.updateMany({
        where: { id: { in: tripIds } },
        data: { status: 'cancelled', seatsBooked: 0 },
      });
    });
    // Notify each affected rider (best-effort).
    const { enqueueNotification } = await import('@/lib/outbox');
    for (const r of ridesToCancel) {
      enqueueNotification({
        userId: r.userId,
        type: 'trip_cancelled',
        title: 'Trip cancelled',
        body: `Your trip on ${assignment.route?.origin ?? 'route'} → ${assignment.route?.destination ?? ''} was cancelled. ${reason}`,
        link: '/dashboard/rider',
      }).catch(() => {});
    }
  }
  await audit({ actorId: session.id, action: 'assignment.rejected', entityType: 'route_assignment', entityId: params.id, after: { reason, cancelledTrips: tripsToCancel.length }, ipAddress, userAgent });
  return { data: { id: params.id, status: 'cancelled', cancelledTrips: tripsToCancel.length } };
}

export async function GET_my_assignments({ session }: any) {
  if (session.role !== 'contractor' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Contractor only');
  }
  const assignments = await db.routeAssignment.findMany({
    where: session.role === 'platform_admin' ? {} : { contractorId: session.id },
    include: {
      route: true,
      shuttle: true,
      _count: { select: { trips: true, rides: true } },
    },
    orderBy: { monthStart: 'desc' },
    take: 50,
  });
  return { data: assignments };
}
