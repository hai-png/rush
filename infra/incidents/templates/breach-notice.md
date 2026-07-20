# Breach Notification — Proclamation 1321/2024

**Classification:** CONFIDENTIAL — DPO EYES ONLY

## Incident Summary
- **Date detected:** {{detected_at}}
- **Date range of breach:** {{breach_start}} – {{breach_end}}
- **Reported by:** {{reported_by}}
- **Incident ID:** INC-{{YYYYMMDD}}-{{sequential}}

## Affected Entities
| Entity Type | Count | PII Categories Exposed |
|------------|-------|----------------------|
| Users | {{user_count}} | {{user_pii_categories}} |
| Riders | {{rider_count}} | {{rider_pii_categories}} |
| Contractors | {{contractor_count}} | {{contractor_pii_categories}} |
| Payments | {{payment_count}} | {{payment_pii_categories}} |

## Notification to the Ethiopian Data Protection Authority
**FIX (INFRA-006):** The previous template named the "Ethiopian Communications
Authority" (ECA), which regulates *telecommunications* under the
Communications Service Proclamation — not data protection. The correct
supervisory authority for personal-data breaches is the **Ethiopian Data
Protection Authority** designated under Proclamation 1321/2024. Verify the
current authority name and contact via the Ministry of Innovation and
Technology (MInT) before any notification — the authority structure may
still be in transition post-proclamation. See
`infra/incident-response.md` for the canonical escalation contact.

**Authority:** Ethiopian Data Protection Authority (Proclamation 1321/2024, Art. 30)
**Contact:** {{dpa_authority_email}} (verify via MInT before notification)

Notification sent via: {{notification_method}}
Notification timestamp: {{notification_sent_at}}
Confirmation reference: {{confirmation_ref}}

## Notification to Affected Users
- **Method:** SMS via Africa's Talking + email via Resend
- **Template used:** infra/incidents/templates/user-notice.md
- **Sent at:** {{user_notification_sent_at}}
- **Delivery confirmation:** {{delivery_confirmation}}

## Remediation
| Action | Owner | Target Date | Status |
|-------|-------|------------|--------|
| Revoke affected sessions | {{ops_owner}} | {{target_date}} | {{status}} |
| Rotate leaked secrets | {{sec_owner}} | {{target_date}} | {{status}} |
| Patch root cause | {{eng_owner}} | {{target_date}} | {{status}} |
| Add regression test | {{qa_owner}} | {{target_date}} | {{status}} |

## Post-Mortem
- Date held: {{postmortem_date}}
- Root cause: {{root_cause}}
- Lessons learned: {{lessons}}
- Action items: {{action_items}}

## Retention
This incident report is retained for 7 years alongside audit logs per PAYMENT_RETENTION_YEARS policy.
