import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, text, boolean, integer, real, decimal, jsonb,
  timestamp, date, index, uniqueIndex, check, primaryKey,
} from 'drizzle-orm/pg-core';

// ---------- enums ----------
export const userRole = pgEnum('user_role', ['rider', 'contractor', 'corporate_admin', 'platform_admin']);
export const verificationStatus = pgEnum('verification_status', ['unverified', 'pending', 'verified', 'rejected']);
export const subscriptionStatus = pgEnum('subscription_status', ['pending_payment', 'active', 'expired', 'cancelled']);
export const paymentStatus = pgEnum('payment_status', ['pending', 'completed', 'failed', 'refunded', 'partially_refunded']);
export const paymentMethod = pgEnum('payment_method', ['telebirr', 'cbe']);
export const refundStatus = pgEnum('refund_status', ['pending', 'processing', 'succeeded', 'failed', 'permanent_failure']);
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
export const documentScanStatus = pgEnum('document_scan_status', ['pending', 'clean', 'infected', 'error']);
export const approvalStatus = pgEnum('approval_status', ['pending', 'approved', 'rejected']);
export const contractorDocumentType = pgEnum('contractor_document_type', ['registration', 'insurance', 'inspection']);
export const outboxEventStatus = pgEnum('outbox_event_status', ['pending', 'processing', 'delivered', 'failed', 'dead']);

const ts = (name: string) => timestamp(name, { withTimezone: true });
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
  deletedAt: ts('deleted_at'),
  tokenVersion: integer('token_version').notNull().default(0),
  twoFactorSecret: text('two_factor_secret'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  tosVersion: text('tos_version'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({ activeIdx: index().on(t.isActive, t.deletedAt) }));

export const riderProfiles = pgTable('rider_profiles', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  homeArea: text('home_area').notNull(),
  workArea: text('work_area').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
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
  verifiedAt: ts('verified_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  // §8.1 item 16: rating must be between 0 and 5. Without this check, a bug
  // could set rating to -100 or 9999, which would render incorrectly in the
  // rider dashboard and break analytics.
  ratingCheck: check('rating_range', sql`${t.rating} between 0 and 5`),
}));

