import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { APP, newContext, stored } from './helpers';

// Currency and weight follow the person's location (timezone, then browser language) and can be changed. Amounts are relabelled,
// never converted; weights are stored in kilograms and shown in the chosen unit.
const device = async (browser: Browser, opts: { timezoneId: string; locale: string }) => {
  const ctx = await newContext(browser, { viewport: { width: 1280, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  return { ctx, page, errors };
};
const startSetup = (p: Page) => p.getByRole('button', { name: 'Set up my dashboard' }).click();
const next = (p: Page) => p.getByRole('button', { name: 'Next', exact: true }).click();
const prefs = async (p: Page) => ((await stored(p)) as { prefs?: { currency: string; weightUnit: string } }).prefs;

test('someone in the United States gets dollars and pounds, and what they type is stored in kilograms', async ({ browser }) => {
  const { ctx, page, errors } = await device(browser, { timezoneId: 'America/Chicago', locale: 'en-US' });
  await startSetup(page);
  await next(page); // training
  await expect(page.getByRole('combobox', { name: /^Weight/ })).toHaveValue('lb');
  await page.getByLabel('Weight today (lb)').fill('150');
  await page.getByLabel('Goal weight (lb)').fill('165');
  await page.getByLabel('Weight today (lb)').fill('5'); // too low: the limits are shown in pounds
  await expect(page.getByText(/between 66\.\d? and 551\.\d? lb/)).toBeVisible();
  await page.getByLabel('Weight today (lb)').fill('150');
  await next(page);
  await expect(page.getByRole('combobox', { name: /^Currency/ })).toHaveValue('USD');
  await expect(page.getByText('All amounts are in US Dollar')).toBeVisible();
  await expect(page.getByText('Rough daily spending ($)')).toBeVisible();
  await next(page);
  await next(page);
  await page.getByRole('radio', { name: 'Start empty' }).click();
  await page.getByRole('button', { name: 'Open my dashboard' }).click();
  await page.getByText('Today’s plates').waitFor();

  await expect.poll(() => prefs(page)).toEqual({ currency: 'USD', weightUnit: 'lb' });
  const body = ((await stored(page)) as { body: { weight: number }[]; goalWeight: number }).body;
  expect(body[0].weight).toBeCloseTo(68.04, 1); // 150 lb, kept in kilograms
  expect(((await stored(page)) as { goalWeight: number }).goalWeight).toBeCloseTo(74.84, 1);

  // the Body screen speaks pounds
  await page.getByRole('button', { name: 'Body', exact: true }).first().click();
  await expect(page.getByText('Weight (lb)')).toBeVisible();
  await expect(page.getByText('165 lb').first()).toBeVisible();

  // money is in dollars
  await page.getByRole('button', { name: 'Money', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('1500');
  await page.getByRole('radio', { name: 'Food' }).click();
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.locator('.txn-amt').first()).toHaveText('−$1,500');
  await expect(page.getByText('₦')).toHaveCount(0);

  // changing the currency relabels the same amount; it does not convert it
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('combobox', { name: /^Currency/ }).selectOption('GBP');
  await page.getByRole('button', { name: 'Money', exact: true }).first().click();
  await expect(page.locator('.txn-amt').first()).toHaveText('−£1,500');
  await expect.poll(async () => ((await stored(page)) as { money: { txns: { amount: number }[] } }).money.txns[0]?.amount).toBe(1500);

  // and the weight unit switch is exact and keeps the stored kilograms
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('combobox', { name: /^Weight/ }).selectOption('kg');
  await page.getByRole('button', { name: 'Body', exact: true }).first().click();
  await expect(page.getByText('Weight (kg)')).toBeVisible();
  await expect(page.getByText('74.8 kg').first()).toBeVisible();
  expect(((await stored(page)) as { body: { weight: number }[] }).body[0].weight).toBeCloseTo(68.04, 1);
  await expect.poll(() => prefs(page)).toEqual({ currency: 'GBP', weightUnit: 'kg' });

  await page.reload();
  await page.getByRole('button', { name: 'Money', exact: true }).first().click();
  await expect(page.locator('.txn-amt').first()).toHaveText('−£1,500');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('someone in Nigeria still gets naira and kilograms, and can pick anything else', async ({ browser }) => {
  const { ctx, page } = await device(browser, { timezoneId: 'Africa/Lagos', locale: 'en-GB' });
  await startSetup(page);
  await next(page);
  await expect(page.getByRole('combobox', { name: /^Weight/ })).toHaveValue('kg');
  await next(page);
  await expect(page.getByRole('combobox', { name: /^Currency/ })).toHaveValue('NGN');
  await page.getByRole('combobox', { name: /^Currency/ }).selectOption('KES');
  await expect(page.getByText('All amounts are in Kenyan Shilling')).toBeVisible();
  await ctx.close();
});

test('someone whose location cannot be told starts on dollars and kilograms and is told so', async ({ browser }) => {
  const { ctx, page } = await device(browser, { timezoneId: 'Etc/UTC', locale: 'en' });
  await startSetup(page);
  await next(page);
  await expect(page.getByText('Couldn’t tell where you are')).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Weight/ })).toHaveValue('kg');
  await next(page);
  await expect(page.getByRole('combobox', { name: /^Currency/ })).toHaveValue('USD');
  await ctx.close();
});

test('an existing save from before this setting keeps naira and kilograms even in another country', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago', locale: 'en-US' });
  const page = await ctx.newPage();
  // saved before the app loads, as it would be from an earlier version
  await page.addInitScript(() => {
    if (localStorage.getItem('life-dashboard:v1')) return;
    const d = { version: 1, sample: false, onboarded: true, gone: [], days: {}, sessions: {}, body: [{ date: '2026-10-01', weight: 70, m: {} }], goalWeight: null, plans: [],
      money: { txns: [{ id: 'a', date: '2026-10-09', kind: 'expense', amount: 2500, category: 'Food', note: '' }], savePct: 20, dailyEstimate: null, survivalOpening: 0 } };
    localStorage.setItem('life-dashboard:v1', JSON.stringify(d));
  });
  await page.goto(APP);
  await page.getByRole('button', { name: 'Money', exact: true }).first().click();
  await expect(page.locator('.txn-amt').first()).toHaveText('−₦2,500');
  await page.getByRole('button', { name: 'Body', exact: true }).first().click();
  await expect(page.getByText('Weight (kg)')).toBeVisible();
  await ctx.close();
});
