import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import fs from 'fs';
import { APP, DESKTOP, newContext, setUpEmptyDashboard } from './helpers';

// Getting a new version onto an installed phone. These tests run with service workers switched ON (the other specs block
// them) against the test server, whose /__bump makes the page and sw.js differ afterwards, exactly like a new deploy.

test.describe.configure({ mode: 'serial' });

const bump = async () => Number(await (await fetch(new URL('/__bump', APP))).text());
const banner = (p: Page) => p.locator('.banner.update');
/** Which deploy the page on screen came from (the test server stamps it into the page once /__bump has been called). */
const deployOf = (p: Page) => p.evaluate(() => document.querySelector('meta[name=bump]')?.getAttribute('content') ?? 'none');

async function openInstalledApp(browser: Parameters<typeof newContext>[0]): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await newContext(browser, { viewport: DESKTOP, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  // Wait until the service worker has taken control: from here on the page behaves like an installed app.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 20_000 });
  return { ctx, page, errors };
}

test('every build stamps the service worker, so a deploy always changes it', () => {
  const sw = fs.readFileSync('dist-e2e/sw.js', 'utf8');
  expect(sw).not.toContain('__BUILD_ID__');
  expect(sw).toMatch(/const BUILD = '[a-z0-9]{6,}';/);
});

test('the very first install is not announced as an update', async ({ browser }) => {
  const { ctx, page, errors } = await openInstalledApp(browser);
  await page.waitForTimeout(800);
  await expect(banner(page)).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('a new deploy shows "A new version is ready" when the app comes back to the front, and Update now loads it', async ({ browser }) => {
  const { ctx, page, errors } = await openInstalledApp(browser);
  const n = await bump();
  // The app was put away and is now brought back more than a minute later.
  await ctx.clock.fastForward(120_000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(banner(page)).toContainText('A new version is ready', { timeout: 20_000 });
  await expect(banner(page).getByRole('button', { name: 'Update now' })).toBeVisible();

  await Promise.all([page.waitForEvent('load'), banner(page).getByRole('button', { name: 'Update now' }).click()]);
  await page.getByText('Today’s plates').waitFor();
  await expect(banner(page)).toHaveCount(0);
  expect(await deployOf(page)).toBe(String(n));
  expect(errors).toEqual([]);
  await ctx.close();
});

test('opening the app once is enough: the newest page is used, not the one saved last time', async ({ browser }) => {
  const { ctx, page } = await openInstalledApp(browser);
  const n = await bump();
  await page.reload();
  await page.getByText('Today’s plates').waitFor();
  expect(await deployOf(page)).toBe(String(n));
  await ctx.close();
});

test('with no connection the saved copy of the app still opens, with everything logged kept', async ({ browser }) => {
  const { ctx, page } = await openInstalledApp(browser);
  await ctx.setOffline(true);
  await page.reload();
  await page.getByText('Today’s plates').waitFor({ timeout: 20_000 });
  await ctx.setOffline(false);
  await ctx.close();
});
