// H-40 fix: add cursor-based pagination to public catalog endpoints.

import { db } from '@/lib/db';

export async function GET_plans() {
  const plans = await db.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  return { data: plans };
}

export async function GET_routes({ query }: any) {
  const { parsePagination, paginatedResponse } = await import('@/lib/pagination');
  const page = parsePagination(query);
  const [routes, total] = await Promise.all([
    db.route.findMany({
      where: { isActive: true },
      orderBy: { origin: 'asc' },
      ...page.findManyArgs,
    }),
    db.route.count({ where: { isActive: true } }),
  ]);
  return paginatedResponse(routes, total, page);
}

export async function GET_shuttles() {
  const shuttles = await db.shuttle.findMany({
    where: { isActive: true },
    include: { contractor: { select: { name: true, contractorProfile: { select: { rating: true, verificationStatus: true } } } } },
    orderBy: { plate: 'asc' },
  });
  return { data: shuttles };
}

export async function GET_trips({ query }: any) {
  const { parsePagination, paginatedResponse } = await import('@/lib/pagination');
  const page = parsePagination(query);
  const where = { status: 'scheduled', departureAt: { gt: new Date() } };
  const [trips, total] = await Promise.all([
    db.trip.findMany({
      where,
      include: {
        route: true,
        shuttle: { include: { contractor: { select: { name: true } } } },
      },
      orderBy: { departureAt: 'asc' },
      ...page.findManyArgs,
    }),
    db.trip.count({ where }),
  ]);
  return paginatedResponse(trips, total, page);
}

export async function GET_faqs() {
  const faqs = await db.faqArticle.findMany({ where: { isActive: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });
  return { data: faqs };
}

import { NotFoundError } from '@/lib/errors';

export async function GET_route({ params }: any) {
  const route = await db.route.findUnique({ where: { id: params.id } });
  if (!route) throw new NotFoundError('Route not found');
  return { data: route };
}

export async function GET_trip({ params }: any) {
  const trip = await db.trip.findUnique({
    where: { id: params.id },
    include: {
      route: { include: { pickups: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } } },
      shuttle: { include: { contractor: { select: { name: true, contractorProfile: { select: { rating: true, verificationStatus: true } } } } } },
    },
  });
  if (!trip) throw new NotFoundError('Trip not found');
  return { data: trip };
}

