import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubError, mergeCommits } from '../github';
import type { CommitSync } from '../github';
import { MAX_BRANCHES, MAX_REPOS, checkToken, clearToken, combineSyncs, fetchPrivateCommits, listRepos, loadChoices, loadToken, looksLikeToken, maskToken, publicOnly, saveChoices, saveToken } from '../githubPrivate';

const TOKEN = 'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV';
const CLASSIC = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-09T10:00:00+01:00') });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const res = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const commit = (sha: string, date: string) => ({ sha, commit: { author: { date: `${date}T12:00:00Z` } } });

/** A fake GitHub. `routes` maps a path (without the query) to what it answers. Every call is recorded. */
function fakeGitHub(routes: Record<string, (url: URL) => Response>) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fn = (async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const h = routes[url.pathname];
    return h ? h(url) : res({ message: 'Not Found' }, 404);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('the token and the chosen repositories on this device', () => {
  it('recognises the two shapes GitHub issues, and refuses anything else', () => {
    expect(looksLikeToken(TOKEN)).toBe(true);
    expect(looksLikeToken(`  ${CLASSIC} `)).toBe(true);
    for (const t of ['', 'octocat', 'ghp_short', 'sk-ant-abcdefghijklmnopqrstuvwxyz', 'github_pat_', `${CLASSIC} extra`]) expect(looksLikeToken(t), t).toBe(false);
  });
  it('shows only the last four characters', () => {
    expect(maskToken(TOKEN)).toBe(`…${TOKEN.slice(-4)}`);
    expect(maskToken(TOKEN)).not.toContain('github_pat');
  });
  it('keeps the token in its own slot, and forgets it with the repositories', () => {
    expect(loadToken()).toBe('');
    expect(saveToken(`  ${TOKEN}\n`)).toBe(true);
    expect(loadToken()).toBe(TOKEN);
    saveChoices([{ name: 'me/private-app', allBranches: true }]);
    expect([...store.keys()].sort()).toEqual(['life-dashboard:github-repos', 'life-dashboard:github-token']);
    clearToken();
    expect(store.size).toBe(0);
    expect(loadChoices()).toEqual([]);
  });
  it('reads back only sensible repository choices', () => {
    store.set('life-dashboard:github-repos', JSON.stringify([{ name: 'me/ok', allBranches: true }, { name: 'me/ok' }, { name: '../etc/passwd' }, { name: 'no-slash' }, { name: 5 }, null, 'x', { name: 'me/two', allBranches: 'yes' }]));
    expect(loadChoices()).toEqual([{ name: 'me/ok', allBranches: true }, { name: 'me/two', allBranches: false }]);
    store.set('life-dashboard:github-repos', 'not json');
    expect(loadChoices()).toEqual([]);
    store.set('life-dashboard:github-repos', JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ name: `me/r${i}` }))));
    expect(loadChoices()).toHaveLength(MAX_REPOS);
  });
  it('copes with storage being blocked', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } } });
    expect(loadToken()).toBe('');
    expect(saveToken(TOKEN)).toBe(false);
    expect(loadChoices()).toEqual([]);
    expect(() => clearToken()).not.toThrow();
  });
});

