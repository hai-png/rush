import { redirect } from 'next/navigation';
import TelebirrStubClient from './telebirr-stub-client';

// Gate the telebirr-stub page at build time. The mock checkout page exists
// only for local development and the `mock` Telebirr provider — in a
// production build the route immediately redirects to / so the source code
// is never rendered (and never shipped to a real user's browser bundle,
// since this server component short-circuits before the client component
// is loaded).
export default function TelebirrStubPage() {
  if (process.env.NODE_ENV === 'production') {
    redirect('/');
  }
  return <TelebirrStubClient />;
}