export const contractorDocuments = pgTable('contractor_documents', {
  id: text('id').primaryKey().$defaultFn(createId),
  contractorId: text('contractor_id').notNull().references(() => contractorProfiles.id, { onDelete: 'cascade' }),
  type: contractorDocumentType('type').notNull(),
  originalFilename: text('original_filename').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  checksumSha256: text('checksum_sha256').notNull(),
  scanStatus: documentScanStatus('scan_status').notNull().default('pending'),
  uploadedAt: ts('uploaded_at').notNull().defaultNow(),
}, (t) => ({
  contractorIdx: index().on(t.contractorId, t.type),
  // FIX (DB-011): dedup duplicate document uploads by content hash.
  contractorChecksumUniq: uniqueIndex('contractor_documents_contractor_checksum_uniq').on(t.contractorId, t.checksumSha256),
}));

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
  deletedAt: ts('deleted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({ subsidyCheck: check('subsidy_range', sql`${t.subsidyPercent} between 0 and 100`) }));

export const corporateMembers = pgTable('corporate_members', {
  id: text('id').primaryKey().$defaultFn(createId),
  corporateId: text('corporate_id').notNull().references(() => corporates.id, { onDelete: 'cascade' }),
  // Note: userId uniqueness is enforced via a PARTIAL unique index below
  // (corpUserActiveUniq) so that soft-deleted members (deletedAt IS NOT NULL)
  // can re-join a different corporate. A column-level .unique() would block
  // re-joining because the old row still exists.
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  employeeId: text('employee_id').notNull(),
  approvalStatus: approvalStatus('approval_status').notNull().default('pending'),
  ridesUsedThisMonth: integer('rides_used_this_month').notNull().default(0),
  lastResetAt: ts('last_reset_at').notNull().defaultNow(),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: ts('deleted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  // Partial unique indexes: only enforce uniqueness for ACTIVE (non-deleted)
  // members. A soft-deleted member can re-join a different corporate, and
  // their old employeeId can be reused.
  corpUserActiveUniq: uniqueIndex('corp_member_user_active_uniq').on(t.userId).where(sql`${t.deletedAt} is null`),
  corpEmpActiveUniq: uniqueIndex('corp_member_corp_emp_active_uniq').on(t.corporateId, t.employeeId).where(sql`${t.deletedAt} is null`),
  corpIdx: index().on(t.corporateId),
  // FIX (DATA-002): full (non-partial) index on userId for queries that
  // don't filter deletedAt (e.g. admin lists, retention-cleanup).
  userIdIdx: index().on(t.userId),
  // FIX (DB-010): corporate-reset-monthly cron's WHERE lastResetAt < date_trunc('month', now())
  lastResetIdx: index().on(t.lastResetAt),
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
  deletedAt: ts('deleted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
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
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  // FIX (DATA-010): Without these checks, a bug could insert capacity=0 (a
  // shuttle with zero seats — every bookRide CAS check fails) or capacity=-5
  // (negative — seatsBooked < -5 is always false, no one can book), or
  // year=99999. Capacity is bounded to a sane vehicle range (1-100) and
  // year is bounded to plausible model years.
  capacityCheck: check('capacity_positive', sql`${t.capacity} > 0 AND ${t.capacity} <= 100`),
  yearCheck: check('year_valid', sql`${t.year} BETWEEN 1990 AND EXTRACT(YEAR FROM now()) + 1`),
}));

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
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  // FIX (DATA-006): ridesIncluded uses -1 as a magic sentinel for "unlimited".
  // Without a CHECK, a bug could insert 0 (then rides_used < 0 is always false
  // — incrementRidesUsed's guard blocks all increments, freezing the sub) or
  // -5 (semantically meaningless). Constrain to either -1 OR > 0.
  ridesIncludedCheck: check('rides_included_valid', sql`${t.ridesIncluded} = -1 OR ${t.ridesIncluded} > 0`),
  // FIX (DATA-010 / DATA-013): durationDays must be positive (a 0-day plan
  // expires immediately), and priceETB must be non-negative.
  durationDaysCheck: check('duration_days_positive', sql`${t.durationDays} > 0`),
  priceNonNeg: check('price_etb_nonneg', sql`${t.priceETB} >= 0`),
}));

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
  startDate: ts('start_date').notNull().defaultNow(),
  endDate: ts('end_date').notNull(),
  cancelledAt: ts('cancelled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  riderStatusIdx: index().on(t.riderId, t.status),
  statusEndIdx: index().on(t.status, t.endDate),
  corpMemberIdx: index().on(t.corporateMemberId),
  // FIX (DATA-013): prevents endDate < startDate (a bug in subscriptionService.create
  // could otherwise produce a subscription that immediately expires).
  endAfterStartCheck: check('sub_end_after_start', sql`${t.endDate} > ${t.startDate}`),
  // FIX (DATA-010): ridesUsed can never be negative.
  ridesUsedNonNeg: check('sub_rides_used_nonneg', sql`${t.ridesUsed} >= 0`),
}));

