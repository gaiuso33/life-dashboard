import { isRepo, looksLikeToken } from '../githubPrivate';
import type { RepoChoice } from '../githubPrivate';

// Things that must reach a person's other devices but must never be part of their data: today, only the optional GitHub token and
// the repositories chosen with it. They travel inside the same end-to-end encrypted cloud copy as everything else (the server sees
// only the sealed blob), beside the data rather than in it, so they are never in a downloaded backup, never merged like entries
// and never seen by the advisor.
//
// There is one value, newest write wins. `github: null` means "nothing is kept in the cloud".

export interface Secrets {
  /** When this was last changed on any device (ISO time). */
  at: string;
  github: { token: string; repos: RepoChoice[] } | null;
}

const isoOk = (s: unknown): s is string => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));

/** Reads the secrets out of a decrypted cloud copy. Anything malformed is treated as absent. */
export function readSecrets(parsed: unknown): Secrets | undefined {
  const raw = (parsed as { _secrets?: unknown } | null)?._secrets as { at?: unknown; github?: unknown } | undefined;
  if (!raw || typeof raw !== 'object' || !isoOk(raw.at)) return undefined;
  if (raw.github === null) return { at: raw.at, github: null };
  const g = raw.github as { token?: unknown; repos?: unknown } | undefined;
  if (!g || typeof g !== 'object' || typeof g.token !== 'string' || !looksLikeToken(g.token)) return undefined;
  const repos: RepoChoice[] = [];
  for (const r of Array.isArray(g.repos) ? g.repos : []) {
    const o = r as { name?: unknown; allBranches?: unknown };
    if (typeof o?.name === 'string' && isRepo(o.name) && !repos.some((x) => x.name === o.name)) repos.push({ name: o.name, allBranches: o.allBranches === true });
  }
  return { at: raw.at, github: { token: g.token.trim(), repos: repos.slice(0, 10) } };
}

/**
 * Which copy wins. `local` is undefined when this device is not taking part (it neither adds to nor removes from the cloud copy,
 * which is carried across unchanged). Otherwise the newer change wins, and the cloud copy wins a tie.
 */
export function pickSecrets(local: Secrets | undefined, remote: Secrets | undefined): Secrets | undefined {
  if (!local) return remote;
  if (!remote) return local.github || local.at ? local : undefined;
  return Date.parse(local.at) > Date.parse(remote.at) ? local : remote;
}

export const sameSecrets = (a: Secrets | undefined, b: Secrets | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
