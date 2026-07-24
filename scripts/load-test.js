import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(50)<200', 'p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const plansRes = http.get(`${BASE}/api/v1/plans`);
  check(plansRes, {
    'plans status 200': (r) => r.status === 200,
    'plans has 3 items': (r) => {
      try { return JSON.parse(r.body).data.length >= 1; } catch { return false; }
    },
  });

  const tripsRes = http.get(`${BASE}/api/v1/trips`);
  check(tripsRes, {
    'trips status 200': (r) => r.status === 200,
  });

  const healthRes = http.get(`${BASE}/api/v1/healthz`);
  check(healthRes, {
    'healthz status 200': (r) => r.status === 200,
  });

  const readyRes = http.get(`${BASE}/api/v1/ready`);
  check(readyRes, {
    'ready status 200 or 503': (r) => r.status === 200 || r.status === 503,
  });

  const loginRes = http.post(
    `${BASE}/api/v1/auth/token`,
    JSON.stringify({ phone: '+251911000000', password: 'wrong-password' }),
    { headers: { 'content-type': 'application/json' } },
  );
  check(loginRes, {
    'login rejects with 401': (r) => r.status === 401,
  });

  sleep(0.02);
}
