# Addis Ride — Incident Response Runbook

## Breach notification (Proclamation 1321/2024)
1. **Detect** — Sentry alert, anomalous audit-log pattern, or manual report.
2. **Contain** — revoke affected sessions (bump `tokenVersion`), rotate leaked secrets, disable affected API keys.
3. **Assess scope** — query `audit_logs` for the affected time window; identify entity types + user count touched.
4. **Notify** (within 72 hours of confirmed breach):
   - Ethiopian Communications Authority (per Proclamation 1321/2024)
   - Affected users via SMS + email (template in `templates/breach-notice.md`)
5. **Remediate** — patch root cause, add regression test, post-mortem within 5 business days.
6. **Document** — incident report stored in `infra/incidents/{date}-{slug}.md`, retained 7 years alongside audit logs.

## Escalation contacts
- DPO: dpo@addisride.et
- On-call engineer: PagerDuty rotation `addis-ride-oncall`
- Legal: legal@addisride.et
