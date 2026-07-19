# Addis Ride — Incident Response Runbook

## Severity Matrix (FIX COMPL-006)

| Severity | Definition | Acknowledge | Contain | Customer Comms | Post-mortem |
|----------|-----------|-------------|---------|-----------------|-------------|
| **SEV-1** | Total outage, confirmed data breach, or payment-system compromise | 15 min | 1 hour | 30 min (status page + SMS to affected users) | 5 business days |
| **SEV-2** | Partial outage, critical path degraded (e.g. checkout broken for some users), or suspected breach | 30 min | 4 hours | 2 hours (status page) | 5 business days |
| **SEV-3** | Non-critical degraded (e.g. notifications delayed, admin dashboard slow) | 2 hours | 1 business day | Next business day | 10 business days |
| **SEV-4** | Cosmetic / minor bug with no user impact | 1 business day | Best effort | None | Optional |

**Severity assignment:** The on-call engineer assigns the initial severity within 15 minutes of detection. Severity may be escalated (SEV-3 → SEV-2) or de-escalated (SEV-2 → SEV-3) as the incident progresses, with a note in the incident report explaining the change.

**Escalation path:**
- SEV-1: On-call engineer pages DPO + CTO + Legal within 15 min of acknowledgement.
- SEV-2: On-call engineer notifies DPO + CTO within 1 hour; Legal notified only if breach is confirmed.
- SEV-3/4: Handled by on-call engineer; DPO notified in daily standup.

## Breach notification (Proclamation 1321/2024)
1. **Detect** — Sentry alert, anomalous audit-log pattern, or manual report.
2. **Acknowledge** — On-call engineer acknowledges the alert within the severity SLA above and creates an incident report at `infra/incidents/{date}-{slug}.md`.
3. **Contain** — revoke affected sessions (bump `tokenVersion`), rotate leaked secrets, disable affected API keys. Target: within the "Contain" SLA for the assigned severity.
4. **Assess scope** — query `audit_logs` for the affected time window; identify entity types + user count touched.
5. **Notify** (within 72 hours of confirmed breach, per Proclamation 1321/2024 Art. 30):
   - The supervisory authority designated under Proclamation 1321/2024. **FIX COMPL-005:** The previous runbook named the Ethiopian Communications Authority (ECA), which regulates *telecommunications*, not data protection. The correct authority is the Data Protection Commission (or the supervisory authority designated by the Proclamation). Verify the current authority name and contact via the Ministry of Innovation and Technology (MInT) before any notification — the authority structure may still be in transition post-proclamation. Update this file with the verified contact.
   - Affected users via SMS + email (template in `infra/incidents/templates/breach-notice.md` and `infra/incidents/templates/user-notice.md`)
6. **Remediate** — patch root cause, add regression test, post-mortem within the SLA for the assigned severity.
7. **Document** — incident report stored in `infra/incidents/{date}-{slug}.md`, retained 7 years alongside audit logs.

## Escalation contacts
- DPO: configured via `DPO_EMAIL` env var (defaults to dpo@addisride.et)
- On-call engineer: PagerDuty rotation `addis-ride-oncall`
- CTO: cto@addisride.et
- Legal: legal@addisride.et
- Supervisory authority (data protection): verify via MInT — see COMPL-005 note above.

## Communication templates

### Status page updates (FIX COMPL-006)
- **SEV-1 initial (within 30 min):** "We are investigating a service disruption affecting [feature]. We will provide an update within 30 minutes."
- **SEV-1 resolution:** "The issue affecting [feature] has been resolved as of [time]. Root cause: [summary]. We will publish a post-mortem within 5 business days."
- **SEV-2 initial (within 2 hours):** "Some users may experience issues with [feature]. We are investigating and will update within 2 hours."

### Customer SMS (breach notification, within 72 hours of confirmation)
"Addis Ride security notice: We detected unauthorized access to your account information on [date]. Your password has been reset and all active sessions revoked. Please log in and review your account at https://addisride.et/account. Details: https://addisride.et/security-notice/{incident_id}"

### Social media (Twitter/X)
- SEV-1: Post within 30 min, update hourly, resolution post when resolved.
- SEV-2: Post within 2 hours, update every 4 hours.
- SEV-3/4: No social media post unless user-facing impact becomes visible.

## Retention
- Payment records: 7 years (PAYMENT_RETENTION_YEARS) — enforced by archive-old-records cron (OPS-010)
- Audit logs: 7 years (AUDIT_RETENTION_YEARS) — archived to S3 then deleted by archive-old-records cron
- Anonymization schedule: retention-cleanup cron runs daily, anonymizing users past 30-day grace period
- Session records: deleted on expiry by retention-cleanup
- OTP codes: deleted after 7 days
- Notifications: deleted 90 days after read
- Incident reports: retained 7 years
- Contractor documents: deleted (S3 + DB) after 7 years by archive-old-records cron

## DPA status
DPAs are required for all subprocessors before onboarding:
- [ ] Telebirr (payment processing)
- [ ] Africa's Talking (SMS delivery)
- [ ] Expo (push notifications)
- [ ] Sentry (error monitoring)
- [ ] Resend (email delivery)

Template: infra/compliance/dpa-template.md (updated with audit rights, sub-processor list, SCCs, and termination provisions — see COMPL-004)
