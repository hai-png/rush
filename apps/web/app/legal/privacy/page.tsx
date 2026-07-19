import { DPO_CONTACT } from '@addis/shared';

/**
 * Privacy Policy — substantively compliant with Ethiopia's Data Protection
 * Proclamation 1321/2024 (and aligned with GDPR principles for any users
 * in the EU/EEA). The previous version was 2 sentences and explicitly
 * claimed compliance with no substantive policy — worse than not claiming
 * it. This page now enumerates: data categories, purposes, legal bases,
 * retention, third-party recipients, cross-border transfers, user rights,
 * and complaint mechanisms.
 */
export default function PrivacyPage() {
  return (
    <article className="prose dark:prose-invert max-w-2xl mx-auto px-6 py-16">
      <h1>Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: 2025-01-15 · Version 1.0</p>

      <p>
        Addis Ride ('we', 'us', 'our') operates a subscription shuttle platform serving the
        Addis Ababa metropolitan area. This Privacy Policy describes how we collect, use,
        disclose, and safeguard your personal data in compliance with Ethiopia's Data
        Protection Proclamation No. 1321/2024 and international best practices.
      </p>

      <h2>1. Data We Collect</h2>
      <ul>
        <li><strong>Account data:</strong> full name, phone number (used as primary identifier), hashed password, role (rider / contractor / corporate_admin / platform_admin), preferred language, and home/work areas.</li>
        <li><strong>Identity verification data (contractors only):</strong> driver's license number, vehicle registration, insurance certificate, and inspection certificate — stored as encrypted files in object storage and accessible only to the verifying platform_admin.</li>
        <li><strong>Subscription & payment data:</strong> subscription plan, route assignment, payment method (Telebirr or CBE Birr), payment references, transaction amounts, and refund history. We do NOT store full payment card numbers — payment authorization happens at the provider's checkout and we receive only a prepayId / order reference.</li>
        <li><strong>Trip & ride data:</strong> booked trips, boarding status, GPS positions of shuttles (real-time, not retained beyond 24 hours), ride completion status, and seat-claim / seat-release history.</li>
        <li><strong>Support data:</strong> support ticket subjects, message bodies, and any documents you attach.</li>
        <li><strong>Device & usage data:</strong> push notification tokens, device platform (iOS/Android/web), approximate IP address (for security and abuse prevention), and aggregate usage metrics.</li>
        <li><strong>Audit data:</strong> actions you take (login, password change, subscription purchase, etc.) are recorded in a tamper-evident hash-chained audit log for security and compliance purposes.</li>
      </ul>

      <h2>2. Purposes & Legal Bases</h2>
      <ul>
        <li><strong>Service provision (contractual necessity):</strong> account data, subscription data, and trip data are processed to operate the shuttle service you subscribed to.</li>
        <li><strong>Legal compliance:</strong> contractor verification data is processed to comply with transportation and insurance regulations; payment data is retained for 7 years per financial record-keeping requirements.</li>
        <li><strong>Security & fraud prevention (legitimate interest):</strong> IP addresses, device tokens, and audit logs are processed to detect and prevent credential stuffing, payment fraud, and abuse. Rate-limit counters are keyed per-IP and per-account.</li>
        <li><strong>Communication (consent):</strong> push, SMS, and email notifications are sent based on your preferences (configurable in Account → Notifications). Critical security notifications (e.g. payment failure) may be sent regardless of preference.</li>
        <li><strong>Corporate subsidy administration (contractual necessity):</strong> if your employer participates in our corporate program, your corporate membership and ride usage are shared with your employer's designated corporate_admin solely for subsidy accounting.</li>
      </ul>

      <h2>3. Retention</h2>
      <ul>
        <li><strong>Account data:</strong> retained while your account is active. On deletion request, soft-deleted for 30 days (reversible), then anonymized.</li>
        <li><strong>Payment data:</strong> 7 years from transaction date (financial record-keeping requirement).</li>
        <li><strong>Audit logs:</strong> 7 years.</li>
        <li><strong>OTP & password reset tokens:</strong> deleted after 7 days.</li>
        <li><strong>Read notifications:</strong> deleted after 90 days.</li>
        <li><strong>GPS positions:</strong> overwritten on each update; no historical GPS trail is retained beyond 24 hours.</li>
      </ul>

      <h2>3. Third-Party Recipients</h2>
      <ul>
        <li><strong>Telebirr (Ethio Telecom):</strong> payment processing — receives order amount, merchant reference, and notification URL.</li>
        <li><strong>CBE Birr:</strong> manual bank-transfer reconciliation — receives only the payment reference.</li>
        <li><strong>Africa's Talking:</strong> SMS delivery — receives the destination phone number and message body.</li>
        <li><strong>Expo Push Notifications:</strong> push token and notification payload for iOS/Android devices.</li>
        <li><strong>Object storage (S3-compatible):</strong> contractor documents, stored with server-side encryption.</li>
        <li><strong>Sentry:</strong> error monitoring — receives stack traces, request metadata (PII redacted via redact paths in our logger configuration).</li>
      </ul>
      <p>We do NOT sell your personal data. We do NOT share your data with advertisers.</p>

      <h2>4. Cross-Border Transfers</h2>
      <p>
        Your data is stored and processed primarily in Ethiopia. Some subprocessors (Expo,
        Sentry) may transfer data outside Ethiopia. We rely on their documented data
        protection practices and only engage subprocessors whose agreements include
        confidentiality and security obligations consistent with Proclamation 1321/2024.
      </p>

      <h2>5. Your Rights</h2>
      <ul>
        <li><strong>Access:</strong> request a copy of your personal data via Account → Export.</li>
        <li><strong>Rectification:</strong> correct inaccurate data via Account → Profile.</li>
        <li><strong>Erasure:</strong> request deletion via Account → Delete. The 30-day grace period allows recovery from accidental deletion; after that, your data is anonymized.</li>
        <li><strong>Portability:</strong> download your data in machine-readable JSON / CSV format.</li>
        <li><strong>Objection:</strong> disable specific notification channels (push / SMS / email) in Notification Preferences.</li>
        <li><strong>Withdrawal of consent:</strong> consent-based processing (e.g. marketing notifications) can be withdrawn at any time without affecting the lawfulness of processing before withdrawal.</li>
        <li><strong>Complaint:</strong> you have the right to lodge a complaint with the Ethiopian Data Protection Authority.</li>
      </ul>

      <h2>6. Security</h2>
      <p>
        We implement industry-standard security measures: passwords are bcrypt-hashed (cost ≥ 12),
        all API traffic is HTTPS, contractor documents are server-side encrypted, audit logs are
        tamper-evident (hash-chained), and access to admin functions requires two-factor
        authentication. Despite these measures, no system is 100% secure — we will notify
        affected users within 72 hours of confirming a data breach, per Proclamation 1321/2024.
      </p>

      <h2>7. Data Protection Officer</h2>
      <p>
        For any privacy-related questions, requests, or complaints, contact our Data Protection
        Officer: <a href={`mailto:${DPO_CONTACT}`}>{DPO_CONTACT}</a>
      </p>

      <h2>8. Changes to this Policy</h2>
      <p>
        Material changes to this policy will be notified to you via in-app notification and
        require your acceptance before taking effect. The version date at the top of this page
        indicates when the policy was last updated.
      </p>
    </article>
  );
}
