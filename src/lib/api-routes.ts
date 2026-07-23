
import { NextRequest } from 'next/server';
import { api, ApiOptions } from '@/lib/api';

type Handler = (...args: any[]) => Promise<any> | any;
type RouteEntry = {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  options: ApiOptions;
  handler: Handler;
  // If true, the dispatcher bypasses JSON body parsing + the api() wrapper
  raw?: boolean;
};

function r(method: string, path: string, options: ApiOptions, handler: Handler, raw = false): RouteEntry {
  const paramNames: string[] = [];
  const patternStr = path.replace(/:([a-zA-Z_]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${patternStr}$`), paramNames, options, handler, raw };
}

export function findRoute(method: string, path: string): { entry: RouteEntry; params: Record<string, string> } | null {
  for (const entry of ROUTES) {
    if (entry.method !== method) continue;
    const m = entry.pattern.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    entry.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]!); });
    return { entry, params };
  }
  return null;
}

import * as identity from '@/lib/api-identity';
import * as catalog from '@/lib/api-catalog';
import * as subscriptions from '@/lib/api-subscriptions';
import * as payments from '@/lib/api-payments';
import * as marketplace from '@/lib/api-marketplace';
import * as operations from '@/lib/api-operations';
import * as support from '@/lib/api-support';
import * as admin from '@/lib/api-admin';
import * as adminAdvanced from '@/lib/api-admin-advanced';
import * as webhooks from '@/lib/api-webhooks';
import * as cron from '@/lib/api-cron';
import * as tos from '@/lib/api-tos';
import * as account from '@/lib/api-account';
import * as dashboard from '@/lib/api-dashboard';
import * as engagement from '@/lib/api-engagement';
import * as corporate from '@/lib/api-corporate';
import * as documents from '@/lib/api-documents';
import * as files from '@/lib/api-files';
import * as telebirr from '@/lib/api-telebirr';
import * as health from '@/lib/api-health';
import * as metrics from '@/lib/api-metrics';
import * as assignments from '@/lib/api-assignments';

// Note: the catch-all mounts at /api/v1, so paths here are relative to that.
const ROUTES: RouteEntry[] = [
  // Identity / auth
  r('POST', '/auth/register', { exemptFromTosGate: true }, identity.POST_register),
  r('POST', '/auth/token', { exemptFromTosGate: true }, identity.POST_token),
  r('POST', '/auth/logout', {}, identity.POST_logout),
  r('POST', '/auth/logout-all', { requireAuth: true, exemptFromTosGate: true }, identity.POST_logout_all),
  r('POST', '/auth/refresh', { exemptFromTosGate: true }, identity.POST_refresh),
  r('GET',  '/auth/me', { requireAuth: true, exemptFromTosGate: true }, identity.GET_me),
  r('POST', '/auth/change-password', { requireAuth: true }, identity.POST_change_password),
  // P1 / API-009: phone-change flow.
  r('POST', '/account/phone/change/request', { requireAuth: true }, identity.POST_phone_change_request),
  r('POST', '/account/phone/change/confirm', { requireAuth: true }, identity.POST_phone_change_confirm),
  r('GET',  '/auth/sessions', { requireAuth: true, exemptFromTosGate: true }, identity.GET_sessions),
  r('DELETE', '/auth/sessions/:id', { requireAuth: true, exemptFromTosGate: true }, identity.DELETE_session),
  // P1 / API-012: admin session management for any user.
  r('GET',    '/admin/users/:id/sessions', { requireAuth: true, requireRole: ['platform_admin'], exemptFromTosGate: true }, identity.GET_admin_user_sessions),
  r('DELETE', '/admin/users/:id/sessions/:sid', { requireAuth: true, requireRole: ['platform_admin'], exemptFromTosGate: true }, identity.DELETE_admin_user_session),
  r('POST', '/auth/otp/send', { exemptFromTosGate: true }, identity.POST_otp_send),
  r('POST', '/auth/otp/verify', { exemptFromTosGate: true }, identity.POST_otp_verify),
  r('POST', '/auth/phone/verify', { requireAuth: true }, identity.POST_phone_verify),
  r('POST', '/auth/password/reset', { exemptFromTosGate: true }, identity.POST_password_reset),
  r('POST', '/auth/password/reset/confirm', { exemptFromTosGate: true }, identity.POST_password_reset_confirm),
  r('POST', '/auth/2fa/setup', { requireAuth: true }, identity.POST_2fa_setup),
  r('POST', '/auth/2fa/enable', { requireAuth: true }, identity.POST_2fa_enable),
  r('POST', '/auth/2fa/verify', { requireAuth: true }, identity.POST_2fa_verify),
  r('POST', '/auth/2fa/disable', { requireAuth: true }, identity.POST_2fa_disable),

  r('GET', '/plans', {}, catalog.GET_plans),
  r('GET', '/routes', {}, catalog.GET_routes),
  r('GET', '/routes/:id', {}, catalog.GET_route),
  r('GET', '/routes/:id/pickups', {}, assignments.GET_pickups),
  r('POST', '/routes/:id/pickups', { requireAuth: true, requireRole: ['platform_admin'] }, assignments.POST_pickup),
  r('DELETE', '/pickups/:id', { requireAuth: true, requireRole: ['platform_admin'] }, assignments.DELETE_pickup),
  r('GET', '/shuttles', {}, catalog.GET_shuttles),
  r('GET', '/trips', {}, catalog.GET_trips),
  r('GET', '/trips/:id', {}, catalog.GET_trip),
  r('GET', '/faqs', {}, catalog.GET_faqs),

  r('GET', '/assignments', { requireAuth: true }, assignments.GET_assignments),
  r('GET', '/assignments/:id', { requireAuth: true }, assignments.GET_assignment),
  r('POST', '/admin/assignments', { requireAuth: true, requireRole: ['platform_admin'] }, assignments.POST_assignment),
  r('POST', '/assignments/:id/accept', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, assignments.POST_accept_assignment),
  r('POST', '/assignments/:id/reject', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, assignments.POST_reject_assignment),
  r('GET', '/contractor/assignments', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, assignments.GET_my_assignments),

  r('GET', '/subscriptions', { requireAuth: true }, subscriptions.GET_list),
  r('POST', '/subscriptions', { requireAuth: true }, subscriptions.POST_create),
  r('GET', '/subscriptions/:id', { requireAuth: true }, subscriptions.GET_one),
  r('POST', '/subscriptions/:id/cancel', { requireAuth: true }, subscriptions.POST_cancel),
  r('DELETE', '/subscriptions/:id', { requireAuth: true }, subscriptions.DELETE_subscription),
  r('POST', '/subscriptions/:id/renew', { requireAuth: true }, subscriptions.POST_renew),

  r('POST', '/payments/checkout', { requireAuth: true }, payments.POST_checkout),
  r('GET', '/payments/:id', { requireAuth: true }, payments.GET_one),
  r('GET', '/payments', { requireAuth: true }, payments.GET_list),
  // Refunds: single endpoint at /admin/payments/:id/refund (admin-only).
  // The previous /payments/:id/refund and /admin/refunds duplicates were removed.

  r('GET', '/marketplace/seat-releases', { requireAuth: true }, marketplace.GET_releases),
  r('GET', '/marketplace/seat-releases/:id', { requireAuth: true }, marketplace.GET_release),
  r('GET', '/marketplace/my-releases', { requireAuth: true }, marketplace.GET_my_releases),
  r('POST', '/marketplace/seat-releases', { requireAuth: true }, marketplace.POST_create_release),
  r('POST', '/marketplace/seat-releases/:id/claim', { requireAuth: true }, marketplace.POST_claim),
  r('POST', '/marketplace/seat-releases/:id/cancel', { requireAuth: true }, marketplace.POST_cancel_release),
  r('DELETE', '/marketplace/seat-releases/:id', { requireAuth: true }, marketplace.DELETE_release),
  r('GET', '/marketplace/seat-claims', { requireAuth: true }, marketplace.GET_claims),
  r('GET', '/marketplace/seat-claims/:id', { requireAuth: true }, marketplace.GET_claim),
  r('POST', '/marketplace/seat-claims', { requireAuth: true }, marketplace.POST_claim_direct),

  r('GET', '/rides', { requireAuth: true }, operations.GET_rides),
  r('GET', '/rides/:id', { requireAuth: true }, operations.GET_ride),
  r('POST', '/rides', { requireAuth: true }, operations.POST_ride),
  r('PATCH', '/rides/:id', { requireAuth: true }, operations.PATCH_ride),
  r('POST', '/rides/:id/cancel', { requireAuth: true }, operations.POST_ride_cancel),
  r('POST', '/trips', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, operations.POST_trip),
  r('PATCH', '/trips/:id', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, operations.PATCH_trip),
  r('POST', '/trips/:id/board', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, operations.POST_board),
  r('POST', '/trips/:id/complete', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, operations.POST_complete),
  r('POST', '/trips/:id/cancel', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, operations.POST_trip_cancel),
  r('GET', '/shuttle-positions', { requireAuth: true }, operations.GET_shuttle_positions),
  r('POST', '/shuttle-positions', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, operations.POST_shuttle_position),
  r('GET', '/shuttle-positions/stream', { requireAuth: true }, operations.handleShuttlePositionStream, true),

  r('GET', '/tickets', { requireAuth: true }, support.GET_list),
  r('POST', '/tickets', { requireAuth: true }, support.POST_create),
  r('GET', '/tickets/:id', { requireAuth: true }, support.GET_one),
  r('PATCH', '/tickets/:id', { requireAuth: true }, support.PATCH_ticket),
  r('GET', '/tickets/:id/messages', { requireAuth: true }, support.GET_messages),
  r('POST', '/tickets/:id/messages', { requireAuth: true }, support.POST_message),
  r('POST', '/tickets/:id/messages/with-attachment', { requireAuth: true }, support.handleTicketMessageWithAttachment, true),

  r('GET', '/notifications', { requireAuth: true }, engagement.GET_notifications),
  r('GET', '/notifications/unread-count', { requireAuth: true }, engagement.GET_unread_count),
  r('GET', '/notifications/preferences', { requireAuth: true }, engagement.GET_preferences),
  r('POST', '/notifications/:id/read', { requireAuth: true }, engagement.POST_mark_read),
  r('PATCH', '/notifications/:id', { requireAuth: true }, engagement.PATCH_notification),
  r('DELETE', '/notifications/:id', { requireAuth: true }, engagement.DELETE_notification),
  r('POST', '/notifications/read-all', { requireAuth: true }, engagement.POST_mark_all_read),
  r('PATCH', '/notifications/preferences', { requireAuth: true }, engagement.PATCH_preferences),
  r('POST', '/devices', { requireAuth: true }, engagement.POST_device),
  r('DELETE', '/devices', { requireAuth: true }, engagement.DELETE_device),

  r('GET', '/account', { requireAuth: true }, account.GET_account),
  r('PATCH', '/account', { requireAuth: true }, account.PATCH_account),
  r('GET', '/account/export', { requireAuth: true }, account.GET_export),
  r('POST', '/account/delete', { requireAuth: true, exemptFromTosGate: true }, account.POST_delete),

  r('GET', '/dashboard/rider', { requireAuth: true, requireRole: ['rider', 'platform_admin'] }, dashboard.GET_rider),
  r('GET', '/dashboard/rider/active-trip', { requireAuth: true, requireRole: ['rider', 'platform_admin'] }, dashboard.GET_rider_active_trip),
  r('GET', '/dashboard/contractor', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, dashboard.GET_contractor),
  r('GET', '/dashboard/corporate', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, dashboard.GET_corporate),
  r('GET', '/dashboard/admin', { requireAuth: true, requireRole: ['platform_admin'] }, dashboard.GET_admin),

  r('GET', '/tos/current', { exemptFromTosGate: true }, tos.GET_current),
  r('POST', '/tos/accept', { requireAuth: true, exemptFromTosGate: true }, tos.POST_accept),

  r('GET', '/admin/users', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_users),
  r('GET', '/admin/payments', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_payments),
  r('GET', '/admin/payments/:id', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_payment),
  r('POST', '/admin/payments/:id/refund', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_refund),
  r('GET', '/admin/audit-logs', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_audit_logs),
  r('GET', '/admin/plans', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_plans),
  r('POST', '/admin/plans', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_plans),
  r('PATCH', '/admin/plans/:id', { requireAuth: true, requireRole: ['platform_admin'] }, admin.PATCH_plan),
  r('DELETE', '/admin/plans/:id', { requireAuth: true, requireRole: ['platform_admin'] }, admin.DELETE_plan),
  r('GET', '/admin/contractors', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_contractors),
  r('POST', '/admin/contractors/:id/verify', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_verify_contractor),
  r('GET', '/admin/shuttles', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_shuttles),
  r('POST', '/admin/shuttles', { requireAuth: true, requireRole: ['platform_admin', 'contractor'] }, admin.POST_shuttles),
  r('PATCH', '/admin/shuttles/:id', { requireAuth: true, requireRole: ['platform_admin'] }, admin.PATCH_shuttle),
  r('GET', '/admin/routes', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_routes),
  r('POST', '/admin/routes', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_routes),
  r('PATCH', '/admin/routes/:id', { requireAuth: true, requireRole: ['platform_admin'] }, admin.PATCH_route),
  r('GET', '/admin/tickets', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_tickets),
  r('POST', '/admin/tickets/:id/messages', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_ticket_message),
  r('POST', '/admin/audit/verify', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_audit_verify),
  // Trip creation is at POST /trips (operations) — admin/trips duplicate removed.

  r('GET',  '/admin/dashboard', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.GET_dashboard),
  r('PATCH', '/admin/users/:id', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.PATCH_user),
  r('POST', '/admin/users/:id/impersonate', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.POST_impersonate),
  r('GET',  '/admin/contractors/pending', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.GET_pending_contractors),
  r('POST', '/admin/contractors/:id/reject', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.POST_reject_contractor),
  r('GET',  '/admin/corporates', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.GET_corporates),
  r('GET',  '/admin/corporates/pending', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.GET_pending_corporates),
  r('POST', '/admin/corporates/:id/activate', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.POST_activate_corporate),
  r('DELETE', '/admin/corporates/:id', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.DELETE_corporate),
  r('GET',  '/admin/subscriptions', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.GET_admin_subscriptions),
  r('POST', '/admin/payments/:id/verify', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.POST_verify_payment),
  r('GET',  '/admin/export/:resource', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.GET_export_csv),
  r('DELETE', '/admin/routes/:id', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.DELETE_route),
  r('DELETE', '/admin/shuttles/:id', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.DELETE_shuttle),
  r('GET', '/admin/settings', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.GET_settings),
  r('PUT', '/admin/settings', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.PUT_settings),
  r('POST', '/admin/bulk/expire', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.POST_bulk_expire),
  r('POST', '/admin/bulk/suspend', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.POST_bulk_suspend),
  r('POST', '/admin/bulk/refund', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.POST_bulk_refund),
  r('PATCH', '/admin/routes/:id/price', { requireAuth: true, requireRole: ['platform_admin'] }, adminAdvanced.PATCH_route_price),
  r('POST', '/admin/faqs', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_faq),
  r('DELETE', '/admin/faqs/:id', { requireAuth: true, requireRole: ['platform_admin'] }, admin.DELETE_faq),

  // P2 / BIZ-054: holiday management (skip trip generation on holidays).
  r('GET', '/admin/holidays', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_holidays),
  r('POST', '/admin/holidays', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_holiday),
  r('DELETE', '/admin/holidays/:id', { requireAuth: true, requireRole: ['platform_admin'] }, admin.DELETE_holiday),

  r('GET', '/contractor/shuttles', { requireAuth: true, requireRole: ['contractor'] }, admin.GET_my_shuttles),
  r('GET', '/contractor/trips', { requireAuth: true, requireRole: ['contractor'] }, admin.GET_my_trips),

  r('POST', '/webhooks/telebirr/notify', { exemptFromTosGate: true }, webhooks.handleTelebirrNotify, true),

  r('GET', '/health', { exemptFromTosGate: true }, health.GET_health),
  r('GET', '/healthz', { exemptFromTosGate: true }, health.GET_healthz),
  r('GET', '/ready', { exemptFromTosGate: true }, health.GET_ready),

  // P2-66: Prometheus metrics endpoint (admin-only — exposes operational intel).
  r('GET', '/metrics', { requireAuth: true, requireRole: ['platform_admin'], exemptFromTosGate: true }, metrics.GET_metrics),

  r('POST', '/cron/run', { exemptFromTosGate: true }, cron.POST_run),
  r('GET', '/cron', { exemptFromTosGate: true }, cron.GET_cron_jobs),

  r('POST', '/payments/telebirr/inapp-checkout', { requireAuth: true }, telebirr.POST_inapp_checkout),
  r('POST', '/payments/telebirr/mandate/sign-url', { requireAuth: true }, telebirr.POST_mandate_sign_url),
  r('GET',  '/payments/telebirr/mandate/:mctContractNo', { requireAuth: true }, telebirr.GET_mandate),
  r('POST', '/payments/telebirr/mandate/:mctContractNo/cancel', { requireAuth: true }, telebirr.POST_mandate_cancel),
  r('POST', '/payments/telebirr/disburse', { requireAuth: true, requireRole: ['platform_admin'] }, telebirr.POST_disburse),

  r('POST', '/corporate/onboard', { requireAuth: true }, corporate.POST_onboard),
  r('GET',  '/corporate', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.GET_current),
  r('GET',  '/corporate/me', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.GET_me),
  r('PATCH', '/corporate', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.PATCH_corporate),
  r('GET',  '/corporate/invites', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.GET_invites),
  r('POST', '/corporate/invites', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.POST_invite),
  r('DELETE', '/corporate/invites/:id', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.DELETE_invite),
  r('POST', '/corporate/signup', { requireAuth: true, requireRole: ['rider'] }, corporate.POST_signup),
  r('POST', '/corporate/validate-invite', { exemptFromTosGate: true }, corporate.POST_validate_invite),
  r('GET',  '/corporate/members', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.GET_members),
  r('POST', '/corporate/members/:id/approve', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.POST_approve),
  r('POST', '/corporate/members/:id/reject', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.POST_reject),
  r('PATCH', '/corporate/members/:id', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.PATCH_member),
  r('DELETE', '/corporate/members/:id', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.DELETE_member),

  r('GET',  '/contractor/documents', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, documents.GET_documents),
  r('GET',  '/contractor/documents/:contractorId', { requireAuth: true, requireRole: ['platform_admin'] }, documents.GET_documents_for),
  r('POST', '/contractor/documents', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, documents.handleDocumentUpload, true),

  r('GET',  '/files/:id', { requireAuth: true }, files.handleFileDownload, true),
];
