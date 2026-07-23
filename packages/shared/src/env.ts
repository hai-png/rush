import { z } from 'zod';

const PLACEHOLDER_SECRETS = new Set([
  'changeme', 'secret', 'password', 'test', 'dev', 'development', 'production',
  'addisride', 'addis-ride', 'addis_ride', '12345678', 'qwerty',
]);

function looksLikePlaceholder(s: string): boolean {
  if (!s) return true;
  if (PLACEHOLDER_SECRETS.has(s.toLowerCase())) return true;

  if (/^(.)\1*$/.test(s)) return true;

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

  REDIS_URL: z.string().url().optional(),
  REDIS_TOKEN: z.string().optional(),

  TELEBIRR_FABRIC_APP_ID: z.string().optional(),
  TELEBIRR_APP_SECRET: z.string().optional(),
  TELEBIRR_MERCHANT_APP_ID: z.string().optional(),
  TELEBIRR_MERCHANT_CODE: z.string().optional(),
  TELEBIRR_PRIVATE_KEY: z.string().optional(),
  TELEBIRR_PUBLIC_KEY: z.string().optional(),

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

  S3_REGION: z.string().min(1).default('us-east-1'),

  CURSOR_SECRET: z.string().min(32).optional(),

  S3_ACCESS_KEY_ID: z.string().min(16, 'S3_ACCESS_KEY_ID must be at least 16 characters'),
  S3_SECRET_ACCESS_KEY: z.string().min(32, 'S3_SECRET_ACCESS_KEY must be at least 32 characters'),

  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),

  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DPO_EMAIL: z.string().email().default('dpo@addisride.et'),

  METRICS_PASSWORD: z.string().min(16).optional(),

  HIBP_FAIL_OPEN: z.coerce.boolean().default(false),

  NEXT_PUBLIC_TILE_SERVER_URL: z.string().url().optional(),
  NEXT_PUBLIC_CARTO_API_KEY: z.string().optional(),
  NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: z.string().optional(),
}).refine(d => {
  const t = [d.TELEBIRR_FABRIC_APP_ID, d.TELEBIRR_APP_SECRET, d.TELEBIRR_MERCHANT_APP_ID,
    d.TELEBIRR_MERCHANT_CODE, d.TELEBIRR_PRIVATE_KEY, d.TELEBIRR_PUBLIC_KEY];
  const set = t.filter(Boolean).length;
  return set === 0 || set === 6;
}, { message: 'Telebirr config must be all set or all unset' })

  .refine(d => d.NODE_ENV !== 'production' || !!d.REDIS_URL, {
    message: 'REDIS_URL must be set in production (in-memory fallback is dev-only)',
    path: ['REDIS_URL'],
  })

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

export function resetEnv(): void { cached = null; }
