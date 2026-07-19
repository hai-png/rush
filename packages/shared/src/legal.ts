export const CURRENT_TOS_VERSION = 'v2_0' as const;

/**
 * Env-configurable DPO contact email. Falls back to a sensible default so
 * the privacy page always has something to render even when DPO_EMAIL is
 * not set. Reads process.env directly (not loadEnv()) because this module
 * is imported by the web app's privacy page which may render before the
 * API's loadEnv() has run — and the env schema's .default() handles the
 * missing-var case at API boot anyway.
 */
export function getDpoContact(): string {
  return process.env.DPO_EMAIL || 'dpo@addisride.et';
}

/**
 * Backward-compat constant. Some consumers (e.g. the web privacy page)
 * import DPO_CONTACT as a constant. Re-exporting it here computed from
 * getDpoContact() keeps those imports working while still respecting the
 * env var. Callers that need the live value should call getDpoContact()
 * directly.
 */
export const DPO_CONTACT = getDpoContact();

export const PAYMENT_RETENTION_YEARS = 7;
export const AUDIT_RETENTION_YEARS = 7;
export const ACCOUNT_DELETION_GRACE_DAYS = 30;
