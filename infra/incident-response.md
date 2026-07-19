# Addis Ride — Incident Response Runbook

## Breach notification (Proclamation 1321/2024)
1. **Detect** — Sentry alert, anomalous audit-log pattern, or manual report.
2. **Contain** — revoke affected sessions (bump `tokenVersion`), rotate leaked secrets, disable affected API keys.
3. **Assess scope** — query `audit_logs` for the affected time window; identify entity types + user count touched.
4. **Notify** (within 72 hours of confirmed breach):
   - Ethiopian Communications Authority (per Proclamation 1321/2024, contact: communications@eca.et)
   - Affected users via SMS + email (template in `infra/incidents/templates/breach-notice.md` and `infra/incidents/templates/user-notice.md`)
5. **Remediate** — patch root cause, add regression test, post-mortem within 5 business days.
6. **Document** — incident report stored in `infra/incidents/{date}-{slug}.md`, retained 7 years alongside audit logs.

## Escalation contacts
- DPO: configured via `DPO_EMAIL` env var (defaults to dpo@addisride.et)
- On-call engineer: PagerDuty rotation `addis-ride-oncall`
- Legal: legal@addisride.et

## Retention
- Payment records: 7 years (PAYMENT_RETENTION_YEARS)
- Audit logs: 7 years (AUDIT_RETENTION_YEARS)
- Anonymization schedule: retention-cleanup cron runs daily, anonymizing users past 30-day grace period
- Session records: deleted on expiry by retention-cleanup
- OTP codes: deleted after 7 days
- Notifications: deleted 90 days after read
- Incident reports: retained 7 years

## DPA status
DPAs are required for all subprocessors before onboarding:
- [ ] Telebirr (payment processing)
- [ ] Africa's Talking (SMS delivery)
- [ ] Expo (push notifications)
- [ ] Sentry (error monitoring)
- [ ] Resend (email delivery)

Template: infra/compliance/dpa-template.md
