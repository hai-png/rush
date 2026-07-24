import { redirect } from 'next/navigation';
import TelebirrStubClient from './telebirr-stub-client';

export default function TelebirrStubPage() {
  if (process.env.NODE_ENV === 'production') {
    redirect('/');
  }
  return <TelebirrStubClient />;
}
