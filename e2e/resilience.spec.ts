import { expect, test } from '@playwright/test';
import { APP, newDevice, setUpEmptyDashboard, stored, newContext } from './helpers';

const DAMAGED = '{"days": {broken';

test('unreadable saved data shows the recovery screen and is never overwritten', async ({ browser }) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((raw) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('life-dashboard:v1', raw);
    }
  }, DAMAGED);
  await page.goto(APP);
  await expect(page.getByRole('heading', { name: 'We couldn’t read your saved data' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('life-dashboard:v1'))).toBe(DAMAGED);
  expect(await page.evaluate(() => localStorage.getItem('life-dashboard:v1:damaged')), 'a separate copy is kept').toBe(DAMAGED);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => localStorage.getItem('life-dashboard:v1')), 'still untouched after the save timer').toBe(DAMAGED);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /empty dashboard/i }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('records that are individually broken are dropped, the rest of the data survives', async ({ browser }) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('life-dashboard:v1', JSON.stringify({ version: 1, sample: false, onboarded: true, days: { '2026-10-01': { code: true }, 'not-a-date': { code: true }, '2026-10-02': 'junk' }, sessions: {}, body: [{ date: '2026-10-01', weight: 70 }, { date: 'x', weight: 'heavy' }] }));
  });
  await page.goto(APP);
  await expect(page.getByText('Today’s plates')).toBeVisible();
  await page.waitForTimeout(500);
  const d = await stored(page);
  expect(Object.keys(d.days)).not.toContain('not-a-date');
  expect(d.days['2026-10-01']).toEqual({ code: true });
  expect(d.days['2026-10-02'] ?? {}, 'a day that is not an object keeps no flags').toEqual({});
  expect(d.body).toHaveLength(1);
});

test('a full or blocked disk shows a warning and clears once saving works again', async ({ browser }) => {
  const { page, errors } = await newDevice(browser);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).__full && k.startsWith('life-dashboard:v1')) throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, k, v);
    };
  });
  await page.reload();
  await page.getByRole('button', { name: /sample data/i }).click();
  await expect(page.locator('.banner.warn')).toHaveCount(0);
  await page.evaluate(() => ((window as unknown as { __full: boolean }).__full = true));
  await page.locator('button[aria-pressed]').last().click();
  await expect(page.locator('.banner.warn')).toBeVisible();
  await expect(page.locator('.banner.warn')).toContainText('couldn’t be saved on this device');
  await page.evaluate(() => ((window as unknown as { __full: boolean }).__full = false));
  await page.locator('button[aria-pressed]').last().click();
  await expect(page.locator('.banner.warn')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a crash inside one screen leaves the rest of the app usable', async ({ browser }) => {
  const { page } = await newDevice(browser);
  await page.getByRole('button', { name: /sample data/i }).click();
  await page.getByRole('button', { name: 'Today' }).first().click();
  await page.evaluate(() => {
    const original = Date.prototype.toLocaleDateString;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Date.prototype.toLocaleDateString = function (...a: any[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).__boom) throw new Error('boom');
      return (original as any).apply(this, a);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__boom = true;
  });
  await page.getByRole('button', { name: 'Month' }).first().click();
  await expect(page.locator('.crash')).toHaveCount(1);
  await expect(page.locator('.nav-btn').first()).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __boom: boolean }).__boom = false));
  await page.getByRole('button', { name: 'Train' }).first().click();
  await expect(page.locator('.crash')).toHaveCount(0);
});

test('two tabs of the same browser stay in step', async ({ browser }) => {
  const ctx = await newContext(browser);
  const a = await ctx.newPage();
  await a.goto(APP);
  await setUpEmptyDashboard(a);
  const b = await ctx.newPage();
  await b.goto(APP);
  await expect(b.getByText('Today’s plates')).toBeVisible();
  await b.getByRole('button', { name: '4', exact: true }).first().click();
  await expect.poll(async () => Object.values((await stored(a)).days).some((x) => (x as { energy?: number }).energy === 4), { timeout: 8000 }).toBe(true);
  // the first tab must not overwrite the second tab's entry when it saves
  await a.locator('button[aria-pressed]', { hasText: 'Mark done' }).first().click();
  await a.waitForTimeout(800);
  const merged = Object.values((await stored(b)).days) as { energy?: number }[];
  expect(merged.some((x) => x.energy === 4)).toBe(true);
});
