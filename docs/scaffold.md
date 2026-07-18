# Addis Ride — Systematic Implementation

Given the scope of this spec (a full monorepo platform), I'm implementing it in **layers of depth**: the domain core (schema, money, state machines), the highest-risk business logic (payments, subscriptions, seat marketplace — because money bugs are the ones that bankrupt a startup), then the supporting scaffolding (auth, worker, API wiring), with lighter-weight but structurally-consistent stubs for peripheral modules (support/engagement/admin/corporate CRUD) that follow the same pattern and can be filled in mechanically.

I'll go top-down: repo scaffolding → shared kernel → DB → services/payments → api modules → worker → web wiring.

---

## Phase 0 — Monorepo scaffolding

```jsonc
// package.json
{
  "name": "addis-ride",
  "private": true,
  "workspaces": ["apps/*", "packages/*", "services/*"],
  "packageManager": "bun@1.1.42",
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint && dependency-cruiser --validate .dependency-cruiser.cjs packages apps services",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:integration": "turbo run test:integration",
    "db:generate": "bun run --cwd packages/db generate",
    "db:migrate": "bun run --cwd packages/db migrate",
    "db:seed": "bun run --cwd packages/db seed",
    "openapi:gen": "bun run --cwd packages/api openapi:gen",
    "sdk:gen": "openapi-typescript packages/api/openapi.json -o packages/sdk/src/schema.d.ts"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "dependency-cruiser": "^16.0.0",
    "vitest": "^2.1.0",
    "@playwright/test": "^1.49.0"
  }
}
```

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "test:integration": { "dependsOn": ["^build"], "cache": false }
  }
}
```

```js
// .dependency-cruiser.cjs
module.exports = {
  forbidden: [
    { name: 'no-packages-to-apps', from: { path: '^packages' }, to: { path: '^(apps|services)' } },
    { name: 'no-services-to-apps', from: { path: '^services' }, to: { path: '^apps' } },
    { name: 'no-circular', from: {}, to: { circular: true } },
    {
      name: 'modules-only-via-types',
      from: { path: '^packages/api/modules/([^/]+)/', pathNot: '^packages/api/modules/$1/' },
      to: { path: '^packages/api/modules/([^/]+)/(service|repository)\\.ts$' },
      comment: 'Cross-module imports must go through types.ts, never service/repository directly.'
    }
  ],
  options: { doNotFollow: { path: 'node_modules' }, tsConfig: { fileName: 'tsconfig.base.json' } }
};
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "esModuleInterop": true, "skipLibCheck": true, "isolatedModules": true,
    "resolveJsonModule": true, "declaration": true,
    "paths": {
      "@addis/shared": ["packages/shared/src/index.ts"],
      "@addis/db": ["packages/db/src/index.ts"],
      "@addis/api": ["packages/api/src/index.ts"],
      "@addis/sdk": ["packages/sdk/src/index.ts"],
      "@addis/ui": ["packages/ui/src/index.ts"],
      "@addis/i18n": ["packages/i18n/src/index.ts"]
    }
  }
}
```

---

## Phase 1 — `packages/shared` (the kernel everything else depends on)

```ts
// packages/shared/src/enums.ts
export type UserRole = 'rider' | 'contractor' | 'corporate_admin' | 'platform_admin';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type SubscriptionStatus = 'pending_payment' | 'active' | 'expired' | 'cancelled';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'partially_refunded';
export type PaymentMethod = 'telebirr' | 'cbe';
export type RefundStatus = 'pending' | 'succeeded' | 'failed' | 'permanent_failure';
export type TripStatus = 'scheduled' | 'in_transit' | 'completed' | 'cancelled';
export type RideStatus = 'booked' | 'boarded' | 'completed' | 'no_show' | 'cancelled';
export type SeatReleaseStatus = 'open' | 'claimed' | 'expired' | 'cancelled';
export type SeatClaimStatus = 'confirmed' | 'used' | 'no_show' | 'refunded';
export type SeatWindow = 'morning' | 'evening';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketCategory = 'general' | 'billing' | 'route' | 'shuttle' | 'account' | 'corporate' | 'other';
export type FaqCategory = 'billing' | 'routes' | 'shuttle' | 'account' | 'corporate' | 'general';
export type NotificationType =
  | 'payment_received' | 'payment_failed' | 'refund_completed' | 'refund_failed'
  | 'seat_claimed' | 'seat_released' | 'seat_release_expired'
  | 'subscription_expiring' | 'subscription_expired' | 'subscription_cancelled'
  | 'trip_departing' | 'document_verified' | 'document_rejected'
  | 'support_reply' | 'support_resolved'
  | 'corporate_member_added' | 'corporate_member_removed' | 'corporate_reset'
  | 'general';
export type OtpPurpose = 'signup_verification' | 'password_reset' | 'phone_change';
export type VehicleType = 'coaster' | 'minibus' | 'van' | 'sedan';
export type OutboxChannel = 'notification' | 'sms' | 'push' | 'email' | 'refund' | 'audit' | 'webhook';

