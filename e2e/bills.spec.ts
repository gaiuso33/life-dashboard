import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DESKTOP, PHONE, expectNoA11yViolations, newDevice, setUpEmptyDashboard, stored } from './helpers';

// Ticking a bill or an income item on the Month calendar records it in Money. The tests run on the fixed clock, Friday 9 Oct 2026.

interface Txn { id: string; date: string; kind: string; amount: number; category?: string; fund?: string; note: string }
// The app saves a moment after each change (see store.tsx), so give it that moment before reading what is stored.
const txns = async (p: Page) => {
  await p.waitForTimeout(500);
  return (await stored(p)).money.txns as Txn[];
};
const row = (p: Page, title: string) => p.locator('.plan-list li', { hasText: title });
const panel = (p: Page) => p.locator('.plan-confirm');
// Ticking a bill or income item opens a question instead of changing the box, so those ticks are clicks (Playwright's check() would wait for the box to change).

async function openMonth(page: Page) {
  await setUpEmptyDashboard(page);
  await page.getByRole('button', { name: 'Month', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Add to this day' }).waitFor();
}
async function addItem(page: Page, kind: 'Bill' | 'Income' | 'Task', title: string, amount = '', monthly = false) {
  await page.getByRole('radio', { name: kind, exact: true }).click();
  await page.getByLabel('What').fill(title);
  if (amount) await page.getByLabel(/^Amount/).fill(amount);
  if (monthly) await page.getByLabel('Repeat every month on this date').check();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await row(page, title).waitFor();
}

test.describe('bills and income on the Month calendar', () => {
  test('ticking a bill offers to record it, prefilled, and one tap puts it in Money', async ({ browser }) => {
    const { ctx, page, errors } = await newDevice(browser, DESKTOP);
    await openMonth(page);
    await addItem(page, 'Bill', 'Rent', '3500');
    await row(page, 'Rent').getByRole('checkbox').click();

    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByLabel(/^Amount paid/)).toHaveValue('3500');
    await expect(panel(page).getByLabel('Date')).toHaveValue('2026-10-09');
    await expect(panel(page).getByLabel('Category')).toHaveValue('Other');
    await expectNoA11yViolations(page, 'record a bill');
    await panel(page).getByLabel('Category').selectOption('Housing');
    await panel(page).getByRole('button', { name: 'Record and tick' }).click();

    await expect(panel(page)).toHaveCount(0);
    await expect(row(page, 'Rent').getByRole('checkbox')).toBeChecked();
    await expect(row(page, 'Rent')).toContainText('recorded in Money');
    const t = await txns(page);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: 'expense', amount: 3500, category: 'Housing', date: '2026-10-09', note: 'Rent' });
    expect(t[0].id).toMatch(/^plan:/);

    // It shows up in Money like any other entry, and the month's "bills still due" no longer counts it.
    await page.getByRole('button', { name: 'Money', exact: true }).first().click();
    await expect(page.getByText('Rent', { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('unticking offers to take the entry back; ticking again records a new one', async ({ browser }) => {
    const { ctx, page, errors } = await newDevice(browser, DESKTOP);
    await openMonth(page);
    await addItem(page, 'Bill', 'Rent', '3500');
    await row(page, 'Rent').getByRole('checkbox').click();
    await panel(page).getByRole('button', { name: 'Record and tick' }).click();

    await row(page, 'Rent').getByRole('checkbox').click();
    await expect(panel(page)).toContainText('Also remove it from Money?');
    await expect(panel(page)).toContainText('spent');
    await expectNoA11yViolations(page, 'untick a recorded bill');
    await panel(page).getByRole('button', { name: 'Untick and remove' }).click();
    await expect(row(page, 'Rent').getByRole('checkbox')).not.toBeChecked();
    await expect(row(page, 'Rent')).not.toContainText('recorded in Money');
    expect(await txns(page)).toEqual([]);

    await row(page, 'Rent').getByRole('checkbox').click();
    await panel(page).getByRole('button', { name: 'Record and tick' }).click();
    const t = await txns(page);
    expect(t).toHaveLength(1);
    expect(t[0].id).toMatch(/:2$/);

    // "Untick, keep the entry" leaves Money alone.
    await row(page, 'Rent').getByRole('checkbox').click();
    await panel(page).getByRole('button', { name: 'Untick, keep the entry' }).click();
    await expect(row(page, 'Rent').getByRole('checkbox')).not.toBeChecked();
    expect(await txns(page)).toHaveLength(1);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('income can move the usual share into savings in the same tap', async ({ browser }) => {
    const { ctx, page, errors } = await newDevice(browser, DESKTOP);
    await openMonth(page);
    await addItem(page, 'Income', 'Salary', '50000');
    await row(page, 'Salary').getByRole('checkbox').click();
    await expect(panel(page).getByLabel(/^Amount received/)).toHaveValue('50000');
    await expect(panel(page).getByLabel('Category')).toHaveCount(0);
    const split = panel(page).getByRole('checkbox', { name: /Also move 20%/ });
    await expect(split).toBeChecked();
    await panel(page).getByRole('button', { name: 'Record and tick' }).click();
    const t = await txns(page);
    expect(t.map((x) => [x.kind, x.amount, x.fund ?? null]).sort()).toEqual([['income', 50000, null], ['saving', 10000, 'survival']]);

    await row(page, 'Salary').getByRole('checkbox').click();
    await expect(panel(page)).toContainText('received');
    await expect(panel(page)).toContainText('saved');
    await panel(page).getByRole('button', { name: 'Untick and remove' }).click();
    expect(await txns(page)).toEqual([]);

    // Without the split box ticked, only the income is recorded.
    await row(page, 'Salary').getByRole('checkbox').click();
    await panel(page).getByRole('checkbox', { name: /Also move/ }).uncheck();
    await panel(page).getByRole('button', { name: 'Record and tick' }).click();
    expect((await txns(page)).map((x) => x.kind)).toEqual(['income']);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('"Just tick", Cancel, Escape, and items with nothing to record behave', async ({ browser }) => {
    const { ctx, page, errors } = await newDevice(browser, DESKTOP);
    await openMonth(page);
    await addItem(page, 'Bill', 'Data subscription', '1500');
    await addItem(page, 'Bill', 'Surprise bill'); // no amount
    await addItem(page, 'Task', 'Finish login page');

    // Cancel leaves it unticked.
    await row(page, 'Data subscription').getByRole('checkbox').click();
    await panel(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(row(page, 'Data subscription').getByRole('checkbox')).not.toBeChecked();

    // So does Escape.
    await row(page, 'Data subscription').getByRole('checkbox').click();
    await panel(page).getByLabel(/^Amount paid/).press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(row(page, 'Data subscription').getByRole('checkbox')).not.toBeChecked();

    // "Just tick" ticks without recording anything.
    await row(page, 'Data subscription').getByRole('checkbox').click();
    await panel(page).getByRole('button', { name: 'Just tick' }).click();
    await expect(row(page, 'Data subscription').getByRole('checkbox')).toBeChecked();
    await expect(row(page, 'Data subscription')).not.toContainText('recorded in Money');
    await row(page, 'Data subscription').getByRole('checkbox').click();
    await expect(panel(page)).toHaveCount(0); // nothing to take back, so no question

    // A bill with no amount, and a task, tick straight away.
    await row(page, 'Surprise bill').getByRole('checkbox').check();
    await row(page, 'Finish login page').getByRole('checkbox').check();
    await expect(panel(page)).toHaveCount(0);
    await expect(row(page, 'Surprise bill').getByRole('checkbox')).toBeChecked();
    await expect(row(page, 'Finish login page').getByRole('checkbox')).toBeChecked();

    // The form will not record zero, or a date in the future.
    await row(page, 'Data subscription').getByRole('checkbox').click();
    await panel(page).getByLabel(/^Amount paid/).fill('0');
    await expect(panel(page).getByRole('button', { name: 'Record and tick' })).toBeDisabled();
    await panel(page).getByLabel(/^Amount paid/).fill('1500');
    await panel(page).getByLabel('Date').fill('2026-10-20');
    await expect(panel(page).getByRole('button', { name: 'Record and tick' })).toBeDisabled();
    await panel(page).getByLabel('Date').fill('2026-10-07');
    await panel(page).getByRole('button', { name: 'Record and tick' }).click();
    expect(await txns(page)).toMatchObject([{ amount: 1500, date: '2026-10-07' }]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('a monthly bill is recorded separately each month, and a future one is dated today', async ({ browser }) => {
    const { ctx, page, errors } = await newDevice(browser, DESKTOP);
    await openMonth(page);
    await addItem(page, 'Bill', 'Rent', '3500', true);
    await row(page, 'Rent').getByRole('checkbox').click();
    await panel(page).getByRole('button', { name: 'Record and tick' }).click();

    await page.getByRole('button', { name: 'Next month' }).click();
    await page.locator('.cal-d[aria-label*=" 9 November"]').click();
    await expect(row(page, 'Rent').getByRole('checkbox')).not.toBeChecked();
    await expect(row(page, 'Rent')).not.toContainText('recorded in Money');
    await row(page, 'Rent').getByRole('checkbox').click();
    await expect(panel(page).getByLabel('Date')).toHaveValue('2026-10-09'); // not in the future
    await panel(page).getByRole('button', { name: 'Record and tick' }).click();

    const t = await txns(page);
    expect(t).toHaveLength(2);
    expect(new Set(t.map((x) => x.id)).size).toBe(2);
    expect(t.map((x) => x.id).sort()).toEqual(['plan:' + (await stored(page)).plans[0].id + ':2026-10-09', 'plan:' + (await stored(page)).plans[0].id + ':2026-11-09'].sort());
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('on a phone the form fits the screen', async ({ browser }) => {
    const { ctx, page, errors } = await newDevice(browser, PHONE);
    await openMonth(page);
    await addItem(page, 'Income', 'Salary', '50000');
    await row(page, 'Salary').getByRole('checkbox').click();
    await expect(panel(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll').toBe(true);
    const box = await panel(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width + 1);
    await expectNoA11yViolations(page, 'record income on a phone');
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
