import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { CLOUD_APP, DESKTOP, expectNoA11yViolations, MOCK, setUpEmptyDashboard, stored, newContext } from './helpers';

// Cloud sync against the local mock of Supabase (e2e/mock-server.mjs). The tests share two "devices" and run in order.
test.describe.configure({ mode: 'serial' });

interface Dev { ctx: BrowserContext; page: Page; errors: string[] }
let L: Dev; // laptop
let P: Dev; // phone
let browserRef: Browser;

const EMAIL = 'me@example.com';
const PASSWORD = 'correct-password';
const PASSPHRASE = 'purple-elephant-42';

const admin = async () => (await fetch(`${MOCK}/__admin/state`)).json() as Promise<{
  users: { email: string; password: string }[];
  vaults: { version: number; blob: string }[];
  liveAccessTokens: string[];
  log: string[];
  sent: { type: string }[];
}>;
const device = async (): Promise<Dev> => {
  const ctx = await newContext(browserRef, { viewport: DESKTOP });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => void d.accept());
  await page.goto(CLOUD_APP);
  return { ctx, page, errors };
};
const openSync = async (p: Page) => {
  await p.getByRole('button', { name: 'Sync and backup' }).first().click();
  await p.locator('#sync-title').waitFor();
};
const closeSync = (p: Page) => p.getByRole('button', { name: 'Close', exact: true }).click();
const badge = (p: Page) => p.locator('.cloud-badge');
const signIn = async (p: Page, password = PASSWORD) => {
  await p.getByLabel('Email').fill(EMAIL);
  await p.getByLabel('Password', { exact: true }).fill(password);
  await p.getByRole('button', { name: 'Sign in', exact: true }).last().click();
};
const gap = (_p: Page, ms = 700) => new Promise((r) => setTimeout(r, ms));
const energyDays = async (p: Page, n: number) => Object.values((await stored(p)).days).some((d) => (d as { energy?: number }).energy === n);

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  await fetch(`${MOCK}/__admin/reset`, { method: 'POST', body: '{}' });
  L = await device();
  P = await device();
});
test.afterAll(async () => {
  await L?.ctx.close();
  await P?.ctx.close();
});

test('laptop: create an account, choose a passphrase, data is encrypted before upload', async () => {
  const p = L.page;
  await setUpEmptyDashboard(p);
  await p.getByRole('button', { name: '2', exact: true }).first().click();
  await openSync(p);
  await expectNoA11yViolations(p, 'sync dialog, signed out');
  await p.getByRole('radio', { name: 'Create account' }).click();
  await p.getByLabel('Email').fill(EMAIL);
  await p.getByLabel('Password', { exact: true }).fill('short');
  await p.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(p.locator('.err', { hasText: 'at least 8' })).toBeVisible();
  await p.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await p.getByRole('button', { name: 'Create account', exact: true }).last().click();

  await expect(p.getByText('can’t be reset or recovered')).toBeVisible();
  await expectNoA11yViolations(p, 'sync dialog, first passphrase');
  await p.getByLabel('Passphrase', { exact: true }).fill('tiny');
  await p.getByLabel('Passphrase again').fill('tiny');
  await p.getByRole('button', { name: /Encrypt and start/ }).click();
  await expect(p.locator('.err', { hasText: 'at least 10' })).toBeVisible();
  await p.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await p.getByLabel('Passphrase again').fill(PASSPHRASE + 'x');
  await p.getByRole('button', { name: /Encrypt and start/ }).click();
  await expect(p.locator('.err', { hasText: 'don’t match' })).toBeVisible();
  await p.getByLabel('Passphrase again').fill(PASSPHRASE);
  await p.getByRole('button', { name: /Encrypt and start/ }).click();
  await expect(p.locator('.modal .ok', { hasText: 'Synced' })).toBeVisible({ timeout: 20_000 });
  await expectNoA11yViolations(p, 'sync dialog, signed in');

  const s = await admin();
  expect(s.vaults).toHaveLength(1);
  expect(s.vaults[0].version).toBe(1);
  const wire = JSON.stringify(s);
  for (const secret of ['days', 'onboarded', PASSPHRASE, PASSWORD + 'zzz']) expect(s.vaults[0].blob, `server copy hides "${secret}"`).not.toContain(secret);
  expect(wire).not.toContain(PASSPHRASE);
  expect(Object.keys(await p.evaluate(() => Object.fromEntries(Object.entries(localStorage))))).not.toContain('life-dashboard:v1:cloud-pass');
  await closeSync(p);
  await expect(badge(p)).toContainText('Synced');
});

