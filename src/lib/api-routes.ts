// Route dispatcher — single source of truth for the API surface.
// Each entry maps (METHOD, path-pattern) to a handler. The catch-all route
// file at app/api/v1/[[...route]]/route.ts looks up the handler here.
//
// Path patterns use :param for path parameters (e.g. /subscriptions/:id).

import { NextRequest } from 'next/server';
import { api, ApiOptions } from '@/lib/api';

type Handler = (ctx: any) => Promise<any> | any;
type RouteEntry = {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  options: ApiOptions;
  handler: Handler;
  // If true, the dispatcher bypasses JSON body parsing + the api() wrapper
  // and calls the handler directly with (req, session, params). Used for
  // multipart upload routes that need raw Request access.
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

// ─── Handler imports ────────────────────────────────────────────────────────
import * as identity from '@/lib/api-identity';
import * as catalog from '@/lib/api-catalog';
import * as subscriptions from '@/lib/api-subscriptions';
import * as payments from '@/lib/api-payments';
import * as marketplace from '@/lib/api-marketplace';
import * as operations from '@/lib/api-operations';
import * as support from '@/lib/api-support';
import * as admin from '@/lib/api-admin';
import * as webhooks from '@/lib/api-webhooks';
import * as cron from '@/lib/api-cron';
import * as tos from '@/lib/api-tos';
import * as account from '@/lib/api-account';
import * as dashboard from '@/lib/api-dashboard';
import * as engagement from '@/lib/api-engagement';
import * as corporate from '@/lib/api-corporate';
import * as documents from '@/lib/api-documents';
import * as files from '@/lib/api-files';

// ─── Route table ────────────────────────────────────────────────────────────
// Note: the catch-all mounts at /api/v1, so paths here are relative to that.
const ROUTES: RouteEntry[] = [
  // Identity / auth
  r('POST', '/auth/register', { exemptFromTosGate: true }, identity.POST_register),
  r('POST', '/auth/token', { exemptFromTosGate: true }, identity.POST_token),
  r('POST', '/auth/logout', {}, identity.POST_logout),
  r('POST', '/auth/refresh', { exemptFromTosGate: true }, identity.POST_refresh),
  r('GET',  '/auth/me', { requireAuth: true, exemptFromTosGate: true }, identity.GET_me),
  r('POST', '/auth/change-password', { requireAuth: true }, identity.POST_change_password),
  r('GET',  '/auth/sessions', { requireAuth: true, exemptFromTosGate: true }, identity.GET_sessions),
  r('DELETE', '/auth/sessions/:id', { requireAuth: true, exemptFromTosGate: true }, identity.DELETE_session),
  r('POST', '/auth/otp/send', { exemptFromTosGate: true }, identity.POST_otp_send),
  r('POST', '/auth/otp/verify', { exemptFromTosGate: true }, identity.POST_otp_verify),
  r('POST', '/auth/phone/verify', { requireAuth: true }, identity.POST_phone_verify),
  r('POST', '/auth/password/reset', { exemptFromTosGate: true }, identity.POST_password_reset),
  r('POST', '/auth/password/reset/confirm', { exemptFromTosGate: true }, identity.POST_password_reset_confirm),
  r('POST', '/auth/2fa/setup', { requireAuth: true }, identity.POST_2fa_setup),
  r('POST', '/auth/2fa/enable', { requireAuth: true }, identity.POST_2fa_enable),
  r('POST', '/auth/2fa/disable', { requireAuth: true }, identity.POST_2fa_disable),

  // Catalog (public)
  r('GET', '/plans', {}, catalog.GET_plans),
  r('GET', '/routes', {}, catalog.GET_routes),
  r('GET', '/shuttles', {}, catalog.GET_shuttles),
  r('GET', '/trips', {}, catalog.GET_trips),
  r('GET', '/faqs', {}, catalog.GET_faqs),

  // Subscriptions
  r('GET', '/subscriptions', { requireAuth: true }, subscriptions.GET_list),
  r('POST', '/subscriptions', { requireAuth: true }, subscriptions.POST_create),
  r('GET', '/subscriptions/:id', { requireAuth: true }, subscriptions.GET_one),
  r('POST', '/subscriptions/:id/cancel', { requireAuth: true }, subscriptions.POST_cancel),

  // Payments
  r('POST', '/payments/checkout', { requireAuth: true }, payments.POST_checkout),
  r('GET', '/payments/:id', { requireAuth: true }, payments.GET_one),
  r('GET', '/payments', { requireAuth: true }, payments.GET_list),
  r('POST', '/payments/:id/refund', { requireAuth: true, requireRole: ['platform_admin'] }, payments.POST_refund),

  // Marketplace (seat releases / claims)
  r('GET', '/marketplace/seat-releases', { requireAuth: true }, marketplace.GET_releases),
  r('POST', '/marketplace/seat-releases', { requireAuth: true }, marketplace.POST_create_release),
  r('POST', '/marketplace/seat-releases/:id/claim', { requireAuth: true }, marketplace.POST_claim),

  // Operations (rides, trips)
  r('GET', '/rides', { requireAuth: true }, operations.GET_rides),
  r('POST', '/rides', { requireAuth: true }, operations.POST_ride),
  r('POST', '/trips/:id/board', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, operations.POST_board),
  r('POST', '/trips/:id/complete', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, operations.POST_complete),

  // Support
  r('GET', '/tickets', { requireAuth: true }, support.GET_list),
  r('POST', '/tickets', { requireAuth: true }, support.POST_create),
  r('GET', '/tickets/:id', { requireAuth: true }, support.GET_one),
  r('POST', '/tickets/:id/messages', { requireAuth: true }, support.POST_message),

  // Engagement (notifications)
  r('GET', '/notifications', { requireAuth: true }, engagement.GET_notifications),
  r('POST', '/notifications/:id/read', { requireAuth: true }, engagement.POST_mark_read),
  r('POST', '/notifications/read-all', { requireAuth: true }, engagement.POST_mark_all_read),

  // Account
  r('GET', '/account/export', { requireAuth: true }, account.GET_export),
  r('POST', '/account/delete', { requireAuth: true, exemptFromTosGate: true }, account.POST_delete),

  // Dashboard
  r('GET', '/dashboard/rider', { requireAuth: true, requireRole: ['rider', 'platform_admin'] }, dashboard.GET_rider),
  r('GET', '/dashboard/contractor', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, dashboard.GET_contractor),
  r('GET', '/dashboard/corporate', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, dashboard.GET_corporate),
  r('GET', '/dashboard/admin', { requireAuth: true, requireRole: ['platform_admin'] }, dashboard.GET_admin),

  // ToS
  r('GET', '/tos/current', { exemptFromTosGate: true }, tos.GET_current),
  r('POST', '/tos/accept', { requireAuth: true, exemptFromTosGate: true }, tos.POST_accept),

  // Admin
  r('GET', '/admin/users', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_users),
  r('GET', '/admin/payments', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_payments),
  r('GET', '/admin/audit-logs', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_audit_logs),
  r('GET', '/admin/plans', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_plans),
  r('POST', '/admin/plans', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_plans),
  r('GET', '/admin/contractors', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_contractors),
  r('POST', '/admin/contractors/:id/verify', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_verify_contractor),
  r('GET', '/admin/shuttles', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_shuttles),
  r('POST', '/admin/shuttles', { requireAuth: true, requireRole: ['platform_admin', 'contractor'] }, admin.POST_shuttles),
  r('GET', '/admin/routes', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_routes),
  r('POST', '/admin/routes', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_routes),
  r('GET', '/admin/tickets', { requireAuth: true, requireRole: ['platform_admin'] }, admin.GET_tickets),
  r('POST', '/admin/tickets/:id/messages', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_ticket_message),
  r('POST', '/admin/audit/verify', { requireAuth: true, requireRole: ['platform_admin'] }, admin.POST_audit_verify),
  r('POST', '/admin/trips', { requireAuth: true, requireRole: ['platform_admin', 'contractor'] }, admin.POST_trips),

  // Contractor-scoped (the contractor themselves, not admin-gated)
  r('GET', '/contractor/shuttles', { requireAuth: true, requireRole: ['contractor'] }, admin.GET_my_shuttles),
  r('GET', '/contractor/trips', { requireAuth: true, requireRole: ['contractor'] }, admin.GET_my_trips),

  // Webhooks (no auth — but verified via provider signatures / cron secret)
  r('POST', '/webhooks/telebirr/notify', { exemptFromTosGate: true }, webhooks.POST_telebirr_notify),

  // Cron (secret-gated)
  r('POST', '/cron/run', { exemptFromTosGate: true }, cron.POST_run),

  // Corporate
  r('POST', '/corporate/onboard', { requireAuth: true }, corporate.POST_onboard),
  r('GET',  '/corporate', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.GET_current),
  r('GET',  '/corporate/invites', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.GET_invites),
  r('POST', '/corporate/invites', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.POST_invite),
  r('POST', '/corporate/signup', { requireAuth: true, requireRole: ['rider'] }, corporate.POST_signup),
  r('POST', '/corporate/validate-invite', { exemptFromTosGate: true }, corporate.POST_validate_invite),
  r('GET',  '/corporate/members', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.GET_members),
  r('POST', '/corporate/members/:id/approve', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.POST_approve),
  r('POST', '/corporate/members/:id/reject', { requireAuth: true, requireRole: ['corporate_admin', 'platform_admin'] }, corporate.POST_reject),

  // Contractor documents (multipart — raw handler)
  r('GET',  '/contractor/documents', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, documents.GET_documents),
  r('GET',  '/contractor/documents/:contractorId', { requireAuth: true, requireRole: ['platform_admin'] }, documents.GET_documents_for),
  r('POST', '/contractor/documents', { requireAuth: true, requireRole: ['contractor', 'platform_admin'] }, documents.handleDocumentUpload, true),

  // Files (download is raw so it can stream bytes; upload via contractor/documents)
  r('GET',  '/files/:id', { requireAuth: true }, files.handleFileDownload, true),
];
