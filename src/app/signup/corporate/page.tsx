// Redirect /signup/corporate to /corporate/signup (the new flow).
import { redirect } from 'next/navigation';

export default function CorporateSignupRedirect() {
  redirect('/corporate/signup');
}
