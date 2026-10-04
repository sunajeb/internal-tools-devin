import { expect, test } from '@playwright/test';

const simulatorUrl = process.env.SIMULATOR_URL ?? 'http://localhost:4000';
const simulatorAdminToken =
  process.env.SIM_ADMIN_TOKEN ?? 'local-simulator-admin';

test('finance sees a new reconciliation exception without a page reload', async ({
  page,
  request,
}) => {
  const ghost = await request.post(`${simulatorUrl}/admin/ghost-refund`, {
    headers: { 'x-admin-token': simulatorAdminToken },
    data: { chargeId: 'ch_000006', amountMinor: '4200' },
  });
  expect(ghost.ok()).toBe(true);
  const { id: providerRefundId } = (await ghost.json()) as { id: string };

  await page.goto('/');
  await page.getByRole('link', { name: /continue with company sso/i }).click();
  await page.getByLabel(/username or email/i).fill('finance');
  await page
    .getByRole('textbox', { name: 'Password' })
    .fill('LocalFinance123!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Reconciliation' })
    .click({ timeout: 30_000 });
  await expect(
    page.getByRole('heading', { level: 1, name: 'Reconciliation' }),
  ).toBeVisible();
  await page.waitForLoadState('networkidle');

  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  await page.getByRole('button', { name: 'Run reconciliation' }).click();
  await expect(page.getByText(`Key: ${providerRefundId}`)).toBeVisible({
    timeout: 45_000,
  });
  expect(navigations).toBe(0);
});
