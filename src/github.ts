import { addDays, dayNumber, todayKey, toKey } from './utils';

/** How far back a sync looks. */
export const SYNC_DAYS = 90;
const PER_PAGE = 100;
const MAX_PAGES = 5;

export class GitHubError extends Error {}

export interface CommitSync {
  /** Commits per local date. */
  byDate: Record<string, number>;
  repos: string[];
  total: number;
  /** True when GitHub had more commits than one sync reads, so the oldest days may be partial. */
  truncated: boolean;
  since: string;
  /** Days from this date on are complete; earlier days in the window may be partial. */
  completeFrom: string;
}

interface SearchItem {
  commit?: { author?: { date?: string } };
  repository?: { full_name?: string };
}

const USERNAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export function cleanUsername(input: string): string {
  return input.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//i, '').replace(/[/?#].*$/, '');
}

/**
 * Counts the user's public commits on default branches over the last 90 days, using GitHub's
 * commit search (no sign-in needed). Dates are bucketed in the viewer's local time.
 */
export async function fetchCommits(rawUser: string, fetchImpl: typeof fetch = fetch): Promise<CommitSync> {
  const user = cleanUsername(rawUser);
  if (!USERNAME.test(user)) throw new GitHubError('That doesn’t look like a GitHub username. Use just the name, like octocat.');

  const today = todayKey();
  const since = addDays(today, -(SYNC_DAYS - 1));
  const byDate: Record<string, number> = {};
  const repos = new Set<string>();
  let total = 0;
  let available = 0;
  let oldest: string | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetchImpl(
        `https://api.github.com/search/commits?q=${encodeURIComponent(`author:${user} author-date:>=${since}`)}&sort=author-date&order=desc&per_page=${PER_PAGE}&page=${page}`,
        { headers: { Accept: 'application/vnd.github+json' } },
      );
    } catch {
      throw new GitHubError('Couldn’t reach GitHub. Check your connection and try again.');
    }
    if (res.status === 403 || res.status === 429) throw new GitHubError('GitHub’s limit for anonymous requests was reached. Try again in a minute or two.');
    if (res.status === 404 || res.status === 422) throw new GitHubError(`GitHub couldn’t find commits for “${user}”. Check the spelling of the username.`);
    if (!res.ok) throw new GitHubError(`GitHub answered with an error (${res.status}). Try again in a moment.`);

    let body: { total_count?: number; items?: SearchItem[] };
    try {
      body = await res.json();
    } catch {
      throw new GitHubError('GitHub sent something unexpected. Try again in a moment.');
    }
    const items = Array.isArray(body.items) ? body.items : [];
    available = typeof body.total_count === 'number' ? body.total_count : available;

    for (const it of items) {
      const iso = it.commit?.author?.date;
      if (!iso) continue;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) continue;
      const k = toKey(d);
      byDate[k] = (byDate[k] ?? 0) + 1;
      total++;
      if (it.repository?.full_name) repos.add(it.repository.full_name);
      if (oldest == null || k < oldest) oldest = k;
    }
    if (items.length < PER_PAGE) break;
  }

  const truncated = available > total;
  // The oldest day we read may have more commits we never reached, so only trust days after it.
  const completeFrom = truncated && oldest ? addDays(oldest, 1) : since;
  return { byDate, repos: [...repos].sort(), total, truncated, since, completeFrom };
}

/**
 * Folds a sync into the stored counts. Days GitHub fully covered are replaced by the fresh numbers;
 * days it may only partly cover keep whichever count is higher; days before the window are left alone.
 */
export function mergeCommits(existing: Record<string, number>, sync: CommitSync, today: string = todayKey()): Record<string, number> {
  const out = { ...existing };
  const span = dayNumber(today) - dayNumber(sync.since);
  for (let i = 0; i <= span; i++) {
    const k = addDays(sync.since, i);
    const fresh = sync.byDate[k] ?? 0;
    const next = k < sync.completeFrom ? Math.max(existing[k] ?? 0, fresh) : fresh;
    if (next > 0) out[k] = next;
    else delete out[k];
  }
  return out;
}
