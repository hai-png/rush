// Next.js 16 config (.mjs for ESM compatibility).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const tileServerHost = process.env.NEXT_PUBLIC_TILE_SERVER_URL
  ? (() => { try { return new URL(process.env.NEXT_PUBLIC_TILE_SERVER_URL).hostname; } catch { return ''; } })()
  : '';

const remotePatterns = [
  { protocol: 'https', hostname: '**.cartocdn.com' },
  { protocol: 'https', hostname: '**.mapbox.com' },
];
if (tileServerHost) remotePatterns.push({ protocol: 'https', hostname: tileServerHost });

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { remotePatterns },
  turbopack: {
    root: join(__dirname, '..', '..'),
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default config;
