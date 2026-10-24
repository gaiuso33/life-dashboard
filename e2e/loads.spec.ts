import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { APP, DESKTOP, PHONE, expectNoA11yViolations, newContext, setUpEmptyDashboard, stored } from './helpers';

// The optional weight for each exercise. Stored in kilograms, shown in the unit chosen in Settings. The clock is fixed at
// Friday 9 Oct 2026; the default programme's Push day is Monday.

const goTrain = (p: Page) => p.getByRole('button', { name: 'Train', exact: true }).first().click();
const push = (p: Page) => p.getByRole('tab', { name: /Push/ }).click();
const bench = (p: Page, unit: string) => p.getByLabel(`Barbell bench press, weight in ${unit}`);
const todayBench = async (p: Page) => ((await stored(p)).sessions['2026-10-09|push'] ?? {}) as { kg?: Record<string, number>; reps?: Record<string, (number | null)[]> };

/** A finished Push session on Monday 5 Oct, put in place as the next page starts (the page saves its own state as it unloads). */
async function seedLastSession(page: Page, ctxInit: (fn: (a: [string, string]) => void, arg: [string, string]) => Promise<void>, kg?: number, reps = [8, 8, 8, 8], lb = false) {
  const d = await stored(page);
  d.onboarded = true;
  if (lb) d.prefs = { currency: 'USD', weightUnit: 'lb', lengthUnit: 'in' }; // chosen in setup; "Start empty" has not saved it yet
  d.modified = '2026-10-09T09:00:00.000Z';
  d.sessions['2026-10-05|push'] = { date: '2026-10-05', day: 'push', loads: {}, reps: { bench: reps }, ...(kg != null && { kg: { bench: kg } }), finished: true };
  await ctxInit(([k, v]) => localStorage.setItem(k, v), ['life-dashboard:v1', JSON.stringify(d)]);
  await page.reload();
}

