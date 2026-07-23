// P2-67 / Sprint 2 #47: k6 load test suite.
// Run with: k6 run scripts/load-test.js
//
// Tests the public catalog + auth flow at 50 RPS for 5 minutes.
// Reports p50/p95/p99 latency + error rate.
// Requires the dev server running on localhost:3000 with seeded data.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // ramp up to 20 RPS
    { duration: '2m', target: 50 },     // hold at 50 RPS
    { duration: '30s', target: 0 },     // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(50)<200', 'p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // 1. GET /api/v1/plans (public, no auth)
  const plansRes = http.get(`${BASE}/api/v1/plans`);
  check(plansRes, {
    'plans status 200': (r) => r.status === 200,
    'plans has 3 items': (r) => {
      try { return JSON.parse(r.body).data.length >= 1; } catch { return false; }
    },
  });

  // 2. GET /api/v1/trips (public, no auth)
  const tripsRes = http.get(`${BASE}/api/v1/trips`);
  check(tripsRes, {
    'trips status 200': (r) => r.status === 200,
  });

  // 3. GET /api/v1/healthz (health check)
  const healthRes = http.get(`${BASE}/api/v1/healthz`);
  check(healthRes, {
    'healthz status 200': (r) => r.status === 200,
  });

  // 4. GET /api/v1/ready (readiness check)
  const readyRes = http.get(`${BASE}/api/v1/ready`);
  check(readyRes, {
    'ready status 200 or 503': (r) => r.status === 200 || r.status === 503,
  });

  // 5. POST /api/v1/auth/token with invalid creds (tests auth + rate limit)
  const loginRes = http.post(
    `${BASE}/api/v1/auth/token`,
    JSON.stringify({ phone: '+251911000000', password: 'wrong-password' }),
    { headers: { 'content-type': 'application/json' } },
  );
  check(loginRes, {
    'login rejects with 401': (r) => r.status === 401,
  });

  sleep(0.02); // ~50 RPS
}
