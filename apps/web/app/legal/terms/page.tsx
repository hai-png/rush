import { CURRENT_TOS_VERSION } from '@addis/shared';

const TOS_EFFECTIVE_DATE = '2025-01-15';

export default function TermsPage() {
  return (
    <article className="prose dark:prose-invert max-w-2xl mx-auto px-6 py-16">
      <h1>Terms of Service</h1>
      <p>Version {CURRENT_TOS_VERSION} — effective {TOS_EFFECTIVE_DATE}</p>

      <p>
        These Terms of Service ('Terms') govern your use of the Addis Ride subscription
        shuttle platform ('the Service'), operated by Addis Ride ('we', 'us', 'our').
        By creating an account or using the Service, you agree to these Terms.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old and legally capable of entering into a binding
        contract to use the Service. If you are registering as a contractor (driver), you
        must hold a valid Ethiopian driver's license appropriate for the vehicle class you
        will operate, and your vehicle must be registered, insured, and pass inspection
        per Ethiopian transportation regulations.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You must provide accurate and complete information at registration and keep it
        current. You are responsible for safeguarding your password and for any activity
        conducted under your account. Notify us immediately of any unauthorized use. We
        may suspend or terminate accounts that violate these Terms or that we reasonably
        suspect are engaged in fraudulent or abusive activity.
      </p>

      <h2>3. Subscriptions & Payments</h2>
      <p>
        Subscription plans and pricing are displayed at checkout. Payment is due in advance
        via Telebirr or CBE Birr. Subscription fees are non-refundable except as required
        by law or as expressly stated in these Terms. You may cancel your subscription at
        any time; cancellation takes effect at the end of the current billing period and
        does not entitle you to a prorated refund unless required by law.
      </p>

      <h2>4. Seat Release Marketplace</h2>
      <p>
        If you cannot use a booked ride, you may release the seat to other subscribers via
        the marketplace. When another subscriber claims your released seat, you receive a
        prorated refund of the per-ride value of your subscription. The claimer pays the
        same prorated amount. Releases are non-revocable once claimed.
      </p>

      <h2>5. Contractor Obligations</h2>
      <p>
        Contractors must: (a) maintain valid licensing, insurance, and inspection
        documents; (b) operate vehicles safely and in compliance with all applicable laws;
        (c) adhere to assigned routes and schedules; (d) treat riders with respect and
        professionalism. We may suspend or terminate contractors who violate these
        obligations.
      </p>

      <h2>6. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose;</li>
        <li>Attempt to gain unauthorized access to any part of the Service;</li>
        <li>Reverse-engineer, decompile, or disassemble the Service;</li>
        <li>Spam, harass, or impersonate other users;</li>
        <li>Use bots or automated systems to book seats faster than humanly possible;</li>
        <li>Resell or commercialize your subscription without our written consent.</li>
      </ul>

      <h2>7. Liability</h2>
      <p>
        The Service is provided 'as is' and 'as available'. To the maximum extent
        permitted by law, we disclaim all warranties, express or implied, including
        merchantability and fitness for a particular purpose. We are not liable for
        indirect, incidental, special, or consequential damages. Our aggregate liability
        for any claim arising out of these Terms is limited to the amount you paid us in
        the 12 months preceding the claim.
      </p>

      <h2>8. Indemnification</h2>
      <p>
        You agree to indemnify and hold us harmless from any claims, damages, or expenses
        arising from your misuse of the Service or your violation of these Terms.
      </p>

      <h2>9. Termination</h2>
      <p>
        You may terminate your account at any time via Account → Delete. We may terminate
        or suspend your account for violation of these Terms. On termination, your right
        to use the Service ceases immediately. Provisions that by their nature should
        survive termination (including payment obligations, liability, and indemnification)
        will remain in effect.
      </p>

      <h2>10. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the Federal Democratic Republic of
        Ethiopia. Any dispute arising out of these Terms will be resolved in the courts
        of Addis Ababa.
      </p>

      <h2>11. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be notified to
        you via in-app notification and require your acceptance before taking effect. Your
        continued use of the Service after the effective date constitutes acceptance of
        the updated Terms.
      </p>

      <h2>12. Contact</h2>
      <p>
        For questions about these Terms, contact our Data Protection Officer at the
        address listed in our Privacy Policy.
      </p>
    </article>
  );
}
