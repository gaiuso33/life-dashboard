import type { Secrets } from './cloud/secrets';
import { adoptToken, loadChoices, loadStamp, loadToken } from './githubPrivate';

// Whether this device keeps its GitHub token in the person's encrypted cloud copy. Off until they switch it on, per device.
// What travels is described in cloud/secrets.ts.

const SLOT = 'life-dashboard:github-sync';

interface State {
  on: boolean;
  /** Set when sync was switched off: the next sync removes the token from the cloud copy, then this is cleared. */
  forgetAt?: string;
}

const readState = (): State => {
  try {
    const o = JSON.parse(window.localStorage.getItem(SLOT) ?? 'null') as { on?: unknown; forgetAt?: unknown } | null;
    return { on: o?.on === true, ...(typeof o?.forgetAt === 'string' && !Number.isNaN(Date.parse(o.forgetAt)) && { forgetAt: o.forgetAt }) };
  } catch {
    return { on: false };
  }
};
const writeState = (s: State): void => {
  try {
    window.localStorage.setItem(SLOT, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
};

export const syncEnabled = (): boolean => readState().on;

/** Switching on starts keeping the token in the cloud copy. Switching off removes it from there on the next sync. */
export function setSyncEnabled(on: boolean): void {
  writeState(on ? { on: true } : { on: false, forgetAt: new Date().toISOString() });
}

/** What this device contributes to the cloud copy, or undefined when it is not taking part. */
export function localSecrets(): Secrets | undefined {
  const s = readState();
  if (s.on) {
    const token = loadToken();
    // Nothing to say yet if there is no token and none was ever removed here: the cloud copy, if any, wins.
    if (!token && !loadStamp()) return undefined;
    return { at: loadStamp() || new Date(0).toISOString(), github: token ? { token, repos: loadChoices() } : null };
  }
  return s.forgetAt ? { at: s.forgetAt, github: null } : undefined;
}

/** Takes in what the cloud copy holds. Only a device that has sync switched on adopts anything, and only if it is newer than its own. */
export function applySecrets(cloud: Secrets | undefined): boolean {
  if (!syncEnabled() || !cloud?.github) return false;
  const mine = loadStamp();
  if (mine && Date.parse(cloud.at) <= Date.parse(mine)) return false;
  return adoptToken(cloud.github.token, cloud.github.repos, cloud.at);
}

/** Called after a sync went through: a pending removal from the cloud copy has now been carried out. */
export function syncDone(): void {
  if (readState().forgetAt) writeState({ on: false });
}
