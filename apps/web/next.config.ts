// INFRA-002: Next.js config was entirely missing. Defaults are unsafe (no
// image remotePatterns, no headers on static assets, no experimental flags).
// This config:
//   * Allows next/image to load from the configured tile server and
//     CARTO/Mapbox CDNs (used by the MapView component).
//   * Sets security headers on ALL responses including static assets (the
//     middleware only runs on dynamic routes, so /_next/static/* was
//     previously unguarded).
//   * Enables React strict mode for catch subtle bugs in dev.
//   * Disables x-powered-by header (fingerprinting).

const tileServerHost = process.env.NEXT_PUBLIC_TILE_SERVER_URL
  ? (() => { try { return new URL(process.env.NEXT_PUBLIC_TILE_SERVER_URL).hostname; } catch { return ''; } })()
  : '';

const remotePatterns = [
  { protocol: 'https' as const, hostname: '**.cartocdn.com' },
  { protocol: 'https' as const, hostname: '**.mapbox.com' },
];
if (tileServerHost) remotePatterns.push({ protocol: 'https' as const, hostname: tileServerHost });

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { remotePatterns },
  async headers() {
    return [
      {
        // Apply security headers to all routes including static assets.
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default config;
