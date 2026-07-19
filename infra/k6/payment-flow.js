import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    subscribe_flow: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [{ duration: '2m', target: 200 }, { duration: '5m', target: 1000 }, { duration: '2m', target: 0 }],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.K6_TARGET_URL ?? 'http://localhost:3000';

export default function () {
  const loginRes = http.post(`${BASE}/api/v1/auth/token`, JSON.stringify({
    phone: `+2519${String(10000000 + Math.floor(Math.random() * 89999999))}`, password: 'demo123456',
  }), { headers: { 'Content-Type': 'application/json' } });

  check(loginRes, { 'login reachable': (r) => r.status === 200 || r.status === 401 });
  if (loginRes.status !== 200) { sleep(1); return; }

  const token = JSON.parse(loginRes.body).accessToken;
  const subRes = http.post(`${BASE}/api/v1/subscriptions`, JSON.stringify({
    planId: 'seed-plan-monthly', routeId: 'seed-route-bole', paymentMethod: 'telebirr',
  }), { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() } });

  check(subRes, { 'subscription created or conflict (expected)': (r) => [201, 409].includes(r.status) });
  sleep(1);
}
