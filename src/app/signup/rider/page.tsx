import type { Metadata } from 'next';
import { RiderSignupForm } from './rider-signup-form';

export const metadata: Metadata = { title: 'Sign Up · Addis Ride' };

export default function RiderSignupPage() {
  return <RiderSignupForm />;
}
