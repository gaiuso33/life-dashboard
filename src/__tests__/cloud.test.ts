import { describe, expect, it } from 'vitest';
import { deriveKey, newSalt, open, seal, stable, WrongKeyError } from '../cloud/crypto';
import { syncOnce } from '../cloud/engine';
import type { Keys, Vault, VaultApi } from '../cloud/engine';
import { emptyData } from '../types';
import type { AppData } from '../types';

const ITER = 1000; // fast for tests; the app uses 600,000
const tx = (id: string) => ({ id, date: '2026-10-01', kind: 'expense' as const, amount: 100, category: 'Food', note: '' });
const dev = (modified: string, fn: (d: AppData) => void = () => {}) => {
  const d = emptyData();
  d.onboarded = true;
  d.modified = modified;
  fn(d);
  return d;
};

/** An in-memory stand-in for the server table, with the same version rules. */
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

const keysFor = (pass: string | null): Keys => ({
  forSalt: async (salt) => (pass ? deriveKey(pass, salt, ITER) : null),
  forNew: async () => {
    if (!pass) return null;
    const salt = newSalt();
    return { salt, key: await deriveKey(pass, salt, ITER) };
  },
});

describe('crypto', () => {
  it('round-trips and rejects the wrong passphrase or tampering', async () => {
    const salt = newSalt();
    const k = await deriveKey('correct horse', salt, ITER);
    const sealed = await seal(k, 'héllo ✓');
    expect(sealed).not.toContain('llo');
    expect(await open(k, sealed)).toBe('héllo ✓');
    await expect(open(await deriveKey('wrong', salt, ITER), sealed)).rejects.toBeInstanceOf(WrongKeyError);
    const env = JSON.parse(sealed);
    env.ct = env.ct.slice(0, -4) + 'AAAA';
    await expect(open(k, JSON.stringify(env))).rejects.toBeInstanceOf(WrongKeyError);
    await expect(open(k, 'not json')).rejects.toBeInstanceOf(WrongKeyError);
  });
  it('never repeats a ciphertext for the same text', async () => {
    const k = await deriveKey('p', newSalt(), ITER);
    expect(await seal(k, 'same')).not.toBe(await seal(k, 'same'));
  });
  it('stable() ignores key order', () => expect(stable({ b: 1, a: { d: 1, c: [2, { z: 1, y: undefined }] } })).toBe(stable({ a: { c: [2, { z: 1 }], d: 1 }, b: 1 })));
});

