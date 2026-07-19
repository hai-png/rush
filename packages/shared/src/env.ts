import { z } from 'zod';

const PLACEHOLDER_SECRETS = ['changeme', 'secret', 'password', ''];

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']),
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32).refine(s => !PLACEHOLDER_SECRETS.includes(s.toLowerCase())),
  NEXTAUTH_URL: z.string().url(),
  CRON_SECRET: z.string().min(32).refine(s => !PLACEHOLDER_SECRETS.includes(s.toLowerCase())),
  REDIS_URL: z.string().url().optional(),

  TELEBIRR_FABRIC_APP_ID: z.string().optional(),
  TELEBIRR_APP_SECRET: z.string().optional(),
  TELEBIRR_MERCHANT_APP_ID: z.string().optional(),
  TELEBIRR_MERCHANT_CODE: z.string().optional(),
  TELEBIRR_PRIVATE_KEY: z.string().optional(),
  TELEBIRR_PUBLIC_KEY: z.string().optional(),
  TELEBIRR_ENV: z.enum(['testbed', 'production']).default('production'),
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
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),

  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  NEXT_PUBLIC_TILE_SERVER_URL: z.string().url().optional(),
  NEXT_PUBLIC_CARTO_API_KEY: z.string().optional(),
  NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: z.string().optional(),
}).refine(d => {
  const t = [d.TELEBIRR_FABRIC_APP_ID, d.TELEBIRR_APP_SECRET, d.TELEBIRR_MERCHANT_APP_ID,
    d.TELEBIRR_MERCHANT_CODE, d.TELEBIRR_PRIVATE_KEY, d.TELEBIRR_PUBLIC_KEY];
  const set = t.filter(Boolean).length;
  return set === 0 || set === 6;
}, { message: 'Telebirr config must be all set or all unset' });

export type Env = z.infer<typeof envSchema>;
let cached: Env | null = null;
export function loadEnv(): Env {
  if (cached) return cached;
  cached = envSchema.parse(process.env);
  return cached;
}
