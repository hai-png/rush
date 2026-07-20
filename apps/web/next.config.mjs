// Next.js 16 config. Uses .mjs (ESM) form for widest tooling compatibility.
//
// INFRA-002: this file was previously missing. Defaults are unsafe (no
// image remotePatterns, no headers on static assets, no experimental flags).
//
// Turbopack.root: pins the workspace root so Turbopack doesn't get confused
// by stray package-lock.json files in parent directories (e.g. a
// /home/<user>/Downloads/package-lock.json would otherwise make Turbopack
// pick the wrong root and break the @/ alias).

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
  // Turbopack.root: point at the monorepo root (two levels up from apps/web)
  // so Turbopack can resolve `next` and workspace packages. Without this,
  // Turbopack infers the workspace root by walking up looking for
  // `next/package.json`, which breaks if there's a stray package-lock.json
  // in a parent directory (e.g. /home/<user>/Downloads/package-lock.json).
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