export const ALL_ROLES: UserRole[] = ['rider', 'contractor', 'corporate_admin', 'platform_admin'];
export const TWO_FA_REQUIRED_ROLES: UserRole[] = ['platform_admin', 'corporate_admin'];
```

```ts
// packages/shared/src/money.ts
import { Decimal } from 'decimal.js';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export class Money {
  static ZERO = new Money(new Decimal(0));
  readonly currency = 'ETB' as const;
  private constructor(public readonly amount: Decimal) {}

  static fromDecimal(d: Decimal | string | number): Money {
    return new Money(new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  }
  static fromETBString(s: string): Money {
    if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid ETB amount: ${s}`);
    return Money.fromDecimal(s);
  }

  add(o: Money): Money { return new Money(this.amount.plus(o.amount)); }
  sub(o: Money): Money { return new Money(Decimal.max(0, this.amount.minus(o.amount))); }
  mul(n: number | Decimal): Money { return new Money(this.amount.mul(n).toDecimalPlaces(2)); }
  div(n: number | Decimal): Money { return new Money(this.amount.div(n).toDecimalPlaces(2)); }
  pct(p: number): Money { return this.mul(p).div(100); }
  gte(o: Money): boolean { return this.amount.gte(o.amount); }
  gt(o: Money): boolean { return this.amount.gt(o.amount); }
  eq(o: Money): boolean { return this.amount.eq(o.amount); }
  isPositive(): boolean { return this.amount.gt(0); }
  isZero(): boolean { return this.amount.eq(0); }
  toString(): string { return this.amount.toFixed(2); }
  toJSON(): string { return this.toString(); }
  toNumber(): number { return this.amount.toNumber(); }
}

export function computeSubsidy(price: Money, pct: number): Money {
  return price.pct(pct);
}

export function computeEmployeeShare(price: Money, subsidyPct: number): Money {
  return price.sub(computeSubsidy(price, subsidyPct));
}

/** Prorated per-ride refund value used by the seat-release marketplace. */
export function proratedRideValue(planPrice: Money, ridesIncluded: number, routeFare: Money): Money {
  if (ridesIncluded <= 0) return routeFare; // unlimited plan -> use route fare as ride value
  return planPrice.div(ridesIncluded);
}
```

```ts
// packages/shared/src/errors.ts
export class AppError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) { super(message); }
}
export class BadRequestError extends AppError { constructor(m: string, d?: unknown) { super(400, 'BAD_REQUEST', m, d); } }
export class UnauthorizedError extends AppError { constructor(m = 'Unauthorized') { super(401, 'UNAUTHORIZED', m); } }
export class ForbiddenError extends AppError { constructor(m = 'Forbidden') { super(403, 'FORBIDDEN', m); } }
export class NotFoundError extends AppError { constructor(m = 'Not found') { super(404, 'NOT_FOUND', m); } }
export class ConflictError extends AppError { constructor(m: string, d?: unknown) { super(409, 'CONFLICT', m, d); } }
export class PaymentRequiredError extends AppError { constructor(m = 'Payment required') { super(402, 'PAYMENT_REQUIRED', m); } }
export class RateLimitError extends AppError {
  constructor(public readonly retryAfterSec: number) { super(429, 'RATE_LIMITED', 'Too many requests'); }
}

export function toErrorEnvelope(err: unknown, requestId: string) {
  if (err instanceof AppError) {
    return { status: err.httpStatus, body: { error: { code: err.code, message: err.message, details: err.details, requestId } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Internal server error', requestId } } };
}
```

```ts
// packages/shared/src/state-machine.ts
export type Transition<S extends string> = {
  from: S; to: S; event: string; sideEffects?: string[];
  guard?: (ctx: unknown) => boolean | Promise<boolean>;
};

export class InvalidTransitionError extends Error {
  constructor(from: string, event: string) { super(`No transition from '${from}' on event '${event}'`); }
}

export function defineStateMachine<S extends string>(def: { initial: S; transitions: Transition<S>[] }) {
  return {
    initial: def.initial,
    transitions: def.transitions,
    /** Pure: resolve next state for (current, event); throws if illegal. */
    resolve(current: S, event: string): Transition<S> {
      const t = def.transitions.find(t => t.from === current && t.event === event);
      if (!t) throw new InvalidTransitionError(current, event);
      return t;
    },
    can(current: S, event: string): boolean {
      return def.transitions.some(t => t.from === current && t.event === event);
    },
  };
}
```

```ts
// packages/shared/src/password.ts
import bcrypt from 'bcryptjs';

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

export function validatePasswordShape(pw: string): void {
  if (pw.length < 10) throw new Error('Password must be at least 10 characters');
  if (pw.length > 1000) throw new Error('Password too long');
  if (CONTROL_CHAR_RE.test(pw)) throw new Error('Password contains invalid characters');
}

export async function hashPassword(pw: string, cost = Number(process.env.BCRYPT_COST ?? 12)): Promise<string> {
  validatePasswordShape(pw);
  return bcrypt.hash(pw, cost);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/** HIBP k-anonymity check. Fail-soft: network error => allow. */
export async function isPasswordBreached(pw: string): Promise<boolean> {
  try {
    const { createHash } = await import('node:crypto');
    const sha1 = createHash('sha1').update(pw).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split('\n').some(line => line.split(':')[0] === suffix);
  } catch {
    return false; // fail-soft
  }
}
```

```ts
// packages/shared/src/legal.ts
export const CURRENT_TOS_VERSION = 'v2_0' as const;
export const DPO_CONTACT = 'dpo@addisride.et';
export const PAYMENT_RETENTION_YEARS = 7;
export const AUDIT_RETENTION_YEARS = 7;
export const ACCOUNT_DELETION_GRACE_DAYS = 30;
```

```ts
// packages/shared/src/env.ts
import { z } from 'zod';

const PLACEHOLDER_SECRETS = ['changeme', 'secret', 'password', ''];

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']),
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32).refine(s => !PLACEHOLDER_SECRETS.includes(s.toLowerCase())),
  NEXTAUTH_URL: z.string().url(),
  CRON_SECRET: z.string().min(32).optional(),
  REDIS_URL: z.string().url().optional(),

  TELEBIRR_FABRIC_APP_ID: z.string().optional(),
  TELEBIRR_APP_SECRET: z.string().optional(),
  TELEBIRR_MERCHANT_APP_ID: z.string().optional(),
  TELEBIRR_MERCHANT_CODE: z.string().optional(),
  TELEBIRR_PRIVATE_KEY: z.string().optional(),
  TELEBIRR_PUBLIC_KEY: z.string().optional(),
  TELEBIRR_ENV: z.enum(['testbed', 'production']).default('production'),
  TELEBIRR_NOTIFY_URL: z.string().url(),
  TELEBIRR_REDIRECT_URL: z.string().url(),

  CBE_ACCOUNT_NUMBER: z.string().optional(),
  CBE_ACCOUNT_NAME: z.string().optional(),
  CBE_BANK_BRANCH: z.string().optional(),

  AFRICAS_TALKING_API_KEY: z.string().optional(),
  AFRICAS_TALKING_USERNAME: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),

  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  NEXT_PUBLIC_TILE_SERVER_URL: z.string().url().optional(),
  NEXT_PUBLIC_CARTO_API_KEY: z.string().optional(),
  NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: z.string().optional(),
}).refine(d => {
  const t = [d.TELEBIRR_FABRIC_APP_ID, d.TELEBIRR_APP_SECRET, d.TELEBIRR_MERCHANT_APP_ID,
    d.TELEBIRR_MERCHANT_CODE, d.TELEBIRR_PRIVATE_KEY, d.TELEBIRR_PUBLIC_KEY];
  const set = t.filter(Boolean).length;
  return set === 0 || set === 6;
}, { message: 'Telebirr config must be all set or all unset' });

export type Env = z.infer<typeof envSchema>;
let cached: Env | null = null;
export function loadEnv(): Env {
  if (cached) return cached;
  cached = envSchema.parse(process.env);
  return cached;
}
```

```ts
// packages/shared/src/schemas/common.ts
import { z } from 'zod';

export const Id = z.string().cuid2();
export const EthiopianPhone = z.string().regex(/^\+251(9|7)\d{8}$/, 'Must be a valid Ethiopian phone (+2519XXXXXXXX)');
export const MoneyString = z.string().regex(/^\d+(\.\d{2})?$/, 'Must be ETB amount with 2dp');
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24h');
export const CursorQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export const ErrorSchema = z.object({
  error: z.object({
    code: z.string(), message: z.string(),
    details: z.array(z.any()).optional(),
    requestId: z.string(),
  }),
});
export function envelope<T extends z.ZodTypeAny>(schema: T) {
  return z.object({ data: schema, meta: z.object({ cursor: z.string().optional(), limit: z.number(), total: z.number().optional() }).optional() });
}
```

---

## Phase 2 — `packages/db` (Drizzle schema)

```ts
// packages/db/src/schema.ts
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, text, boolean, integer, real, decimal, jsonb,
  timestamp, date, index, uniqueIndex, check,
} from 'drizzle-orm/pg-core';

// ---------- enums ----------
export const userRole = pgEnum('user_role', ['rider', 'contractor', 'corporate_admin', 'platform_admin']);
export const verificationStatus = pgEnum('verification_status', ['unverified', 'pending', 'verified', 'rejected']);
export const subscriptionStatus = pgEnum('subscription_status', ['pending_payment', 'active', 'expired', 'cancelled']);
export const paymentStatus = pgEnum('payment_status', ['pending', 'completed', 'failed', 'refunded', 'partially_refunded']);
export const paymentMethod = pgEnum('payment_method', ['telebirr', 'cbe']);
export const refundStatus = pgEnum('refund_status', ['pending', 'succeeded', 'failed', 'permanent_failure']);
export const tripStatus = pgEnum('trip_status', ['scheduled', 'in_transit', 'completed', 'cancelled']);
export const rideStatus = pgEnum('ride_status', ['booked', 'boarded', 'completed', 'no_show', 'cancelled']);
export const seatReleaseStatus = pgEnum('seat_release_status', ['open', 'claimed', 'expired', 'cancelled']);
export const seatClaimStatus = pgEnum('seat_claim_status', ['confirmed', 'used', 'no_show', 'refunded']);
export const seatWindow = pgEnum('seat_window', ['morning', 'evening']);
export const ticketStatus = pgEnum('ticket_status', ['open', 'in_progress', 'resolved', 'closed']);
export const ticketPriority = pgEnum('ticket_priority', ['low', 'normal', 'high', 'urgent']);
export const ticketCategory = pgEnum('ticket_category', ['general', 'billing', 'route', 'shuttle', 'account', 'corporate', 'other']);
export const faqCategory = pgEnum('faq_category', ['billing', 'routes', 'shuttle', 'account', 'corporate', 'general']);
export const notificationType = pgEnum('notification_type', [
  'payment_received', 'payment_failed', 'refund_completed', 'refund_failed',
  'seat_claimed', 'seat_released', 'seat_release_expired',
  'subscription_expiring', 'subscription_expired', 'subscription_cancelled',
  'trip_departing', 'document_verified', 'document_rejected',
  'support_reply', 'support_resolved',
  'corporate_member_added', 'corporate_member_removed', 'corporate_reset', 'general',
]);
export const otpPurpose = pgEnum('otp_purpose', ['signup_verification', 'password_reset', 'phone_change']);
export const vehicleType = pgEnum('vehicle_type', ['coaster', 'minibus', 'van', 'sedan']);
export const outboxChannel = pgEnum('outbox_channel', ['notification', 'sms', 'push', 'email', 'refund', 'audit', 'webhook']);

const ts = () => timestamp({ withTimezone: true });
const money = (name: string) => decimal(name, { precision: 12, scale: 2 });

// ---------- tables ----------
export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(createId),
  phone: text('phone').notNull().unique(),
  email: text('email'),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: userRole('role').notNull().default('rider'),
  phoneVerified: boolean('phone_verified').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: ts()('deleted_at'),
  tokenVersion: integer('token_version').notNull().default(0),
  twoFactorSecret: text('two_factor_secret'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  tosVersion: text('tos_version'),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({ activeIdx: index().on(t.isActive, t.deletedAt) }));

export const riderProfiles = pgTable('rider_profiles', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  homeArea: text('home_area').notNull(),
  workArea: text('work_area').notNull(),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
});

export const contractorProfiles = pgTable('contractor_profiles', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  licenseNumber: text('license_number').notNull().unique(),
  experienceYears: integer('experience_years').notNull().default(0),
  rating: real('rating').notNull().default(5.0),
  verificationStatus: verificationStatus('verification_status').notNull().default('unverified'),
  verificationReason: text('verification_reason'),
  verifiedById: text('verified_by_id').references((): any => users.id, { onDelete: 'set null' }),
  verifiedAt: ts()('verified_at'),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
});

export const contractorDocuments = pgTable('contractor_documents', {
  id: text('id').primaryKey().$defaultFn(createId),
  contractorId: text('contractor_id').notNull().references(() => contractorProfiles.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  originalFilename: text('original_filename').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  checksumSha256: text('checksum_sha256').notNull(),
  uploadedAt: ts()('uploaded_at').notNull().defaultNow(),
}, (t) => ({ contractorIdx: index().on(t.contractorId, t.type) }));

export const corporates = pgTable('corporates', {
  id: text('id').primaryKey().$defaultFn(createId),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  contactEmail: text('contact_email').notNull(),
  contactPhone: text('contact_phone').notNull(),
  subsidyPercent: integer('subsidy_percent').notNull().default(50),
  monthlySeatAllowance: integer('monthly_seat_allowance').notNull().default(20),
  adminUserId: text('admin_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }).unique(),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: ts()('deleted_at'),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({ subsidyCheck: check('subsidy_range', sql`${t.subsidyPercent} between 0 and 100`) }));

export const corporateMembers = pgTable('corporate_members', {
  id: text('id').primaryKey().$defaultFn(createId),
  corporateId: text('corporate_id').notNull().references(() => corporates.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  employeeId: text('employee_id').notNull(),
  approvalStatus: text('approval_status').notNull().default('pending'),
  ridesUsedThisMonth: integer('rides_used_this_month').notNull().default(0),
  lastResetAt: ts()('last_reset_at').notNull().defaultNow(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({
  corpEmpUniq: uniqueIndex().on(t.corporateId, t.employeeId),
  corpIdx: index().on(t.corporateId),
}));

export const routes = pgTable('routes', {
  id: text('id').primaryKey().$defaultFn(createId),
  name: text('name').notNull().unique(),
  origin: text('origin').notNull(),
  destination: text('destination').notNull(),
  stops: jsonb('stops').notNull().default([]),
  polyline: jsonb('polyline').notNull().default([]),
  originLatLng: jsonb('origin_lat_lng').notNull(),
  destLatLng: jsonb('dest_lat_lng').notNull(),
  distanceKm: real('distance_km').notNull(),
  durationMin: integer('duration_min').notNull(),
  morningWindow: jsonb('morning_window').notNull(),
  eveningWindow: jsonb('evening_window').notNull(),
  fare: money('fare').notNull(),
  needsShuttle: boolean('needs_shuttle').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: ts()('deleted_at'),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
});

export const shuttles = pgTable('shuttles', {
  id: text('id').primaryKey().$defaultFn(createId),
  plateNumber: text('plate_number').notNull().unique(),
  model: text('model').notNull(),
  year: integer('year').notNull(),
  vehicleType: vehicleType('vehicle_type').notNull(),
  capacity: integer('capacity').notNull().default(14),
  contractorId: text('contractor_id').references(() => contractorProfiles.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
});

export const subscriptionPlans = pgTable('subscription_plans', {
  id: text('id').primaryKey().$defaultFn(createId),
  name: text('name').notNull().unique(),
  durationDays: integer('duration_days').notNull(),
  ridesIncluded: integer('rides_included').notNull(),
  priceETB: money('price_etb').notNull(),
  description: text('description').notNull(),
  isPopular: boolean('is_popular').notNull().default(false),
  isTrial: boolean('is_trial').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(createId),
  riderId: text('rider_id').notNull().references(() => riderProfiles.id, { onDelete: 'restrict' }),
  planId: text('plan_id').notNull().references(() => subscriptionPlans.id, { onDelete: 'restrict' }),
  routeId: text('route_id').references(() => routes.id, { onDelete: 'set null' }),
  corporateMemberId: text('corporate_member_id').references(() => corporateMembers.id, { onDelete: 'set null' }),
  status: subscriptionStatus('status').notNull().default('pending_payment'),
  ridesUsed: integer('rides_used').notNull().default(0),
  morningSlot: text('morning_slot'),
  eveningSlot: text('evening_slot'),
  startDate: ts()('start_date').notNull().defaultNow(),
  endDate: ts()('end_date').notNull(),
  cancelledAt: ts()('cancelled_at'),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({
  riderStatusIdx: index().on(t.riderId, t.status),
  statusEndIdx: index().on(t.status, t.endDate),
  corpMemberIdx: index().on(t.corporateMemberId),
}));

export const trips = pgTable('trips', {
  id: text('id').primaryKey().$defaultFn(createId),
  shuttleId: text('shuttle_id').notNull().references(() => shuttles.id, { onDelete: 'restrict' }),
  contractorId: text('contractor_id').references(() => contractorProfiles.id, { onDelete: 'set null' }),
  routeId: text('route_id').notNull().references(() => routes.id, { onDelete: 'restrict' }),
  window: seatWindow('window').notNull(),
  departTime: ts()('depart_time').notNull(),
  arriveTime: ts()('arrive_time'),
  status: tripStatus('status').notNull().default('scheduled'),
  seatsBooked: integer('seats_booked').notNull().default(0),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({
  routeDepartIdx: index().on(t.routeId, t.departTime),
  shuttleIdx: index().on(t.shuttleId),
}));

export const seatReleases = pgTable('seat_releases', {
  id: text('id').primaryKey().$defaultFn(createId),
  subscriptionId: text('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'cascade' }),
  riderId: text('rider_id').notNull().references(() => riderProfiles.id, { onDelete: 'restrict' }),
  routeId: text('route_id').notNull().references(() => routes.id, { onDelete: 'restrict' }),
  window: seatWindow('window').notNull(),
  releaseDate: date('release_date').notNull(),
  refundAmount: money('refund_amount').notNull(),
  status: seatReleaseStatus('status').notNull().default('open'),
  expiresAt: ts()('expires_at').notNull(),
  cancelledAt: ts()('cancelled_at'),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({
  subDateWindowUniq: uniqueIndex().on(t.subscriptionId, t.releaseDate, t.window),
  statusRouteIdx: index().on(t.status, t.routeId),
  expiresIdx: index().on(t.expiresAt),
}));

export const payments = pgTable('payments', {
  id: text('id').primaryKey().$defaultFn(createId),
  riderId: text('rider_id').notNull().references(() => riderProfiles.id, { onDelete: 'restrict' }),
  subscriptionId: text('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
  seatClaimId: text('seat_claim_id').references((): any => seatClaims.id, { onDelete: 'set null' }),
  amount: money('amount').notNull(),
  method: paymentMethod('method').notNull(),
  reference: text('reference').notNull().unique(),
  prepayId: text('prepay_id'),
  status: paymentStatus('status').notNull().default('pending'),
  refundAmount: money('refund_amount'),
  refundedAt: ts()('refunded_at'),
  retentionExpiresAt: ts()('retention_expires_at').notNull(),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({
  statusCreatedIdx: index().on(t.status, t.createdAt),
  riderIdx: index().on(t.riderId),
}));

export const seatClaims = pgTable('seat_claims', {
  id: text('id').primaryKey().$defaultFn(createId),
  seatReleaseId: text('seat_release_id').notNull().references(() => seatReleases.id, { onDelete: 'cascade' }).unique(),
  riderId: text('rider_id').notNull().references(() => riderProfiles.id, { onDelete: 'restrict' }),
  corporateMemberId: text('corporate_member_id').references(() => corporateMembers.id, { onDelete: 'set null' }),
  routeId: text('route_id').notNull().references(() => routes.id, { onDelete: 'restrict' }),
  window: seatWindow('window').notNull(),
  claimDate: ts()('claim_date').notNull().defaultNow(),
  paymentId: text('payment_id').references((): any => payments.id, { onDelete: 'set null' }),
  status: seatClaimStatus('status').notNull().default('confirmed'),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({ riderIdx: index().on(t.riderId) }));

export const rides = pgTable('rides', {
  id: text('id').primaryKey().$defaultFn(createId),
  riderId: text('rider_id').notNull().references(() => riderProfiles.id, { onDelete: 'restrict' }),
  tripId: text('trip_id').notNull().references(() => trips.id, { onDelete: 'restrict' }),
  subscriptionId: text('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
  seatClaimId: text('seat_claim_id').references(() => seatClaims.id, { onDelete: 'set null' }),
  status: rideStatus('status').notNull().default('booked'),
  pickupStop: text('pickup_stop'),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({
  tripRiderUniq: uniqueIndex().on(t.tripId, t.riderId),
  riderIdx: index().on(t.riderId),
}));

export const refundRetries = pgTable('refund_retries', {
  id: text('id').primaryKey().$defaultFn(createId),
  paymentId: text('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  merchOrderId: text('merch_order_id').notNull(),
  refundRequestNo: text('refund_request_no').notNull().unique(),
  amount: money('amount').notNull(),
  reason: text('reason').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  nextAttemptAt: ts()('next_attempt_at').notNull().defaultNow(),
  lastError: text('last_error'),
  status: refundStatus('status').notNull().default('pending'),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({ statusNextIdx: index().on(t.status, t.nextAttemptAt) }));

export const supportTickets = pgTable('support_tickets', {
  id: text('id').primaryKey().$defaultFn(createId),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: ticketStatus('status').notNull().default('open'),
  priority: ticketPriority('priority').notNull().default('normal'),
  category: ticketCategory('category').notNull().default('general'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  subscriptionId: text('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
  paymentId: text('payment_id').references(() => payments.id, { onDelete: 'set null' }),
  assignedToId: text('assigned_to_id').references((): any => users.id, { onDelete: 'set null' }),
  firstResponseAt: ts()('first_response_at'),
  resolvedAt: ts()('resolved_at'),
  closedAt: ts()('closed_at'),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({
  userStatusIdx: index().on(t.userId, t.status),
  statusCreatedIdx: index().on(t.status, t.createdAt),
}));

export const ticketMessages = pgTable('ticket_messages', {
  id: text('id').primaryKey().$defaultFn(createId),
  ticketId: text('ticket_id').notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  body: text('body').notNull(),
  isStaff: boolean('is_staff').notNull().default(false),
  createdAt: ts()('created_at').notNull().defaultNow(),
}, (t) => ({ ticketIdx: index().on(t.ticketId, t.createdAt) }));

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: notificationType('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  readAt: ts()('read_at'),
  createdAt: ts()('created_at').notNull().defaultNow(),
}, (t) => ({
  userReadIdx: index().on(t.userId, t.readAt),
  createdIdx: index().on(t.createdAt),
}));

export const notificationPreferences = pgTable('notification_preferences', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  prefs: jsonb('prefs').notNull().default({}),
  quietHoursStart: text('quiet_hours_start'),
  quietHoursEnd: text('quiet_hours_end'),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
});

export const devices = pgTable('devices', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  pushToken: text('push_token').notNull(),
  platform: text('platform').notNull(),
  userAgent: text('user_agent'),
  lastSeenAt: ts()('last_seen_at').notNull().defaultNow(),
  createdAt: ts()('created_at').notNull().defaultNow(),
}, (t) => ({ userTokenUniq: uniqueIndex().on(t.userId, t.pushToken) }));

export const outboxEvents = pgTable('outbox_events', {
  id: text('id').primaryKey().$defaultFn(createId),
  channel: outboxChannel('channel').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  nextAttemptAt: ts()('next_attempt_at').notNull().defaultNow(),
  lastError: text('last_error'),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({
  statusNextIdx: index().on(t.status, t.nextAttemptAt),
  channelIdx: index().on(t.channel, t.status),
}));

export const idempotencyRecords = pgTable('idempotency_records', {
  key: text('key').primaryKey(),
  userId: text('user_id'),
  method: text('method').notNull(),
  path: text('path').notNull(),
  requestBodyHash: text('request_body_hash').notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: jsonb('response_body').notNull(),
  expiresAt: ts()('expires_at').notNull(),
  createdAt: ts()('created_at').notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey().$defaultFn(createId),
  actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  prevHash: text('prev_hash'),
  hash: text('hash').notNull(),
  createdAt: ts()('created_at').notNull().defaultNow(),
}, (t) => ({
  actorIdx: index().on(t.actorId),
  entityIdx: index().on(t.entityType, t.entityId),
  actionIdx: index().on(t.action),
  createdIdx: index().on(t.createdAt),
}));

export const otpCodes = pgTable('otp_codes', {
  id: text('id').primaryKey().$defaultFn(createId),
  phone: text('phone').notNull(),
  purpose: otpPurpose('purpose').notNull(),
  codeHash: text('code_hash').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  expiresAt: ts()('expires_at').notNull(),
  verified: boolean('verified').notNull().default(false),
  createdAt: ts()('created_at').notNull().defaultNow(),
}, (t) => ({ phonePurposeIdx: index().on(t.phone, t.purpose, t.verified, t.expiresAt) }));

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts()('expires_at').notNull(),
  usedAt: ts()('used_at'),
  ipAddress: text('ip_address'),
  createdAt: ts()('created_at').notNull().defaultNow(),
});

export const tosAcceptances = pgTable('tos_acceptances', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  acceptedAt: ts()('accepted_at').notNull().defaultNow(),
}, (t) => ({ userVersionUniq: uniqueIndex().on(t.userId, t.version) }));

export const faqArticles = pgTable('faq_articles', {
  id: text('id').primaryKey().$defaultFn(createId),
  category: faqCategory('category').notNull(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  questionAm: text('question_am'),
  answerAm: text('answer_am'),
  sortOrder: integer('sort_order').notNull().default(0),
  helpfulYes: integer('helpful_yes').notNull().default(0),
  helpfulNo: integer('helpful_no').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts()('created_at').notNull().defaultNow(),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
}, (t) => ({ categorySortIdx: index().on(t.category, t.isActive, t.sortOrder) }));

export const shuttlePositions = pgTable('shuttle_positions', {
  shuttleId: text('shuttle_id').notNull().references(() => shuttles.id, { onDelete: 'cascade' }).primaryKey(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  heading: real('heading'),
  speed: real('speed'),
  updatedAt: ts()('updated_at').notNull().defaultNow(),
});

export const telebirrNotifyEvents = pgTable('telebirr_notify_events', {
  merchOrderId: text('merch_order_id').primaryKey(),
  tradeStatus: text('trade_status').notNull(),
  outRequestNo: text('out_request_no'),
  receivedAt: ts()('received_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jti: text('jti').notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  lastSeenAt: ts()('last_seen_at').notNull().defaultNow(),
  expiresAt: ts()('expires_at').notNull(),
  createdAt: ts()('created_at').notNull().defaultNow(),
});
```

```ts
// packages/db/src/client.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { loadEnv } from '@addis/shared';

const env = loadEnv();
const queryClient = postgres(env.DATABASE_URL, { max: env.NODE_ENV === 'production' ? 20 : 5 });
export const db = drizzle(queryClient, { schema });
export type Db = typeof db;
export * as schema from './schema';
```

```ts
// packages/db/src/seed.ts
import { db, schema } from './client';
import { hashPassword } from '@addis/shared';

async function main() {
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
    stops: [], polyline: [], originLatLng: [9.0, 38.7], destLatLng: [9.03, 38.75],
    morningWindow: { start: '06:30', end: '09:00' }, eveningWindow: { start: '16:30', end: '19:30' },
    fare: '60.00',
  };
}
async function mkUser(phone: string, name: string, role: 'rider' | 'contractor' | 'corporate_admin') {
  return { phone, name, role, passwordHash: await hashPassword('demo12345'), phoneVerified: true };
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

---

## Phase 3 — `services/payments` (money in/out — the highest-risk code)

```ts
// services/payments/provider.ts
import type { Money, PaymentMethod } from '@addis/shared';

export type PaymentIntent = {
  merchOrderId: string; amount: Money; description: string;
  notifyUrl: string; redirectUrl: string;
};
export type BankTransferInstructions = { accountNumber: string; accountName: string; bankBranch: string; reference: string; amount: string };
export type CheckoutResult =
  | { status: 'checkout'; checkoutUrl: string; prepayId: string }
  | { status: 'manual'; instructions: BankTransferInstructions };
export type PaymentStatusResult = { status: 'pending' | 'completed' | 'failed'; raw?: unknown };
export type RefundRequest = { merchOrderId: string; refundRequestNo: string; amount: Money; reason: string };
export type RefundResult =
  | { status: 'succeeded' }
  | { status: 'processing'; retryAfterMs: number }
  | { status: 'failed'; error: string; permanent: boolean };
export type WebhookEvent =
  | { type: 'payment.settled'; merchOrderId: string; amount: Money; raw: unknown }
  | { type: 'payment.failed'; merchOrderId: string; raw: unknown }
  | { type: 'refund.succeeded'; refundRequestNo: string; raw: unknown }
  | { type: 'refund.failed'; refundRequestNo: string; raw: unknown };

export interface PaymentProvider {
  readonly name: PaymentMethod;
  createCheckout(intent: PaymentIntent): Promise<CheckoutResult>;
  verifyPayment(reference: string): Promise<PaymentStatusResult>;
  refund(req: RefundRequest): Promise<RefundResult>;
  parseWebhook(req: Request): Promise<WebhookEvent>;
}
```

```ts
// services/payments/telebirr.ts
import { createSign, createVerify } from 'node:crypto';
import { Money, loadEnv } from '@addis/shared';
import type { PaymentProvider, PaymentIntent, CheckoutResult, PaymentStatusResult, RefundRequest, RefundResult, WebhookEvent } from './provider';

const BASE_URLS = {
  testbed: 'https://developerportal.ethiotelebirr.et',
  production: 'https://superapp.ethiomobilemoney.et',
};

/** Telebirr H5 C2B Web Payment. All magic constants live here — never hardcoded in call sites. */
export class TelebirrProvider implements PaymentProvider {
  readonly name = 'telebirr' as const;
  private env = loadEnv();
  private base = BASE_URLS[this.env.TELEBIRR_ENV];
  private cfg = {
    timeoutExpress: '120m',
    businessType: 'BuyGoods',
    payeeIdentifierType: '04',
    tradeType: 'Web',
    currency: 'ETB',
    version: '1.0',
  };

  private sign(payload: Record<string, unknown>): string {
    const sorted = Object.keys(payload).sort().map(k => `${k}=${JSON.stringify(payload[k])}`).join('&');
    const signer = createSign('RSA-SHA256');
    signer.update(sorted);
    return signer.sign(this.env.TELEBIRR_PRIVATE_KEY!, 'base64');
  }

  private async applyFabricToken(): Promise<string> {
    const res = await fetch(`${this.base}/hcp/fabric/accessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.env.TELEBIRR_FABRIC_APP_ID, appSecret: this.env.TELEBIRR_APP_SECRET }),
    });
    if (!res.ok) throw new Error(`telebirr token request failed: ${res.status}`);
    const json = await res.json();
    return json.token as string;
  }

  async createCheckout(intent: PaymentIntent): Promise<CheckoutResult> {
    const token = await this.applyFabricToken();
    const body = {
      merch_order_id: intent.merchOrderId,
      merchant_app_id: this.env.TELEBIRR_MERCHANT_APP_ID,
      merchant_code: this.env.TELEBIRR_MERCHANT_CODE,
      title: intent.description,
      total_amount: intent.amount.toString(),
      trans_currency: this.cfg.currency,
      trade_type: this.cfg.tradeType,
      timeout_express: this.cfg.timeoutExpress,
      business_type: this.cfg.businessType,
      payee_identifier_type: this.cfg.payeeIdentifierType,
      notify_url: intent.notifyUrl,
      redirect_url: intent.redirectUrl,
    };
    const sign = this.sign(body);
    const res = await fetch(`${this.base}/payment/v1/merchant/createOrder`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, sign }),
    });
    if (!res.ok) throw new Error(`telebirr createOrder failed: ${res.status}`);
    const json = await res.json();
    return { status: 'checkout', checkoutUrl: json.checkoutUrl, prepayId: json.prepayId };
  }

  async verifyPayment(reference: string): Promise<PaymentStatusResult> {
    const token = await this.applyFabricToken();
    const res = await fetch(`${this.base}/payment/v1/merchant/queryOrder?merch_order_id=${reference}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { status: 'pending' };
    const json = await res.json();
    const status = json.trade_status === 'Success' ? 'completed' : json.trade_status === 'Fail' ? 'failed' : 'pending';
    return { status, raw: json };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const token = await this.applyFabricToken();
    const body = {
      merch_order_id: req.merchOrderId,
      refund_request_no: req.refundRequestNo,
      refund_amount: req.amount.toString(),
      reason: req.reason,
    };
    const sign = this.sign(body);
    try {
      const res = await fetch(`${this.base}/payment/v1/merchant/refundOrder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, sign }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.code === 'SUCCESS') return { status: 'succeeded' };
      if (json.code === 'REFUND_DUPLICATED') return { status: 'succeeded' }; // idempotent retry
      if (json.code === 'REFUND_PROCESSING') return { status: 'processing', retryAfterMs: 15 * 60_000 };
      const permanent = json.code === 'INSUFFICIENT_BALANCE' || json.code === 'ACCOUNT_FROZEN';
      return { status: 'failed', error: json.message ?? `HTTP ${res.status}`, permanent };
    } catch (e) {
      return { status: 'failed', error: (e as Error).message, permanent: false };
    }
  }

  async parseWebhook(req: Request): Promise<WebhookEvent> {
    const raw = await req.text();
    const payload = JSON.parse(raw);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(JSON.stringify({ ...payload, sign: undefined }));
    const valid = verifier.verify(this.env.TELEBIRR_PUBLIC_KEY!, payload.sign, 'base64');
    if (!valid) throw new Error('Invalid telebirr webhook signature');

    if (payload.refund_request_no) {
      return payload.trade_status === 'Success'
        ? { type: 'refund.succeeded', refundRequestNo: payload.refund_request_no, raw: payload }
        : { type: 'refund.failed', refundRequestNo: payload.refund_request_no, raw: payload };
    }
    return payload.trade_status === 'Success'
      ? { type: 'payment.settled', merchOrderId: payload.merch_order_id, amount: Money.fromETBString(payload.total_amount), raw: payload }
      : { type: 'payment.failed', merchOrderId: payload.merch_order_id, raw: payload };
  }
}
```

```ts
// services/payments/cbe.ts
import { loadEnv } from '@addis/shared';
import type { PaymentProvider, PaymentIntent, CheckoutResult, PaymentStatusResult, RefundRequest, RefundResult, WebhookEvent } from './provider';

/** Manual bank-transfer reconciliation — no live API. Admin verifies via UI. */
export class CbeBirrProvider implements PaymentProvider {
  readonly name = 'cbe' as const;
  private env = loadEnv();

  async createCheckout(intent: PaymentIntent): Promise<CheckoutResult> {
    return {
      status: 'manual',
      instructions: {
        accountNumber: this.env.CBE_ACCOUNT_NUMBER ?? '',
        accountName: this.env.CBE_ACCOUNT_NAME ?? '',
        bankBranch: this.env.CBE_BANK_BRANCH ?? '',
        reference: `CBE${intent.merchOrderId.slice(0, 24)}`,
        amount: intent.amount.toString(),
      },
    };
  }
  async verifyPayment(): Promise<PaymentStatusResult> { return { status: 'pending' }; }
  async refund(_req: RefundRequest): Promise<RefundResult> {
    return { status: 'failed', error: 'CBE refunds require manual bank reversal by admin', permanent: true };
  }
  async parseWebhook(): Promise<WebhookEvent> { throw new Error('CBE has no live webhook in v1'); }
}
```

```ts
// services/payments/index.ts
import type { PaymentMethod } from '@addis/shared';
import type { PaymentProvider } from './provider';
import { TelebirrProvider } from './telebirr';
import { CbeBirrProvider } from './cbe';

const providers: Record<PaymentMethod, PaymentProvider> = {
  telebirr: new TelebirrProvider(),
  cbe: new CbeBirrProvider(),
};
export function getPaymentProvider(method: PaymentMethod): PaymentProvider { return providers[method]; }
export * from './provider';
```

---

## Phase 4 — `packages/api/modules` (core business logic)

### 4.1 Subscription state machine + service

```ts
// packages/api/modules/subscription/state.ts
import { defineStateMachine } from '@addis/shared';
import type { SubscriptionStatus } from '@addis/shared';

export const subscriptionState = defineStateMachine<SubscriptionStatus>({
  initial: 'pending_payment',
  transitions: [
    { from: 'pending_payment', to: 'active', event: 'payment.settled', sideEffects: ['notify.payment_received', 'audit.subscription_activated'] },
    { from: 'pending_payment', to: 'cancelled', event: 'payment.failed', sideEffects: ['notify.payment_failed', 'audit.subscription_cancelled'] },
    { from: 'pending_payment', to: 'cancelled', event: 'subscription.stale', sideEffects: ['audit.subscription_cancelled'] },
    { from: 'active', to: 'expired', event: 'subscription.expired', sideEffects: ['notify.subscription_expired', 'audit.subscription_expired'] },
    { from: 'active', to: 'cancelled', event: 'subscription.cancelled', sideEffects: ['refund.if_eligible', 'notify.subscription_cancelled', 'audit.subscription_cancelled'] },
  ],
});

/** Applies a transition to a row inside an existing transaction. Throws InvalidTransitionError if illegal. */
export async function transitionSubscription(
  tx: import('@addis/db').Db, subscriptionId: string, event: string,
) {
  const { schema } = await import('@addis/db');
  const { eq } = await import('drizzle-orm');
  const [row] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, subscriptionId));
  if (!row) throw new Error(`Subscription ${subscriptionId} not found`);
  const t = subscriptionState.resolve(row.status, event);
  await tx.update(schema.subscriptions).set({ status: t.to, updatedAt: new Date() }).where(eq(schema.subscriptions.id, subscriptionId));
  return { from: t.from, to: t.to, sideEffects: t.sideEffects ?? [] };
}
```

```ts
// packages/api/modules/subscription/types.ts
import { z } from 'zod';
import { Id, TimeOfDay } from '@addis/shared';

export const CreateSubscriptionInput = z.object({
  planId: Id, routeId: Id,
  morningSlot: TimeOfDay.optional(), eveningSlot: TimeOfDay.optional(),
  paymentMethod: z.enum(['telebirr', 'cbe']),
  corporateMemberId: Id.optional(),
});
export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionInput> & { riderId: string };

/** What other modules are allowed to know about a subscription (not the raw row/service). */
export interface SubscriptionSummary {
  id: string; riderId: string; status: string; routeId: string | null;
  ridesUsed: number; ridesIncluded: number; endDate: Date;
}
```

```ts
// packages/api/modules/subscription/repository.ts
import { and, eq, lt, sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';

export const subscriptionRepo = {
  async findById(id: string) {
    const [row] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id));
    return row ?? null;
  },
  async findActiveForRiderRoute(riderId: string, routeId: string) {
    const [row] = await db.select().from(schema.subscriptions).where(and(
      eq(schema.subscriptions.riderId, riderId),
      eq(schema.subscriptions.routeId, routeId),
      eq(schema.subscriptions.status, 'active'),
    ));
    return row ?? null;
  },
  async hasUsedTrial(riderId: string, trialPlanId: string) {
    const rows = await db.select({ id: schema.subscriptions.id }).from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.riderId, riderId), eq(schema.subscriptions.planId, trialPlanId)));
    return rows.length > 0;
  },
  async expireDue(tx = db) {
    return tx.update(schema.subscriptions)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(schema.subscriptions.status, 'active'), lt(schema.subscriptions.endDate, sql`now()`)))
      .returning({ id: schema.subscriptions.id, riderId: schema.subscriptions.riderId });
  },
  async cancelStalePending(tx = db, olderThanHours = 2) {
    return tx.update(schema.subscriptions)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(schema.subscriptions.status, 'pending_payment'),
        lt(schema.subscriptions.createdAt, sql`now() - interval '${sql.raw(String(olderThanHours))} hours'`),
      ))
      .returning({ id: schema.subscriptions.id });
  },
  /** CAS decrement used by refund settlement — never goes below 0. */
  async decrementRidesUsed(tx = db, subscriptionId: string) {
    await tx.update(schema.subscriptions)
      .set({ ridesUsed: sql`greatest(${schema.subscriptions.ridesUsed} - 1, 0)`, updatedAt: new Date() })
      .where(eq(schema.subscriptions.id, subscriptionId));
  },
  async incrementRidesUsed(tx = db, subscriptionId: string) {
    await tx.update(schema.subscriptions)
      .set({ ridesUsed: sql`${schema.subscriptions.ridesUsed} + 1`, updatedAt: new Date() })
      .where(eq(schema.subscriptions.id, subscriptionId));
  },
};
```

```ts
// packages/api/modules/subscription/service.ts
import { addDays } from 'date-fns';
import { db, schema } from '@addis/db';
import { Money, ConflictError, BadRequestError, NotFoundError, PAYMENT_RETENTION_YEARS } from '@addis/shared';
import { getPaymentProvider } from '@addis/payments';
import type { CreateSubscriptionInput } from './types';
import { subscriptionRepo } from './repository';
import { transitionSubscription } from './state';
import { eq } from 'drizzle-orm';

function addYears(d: Date, years: number) { const c = new Date(d); c.setFullYear(c.getFullYear() + years); return c; }
function generateMerchOrderId() { return `SUB${Date.now()}${Math.random().toString(36).slice(2, 8)}`; }

export const subscriptionService = {
  async create(input: CreateSubscriptionInput) {
    const [plan] = await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, input.planId));
    if (!plan || !plan.isActive) throw new NotFoundError('Plan not found');
    const [route] = await db.select().from(schema.routes).where(eq(schema.routes.id, input.routeId));
    if (!route || !route.isActive) throw new NotFoundError('Route not found');

    // Business rule: one active subscription per (rider, route)
    const existing = await subscriptionRepo.findActiveForRiderRoute(input.riderId, input.routeId);
    if (existing) throw new ConflictError('Rider already has an active subscription on this route');

    // Business rule: trial plan usable once per rider
    if (plan.isTrial && await subscriptionRepo.hasUsedTrial(input.riderId, plan.id)) {
      throw new ConflictError('Trial plan already used');
    }

    let price = Money.fromDecimal(plan.priceETB);
    let corporateMemberId: string | null = null;
    if (input.corporateMemberId) {
      const [member] = await db.select().from(schema.corporateMembers).where(eq(schema.corporateMembers.id, input.corporateMemberId));
      if (!member || member.approvalStatus !== 'approved' || !member.isActive) throw new BadRequestError('Corporate membership not approved');
      const [corp] = await db.select().from(schema.corporates).where(eq(schema.corporates.id, member.corporateId));
      if (corp) price = price.sub(price.pct(corp.subsidyPercent)); // employee pays discounted share
      corporateMemberId = member.id;
    }

    return db.transaction(async (tx) => {
      const [sub] = await tx.insert(schema.subscriptions).values({
        riderId: input.riderId, planId: plan.id, routeId: route.id, corporateMemberId,
        status: 'pending_payment',
        morningSlot: input.morningSlot, eveningSlot: input.eveningSlot,
        startDate: new Date(), endDate: addDays(new Date(), plan.durationDays),
      }).returning();

      const merchOrderId = generateMerchOrderId();
      const [payment] = await tx.insert(schema.payments).values({
        riderId: input.riderId, subscriptionId: sub.id, amount: price.toString(),
        method: input.paymentMethod, reference: merchOrderId, status: 'pending',
        retentionExpiresAt: addYears(new Date(), PAYMENT_RETENTION_YEARS),
      }).returning();

      const provider = getPaymentProvider(input.paymentMethod);
      const checkout = await provider.createCheckout({
        merchOrderId, amount: price, description: `Addis Ride — ${plan.name}`,
        notifyUrl: process.env.TELEBIRR_NOTIFY_URL!, redirectUrl: process.env.TELEBIRR_REDIRECT_URL!,
      });
      if (checkout.status === 'checkout') {
        await tx.update(schema.payments).set({ prepayId: checkout.prepayId }).where(eq(schema.payments.id, payment.id));
      }

      return { subscription: sub, payment, checkout };
    });
  },

  async renew(subscriptionId: string, riderId: string, paymentMethod: 'telebirr' | 'cbe') {
    const sub = await subscriptionRepo.findById(subscriptionId);
    if (!sub || sub.riderId !== riderId) throw new NotFoundError('Subscription not found');
    if (sub.status !== 'expired' && sub.status !== 'cancelled') throw new ConflictError('Only expired/cancelled subscriptions can be renewed');
    return subscriptionService.create({
      riderId, planId: sub.planId, routeId: sub.routeId!,
      morningSlot: sub.morningSlot ?? undefined, eveningSlot: sub.eveningSlot ?? undefined,
      paymentMethod, corporateMemberId: sub.corporateMemberId ?? undefined,
    });
  },

  async cancel(subscriptionId: string, riderId: string) {
    const sub = await subscriptionRepo.findById(subscriptionId);
    if (!sub || sub.riderId !== riderId) throw new NotFoundError('Subscription not found');
    return db.transaction(async (tx) => {
      const result = await transitionSubscription(tx, subscriptionId, 'subscription.cancelled');
      await tx.update(schema.subscriptions).set({ cancelledAt: new Date() }).where(eq(schema.subscriptions.id, subscriptionId));
      await tx.insert(schema.outboxEvents).values([
        { channel: 'notification', payload: { type: 'subscription_cancelled', userId: riderId } },
        { channel: 'audit', payload: { action: 'subscription.cancelled', entityId: subscriptionId } },
      ]);
      return result;
    });
  },
};
```

### 4.2 Payment settlement (idempotent CAS) + refund retry

```ts
// packages/api/modules/payment/service.ts
import { and, eq, lte } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { Money } from '@addis/shared';
import { getPaymentProvider } from '@addis/payments';
import { transitionSubscription } from '../subscription/state';

/** Idempotent: returns false if the payment was already settled/failed (webhook replay safe). */
export async function settlePayment(reference: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx.update(schema.payments)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(and(eq(schema.payments.reference, reference), eq(schema.payments.status, 'pending')))
      .returning();
    if (updated.length === 0) return false;
    const p = updated[0];

    if (p.subscriptionId) {
      await transitionSubscription(tx, p.subscriptionId, 'payment.settled');
    }
    if (p.seatClaimId) {
      await tx.update(schema.seatClaims).set({ status: 'confirmed', updatedAt: new Date() }).where(eq(schema.seatClaims.id, p.seatClaimId));
    }

    await tx.insert(schema.outboxEvents).values([
      { channel: 'notification', payload: { type: 'payment_received', userId: p.riderId, amount: p.amount } },
      { channel: 'audit', payload: { action: 'payment.settled', entityId: p.id } },
    ]);
    return true;
  });
}

export async function failPayment(reference: string, reasonRaw: unknown): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx.update(schema.payments)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(and(eq(schema.payments.reference, reference), eq(schema.payments.status, 'pending')))
      .returning();
    if (updated.length === 0) return false;
    const p = updated[0];
    if (p.subscriptionId) await transitionSubscription(tx, p.subscriptionId, 'payment.failed');
    if (p.seatClaimId) {
      // claimer payment failed -> claim cancelled -> seat reopens for others
      const [claim] = await tx.update(schema.seatClaims).set({ status: 'refunded', updatedAt: new Date() })
        .where(eq(schema.seatClaims.id, p.seatClaimId)).returning();
      if (claim) await tx.update(schema.seatReleases).set({ status: 'open', updatedAt: new Date() }).where(eq(schema.seatReleases.id, claim.seatReleaseId));
    }
    await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'payment_failed', userId: p.riderId, raw: reasonRaw } });
    return true;
  });
}

/** Queue a refund; retried by process-refund-retries cron with exponential backoff. */
export async function scheduleRefund(paymentId: string, amount: Money, reason: string, tx = db) {
  const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) throw new Error(`Payment ${paymentId} not found`);
  const refundRequestNo = `RF${paymentId}${Date.now()}`;
  await tx.insert(schema.refundRetries).values({
    paymentId, merchOrderId: payment.reference, refundRequestNo, amount: amount.toString(), reason,
  });
}

const BACKOFF_MIN = [15, 30, 60, 120, 240];

export async function processRefundRetries(limit = 50) {
  const due = await db.select().from(schema.refundRetries)
    .where(and(eq(schema.refundRetries.status, 'pending'), lte(schema.refundRetries.nextAttemptAt, new Date())))
    .limit(limit);

  for (const retry of due) {
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, retry.paymentId));
    if (!payment) continue;
    const provider = getPaymentProvider(payment.method);
    const result = await provider.refund({
      merchOrderId: retry.merchOrderId, refundRequestNo: retry.refundRequestNo,
      amount: Money.fromDecimal(retry.amount), reason: retry.reason,
    });

    await db.transaction(async (tx) => {
      if (result.status === 'succeeded') {
        await tx.update(schema.refundRetries).set({ status: 'succeeded', updatedAt: new Date() }).where(eq(schema.refundRetries.id, retry.id));
        await tx.update(schema.payments).set({
          status: 'refunded', refundAmount: retry.amount, refundedAt: new Date(), updatedAt: new Date(),
        }).where(eq(schema.payments.id, payment.id));
        if (payment.subscriptionId) {
          const { subscriptionRepo } = await import('../subscription/repository');
          await subscriptionRepo.decrementRidesUsed(tx, payment.subscriptionId);
        }
        await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'refund_completed', userId: payment.riderId } });
      } else {
        const attempts = retry.attempts + 1;
        if (result.status === 'failed' && result.permanent) {
          await tx.update(schema.refundRetries).set({ status: 'permanent_failure', attempts, lastError: result.error, updatedAt: new Date() }).where(eq(schema.refundRetries.id, retry.id));
          await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'refund_failed', userId: payment.riderId } });
        } else if (attempts >= retry.maxAttempts) {
          await tx.update(schema.refundRetries).set({ status: 'permanent_failure', attempts, updatedAt: new Date() }).where(eq(schema.refundRetries.id, retry.id));
          await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'refund_failed', userId: payment.riderId } });
        } else {
          const backoffMin = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
          await tx.update(schema.refundRetries).set({
            attempts, nextAttemptAt: new Date(Date.now() + backoffMin * 60_000),
            lastError: result.status === 'failed' ? result.error : null, updatedAt: new Date(),
          }).where(eq(schema.refundRetries.id, retry.id));
        }
      }
    });
  }
  return { processed: due.length };
}
```

### 4.3 Seat release / claim marketplace (the trickiest concurrency logic)

```ts
// packages/api/modules/marketplace/types.ts
import { z } from 'zod';
import { Id } from '@addis/shared';

export const CreateSeatReleaseInput = z.object({
  subscriptionId: Id,
  releaseDate: z.string().date(),
  window: z.enum(['morning', 'evening']),
});
export const ClaimSeatInput = z.object({
  seatReleaseId: Id,
  paymentMethod: z.enum(['telebirr', 'cbe']),
});
```

```ts
// packages/api/modules/marketplace/service.ts
import { addHours } from 'date-fns';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { Money, ConflictError, BadRequestError, NotFoundError, proratedRideValue, PAYMENT_RETENTION_YEARS } from '@addis/shared';
import { getPaymentProvider } from '@addis/payments';
import { scheduleRefund } from '../payment/service';

const SEAT_RELEASE_TTL_HOURS = Number(process.env.SEAT_RELEASE_TTL_HOURS ?? 4);
function addYears(d: Date, years: number) { const c = new Date(d); c.setFullYear(c.getFullYear() + years); return c; }
function generateMerchOrderId() { return `CLM${Date.now()}${Math.random().toString(36).slice(2, 8)}`; }

export const marketplaceService = {
  async release(riderId: string, input: { subscriptionId: string; releaseDate: string; window: 'morning' | 'evening' }) {
    const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, input.subscriptionId));
    if (!sub || sub.riderId !== riderId) throw new NotFoundError('Subscription not found');
    if (sub.status !== 'active') throw new ConflictError('Subscription is not active');
    if (!sub.routeId) throw new BadRequestError('Subscription has no route');
    if (new Date(input.releaseDate) < new Date(new Date().toDateString())) throw new BadRequestError('Release date must be in the future');

    const [plan] = await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, sub.planId));
    const [route] = await db.select().from(schema.routes).where(eq(schema.routes.id, sub.routeId));
    if (!plan || !route) throw new NotFoundError('Plan or route not found');

    const refundAmount = proratedRideValue(Money.fromDecimal(plan.priceETB), plan.ridesIncluded, Money.fromDecimal(route.fare));

    try {
      const [release] = await db.insert(schema.seatReleases).values({
        subscriptionId: sub.id, riderId, routeId: sub.routeId, window: input.window,
        releaseDate: input.releaseDate, refundAmount: refundAmount.toString(),
        expiresAt: addHours(new Date(`${input.releaseDate}T00:00:00Z`), 24 + SEAT_RELEASE_TTL_HOURS), // end of release day + TTL
      }).returning();
      await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'seat_released', userId: riderId } });
      return release;
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictError('Seat already released for this date/window'); // unique index violation
      throw e;
    }
  },

  async cancelRelease(riderId: string, releaseId: string) {
    const [release] = await db.select().from(schema.seatReleases).where(eq(schema.seatReleases.id, releaseId));
    if (!release || release.riderId !== riderId) throw new NotFoundError('Release not found');
    if (release.status !== 'open') throw new ConflictError('Release cannot be cancelled in its current state');
    await db.update(schema.seatReleases).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() }).where(eq(schema.seatReleases.id, releaseId));
  },

  /** Atomic claim via CAS update — race-free even with concurrent claimers. */
  async claim(claimerId: string, input: { seatReleaseId: string; paymentMethod: 'telebirr' | 'cbe' }) {
    const result = await db.transaction(async (tx) => {
      const claimed = await tx.update(schema.seatReleases)
        .set({ status: 'claimed', updatedAt: new Date() })
        .where(and(
          eq(schema.seatReleases.id, input.seatReleaseId),
          eq(schema.seatReleases.status, 'open'),
          gt(schema.seatReleases.expiresAt, new Date()),
        ))
        .returning();
      if (claimed.length === 0) throw new ConflictError('Seat already claimed, cancelled, or expired');

      const release = claimed[0];
      if (release.riderId === claimerId) throw new BadRequestError('Cannot claim your own released seat');

      const merchOrderId = generateMerchOrderId();
      const [payment] = await tx.insert(schema.payments).values({
        riderId: claimerId, amount: release.refundAmount, method: input.paymentMethod,
        reference: merchOrderId, status: 'pending', retentionExpiresAt: addYears(new Date(), PAYMENT_RETENTION_YEARS),
      }).returning();

      const [claim] = await tx.insert(schema.seatClaims).values({
        seatReleaseId: input.seatReleaseId, riderId: claimerId, routeId: release.routeId,
        window: release.window, paymentId: payment.id, status: 'confirmed',
      }).returning();

      await tx.update(schema.payments).set({ seatClaimId: claim.id }).where(eq(schema.payments.id, payment.id));

      // Find original subscriber's payment to refund once claimer pays (queued on settle, not here)
      return { release, claim, payment };
    });

    const provider = getPaymentProvider(input.paymentMethod);
    const checkout = await provider.createCheckout({
      merchOrderId: result.payment.reference, amount: Money.fromDecimal(result.payment.amount),
      description: 'Addis Ride — claim released seat', notifyUrl: process.env.TELEBIRR_NOTIFY_URL!, redirectUrl: process.env.TELEBIRR_REDIRECT_URL!,
    });
    return { ...result, checkout };
  },

  /** Called from settlePayment() when a seat-claim payment settles: pay out the original subscriber. */
  async onClaimPaymentSettled(seatClaimId: string) {
    const [claim] = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.id, seatClaimId));
    if (!claim) return;
    const [release] = await db.select().from(schema.seatReleases).where(eq(schema.seatReleases.id, claim.seatReleaseId));
    if (!release) return;
    const [originalPayment] = await db.select().from(schema.payments).where(eq(schema.payments.subscriptionId, release.subscriptionId));
    if (!originalPayment) return;
    await scheduleRefund(originalPayment.id, Money.fromDecimal(release.refundAmount), 'seat_claimed');
    await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'seat_claimed', userId: release.riderId } });
  },
};
```

### 4.4 Operations (trips, rides, GPS)

```ts
// packages/api/modules/operations/service.ts
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { NotFoundError, ConflictError, BadRequestError } from '@addis/shared';
import { subscriptionRepo } from '../subscription/repository';

const MIN_GPS_MOVE_METERS = 5;
function haversineMeters(a: [number, number], b: [number, number]) {
  const R = 6371000, toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const operationsService = {
  async startTrip(contractorId: string, input: { shuttleId: string; routeId: string; window: 'morning' | 'evening'; departTime: Date }) {
    const [shuttle] = await db.select().from(schema.shuttles).where(eq(schema.shuttles.id, input.shuttleId));
    if (!shuttle || shuttle.contractorId !== contractorId) throw new NotFoundError('Shuttle not found');
    const [trip] = await db.insert(schema.trips).values({ ...input, contractorId, status: 'in_transit' }).returning();
    return trip;
  },

  async completeTrip(contractorId: string, tripId: string) {
    return db.transaction(async (tx) => {
      const [trip] = await tx.update(schema.trips)
        .set({ status: 'completed', arriveTime: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.trips.id, tripId), eq(schema.trips.contractorId, contractorId), eq(schema.trips.status, 'in_transit')))
        .returning();
      if (!trip) throw new ConflictError('Trip not in a completable state');

      const boarded = await tx.update(schema.rides)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(and(eq(schema.rides.tripId, tripId), eq(schema.rides.status, 'boarded')))
        .returning({ id: schema.rides.id, subscriptionId: schema.rides.subscriptionId, seatClaimId: schema.rides.seatClaimId });

      await tx.update(schema.rides)
        .set({ status: 'no_show', updatedAt: new Date() })
        .where(and(eq(schema.rides.tripId, tripId), eq(schema.rides.status, 'booked')));

      for (const r of boarded) {
        if (r.subscriptionId) await subscriptionRepo.incrementRidesUsed(tx, r.subscriptionId);
        if (r.seatClaimId) await tx.update(schema.seatClaims).set({ status: 'used', updatedAt: new Date() }).where(eq(schema.seatClaims.id, r.seatClaimId));
      }
      await tx.insert(schema.outboxEvents).values({ channel: 'audit', payload: { action: 'trip.completed', entityId: tripId } });
      return trip;
    });
  },

  async bookRide(riderId: string, input: { tripId: string; subscriptionId?: string; seatClaimId?: string; pickupStop?: string }) {
    const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId));
    if (!trip || trip.status !== 'scheduled') throw new BadRequestError('Trip not open for booking');
    try {
      const [ride] = await db.insert(schema.rides).values({ riderId, ...input, status: 'booked' }).returning();
      await db.update(schema.trips).set({ seatsBooked: trip.seatsBooked + 1 }).where(eq(schema.trips.id, trip.id));
      return ride;
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictError('Already booked on this trip');
      throw e;
    }
  },

  async board(riderId: string, rideId: string) {
    const [ride] = await db.update(schema.rides)
      .set({ status: 'boarded', updatedAt: new Date() })
      .where(and(eq(schema.rides.id, rideId), eq(schema.rides.riderId, riderId), eq(schema.rides.status, 'booked')))
      .returning();
    if (!ride) throw new ConflictError('Ride cannot be boarded in its current state');
    return ride;
  },

  /** Atomic GPS upsert w/ dedup + min-distance guard. Redis cache managed by caller. */
  async reportPosition(shuttleId: string, pos: { lat: number; lng: number; heading?: number; speed?: number }) {
    const [existing] = await db.select().from(schema.shuttlePositions).where(eq(schema.shuttlePositions.shuttleId, shuttleId));
    if (existing && haversineMeters([existing.lat, existing.lng], [pos.lat, pos.lng]) < MIN_GPS_MOVE_METERS) {
      return existing; // dedup: no meaningful movement
    }
    const [row] = await db.insert(schema.shuttlePositions)
      .values({ shuttleId, ...pos, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.shuttlePositions.shuttleId, set: { ...pos, updatedAt: new Date() } })
      .returning();
    return row;
  },
};
```

---

## Phase 5 — Identity & auth

```ts
// packages/api/modules/identity/otp.ts
import { createHash, randomInt } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { BadRequestError, RateLimitError } from '@addis/shared';
import { redis } from '../../infra/redis';

const OTP_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;
const SEND_LIMIT_PER_10MIN = 3;
const VERIFY_LIMIT_PER_10MIN = 10;

function hashCode(code: string) { return createHash('sha256').update(code).digest('hex'); }

export const otpService = {
  async send(phone: string, purpose: import('@addis/shared').OtpPurpose) {
    const lockKey = `otp:send:lock:${phone}`;
    const acquired = await redis.set(lockKey, '1', { nx: true, ex: 2 });
    if (!acquired) throw new RateLimitError(2);

    const countKey = `otp:send:count:${phone}`;
    const count = await redis.incr(countKey);
    if (count === 1) await redis.expire(countKey, 600);
    if (count > SEND_LIMIT_PER_10MIN) throw new RateLimitError(await redis.ttl(countKey));

    // consume prior unconsumed codes for this phone+purpose
    await db.update(schema.otpCodes).set({ verified: true })
      .where(and(eq(schema.otpCodes.phone, phone), eq(schema.otpCodes.purpose, purpose), eq(schema.otpCodes.verified, false)));

    const code = String(randomInt(100000, 999999));
    await db.insert(schema.otpCodes).values({
      phone, purpose, codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000),
    });

    const { smsProvider } = await import('@addis/sms');
    const sent = await smsProvider.send(phone, `Your Addis Ride code is ${code}. Expires in ${OTP_TTL_MIN} minutes.`).catch(() => false);
    return { sent, devCode: process.env.NODE_ENV !== 'production' ? code : undefined };
  },

  async verify(phone: string, purpose: import('@addis/shared').OtpPurpose, code: string) {
    const verifyKey = `otp:verify:count:${phone}`;
    const count = await redis.incr(verifyKey);
    if (count === 1) await redis.expire(verifyKey, 600);
    if (count > VERIFY_LIMIT_PER_10MIN) throw new RateLimitError(await redis.ttl(verifyKey));

    const [row] = await db.select().from(schema.otpCodes)
      .where(and(eq(schema.otpCodes.phone, phone), eq(schema.otpCodes.purpose, purpose), eq(schema.otpCodes.verified, false), gt(schema.otpCodes.expiresAt, new Date())))
      .orderBy(schema.otpCodes.createdAt);
    if (!row) throw new BadRequestError('No active OTP for this phone');
    if (row.attempts >= row.maxAttempts) throw new BadRequestError('Too many attempts; request a new code');

    if (row.codeHash !== hashCode(code)) {
      await db.update(schema.otpCodes).set({ attempts: row.attempts + 1 }).where(eq(schema.otpCodes.id, row.id));
      throw new BadRequestError('Invalid code');
    }
    await db.update(schema.otpCodes).set({ verified: true }).where(eq(schema.otpCodes.id, row.id));
    return true;
  },
};
```

```ts
// packages/api/modules/identity/service.ts
import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { db, schema } from '@addis/db';
import { hashPassword, verifyPassword, ConflictError, UnauthorizedError, NotFoundError, CURRENT_TOS_VERSION } from '@addis/shared';
import { createId } from '@paralleldrive/cuid2';

const JWT_SECRET = () => new TextEncoder().encode(process.env.NEXTAUTH_SECRET!);
const ACCESS_TTL = '30m';

export const identityService = {
  async registerRider(input: { phone: string; name: string; password: string; homeArea: string; workArea: string }) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.phone, input.phone));
    if (existing) throw new ConflictError('Phone already registered');
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(schema.users).values({
        phone: input.phone, name: input.name, passwordHash: await hashPassword(input.password), role: 'rider',
      }).returning();
      const [profile] = await tx.insert(schema.riderProfiles).values({ userId: user.id, homeArea: input.homeArea, workArea: input.workArea }).returning();
      await tx.insert(schema.outboxEvents).values({ channel: 'sms', payload: { phone: input.phone, purpose: 'signup_verification' } });
      return { user, profile };
    });
  },

  async registerContractor(input: { phone: string; name: string; password: string; licenseNumber: string; experienceYears: number }) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.phone, input.phone));
    if (existing) throw new ConflictError('Phone already registered');
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(schema.users).values({
        phone: input.phone, name: input.name, passwordHash: await hashPassword(input.password), role: 'contractor',
      }).returning();
      const [profile] = await tx.insert(schema.contractorProfiles).values({
        userId: user.id, licenseNumber: input.licenseNumber, experienceYears: input.experienceYears, verificationStatus: 'unverified',
      }).returning();
      return { user, profile };
    });
  },

  async login(phone: string, password: string, userAgent?: string, ip?: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.phone, phone));
    if (!user || !user.isActive || user.deletedAt) throw new UnauthorizedError('Invalid credentials');
    if (!(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedError('Invalid credentials');

    const jti = createId();
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600_000);
    await db.insert(schema.sessions).values({ userId: user.id, jti, userAgent, ipAddress: ip, expiresAt });

    const token = await new SignJWT({ id: user.id, role: user.role, phone: user.phone, tokenVersion: user.tokenVersion, jti })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ACCESS_TTL).sign(JWT_SECRET());

    return { user, accessToken: token, requiresTosAcceptance: user.tosVersion !== CURRENT_TOS_VERSION };
  },

  async verifySession(token: string) {
    const { payload } = await jwtVerify(token, JWT_SECRET());
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, payload.id as string));
    if (!user || user.tokenVersion !== payload.tokenVersion || !user.isActive || user.deletedAt) throw new UnauthorizedError();
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.jti, payload.jti as string));
    if (!session || session.expiresAt < new Date()) throw new UnauthorizedError('Session revoked');
    return { user, jti: payload.jti as string };
  },

  async changePassword(userId: string, oldPw: string, newPw: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw new NotFoundError('User not found');
    if (!(await verifyPassword(oldPw, user.passwordHash))) throw new UnauthorizedError('Current password incorrect');
    await db.update(schema.users).set({
      passwordHash: await hashPassword(newPw), tokenVersion: user.tokenVersion + 1, updatedAt: new Date(),
    }).where(eq(schema.users.id, userId)); // bumping tokenVersion revokes all other sessions
  },
};
```

---

## Phase 6 — API wiring (Hono)

```ts
// packages/api/src/app.ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { requestContext } from './middleware/context';
import { errorHandler } from './middleware/error';
import { authMiddleware } from './middleware/auth';
import { idempotencyMiddleware } from './middleware/idempotency';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { tosGateMiddleware } from './middleware/tos-gate';

import { catalogRoutes } from '../modules/catalog/routes';
import { identityRoutes } from '../modules/identity/routes';
import { subscriptionRoutes } from '../modules/subscription/routes';
import { marketplaceRoutes } from '../modules/marketplace/routes';
import { operationsRoutes } from '../modules/operations/routes';
import { supportRoutes } from '../modules/support/routes';
import { corporateRoutes } from '../modules/corporate/routes';
import { adminRoutes } from '../modules/admin/routes';
import { cronRoutes } from '../modules/cron/routes';
import { webhookRoutes } from '../modules/webhooks/routes';

export const app = new OpenAPIHono();

app.use('*', requestContext);
app.use('*', rateLimitMiddleware);
app.use('*', authMiddleware);       // populates c.get('session') if present; does not 401 by default
app.use('*', tosGateMiddleware);    // 409 if authenticated + stale ToS
app.use('/api/v1/*', idempotencyMiddleware); // POST only, internally

app.route('/api/v1', catalogRoutes);
app.route('/api/v1/auth', identityRoutes);
app.route('/api/v1/subscriptions', subscriptionRoutes);
app.route('/api/v1', marketplaceRoutes); // seat-releases, seat-claims
app.route('/api/v1', operationsRoutes);  // trips, rides, shuttle-positions
app.route('/api/v1', supportRoutes);     // tickets, faq
app.route('/api/v1/corporate', corporateRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1/cron', cronRoutes);
app.route('/api/v1/webhooks', webhookRoutes);

app.onError(errorHandler);

app.doc('/api/v1/openapi.json', { openapi: '3.1.0', info: { title: 'Addis Ride API', version: '1.0.0' } });

export type App = typeof app;
```

```ts
// packages/api/src/middleware/error.ts
import type { ErrorHandler } from 'hono';
import { toErrorEnvelope } from '@addis/shared';

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') ?? crypto.randomUUID();
  const { status, body } = toErrorEnvelope(err, requestId);
  if (status >= 500) c.get('logger')?.error({ err, requestId }, 'unhandled error');
  return c.json(body, status as any);
};
```

```ts
// packages/api/src/middleware/auth.ts
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { identityService } from '../../modules/identity/service';
import { UnauthorizedError } from '@addis/shared';

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  const cookieToken = getCookie(c, '__Secure-session-token');
  const token = bearer ?? cookieToken;
  if (token) {
    try {
      const { user, jti } = await identityService.verifySession(token);
      c.set('session', { userId: user.id, role: user.role, phone: user.phone, tosVersion: user.tosVersion, jti });
    } catch { /* leave session unset; route-level guard decides if 401 is required */ }
  }
  await next();
};

export function requireRole(...roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    const session = c.get('session');
    if (!session) throw new UnauthorizedError();
    if (!roles.includes(session.role)) throw new UnauthorizedError('Insufficient role');
    await next();
  };
}
```

```ts
// packages/api/src/middleware/idempotency.ts
import type { MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { ConflictError } from '@addis/shared';

export const idempotencyMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const key = c.req.header('Idempotency-Key');
  if (!key) return next();

  const bodyText = await c.req.raw.clone().text();
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');

  const [existing] = await db.select().from(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, key));
  if (existing) {
    if (existing.requestBodyHash !== bodyHash) throw new ConflictError('Idempotency-Key reused with a different request body');
    return c.json(existing.responseBody as any, existing.responseStatus as any);
  }

  await next();

  const res = c.res.clone();
  if (res.status < 500) {
    const responseBody = await res.json().catch(() => ({}));
    await db.insert(schema.idempotencyRecords).values({
      key, method: c.req.method, path: c.req.path, requestBodyHash: bodyHash,
      responseStatus: res.status, responseBody, expiresAt: new Date(Date.now() + 24 * 3600_000),
    }).onConflictDoNothing();
  }
};
```

```ts
// packages/api/src/middleware/rate-limit.ts
import type { MiddlewareHandler } from 'hono';
import { RateLimitError } from '@addis/shared';
import { redis } from '../../infra/redis';

const RULES: { pattern: RegExp; limit: number; windowSec: number; keyFn: (c: any) => string }[] = [
  { pattern: /\/auth\/login$/, limit: 10, windowSec: 60, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /\/auth\/register$/, limit: 5, windowSec: 3600, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /\/auth\/otp\/send$/, limit: 3, windowSec: 600, keyFn: c => `phone:${bodyPhone(c)}` },
  { pattern: /\/auth\/otp\/verify$/, limit: 10, windowSec: 600, keyFn: c => `phone:${bodyPhone(c)}` },
  { pattern: /\/corporate\/onboard$/, limit: 5, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId}` },
  { pattern: /^\/api\/v1\/subscriptions$/, limit: 10, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId}` },
  { pattern: /\/refunds$/, limit: 5, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId}` },
];
const DEFAULT_AUTHED = { limit: 100, windowSec: 60 };
const DEFAULT_ANON = { limit: 60, windowSec: 60 };

function clientIp(c: any) { return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'; }
function bodyPhone(c: any) { return c.get('__parsedBodyPhone') ?? 'unknown'; }

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;
  const rule = RULES.find(r => r.pattern.test(path));
  const session = c.get('session');
  const { limit, windowSec, keyFn } = rule ?? (session ? { ...DEFAULT_AUTHED, keyFn: (c: any) => `user:${session.userId}` } : { ...DEFAULT_ANON, keyFn: (c: any) => `ip:${clientIp(c)}` });

  const key = `rl:${path}:${keyFn(c)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  const ttl = await redis.ttl(key);
  c.header('X-RateLimit-Reset', String(ttl));
  if (count > limit) {
    c.header('Retry-After', String(ttl));
    throw new RateLimitError(ttl);
  }
  await next();
};
```

```ts
// packages/api/src/middleware/tos-gate.ts
import type { MiddlewareHandler } from 'hono';
import { CURRENT_TOS_VERSION } from '@addis/shared';

const EXEMPT = [/^\/api\/v1\/tos/, /^\/api\/v1\/auth\//, /^\/api\/v1\/health/, /^\/api\/v1\/webhooks/, /^\/api\/v1\/cron/];

export const tosGateMiddleware: MiddlewareHandler = async (c, next) => {
  const session = c.get('session');
  if (session && !EXEMPT.some(re => re.test(c.req.path))) {
    if (session.tosVersion !== CURRENT_TOS_VERSION) {
      c.header('Location', '/tos/accept');
      return c.json({ error: { code: 'TOS_UPDATE_REQUIRED', message: 'Please accept the updated Terms of Service', requestId: c.get('requestId') } }, 409);
    }
  }
  await next();
};
```

### Representative route file (subscriptions)

```ts
// packages/api/modules/subscription/routes.ts
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { ErrorSchema, envelope } from '@addis/shared';
import { requireRole } from '../../src/middleware/auth';
import { CreateSubscriptionInput } from './types';
import { subscriptionService } from './service';

export const subscriptionRoutes = new OpenAPIHono();

const SubscriptionSchema = z.object({
  id: z.string(), riderId: z.string(), planId: z.string(), routeId: z.string().nullable(),
  status: z.string(), ridesUsed: z.number(), startDate: z.string(), endDate: z.string(),
});

const createRoute1 = createRoute({
  method: 'post', path: '/', security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  middleware: [requireRole('rider')] as const,
  request: { body: { content: { 'application/json': { schema: CreateSubscriptionInput } } } },
  responses: {
    201: { content: { 'application/json': { schema: envelope(SubscriptionSchema) } }, description: 'Created' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Validation' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict (dup active sub / trial used)' },
  },
});

subscriptionRoutes.openapi(createRoute1, async (c) => {
  const body = c.req.valid('json');
  const session = c.get('session');
  const result = await subscriptionService.create({ ...body, riderId: session.userId });
  return c.json({ data: result.subscription, meta: { checkout: result.checkout } } as any, 201);
});

const renewRoute = createRoute({
  method: 'post', path: '/{id}/renew', security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  middleware: [requireRole('rider')] as const,
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ paymentMethod: z.enum(['telebirr', 'cbe']) }) } } } },
  responses: { 201: { content: { 'application/json': { schema: envelope(SubscriptionSchema) } }, description: 'Renewed' } },
});
subscriptionRoutes.openapi(renewRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { paymentMethod } = c.req.valid('json');
  const session = c.get('session');
  const result = await subscriptionService.renew(id, session.userId, paymentMethod);
  return c.json({ data: result.subscription } as any, 201);
});

const cancelRoute = createRoute({
  method: 'delete', path: '/{id}', security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  middleware: [requireRole('rider')] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { content: { 'application/json': { schema: envelope(z.object({ status: z.string() })) } }, description: 'Cancelled' } },
});
subscriptionRoutes.openapi(cancelRoute, async (c) => {
  const { id } = c.req.valid('param');
  const session = c.get('session');
  const result = await subscriptionService.cancel(id, session.userId);
  return c.json({ data: { status: result.to } } as any, 200);
});
```

### Webhook route (telebirr)

```ts
// packages/api/modules/webhooks/routes.ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { getPaymentProvider } from '@addis/payments';
import { settlePayment, failPayment } from '../payment/service';
import { marketplaceService } from '../marketplace/service';

export const webhookRoutes = new Hono();

webhookRoutes.post('/telebirr/notify', async (c) => {
  const provider = getPaymentProvider('telebirr');
  const event = await provider.parseWebhook(c.req.raw);

  if (event.type === 'payment.settled' || event.type === 'payment.failed') {
    // replay protection
    const inserted = await db.insert(schema.telebirrNotifyEvents)
      .values({ merchOrderId: event.merchOrderId, tradeStatus: event.type })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return c.text('SUCCESS'); // already processed

    if (event.type === 'payment.settled') {
      const settled = await settlePayment(event.merchOrderId);
      if (settled) {
        const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, event.merchOrderId));
        if (payment?.seatClaimId) await marketplaceService.onClaimPaymentSettled(payment.seatClaimId);
      }
    } else {
      await failPayment(event.merchOrderId, event.raw);
    }
  }
  return c.text('SUCCESS');
});
```

---

## Phase 7 — `apps/worker` (outbox drainer + cron)

```ts
// apps/worker/src/index.ts
import { loadEnv } from '@addis/shared';
import { db, schema } from '@addis/db';
import { and, eq, lte } from 'drizzle-orm';
import { processRefundRetries } from '@addis/api/modules/payment/service';

const env = loadEnv();

const HANDLERS: Record<string, (payload: any) => Promise<void>> = {
  notification: async (p) => (await import('./handlers/notification')).handle(p),
  sms: async (p) => (await import('./handlers/sms')).handle(p),
  push: async (p) => (await import('./handlers/push')).handle(p),
  email: async (p) => (await import('./handlers/email')).handle(p),
  refund: async () => { /* refunds drained separately via processRefundRetries */ },
  audit: async (p) => (await import('./handlers/audit')).handle(p),
  webhook: async (p) => (await import('./handlers/webhook')).handle(p),
};

const BACKOFF_SEC = [30, 60, 300, 900, 3600];

async function drainOutbox() {
  const due = await db.select().from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.status, 'pending'), lte(schema.outboxEvents.nextAttemptAt, new Date())))
    .limit(50);

  for (const evt of due) {
    try {
      await HANDLERS[evt.channel](evt.payload);
      await db.update(schema.outboxEvents).set({ status: 'delivered', updatedAt: new Date() }).where(eq(schema.outboxEvents.id, evt.id));
    } catch (err) {
      const attempts = evt.attempts + 1;
      if (attempts >= evt.maxAttempts) {
        await db.update(schema.outboxEvents).set({ status: 'dead', attempts, lastError: String(err), updatedAt: new Date() }).where(eq(schema.outboxEvents.id, evt.id));
        const Sentry = await import('@sentry/node');
        Sentry.captureException(err, { extra: { outboxEventId: evt.id } });
      } else {
        const backoff = BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)];
        await db.update(schema.outboxEvents).set({
          status: 'pending', attempts, lastError: String(err),
          nextAttemptAt: new Date(Date.now() + backoff * 1000), updatedAt: new Date(),
        }).where(eq(schema.outboxEvents.id, evt.id));
      }
    }
  }
}

/** Cron jobs use pg_advisory_xact_lock so only one worker instance runs each job at a time. */
async function withLock(name: string, fn: () => Promise<unknown>) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.execute(sqlAdvisory(name));
    if (!rows[0]?.locked) return { skipped: true, reason: 'lock-held' };
    const result = await fn();
    await tx.insert(schema.auditLogs).values({
      action: `cron.${name}`, entityType: 'cron', hash: 'n/a', // real impl computes hash chain
    } as any);
    return { ok: true, result };
  });
}
function sqlAdvisory(name: string) {
  const { sql } = require('drizzle-orm');
  return sql`select pg_try_advisory_xact_lock(hashtext(${name})) as locked`;
}

async function main() {
  setInterval(() => drainOutbox().catch(console.error), 5000);

  setInterval(() => withLock('expire-subscriptions', async () => {
    const { subscriptionRepo } = await import('@addis/api/modules/subscription/repository');
    return subscriptionRepo.expireDue();
  }).catch(console.error), 3600_000);

  setInterval(() => withLock('expire-seat-releases', async () => {
    const { lt, eq: eq2 } = await import('drizzle-orm');
    return db.update(schema.seatReleases).set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq2(schema.seatReleases.status, 'open'), lt(schema.seatReleases.expiresAt, new Date())))
      .returning({ id: schema.seatReleases.id });
  }).catch(console.error), 15 * 60_000);

  setInterval(() => withLock('cleanup-pending-subscriptions', async () => {
    const { subscriptionRepo } = await import('@addis/api/modules/subscription/repository');
    return subscriptionRepo.cancelStalePending();
  }).catch(console.error), 30 * 60_000);

  setInterval(() => withLock('process-refund-retries', () => processRefundRetries()).catch(console.error), 15 * 60_000);

  setInterval(() => withLock('corporate-reset-monthly', async () => {
    const { lt } = await import('drizzle-orm');
    return db.update(schema.corporateMembers).set({ ridesUsedThisMonth: 0, lastResetAt: new Date() })
      .where(lt(schema.corporateMembers.lastResetAt, new Date(new Date().setDate(1))));
  }).catch(console.error), 24 * 3600_000);

  console.log('Addis Ride worker started.');
}
main();
```

---

## Phase 8 — Web wiring (Next.js mounts Hono)

```ts
// apps/web/app/api/v1/[[...route]]/route.ts
import { handle } from 'hono/vercel';
import { app } from '@addis/api';

export const runtime = 'nodejs'; // telebirr RSA signing needs Node crypto
export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
```

```ts
// apps/web/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `connect-src 'self' https://superapp.ethiomobilemoney.et https://*.sentry.io ${process.env.NEXT_PUBLIC_TILE_SERVER_URL ?? ''}`,
    `img-src 'self' data: https:`,
    `report-uri /api/v1/csp-report`,
  ].join('; ');

  const res = NextResponse.next();
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('x-nonce', nonce);

  const locale = req.cookies.get('addis-ride-locale')?.value ?? req.headers.get('accept-language')?.startsWith('am') ? 'am' : 'en';
  res.cookies.set('addis-ride-locale', locale as string);
  return res;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
```

---

## What's implemented at full depth vs. scaffolded

**Fully implemented (the parts where a bug loses money or causes a race condition):**
- Money value object, schema, enums, state machines
- Subscription create/renew/cancel with corporate subsidy pricing
- Payment settlement (idempotent CAS, webhook-replay-safe)
- Telebirr + CBE provider implementations with signing/verification
- Refund retry queue with exponential backoff
- Seat release/claim marketplace with atomic CAS claiming, self-claim prevention, payment-linked refund chaining
- Trip completion → ride status fan-out → rides-used increment → seat-claim `used` marking
- OTP with rate limiting, hashing, consumption-on-resend
- JWT session issuance/verification with `tokenVersion` + `jti` revocation
- Outbox pattern + worker drain loop with dead-lettering
- Idempotency-Key middleware, rate-limit middleware, ToS gate middleware, CSP middleware

**Scaffolded consistently (same module shape — service/repository/types/routes — ready to fill in mechanically, lower financial/concurrency risk):**
- `catalog` (routes/plans/shuttles CRUD — standard Drizzle CRUD, no special logic)
- `support` (tickets/FAQ — standard state machine `open→in_progress→resolved→closed`)
- `engagement` (notification channel interfaces defined in §11; handlers stubbed in worker)
- `corporate` (member approval, monthly reset — reset logic shown in worker)
- `admin` (dashboards/audit-log search — read-heavy, no novel logic beyond what's shown)
- Frontend pages, mobile app, i18n content, full test suites, Docker/Caddy infra files

Given this is a from-scratch multi-quarter platform, the highest-value next step is to take these scaffolded modules and apply the exact same repository→service→routes pattern demonstrated above (e.g., `contractorVerification` state machine mirrors `subscriptionState` exactly), then build out the Next.js pages/Expo screens against the now-typed SDK generated from `packages/api/openapi.json`.
