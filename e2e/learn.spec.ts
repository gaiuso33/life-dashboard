import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'path';
import { expectNoA11yViolations, newDevice, setUpEmptyDashboard, stored } from './helpers';

const goMoney = (page: Page) => page.getByRole('button', { name: 'Money', exact: true }).first().click();
const goSettings = (page: Page) => page.getByRole('button', { name: 'Settings' }).last().click();
const spend = async (page: Page, amount: string, note: string, category: string) => {
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('radio', { name: category, exact: true }).click();
  await page.getByLabel('Note (optional)').fill(note);
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'logged' })).toBeVisible();
};
const checked = (page: Page, category: string) => page.getByRole('radio', { name: category, exact: true });

test('a category you choose is remembered, can be seen in Settings and forgotten', async ({ browser }) => {
  const { page, errors } = await newDevice(browser);
  await setUpEmptyDashboard(page);
  await goMoney(page);

  await spend(page, '1500', 'Zzx Express', 'Transport');
  // the same place, written differently, comes up with the category already chosen
  await page.getByLabel('Amount', { exact: true }).fill('900');
  await page.getByLabel('Note (optional)').fill('ZZX EXPRESS 004821');
  await page.getByLabel('Note (optional)').blur();
  await expect(checked(page, 'Transport')).toHaveAttribute('aria-checked', 'true');

  await goSettings(page);
  const panel = page.getByRole('region', { name: 'Categories the app has learned' });
  await expect(panel).toContainText('zzx express');
  await expect(panel).toContainText('Transport');
  await expect(panel).toContainText('The advisor never sees it');
  await expectNoA11yViolations(page, 'settings: learned categories');

  // forget it: it disappears, the earlier entry keeps its category, and the next entry is no longer pre-filled
  await panel.getByRole('button', { name: 'Forget zzx express' }).click();
  await expect(panel).toContainText('Nothing yet');
  await page.waitForTimeout(500);
  const data = await stored(page);
  expect(data.money.learned).toEqual({});
  expect(data.money.txns[0]).toMatchObject({ note: 'Zzx Express', category: 'Transport' });

  await goMoney(page);
  await page.getByLabel('Note (optional)').fill('Zzx Express');
  await page.getByLabel('Note (optional)').blur();
  await expect(checked(page, 'Transport')).toHaveAttribute('aria-checked', 'false');

  // and it stays forgotten after a reload, even though the old entry is still there
  await page.reload();
  await goSettings(page);
  await expect(page.getByRole('region', { name: 'Categories the app has learned' })).toContainText('Nothing yet');
  expect(errors).toEqual([]);
});

test('a statement import uses what you chose, and learns what you change', async ({ browser }) => {
  const { page, errors } = await newDevice(browser);
  await setUpEmptyDashboard(page);
  await goMoney(page);
  // the built-in guess for Shoprite is Food; this person files it under Personal care
  await spend(page, '2000', 'Shoprite, Ikeja', 'Personal care');

  await page.getByRole('button', { name: 'Import a statement' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a statement' });
  await dialog.locator('input[type=file]').setInputFiles(path.join(import.meta.dirname, 'fixtures', 'bank-a.csv'));
  await dialog.getByRole('button', { name: 'Review entries' }).click();
  const rows = dialog.locator('table.review tbody tr');
  await expect(rows.nth(0).getByLabel(/Category for/)).toHaveValue('Personal care'); // learned beats the built-in guess
  await expect(rows.nth(2).getByLabel(/Category for/)).toHaveValue('Transport'); // nothing learned: built-in guess

  await rows.nth(2).getByLabel(/Category for/).selectOption('Entertainment');
  await dialog.getByRole('button', { name: 'Import 4 entries' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(500);
  const learned = (await stored(page)).money.learned as Record<string, string>;
  expect(learned['uber trip']).toBe('Entertainment'); // changed in the preview: learned
  expect(learned['shoprite ikeja']).toBe('Personal care');
  expect(Object.keys(learned)).not.toContain('mtn airtime'); // left alone: not mistaken for a choice
  expect(errors).toEqual([]);
});

test('the savings forecast leaves out a one-off, says what it used and shows how past forecasts held up', async ({ browser }) => {
  const { ctx, page, errors } = await newDevice(browser);
  await setUpEmptyDashboard(page);
  // seven whole months of history before the app's fixed "today" (9 Oct 2026), with one huge payment and a big saving from it in June
  const d = await stored(page);
  const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  let n = 0;
  const t = (kind: string, ym: string, amount: number, day: number, extra: object = {}) => ({ id: `seed${n++}`, date: `${ym}-${String(day).padStart(2, '0')}`, kind, amount, note: '', ...extra });
  const txns = months.flatMap((m, i) => [t('income', m, 100000, i === 0 ? 2 : 3), t('income', m, 20000, 20), t('expense', m, 75000, 8, { category: 'Food' }), t('expense', m, 75000, 12, { category: 'Housing' }), t('saving', m, 20000, 15, { fund: 'survival' })]);
  txns.push(t('income', '2026-06', 2000000, 21), t('saving', '2026-06', 400000, 22, { fund: 'survival' }));
  d.money.txns = txns;
  d.onboarded = true; // "Start empty" leaves this off until the next visit, which would show the welcome page
  d.modified = '2026-10-09T09:00:00.000Z';
  // The page saves its own state as it unloads, so the history is put in place as the next page starts instead.
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['life-dashboard:v1', JSON.stringify(d)]);
  await page.reload();
  await page.getByRole('button', { name: 'Advisor', exact: true }).first().click();
  const card = page.locator('.forecasts li', { hasText: 'Survival fund' });
  await expect(card).toContainText('saving about ₦20,000 a month over the last 6 full months');
  await expect(card).toContainText('Left out a one-off income of ₦2,000,000');
  await expect(card).toContainText('a one-off saving of ₦400,000');
  await expect(card).toContainText('next two months');
  await expectNoA11yViolations(page, 'advisor: savings forecast');
  expect(errors).toEqual([]);
});
