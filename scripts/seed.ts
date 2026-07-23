
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// P1-2 / SEC-005: refuse to run the seed script in production with hardcoded
// demo credentials. If an operator runs `bun run db:seed` in production and
// doesn't manually change the admin password, an attacker logs in as
// +251911000001 / admin-pass-1234 with full platform_admin access.
//
// To run the seed in production (e.g. for a fresh deploy), set
// SEED_ALLOW_PRODUCTION=1 AND override each password via env vars:
//   SEED_ADMIN_PASSWORD, SEED_RIDER_PASSWORD, SEED_CONTRACTOR_PASSWORD.
const isProd = process.env.NODE_ENV === 'production';
const allowProdSeed = process.env.SEED_ALLOW_PRODUCTION === '1';
if (isProd && !allowProdSeed) {
  console.error('Refusing to seed in production with hardcoded demo credentials.');
  console.error('Set SEED_ALLOW_PRODUCTION=1 AND override SEED_ADMIN_PASSWORD / SEED_RIDER_PASSWORD / SEED_CONTRACTOR_PASSWORD to proceed.');
  process.exit(1);
}
// P1 FIX: in production with SEED_ALLOW_PRODUCTION=1, require all three
// password env vars to be set — don't fall back to hardcoded defaults.
if (isProd && allowProdSeed) {
  if (!process.env.SEED_ADMIN_PASSWORD || !process.env.SEED_RIDER_PASSWORD || !process.env.SEED_CONTRACTOR_PASSWORD) {
    console.error('SEED_ALLOW_PRODUCTION=1 is set but SEED_ADMIN_PASSWORD / SEED_RIDER_PASSWORD / SEED_CONTRACTOR_PASSWORD are not all provided.');
    console.error('Refusing to seed with hardcoded demo passwords in production.');
    process.exit(1);
  }
}

const adminPwd = process.env.SEED_ADMIN_PASSWORD ?? 'admin-pass-1234';
const riderPwd = process.env.SEED_RIDER_PASSWORD ?? 'rider-pass-1234';
const contractorPwd = process.env.SEED_CONTRACTOR_PASSWORD ?? 'contractor-pass-1234';

