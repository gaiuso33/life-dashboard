import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
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

  test('each reminder row says when it will next arrive, and follows the times and the programme', async ({ browser }) => {
    // The clock is fixed at Friday 9 Oct 2026, 10:00 in Lagos. The default programme trains on Monday, Wednesday and Friday.
    const ctx = await newContext(browser, { viewport: DESKTOP });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(APP);
    await setUpEmptyDashboard(page);
    await goToReminders(page);
    const rowOf = (label: string) => page.locator('#reminders .rem-row', { hasText: label });

    await expect(rowOf('Daily check-in')).toContainText('Next: today 21:00');
    await expect(rowOf('Training day')).toContainText('Next: today 17:30');
    await expect(rowOf('Weekly review')).toContainText('Next: Sunday 19:00');
    await expect(rowOf('Log spending')).not.toContainText('Next:'); // switched off by default

    // A time that has already passed today moves to the next gym day, which is what someone testing on a rest day needs to see.
    await page.getByLabel('Training day time').fill('09:00');
    await expect(rowOf('Training day')).toContainText('Next: Monday 09:00');
    await page.getByLabel('Daily check-in time').fill('09:00');
    await expect(rowOf('Daily check-in')).toContainText('Next: tomorrow (Saturday) 09:00');

    await page.getByRole('checkbox', { name: /Log spending/ }).check();
    await expect(rowOf('Log spending')).toContainText('Next: today 20:00');
    await page.getByRole('checkbox', { name: /Training day/ }).uncheck();
    await expect(rowOf('Training day')).not.toContainText('Next:');
    await expectNoA11yViolations(page, 'reminders with next times');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test.describe('with push set up and an account', () => {
    test.describe.configure({ mode: 'serial' });
    const EMAIL = `push-${Date.now()}@example.com`; // unique per run: the mock server is shared with other specs
    const PASSWORD = 'correct-password';
    const PASSPHRASE = 'purple-elephant-42';


    /** A fresh browser signed in to the shared test account, on the Reminders screen. */
    const openRemindersSignedIn = async (browser: Browser) => {
      const ctx = await newContext(browser, { viewport: DESKTOP });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
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
      return { ctx, page, errors };
    };
    const seedDevice = (endpoint: string, extra: Record<string, unknown> = {}) =>
      fetch(`${MOCK}/__admin/push`, {
        method: 'POST',
        body: JSON.stringify({
          email: EMAIL,
          row: { endpoint, tz: 'Africa/Lagos', p256dh: 'k', auth: 'a', schedule: [{ id: 'checkin', time: '21:00', days: [], title: 'Time to check in', body: 'Tick your plates.' }], ...extra },
        }),
      });
    const clearDevices = async () => {
      // Devices belong to the shared mock server, so each test removes the ones it added.
      const state = (await (await fetch(`${MOCK}/__admin/state`)).json()) as { push?: { endpoint: string }[] };
      for (const d of state.push ?? []) await fetch(`${MOCK}/__admin/push`, { method: 'DELETE', body: JSON.stringify({ endpoint: d.endpoint }) });
    };

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

    test('"Check what the server has" lists every device on the account with its times, days and next send', async ({ browser }) => {
      test.setTimeout(60_000);
      const ctx = await newContext(browser, { viewport: PHONE });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
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

      const box = page.locator('.push-box');
      const check = box.getByRole('button', { name: 'Check what the server has' });
      const view = box.getByRole('region', { name: 'What the server has' });

      // Nothing saved yet.
      await check.click();
      await expect(view).toContainText('no devices saved for this account');

      // Two devices appear on the account, as if turned on from a phone and a laptop.
      const schedule = [
        { id: 'checkin', time: '21:00', days: [], title: 'Time to check in', body: 'Tick your plates and rate your energy for today.' },
        { id: 'training', time: '17:30', days: [1, 3, 5], title: 'Training day', body: 'Open your programme and log your sets.' },
      ];
      const seed = (endpoint: string, tz: string, extra = {}) =>
        fetch(`${MOCK}/__admin/push`, { method: 'POST', body: JSON.stringify({ email: EMAIL, row: { endpoint, tz, p256dh: 'k', auth: 'a', schedule, ...extra } }) });
      await seed('https://fcm.googleapis.com/fcm/send/' + 'a'.repeat(30), 'Africa/Lagos', { last_sent: { checkin: '2026-10-09' } });
      await seed('https://web.push.apple.com/' + 'b'.repeat(30), 'Europe/London');
      await check.click();
      await expect(view).toContainText('None of these is the device you are using');
      await expect(view.locator('.server-dev')).toHaveCount(2);
      const first = view.locator('.server-dev').first();
      await expect(first).toContainText('Another device');
      await expect(first).toContainText('Chrome or Android');
      await expect(first).toContainText('time zone Africa/Lagos');
      await expect(first.locator('.row', { hasText: 'Training day' })).toContainText('17:30 · Mon, Wed, Fri');
      await expect(first.locator('.row', { hasText: 'Training day' })).toContainText('Next: today 17:30');
      // The check-in already went out today, so its next time is tomorrow, and the page says when it last went.
      await expect(first.locator('.row', { hasText: 'Daily check-in' })).toContainText('Next: tomorrow (Saturday) 21:00 · last sent 2026-10-09');
      await expect(view.locator('.server-dev').nth(1)).toContainText('Apple (Safari or iPhone)');
      await expect(view.locator('.server-dev').nth(1)).toContainText('time zone Europe/London');

      await expectNoA11yViolations(page, 'what the server has');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone').toBe(true);
      expect(errors).toEqual([]);
      await ctx.close();
    });

    test('a device the server has not been able to reach for a day is flagged, with what to do about it', async ({ browser }) => {
      test.setTimeout(60_000);
      await clearDevices();
      // The test clock is Friday 9 Oct 2026, 10:00 in Lagos. One device has failed for three days, the other for an hour.
      await seedDevice('https://web.push.apple.com/' + 'd'.repeat(30), { failing_since: '2026-10-06T10:00:00Z', last_error: '403' });
      await seedDevice('https://fcm.googleapis.com/fcm/send/' + 'e'.repeat(30), { failing_since: '2026-10-09T08:30:00Z', last_error: 'network' });
      const { ctx, page, errors } = await openRemindersSignedIn(browser);
      const box = page.locator('.push-box');
      await box.getByRole('button', { name: 'Check what the server has' }).click();
      const view = box.getByRole('region', { name: 'What the server has' });
      const apple = view.locator('.server-dev', { hasText: 'Apple (Safari or iPhone)' });
      const chrome = view.locator('.server-dev', { hasText: 'Chrome or Android' });
      await expect(apple).toContainText('Couldn’t reach it since 6 Oct (the push service said 403). Turn push off and on again on that device.');
      await expect(chrome).not.toContainText('Couldn’t reach');
      await expectNoA11yViolations(page, 'a device that cannot be reached');
      expect(errors).toEqual([]);
      await ctx.close();
      await clearDevices();
    });

    test('a database that has not been given the newer columns still lists the devices, without the flag', async ({ browser }) => {
      test.setTimeout(60_000);
      await clearDevices();
      await seedDevice('https://web.push.apple.com/' + 'f'.repeat(30), { failing_since: '2026-10-06T10:00:00Z', last_error: '403' });
      await fetch(`${MOCK}/__admin/opts`, { method: 'POST', body: JSON.stringify({ pushHealth: false }) });
      try {
        const { ctx, page, errors } = await openRemindersSignedIn(browser);
        const box = page.locator('.push-box');
        await box.getByRole('button', { name: 'Check what the server has' }).click();
        const view = box.getByRole('region', { name: 'What the server has' });
        await expect(view.locator('.server-dev')).toHaveCount(1);
        await expect(view).toContainText('Apple (Safari or iPhone)');
        await expect(view.locator('.row', { hasText: 'Daily check-in' })).toContainText('21:00');
        await expect(view).not.toContainText('Couldn’t reach');
        await expect(box.getByRole('status').filter({ hasText: /wrong|couldn’t/i })).toHaveCount(0);
        expect(errors).toEqual([]);
        await ctx.close();
      } finally {
        await fetch(`${MOCK}/__admin/opts`, { method: 'POST', body: JSON.stringify({ pushHealth: true }) });
        await clearDevices();
      }
    });
  });
});
