import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { APP, DESKTOP, PHONE, expectNoA11yViolations, newContext, setUpEmptyDashboard } from './helpers';

// The "Nudges from your data" switches in Settings. Which nudges the server is given, and what they say, is covered by the unit
// tests in src/__tests__/eventnudges.test.ts: a headless browser cannot create a real push subscription to send them through.

const goToReminders = async (p: Page) => {
  await p.getByRole('button', { name: 'Settings' }).last().click();
  await p.getByRole('heading', { name: 'Reminders' }).waitFor();
};
const saved = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem('life-dashboard:v1:reminders') ?? 'null'));

test('each nudge has its own switch, on by default, remembered, and says what it sends and where it works', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: DESKTOP });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await goToReminders(page);

  await expect(page.getByRole('heading', { name: 'Nudges from your data' })).toBeVisible();
  const section = page.locator('#reminders');
  await expect(section).toContainText('never what you logged');
  await expect(section).toContainText('not in the calendar file');
  const box = (name: RegExp) => section.getByRole('checkbox', { name });
  for (const n of [/Streak at risk/, /Reward ready to claim/, /Bill due/]) await expect(box(n)).toBeChecked();
  await expect(section).toContainText('At 20:30');
  await expect(section).toContainText('At 18:00');
  await expect(section).toContainText('At 08:00');

  // One at a time: switching one off leaves the others on.
  await box(/Reward ready to claim/).uncheck();
  await expect(box(/Streak at risk/)).toBeChecked();
  await expect(box(/Bill due/)).toBeChecked();
  expect((await saved(page)).events).toEqual({ reward: false });

  await page.reload();
  await goToReminders(page);
  await expect(box(/Reward ready to claim/)).not.toBeChecked();
  await expect(box(/Streak at risk/)).toBeChecked();
  await box(/Bill due/).uncheck();
  await box(/Reward ready to claim/).check();
  expect((await saved(page)).events).toEqual({ reward: true, bills: false });

  // The four ordinary reminders and the calendar file are not affected by them.
  await expect(page.getByRole('button', { name: 'Download calendar file' })).toBeEnabled();
  await expect(page.locator('#reminders .rem-row', { hasText: 'Daily check-in' })).toContainText('Next: today 21:00');
  await expectNoA11yViolations(page, 'nudge switches');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('on a phone the switches fit the screen', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: PHONE });
  const page = await ctx.newPage();
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await goToReminders(page);
  await page.getByRole('heading', { name: 'Nudges from your data' }).scrollIntoViewIfNeeded();
  await expect(page.locator('#reminders').getByRole('checkbox', { name: /Bill due/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone').toBe(true);
  await expectNoA11yViolations(page, 'nudge switches on a phone');
  await ctx.close();
});
