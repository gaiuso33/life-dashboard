import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { CLOUD_APP, DESKTOP, MOCK, expectNoA11yViolations, newContext, setUpEmptyDashboard } from './helpers';

// The GitHub token travelling in the encrypted cloud copy, between two devices, against the local mock of Supabase. GitHub is played
// by the test. The two devices run in order.
test.describe.configure({ mode: 'serial' });

const EMAIL = `gh-${Date.now()}@example.com`; // unique per run: the mock server is shared with other specs
const PASSWORD = 'correct-password';
const PASSPHRASE = 'purple-elephant-42';
const TOKEN = 'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'x-oauth-scopes' };

interface Dev {
  ctx: BrowserContext;
  page: Page;
  errors: string[];
}
let L: Dev;
let P: Dev;

const admin = async () => (await fetch(`${MOCK}/__admin/state`)).json() as Promise<{ users: { email: string }[]; vaults: { version: number; blob: string }[] }>;
const mine = async () => {
  const s = await admin();
  return s.vaults[s.users.findIndex((u) => u.email === EMAIL)] ?? s.vaults[s.vaults.length - 1];
};
const device = async (browser: Browser): Promise<Dev> => {
  const ctx = await newContext(browser, { viewport: DESKTOP });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => void d.accept());
  await page.route('https://api.github.com/**', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.request().url().includes('/user/repos')
        ? route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify([{ full_name: 'octocat/secret-app', private: true }]) })
        : route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ login: 'octocat' }) }),
  );
  await page.goto(CLOUD_APP);
  return { ctx, page, errors };
};
const goToCareer = async (p: Page) => {
  await p.getByRole('button', { name: 'Career' }).last().click();
  await p.getByRole('heading', { name: 'GitHub activity' }).waitFor();
  const d = p.locator('.private-gh');
  if (!(await d.getByText('What it can see.').isVisible())) await d.locator('summary').click();
  return d;
};
const keepBox = (p: Page) => p.locator('.private-gh').getByRole('checkbox', { name: /Keep it in my encrypted cloud copy/ });
const localTokens = (p: Page) => p.evaluate(() => [localStorage.getItem('life-dashboard:github-token'), localStorage.getItem('life-dashboard:github-repos')]);

test.beforeAll(async ({ browser }) => {
  L = await device(browser);
  P = await device(browser);
});
test.afterAll(async () => {
  await L?.ctx.close();
  await P?.ctx.close();
});

test('laptop: signed out there is nothing to keep in the cloud; signed in, the token goes up sealed', async () => {
  const p = L.page;
  await setUpEmptyDashboard(p);
  let panel = await goToCareer(p);
  await expect(panel).toContainText('sign in under Settings');
  await expect(keepBox(p)).toHaveCount(0);

  await p.getByRole('button', { name: 'Sync and backup' }).first().click();
  await p.locator('#sync-title').waitFor();
  await p.getByRole('radio', { name: 'Create account' }).click();
  await p.getByLabel('Email').fill(EMAIL);
  await p.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await p.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await p.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await p.getByLabel('Passphrase again').fill(PASSPHRASE);
  await p.getByRole('button', { name: /Encrypt and start/ }).click();
  await expect(p.locator('.modal .ok', { hasText: 'Synced' })).toBeVisible({ timeout: 20_000 });
  await p.getByRole('button', { name: 'Close', exact: true }).click();

  panel = await goToCareer(p);
  await expect(keepBox(p)).not.toBeChecked();
  await p.getByLabel('GitHub token').fill(TOKEN);
  await p.getByRole('button', { name: 'Save token' }).click();
  await expect(panel).toContainText('Saved. It belongs to octocat.');
  const before = (await mine()).version;
  // Saved on this device only so far: switching it on is what sends it.
  expect(JSON.stringify(await admin())).not.toContain('github_pat');
  await keepBox(p).check();
  await expect(panel).toContainText('Kept in your cloud copy');
  await expect.poll(async () => (await mine()).version, { timeout: 30_000 }).toBeGreaterThan(before);
  const wire = JSON.stringify(await admin());
  for (const hidden of [TOKEN, 'github_pat', 'octocat', '_secrets']) expect(wire, `the server cannot see "${hidden}"`).not.toContain(hidden);
  await expectNoA11yViolations(p, 'private repositories with the cloud switch');
});

test('phone: signs in, switches it on, and the token arrives; the data itself never holds it', async () => {
  const p = P.page;
  await p.getByRole('button', { name: 'Sign in to my account' }).click();
  await p.getByLabel('Email').fill(EMAIL);
  await p.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await p.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await p.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await p.getByRole('button', { name: 'Unlock' }).click();
  await expect(p.getByText('Today’s plates')).toBeVisible({ timeout: 20_000 });

  const panel = await goToCareer(p);
  // Not taking part yet, so nothing arrives by itself.
  expect(await localTokens(p)).toEqual([null, null]);
  await expect(p.getByLabel('GitHub token')).toBeVisible();
  await keepBox(p).check();
  await expect(panel).toContainText(`…${TOKEN.slice(-4)}`, { timeout: 30_000 });
  await expect(p.getByLabel('GitHub token')).toHaveCount(0);

  // The token is in its own slot, never in the data, so never in a download of it.
  expect((await localTokens(p))[0]).toBe(TOKEN);
  const app = await p.evaluate(() => localStorage.getItem('life-dashboard:v1') ?? '');
  expect(app).not.toContain(TOKEN);
  for (const d of [L, P]) expect(d.errors).toEqual([]);
});

test('switching it off removes it from the cloud copy and leaves each device’s own token alone', async () => {
  const p = L.page;
  const before = (await mine()).version;
  await keepBox(p).uncheck();
  await expect(p.locator('.private-gh')).toContainText('Removing it from your cloud copy');
  await expect.poll(async () => (await mine()).version, { timeout: 30_000 }).toBeGreaterThan(before);
  expect((await localTokens(p))[0], 'this device keeps its own token').toBe(TOKEN);
  expect((await localTokens(P.page))[0], 'so does the phone').toBe(TOKEN);

  // A device that switches it on afterwards finds nothing in the cloud copy.
  const third = await device(L.ctx.browser()!);
  await third.page.getByRole('button', { name: 'Sign in to my account' }).click();
  await third.page.getByLabel('Email').fill(EMAIL);
  await third.page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await third.page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await third.page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await third.page.getByRole('button', { name: 'Unlock' }).click();
  await expect(third.page.getByText('Today’s plates')).toBeVisible({ timeout: 20_000 });
  await goToCareer(third.page);
  await keepBox(third.page).check();
  await third.page.waitForTimeout(3000);
  expect(await localTokens(third.page)).toEqual([null, null]);
  await expect(third.page.getByLabel('GitHub token')).toBeVisible();
  expect(third.errors).toEqual([]);
  await third.ctx.close();
});
