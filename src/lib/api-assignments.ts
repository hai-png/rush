// Route assignments + pickup locations.
// schedule pattern (e.g. Mon-Fri → ~22 trips/month).

import { db } from '@/lib/db';
import { z } from 'zod';
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from '@/lib/errors';
import { audit } from '@/lib/audit';


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
  const pickup = await db.pickupLocation.create({
    data: { ...input, routeId: params.id },
  });
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

  // Validate route, contractor, shuttle exist
  const [route, shuttle] = await Promise.all([
    db.route.findUnique({ where: { id: input.routeId } }),
    db.shuttle.findUnique({ where: { id: input.shuttleId } }),
  ]);
  if (!route || !route.isActive) throw new NotFoundError('Route not found');
  if (!shuttle) throw new NotFoundError('Shuttle not found');
  if (shuttle.contractorId !== input.contractorId) {
    throw new BadRequestError('Shuttle does not belong to this contractor');
  }

  // Check contractor exists + is verified
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

  // Check for duplicate assignment (same route + contractor + month)
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

  // Generate trips from the schedule pattern
  await generateTripsFromAssignment(assignment);

  await audit({ actorId: session.id, action: 'assignment.created', entityType: 'route_assignment', entityId: assignment.id, after: input, ipAddress, userAgent });
  return { status: 201, data: assignment };
}

// Generate individual Trip rows from an assignment's schedule pattern.
// Runs on assignment creation + can be re-run by the cron to add next month's trips.
export async function generateTripsFromAssignment(assignment: any): Promise<number> {
  const pattern = JSON.parse(assignment.schedulePattern);
  const { days, windows } = pattern;
  if (!days || !windows || days.length === 0 || windows.length === 0) return 0;

  // Walk through each day from monthStart to monthEnd
  const trips: any[] = [];
  const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const targetDays = new Set(days.map((d: string) => dayMap[d]));

  const cursor = new Date(assignment.monthStart);
  const end = new Date(assignment.monthEnd);

  while (cursor <= end) {
    if (targetDays.has(cursor.getDay())) {
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

  // Bulk insert — skip duplicates (same routeId + shuttleId + departureAt)
  let created = 0;
  for (const trip of trips) {
    try {
      await db.trip.create({ data: trip });
      created++;
    } catch {
      // Duplicate — skip
    }
  }
  console.log(`[assignment ${assignment.id}] generated ${created}/${trips.length} trips`);
  return created;
}

export async function POST_accept_assignment({ session, params, ipAddress, userAgent }: any) {
  const assignment = await db.routeAssignment.findUnique({ where: { id: params.id } });
  if (!assignment) throw new NotFoundError('Assignment not found');
  if (assignment.contractorId !== session.id && session.role !== 'platform_admin') {
    throw new ForbiddenError('Not your assignment');
  }
  if (assignment.status !== 'assigned') throw new ConflictError(`Assignment is ${assignment.status}, not assigned`);

  await db.routeAssignment.update({
    where: { id: params.id },
    data: { status: 'active', acceptedAt: new Date() },
  });
  await audit({ actorId: session.id, action: 'assignment.accepted', entityType: 'route_assignment', entityId: params.id, ipAddress, userAgent });
  return { data: { id: params.id, status: 'active' } };
}

export async function POST_reject_assignment({ session, params, body, ipAddress, userAgent }: any) {
  const assignment = await db.routeAssignment.findUnique({ where: { id: params.id } });
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
  // Cancel all generated trips
  await db.trip.updateMany({
    where: { assignmentId: params.id, status: 'scheduled' },
    data: { status: 'cancelled' },
  });
  await audit({ actorId: session.id, action: 'assignment.rejected', entityType: 'route_assignment', entityId: params.id, after: { reason }, ipAddress, userAgent });
  return { data: { id: params.id, status: 'cancelled' } };
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