describe('checking a token', () => {
  it('says who it belongs to, and sends it only in a header', async () => {
    const gh = fakeGitHub({ '/user': () => res({ login: 'octocat' }) });
    expect(await checkToken(TOKEN, gh.fn)).toEqual({ login: 'octocat', canWrite: false, classic: false });
    expect(gh.calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(gh.calls[0].url.href).not.toContain(TOKEN);
    expect(gh.calls[0].url.origin).toBe('https://api.github.com');
  });
  it('warns when a classic token can change things, not only read', async () => {
    const withRepo = fakeGitHub({ '/user': () => res({ login: 'o' }, 200, { 'x-oauth-scopes': 'repo, read:user' }) });
    expect(await checkToken(CLASSIC, withRepo.fn)).toMatchObject({ classic: true, canWrite: true });
    const readOnly = fakeGitHub({ '/user': () => res({ login: 'o' }, 200, { 'x-oauth-scopes': 'read:user, read:org' }) });
    expect(await checkToken(CLASSIC, readOnly.fn)).toMatchObject({ classic: true, canWrite: false });
    for (const scope of ['workflow', 'write:packages', 'admin:org', 'delete_repo', 'public_repo']) {
      const g = fakeGitHub({ '/user': () => res({ login: 'o' }, 200, { 'x-oauth-scopes': scope }) });
      expect((await checkToken(CLASSIC, g.fn)).canWrite, scope).toBe(true);
    }
  });
  it('explains a rejected token without repeating it', async () => {
    const gh = fakeGitHub({ '/user': () => res({ message: 'Bad credentials' }, 401) });
    const err = await checkToken(TOKEN, gh.fn).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as Error).message).toMatch(/didn’t accept the token/);
    expect((err as Error).message).not.toContain(TOKEN);
  });
  it('reports a network failure and an unexpected answer plainly', async () => {
    const down = (async () => { throw new TypeError('network'); }) as unknown as typeof fetch;
    await expect(checkToken(TOKEN, down)).rejects.toThrow(/Couldn’t reach GitHub/);
    await expect(checkToken(TOKEN, fakeGitHub({ '/user': () => res({ nope: 1 }) }).fn)).rejects.toThrow(/unexpected/);
    await expect(checkToken(TOKEN, fakeGitHub({ '/user': () => new Response('<html>', { status: 200 }) }).fn)).rejects.toThrow(/unexpected/);
    await expect(checkToken(TOKEN, fakeGitHub({ '/user': () => res({}, 403) }).fn)).rejects.toThrow(/refused/);
    await expect(checkToken(TOKEN, fakeGitHub({ '/user': () => res({}, 500) }).fn)).rejects.toThrow(/500/);
  });
});

describe('choosing repositories', () => {
  it('lists what the token can see and drops malformed entries', async () => {
    const gh = fakeGitHub({ '/user/repos': () => res([{ full_name: 'me/secret', private: true }, { full_name: 'me/open', private: false }, { full_name: '../x' }, { private: true }, null]) });
    expect(await listRepos(TOKEN, gh.fn)).toEqual([{ name: 'me/secret', private: true }, { name: 'me/open', private: false }]);
    expect(gh.calls[0].url.searchParams.get('per_page')).toBe('100');
  });
  it('an answer that is not a list is an empty one', async () => {
    expect(await listRepos(TOKEN, fakeGitHub({ '/user/repos': () => res({ message: 'x' }) }).fn)).toEqual([]);
  });
});

