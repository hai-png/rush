import 'server-only';
import { createAddisRideClient } from '@addis/sdk';
import { auth } from '../auth';

// Server-only SDK helper. The `import 'server-only'` marker makes Next.js
// throw a build-time error if this module is ever imported from a client
// component — preventing the postgres dependency (via auth ->
// identityService -> @addis/db) from being pulled into the client bundle.
//
// Server components and route handlers should import from here:
//   import { getServerApiClient } from '@/lib/server-api';

export async function getServerApiClient() {
  const session = await auth();
  if (!session) {
    throw new Error('Not authenticated — server component called getServerApiClient without a session');
  }
  const baseUrl = process.env.NEXTAUTH_URL;
  if (!baseUrl) throw new Error('NEXTAUTH_URL is not set');
  return createAddisRideClient({ baseUrl, getToken: () => (session as any).accessToken });
}
