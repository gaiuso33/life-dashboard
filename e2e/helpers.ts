import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
export const APP = 'http://localhost:4173/';
export const CLOUD_APP = 'http://localhost:4174/';
export const MOCK = 'http://localhost:4600';

/** Every test runs at the same moment (a Friday), so sample data, month names and weekdays never drift. */
export const FIXED_TIME = new Date('2026-10-09T10:00:00+01:00');

/** A fresh browser profile with Lagos time, a fixed starting clock (time still passes) and service workers off. */
export async function newContext(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Africa/Lagos', locale: 'en-GB', ...opts });
  await ctx.clock.install({ time: FIXED_TIME });
  return ctx;
}

export const DESKTOP = { width: 1280, height: 900 };
export const PHONE = { width: 390, height: 844 };

/** Opens a fresh, empty browser profile (its own storage) at the given size. Page errors are collected in `errors`. */
export async function newDevice(browser: Browser, viewport = DESKTOP, url = APP): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await newContext(browser, { viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  return { ctx, page, errors };
}

/** Runs the accessibility checker (WCAG 2 A and AA) and fails with the rule names and elements if anything is found. */
export async function expectNoA11yViolations(page: Page, label: string): Promise<void> {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.map((v: any) => `${v.id} (${v.impact}): ${v.nodes[0].target.join(' ')} — ${(v.nodes[0].failureSummary || '').split('\n')[1] ?? ''}`);
  });
  expect(violations, `accessibility on ${label}`).toEqual([]);
}

/** Walks the first-run wizard with its defaults and lands on an empty dashboard. */
export async function setUpEmptyDashboard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Set up my dashboard' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: 'Start empty' }).click();
  await page.getByRole('button', { name: 'Open my dashboard' }).click();
  await page.getByText('Today’s plates').waitFor();
}

export const stored = (page: Page, key = 'life-dashboard:v1') => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
export const TABS = ['Today', 'Month', 'Train', 'Money', 'Career', 'Rewards', 'Advisor', 'Body'] as const;