export const trips = pgTable('trips', {
  id: text('id').primaryKey().$defaultFn(createId),
  shuttleId: text('shuttle_id').notNull().references(() => shuttles.id, { onDelete: 'restrict' }),
  contractorId: text('contractor_id').references(() => contractorProfiles.id, { onDelete: 'set null' }),
  routeId: text('route_id').notNull().references(() => routes.id, { onDelete: 'restrict' }),
  window: seatWindow('window').notNull(),
  departTime: ts('depart_time').notNull(),
  arriveTime: ts('arrive_time'),
  status: tripStatus('status').notNull().default('scheduled'),
  seatsBooked: integer('seats_booked').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  routeDepartIdx: index().on(t.routeId, t.departTime),
  shuttleIdx: index().on(t.shuttleId),
  shuttleDepartWindowUniq: uniqueIndex().on(t.shuttleId, t.departTime, t.window),
  seatsBookedCheck: check('seats_booked_non_negative', sql`${t.seatsBooked} >= 0`),
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
  expiresAt: ts('expires_at').notNull(),
  cancelledAt: ts('cancelled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
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
  refundedAt: ts('refunded_at'),
  retentionExpiresAt: ts('retention_expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  statusCreatedIdx: index().on(t.status, t.createdAt),
  riderIdx: index().on(t.riderId),
  // FIX (DATA-005): Add non-negativity checks for money columns. A bug in
  // service code (sign flip during refund allocation, Money.sub returning
  // negative) could previously persist `amount = '-50.00'`. The Money class
  // throws on negative sub(), but Money.fromDecimal('-50.00').toString()
  // returns '-50.00' without throwing — so a malicious or buggy caller can
  // persist negative money. The DB now catches it.
  amountNonNeg: check('amount_nonneg', sql`${t.amount} >= 0`),
  refundAmountNonNeg: check('refund_amount_nonneg', sql`${t.refundAmount} >= 0`),
  refundAmountCheck: check('refund_amount_lte_amount', sql`${t.refundAmount} <= ${t.amount}`),
  // FIX (DATA-002): missing FK indexes used in hot paths.
  subscriptionIdx: index().on(t.subscriptionId),
  seatClaimIdx: index().on(t.seatClaimId),
}));

export const seatClaims = pgTable('seat_claims', {
  id: text('id').primaryKey().$defaultFn(createId),
  seatReleaseId: text('seat_release_id').notNull().references(() => seatReleases.id, { onDelete: 'cascade' }).unique(),
  riderId: text('rider_id').notNull().references(() => riderProfiles.id, { onDelete: 'restrict' }),
  corporateMemberId: text('corporate_member_id').references(() => corporateMembers.id, { onDelete: 'set null' }),
  routeId: text('route_id').notNull().references(() => routes.id, { onDelete: 'restrict' }),
  window: seatWindow('window').notNull(),
  claimDate: ts('claim_date').notNull().defaultNow(),
  paymentId: text('payment_id').references((): any => payments.id, { onDelete: 'set null' }),
  status: seatClaimStatus('status').notNull().default('confirmed'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  riderIdx: index().on(t.riderId),
  // FIX (DATA-002): index on paymentId for the webhook refund-lookup path
  paymentIdx: index().on(t.paymentId),
}));

export const rides = pgTable('rides', {
  id: text('id').primaryKey().$defaultFn(createId),
  riderId: text('rider_id').notNull().references(() => riderProfiles.id, { onDelete: 'restrict' }),
  tripId: text('trip_id').notNull().references(() => trips.id, { onDelete: 'restrict' }),
  subscriptionId: text('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
  seatClaimId: text('seat_claim_id').references(() => seatClaims.id, { onDelete: 'set null' }),
  status: rideStatus('status').notNull().default('booked'),
  pickupStop: text('pickup_stop'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  tripRiderUniq: uniqueIndex().on(t.tripId, t.riderId),
  riderIdx: index().on(t.riderId),
  // FIX (DATA-002): indexes for FK columns used in hot paths
  subscriptionIdx: index().on(t.subscriptionId),
  seatClaimIdx: index().on(t.seatClaimId),
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
  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
  lastError: text('last_error'),
  status: refundStatus('status').notNull().default('pending'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
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
  resolvedById: text('resolved_by_id').references((): any => users.id, { onDelete: 'set null' }),
  firstResponseAt: ts('first_response_at'),
  resolvedAt: ts('resolved_at'),
  closedAt: ts('closed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  userStatusIdx: index().on(t.userId, t.status),
  statusCreatedIdx: index().on(t.status, t.createdAt),
  // FIX (DATA-002): indexes for FK columns used in ticket-lookup paths
  subscriptionIdx: index().on(t.subscriptionId),
  paymentIdx: index().on(t.paymentId),
}));

export const ticketMessages = pgTable('ticket_messages', {
  id: text('id').primaryKey().$defaultFn(createId),
  ticketId: text('ticket_id').notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  body: text('body').notNull(),
  isStaff: boolean('is_staff').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ ticketIdx: index().on(t.ticketId, t.createdAt) }));

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: notificationType('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
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
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const devices = pgTable('devices', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  pushToken: text('push_token').notNull(),
  platform: text('platform').notNull(),
  userAgent: text('user_agent'),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ userTokenUniq: uniqueIndex().on(t.userId, t.pushToken) }));

export const outboxEvents = pgTable('outbox_events', {
  id: text('id').primaryKey().$defaultFn(createId),
  channel: outboxChannel('channel').notNull(),
  payload: jsonb('payload').notNull(),
  status: outboxEventStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
  lastError: text('last_error'),
  lockedAt: ts('locked_at'),
  lockedBy: text('locked_by'),
  visibilityAfter: ts('visibility_after'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({
  statusNextIdx: index().on(t.status, t.nextAttemptAt),
  channelIdx: index().on(t.channel, t.status),
  // FIX (DB-009): GIN index for send-expiry-reminders cron's NOT EXISTS subquery on payload->>'type' / payload->>'subscriptionId'
  payloadGinIdx: index('outbox_events_payload_gin').using('gin', sql`${t.payload} jsonb_path_ops`),
}));

export const idempotencyRecords = pgTable('idempotency_records', {
  key: text('key').primaryKey(),
  userId: text('user_id'),
  method: text('method').notNull(),
  path: text('path').notNull(),
  requestBodyHash: text('request_body_hash').notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: jsonb('response_body').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({
  expiresAtIdx: index().on(t.expiresAt),
  userIdIdx: index().on(t.userId),
}));

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
  createdAt: ts('created_at').notNull().defaultNow(),
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
  expiresAt: ts('expires_at').notNull(),
  verified: boolean('verified').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({
  // Partial unique index: only one UNVERIFIED OTP per (phone, purpose) at a time.
  // We deliberately do NOT include `expires_at > now()` in the predicate —
  // PostgreSQL requires partial-index predicates to be IMMUTABLE, and now()
  // is STABLE (depends on transaction start time). Including it would cause
  // `CREATE INDEX` to fail with "functions in index predicate must be marked
  // IMMUTABLE". The otpService.send() path already invalidates prior
  // unverified codes (sets verified=true) before inserting a new one, so
  // the unique constraint on (phone, purpose) WHERE verified=false is
  // sufficient to prevent duplicate active codes. Expired-but-unverified
  // codes are cleaned up by the retention-cleanup cron.
  phonePurposeUniq: uniqueIndex('otp_phone_purpose_active_uniq').on(t.phone, t.purpose).where(sql`${t.verified} = false`),
  phonePurposeIdx: index().on(t.phone, t.purpose, t.verified, t.expiresAt),
}));

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  ipAddress: text('ip_address'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const tosAcceptances = pgTable('tos_acceptances', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  acceptedAt: ts('accepted_at').notNull().defaultNow(),
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
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => ({ categorySortIdx: index().on(t.category, t.isActive, t.sortOrder) }));

export const shuttlePositions = pgTable('shuttle_positions', {
  shuttleId: text('shuttle_id').notNull().references(() => shuttles.id, { onDelete: 'cascade' }).primaryKey(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  heading: real('heading'),
  speed: real('speed'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const telebirrNotifyEvents = pgTable('telebirr_notify_events', {
  // ON DELETE RESTRICT (not cascade) — telebirrNotifyEvents is a tamper-evident
  // audit log of inbound payment notifications. Deleting a payment should NOT
  // silently destroy the notification record. RESTRICT forces the caller to
  // explicitly handle the dependency (e.g. by keeping the payment row and
  // anonymizing its PII instead of deleting it).
  //
  // FOLLOW-UP 2 (PAY-002): composite PK on (merchOrderId, outRequestNo, receivedAt).
  // Telebirr can send out-of-order/supplementary notifications for the same order
  // (e.g. 'failed' on timeout then 'settled' when it actually completes). The old
  // single-column PK on merchOrderId dropped the second notification, leaving the
  // payment in the wrong state. The composite PK records every distinct notification
  // and the webhook handler applies a state-machine override on conflict.
  merchOrderId: text('merch_order_id').notNull().references(() => payments.reference, { onDelete: 'restrict' }),
  tradeStatus: text('trade_status').notNull(),
  outRequestNo: text('out_request_no').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
}, (t) => ({
  // Composite PK: each distinct Telebirr notification is recorded.
  pk: primaryKey({ columns: [t.merchOrderId, t.outRequestNo, t.receivedAt] }),
  // Index for "find latest notification for this order" queries.
  merchIdx: index('telebirr_notify_events_merch_order_id_index').on(t.merchOrderId, t.receivedAt),
}));

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey().$defaultFn(createId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jti: text('jti').notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  impersonatedBy: text('impersonated_by').references(() => users.id, { onDelete: 'set null' }),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdIdx: index().on(t.userId),
  expiresAtIdx: index().on(t.expiresAt),
  userExpiresAtIdx: index().on(t.userId, t.expiresAt),
}));

// FOLLOW-UP 3 (INFRA-009): Durable notification_log for SMS/email/push idempotency.
// Records every successfully-sent message, keyed by (outbox_event_id, channel),
// so handlers can skip re-sends on outbox retry. 90-day retention (matches outbox).
export const notificationLog = pgTable('notification_log', {
  id: text('id').primaryKey().$defaultFn(createId),
  outboxEventId: text('outbox_event_id').notNull(),
  channel: text('channel').notNull(),
  providerMessageId: text('provider_message_id'),
  recipient: text('recipient').notNull(),
  sentAt: ts('sent_at').notNull().defaultNow(),
}, (t) => ({
  outboxChannelUniq: uniqueIndex('notification_log_outbox_channel_uniq').on(t.outboxEventId, t.channel),
  recipientSentIdx: index('notification_log_recipient_sent_at_index').on(t.recipient, t.sentAt),
  sentIdx: index('notification_log_sent_at_index').on(t.sentAt),
}));
