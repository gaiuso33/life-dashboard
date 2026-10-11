import { expect, test } from '@playwright/test';
import { APP, DESKTOP, expectNoA11yViolations, newDevice, PHONE, setUpEmptyDashboard, stored } from './helpers';

const DEMO = APP + '?demo';
const NAV_TABS = ['Today', 'Month', 'Train', 'Money', 'Career', 'Rewards', 'Advisor', 'Today'];

test.describe('demo mode', () => {
  test('opens on sample data, never saves, and leaves real data untouched', async ({ browser }) => {
    const { page, errors } = await newDevice(browser);
    await setUpEmptyDashboard(page);
    await page.waitForTimeout(500);
    const real = await page.evaluate(() => localStorage.getItem('life-dashboard:v1'));
    expect(real).toBeTruthy();

    const hosts = new Set<string>();
    page.on('request', (r) => hosts.add(new URL(r.url()).host));
    await page.goto(DEMO + '&tour=0');
    await expect(page.getByText('Made-up data. Nothing is saved or uploaded')).toBeVisible();
    await expect(page.getByText('Today’s plates')).toBeVisible();

    // interact: log a habit and an energy score
    await page.getByRole('button', { name: '5', exact: true }).first().click();
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => localStorage.getItem('life-dashboard:v1')), 'real data not overwritten').toBe(real);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('life-dashboard:v1:') && !k.endsWith('cloud-last')))).toEqual([]);

    // no sync, no account, no AI key field, nothing leaves the page
    await expect(page.getByRole('button', { name: 'Sync and backup' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Advisor' }).first().click();
    await expect(page.getByLabel('Anthropic API key')).toHaveCount(0);
    await expect(page.getByText('switched off in the demo')).toBeVisible();
    // Nothing but the page itself: no fonts, sync, API or analytics requests.
    expect([...hosts].filter((h) => h !== 'localhost:4173')).toEqual([]);

    // reload resets it
    await page.reload();
    await page.getByRole('button', { name: 'Today' }).first().click();
    expect(await page.evaluate(() => localStorage.getItem('life-dashboard:v1'))).toBe(real);
    expect(errors).toEqual([]);
  });

  test('guided tour walks every area and ends with a way out', async ({ browser }) => {
    const { page, errors } = await newDevice(browser, DESKTOP, DEMO);
    const tour = page.getByRole('region', { name: 'Demo tour' });
    await expect(tour).toBeVisible();
    await expect(tour.getByText('1 of 8')).toBeVisible();
    for (let i = 0; i < NAV_TABS.length; i++) {
      await expect(tour.getByText(`${i + 1} of 8`)).toBeVisible();
      await expect(page.locator('.rail .nav-btn[aria-current="page"]')).toContainText(NAV_TABS[i]);
      if (i === 3) await expectNoA11yViolations(page, 'demo tour over Money');
      if (i < NAV_TABS.length - 1) await tour.getByRole('button', { name: 'Next' }).click();
    }
    await expect(tour.getByRole('button', { name: 'Start my own' })).toBeVisible();
    await tour.getByRole('button', { name: 'Back' }).click();
    await expect(tour.getByText('7 of 8')).toBeVisible();
    await tour.getByRole('button', { name: 'Next' }).click();
    await tour.getByRole('button', { name: 'Keep exploring' }).click();
    await expect(tour).toHaveCount(0);
    await page.getByRole('button', { name: 'Take the tour' }).click();
    await expect(page.getByRole('region', { name: 'Demo tour' }).getByText('1 of 8')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Demo tour' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('"Start my own" leaves the demo and shows the real first-run welcome', async ({ browser }) => {
    const { page } = await newDevice(browser, DESKTOP, DEMO + '&tour=0');
    await page.getByRole('button', { name: 'Start my own' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  });

  test('every tab is accessible and fits a phone, with the tour clear of the navigation', async ({ browser }) => {
    const { page, errors } = await newDevice(browser, PHONE, DEMO);
    const tour = page.getByRole('region', { name: 'Demo tour' });
    const nav = page.locator('.rail nav');
    const tb = (await tour.boundingBox())!;
    const nb = (await nav.boundingBox())!;
    expect(tb.y + tb.height, 'tour sits above the bottom navigation').toBeLessThanOrEqual(nb.y + 1);
    await page.getByRole('button', { name: 'Skip tour' }).click();
    for (const t of ['Today', 'Month', 'Train', 'Money', 'Career', 'Rewards', 'Advisor', 'Body']) {
      await page.getByRole('button', { name: t, exact: true }).first().click();
      await expect(page.locator('.rail .nav-btn[aria-current="page"]')).toContainText(t);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${t}: no horizontal scroll`).toBe(true);
      await expectNoA11yViolations(page, `demo ${t} (phone)`);
    }
    expect(errors).toEqual([]);
  });

  test('looks complete on every screen (screenshots attached)', async ({ browser }, testInfo) => {
    const { page } = await newDevice(browser, DESKTOP, DEMO + '&tour=0');
    for (const t of ['Today', 'Month', 'Train', 'Money', 'Career', 'Rewards', 'Advisor', 'Body']) {
      await page.getByRole('button', { name: t, exact: true }).first().click();
      await page.waitForTimeout(150);
      await testInfo.attach(`demo-${t}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
  });

  test('a normal visit is not affected: no demo banner, welcome shown', async ({ browser }) => {
    const { page } = await newDevice(browser);
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    await expect(page.getByText('Made-up data')).toHaveCount(0);
    expect(await stored(page)).toBeNull();
  });

  for (const path of ['demo', 'demo/']) {
    test(`has its own link: /${path}`, async ({ browser }) => {
      const { page, errors } = await newDevice(browser, DESKTOP, 'about:blank');
      const failed: string[] = [];
      page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
      await page.goto(APP + path);
      await expect(page.getByText('Made-up data. Nothing is saved or uploaded')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Demo tour' })).toBeVisible();
      // files the page points to are found at the app's real folder, not under /demo
      expect(new URL(page.url()).pathname, 'a trailing slash is tidied away').toBe('/demo');
      expect(await page.evaluate(() => (document.querySelector('link[rel=manifest]') as HTMLLinkElement).href)).toBe(APP + 'manifest.webmanifest');
      expect(await page.evaluate(() => (document.querySelector('link[rel=icon]') as HTMLLinkElement).href)).toBe(APP + 'icon-192.png');
      await page.getByRole('button', { name: 'Skip tour' }).click();
      expect(failed, 'no missing files').toEqual([]);
      // the same switches work on the short link
      await page.goto(APP + path + '?tour=0');
      await expect(page.getByRole('region', { name: 'Demo tour' })).toHaveCount(0);
      // leaving goes to the real app
      await page.getByRole('button', { name: 'Start my own' }).first().click();
      await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
      expect(page.url()).toBe(APP);
      expect(errors).toEqual([]);
    });
  }

  test('the demo link never touches real data stored by the main app', async ({ browser }) => {
    const { page } = await newDevice(browser);
    await setUpEmptyDashboard(page);
    await page.waitForTimeout(500);
    const real = await page.evaluate(() => localStorage.getItem('life-dashboard:v1'));
    await page.goto(APP + 'demo');
    await page.getByRole('button', { name: '5', exact: true }).first().click();
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => localStorage.getItem('life-dashboard:v1'))).toBe(real);
    await page.getByRole('button', { name: 'Start my own' }).first().click();
    await expect(page.getByText('Today’s plates')).toBeVisible();
  });
});
