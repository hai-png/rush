# Record of Processing Activities (ROPA)
## Proclamation 1321/2024 Article 21 — Addis Ride

| # | Processing Activity | Purpose | Legal Basis | Data Categories | Data Subjects | Retention | Recipients | Third Country Transfers | Safeguards |
|---|-------------------|---------|------------|----------------|--------------|-----------|------------|------------------------|------------|
| 1 | Account registration | Provide ride-hailing service | Contract (Art. 12) | Name, phone, password hash, role | Riders, Contractors, Corporate admins | Until account deletion + 30 day grace | N/A | N/A | Encrypted at rest, TLS in transit |
| 2 | Rider profile management | Match riders to routes | Contract (Art. 12) | Home/work area, ride history | Riders | 30 days after account deletion | N/A | N/A | Pseudonymized in analytics |
| 3 | Contractor verification | License/insurance verification | Legal obligation (Art. 13) | License number, experience, documents (PDF/JPEG/PNG) | Contractors | 7 years (statute of limitations) | N/A | N/A | AES-256 S3 encryption, magic-byte MIME sniff (INFRA-010) |
| 4 | Payment processing | Subscription and one-off ride payments | Contract (Art. 12) | Payment reference, amount, method (Telebirr/CBE) | Riders, Corporate members | 7 years (financial record-keeping) | Telebirr, CBE (subprocessors) | N/A | DPA to be signed before subprocessor goes live (INFRA-005), encrypted channels |
| 5 | Subscription management | Track active subscriptions and ride usage | Contract (Art. 12) | Plan, status, dates, rides used | Riders | 7 years | N/A | N/A | Audit-logged |
| 6 | Seat release & claiming | Marketplace for released seats | Contract (Art. 12) | Release dates, refund amounts, claim status | Riders | 7 years | N/A | N/A | CAS-based concurrency |
| 7 | Trip tracking | Operational ride management | Contract (Art. 12) | Shuttle assignment, GPS position, booking status | Riders, Contractors | 90 days | N/A | N/A | GPS data not stored long-term |
| 8 | Support tickets | Customer support | Contract (Art. 12) | Message body, subject, category | Users | 3 years after resolution | N/A | N/A | Staff-only access |
| 9 | Notifications | Operational and marketing communication | Consent (Art. 15) | Push tokens, preferences, read status | Users | 90 days after read | Expo Push (subprocessor) | N/A | Consent recorded in notification_preferences |
| 10 | SMS messages | OTP verification, alerts | Contract (Art. 12), Consent | Phone number, OTP hash | Users | 7 days | Africa's Talking (subprocessor) | N/A | OTP hash stored, raw code not persisted |
| 11 | Audit logging | Security monitoring, compliance | Legal obligation (Art. 13) | Actor ID, action, entity, IP, user agent | Users | 7 years | N/A | N/A | SHA-256 hash chain, tamper-evident |
| 12 | Session management | Authenticate user requests | Contract (Art. 12) | JTI, user agent, IP, expiry | Users | Until session expiry | N/A | N/A | JWT with 30m access + 30d session |
| 13 | Password management | Account security | Contract (Art. 12) | Password hash, reset tokens | Users | 7 days for reset tokens | N/A | N/A | Bcrypt, HIBP breach check, zxcvbn scoring |
| 14 | Corporate management | Corporate subsidy programs | Contract (Art. 12) | Employee ID, approval status, ride usage | Corporate members | 7 years | N/A | N/A | Role-based access control |
| 15 | Analytics & monitoring | Platform improvement, error detection | Legitimate interest (Art. 14) | Usage patterns, error events | Users | 90 days | Sentry (subprocessor) | US (Sentry US region) | DPA to be signed before subprocessor goes live (INFRA-005), data minimization |

## DPO Contact
Data Protection Officer: {{dpo_email}}
Appointed: {{dpo_appointment_date}}

## Subprocessors
| Subprocessor | Service | Data Accessed | Safeguards |
|-------------|---------|--------------|------------|
| Telebirr | Payment processing | Payment amount, reference, phone | DPA to be signed before go-live (INFRA-005), encrypted channel |
| Africa's Talking | SMS delivery | Phone number | DPA to be signed before go-live (INFRA-005), limited retention |
| Expo | Push notifications | Push token | DPA to be signed before go-live (INFRA-005), data minimization |
| Sentry | Error monitoring | Error context, IP address | DPA to be signed before go-live (INFRA-005), US SCCs |
| Resend | Email delivery | Email address | DPA to be signed before go-live (INFRA-005) |

## Review
Last reviewed: {{review_date}}
Next review due: {{next_review_date}}
Reviewed by: {{reviewer_name}}
