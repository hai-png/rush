import type { MiddlewareHandler } from 'hono';
import { CURRENT_TOS_VERSION } from '@addis/shared';

// Endpoints that must remain accessible even when the user has a stale ToS
// version. The previous exempt list included /auth/ (the entire subtree) but
// NOT /account/* — which meant a user who disagreed with a ToS update was
// locked out of /account/delete (their GDPR erasure path). Conditioning
// erasure on accepting new terms is itself a legal violation.
//
// We also explicitly exempt the security-state routes under /auth/ so a
// ToS-locked user can still: change their password, manage 2FA, revoke other
// sessions, and log out. The previous blanket /auth/ exemption covered these
// implicitly, but /account/delete was missed entirely.
const EXEMPT = [
  /^\/api\/v1\/tos/,                          // accept/decline ToS itself
  /^\/api\/v1\/auth\/(login|token|logout|refresh|password|2fa|sessions|me)/,  // security-state routes
  /^\/api\/v1\/account\/delete/,              // GDPR erasure path — never condition on ToS
  /^\/api\/v1\/health/,
  /^\/api\/v1\/webhooks/,
  /^\/api\/v1\/cron/,
];

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
