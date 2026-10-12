import { expect, test } from '@playwright/test';
import fs from 'fs';
import { APP, DESKTOP, expectNoA11yViolations, newDevice, setUpEmptyDashboard } from './helpers';

test('a new person gets a checklist that ticks itself, and reminders download as a calendar file', async ({ browser }) => {
  const { ctx, page, errors } = await newDevice(browser, DESKTOP, APP);
  await setUpEmptyDashboard(page);

  const guide = page.locator('.guide');
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('0 of');
  await expectNoA11yViolations(page, 'today with getting-started');

  // a real action ticks its step
  await guide.getByRole('button', { name: 'Open money' }).click();
  await page.getByRole('button', { name: 'Import a statement' }).waitFor();
  await page.getByLabel('Amount in naira').fill('1500');
  await page.getByRole('radio', { name: 'Food' }).click();
  await page.getByRole('button', { name: 'Save entry' }).click();
  await page.getByRole('button', { name: 'Today' }).first().click();
  await expect(page.locator('.guide .row.is-done')).not.toHaveCount(0);

  // reminders
  await guide.getByRole('button', { name: 'Set reminders' }).click();
  await page.getByRole('heading', { name: 'Reminders' }).waitFor();
  await expectNoA11yViolations(page, 'settings reminders');
  await page.locator('#reminders label.check', { hasText: 'Log spending' }).click();
  await expect(page.getByRole('checkbox', { name: /Log spending/ })).toBeChecked();
  await page.getByLabel('Log spending time').fill('20:30');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download calendar file' }).click()]);
  expect(dl.suggestedFilename()).toBe('life-dashboard-reminders.ics');
  const text = fs.readFileSync((await dl.path())!, 'utf8');
  expect(text).toContain('BEGIN:VCALENDAR');
  expect(text).toContain('T203000');
  expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(4);
  await expect(page.getByRole('status').filter({ hasText: 'Add All' })).toBeVisible();

  // the step is now done, and the checklist can be hidden for good
  await page.getByRole('button', { name: 'Today' }).first().click();
  await expect(guide.getByText('Set up reminders')).toBeVisible();
  await expect(guide.locator('.row.is-done', { hasText: 'Set up reminders' })).toHaveCount(1);
  await guide.getByRole('button', { name: 'Hide this' }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('the demo does not show the checklist', async ({ browser }) => {
  const { ctx, page } = await newDevice(browser, DESKTOP, APP + '?demo&tour=0');
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  await expect(page.locator('.guide')).toHaveCount(0);
  await ctx.close();
});
