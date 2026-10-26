import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { APP, DESKTOP, PHONE, expectNoA11yViolations, newContext, setUpEmptyDashboard } from './helpers';

// Private repositories and other branches through a read-only token. GitHub is played by the test; the browser still applies the
// page's security policy first, so this also proves the policy lets api.github.com through with an Authorization header.
// The clock is fixed at Friday 9 Oct 2026, 10:00 in Lagos.

const TOKEN = 'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'x-oauth-scopes' };
const commit = (sha: string, date: string) => ({ sha, commit: { author: { date: `${date}T12:00:00Z` } } });

interface Seen {
  url: URL;
  auth: string | undefined;
}

async function mockGitHub(page: Page, opts: { scopes?: string; badToken?: boolean } = {}): Promise<Seen[]> {
  const seen: Seen[] = [];
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => ({ status, contentType: 'application/json', headers: { ...CORS, ...extra }, body: JSON.stringify(body) });
  await page.route('https://api.github.com/**', async (route) => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(r.url());
    seen.push({ url, auth: r.headers().authorization });
    const p = url.pathname;
    if (p === '/search/commits') return route.fulfill(json({ total_count: 1, items: [{ sha: 'pub1', commit: { author: { date: '2026-10-08T12:00:00Z' } }, repository: { full_name: 'octocat/open' } }] }));
    if (opts.badToken && r.headers().authorization) return route.fulfill(json({ message: 'Bad credentials' }, 401));
    if (p === '/user') return route.fulfill(json({ login: 'octocat' }, 200, opts.scopes ? { 'x-oauth-scopes': opts.scopes } : {}));
    if (p === '/user/repos')
      return route.fulfill(json([{ full_name: 'octocat/secret-app', private: true }, { full_name: 'octocat/open', private: false }, { full_name: 'octocat/other', private: true }]));
    if (p === '/repos/octocat/secret-app/branches') return route.fulfill(json([{ name: 'main' }, { name: 'dev' }]));
    if (p === '/repos/octocat/secret-app/commits')
      return route.fulfill(json(url.searchParams.get('sha') === 'dev' ? [commit('s1', '2026-10-08'), commit('s3', '2026-10-07')] : [commit('s1', '2026-10-08'), commit('s2', '2026-10-08')]));
    if (p === '/repos/octocat/open/commits') return route.fulfill(json([commit('pub1', '2026-10-08')]));
    return route.fulfill(json({ message: 'Not Found' }, 404));
  });
  return seen;
}

const goToCareer = async (p: Page) => {
  await p.getByRole('button', { name: 'Career' }).last().click();
  await p.getByRole('heading', { name: 'GitHub activity' }).waitFor();
};
const panel = (p: Page) => p.locator('.private-gh');
const openPanel = async (p: Page) => {
  await panel(p).locator('summary').click();
  await expect(panel(p).getByText('What it can see.')).toBeVisible();
};

