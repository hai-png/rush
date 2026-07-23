import { db, schema } from './client';
import { hashPassword } from '@addis/shared';

async function main() {

  if (process.env.NODE_ENV === 'production' && process.env.SEED_CONFIRM !== '1') {
    console.error('Refusing to seed in production. Set SEED_CONFIRM=1 to override (not recommended).');
    process.exit(1);
  }
  const [bole, cmc, sarbet, akaki, gerji, gotera] = await db.insert(schema.routes).values([
    mkRoute('Bole ↔ Merkato', 'Bole', 'Merkato', 12.5, 35),
    mkRoute('CMC ↔ Piazza', 'CMC', 'Piazza', 14.2, 40),
    mkRoute('Sarbet ↔ Kazanchis', 'Sarbet', 'Kazanchis', 8.1, 25),
    mkRoute('Akaki ↔ Meskel Square', 'Akaki', 'Meskel Square', 18.9, 50),
    mkRoute('Gerji ↔ Lideta', 'Gerji', 'Lideta', 15.0, 42),
    mkRoute('Gotera ↔ Piassa', 'Gotera', 'Piassa', 9.6, 28),
  ]).returning();

  await db.insert(schema.subscriptionPlans).values([
    { name: 'Two-Week Trial', durationDays: 14, ridesIncluded: 10, priceETB: '150.00', description: 'Try Addis Ride for two weeks.', isTrial: true },
    { name: 'Monthly Unlimited', durationDays: 30, ridesIncluded: -1, priceETB: '1200.00', description: 'Unlimited rides for a month.', isPopular: true },
    { name: 'Quarterly Saver', durationDays: 90, ridesIncluded: -1, priceETB: '3000.00', description: 'Best value — unlimited rides for 3 months.' },
  ]);

  const corpAdmins = await db.insert(schema.users).values([
    mkUser('+251911100001', 'ETH-TEL Admin', 'corporate_admin'),
    mkUser('+251911100002', 'CBE-HQ Admin', 'corporate_admin'),
    mkUser('+251911100003', 'AA-ADM Admin', 'corporate_admin'),
  ]).returning();

  await db.insert(schema.corporates).values([
    { code: 'ETH-TEL', name: 'Ethio Telecom', contactEmail: 'hr@ethiotelecom.et', contactPhone: '+251911100001', subsidyPercent: 60, monthlySeatAllowance: 24, adminUserId: corpAdmins[0].id },
    { code: 'CBE-HQ', name: 'Commercial Bank of Ethiopia HQ', contactEmail: 'hr@cbe.com.et', contactPhone: '+251911100002', subsidyPercent: 50, monthlySeatAllowance: 20, adminUserId: corpAdmins[1].id },
    { code: 'AA-ADM', name: 'Addis Ababa Administration', contactEmail: 'hr@addisababa.gov.et', contactPhone: '+251911100003', subsidyPercent: 70, monthlySeatAllowance: 30, adminUserId: corpAdmins[2].id },
  ]);

  const rider = await db.insert(schema.users).values(mkUser('+251922555999', 'Demo Rider', 'rider')).returning();
  await db.insert(schema.riderProfiles).values({ userId: rider[0].id, homeArea: 'Bole', workArea: 'Merkato' });

  const contractor = await db.insert(schema.users).values(mkUser('+251911000111', 'Demo Contractor', 'contractor')).returning();
  await db.insert(schema.contractorProfiles).values({ userId: contractor[0].id, licenseNumber: 'DL-000111', experienceYears: 5, verificationStatus: 'verified' });

  console.log('Seed complete.');
}

function mkRoute(name: string, origin: string, destination: string, distanceKm: number, durationMin: number) {
  return {
    name, origin, destination, distanceKm, durationMin,
    stops: [], polyline: [], originLatLng: mkCoord(origin), destLatLng: mkCoord(destination),
    morningWindow: { start: '06:30', end: '09:00' }, eveningWindow: { start: '16:30', end: '19:30' },
    fare: '60.00',
  };
}
async function mkUser(phone: string, name: string, role: 'rider' | 'contractor' | 'corporate_admin') {
  return { phone, name, role, passwordHash: await hashPassword('demo123456'), phoneVerified: true };
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
