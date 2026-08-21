import { expect, test } from '@playwright/test';

test('shows the local admin shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Admin shell' })).toBeVisible();
});
