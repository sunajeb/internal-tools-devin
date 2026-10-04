import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const screenshotDir = process.env.SCREENSHOT_DIR
  ? resolve(process.env.SCREENSHOT_DIR)
  : '/home/ubuntu/briefs/screens';

test.beforeAll(async () => {
  await mkdir(screenshotDir, { recursive: true });
});

async function capture(page: Page, name: string) {
  await page.screenshot({ path: resolve(screenshotDir, name), fullPage: true });
}

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.getByRole('link', { name: /continue with company sso/i }).click();
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' }),
  ).toBeVisible({ timeout: 30_000 });
}

async function openQueue(page: Page) {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'KYC queue' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'KYC review queue' }),
  ).toBeVisible();
}

test('analyst claims, reveals and requests approval; a lead approves', async ({
  page,
  browser,
}) => {
  await signIn(page, 'kyc-analyst', 'LocalKycAnalyst123!');
  await openQueue(page);
  await page.getByLabel('Status').selectOption('new');
  await page.getByLabel('Risk band').selectOption('high');
  const table = page.getByRole('table', { name: 'KYC cases' });
  const firstLink = table.getByRole('link').first();
  await expect(firstLink).toBeVisible();
  await expect(table.getByText('ID [REDACTED]').first()).toBeVisible();
  await capture(page, 'kyc-queue.png');

  const pageOneFirst = await firstLink.textContent();
  await page.getByRole('button', { name: /next page/i }).click();
  await expect(page.getByText('Page 2')).toBeVisible();
  await expect(firstLink).not.toHaveText(pageOneFirst!);
  await page.getByRole('button', { name: /previous page/i }).click();
  await expect(page.getByText('Page 1')).toBeVisible();
  await expect(firstLink).toHaveText(pageOneFirst!);

  const reference = pageOneFirst!.trim();
  await firstLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: reference })).toBeVisible();
  await expect(page.getByTestId('kyc-national_id')).toHaveText('[REDACTED]');
  await expect(page.getByTestId('kyc-customer_name')).toHaveText('••••••••');

  await page.getByRole('button', { name: 'Claim case' }).click();
  await expect(page.getByText(/you claimed this case/i)).toBeVisible();

  await page.getByRole('button', { name: 'Reveal national id' }).click();
  const reveal = page.getByRole('dialog', { name: /reveal national id/i });
  await expect(reveal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(reveal).toBeHidden();
  await page.getByRole('button', { name: 'Reveal national id' }).click();
  await reveal
    .getByLabel(/reason for access/i)
    .fill('Match the national ID with the passport scan.');
  await capture(page, 'kyc-reveal-reason.png');
  await reveal.getByRole('button', { name: 'Reveal field' }).click();
  await expect(page.getByTestId('kyc-national_id')).toHaveText(/^SYN-/);
  await expect(page.getByText('pii revealed').first()).toBeVisible();
  await capture(page, 'kyc-case-revealed.png');

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const decision = page.getByRole('dialog', { name: /approve case/i });
  await decision
    .getByLabel(/decision note/i)
    .fill('Documents match. Risk is high.');
  await decision.getByRole('button', { name: /confirm approve/i }).click();
  await expect(
    page.getByText(/a different kyc lead must approve this case/i),
  ).toBeVisible();
  await expect(page.getByText(/waits for a kyc lead approval/i)).toBeVisible();
  await capture(page, 'kyc-awaiting-approval.png');
  await expect(page.getByRole('link', { name: 'KYC approvals' })).toHaveCount(
    0,
  );

  const leadContext = await browser.newContext();
  const lead = await leadContext.newPage();
  await signIn(lead, 'kyc-lead', 'LocalKycLead123!');
  await lead.getByRole('link', { name: 'KYC approvals' }).click();
  const card = lead
    .locator('article.approval-card')
    .filter({ hasText: reference });
  await expect(card).toBeVisible();
  await capture(lead, 'kyc-approval-inbox.png');
  await card.getByRole('button', { name: /approve as kyc lead/i }).click();
  await expect(lead.getByText(/approval recorded/i)).toBeVisible();
  await leadContext.close();

  await page.reload();
  await expect(page.getByRole('heading', { name: reference })).toBeVisible();
  await expect(page.locator('.page-head .status-badge')).toHaveText('Approved');
  await expect(page.getByText('case approved').first()).toBeVisible();
  await capture(page, 'kyc-case-approved.png');
});

test('auditor sees masked data and no actions', async ({ page }) => {
  await signIn(page, 'auditor', 'LocalAuditor123!');
  await openQueue(page);
  await page.getByLabel('Search cases').fill('KYC-0000');
  const table = page.getByRole('table', { name: 'KYC cases' });
  await expect(table.getByRole('link').first()).toBeVisible();
  await table.getByRole('link').first().click();
  await expect(page.getByTestId('kyc-national_id')).toHaveText('[REDACTED]');
  await expect(page.getByRole('button', { name: /reveal/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Claim case' })).toHaveCount(0);
  await capture(page, 'kyc-auditor-masked.png');
});
