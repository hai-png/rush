import { test, expect, beforeAll, describe } from 'bun:test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

let cookieHeader = '';
let csrfToken = '';

async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const headers = new Headers(opts.headers);
  if (!headers.has('content-type') && opts.body && !(opts.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  if (cookieHeader) headers.set('cookie', cookieHeader);
  if (opts.method && !['GET', 'HEAD', 'OPTIONS'].includes(opts.method)) {
    if (csrfToken) headers.set('x-csrf-token', csrfToken);
  }
  const res = await fetch(`${BASE}/api/v1${path}`, { ...opts, headers, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const csrfMatch = setCookie.match(/addis-csrf=([^;]+)/);
    if (csrfMatch) csrfToken = csrfMatch[1];
    const cookies = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ');
    cookieHeader = cookies;
  }
  const text = await res.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: res.status, body };
}

let riderPhone: string;
let riderSession: any;
let planId: string;
let paymentReference: string;
let subscriptionId: string;
let tripId: string;
let rideId: string;

describe('E2E: Auth + Catalog + Subscription + Booking', () => {
  beforeAll(async () => {
    await apiFetch('/plans');
    riderPhone = `+251911${Date.now().toString().slice(-6)}`;
  });

  test('GET /plans returns public catalog', async () => {
    const { status, body } = await apiFetch('/plans');
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    planId = body.data[0].id;
  });

  test('POST /auth/register creates a rider', async () => {
    const { status, body } = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'rider',
        phone: riderPhone,
        password: 'test-pass-1234',
        name: 'E2E Test Rider',
        homeArea: 'Bole',
        workArea: 'Piazza',
      }),
    });
    expect(status).toBe(201);
    expect(body.data).toBeDefined();
  });

  test('POST /auth/token logs in the rider', async () => {
    const { status, body } = await apiFetch('/auth/token', {
      method: 'POST',
      body: JSON.stringify({ phone: riderPhone, password: 'test-pass-1234' }),
    });
    expect([200, 409]).toContain(status);
    if (status === 200) {
      riderSession = body.data;
    }
  });

  test('POST /tos/accept accepts the ToS', async () => {
    const { status, body } = await apiFetch('/tos/accept', {
      method: 'POST',
      body: JSON.stringify({ version: '2026-01-01' }),
    });
    expect([200, 204]).toContain(status);
  });

  test('POST /subscriptions creates a subscription with Telebirr mock', async () => {
    const { status, body } = await apiFetch('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ planId, paymentMethod: 'telebirr' }),
    });
    expect(status).toBe(201);
    expect(body.data).toBeDefined();
    expect(body.data.checkout).toBeDefined();
    paymentReference = body.data.paymentReference;
    subscriptionId = body.data.subscriptionId ?? body.data.id;
  });

  test('POST /webhooks/telebirr/notify settles the payment (mock)', async () => {
    const { status, body } = await apiFetch('/webhooks/telebirr/notify', {
      method: 'POST',
      body: JSON.stringify({
        sign: 'mock-signature',
        merch_order_id: paymentReference,
        out_request_no: `test-${Date.now()}`,
        trade_status: 'Success',
        total_amount: '500.00',
        timestamp: Math.floor(Date.now() / 1000),
      }),
    });
    expect(status).toBe(200);
  });

  test('GET /subscriptions/:id shows active subscription', async () => {
    const { status, body } = await apiFetch(`/subscriptions/${subscriptionId}`);
    expect(status).toBe(200);
    expect(body.data.status).toBe('active');
  });

  test('GET /trips returns available trips', async () => {
    const { status, body } = await apiFetch('/trips');
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length > 0) {
      tripId = body.data[0].id;
    }
  });

  test('POST /rides books a ride on the subscription', async () => {
    if (!tripId) {
      console.warn('No trips available — skipping ride booking test');
      return;
    }
    const { status, body } = await apiFetch('/rides', {
      method: 'POST',
      body: JSON.stringify({ tripId, subscriptionId }),
    });
    expect([201, 409]).toContain(status);
    if (status === 201) {
      rideId = body.data.id;
    }
  });

  test('GET /rides lists the rider\'s rides', async () => {
    const { status, body } = await apiFetch('/rides');
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('E2E: Marketplace seat release + claim', () => {
  test('POST /marketplace/seat-releases creates a release', async () => {
    if (!rideId) {
      console.warn('No ride booked — skipping marketplace test');
      return;
    }
    const { status, body } = await apiFetch('/marketplace/seat-releases', {
      method: 'POST',
      body: JSON.stringify({ rideId, priceCents: null }),
    });
    expect([201, 400, 409]).toContain(status);
  });

  test('GET /marketplace/seat-releases lists open releases', async () => {
    const { status, body } = await apiFetch('/marketplace/seat-releases');
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('E2E: Health + config', () => {
  test('GET /health returns ok', async () => {
    const { status, body } = await apiFetch('/health');
    expect(status).toBe(200);
    expect(body.data.status).toBe('ok');
  });

  test('GET /healthz returns ok', async () => {
    const { status } = await apiFetch('/healthz');
    expect(status).toBe(200);
  });

  test('GET /ready returns ok', async () => {
    const { status, body } = await apiFetch('/ready');
    expect(status).toBe(200);
  });

  test('GET /config returns ToS version', async () => {
    const { status, body } = await apiFetch('/config');
    expect(status).toBe(200);
    expect(body.data.tosVersion).toBeDefined();
  });
});