test('a read-only token brings private repositories and other branches in, once each, and stays on the device', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: DESKTOP });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const seen = await mockGitHub(page);
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await goToCareer(page);
  await page.getByLabel('GitHub username').fill('octocat');

  // Plain sync first: public commits only, and the panel says what a token would add.
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Found 1 commits' })).toBeVisible();
  expect(seen.every((s) => s.auth === undefined), 'no token used before one is added').toBe(true);

  await openPanel(page);
  await expect(panel(page)).toContainText('Contents: Read-only');
  await expect(panel(page)).toContainText('not in backups or downloads');
  await expect(panel(page)).toContainText('delete it at github.com/settings/personal-access-tokens');

  // Something that is not a token is refused without asking GitHub.
  const before = seen.length;
  await page.getByLabel('GitHub token').fill('hunter2');
  await page.getByRole('button', { name: 'Save token' }).click();
  await expect(panel(page)).toContainText('doesn’t look like a GitHub token');
  expect(seen.length).toBe(before);

  await page.getByLabel('GitHub token').fill(TOKEN);
  await page.getByRole('button', { name: 'Save token' }).click();
  await expect(panel(page)).toContainText('Saved. It belongs to octocat.');
  await expect(panel(page)).toContainText(`…${TOKEN.slice(-4)}`);
  await expect(panel(page)).not.toContainText(TOKEN);
  await expect(page.getByLabel('GitHub token')).toHaveCount(0);

  await page.getByRole('button', { name: 'Choose repositories' }).click();
  await expect(panel(page).getByRole('checkbox', { name: /octocat\/secret-app/ })).toBeVisible();
  await expect(panel(page).locator('li', { hasText: 'octocat/secret-app' })).toContainText('private');
  await panel(page).getByRole('checkbox', { name: /octocat\/secret-app/ }).check();
  await panel(page).getByRole('checkbox', { name: 'All branches' }).check();
  await panel(page).getByRole('checkbox', { name: /octocat\/open/ }).check();
  await expectNoA11yViolations(page, 'private repositories panel');

  // 1 public + (s1,s2 on main; s1,s3 on dev = 3 distinct) + the public repo's pub1 already counted by the search = 4.
  seen.length = 0;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Found 4 commits across 2 repos' })).toBeVisible();
  const withToken = seen.filter((s) => s.url.pathname.startsWith('/repos/'));
  expect(withToken.length).toBeGreaterThan(0);
  for (const s of withToken) expect(s.auth, s.url.pathname).toBe(`Bearer ${TOKEN}`);
  expect(seen.find((s) => s.url.pathname === '/search/commits')!.auth, 'the anonymous search never carries the token').toBeUndefined();
  for (const s of seen) expect(s.url.href).not.toContain(TOKEN);
  expect(seen.some((s) => s.url.pathname.endsWith('/octocat/secret-app/branches'))).toBe(true);

  // The counts landed in the data (it saves a moment after a change); the token and the private names did not.
  await page.waitForTimeout(700);
  const app = await page.evaluate(() => JSON.parse(localStorage.getItem('life-dashboard:v1') || '{}'));
  expect(app.career.commits).toEqual({ '2026-10-08': 3, '2026-10-07': 1 });
  const everything = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k !== 'life-dashboard:github-token' && k !== 'life-dashboard:github-repos').map(([, v]) => v).join('\n'));
  expect(everything).not.toContain(TOKEN);
  expect(everything).not.toContain('secret-app');

  // It is remembered, and a download of the data does not contain it.
  await page.reload();
  await goToCareer(page);
  await openPanel(page);
  await expect(panel(page)).toContainText(`…${TOKEN.slice(-4)}`);
  await expect(panel(page)).toContainText('Counting: octocat/secret-app (all branches), octocat/open.');

  // Remove forgets the token and the choices; the days already counted stay.
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByLabel('GitHub token')).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem('life-dashboard:github-token'), localStorage.getItem('life-dashboard:github-repos')])).toEqual([null, null]);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('a token that stops working leaves the days already counted alone and says why', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: DESKTOP });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockGitHub(page);
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await goToCareer(page);
  await page.getByLabel('GitHub username').fill('octocat');
  await page.evaluate((t) => {
    localStorage.setItem('life-dashboard:github-token', t);
    localStorage.setItem('life-dashboard:github-repos', JSON.stringify([{ name: 'octocat/secret-app', allBranches: false }]));
  }, TOKEN);
  // A good first sync stores the public commit and the private ones.
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Found 3 commits' })).toBeVisible();
  await page.waitForTimeout(700);
  const first = await page.evaluate(() => JSON.parse(localStorage.getItem('life-dashboard:v1') || '{}').career.commits);
  expect(first).toEqual({ '2026-10-08': 3 }); // pub1 from the search, s1 and s2 from the private repository
  // The token is revoked at GitHub.
  await page.unroute('https://api.github.com/**');
  await mockGitHub(page, { badToken: true });
  await page.getByRole('button', { name: 'Sync now' }).click();
  const status = page.getByRole('status').filter({ hasText: 'could not be read' });
  await expect(status).toContainText('Your private repositories could not be read');
  await expect(status).toContainText('didn’t accept the token');
  await expect(status).not.toContainText(TOKEN);
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('life-dashboard:v1') || '{}').career.commits);
  expect(after, 'a failed private look neither lowers nor clears what was stored').toEqual(first);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('a classic token that can change code is flagged; erasing the device forgets the token; the demo has no such panel', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: PHONE });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockGitHub(page, { scopes: 'repo, read:user' });
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await goToCareer(page);
  await openPanel(page);
  await page.getByLabel('GitHub token').fill('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  await page.getByRole('button', { name: 'Save token' }).click();
  await expect(panel(page)).toContainText('can also change your code');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone').toBe(true);
  await expectNoA11yViolations(page, 'private repositories on a phone');

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Settings' }).last().click();
  await page.getByRole('button', { name: 'Erase everything on this device' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('life-dashboard:github-token'))).toBeNull();

  const demo = await ctx.newPage();
  await demo.goto(APP + '?demo');
  await demo.getByRole('button', { name: 'Career' }).last().click();
  await demo.getByRole('heading', { name: 'GitHub activity' }).waitFor();
  await expect(demo.locator('.private-gh')).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});
