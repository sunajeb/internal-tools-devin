import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function signIn(
  page: import('@playwright/test').Page,
  username: string,
  password: string,
) {
  await page.goto('/');
  await page.getByRole('link', { name: /continue with company sso/i }).click();
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(
    page.getByRole('heading', { name: /good morning/i }),
  ).toBeVisible({ timeout: 30_000 });
}

const screenshotDir = process.env.SCREENSHOT_DIR
  ? resolve(process.env.SCREENSHOT_DIR)
  : '/home/ubuntu/briefs/screens';

test.beforeAll(async () => {
  await mkdir(screenshotDir, { recursive: true });
});

async function capture(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({ path: resolve(screenshotDir, name), fullPage: true });
}

test('login, search, request, approval, and audit verification', async ({
  page,
}) => {
  await signIn(page, 'agent', 'LocalAgent123!');
  await capture(page, 'login-and-overview.png');
  await page.getByRole('link', { name: 'Payments' }).click();
  await page
    .getByRole('textbox', { name: /search payments/i })
    .fill('ch_000001');
  await expect(page.getByText('ch_000001')).toBeVisible();
  await capture(page, 'payment-search.png');
  await page.getByText('ch_000001').first().click();
  await page.getByRole('button', { name: /request refund/i }).click();
  await page.getByLabel(/refund amount/i).fill('320');
  await page
    .getByLabel(/internal note/i)
    .fill('Refund requested for a documented service issue.');
  await expect(page.getByText('Supervisor approval')).toBeVisible();
  await capture(page, 'refund-request-tier.png');
  await page.getByRole('button', { name: /submit request/i }).click();
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();

  const reviewer = await page.context().browser()!.newContext();
  const reviewerPage = await reviewer.newPage();
  await signIn(reviewerPage, 'supervisor', 'LocalSupervisor123!');
  await reviewerPage.getByRole('link', { name: 'Approvals' }).click();
  await expect(
    reviewerPage.getByText('documented service issue'),
  ).toBeVisible();
  await capture(reviewerPage, 'approval-inbox.png');
  await reviewerPage
    .locator('article.approval-card')
    .filter({ hasText: 'documented service issue' })
    .getByRole('button', { name: /approve as supervisor/i })
    .click();
  await expect(reviewerPage.getByText(/approval recorded/i)).toBeVisible();
  await reviewer.close();

  await page.getByRole('link', { name: 'Refunds' }).click();
  const refundRow = page.locator('tr').filter({ hasText: 'ch_000001' }).first();
  await expect(refundRow.getByText('succeeded')).toBeVisible({
    timeout: 30_000,
  });
  await refundRow.click();
  await expect(page.getByText('refund requested')).toBeVisible();
  await expect(page.getByText('refund approval recorded')).toBeVisible();
  await expect(page.getByText('refund execution completed')).toBeVisible();
  await capture(page, 'refund-timeline.png');

  const auditor = await page.context().browser()!.newContext();
  const auditorPage = await auditor.newPage();
  await signIn(auditorPage, 'auditor', 'LocalAuditor123!');
  await auditorPage.getByRole('link', { name: 'Audit & controls' }).click();
  await auditorPage.getByRole('button', { name: /verify chain/i }).click();
  await expect(auditorPage.getByText(/audit chain verified/i)).toBeVisible();
  await capture(auditorPage, 'audit-verified.png');
  await auditor.close();
});
