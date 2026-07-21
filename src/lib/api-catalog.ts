// Catalog — public read endpoints for plans, routes, shuttles, trips, FAQs.
import { db } from '@/lib/db';

export async function GET_plans() {
  const plans = await db.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  return { data: plans };
}

export async function GET_routes() {
  const routes = await db.route.findMany({ where: { isActive: true }, orderBy: { origin: 'asc' } });
  return { data: routes };
}

export async function GET_shuttles() {
  const shuttles = await db.shuttle.findMany({
    where: { isActive: true },
    include: { contractor: { select: { name: true, contractorProfile: { select: { rating: true, verificationStatus: true } } } } },
    orderBy: { plate: 'asc' },
  });
  return { data: shuttles };
}

export async function GET_trips() {
  const trips = await db.trip.findMany({
    where: { status: 'scheduled', departureAt: { gt: new Date() } },
    include: {
      route: true,
      shuttle: { include: { contractor: { select: { name: true } } } },
    },
    orderBy: { departureAt: 'asc' },
    take: 50,
  });
  return { data: trips };
}

export async function GET_faqs() {
  const faqs = await db.faqArticle.findMany({ where: { isActive: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });
  return { data: faqs };
}
