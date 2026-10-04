import { expect, test } from '@playwright/test';

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

test('sign out ends the identity-provider session so another user can sign in', async ({
  page,
}) => {
  await signIn(page, 'agent', 'LocalAgent123!');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('link', { name: /continue with company sso/i }),
  ).toBeVisible({ timeout: 30_000 });
  await signIn(page, 'supervisor', 'LocalSupervisor123!');
  const session = await page.evaluate(() =>
    fetch('/api/session').then((response) => response.json()),
  );
  expect(session.user.id).toBe('supervisor');
});