test('phone: a new device signs in from the welcome screen; a wrong passphrase is refused', async () => {
  const p = P.page;
  await expect(p.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await p.getByRole('button', { name: 'Sign in to my account' }).click();
  await expectNoA11yViolations(p, 'welcome with the account form');
  await signIn(p, 'not-the-password');
  await expect(p.locator('.err', { hasText: 'Invalid login' })).toBeVisible();
  await signIn(p);
  await p.getByLabel('Passphrase', { exact: true }).waitFor();
  await expect(p.getByLabel('Passphrase again')).toHaveCount(0);
  await p.getByLabel('Passphrase', { exact: true }).fill('wrong-wrong-wrong');
  await p.getByRole('button', { name: 'Unlock' }).click();
  await expect(p.locator('.err', { hasText: 'didn’t open your data' })).toBeVisible({ timeout: 20_000 });
  expect((await admin()).vaults[0].version, 'a wrong passphrase never touches the server copy').toBe(1);
  await p.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await p.getByRole('button', { name: 'Unlock' }).click();
  await expect(p.getByText('Today’s plates')).toBeVisible({ timeout: 20_000 });
  await gap(p);
  expect(await energyDays(p, 2), 'the laptop’s entry arrived on the phone').toBe(true);
});

test('edits travel in both directions and concurrent edits converge', async () => {
  const before = (await admin()).vaults[0].version;
  await P.page.getByRole('button', { name: '5', exact: true }).first().click();
  await expect.poll(async () => (await admin()).vaults[0].version, { timeout: 15_000 }).toBeGreaterThan(before);
  await L.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => energyDays(L.page, 5), { timeout: 15_000 }).toBe(true);

  // both sides change something different at the same time
  await L.page.locator('button[aria-pressed]', { hasText: 'Mark done' }).first().click();
  await P.page.getByRole('button', { name: '3', exact: true }).first().click();
  await gap(L.page, 4500);
  for (const d of [L, P]) await d.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await gap(L.page, 3500);
  await expect.poll(async () => JSON.stringify((await stored(L.page)).days) === JSON.stringify((await stored(P.page)).days), { timeout: 15_000 }).toBe(true);
});

test('a device can stay unlocked; one that did not opt in asks again', async () => {
  await openSync(L.page);
  await L.page.getByLabel(/Keep this device unlocked/).check();
  await closeSync(L.page);
  await L.page.reload();
  await L.page.getByText('Today’s plates').waitFor();
  await expect(badge(L.page)).toContainText('Synced', { timeout: 15_000 });

  await P.page.reload();
  await P.page.getByText('Today’s plates').waitFor();
  await expect(badge(P.page)).toContainText('Locked', { timeout: 15_000 });
  await openSync(P.page);
  await expectNoA11yViolations(P.page, 'sync dialog, locked');
  await P.page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await P.page.getByRole('button', { name: 'Unlock' }).click();
  await expect(P.page.locator('.modal .ok', { hasText: 'Synced' })).toBeVisible({ timeout: 20_000 });
  await closeSync(P.page);
});

test('offline edits are kept and uploaded when the connection returns', async () => {
  await L.ctx.setOffline(true);
  await L.page.getByRole('button', { name: '1', exact: true }).first().click();
  await gap(L.page, 3800);
  await L.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(badge(L.page)).toContainText('Offline', { timeout: 10_000 });
  expect(await energyDays(L.page, 1), 'edit kept locally').toBe(true);
  await L.ctx.setOffline(false);
  await L.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(badge(L.page)).toContainText('Synced', { timeout: 15_000 });
  await P.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => energyDays(P.page, 1), { timeout: 15_000 }).toBe(true);
});

test('an expired access token is refreshed without bothering the person', async () => {
  await L.page.evaluate(() => {
    const k = 'life-dashboard:v1:cloud-session';
    const s = JSON.parse(localStorage.getItem(k)!);
    s.expires_at = 1;
    localStorage.setItem(k, JSON.stringify(s));
  });
  const n = (await admin()).log.filter((l) => l.includes('grant_type=refresh_token')).length;
  await L.page.reload();
  await L.page.getByText('Today’s plates').waitFor();
  await expect(badge(L.page)).toContainText('Synced', { timeout: 15_000 });
  expect((await admin()).log.filter((l) => l.includes('grant_type=refresh_token')).length).toBeGreaterThan(n);
});

test('sign out keeps local data and removes the session; password reset works end to end', async ({ browser }) => {
  await openSync(L.page);
  await L.page.getByRole('button', { name: 'Sign out' }).click();
  await expect(L.page.getByRole('radio', { name: 'Sign in' })).toBeVisible();
  await expect(badge(L.page)).toHaveCount(0);
  expect(Object.keys((await stored(L.page)).days).length).toBeGreaterThan(0);
  expect(await L.page.evaluate(() => localStorage.getItem('life-dashboard:v1:cloud-session'))).toBeNull();

  await L.page.getByLabel('Email').fill(EMAIL);
  await L.page.getByRole('button', { name: 'Forgot password' }).click();
  await expect(L.page.locator('.ok', { hasText: 'reset link is on its way' })).toBeVisible();
  const s = await admin();
  expect(s.sent.some((m) => m.type === 'recover')).toBe(true);

  // following the emailed link on another device
  browserRef = browser;
  const R = await device();
  await R.page.goto('about:blank'); // a fresh load, as when following a link from an email
  await R.page.goto(`${CLOUD_APP}#access_token=${s.liveAccessTokens[0]}&type=recovery&refresh_token=x`);
  await expect(R.page.getByLabel('New password')).toBeVisible();
  expect(await R.page.evaluate(() => location.hash), 'the token is removed from the address bar').toBe('');
  await R.page.getByLabel('New password').fill('brand-new-password');
  await R.page.getByRole('button', { name: 'Save password' }).click();
  await expect(R.page.locator('.ok', { hasText: 'Password changed' })).toBeVisible();
  await R.page.getByRole('button', { name: 'Continue to sign in' }).click();
  await expect(R.page.getByRole('radio', { name: 'Sign in' })).toBeVisible();
  expect((await admin()).users[0].password).toBe('brand-new-password');
  await R.ctx.close();
});

test('deleting the cloud copy leaves each device’s data alone', async () => {
  const p = P.page;
  await openSync(p);
  await p.getByRole('button', { name: 'Delete cloud copy' }).click();
  await expect.poll(async () => (await admin()).vaults.length).toBe(0);
  expect(Object.keys((await stored(p)).days).length).toBeGreaterThan(0);
  for (const d of [L, P]) expect(d.errors).toEqual([]);
});
