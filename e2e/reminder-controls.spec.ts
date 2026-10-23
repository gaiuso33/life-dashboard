import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { APP, DESKTOP, PHONE, expectNoA11yViolations, newContext, setUpEmptyDashboard } from './helpers';

// Per-reminder weekdays and quiet hours in Settings. The clock is fixed at Friday 9 Oct 2026, 10:00 in Lagos, and the default
// programme trains on Monday, Wednesday and Friday. What the server does with these choices is covered by the unit tests.

const goToReminders = async (p: Page) => {
  await p.getByRole('button', { name: 'Settings' }).last().click();
  await p.getByRole('heading', { name: 'Reminders' }).waitFor();
};
const rowOf = (p: Page, label: string) => p.locator('#reminders .rem-row', { hasText: label });
const day = (p: Page, label: string, name: string) => rowOf(p, label).getByRole('button', { name, exact: true });
const calendarFile = async (p: Page): Promise<string> => {
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Download calendar file' }).click()]);
  return readFileSync((await dl.path())!, 'utf8');
};

test('each reminder can be limited to chosen weekdays, and the next time, the saved choice and the calendar file follow', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: DESKTOP });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await goToReminders(page);

  // Training follows the programme to begin with.
  for (const d of ['Monday', 'Wednesday', 'Friday']) await expect(day(page, 'Training day', d)).toHaveAttribute('aria-pressed', 'true');
  for (const d of ['Tuesday', 'Thursday', 'Saturday', 'Sunday']) await expect(day(page, 'Training day', d)).toHaveAttribute('aria-pressed', 'false');
  await expect(rowOf(page, 'Training day')).toContainText('On your programme’s gym days');
  await expect(rowOf(page, 'Training day').getByRole('button', { name: 'Back to the usual days' })).toHaveCount(0);

  // Take Friday off: today's 17:30 is no longer coming, so the next one is Monday.
  await day(page, 'Training day', 'Friday').click();
  await expect(rowOf(page, 'Training day')).toContainText('Your chosen days');
  await expect(rowOf(page, 'Training day')).toContainText('Next: Monday 17:30');
  // The daily check-in only on Saturdays.
  for (const d of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Sunday']) await day(page, 'Daily check-in', d).click();
  await expect(rowOf(page, 'Daily check-in')).toContainText('Next: tomorrow (Saturday) 21:00');
  // The last day cannot be switched off: a reminder with no days would never fire.
  await expect(day(page, 'Daily check-in', 'Saturday')).toBeDisabled();

  const ics = await calendarFile(page);
  expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=SA');
  expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
  expect(ics).not.toContain('BYDAY=MO,WE,FR');
  await expect(page.locator('#reminders')).toContainText('Your calendar app has its own snooze');

  // The choice survives a reload.
  await page.reload();
  await goToReminders(page);
  await expect(day(page, 'Daily check-in', 'Saturday')).toHaveAttribute('aria-pressed', 'true');
  await expect(day(page, 'Daily check-in', 'Monday')).toHaveAttribute('aria-pressed', 'false');
  await expect(day(page, 'Training day', 'Friday')).toHaveAttribute('aria-pressed', 'false');

  // Picking exactly the usual days again goes back to following the programme.
  await day(page, 'Training day', 'Friday').click();
  await expect(rowOf(page, 'Training day')).toContainText('On your programme’s gym days');
  await expect(rowOf(page, 'Training day')).toContainText('Next: today 17:30');
  // Or reset with one button.
  await rowOf(page, 'Daily check-in').getByRole('button', { name: 'Back to the usual days' }).click();
  await expect(rowOf(page, 'Daily check-in')).toContainText('Next: today 21:00');
  await expect(day(page, 'Daily check-in', 'Tuesday')).toHaveAttribute('aria-pressed', 'true');

  // A switched-off reminder shows no days to pick.
  await page.getByRole('checkbox', { name: /Weekly review/ }).uncheck();
  await expect(rowOf(page, 'Weekly review').getByRole('group')).toHaveCount(0);
  await expectNoA11yViolations(page, 'reminder days');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('quiet hours: a reminder that falls inside them is flagged and left out of the calendar file', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: PHONE });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await goToReminders(page);

  const quiet = rowOf(page, 'Quiet hours');
  await expect(quiet.getByLabel('Quiet hours from')).toBeDisabled();
  await quiet.getByRole('checkbox', { name: /Quiet hours/ }).check();
  await expect(quiet.getByLabel('Quiet hours from')).toHaveValue('22:00');
  await expect(quiet.getByLabel('Quiet hours until')).toHaveValue('07:00');
  await expect(page.locator('#reminders')).toContainText('skipped, in push notifications and in the calendar file');
  await expect(rowOf(page, 'Daily check-in')).toContainText('Next: today 21:00'); // 21:00 is outside 22:00 to 07:00

  await quiet.getByLabel('Quiet hours from').fill('20:30');
  await quiet.getByLabel('Quiet hours until').fill('21:30');
  await expect(rowOf(page, 'Daily check-in')).toContainText('Next: never (inside quiet hours)');
  await expect(rowOf(page, 'Training day')).toContainText('Next: today 17:30');
  let ics = await calendarFile(page);
  expect(ics).not.toContain('UID:checkin@');
  expect(ics).toContain('UID:training@');
  expect(ics).toContain('UID:review@');

  // A window that wraps past midnight works the same way.
  await quiet.getByLabel('Quiet hours from').fill('21:00');
  await quiet.getByLabel('Quiet hours until').fill('05:00');
  await expect(rowOf(page, 'Daily check-in')).toContainText('Next: never (inside quiet hours)');
  await quiet.getByLabel('Quiet hours until').fill('20:00');
  await expect(rowOf(page, 'Daily check-in')).toContainText('Next: never (inside quiet hours)');

  // It is remembered, and switching it off brings the reminder back.
  await page.reload();
  await goToReminders(page);
  await expect(quiet.getByRole('checkbox', { name: /Quiet hours/ })).toBeChecked();
  await expect(quiet.getByLabel('Quiet hours from')).toHaveValue('21:00');
  await quiet.getByRole('checkbox', { name: /Quiet hours/ }).uncheck();
  await expect(rowOf(page, 'Daily check-in')).toContainText('Next: today 21:00');
  ics = await calendarFile(page);
  expect(ics).toContain('UID:checkin@');

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone').toBe(true);
  await expectNoA11yViolations(page, 'quiet hours');
  expect(errors).toEqual([]);
  await ctx.close();
});
