import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, text, boolean, integer, real, decimal, jsonb,
  timestamp, date, index, uniqueIndex, check, primaryKey,
} from 'drizzle-orm/pg-core';

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

  corpUserActiveUniq: uniqueIndex('corp_member_user_active_uniq').on(t.userId).where(sql`${t.deletedAt} is null`),
  corpEmpActiveUniq: uniqueIndex('corp_member_corp_emp_active_uniq').on(t.corporateId, t.employeeId).where(sql`${t.deletedAt} is null`),
  corpIdx: index().on(t.corporateId),

  userIdIdx: index().on(t.userId),

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

  ridesIncludedCheck: check('rides_included_valid', sql`${t.ridesIncluded} = -1 OR ${t.ridesIncluded} > 0`),

  durationDaysCheck: check('duration_days_positive', sql`${t.durationDays} > 0`),
  priceNonNeg: check('price_etb_nonneg', sql`${t.priceETB} >= 0`),
  // DB-005: prevent unlimited trial plans (rides_included = -1 + is_trial = true).
  // A misconfigured trial plan would let users ride unlimited for the trial
  // duration — a money leak. The DB constraint is the source of truth; the
  // admin plan-create endpoint also validates.
  noUnlimitedTrialCheck: check('no_unlimited_trial', sql`NOT (${t.isTrial} = true AND ${t.ridesIncluded} = -1)`),
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

  endAfterStartCheck: check('sub_end_after_start', sql`${t.endDate} > ${t.startDate}`),

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

  amountNonNeg: check('amount_nonneg', sql`${t.amount} >= 0`),
  refundAmountNonNeg: check('refund_amount_nonneg', sql`${t.refundAmount} >= 0`),
  refundAmountCheck: check('refund_amount_lte_amount', sql`${t.refundAmount} <= ${t.amount}`),

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

  phonePurposeUniq: uniqueIndex('otp_phone_purpose_active_uniq').on(t.phone, t.purpose).where(sql`${t.verified} = false`),
  phonePurposeIdx: index().on(t.phone, t.purpose, t.verified, t.expiresAt),
}));

// DB-007: passwordResetTokens table was REMOVED. Password reset uses
// otp_codes with purpose='password_reset' — see packages/api/modules/identity/otp.ts.
// The password_reset_tokens table was dead schema (no code wrote to it);
// dropped in migration 0007.

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
  merchOrderId: text('merch_order_id').notNull().references(() => payments.reference, { onDelete: 'restrict' }),
  tradeStatus: text('trade_status').notNull(),
  outRequestNo: text('out_request_no').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.merchOrderId, t.outRequestNo] }),
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

  channelCheck: check('notification_log_channel_check', sql`${t.channel} in ('sms', 'email', 'push')`),
}));