async function main() {
  console.log('Seeding...');

  const adminPassword = await bcrypt.hash(adminPwd, 12);
  const admin = await prisma.user.upsert({
    where: { phone: '+251911000001' },
    update: {},
    create: {
      phone: '+251911000001',
      email: 'admin@addisride.et',
      passwordHash: adminPassword,
      name: 'Platform Admin',
      role: 'platform_admin',
      phoneVerified: true,
      tosVersion: '2026-01-01',
    },
  });
  if (isProd) {
    console.log(`  admin: ${admin.phone} / (password set from SEED_ADMIN_PASSWORD env var)`);
  } else {
    console.log(`  admin: ${admin.phone} / ${adminPwd}`);
  }

  const riderPassword = await bcrypt.hash(riderPwd, 12);
  const rider = await prisma.user.upsert({
    where: { phone: '+251911000002' },
    update: {},
    create: {
      phone: '+251911000002',
      email: 'rider@addisride.et',
      passwordHash: riderPassword,
      name: 'Demo Rider',
      role: 'rider',
      phoneVerified: true,
      tosVersion: '2026-01-01',
      riderProfile: { create: { homeArea: 'Bole', workArea: 'Merkato' } },
    },
  });
  if (isProd) {
    console.log(`  rider: ${rider.phone} / (password set from SEED_RIDER_PASSWORD env var)`);
  } else {
    console.log(`  rider: ${rider.phone} / ${riderPwd}`);
  }

  const contractorPassword = await bcrypt.hash(contractorPwd, 12);
  const contractor = await prisma.user.upsert({
    where: { phone: '+251911000003' },
    update: {},
    create: {
      phone: '+251911000003',
      email: 'contractor@addisride.et',
      passwordHash: contractorPassword,
      name: 'Demo Contractor',
      role: 'contractor',
      phoneVerified: true,
      tosVersion: '2026-01-01',
      contractorProfile: {
        create: {
          licenseNumber: 'DL-001',
          experienceYears: 5,
          verificationStatus: 'verified',
        },
      },
    },
  });
  if (isProd) {
    console.log(`  contractor: ${contractor.phone} / (password set from SEED_CONTRACTOR_PASSWORD env var)`);
  } else {
    console.log(`  contractor: ${contractor.phone} / ${contractorPwd}`);
  }

  const trialPlan = await prisma.subscriptionPlan.upsert({
    where: { slug: 'trial' },
    update: {},
    create: {
      slug: 'trial',
      name: '2-Week Trial',
      description: '14-day trial, 10 rides — paid introduction',
      priceCents: 50000, // 500 ETB (paid, not free)
      ridesIncluded: 10,
      durationDays: 14,
      isTrial: true,
      sortOrder: 0,
    },
  });
  const monthlyPlan = await prisma.subscriptionPlan.upsert({
    where: { slug: 'monthly-30' },
    update: {},
    create: {
      slug: 'monthly-30',
      name: 'Monthly 30',
      description: '30 rides per month',
      priceCents: 150000, // 1500 ETB
      ridesIncluded: 30,
      durationDays: 30,
      sortOrder: 1,
    },
  });
  const monthlyUnlimited = await prisma.subscriptionPlan.upsert({
    where: { slug: 'monthly-unlimited' },
    update: {},
    create: {
      slug: 'monthly-unlimited',
      name: 'Monthly Unlimited',
      description: 'Unlimited rides for 30 days',
      priceCents: 300000, // 3000 ETB
      ridesIncluded: -1,
      durationDays: 30,
      sortOrder: 2,
    },
  });
  console.log(`  plans: ${trialPlan.slug}, ${monthlyPlan.slug}, ${monthlyUnlimited.slug}`);

  // Route
  const route = await prisma.route.upsert({
    where: { id: 'route-bole-merkato' },
    update: {},
    create: {
      id: 'route-bole-merkato',
      origin: 'Bole',
      destination: 'Merkato',
      distanceKm: 12.5,
      durationMin: 45,
      fareCents: 5000, // 50 ETB
    },
  });
  console.log(`  route: ${route.origin} → ${route.destination}`);

  // Pickup locations for the route
  const pickups = [
    { name: 'Bole Friendship', lat: 9.0085, lng: 38.7575, estimatedPickupTime: '07:00', sortOrder: 0 },
    { name: 'Bole Rwanda', lat: 9.0132, lng: 38.7645, estimatedPickupTime: '07:10', sortOrder: 1 },
    { name: 'CMC', lat: 9.0220, lng: 38.7820, estimatedPickupTime: '07:20', sortOrder: 2 },
    { name: 'Megenagna', lat: 9.0320, lng: 38.8020, estimatedPickupTime: '07:30', sortOrder: 3 },
  ];
  for (const p of pickups) {
    await prisma.pickupLocation.upsert({
      where: { id: `pickup-${p.name.toLowerCase().replace(/\s+/g, '-')}` },
      update: {},
      create: { id: `pickup-${p.name.toLowerCase().replace(/\s+/g, '-')}`, routeId: route.id, ...p },
    });
  }
  console.log(`  pickups: ${pickups.length} locations`);

  // Shuttle
  const shuttle = await prisma.shuttle.upsert({
    where: { plate: 'AA-12345' },
    update: {},
    create: {
      plate: 'AA-12345',
      model: 'Toyota Coaster',
      vehicleType: 'coaster',
      capacity: 30,
      year: 2022,
      contractorId: contractor.id,
    },
  });
  console.log(`  shuttle: ${shuttle.plate}`);

  // Route assignment — contractor commits to this route for the current month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const assignment = await prisma.routeAssignment.upsert({
    where: { routeId_contractorId_monthStart: { routeId: route.id, contractorId: contractor.id, monthStart } },
    update: {},
    create: {
      routeId: route.id,
      contractorId: contractor.id,
      shuttleId: shuttle.id,
      monthStart,
      monthEnd,
      schedulePattern: JSON.stringify({ days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: ['morning', 'evening'] }),
      status: 'active',
      maxSeats: shuttle.capacity,
      assignedById: admin.id,
      acceptedAt: now,
    },
  });
  console.log(`  assignment: ${assignment.id} (${assignment.status})`);

  // P3 / DB-047: generate trips from the assignment's schedule pattern.
  // Previously the seed only created one manual trip (trip-demo-001) and
  // never called generateTripsFromAssignment, so the dev environment was
  // sparse — only 1 trip instead of ~22 (Mon-Fri × morning+evening).
  try {
    const { generateTripsFromAssignment } = await import('../src/lib/api-assignments');
    const generated = await generateTripsFromAssignment(assignment);
    console.log(`  trips generated from assignment: ${generated}`);
  } catch (err) {
    console.log(`  (trip generation skipped: ${(err as Error).message})`);
  }

  // Also create the manual demo trip (for e2e tests that reference trip-demo-001).
  const trip = await prisma.trip.upsert({
    where: { id: 'trip-demo-001' },
    update: {},
    create: {
      id: 'trip-demo-001',
      routeId: route.id,
      shuttleId: shuttle.id,
      driverId: contractor.id,
      departureAt: new Date(Date.now() + 24 * 3600_000),
      window: 'morning',
      status: 'scheduled',
      assignmentId: assignment.id,
    },
  });
  console.log(`  trip: ${trip.id}`);

  // FAQ
  await prisma.faqArticle.upsert({
    where: { id: 'faq-1' },
    update: {},
    create: {
      id: 'faq-1',
      category: 'billing',
      question: 'How do I pay for my subscription?',
      answer: 'You can pay via Telebirr or CBE Birr manual transfer. Telebirr is instant; CBE takes up to 1 business day.',
      sortOrder: 0,
    },
  });

  console.log('Seed done.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
