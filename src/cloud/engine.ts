import { mergeData } from '../merge';
import { isAppData, normalize } from '../repository';
import type { AppData } from '../types';
import { open, seal, stable, WrongKeyError } from './crypto';
import { pickSecrets, readSecrets, sameSecrets } from './secrets';
import type { Secrets } from './secrets';

/** One encrypted row per account. `version` only goes up and is what stops two devices overwriting each other. */
export interface Vault {
  salt: string;
  blob: string;
  version: number;
  updated_at: string;
}

export interface VaultApi {
  get(): Promise<Vault | null>;
  /** Returns null if a copy already exists (another device got there first). */
  insert(v: { salt: string; blob: string }): Promise<Vault | null>;
  /** Returns null if the stored version is no longer `version`. */
  update(version: number, v: { blob: string }): Promise<Vault | null>;
}

/** Where encryption keys come from. `null` means the passphrase is needed. */
export interface Keys {
  forSalt(salt: string): Promise<CryptoKey | null>;
  forNew(): Promise<{ salt: string; key: CryptoKey } | null>;
}

export type SyncResult =
  | { status: 'ok'; data: AppData; pushed: boolean; pulled: boolean; at: string; secrets?: Secrets }
  | { status: 'locked'; reason: 'passphrase' | 'wrong' }
  | { status: 'busy' };

const MAX_TRIES = 4;

/**
 * Pulls the cloud copy, merges it with this device's data, and pushes the result back if it added anything.
 * Merging is the same code used for file imports, so it never loses entries. If another device wrote in between,
 * the loop simply starts again from the newer copy.
 */
/** What is sealed: the data, and beside it (not in it) the secrets, if any. */
const payload = (data: AppData, secrets: Secrets | undefined): string => stable(secrets ? { ...data, _secrets: secrets } : data);

/**
 * `secrets` is what this device adds to the cloud copy (see cloud/secrets.ts); leave it out and whatever the cloud copy holds is
 * carried across unchanged.
 */
export async function syncOnce(api: VaultApi, keys: Keys, local: AppData, secrets?: Secrets): Promise<SyncResult> {
  let current = local;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const remote = await api.get();
    const at = new Date().toISOString();
    if (!remote) {
      // Sample data is never uploaded: it would only get in the way of the real thing later.
      if (current.sample) return { status: 'ok', data: current, pushed: false, pulled: false, at };
      const first = pickSecrets(secrets, undefined);
      const k = await keys.forNew();
      if (!k) return { status: 'locked', reason: 'passphrase' };
      const created = await api.insert({ salt: k.salt, blob: await seal(k.key, payload(current, first)) });
      if (created) return { status: 'ok', data: current, pushed: true, pulled: false, at, ...(first && { secrets: first }) };
      continue;
    }
    const key = await keys.forSalt(remote.salt);
    if (!key) return { status: 'locked', reason: 'passphrase' };
    let remoteData: AppData;
    let remoteSecrets: Secrets | undefined;
    try {
      const parsed: unknown = JSON.parse(await open(key, remote.blob));
      if (!isAppData(parsed)) throw new WrongKeyError();
      remoteSecrets = readSecrets(parsed);
      remoteData = normalize(parsed);
    } catch (e) {
      if (e instanceof WrongKeyError || e instanceof SyntaxError) return { status: 'locked', reason: 'wrong' };
      throw e;
    }
    const merged = mergeData(current, remoteData);
    const chosen = pickSecrets(secrets, remoteSecrets);
    const out = chosen ? { secrets: chosen } : {};
    if (stable(merged) === stable(remoteData) && sameSecrets(chosen, remoteSecrets)) return { status: 'ok', data: merged, pushed: false, pulled: stable(merged) !== stable(local), at, ...out };
    const updated = await api.update(remote.version, { blob: await seal(key, payload(merged, chosen)) });
    if (updated) return { status: 'ok', data: merged, pushed: true, pulled: stable(merged) !== stable(local), at, ...out };
    current = merged;
  }
  return { status: 'busy' };
}
