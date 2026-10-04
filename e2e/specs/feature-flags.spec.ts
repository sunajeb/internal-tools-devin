import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const screenshotDir = process.env.SCREENSHOT_DIR
  ? resolve(process.env.SCREENSHOT_DIR)
  : '/home/ubuntu/briefs/screens';
const flagKey = 'dashboard.dark_mode';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.getByRole('link', { name: /continue with company sso/i }).click();
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Feature flags' }),
  ).toBeVisible({ timeout: 30_000 });
}

async function openApprovals(page: Page) {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Flag approvals' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Production approvals' }),
  ).toBeVisible();
  await expect(
    page
      .locator('article.approval-card')
      .or(page.getByText('No changes wait for approval'))
      .first(),
  ).toBeVisible();
}

function latestHistoryRow(page: Page) {
  return page
    .getByRole('table', { name: 'Change history' })
    .getByRole('row')
    .nth(1);
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: resolve(screenshotDir, name), fullPage: true });
}

test.beforeAll(async () => {
  await mkdir(screenshotDir, { recursive: true });
});

test('editor requests a production change and an approver applies it', async ({
  page,
  browser,
}) => {
  const reviewer = await browser.newContext();
  const reviewerPage = await reviewer.newPage();
  await signIn(reviewerPage, 'flag-approver', 'LocalFlagApprover123!');
  await openApprovals(reviewerPage);
  const leftovers = reviewerPage
    .locator('article.approval-card')
    .filter({ hasText: `${flagKey} in production` });
  while ((await leftovers.count()) > 0) {
    await leftovers
      .first()
      .getByRole('button', {
        name: `Reject production change for ${flagKey}`,
      })
      .click();
    await expect(reviewerPage.getByText(/is rejected/i)).toBeVisible();
    await reviewerPage.reload();
  }

  await signIn(page, 'flag-editor', 'LocalFlagEditor123!');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Feature flags' })
    .click();
  await page.getByRole('searchbox', { name: 'Search flags' }).fill('dark');
  await expect(page.getByRole('link', { name: flagKey })).toBeVisible();
  await capture(page, 'feature-flags-list.png');
  await page.getByRole('link', { name: flagKey }).click();
  await expect(page.getByRole('heading', { name: flagKey })).toBeVisible();

  const stagingInput = page.getByLabel('Rollout percent for staging');
  const staging = (await stagingInput.inputValue()) === '25' ? '35' : '25';
  await stagingInput.fill(staging);
  await page.getByRole('button', { name: 'Save staging' }).click();
  await expect(page.getByText('Staging is updated.')).toBeVisible();

  const productionInput = page.getByLabel('Rollout percent for production');
  const rollout = (await productionInput.inputValue()) === '55' ? '65' : '55';
  const reason = `Roll out dark mode to ${rollout}% of production users. Run ${Date.now()}.`;
  await page.getByLabel('Enabled in production').check();
  await productionInput.fill(rollout);
  await page.getByLabel('Reason for production change').fill(reason);
  await page.getByRole('button', { name: 'Request production change' }).click();
  await expect(page.getByText(/waits for a flag approver/i)).toBeVisible();
  await expect(latestHistoryRow(page)).toContainText(
    'Requested production change',
  );
  await capture(page, 'feature-flags-detail-pending.png');

  await reviewerPage.reload();
  const card = reviewerPage
    .locator('article.approval-card')
    .filter({ hasText: reason });
  await expect(card).toBeVisible();
  await capture(reviewerPage, 'feature-flags-approvals.png');
  await card
    .getByRole('button', {
      name: `Approve production change for ${flagKey}`,
    })
    .click();
  await expect(
    reviewerPage.getByText(`${flagKey} is now On, ${rollout}% in production.`),
  ).toBeVisible();
  await reviewer.close();

  await page.reload();
  const production = page.locator('form').filter({
    has: page.getByRole('group', { name: 'Production' }),
  });
  await expect(production.getByText(`On, ${rollout}%`).first()).toBeVisible();
  await expect(latestHistoryRow(page)).toContainText(
    'Approved production change',
  );
  await capture(page, 'feature-flags-applied-history.png');
});
