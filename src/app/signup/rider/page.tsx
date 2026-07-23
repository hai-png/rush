import type { Metadata } from 'next';
import { RiderSignupForm } from './rider-signup-form';

export const metadata: Metadata = { title: 'Sign Up · Addis Ride' };

// FE-033: page-level metadata. The form is a client component because it
// uses useState — metadata can only be exported from a server component,
// so this thin wrapper renders the form.
export default function RiderSignupPage() {
  return <RiderSignupForm />;
}
