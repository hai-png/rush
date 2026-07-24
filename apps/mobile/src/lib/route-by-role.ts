// H-29 fix: shared role-based routing for the mobile app.
// Previously, index.tsx, auth/login.tsx, and auth/biometric-gate.tsx all
// hardcoded router.replace('/rider/dashboard') regardless of role. Contractors
// and corporate admins were bounced back to '/' because the rider dashboard
// rejects non-rider roles. This helper routes by role.

type UserRole = 'rider' | 'contractor' | 'corporate_admin' | 'platform_admin';

export function routeByRole(role: string | undefined): string {
  switch (role as UserRole) {
    case 'contractor':
      return '/contractor/dashboard';
    case 'corporate_admin':
    case 'platform_admin':
    case 'rider':
    default:
      return '/rider/dashboard';
  }
}
