import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { APP, CLOUD_APP, DESKTOP, MOCK, PHONE, expectNoA11yViolations, newContext, setUpEmptyDashboard } from './helpers';

// The Settings screen's push notification controls. A headless browser cannot create a real push subscription (that needs the
// browser vendor's push service), so these tests cover every state a person can reach and the failures that can happen on the
// way. What the server sends, and when, is covered by the unit tests in src/__tests__/push.test.ts.

const goToReminders = async (p: Page) => {
  await p.getByRole('button', { name: 'Settings' }).last().click();
  await p.getByRole('heading', { name: 'Reminders' }).waitFor();
};

test.describe('push notifications in Settings', () => {
  test('a copy of the app without push set up says so, and the calendar file still works', async ({ browser }) => {
    const ctx = await newContext(browser, { viewport: DESKTOP });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(APP);
    await setUpEmptyDashboard(page);
    await goToReminders(page);
    const box = page.locator('.push-box');
    await expect(box.getByRole('heading', { name: 'Push notifications' })).toBeVisible();
    await expect(box).toContainText('aren’t set up on this copy');
    await expect(box.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Calendar file' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download calendar file' })).toBeEnabled();
    await expectNoA11yViolations(page, 'reminders without push set up');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('the demo says push is not available there', async ({ browser }) => {
    const ctx = await newContext(browser, { viewport: DESKTOP });
    const page = await ctx.newPage();
    await page.goto(APP + '?demo');
    await goToReminders(page);
    await expect(page.locator('.push-box')).toContainText('aren’t available in the demo');
    await expect(page.locator('.push-box').getByRole('button')).toHaveCount(0);
    await ctx.close();
  });

  test.describe('with push set up and an account', () => {
    test.describe.configure({ mode: 'serial' });
    const EMAIL = 'push@example.com';
    const PASSWORD = 'correct-password';
    const PASSPHRASE = 'purple-elephant-42';

    test.beforeAll(async () => {
      await fetch(`${MOCK}/__admin/reset`, { method: 'POST', body: '{}' });
    });

    test('signed out: asks the person to sign in, and the button opens the sign-in dialog', async ({ browser }) => {
      const ctx = await newContext(browser, { viewport: PHONE });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(CLOUD_APP);
      await setUpEmptyDashboard(page);
      await goToReminders(page);
      const box = page.locator('.push-box');
      await expect(box).toContainText('Nothing you have logged is ever sent');
      await expect(box.getByRole('button', { name: 'Turn on for this device' })).toHaveCount(0);
      await expectNoA11yViolations(page, 'reminders, push signed out');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone').toBe(true);
      await box.getByRole('button', { name: 'Sign in to turn on' }).click();
      await expect(page.locator('#sync-title')).toBeVisible();
      expect(errors).toEqual([]);
      await ctx.close();
    });

    test('signed in: can be turned on only while a reminder is switched on; a refused permission leaves it off', async ({ browser }) => {
      const ctx = await newContext(browser, { viewport: DESKTOP });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => void d.accept());
      await page.goto(CLOUD_APP);
      await setUpEmptyDashboard(page);

      // Make an account through the sync dialog.
      await page.getByRole('button', { name: 'Sync and backup' }).first().click();
      await page.getByRole('radio', { name: 'Create account' }).click();
      await page.getByLabel('Email').fill(EMAIL);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
      await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
      await page.getByLabel('Passphrase again').fill(PASSPHRASE);
      await page.getByRole('button', { name: /Encrypt and start/ }).click();
      await expect(page.locator('.modal .ok', { hasText: 'Synced' })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      await goToReminders(page);
      const box = page.locator('.push-box');
      const turnOn = box.getByRole('button', { name: 'Turn on for this device' });
      await expect(turnOn).toBeEnabled();
      await expectNoA11yViolations(page, 'reminders, push signed in');

      // With every reminder switched off there is nothing to send, so the button waits.
      for (const label of ['Daily check-in', 'Training day', 'Log spending', 'Weekly review']) {
        const box = page.getByRole('checkbox', { name: new RegExp(label) });
        if (await box.isChecked()) await box.uncheck();
      }
      await expect(turnOn).toBeDisabled();
      await page.getByRole('checkbox', { name: /Daily check-in/ }).check();
      await expect(turnOn).toBeEnabled();

      // The browser refuses permission: say so plainly and stay off.
      await turnOn.click();
      await expect(box.getByRole('status')).toContainText(/blocked|weren’t allowed/);
      await expect(box.getByRole('button', { name: 'Send a test' })).toHaveCount(0);
      await expect(turnOn).toBeEnabled();

      // Nothing was saved on the server for this account.
      const state = (await (await fetch(`${MOCK}/__admin/state`)).json()) as { log: string[] };
      expect(state.log.filter((l) => l.includes('push_subscriptions'))).toEqual([]);
      expect(errors).toEqual([]);
      await ctx.close();
    });

    test('signed in with permission but no working service worker: gives up with a message instead of hanging', async ({ browser }) => {
      test.setTimeout(60_000);
      const ctx = await newContext(browser, { viewport: DESKTOP });
      await ctx.grantPermissions(['notifications'], { origin: new URL(CLOUD_APP).origin });
      const page = await ctx.newPage();
      page.on('dialog', (d) => void d.accept());
      await page.goto(CLOUD_APP);
      await page.getByRole('button', { name: 'Sign in to my account' }).click();
      await page.getByLabel('Email').fill(EMAIL);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
      await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
      await page.getByRole('button', { name: 'Unlock' }).click();
      await page.getByText('Today’s plates').waitFor({ timeout: 20_000 });

      await goToReminders(page);
      const turnOn = page.locator('.push-box').getByRole('button', { name: 'Turn on for this device' });
      await turnOn.click();
      await expect(page.locator('.push-box').getByRole('status')).toContainText('couldn’t be set up', { timeout: 20_000 });
      await expect(turnOn).toBeEnabled();
      await ctx.close();
    });
  });
});
