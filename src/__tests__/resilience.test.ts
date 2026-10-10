import { beforeEach, describe, expect, it } from 'vitest';
import { buildSummary } from '../advisorData';
import { evaluateBadges } from '../badges';
import { dailyNudges, weeklyReview } from '../coach';
import { dayScore } from '../derive';
import { forecasts } from '../forecast';
import { mergeData } from '../merge';
import { monthCells, plansBetween } from '../plan';
import { LocalRepository, KEY, normalize, readBackup, restoreBackup } from '../repository';
import { sanitize } from '../sanitize';
import { buildSampleData } from '../sample';
import type { AppData } from '../types';
import { emptyData } from '../types';

/** Minimal browser storage for the node test environment. */
function installStorage(opts: { quota?: boolean } = {}) {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.quota) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage: ls, addEventListener() {}, removeEventListener() {} };
  return store;
}

/** A small deterministic random generator, so a failure can be reproduced. */
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function corrupt(value: unknown, rand: () => number, depth = 0): unknown {
  const junk = [null, undefined, 'x', '', -1, 1e12, NaN, [], {}, true, [null], { a: 1 }, '2026-13-45'];
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [...value] : { ...(value as object) };
    const keys = Object.keys(copy);
    for (const k of keys) {
      const r = rand();
      if (r < 0.06) (copy as Record<string, unknown>)[k] = junk[Math.floor(rand() * junk.length)];
      else if (r < 0.1 && !Array.isArray(copy)) delete (copy as Record<string, unknown>)[k];
      else if (depth < 6) (copy as Record<string, unknown>)[k] = corrupt((copy as Record<string, unknown>)[k], rand, depth + 1);
    }
    return copy;
  }
  return value;
}

describe('damaged data never crashes the app logic', () => {
  const base = JSON.parse(JSON.stringify(buildSampleData())) as AppData;
  const today = '2026-10-09';

  it('survives 300 random corruptions of a full dashboard', () => {
    const rand = rng(12345);
    for (let i = 0; i < 300; i++) {
      const bad = corrupt(base, rand) as AppData;
      // The loader's gate: anything that fails it is treated as unreadable, never used.
      let d: AppData;
      try {
        d = normalize({ ...bad, version: 1, days: bad.days ?? {}, sessions: bad.sessions ?? {}, body: Array.isArray(bad.body) ? bad.body : [] } as AppData);
      } catch (e) {
        throw new Error(`normalize threw on case ${i}: ${e}`);
      }
      expect(() => {
        evaluateBadges(d, today);
        dailyNudges(d, today);
        weeklyReview(d, '2026-10-05', today);
        forecasts(d, today);
        buildSummary(d, today, { training: true, body: true, money: true, career: true, rewards: true });
        dayScore(d, today);
        plansBetween(d, '2026-10-01', '2026-10-31');
        monthCells('2026-10');
        mergeData(d, base);
        JSON.stringify(d);
      }, `case ${i}`).not.toThrow();
    }
  });

  it('is idempotent: cleaning clean data changes nothing', () => {
    const once = sanitize(base);
    expect(JSON.stringify(sanitize(once))).toBe(JSON.stringify(once));
  });

  it('keeps real data intact', () => {
    const d = sanitize(base);
    expect(d.money.txns.length).toBe(base.money.txns.length);
    expect(Object.keys(d.sessions).length).toBe(Object.keys(base.sessions).length);
    expect(d.body.length).toBe(base.body.length);
  });

  it('drops only the bad records', () => {
    const d = emptyData();
    const raw = JSON.parse(JSON.stringify(d));
    raw.money.txns = [{ id: 'ok', date: '2026-10-01', kind: 'expense', amount: 5, note: '' }, { id: 'bad', date: 'nope', kind: 'expense', amount: 5 }, null, 'x', { id: 'neg', date: '2026-10-01', kind: 'expense', amount: -5 }];
    expect(sanitize(raw).money.txns.map((t) => t.id)).toEqual(['ok']);
  });
});

describe('storage', () => {
  beforeEach(() => void installStorage());

  it('reports an empty device', async () => expect(await new LocalRepository().load()).toEqual({ status: 'empty' }));

  it('round-trips a save', async () => {
    const repo = new LocalRepository();
    const d = buildSampleData();
    expect(await repo.save(d)).toEqual({ ok: true });
    const res = await new LocalRepository().load();
    expect(res.status).toBe('ok');
  });

  it('never overwrites unreadable data and keeps a copy of it', async () => {
    const store = installStorage();
    store.set(KEY, '{"version":1,"days":');
    const res = await new LocalRepository().load();
    expect(res.status).toBe('damaged');
    expect(res.status === 'damaged' && res.raw).toBe('{"version":1,"days":');
    expect(store.get('life-dashboard:v1:damaged')).toBe('{"version":1,"days":');
  });

  it('treats a file with the wrong shape as unreadable', async () => {
    installStorage().set(KEY, '{"hello":1}');
    expect((await new LocalRepository().load()).status).toBe('damaged');
  });

  it('writes a daily backup and can restore it', async () => {
    const store = installStorage();
    const repo = new LocalRepository();
    await repo.save(buildSampleData());
    await new LocalRepository().load();
    expect(store.get('life-dashboard:v1:backup')).toBeTruthy();
    expect(readBackup()?.data.sample).toBe(true);
    store.set(KEY, 'garbage');
    expect(restoreBackup()).toBe(true);
    expect((await new LocalRepository().load()).status).toBe('ok');
  });

  it('does not rewrite the backup within a day', async () => {
    const store = installStorage();
    await new LocalRepository().save(buildSampleData());
    await new LocalRepository().load();
    const first = store.get('life-dashboard:v1:backup-at');
    await new LocalRepository().load();
    expect(store.get('life-dashboard:v1:backup-at')).toBe(first);
  });

  it('says so when storage is full', async () => {
    installStorage({ quota: true });
    expect(await new LocalRepository().save(emptyData())).toEqual({ ok: false, reason: 'full' });
  });
});
