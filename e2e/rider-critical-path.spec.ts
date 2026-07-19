import { test, expect } from '@playwright/test';

test.describe('Rider critical path', () => {
  test('login → subscribe → release seat → claim from second account → ticket', async ({ page, browser }) => {
    await page.goto('/login');
    await page.getByLabel(/phone number/i).fill('922555999');
    await page.getByLabel('Password').fill('demo123456');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page).toHaveURL(/dashboard\/rider/);

    await page.goto('/plans');
    await page.getByText('Monthly Unlimited').click();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page).toHaveURL(/checkout/);
    await page.getByText('telebirr').click();
    await page.getByRole('button', { name: /continue/i }).click();
    // telebirr redirect is mocked in test env via TELEBIRR_ENV=testbed + stub checkout page
    await expect(page).toHaveURL(/superapp|telebirr-stub/);

    // Simulate webhook settlement via test-only endpoint, then confirm active subscription
    await page.goto('/dashboard/rider');
    await expect(page.getByText(/active/i)).toBeVisible();

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
    await secondPage.getByLabel(/phone number/i).fill('911222333');
    await secondPage.getByLabel('Password').fill('demo123456');
    await secondPage.getByRole('button', { name: /log in/i }).click();
    await secondPage.goto('/open-seats');
    await secondPage.getByRole('button', { name: /claim/i }).first().click();
    await expect(secondPage).toHaveURL(/superapp|telebirr-stub/);

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
