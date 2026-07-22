import type { NextConfig } from "next";

// P1-48 / OPS-007: security headers. Previously next.config.ts had ZERO
// security headers configured — no CSP, no HSTS, no X-Frame-Options, no
// X-Content-Type-Options, no Referrer-Policy, no Permissions-Policy.
const securityHeaders = [
  // HSTS — force HTTPS for 2 years, include subdomains, allow preloading.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Prevent clickjacking.
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME-sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Control referrer leakage.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Lock down powerful APIs.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()" },
  // Content-Security-Policy — tight default. Allows inline styles (Tailwind
  // needs them) and img/data/blob sources, blocks everything else by default.
  // Note: 'unsafe-inline' for styles is required by Tailwind 4 + shadcn/ui;
  // for scripts we use 'self' only — no inline scripts.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // P2-39 / FE-030: enable React StrictMode to surface double-render bugs
  // and deprecated lifecycle methods in development.
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
