import { test, expect } from '@playwright/test';

test.describe('Rider critical path', () => {
  test('login → subscribe → release seat → claim from second account → ticket', async ({ page, browser }) => {
    // FIX (TEST-003/004): read seeded credentials from process.env (populated
    // by e2e/global-setup.ts) instead of hardcoding the legacy demo users.
    const riderPhone = process.env.E2E_RIDER_PHONE!;
    const rider2Phone = process.env.E2E_RIDER2_PHONE!;
    const password = process.env.E2E_PASSWORD!;

    await page.goto('/login');
    await page.getByLabel(/phone number/i).fill(riderPhone);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page).toHaveURL(/dashboard\/rider/);

    // The dashboard should already show the active subscription that
    // global-setup inserted directly into the DB (no real webhook settlement
    // is needed — TELEBIRR_ENV=testbed short-circuits checkout to the
    // /telebirr-stub page, and the spec no longer needs to hit a test-only
    // webhook endpoint to flip the subscription to "active").
    await page.goto('/dashboard/rider');
    await expect(page.getByText(/active/i)).toBeVisible();

    // Walk through the plan-picker → checkout → telebirr-stub flow. The rider
    // already has an active subscription; this exercises the UI flow without
    // relying on the subscription actually being created at the end (the
    // testbed stub short-circuits the payment provider).
    await page.goto('/plans');
    await page.getByText('Monthly Unlimited').click();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page).toHaveURL(/checkout/);
    await page.getByText('telebirr').click();
    await page.getByRole('button', { name: /continue/i }).click();
    // telebirr redirect is mocked in test env via TELEBIRR_ENV=testbed + stub checkout page
    await expect(page).toHaveURL(/telebirr-stub/);

    // Release a seat
    await page.goto('/dashboard/rider');
    await page.getByRole('button', { name: /release a seat/i }).click();
    await page.getByLabel(/release date/i).fill(futureDateISO());
    await page.getByRole('button', { name: /confirm release/i }).click();
    await expect(page.getByText(/seat released/i)).toBeVisible();

    // Second rider claims it
    const second = await browser.newContext();
    const secondPage = await second.newPage();
    await secondPage.goto('/login');
    await secondPage.getByLabel(/phone number/i).fill(rider2Phone);
    await secondPage.getByLabel('Password').fill(password);
    await secondPage.getByRole('button', { name: /log in/i }).click();
    await secondPage.goto('/open-seats');
    await secondPage.getByRole('button', { name: /claim/i }).first().click();
    await expect(secondPage).toHaveURL(/telebirr-stub/);

    // Create a support ticket
    await page.goto('/tickets/new');
    await page.getByLabel(/subject/i).fill('Question about my subscription');
    await page.getByLabel(/message/i).fill('Does my plan roll over unused rides?');
    await page.getByRole('button', { name: /submit/i }).click();
    await expect(page).toHaveURL(/tickets\/[a-z0-9]+/);
  });
});

function futureDateISO() {
  const d = new Date(); d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
}
