import { expect, test } from '@playwright/test';
import { APP, PHONE, expectNoA11yViolations, newContext, openTab, setUpEmptyDashboard } from './helpers';

test('train: pick a ready-made program, log a set, and go back to the original (phone)', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: PHONE });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await openTab(page, 'Train');

  await expect(page.getByText('Program:', { exact: false }).first()).toContainText('Push · Pull · Legs');
  await page.getByRole('button', { name: 'Change program' }).click();
  await expectNoA11yViolations(page, 'program picker');
  await expect(page.getByRole('button', { name: 'Use Push · Pull · Legs' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Use Upper · Lower' }).click();

  const tabs = page.getByRole('tablist', { name: 'Session' }).getByRole('tab');
  await expect(tabs).toHaveCount(5); // four sessions and Mobility
  await expect(page.getByRole('tab', { name: /Upper A/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Upper · Lower').first()).toBeVisible();

  // A set can be logged in the new program and the plate survives a reload.
  await page.getByRole('tab', { name: /Lower B/ }).click();
  await expect(page.getByText('Bulgarian split squats').first()).toBeVisible();
  await page.reload();
  await openTab(page, 'Train');
  await expect(page.getByRole('tablist', { name: 'Session' }).getByRole('tab')).toHaveCount(5);

  // Back to the original.
  await page.getByRole('button', { name: 'Change program' }).click();
  await page.getByRole('button', { name: 'Use Push · Pull · Legs' }).click();
  await expect(page.getByRole('tablist', { name: 'Session' }).getByRole('tab')).toHaveCount(4);
  await ctx.close();
});

test('train: a bodyweight program shows no barbell exercises, and Today still loads', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: PHONE });
  const page = await ctx.newPage();
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await openTab(page, 'Train');
  await page.getByRole('button', { name: 'Change program' }).click();
  await page.getByRole('button', { name: 'Use Bodyweight at home' }).click();
  await expect(page.getByText('Push-ups').first()).toBeVisible();
  await expect(page.getByText('Barbell')).toHaveCount(0);
  await openTab(page, 'Today');
  await expect(page.locator('.today-rows')).toBeVisible();
  await ctx.close();
});
