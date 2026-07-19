export const CURRENT_TOS_VERSION = 'v2_0' as const;
export function getDpoContact(): string {
  return process.env.DPO_EMAIL || 'dpo@addisride.et';
}
export const PAYMENT_RETENTION_YEARS = 7;
export const AUDIT_RETENTION_YEARS = 7;
export const ACCOUNT_DELETION_GRACE_DAYS = 30;
