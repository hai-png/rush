# Data Protection Impact Assessment (DPIA)
## Proclamation 1321/2024 Article 27 — Addis Ride

## 1. Processing Description
**System:** Addis Ride ride-hailing platform
**Data Controller:** Addis Ride Technology Solutions PLC
**DPO:** {{dpo_email}}

## 2. High-Risk Processing Activities

### 2.1 Contractor Document Uploads
- **Risk:** Uploaded license, insurance, and inspection documents contain PII (name, license number, photo)
- **Scale:** All 1,500+ contractors
- **Sensitivity:** High — documents are government-issued IDs
- **Mitigations:**
  - AES-256 encryption at rest (S3)
  - ClamAV malware scan on upload
  - Access limited to contractor + platform_admin
  - Presigned URLs with 15-minute TTL
  - Audit-logged access

### 2.2 GPS Location Tracking (Shuttle Positions)
- **Risk:** Real-time shuttle location + rider pickup/drop-off coordinates
- **Scale:** 50+ shuttles, 5,000+ riders/day
- **Sensitivity:** Medium-High
- **Mitigations:**
  - GPS data retained only for active trip duration
  - Positions expire after update interval
  - No historical tracking beyond 90 days
  - Rider locations not linked to persistent profiles in transit data

### 2.3 Payment Processing
- **Risk:** Financial transaction data, potential for fraud
- **Scale:** 10,000+ transactions/month
- **Sensitivity:** High
- **Mitigations:**
  - Amount verification on webhook settlement
  - CAS-based concurrent processing
  - Idempotency key enforcement
  - Refund amount accumulation (no overwrite)
  - 7-year retention for audit trail

### 2.4 Automated Decision-Making
- **Risk:** Subscription cancellation → automatic prorated refund
- **Scale:** All cancellations
- **Sensitivity:** Medium
- **Mitigations:**
  - Manual admin override available
  - Refund amount validated against payment
  - Full audit trail of all refunds

## 3. Necessity & Proportionality Assessment
| Processing | Necessary? | Proportional? | Less Intrusive Alternative Available? |
|-----------|-----------|--------------|--------------------------------------|
| Document uploads | Yes — regulatory requirement | Yes — only required docs | In-person verification (less practical) |
| GPS tracking | Yes — core service | Yes — trip only | Approximate zone tracking (reduced quality) |
| Payment data | Yes — financial transaction | Yes — minimal data set | Cash-only (operationally infeasible) |
| Automated refunds | Yes — legal requirement | Yes — prorated only | Manual refunds (time-prohibitive at scale) |

## 4. Risk Assessment

| Risk | Likelihood | Impact | Overall | Mitigations | Residual Risk |
|------|-----------|--------|---------|-------------|---------------|
| Unauthorized document access (IDOR) | Low | High | Medium | Presigned URLs, ownership check, audit log | Low |
| Payment fraud via webhook replay | Low | High | Medium | Idempotency key, amount verification, unique notify events | Low |
| Session hijacking | Low | High | Medium | 2FA for admins, tokenVersion invalidation, impersonation audit | Low |
| Data breach via S3 | Low | High | Medium | AES-256, presigned URLs, no public bucket | Low |
| Concurrent refund double-payout | Low | Medium | Low | SELECT FOR UPDATE SKIP LOCKED, CAS, accumulation | Low |

## 5. Approval
DPO review date: {{dpo_review_date}}
DPO signature: {{dpo_signature}}
Approved by: {{approver_name}}
Approval date: {{approval_date}}
