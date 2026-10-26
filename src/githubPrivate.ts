import { SYNC_DAYS, GitHubError, cleanUsername } from './github';
import type { CommitSync } from './github';
import { addDays, todayKey, toKey } from './utils';

// Private repositories and other branches, for people who choose to give the app a read-only GitHub token.
//
// The token lives in its own storage slot on this device, like the AI keys: never inside the app data, so never in a backup file,
// the cloud copy, the advisor's summary or what the push server is told. It is sent only to api.github.com, in a header (never in
// an address), and no message the app shows ever contains it.

const TOKEN_SLOT = 'life-dashboard:github-token';
const REPOS_SLOT = 'life-dashboard:github-repos';
/** When the token or the chosen repositories last changed on this device (or arrived from the cloud copy). Decides which copy is newer. */
const STAMP_SLOT = 'life-dashboard:github-at';

export const MAX_REPOS = 10;
export const MAX_BRANCHES = 10;
const PER_PAGE = 100;
const MAX_PAGES = 2;
const API = 'https://api.github.com';

export interface RepoChoice {
  /** "owner/name". */
  name: string;
  /** Count commits on every branch (up to MAX_BRANCHES), not only the default one. */
  allBranches: boolean;
}

const REPO_SHAPE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
/** "owner/name", and neither half may be only dots: "../x" would otherwise reach a different GitHub address. */
export const isRepo = (n: string): boolean => REPO_SHAPE.test(n) && n.split('/').every((p) => !/^\.+$/.test(p));

/** The two token shapes GitHub issues for people: fine-grained (github_pat_) and classic (ghp_). */
export const looksLikeToken = (t: string): boolean => /^(github_pat_[A-Za-z0-9_]{20,255}|gh[pousr]_[A-Za-z0-9]{20,255})$/.test(t.trim());
export const maskToken = (t: string): string => (t.length > 8 ? `…${t.slice(-4)}` : '…');

