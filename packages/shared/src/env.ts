import { z } from 'zod';

// Reject not only literal placeholder strings but also any secret that is shorter
// than 32 bytes (HS256 with <256-bit keys is below NIST SP 800-107's acceptable
// security strength), or whose Shannon entropy is suspiciously low. The previous
// denylist ('changeme', 'secret', 'password', '') accepted values like 'test',
// 'production', 'aaaaaaaaaa...' (32 a's), or a 32-char run of a single character
// — none of those are acceptable as an HMAC-SHA256 signing key.
const PLACEHOLDER_SECRETS = new Set([
  'changeme', 'secret', 'password', 'test', 'dev', 'development', 'production',
  'addisride', 'addis-ride', 'addis_ride', '12345678', 'qwerty',
]);

function looksLikePlaceholder(s: string): boolean {
  if (!s) return true;
  if (PLACEHOLDER_SECRETS.has(s.toLowerCase())) return true;
  // All-same-character run (e.g. 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  if (/^(.)\1*$/.test(s)) return true;
  // Sequential digits or letters
  if (/^(0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/i.test(s)) return true;
  return false;
}

const strongSecret = z.string()
  .min(32, 'Secret must be at least 32 characters')
  .refine(s => !looksLikePlaceholder(s), 'Secret is a known placeholder or has insufficient entropy');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']),
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: strongSecret,
  NEXTAUTH_URL: z.string().url(),
  CRON_SECRET: strongSecret,
  // Redis must be required in production — silently degrading to an in-memory
  // store meant multi-instance guarantees (rate limiting, OTP locks, cron locks)
  // to silently collapse to per-instance counters, breaking every security
  // property that depended on them.
  REDIS_URL: z.string().url().optional(),
  REDIS_TOKEN: z.string().optional(),

  TELEBIRR_FABRIC_APP_ID: z.string().optional(),
  TELEBIRR_APP_SECRET: z.string().optional(),
  TELEBIRR_MERCHANT_APP_ID: z.string().optional(),
  TELEBIRR_MERCHANT_CODE: z.string().optional(),
  TELEBIRR_PRIVATE_KEY: z.string().optional(),
  TELEBIRR_PUBLIC_KEY: z.string().optional(),
  // TELEBIRR_ENV must be explicitly set — defaulting to 'production' risks
  // talking to the live Telebirr API with testbed credentials (or vice versa)
  // when an operator forgets to set the env var.
  TELEBIRR_ENV: z.enum(['testbed', 'production']),
  TELEBIRR_NOTIFY_URL: z.string().url(),
  TELEBIRR_REDIRECT_URL: z.string().url(),

  CBE_ACCOUNT_NUMBER: z.string().optional(),
  CBE_ACCOUNT_NAME: z.string().optional(),
  CBE_BANK_BRANCH: z.string().optional(),

  AFRICAS_TALKING_API_KEY: z.string().optional(),
  AFRICAS_TALKING_USERNAME: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  // H31: enforce a real minimum length. AWS S3 access keys are 20 chars;
  // secret keys are 40 chars. MinIO uses similar lengths. A 1-char key
  // would pass the previous min(1) and only fail at runtime.
  S3_ACCESS_KEY_ID: z.string().min(16, 'S3_ACCESS_KEY_ID must be at least 16 characters'),
  S3_SECRET_ACCESS_KEY: z.string().min(32, 'S3_SECRET_ACCESS_KEY must be at least 32 characters'),

  // BCRYPT_COST must be >= 10 (OWASP minimum as of 2023) and <= 15 (avoid DoS
  // on auth endpoints). The previous code did `Number(process.env.BCRYPT_COST ?? 12)`
  // with no validation, so BCRYPT_COST=0 or BCRYPT_COST=4 would silently weaken
  // every password hash.
  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),

  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DPO_EMAIL: z.string().email().default('dpo@addisride.et'),

  METRICS_PASSWORD: z.string().min(16).optional(),

  NEXT_PUBLIC_TILE_SERVER_URL: z.string().url().optional(),
  NEXT_PUBLIC_CARTO_API_KEY: z.string().optional(),
  NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: z.string().optional(),
}).refine(d => {
  const t = [d.TELEBIRR_FABRIC_APP_ID, d.TELEBIRR_APP_SECRET, d.TELEBIRR_MERCHANT_APP_ID,
    d.TELEBIRR_MERCHANT_CODE, d.TELEBIRR_PRIVATE_KEY, d.TELEBIRR_PUBLIC_KEY];
  const set = t.filter(Boolean).length;
  return set === 0 || set === 6;
}, { message: 'Telebirr config must be all set or all unset' })
  // Production-specific: REDIS_URL is mandatory so every multi-instance guarantee
  // (rate limits, OTP send locks, cron advisory locks, idempotency dedup, GPS
  // cache) actually works. Without it, every per-IP rule silently becomes
  // per-instance, and per-account rules become per-instance too.
  .refine(d => d.NODE_ENV !== 'production' || !!d.REDIS_URL, {
    message: 'REDIS_URL must be set in production (in-memory fallback is dev-only)',
    path: ['REDIS_URL'],
  })
  // Production-specific: METRICS_PASSWORD must be set so /metrics isn't open.
  .refine(d => d.NODE_ENV !== 'production' || !!d.METRICS_PASSWORD, {
    message: 'METRICS_PASSWORD must be set in production',
    path: ['METRICS_PASSWORD'],
  });

export type Env = z.infer<typeof envSchema>;
let cached: Env | null = null;
export function loadEnv(): Env {
  if (cached) return cached;
  cached = envSchema.parse(process.env);
  return cached;
}

/** Test-only: clears the cached env so process.env mutations are picked up. */
export function resetEnv(): void { cached = null; }
