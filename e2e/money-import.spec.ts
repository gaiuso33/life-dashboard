import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'path';
import { expectNoA11yViolations, newDevice, PHONE, setUpEmptyDashboard, stored } from './helpers';

const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name);
const openImport = async (page: Page) => {
  await page.getByRole('button', { name: 'Money', exact: true }).first().click();
  await page.getByRole('button', { name: 'Import a statement' }).click();
  await expect(page.getByRole('dialog', { name: 'Import a statement' })).toBeVisible();
};
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Import a statement' });

test('a statement goes from file to entries, step by step', async ({ browser }) => {
  const { page, errors } = await newDevice(browser);
  await setUpEmptyDashboard(page);
  await openImport(page);
  await expectNoA11yViolations(page, 'import: choose file');

  await dialog(page).locator('input[type=file]').setInputFiles(fixture('bank-a.csv'));
  // the account details above the header are skipped and the columns are guessed
  await expect(dialog(page).getByLabel('Date column')).toHaveText(/Trans\. Date/);
  await expect(dialog(page).getByLabel('Description column')).toHaveValue('2');
  await expect(dialog(page).getByLabel('Money out (debit) column')).toHaveValue('3');
  await expect(dialog(page).getByLabel('Money in (credit) column')).toHaveValue('4');
  await expect(dialog(page).getByRole('status')).toContainText('4 of 5 rows can be read');
  await expectNoA11yViolations(page, 'import: map columns');

  await dialog(page).getByRole('button', { name: 'Review entries' }).click();
  await expect(dialog(page).getByRole('status')).toContainText('4 new entries');
  await expect(dialog(page).getByRole('status')).toContainText('Spent ₦16,701');
  await expect(dialog(page).getByRole('status')).toContainText('Received ₦50,000');
  const rows = dialog(page).locator('table.review tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('SHOPRITE');
  await expect(rows.nth(0).getByLabel(/Category for/)).toHaveValue('Food');
  await expect(rows.nth(2).getByLabel(/Category for/)).toHaveValue('Transport');
  await expectNoA11yViolations(page, 'import: review');

  // change one entry before importing: the airtime top-up is not something to count
  await rows.nth(3).getByLabel(/Type for/).selectOption('skip');
  await expect(dialog(page).getByRole('status')).toContainText('3 new entries');
  await expect(dialog(page).getByRole('status')).toContainText('1 marked “Don’t import”');
  await rows.nth(0).getByLabel(/Category for/).selectOption('Other');
  await dialog(page).getByRole('button', { name: 'Import 3 entries' }).click();
  await expect(dialog(page).getByRole('status')).toContainText('Imported 3 entries');
  await expectNoA11yViolations(page, 'import: done');
  await dialog(page).getByRole('button', { name: 'Done' }).click();

  await page.waitForTimeout(500);
  const txns = (await stored(page)).money.txns as { id: string; date: string; kind: string; amount: number; category?: string; note: string }[];
  expect(txns).toHaveLength(3);
  expect(txns.map((t) => [t.date, t.kind, t.amount, t.category ?? null]).sort()).toEqual([
    ['2026-09-01', 'expense', 12500, 'Other'],
    ['2026-09-02', 'income', 50000, null],
    ['2026-09-03', 'expense', 3201, 'Transport'],
  ]);
  expect(txns.every((t) => t.id.startsWith('imp-'))).toBe(true);
  // the history is visible on the Money screen
  await expect(page.locator('.txns')).toContainText('SHOPRITE');

  // the same statement again adds nothing
  await openImport(page);
  await dialog(page).locator('input[type=file]').setInputFiles(fixture('bank-a.csv'));
  await dialog(page).getByRole('button', { name: 'Review entries' }).click();
  // the three imported entries are recognised; the one marked "Don't import" last time is offered again
  await expect(dialog(page).getByRole('status')).toContainText('1 new entry');
  await expect(dialog(page).getByRole('status')).toContainText('3 already imported before');
  await dialog(page).locator('table.review tbody tr').nth(3).getByLabel(/Type for/).selectOption('skip');
  await expect(dialog(page).getByRole('status')).toContainText('0 new entries');
  await expect(dialog(page).getByRole('button', { name: /^Import 0/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  // an entry removed from the list stays removed if the statement is imported again
  await page.getByRole('button', { name: /^Remove .*of ₦3,201/ }).click();
  await openImport(page);
  await dialog(page).locator('input[type=file]').setInputFiles(fixture('bank-a.csv'));
  await dialog(page).getByRole('button', { name: 'Review entries' }).click();
  await expect(dialog(page).getByRole('status')).toContainText('1 you removed earlier stay removed');
  expect(errors).toEqual([]);
});

test('a wallet layout with its own column names, savings handled, pasted instead of uploaded', async ({ browser }) => {
  const { page } = await newDevice(browser);
  await setUpEmptyDashboard(page);
  await openImport(page);
  const fs = await import('fs');
  await dialog(page).getByLabel('Or paste the rows here').fill(fs.readFileSync(fixture('wallet-c.csv'), 'utf8'));
  await dialog(page).getByRole('button', { name: 'Use pasted rows' }).click();
  await expect(dialog(page).getByLabel('Money out (debit) column')).toHaveText(/Debit/);
  await dialog(page).getByRole('button', { name: 'Review entries' }).click();
  const rows = dialog(page).locator('table.review tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1).getByLabel(/Type for/)).toHaveValue('saving');
  await dialog(page).getByRole('button', { name: 'Import 3 entries' }).click();
  await dialog(page).getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(500);
  const txns = (await stored(page)).money.txns as { kind: string; fund?: string }[];
  expect(txns.map((t) => t.kind).sort()).toEqual(['expense', 'income', 'saving']);
  expect(txns.find((t) => t.kind === 'saving')?.fund).toBe('survival');
});

test('wrong columns are caught, not guessed; unusable files are explained', async ({ browser }) => {
  const { page } = await newDevice(browser);
  await setUpEmptyDashboard(page);
  await openImport(page);
  await dialog(page).locator('input[type=file]').setInputFiles({ name: 'statement.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await expect(dialog(page).getByRole('alert')).toContainText('needs a CSV file');
  await dialog(page).locator('input[type=file]').setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('just one line') });
  await expect(dialog(page).getByRole('alert')).toContainText('doesn’t look like a statement');

  await dialog(page).locator('input[type=file]').setInputFiles(fixture('bank-a.csv'));
  await dialog(page).getByLabel('Date column').selectOption({ label: 'Description' });
  await expect(dialog(page).getByRole('status')).toContainText('0 of 5 rows can be read');
  await expect(dialog(page).getByRole('button', { name: 'Review entries' })).toBeDisabled();
  await dialog(page).getByLabel('Date column').selectOption('-1');
  await expect(dialog(page).getByRole('alert')).toContainText('Choose the column that holds the date');
});

test('fits a phone: the table scrolls inside the dialog, not the page', async ({ browser }) => {
  const { page } = await newDevice(browser, PHONE);
  await setUpEmptyDashboard(page);
  await openImport(page);
  await dialog(page).locator('input[type=file]').setInputFiles(fixture('bank-a.csv'));
  await expect(dialog(page).getByLabel('Date column')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expectNoA11yViolations(page, 'import map (phone)');
  await dialog(page).getByRole('button', { name: 'Review entries' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expectNoA11yViolations(page, 'import review (phone)');
});