test('pounds: type a load in pounds, see the next step up, copy last time, clear it, and switch to kilograms', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: DESKTOP, timezoneId: 'America/Chicago', locale: 'en-US' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await seedLastSession(page, (f, a) => ctx.addInitScript(f, a), 61.23, [8, 8, 8, 8], true); // 135 lb last time, every set at the top of the range
  await goTrain(page);
  await push(page);

  // Last time's load is the placeholder, and the hint is one step up (5 lb) from it.
  await expect(bench(page, 'lb')).toHaveAttribute('placeholder', '135');
  await expect(page.getByText('You hit 8 on every set last time. Add load today: try 140 lb (last time 135 lb).')).toBeVisible();

  // Typing a weight stores kilograms, and what is typed stays as typed.
  await bench(page, 'lb').pressSequentially('142.5');
  await expect(bench(page, 'lb')).toHaveValue('142.5');
  await expect.poll(async () => (await todayBench(page)).kg?.bench).toBe(64.64);

  // Copy last time only offers itself while the sets are empty, and does not overwrite a typed weight.
  await page.getByRole('button', { name: 'Copy last time' }).first().click();
  await expect(bench(page, 'lb')).toHaveValue('142.5');
  await expect.poll(async () => (await todayBench(page)).reps?.bench).toEqual([8, 8, 8, 8]);

  // Clearing the weight leaves the reps, and the session has no load at all.
  await bench(page, 'lb').fill('');
  await expect.poll(async () => (await todayBench(page)).kg).toBeUndefined();
  expect((await todayBench(page)).reps?.bench).toEqual([8, 8, 8, 8]);

  // Something that is not a weight is flagged, not saved.
  await bench(page, 'lb').fill('0');
  await expect(page.getByText('Enter a weight between 0 and 2204.6 lb.').first()).toBeVisible();
  await expect(bench(page, 'lb')).toHaveAttribute('aria-invalid', 'true');
  await expectNoA11yViolations(page, 'a weight that cannot be used');
  await bench(page, 'lb').fill('135');
  await expect(page.getByText('Enter a weight between')).toHaveCount(0);
  await expect.poll(async () => (await todayBench(page)).kg?.bench).toBe(61.23);

  // Switching the unit changes how it is shown, never what is stored.
  await page.getByRole('button', { name: 'Settings' }).last().click();
  await page.getByRole('combobox', { name: /^Weight/ }).selectOption('kg');
  await goTrain(page);
  await push(page);
  await expect(bench(page, 'kg')).toHaveValue('61.2');
  await expect(page.getByText('Weight (kg)').first()).toBeVisible();
  await expect(page.getByText('try 63.7 kg (last time 61.2 kg)')).toBeVisible();
  expect((await todayBench(page)).kg?.bench).toBe(61.23);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('kilograms: rep-only logging still works, the step is 2.5 kg, and Copy last time brings the weight', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: PHONE });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await seedLastSession(page, (f, a) => ctx.addInitScript(f, a)); // last time: reps only, no weight
  await goTrain(page);
  await push(page);

  await expect(page.getByText('You hit 8 on every set last time. Add load today, in steps of 2.5 kg.')).toBeVisible();
  await expect(bench(page, 'kg')).toHaveAttribute('placeholder', 'optional');
  // Reps alone are enough: no weight, no complaint.
  await page.getByLabel('Barbell bench press, set 1, reps').fill('8');
  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByText('Session finished.')).toBeVisible();
  await expect(page.getByText('Enter a weight')).toHaveCount(0);
  await expect.poll(async () => (await todayBench(page)).reps?.bench).toEqual([8, null, null, null]);
  expect((await todayBench(page)).kg).toBeUndefined();

  // A comma works as the decimal mark, and the timed plank has no weight box.
  await bench(page, 'kg').fill('42,5');
  await expect.poll(async () => (await todayBench(page)).kg?.bench).toBe(42.5);
  await page.getByRole('tab', { name: /Legs/ }).click();
  await expect(page.getByLabel('Plank, weight in kg')).toHaveCount(0);
  await expect(page.getByLabel('Plank, set 1, sec')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone').toBe(true);
  await expectNoA11yViolations(page, 'train with weights');
  expect(errors).toEqual([]);
  await ctx.close();

  // Copy last time: a fresh phone with a weighed last session.
  const ctx2 = await newContext(browser, { viewport: PHONE });
  const p2 = await ctx2.newPage();
  await p2.goto(APP);
  await setUpEmptyDashboard(p2);
  await seedLastSession(p2, (f, a) => ctx2.addInitScript(f, a), 40, [8, 7, 6, 6]);
  await goTrain(p2);
  await push(p2);
  await p2.getByRole('button', { name: 'Copy last time' }).first().click();
  await expect(bench(p2, 'kg')).toHaveValue('40');
  await expect.poll(async () => (await todayBench(p2)).kg?.bench).toBe(40);
  await ctx2.close();
});

test('the training volume forecast becomes weight lifted once three weeks in a row have loads, in the unit shown', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: DESKTOP, timezoneId: 'America/Chicago', locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  const d = await stored(page);
  d.onboarded = true;
  d.prefs = { currency: 'USD', weightUnit: 'lb', lengthUnit: 'in' };
  d.modified = '2026-10-09T09:00:00.000Z';
  // Three finished Mondays, the same reps each week and the load going up 2.5 kg a time.
  ['2026-09-14', '2026-09-21', '2026-09-28'].forEach((date, i) => {
    d.sessions[`${date}|push`] = { date, day: 'push', loads: {}, reps: { bench: [8, 8, 8, 8] }, kg: { bench: 40 + i * 2.5 }, finished: true };
  });
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['life-dashboard:v1', JSON.stringify(d)]);
  await page.reload();
  await page.getByRole('button', { name: 'Advisor', exact: true }).first().click();
  const card = page.locator('.forecasts li', { hasText: 'Training volume' });
  await expect(card).toContainText('Weight lifted is rising, about 176 lb a week'); // 32 reps x 2.5 kg = 80 kg
  await expect(card).toContainText('3 finished weeks of reps times load');
  await ctx.close();
});