describe('counting private commits', () => {
  const choice = (name: string, allBranches = false) => ({ name, allBranches });

  it('counts the user’s commits by day, in the chosen repository only', async () => {
    const gh = fakeGitHub({ '/repos/me/secret/commits': () => res([commit('a1', '2026-10-08'), commit('a2', '2026-10-08'), commit('a3', '2026-10-05')]) });
    const r = await fetchPrivateCommits(TOKEN, '@octocat', [choice('me/secret')], new Set(), gh.fn);
    expect(r).toMatchObject({ byDate: { '2026-10-08': 2, '2026-10-05': 1 }, repos: ['me/secret'], total: 3, truncated: false, shas: ['a1', 'a2', 'a3'] });
    const q = gh.calls[0].url.searchParams;
    expect(q.get('author')).toBe('octocat');
    expect(q.get('sha')).toBeNull(); // the default branch
    expect(gh.calls).toHaveLength(1);
  });
  it('never puts the token in an address, and always sends it as a header to GitHub', async () => {
    const gh = fakeGitHub({ '/repos/me/secret/branches': () => res([{ name: 'main' }, { name: 'dev' }]), '/repos/me/secret/commits': () => res([]) });
    await fetchPrivateCommits(TOKEN, 'octocat', [choice('me/secret', true)], new Set(), gh.fn);
    expect(gh.calls.length).toBeGreaterThan(1);
    for (const c of gh.calls) {
      expect(c.url.origin).toBe('https://api.github.com');
      expect(c.url.href).not.toContain(TOKEN);
      expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });
  it('a commit on several branches is counted once, and all branches are looked at only when asked', async () => {
    const onBranch = (url: URL) => (url.searchParams.get('sha') === 'dev' ? res([commit('shared', '2026-10-08'), commit('only-dev', '2026-10-07')]) : res([commit('shared', '2026-10-08')]));
    const gh = fakeGitHub({ '/repos/me/app/branches': () => res([{ name: 'main' }, { name: 'dev' }]), '/repos/me/app/commits': onBranch });
    const all = await fetchPrivateCommits(TOKEN, 'octocat', [choice('me/app', true)], new Set(), gh.fn);
    expect(all.byDate).toEqual({ '2026-10-08': 1, '2026-10-07': 1 });
    expect(all.total).toBe(2);
    const gh2 = fakeGitHub({ '/repos/me/app/commits': onBranch });
    const one = await fetchPrivateCommits(TOKEN, 'octocat', [choice('me/app')], new Set(), gh2.fn);
    expect(one.total).toBe(1);
    expect(gh2.calls.some((c) => c.url.pathname.endsWith('/branches'))).toBe(false);
  });
  it('does not count again what the public search already counted', async () => {
    const gh = fakeGitHub({ '/repos/me/open/commits': () => res([commit('seen', '2026-10-08'), commit('new', '2026-10-08')]) });
    const r = await fetchPrivateCommits(TOKEN, 'octocat', [choice('me/open')], new Set(['seen']), gh.fn);
    expect(r.total).toBe(1);
    expect(r.shas).toEqual(['new']);
  });
  it('leaves out commits older than the sync window and skips malformed ones', async () => {
    const gh = fakeGitHub({ '/repos/me/a/commits': () => res([commit('old', '2026-06-01'), { sha: 'nodate', commit: {} }, { commit: { author: { date: '2026-10-08T12:00:00Z' } } }, commit('bad', 'nope'), commit('ok', '2026-10-08'), null as never]) });
    const r = await fetchPrivateCommits(TOKEN, 'octocat', [choice('me/a')], new Set(), gh.fn);
    expect(r.shas).toEqual(['ok']);
  });
  it('says so when it had to stop early: too many branches, or too many commits', async () => {
    const many = Array.from({ length: MAX_BRANCHES + 5 }, (_, i) => ({ name: `b${i}` }));
    const gh = fakeGitHub({ '/repos/me/a/branches': () => res(many), '/repos/me/a/commits': () => res([]) });
    const r = await fetchPrivateCommits(TOKEN, 'octocat', [choice('me/a', true)], new Set(), gh.fn);
    expect(r.truncated).toBe(true);
    expect(gh.calls.filter((c) => c.url.pathname.endsWith('/commits'))).toHaveLength(MAX_BRANCHES);
    let n = 0;
    const full = fakeGitHub({ '/repos/me/b/commits': () => res(Array.from({ length: 100 }, () => commit(`s${n++}`, '2026-10-08'))) });
    const r2 = await fetchPrivateCommits(TOKEN, 'octocat', [choice('me/b')], new Set(), full.fn);
    expect(r2.truncated).toBe(true);
    expect(r2.total).toBe(200);
  });
  it('an empty repository is fine; one the token cannot see is named, without the token', async () => {
    const empty = fakeGitHub({ '/repos/me/new/commits': () => res({ message: 'Git Repository is empty.' }, 409) });
    expect((await fetchPrivateCommits(TOKEN, 'octocat', [choice('me/new')], new Set(), empty.fn)).total).toBe(0);
    const err = await fetchPrivateCommits(TOKEN, 'octocat', [choice('me/hidden')], new Set(), fakeGitHub({}).fn).catch((e: unknown) => e);
    expect((err as Error).message).toContain('me/hidden');
    expect((err as Error).message).not.toContain(TOKEN);
    const err2 = await fetchPrivateCommits(TOKEN, 'octocat', [choice('me/hidden', true)], new Set(), fakeGitHub({}).fn).catch((e: unknown) => e);
    expect((err2 as Error).message).toContain('me/hidden');
  });
  it('a revoked token or a rate limit stops the whole look with a plain message', async () => {
    await expect(fetchPrivateCommits(TOKEN, 'o', [choice('me/a')], new Set(), fakeGitHub({ '/repos/me/a/commits': () => res({}, 401) }).fn)).rejects.toThrow(/didn’t accept the token/);
    await expect(fetchPrivateCommits(TOKEN, 'o', [choice('me/a')], new Set(), fakeGitHub({ '/repos/me/a/commits': () => res({}, 429) }).fn)).rejects.toThrow(/refused/);
  });
  it('looks at no more than the limit of repositories', async () => {
    const gh = fakeGitHub({});
    const routes: Record<string, () => Response> = {};
    const names = Array.from({ length: MAX_REPOS + 4 }, (_, i) => `me/r${i}`);
    for (const n of names) routes[`/repos/${n}/commits`] = () => res([]);
    const g = fakeGitHub(routes);
    await fetchPrivateCommits(TOKEN, 'o', names.map((n) => choice(n)), new Set(), g.fn);
    expect(g.calls).toHaveLength(MAX_REPOS);
    expect(gh.calls).toHaveLength(0);
  });
});

describe('putting private and public commits together', () => {
  const pub = (over: Partial<CommitSync> = {}): CommitSync => ({ byDate: { '2026-10-08': 2 }, repos: ['me/open'], total: 2, truncated: false, since: '2026-07-12', completeFrom: '2026-07-12', shas: ['p1', 'p2'], ...over });
  const priv = (over = {}) => ({ byDate: { '2026-10-08': 1, '2026-10-07': 3 }, repos: ['me/secret'], total: 4, truncated: false, since: '2026-07-12', shas: ['x1', 'x2', 'x3', 'x4'], ...over });

  it('adds the counts and the repositories', () => {
    const c = combineSyncs(pub(), priv());
    expect(c.byDate).toEqual({ '2026-10-08': 3, '2026-10-07': 3 });
    expect(c.total).toBe(6);
    expect(c.repos).toEqual(['me/open', 'me/secret']);
    expect(c.truncated).toBe(false);
    expect(c.completeFrom).toBe('2026-07-12');
  });
  it('trusts only the days the shorter look covered', () => {
    expect(combineSyncs(pub(), priv({ truncated: true })).completeFrom).toBe('2026-10-08'); // oldest private day is 10-07
    expect(combineSyncs(pub({ truncated: true, completeFrom: '2026-09-01' }), priv()).completeFrom).toBe('2026-09-01');
    expect(combineSyncs(pub({ truncated: true }), priv({ truncated: true })).truncated).toBe(true);
  });
  it('a failed private look never lowers or clears days already stored', () => {
    const stored = { '2026-10-08': 5, '2026-10-07': 3, '2026-09-01': 2 };
    const s = publicOnly(pub(), '2026-10-09');
    expect(mergeCommits(stored, s, '2026-10-09')).toEqual({ '2026-10-08': 5, '2026-10-07': 3, '2026-09-01': 2 });
    // Without that safeguard the same sync would have wiped the private days.
    expect(mergeCommits(stored, pub(), '2026-10-09')['2026-10-07']).toBeUndefined();
  });
  it('a successful look replaces the days it fully covered, so a removed commit disappears', () => {
    const c = combineSyncs(pub(), priv());
    expect(mergeCommits({ '2026-10-08': 9, '2026-10-06': 4 }, c, '2026-10-09')).toEqual({ '2026-10-08': 3, '2026-10-07': 3 });
  });
});

describe('the token stays on this device', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`).filter(() => e.name !== '__tests__') : [`${dir}/${e.name}`]));
  const sources = files('src').filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__'));
  const importers = sources.filter((f) => /from '(\.\.?\/)+githubPrivate'/.test(readFileSync(f, 'utf8')));

  it('only the screens that save, use or erase it can reach it', () => {
    expect(importers.sort()).toEqual(['src/components/Career.tsx', 'src/components/PrivateGitHub.tsx', 'src/components/Settings.tsx']);
  });
  it('the code that builds backups, cloud copies, the advisor’s summary and push schedules cannot read it', () => {
    for (const f of ['src/ai.ts', 'src/advisorData.ts', 'src/push.ts', 'src/pushEvents.ts', 'src/pushPreview.ts', 'src/sync.ts', 'src/repository.ts', 'src/sanitize.ts', 'src/merge.ts', 'src/cloud/engine.ts', 'src/cloud/api.ts', 'src/cloud/CloudProvider.tsx', 'api/push.ts']) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/github-token|githubPrivate|loadToken/);
    }
  });
  it('is sent to GitHub and nowhere else', () => {
    const text = readFileSync('src/githubPrivate.ts', 'utf8');
    expect([...text.matchAll(/https?:\/\/[^\s'"`/]+/g)].map((m) => m[0])).toEqual(['https://api.github.com']);
    expect(text).not.toMatch(/localhost/);
  });
});
