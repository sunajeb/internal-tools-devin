import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const blockingImpacts = new Set(['serious', 'critical']);
const screenshotDir = process.env.A11Y_SCREENSHOT_DIR
  ? resolve(process.env.A11Y_SCREENSHOT_DIR)
  : undefined;

type Account = { username: string; password: string };
const accounts = {
  agent: { username: 'agent', password: 'LocalAgent123!' },
  supervisor: { username: 'supervisor', password: 'LocalSupervisor123!' },
  finance: { username: 'finance', password: 'LocalFinance123!' },
  auditor: { username: 'auditor', password: 'LocalAuditor123!' },
  platformAdmin: { username: 'platform-admin', password: 'LocalPlatform123!' },
} satisfies Record<string, Account>;

async function signIn(page: Page, account: Account) {
  await page.goto('/');
  await page.getByRole('link', { name: /continue with company sso/i }).click();
  await page.getByLabel(/username or email/i).fill(account.username);
  await page.getByRole('textbox', { name: 'Password' }).fill(account.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
    timeout: 30_000,
  });
}

async function openPage(page: Page, link: string, heading: RegExp) {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: link })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: heading }),
  ).toBeVisible();
  await page.waitForLoadState('networkidle');
}

async function expectNoSeriousViolations(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDir, `${name}.png`),
      fullPage: true,
    });
  }
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  if (screenshotDir) {
    await writeFile(
      resolve(screenshotDir, `${name}.axe.json`),
      JSON.stringify(results.violations, null, 2),
    );
  }
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  const blocking = results.violations
    .filter((violation) => blockingImpacts.has(violation.impact ?? ''))
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
  expect(blocking, `${name}: serious or critical axe violations`).toEqual([]);
}

test.use({ reducedMotion: 'reduce' });

test.describe('accessibility', () => {
  test('sign-in page', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /sign in to ledgerline/i }),
    ).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'sign-in');
  });

  test('agent: overview, payments, payment detail, refund request, refunds', async ({
    page,
  }, testInfo) => {
    await signIn(page, accounts.agent);
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('link', { name: 'Open approval inbox' }),
    ).toHaveCount(0);
    await expectNoSeriousViolations(page, testInfo, 'agent-overview');

    await openPage(page, 'Payments', /payments/i);
    const firstPayment = page
      .getByRole('button', { name: /open payment/i })
      .first();
    await expect(firstPayment).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'agent-payments');

    const amountHeader = page.getByRole('columnheader', { name: /^amount/i });
    const dateHeader = page.getByRole('columnheader', { name: /^date/i });
    await expect(amountHeader).toHaveAttribute('aria-sort', 'none');
    await expect(dateHeader).toHaveAttribute('aria-sort', 'descending');
    await amountHeader.getByRole('button').click();
    await expect(amountHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(dateHeader).toHaveAttribute('aria-sort', 'none');
    await amountHeader.getByRole('button').click();
    await expect(amountHeader).toHaveAttribute('aria-sort', 'ascending');
    await dateHeader.getByRole('button').click();
    await expect(dateHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(firstPayment).toBeVisible();

    await page.getByRole('button', { name: /filters/i }).click();
    await expect(page.getByLabel(/minimum amount/i)).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'agent-payments-filters');

    await firstPayment.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(firstPayment).toBeFocused();

    await firstPayment.click();
    const detail = page.getByRole('dialog');
    await expect(detail.getByText(/refundable balance/i)).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'agent-payment-detail');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(firstPayment).toBeFocused();

    await firstPayment.press('Enter');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /request refund/i })
      .click();
    const refundDialog = page.getByRole('dialog', { name: 'Refund payment' });
    const amount = refundDialog.getByLabel(/refund amount/i);
    await expect(amount).toBeFocused();
    await amount.clear();
    await amount.pressSequentially('250');
    await expect(amount).toHaveValue('250');
    await amount.clear();
    await amount.pressSequentially('12.5');
    await expect(amount).toHaveValue('12.5');
    await refundDialog.getByRole('button', { name: /submit request/i }).click();
    await expect(refundDialog.getByLabel(/internal note/i)).toBeFocused();
    await expect(
      refundDialog.getByText(/10 or more characters/i),
    ).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'agent-refund-request');
    await refundDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await openPage(page, 'Refunds', /refunds/i);
    await expectNoSeriousViolations(page, testInfo, 'agent-refunds');

    await page.goto('/audit');
    await expect(
      page.getByRole('heading', { name: /access restricted/i }),
    ).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'agent-access-restricted');
  });

  test('supervisor: approval inbox and reveal with a reason', async ({
    page,
  }, testInfo) => {
    await signIn(page, accounts.supervisor);
    await openPage(page, 'Approvals', /approval inbox/i);
    await expect(
      page.getByRole('heading', { name: /refund request/i }).first(),
    ).toBeVisible();
    await expect(page.getByText(/NaN/)).toHaveCount(0);
    await expectNoSeriousViolations(page, testInfo, 'supervisor-approvals');

    await openPage(page, 'Payments', /payments/i);
    await page
      .getByRole('button', { name: /open payment/i })
      .first()
      .click();
    const detail = page.getByRole('dialog');
    await detail.getByRole('button', { name: 'Reveal email' }).click();
    const form = detail.getByRole('form', { name: 'Reveal email' });
    const reason = form.getByLabel('Reason for reveal');
    await expect(reason).toBeFocused();
    await form.getByRole('button', { name: 'Reveal email' }).click();
    await expect(form.getByText(/10 or more characters/i)).toBeVisible();
    await expect(reason).toBeFocused();
    await expectNoSeriousViolations(page, testInfo, 'supervisor-reveal-reason');
    await reason.fill('Customer asked for a receipt by email.');
    await form.getByRole('button', { name: 'Reveal email' }).click();
    await expect(
      detail.getByRole('button', { name: 'Email revealed' }),
    ).toBeVisible();
    await expect(form).toHaveCount(0);
  });

  test('finance: reconciliation', async ({ page }, testInfo) => {
    await signIn(page, accounts.finance);
    await openPage(page, 'Reconciliation', /reconciliation/i);
    await expectNoSeriousViolations(page, testInfo, 'finance-reconciliation');
  });

  test('auditor: refund timeline and audit', async ({ page }, testInfo) => {
    await signIn(page, accounts.auditor);
    await openPage(page, 'Refunds', /refunds/i);
    const firstRefund = page
      .getByRole('button', { name: /open refund/i })
      .first();
    await expect(firstRefund).toBeVisible();
    await firstRefund.click();
    const timeline = page.getByRole('dialog');
    await expect(timeline.getByText(/current status/i)).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'auditor-refund-timeline');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await openPage(page, 'Audit & controls', /audit & controls/i);
    await page.getByRole('button', { name: /verify chain/i }).click();
    await expect(page.getByText(/audit chain verified/i)).toBeVisible();
    await expectNoSeriousViolations(page, testInfo, 'auditor-audit');
  });

  test('platform admin: overview', async ({ page }, testInfo) => {
    await signIn(page, accounts.platformAdmin);
    await page.waitForLoadState('networkidle');
    await expectNoSeriousViolations(page, testInfo, 'platform-admin-overview');
  });
});
