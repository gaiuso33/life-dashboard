import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { APP, newContext, setUpEmptyDashboard, TABS } from './helpers';

// Phone-sized checks with touch: the smallest common phone, a typical one, and a phone on its side. This is an emulation in Chromium,
// so it catches layout and tap problems but cannot stand in for a real phone's keyboard, file picker or install prompt.
const SIZES = [
  { name: '320x568 small phone', width: 320, height: 568 },
  { name: '390x844 typical phone', width: 390, height: 844 },
  { name: '844x390 phone on its side', width: 844, height: 390 },
];

const settle = (p: Page) => p.waitForTimeout(300);
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** Names the elements poking out past the right edge, so a failure says what to fix. */
const pokingOut = (p: Page) =>
  p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 0.5 && !e.closest('.tabs'); })
      .slice(0, 8)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} right=${Math.round(e.getBoundingClientRect().right)} "${(e.textContent ?? '').trim().slice(0, 24)}"`);
  });
const offscreen = (p: Page, selector: string) =>
  p.evaluate((sel) => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > vw + 1); }).map((e) => e.textContent?.trim());
  }, selector);
/** Text boxes under 16px make iPhones zoom the page when they are focused. */
const zoomers = (p: Page) =>
  p.evaluate(() =>
    [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), select, textarea')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16)
      .map((e) => `${e.tagName} ${(e.getAttribute('aria-label') || e.id || e.textContent || '').trim().slice(0, 30)}`),
  );

for (const size of SIZES) {
  test(`${size.name}: every screen fits, the bottom bar is reachable, and no text box makes iPhones zoom`, async ({ browser }) => {
    const ctx = await newContext(browser, { viewport: { width: size.width, height: size.height }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(APP);
    await setUpEmptyDashboard(page);

    const wide = size.width >= 900;
    for (const t of TABS) {
      await page.getByRole('button', { name: t, exact: true }).first().tap();
      await settle(page);
      expect(await overflow(page), `${t}: sideways scroll by ${JSON.stringify(await pokingOut(page))}`).toBeLessThanOrEqual(0);
      expect(await zoomers(page), `${t}: small text boxes`).toEqual([]);
      if (!wide) expect(await offscreen(page, '.nav-btn'), `${t}: bottom bar buttons cut off`).toEqual([]);
    }
    await page.getByRole('button', { name: 'Settings' }).first().tap();
    await settle(page);
    expect(await overflow(page), `Settings: sideways scroll by ${JSON.stringify(await pokingOut(page))}`).toBeLessThanOrEqual(0);
    expect(await zoomers(page), 'Settings: small text boxes').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test(`${size.name}: importing a statement can be done with taps from start to finish`, async ({ browser }) => {
    const ctx = await newContext(browser, { viewport: { width: size.width, height: size.height }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(APP);
    await setUpEmptyDashboard(page);
    await page.getByRole('button', { name: 'Money', exact: true }).first().tap();
    await page.getByRole('button', { name: 'Import a statement' }).tap();
    expect(await zoomers(page), 'import: small text boxes').toEqual([]);

    await page.locator('.modal textarea').fill('Date,Description,Debit,Credit\n01/09/2026,POS SHOPRITE,12500,\n02/09/2026,TRANSFER FROM JOHN,,50000\n03/09/2026,UBER TRIP,3200,');
    await page.getByRole('button', { name: 'Use pasted rows' }).first().tap();
    await expect(page.getByText('Match the columns')).toBeVisible();
    expect(await zoomers(page), 'import map: small text boxes').toEqual([]);
    await page.getByRole('button', { name: 'Review entries' }).tap();
    await expect(page.getByText('3 new entries')).toBeVisible();
    expect(await overflow(page), 'import review: sideways scroll of the page').toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Import 3 entries' }).tap();
    await expect(page.getByText('Imported 3 entries')).toBeVisible();
    await ctx.close();
  });
}

// Different machines render the same font a little wider, and some phones fall back to a wider one. Spreading every letter apart stands in
// for that on any machine, so a row that only just fits is caught here instead of on someone's phone.
test('320x568 small phone: nothing is pushed off screen when text renders wider', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await page.addStyleTag({ content: '* { letter-spacing: 0.06em !important; }' });
  for (const t of [...TABS, 'Settings']) {
    await page.getByRole('button', { name: t, exact: true }).first().tap();
    await settle(page);
    expect(await overflow(page), `${t}: sideways scroll with wider text`).toBeLessThanOrEqual(0);
    expect(await offscreen(page, '.nav-btn'), `${t}: bottom bar buttons cut off with wider text`).toEqual([]);
  }
  await ctx.close();
});

test('install: the button appears when the browser offers it, asks the browser to install, and explains itself when it does not', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await page.getByRole('button', { name: 'Settings' }).first().tap();
  const panel = page.locator('#install');
  await expect(panel).toContainText('hasn’t offered an install button'); // no offer yet: it tells the person what to do instead
  expect(await panel.getByRole('button', { name: 'Install app' }).count()).toBe(0);

  // A stand-in for what Chrome sends when the app can be installed.
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    (window as unknown as { __prompted: number }).__prompted = 0;
    e.prompt = async () => void ((window as unknown as { __prompted: number }).__prompted += 1);
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await expect(panel.getByRole('button', { name: 'Install app' })).toBeVisible();
  await panel.getByRole('button', { name: 'Install app' }).tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
  await expect(panel).toContainText('Already installed');
  await ctx.close();
});

test('install: an iPhone is told to use Safari and Add to Home Screen', async ({ browser }) => {
  const ctx = await newContext(browser, {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await page.getByRole('button', { name: 'Settings' }).first().tap();
  await expect(page.locator('#install')).toContainText('Add to Home Screen');
  await ctx.close();
});
