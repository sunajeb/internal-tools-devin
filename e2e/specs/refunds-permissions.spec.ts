import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.getByRole('link', { name: /continue with company sso/i }).click();
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(
    page.getByRole('heading', { name: /good morning/i }),
  ).toBeVisible({ timeout: 30_000 });
}

async function openNavigation(page: Page, link: string) {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: link })
    .click();
}

async function openCharge(page: Page, chargeId: string) {
  await openNavigation(page, 'Payments');
  await page.getByRole('textbox', { name: /search payments/i }).fill(chargeId);
  await page.getByRole('button', { name: `Open payment ${chargeId}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Refundable balance')).toBeVisible();
  return dialog;
}

function recordForbiddenResponses(page: Page) {
  const forbidden: string[] = [];
  page.on('response', (response) => {
    if (response.status() === 403) forbidden.push(response.url());
  });
  return forbidden;
}

test('auditor sees reveal and export actions but no refund request action', async ({
  page,
}) => {
  const forbidden = recordForbiddenResponses(page);
  await signIn(page, 'auditor', 'LocalAuditor123!');
  const dialog = await openCharge(page, 'ch_000002');
  await expect(
    dialog.getByRole('button', { name: 'Reveal email' }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: /request refund/i }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await openNavigation(page, 'Refunds');
  await expect(page.getByRole('link', { name: /export csv/i })).toBeVisible();
  expect(forbidden).toEqual([]);
});

test('agent sees the refund request action but no reveal or export actions', async ({
  page,
}) => {
  const forbidden = recordForbiddenResponses(page);
  await signIn(page, 'agent', 'LocalAgent123!');
  const dialog = await openCharge(page, 'ch_000002');
  await expect(
    dialog.getByRole('button', { name: /request refund/i }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Reveal email' }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await openNavigation(page, 'Refunds');
  await expect(page.getByRole('heading', { name: 'Refunds' })).toBeVisible();
  await expect(page.getByRole('link', { name: /export csv/i })).toHaveCount(0);
  expect(forbidden).toEqual([]);
});

test('platform admin overview loads only permitted data and keeps the kill switch', async ({
  page,
}) => {
  const forbidden = recordForbiddenResponses(page);
  await signIn(page, 'platform-admin', 'LocalPlatform123!');
  await expect(
    page.getByRole('button', { name: /(pause|resume) execution/i }),
  ).toBeVisible();
  await expect(page.getByText('Total refunds')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('table', { name: 'Recent refunds' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(forbidden).toEqual([]);
});
