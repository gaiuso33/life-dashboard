import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveKey, newSalt, open, stable } from '../cloud/crypto';
import { syncOnce } from '../cloud/engine';
import type { Keys, Vault, VaultApi } from '../cloud/engine';
import { pickSecrets, readSecrets, sameSecrets } from '../cloud/secrets';
import type { Secrets } from '../cloud/secrets';
import { applySecrets, localSecrets, setSyncEnabled, syncDone, syncEnabled } from '../githubSync';
import { clearToken, loadChoices, loadStamp, loadToken, saveChoices, saveToken } from '../githubPrivate';
import { emptyData } from '../types';

const TOKEN = 'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV';
const OTHER = 'github_pat_22ZZZZZZZ0abcdefghijkl_mnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV';
const T1 = '2026-10-20T10:00:00.000Z';
const T2 = '2026-10-21T10:00:00.000Z';
const T3 = '2026-10-22T10:00:00.000Z';
const secrets = (at: string, token: string | null = TOKEN, repos = [{ name: 'me/app', allBranches: true }]): Secrets => ({ at, github: token ? { token, repos } : null });

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('reading secrets from the cloud copy', () => {
  it('reads a token with its repositories, or a removal', () => {
    expect(readSecrets({ _secrets: secrets(T1) })).toEqual(secrets(T1));
    expect(readSecrets({ _secrets: secrets(T1, null) })).toEqual(secrets(T1, null));
  });
  it('treats anything malformed as absent', () => {
    for (const bad of [undefined, null, {}, { _secrets: 'x' }, { _secrets: { at: 'not a date', github: null } }, { _secrets: { at: T1 } }, { _secrets: { at: T1, github: { token: 'hunter2', repos: [] } } }, { _secrets: { at: T1, github: { token: 5 } } }, { _secrets: { at: 5, github: null } }]) {
      expect(readSecrets(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });
  it('keeps only sensible repository choices', () => {
    const r = readSecrets({ _secrets: { at: T1, github: { token: TOKEN, repos: [{ name: 'me/ok', allBranches: true }, { name: '../x' }, { name: 'me/ok' }, null, { name: 7 }, ...Array.from({ length: 20 }, (_, i) => ({ name: `me/r${i}` }))] } } });
    expect(r?.github?.repos[0]).toEqual({ name: 'me/ok', allBranches: true });
    expect(r?.github?.repos.some((x) => x.name === '../x')).toBe(false);
    expect(r?.github?.repos).toHaveLength(10);
  });
});

describe('which copy wins', () => {
  it('a device that is not taking part leaves the cloud copy exactly as it is', () => {
    expect(pickSecrets(undefined, secrets(T1))).toEqual(secrets(T1));
    expect(pickSecrets(undefined, undefined)).toBeUndefined();
  });
  it('the newer change wins, and the cloud copy wins a tie', () => {
    expect(pickSecrets(secrets(T2, OTHER), secrets(T1))?.github?.token).toBe(OTHER);
    expect(pickSecrets(secrets(T1, OTHER), secrets(T2))?.github?.token).toBe(TOKEN);
    expect(pickSecrets(secrets(T1, OTHER), secrets(T1))?.github?.token).toBe(TOKEN);
  });
  it('a newer removal beats an older token, and an older removal does not beat a newer token', () => {
    expect(pickSecrets(secrets(T2, null), secrets(T1))?.github).toBeNull();
    expect(pickSecrets(secrets(T1, null), secrets(T2))?.github?.token).toBe(TOKEN);
  });
  it('compares by content', () => {
    expect(sameSecrets(secrets(T1), secrets(T1))).toBe(true);
    expect(sameSecrets(secrets(T1), secrets(T2))).toBe(false);
    expect(sameSecrets(undefined, undefined)).toBe(true);
    expect(sameSecrets(undefined, secrets(T1))).toBe(false);
  });
});

describe('what this device offers the cloud copy', () => {
  it('nothing, until sync is switched on', () => {
    saveToken(TOKEN);
    expect(syncEnabled()).toBe(false);
    expect(localSecrets()).toBeUndefined();
  });
  it('the token and repositories once switched on', () => {
    saveToken(TOKEN);
    saveChoices([{ name: 'me/app', allBranches: true }]);
    setSyncEnabled(true);
    const s = localSecrets()!;
    expect(s.github).toEqual({ token: TOKEN, repos: [{ name: 'me/app', allBranches: true }] });
    expect(s.at).toBe(loadStamp());
  });
  it('a device with no token that never had one does not overwrite what the cloud holds', () => {
    setSyncEnabled(true);
    expect(localSecrets()).toBeUndefined();
  });
  it('removing the token here, with sync on, offers a removal', () => {
    saveToken(TOKEN);
    setSyncEnabled(true);
    clearToken();
    const s = localSecrets()!;
    expect(s.github).toBeNull();
    expect(s.at).toBe(loadStamp());
  });
  it('switching sync off offers a removal once, then goes quiet', () => {
    saveToken(TOKEN);
    setSyncEnabled(true);
    setSyncEnabled(false);
    expect(syncEnabled()).toBe(false);
    expect(localSecrets()?.github).toBeNull();
    expect(loadToken()).toBe(TOKEN); // this device keeps its own copy
    syncDone();
    expect(localSecrets()).toBeUndefined();
  });
  it('syncDone changes nothing while sync is on', () => {
    saveToken(TOKEN);
    setSyncEnabled(true);
    syncDone();
    expect(syncEnabled()).toBe(true);
  });
  it('a broken saved state means off', () => {
    store.set('life-dashboard:github-sync', 'junk');
    expect(syncEnabled()).toBe(false);
    store.set('life-dashboard:github-sync', JSON.stringify({ on: 'yes', forgetAt: 'nope' }));
    expect(localSecrets()).toBeUndefined();
  });
});

describe('taking in what the cloud copy holds', () => {
  it('adopts a newer token on a device with sync on, keeping the time it was made', () => {
    setSyncEnabled(true);
    expect(applySecrets(secrets(T2, TOKEN, [{ name: 'me/app', allBranches: false }]))).toBe(true);
    expect(loadToken()).toBe(TOKEN);
    expect(loadChoices()).toEqual([{ name: 'me/app', allBranches: false }]);
    expect(loadStamp()).toBe(T2);
  });
  it('does nothing on a device with sync off', () => {
    expect(applySecrets(secrets(T2))).toBe(false);
    expect(loadToken()).toBe('');
  });
  it('does not replace a newer or equal token here', () => {
    saveToken(OTHER);
    setSyncEnabled(true);
    store.set('life-dashboard:github-at', T3);
    expect(applySecrets(secrets(T2))).toBe(false);
    expect(applySecrets(secrets(T3))).toBe(false);
    expect(loadToken()).toBe(OTHER);
  });
  it('replaces an older token here', () => {
    saveToken(OTHER);
    store.set('life-dashboard:github-at', T1);
    setSyncEnabled(true);
    expect(applySecrets(secrets(T2))).toBe(true);
    expect(loadToken()).toBe(TOKEN);
  });
  it('a removal in the cloud copy does not erase this device’s own token', () => {
    saveToken(TOKEN);
    setSyncEnabled(true);
    expect(applySecrets(secrets('2099-01-01T00:00:00.000Z', null))).toBe(false);
    expect(loadToken()).toBe(TOKEN);
    expect(applySecrets(undefined)).toBe(false);
  });
});

// ---------- through the real sync engine, with a stand-in for the server ----------

const ITER = 1000;
class FakeVault implements VaultApi {
  row: Vault | null = null;
  async get() {
    return this.row && { ...this.row };
  }
  async insert(v: { salt: string; blob: string }) {
    if (this.row) return null;
    this.row = { ...v, version: 1, updated_at: 'now' };
    return { ...this.row };
  }
  async update(version: number, v: { blob: string }) {
    if (!this.row || this.row.version !== version) return null;
    this.row = { ...this.row, blob: v.blob, version: version + 1 };
    return { ...this.row };
  }
}
const keys: Keys = {
  forSalt: (salt) => deriveKey('correct horse', salt, ITER),
  forNew: async () => {
    const salt = newSalt();
    return { salt, key: await deriveKey('correct horse', salt, ITER) };
  },
};
const data = (modified: string) => {
  const d = emptyData();
  d.onboarded = true;
  d.modified = modified;
  return d;
};
const decrypted = async (v: FakeVault): Promise<Record<string, unknown>> => JSON.parse(await open(await deriveKey('correct horse', v.row!.salt, ITER), v.row!.blob)) as Record<string, unknown>;

describe('the token in the encrypted cloud copy', () => {
  it('is sealed with the data: the server’s row never contains it, the passphrase reveals it', async () => {
    const vault = new FakeVault();
    const r = await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), secrets(T1));
    expect(r.status === 'ok' && r.pushed).toBe(true);
    const stored = JSON.stringify(vault.row);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain('github_pat');
    expect(stored).not.toContain('me/app');
    expect(((await decrypted(vault))._secrets as Secrets).github?.token).toBe(TOKEN);
  });
  it('does not turn up in the data that comes back, so it cannot reach a backup or the advisor', async () => {
    const vault = new FakeVault();
    await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), secrets(T1));
    const r = await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'));
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(JSON.stringify(r.data)).not.toContain(TOKEN);
      expect('_secrets' in r.data).toBe(false);
      expect(r.secrets?.github?.token).toBe(TOKEN); // handed back separately, for the device to decide
    }
  });
  it('a second device with sync on receives it', async () => {
    const vault = new FakeVault();
    await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), secrets(T1));
    const b = await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), undefined);
    expect(b.status === 'ok' && b.secrets).toEqual(secrets(T1));
  });
  it('a device that is not taking part carries it across when it pushes its own changes', async () => {
    const vault = new FakeVault();
    await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), secrets(T1));
    const changed = data('2026-10-21T00:00:00Z');
    changed.onboarded = true;
    changed.days['2026-10-21'] = { plates: {}, energy: null } as never;
    const b = await syncOnce(vault, keys, changed);
    expect(b.status === 'ok' && b.pushed).toBe(true);
    expect(((await decrypted(vault))._secrets as Secrets).github?.token, 'still there after another device pushed').toBe(TOKEN);
  });
  it('the newer token replaces the older one for everyone', async () => {
    const vault = new FakeVault();
    await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), secrets(T1));
    await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), secrets(T3, OTHER));
    expect(((await decrypted(vault))._secrets as Secrets).github?.token).toBe(OTHER);
    await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), secrets(T2, TOKEN)); // an older change arriving late loses
    expect(((await decrypted(vault))._secrets as Secrets).github?.token).toBe(OTHER);
  });
  it('removing it empties the cloud copy’s secret, and nothing is re-added by a device that has none', async () => {
    const vault = new FakeVault();
    await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), secrets(T1));
    await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), secrets(T2, null));
    expect(((await decrypted(vault))._secrets as Secrets).github).toBeNull();
    expect(JSON.stringify(vault.row)).not.toContain(TOKEN);
    const r = await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), undefined);
    expect(r.status === 'ok' && r.secrets?.github).toBeNull();
  });
  it('an unchanged cloud copy is not rewritten just to carry the same secret', async () => {
    const vault = new FakeVault();
    await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), secrets(T1));
    const v = vault.row!.version;
    const r = await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'), secrets(T1));
    expect(r.status === 'ok' && r.pushed).toBe(false);
    expect(vault.row!.version).toBe(v);
  });
  it('a cloud copy made before this existed still opens, and a damaged secret is ignored', async () => {
    const vault = new FakeVault();
    await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'));
    expect((await decrypted(vault))._secrets).toBeUndefined();
    const r = await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'));
    expect(r.status === 'ok' && r.secrets).toBeFalsy();
    // Hand-damage the secret inside a real sealed copy.
    const key = await deriveKey('correct horse', vault.row!.salt, ITER);
    const { seal } = await import('../cloud/crypto');
    vault.row = { ...vault.row!, blob: await seal(key, stable({ ...(await decrypted(vault)), _secrets: { at: T1, github: { token: 'hunter2' } } })) };
    const r2 = await syncOnce(vault, keys, data('2026-10-20T00:00:00Z'));
    expect(r2.status === 'ok' && r2.secrets).toBeFalsy();
  });
  it('sample data is still never uploaded, secret or not', async () => {
    const vault = new FakeVault();
    const sample = data('2026-10-20T00:00:00Z');
    sample.sample = true;
    const r = await syncOnce(vault, keys, sample, secrets(T1));
    expect(r.status === 'ok' && r.pushed).toBe(false);
    expect(vault.row).toBeNull();
  });
});

describe('what a downloaded backup contains', () => {
  it('is built from the data alone, with no way to reach the secrets', () => {
    for (const f of ['src/sync.ts', 'src/repository.ts', 'src/sanitize.ts', 'src/merge.ts', 'src/advisorData.ts', 'src/ai.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/_secrets|githubSync|cloud\/secrets|github-token/);
    }
  });
});