describe('syncOnce', () => {
  it('first device uploads, nothing readable is stored', async () => {
    const server = new FakeVault();
    const phone = dev('2026-10-09T10:00:00Z', (d) => (d.money.txns = [tx('secret-note-1')]));
    const r = await syncOnce(server, keysFor('pw'), phone);
    expect(r.status === 'ok' && r.pushed).toBe(true);
    expect(server.row?.blob).not.toContain('secret-note-1');
    expect(server.row?.blob).not.toContain('txns');
  });

  it('second device pulls, merges and both end up identical', async () => {
    const server = new FakeVault();
    const phone = dev('2026-10-09T10:00:00Z', (d) => (d.money.txns = [tx('p1')]));
    const laptop = dev('2026-10-09T11:00:00Z', (d) => (d.money.txns = [tx('l1')]));
    await syncOnce(server, keysFor('pw'), phone);
    const l = await syncOnce(server, keysFor('pw'), laptop);
    if (l.status !== 'ok') throw new Error('expected ok');
    expect(l.data.money.txns.map((t) => t.id).sort()).toEqual(['l1', 'p1']);
    const p = await syncOnce(server, keysFor('pw'), phone);
    if (p.status !== 'ok') throw new Error('expected ok');
    expect(stable(p.data)).toBe(stable(l.data));
    // and a further sync with nothing new pushes nothing
    const v = server.row!.version;
    const again = await syncOnce(server, keysFor('pw'), p.data);
    expect(again.status === 'ok' && !again.pushed).toBe(true);
    expect(server.row!.version).toBe(v);
  });

  it('a brand-new empty device receives everything and is marked set up', async () => {
    const server = new FakeVault();
    await syncOnce(server, keysFor('pw'), dev('2026-10-09T10:00:00Z', (d) => (d.money.txns = [tx('p1')])));
    const fresh = emptyData();
    fresh.onboarded = false;
    const r = await syncOnce(server, keysFor('pw'), fresh);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.data.money.txns).toHaveLength(1);
    expect(r.data.onboarded).toBe(true);
  });

  it('deletions travel between devices', async () => {
    const server = new FakeVault();
    const a = dev('2026-10-09T10:00:00Z', (d) => (d.money.txns = [tx('x'), tx('y')]));
    await syncOnce(server, keysFor('pw'), a);
    const b0 = await syncOnce(server, keysFor('pw'), emptyData());
    if (b0.status !== 'ok') throw new Error();
    const b = { ...b0.data, money: { ...b0.data.money, txns: b0.data.money.txns.filter((t) => t.id !== 'x') }, gone: [...b0.data.gone, 'x'], modified: '2026-10-09T12:00:00Z' };
    await syncOnce(server, keysFor('pw'), b);
    const a2 = await syncOnce(server, keysFor('pw'), a);
    if (a2.status !== 'ok') throw new Error();
    expect(a2.data.money.txns.map((t) => t.id)).toEqual(['y']);
  });

  it('asks for the passphrase when there is none, and refuses a wrong one without touching the server', async () => {
    const server = new FakeVault();
    await syncOnce(server, keysFor('right'), dev('2026-10-09T10:00:00Z'));
    const before = JSON.stringify(server.row);
    expect(await syncOnce(server, keysFor(null), dev('2026-10-09T11:00:00Z'))).toEqual({ status: 'locked', reason: 'passphrase' });
    expect(await syncOnce(server, keysFor('wrong'), dev('2026-10-09T11:00:00Z'))).toEqual({ status: 'locked', reason: 'wrong' });
    expect(JSON.stringify(server.row)).toBe(before);
    expect(await syncOnce(new FakeVault(), keysFor(null), dev('2026-10-09T11:00:00Z'))).toEqual({ status: 'locked', reason: 'passphrase' });
  });

  it('a write from another device in between is merged, not overwritten', async () => {
    const server = new FakeVault();
    const base = dev('2026-10-09T09:00:00Z');
    await syncOnce(server, keysFor('pw'), base);
    const mine = { ...base, money: { ...base.money, txns: [tx('mine')] }, modified: '2026-10-09T10:00:00Z' };
    const theirs = { ...base, money: { ...base.money, txns: [tx('theirs')] }, modified: '2026-10-09T10:30:00Z' };
    // simulate the race precisely: other device syncs after our get() but before our update()
    let raced = false;
    const racing: VaultApi = {
      get: () => server.get(),
      insert: (v) => server.insert(v),
      update: async (ver, v) => {
        if (!raced) {
          raced = true;
          await syncOnce(server, keysFor('pw'), theirs);
        }
        return server.update(ver, v);
      },
    };
    const r = await syncOnce(racing, keysFor('pw'), mine);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.data.money.txns.map((t) => t.id).sort()).toEqual(['mine', 'theirs']);
    const check = await syncOnce(server, keysFor('pw'), emptyData());
    if (check.status !== 'ok') throw new Error();
    expect(check.data.money.txns.map((t) => t.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('two devices that both find the server empty end with one copy and no data lost', async () => {
    const server = new FakeVault();
    let raced = false;
    const racing: VaultApi = {
      get: async () => {
        const r = await server.get();
        if (!r && !raced) {
          raced = true;
          await syncOnce(server, keysFor('pw'), dev('2026-10-09T10:00:00Z', (d) => (d.money.txns = [tx('theirs')])));
        }
        return r;
      },
      insert: (v) => server.insert(v),
      update: (a, b) => server.update(a, b),
    };
    const r = await syncOnce(racing, keysFor('pw'), dev('2026-10-09T11:00:00Z', (d) => (d.money.txns = [tx('mine')])));
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.data.money.txns.map((t) => t.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('gives up cleanly (busy) if the server keeps changing underneath', async () => {
    const server = new FakeVault();
    await syncOnce(server, keysFor('pw'), dev('2026-10-09T09:00:00Z'));
    const hostile: VaultApi = { get: () => server.get(), insert: (v) => server.insert(v), update: async () => null };
    const r = await syncOnce(hostile, keysFor('pw'), dev('2026-10-09T10:00:00Z', (d) => (d.money.txns = [tx('a')])));
    expect(r).toEqual({ status: 'busy' });
  });

  it('sample data on one side is never mixed into the real cloud copy', async () => {
    const server = new FakeVault();
    await syncOnce(server, keysFor('pw'), dev('2026-10-09T10:00:00Z', (d) => (d.money.txns = [tx('real')])));
    const sample = dev('2026-10-09T12:00:00Z');
    sample.sample = true;
    const r = await syncOnce(server, keysFor('pw'), sample);
    if (r.status !== 'ok') throw new Error();
    expect(r.data.sample).toBeFalsy();
    expect(r.data.money.txns.map((t) => t.id)).toEqual(['real']);
  });

  it('sample data is not uploaded to an empty cloud', async () => {
    const server = new FakeVault();
    const sample = dev('2026-10-09T12:00:00Z');
    sample.sample = true;
    const r = await syncOnce(server, keysFor('pw'), sample);
    expect(r.status === 'ok' && !r.pushed).toBe(true);
    expect(server.row).toBeNull();
  });
});