const read = (k: string): string => {
  try {
    return window.localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const write = (k: string, v: string | null): boolean => {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
};

export const loadToken = (): string => read(TOKEN_SLOT);
export const loadStamp = (): string => read(STAMP_SLOT);
const touch = () => void write(STAMP_SLOT, new Date().toISOString());
export const saveToken = (t: string): boolean => {
  const ok = write(TOKEN_SLOT, t.trim());
  if (ok) touch();
  return ok;
};
/** Forgets the token and the repositories chosen with it. (It stays valid at GitHub until it is revoked there.) */
export function clearToken(): void {
  write(TOKEN_SLOT, null);
  write(REPOS_SLOT, null);
  touch();
}
/** Puts in place a token and choices that arrived from the cloud copy, keeping the time they were made rather than "now". */
export function adoptToken(token: string, repos: RepoChoice[], at: string): boolean {
  const ok = write(TOKEN_SLOT, token) && write(REPOS_SLOT, JSON.stringify(repos.slice(0, MAX_REPOS)));
  if (ok) write(STAMP_SLOT, at);
  return ok;
}

export function loadChoices(): RepoChoice[] {
  try {
    const raw = JSON.parse(read(REPOS_SLOT) || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const out: RepoChoice[] = [];
    for (const r of raw) {
      const o = r as { name?: unknown; allBranches?: unknown };
      if (typeof o?.name === 'string' && isRepo(o.name) && !out.some((x) => x.name === o.name)) out.push({ name: o.name, allBranches: o.allBranches === true });
    }
    return out.slice(0, MAX_REPOS);
  } catch {
    return [];
  }
}
export const saveChoices = (c: RepoChoice[]): boolean => {
  const ok = write(REPOS_SLOT, JSON.stringify(c.slice(0, MAX_REPOS)));
  if (ok) touch();
  return ok;
};

// ---------- talking to GitHub ----------

async function get(path: string, token: string, fetchImpl: typeof fetch): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(`${API}${path}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } });
  } catch {
    throw new GitHubError('Couldn’t reach GitHub. Check your connection and try again.');
  }
  if (res.status === 401) throw new GitHubError('GitHub didn’t accept the token. It may be wrong, expired or revoked.');
  if (res.status === 403 || res.status === 429) throw new GitHubError('GitHub refused the request: the token may lack permission, or a rate limit was reached. Try again in a minute or two.');
  return res;
}

const json = async <T,>(res: Response): Promise<T> => {
  try {
    return (await res.json()) as T;
  } catch {
    throw new GitHubError('GitHub sent something unexpected. Try again in a moment.');
  }
};

export interface TokenCheck {
  login: string;
  /** True when this is a classic token carrying a scope that lets it change things, not only read. Fine-grained tokens do not report scopes. */
  canWrite: boolean;
  classic: boolean;
}

/** Scopes that let a classic token do more than read. `repo` is the only way a classic token reads private code, and it can also write. */
const WRITE_SCOPES = /^(repo|workflow|delete_repo|write:|admin:|public_repo|security_events)/;

export async function checkToken(token: string, fetchImpl: typeof fetch = fetch): Promise<TokenCheck> {
  const res = await get('/user', token, fetchImpl);
  if (!res.ok) throw new GitHubError(`GitHub answered with an error (${res.status}). Try again in a moment.`);
  const body = await json<{ login?: string }>(res);
  if (typeof body.login !== 'string') throw new GitHubError('GitHub sent something unexpected. Try again in a moment.');
  const header = res.headers.get('x-oauth-scopes');
  const scopes = header == null ? null : header.split(',').map((s) => s.trim()).filter(Boolean);
  return { login: body.login, classic: scopes != null, canWrite: !!scopes?.some((s) => WRITE_SCOPES.test(s)) };
}

export interface RepoInfo {
  name: string;
  private: boolean;
}

/** The repositories the token can read, most recently pushed first (the first 100). */
export async function listRepos(token: string, fetchImpl: typeof fetch = fetch): Promise<RepoInfo[]> {
  const res = await get(`/user/repos?per_page=${PER_PAGE}&sort=pushed&affiliation=owner,collaborator,organization_member`, token, fetchImpl);
  if (!res.ok) throw new GitHubError(`GitHub answered with an error (${res.status}). Try again in a moment.`);
  const body = await json<{ full_name?: string; private?: boolean }[]>(res);
  return (Array.isArray(body) ? body : []).filter((r) => typeof r?.full_name === 'string' && isRepo(r.full_name)).map((r) => ({ name: r.full_name as string, private: r.private === true }));
}

interface CommitItem {
  sha?: string;
  commit?: { author?: { date?: string } };
}

export interface PrivateSync extends Omit<CommitSync, 'completeFrom'> {
  /** Commits found, by sha, so ones already counted from the public search are not counted twice. */
  shas: string[];
}

/**
 * Commits by the user in the chosen repositories (and branches) over the sync window. A commit that is on several branches, or
 * was already counted by the public search (`known`), is counted once.
 */
export async function fetchPrivateCommits(token: string, rawUser: string, choices: RepoChoice[], known: ReadonlySet<string>, fetchImpl: typeof fetch = fetch): Promise<PrivateSync> {
  const user = cleanUsername(rawUser);
  const since = addDays(todayKey(), -(SYNC_DAYS - 1));
  // Midnight local time on the first day, as an instant, with a day of slack: the exact day is decided by each commit's own date below.
  const sinceIso = new Date(`${addDays(since, -1)}T00:00:00Z`).toISOString();
  const seen = new Set(known);
  const byDate: Record<string, number> = {};
  const repos = new Set<string>();
  const shas: string[] = [];
  let total = 0;
  let truncated = false;

  for (const choice of choices.slice(0, MAX_REPOS)) {
    let branches: (string | undefined)[] = [undefined];
    if (choice.allBranches) {
      const res = await get(`/repos/${choice.name}/branches?per_page=${PER_PAGE}`, token, fetchImpl);
      if (res.status === 404) throw new GitHubError(`The token can’t see ${choice.name}. Check that it was given access to that repository.`);
      if (!res.ok) throw new GitHubError(`GitHub answered with an error (${res.status}). Try again in a moment.`);
      const raw = await json<{ name?: string }[]>(res);
      const list = (Array.isArray(raw) ? raw : []).filter((b) => typeof b?.name === 'string').map((b) => b.name as string);
      if (list.length > MAX_BRANCHES) truncated = true;
      branches = list.slice(0, MAX_BRANCHES);
    }
    for (const branch of branches) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const q = `author=${encodeURIComponent(user)}&since=${encodeURIComponent(sinceIso)}&per_page=${PER_PAGE}&page=${page}${branch ? `&sha=${encodeURIComponent(branch)}` : ''}`;
        const res = await get(`/repos/${choice.name}/commits?${q}`, token, fetchImpl);
        if (res.status === 404 || res.status === 409) {
          // 409 is an empty repository.
          if (res.status === 404) throw new GitHubError(`The token can’t see ${choice.name}. Check that it was given access to that repository.`);
          break;
        }
        if (!res.ok) throw new GitHubError(`GitHub answered with an error (${res.status}). Try again in a moment.`);
        const items = await json<CommitItem[]>(res);
        const list = Array.isArray(items) ? items : [];
        for (const it of list) {
          const iso = it?.commit?.author?.date;
          if (typeof it?.sha !== 'string' || !iso || seen.has(it.sha)) continue;
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) continue;
          const k = toKey(d);
          if (k < since) continue;
          seen.add(it.sha);
          shas.push(it.sha);
          byDate[k] = (byDate[k] ?? 0) + 1;
          total++;
          repos.add(choice.name);
        }
        if (list.length < PER_PAGE) break;
        if (page === MAX_PAGES) truncated = true;
      }
    }
  }
  return { byDate, repos: [...repos].sort(), total, truncated, since, shas };
}

/**
 * Adds the private commits to the public ones. If the private part is cut short, the days in question are only trusted as far as
 * the cut (a partial count never lowers one already stored). The oldest private day is where a cut can have happened.
 */
export function combineSyncs(pub: CommitSync, priv: PrivateSync): CommitSync {
  const byDate = { ...pub.byDate };
  for (const [k, n] of Object.entries(priv.byDate)) byDate[k] = (byDate[k] ?? 0) + n;
  const oldestPrivate = Object.keys(priv.byDate).sort()[0];
  const privateCut = priv.truncated && oldestPrivate ? addDays(oldestPrivate, 1) : priv.since;
  return {
    byDate,
    repos: [...new Set([...pub.repos, ...priv.repos])].sort(),
    total: pub.total + priv.total,
    truncated: pub.truncated || priv.truncated,
    since: pub.since,
    completeFrom: pub.completeFrom > privateCut ? pub.completeFrom : privateCut,
    shas: [...(pub.shas ?? []), ...priv.shas],
  };
}

/** The result to use when the private part failed: the public commits only, and no stored day is lowered or cleared. */
export const publicOnly = (pub: CommitSync, today: string = todayKey()): CommitSync => ({ ...pub, completeFrom: addDays(today, 1) });
