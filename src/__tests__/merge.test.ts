import { describe, expect, it } from 'vitest';
import { describeGains, mergeData } from '../merge';
import { buildSampleData } from '../sample';
import { emptyData } from '../types';
import type { AppData } from '../types';

const tx = (id: string, date = '2026-10-01', amount = 100) => ({ id, date, kind: 'expense' as const, amount, category: 'Food', note: '' });
const mk = (modified: string, patch: (d: AppData) => void = () => {}) => {
  const d = emptyData();
  d.modified = modified;
  patch(d);
  return d;
};
// Arrays of records with ids are compared as sets, so the order of merging doesn't matter.
const norm = (d: unknown) => JSON.stringify(d, (_k, v) => (Array.isArray(v) && v.every((x) => x && typeof x === 'object' && 'id' in x) ? [...v].sort((a, b) => a.id.localeCompare(b.id)) : v));

describe('mergeData', () => {
  const A = mk('2026-10-09T10:00:00Z', (d) => {
    d.money.txns = [tx('a1'), tx('shared')];
    d.days['2026-10-08'] = { code: true, energy: 2 };
    d.sessions['2026-10-07|pull'] = { date: '2026-10-07', day: 'pull', loads: { Row: 'blue' }, reps: { Row: [8, 8, null, null] }, finished: false };
    d.rewards.badges = { x: '2026-09-01' };
    d.plans = [{ id: 'p', date: '2026-10-12', title: 't', kind: 'bill', amount: 1, repeat: 'monthly', doneOn: ['2026-10-12'] }];
    d.career.commits = { '2026-10-01': 3 };
  });
  const B = mk('2026-10-09T12:00:00Z', (d) => {
    d.money.txns = [tx('b1'), tx('shared')];
    d.days['2026-10-08'] = { money: true, energy: 4 };
    d.sessions['2026-10-07|pull'] = { date: '2026-10-07', day: 'pull', loads: { Row: '' }, reps: { Row: [null, null, 7, 6] }, finished: true };
    d.rewards.badges = { x: '2026-08-01', y: '2026-10-01' };
    d.plans = [{ id: 'p', date: '2026-10-12', title: 't', kind: 'bill', amount: 1, repeat: 'monthly', doneOn: ['2026-11-12'] }];
    d.career.commits = { '2026-10-01': 5, '2026-10-02': 1 };
  });
  const M = mergeData(A, B);

  it('keeps entries from both devices once', () => expect(M.money.txns.map((t) => t.id).sort()).toEqual(['a1', 'b1', 'shared']));
  it('combines habit flags and takes the newer energy score', () => expect(M.days['2026-10-08']).toEqual({ code: true, money: true, energy: 4 }));
  it('combines reps set by set and keeps loads', () => {
    const s = M.sessions['2026-10-07|pull'];
    expect(s.reps.Row).toEqual([8, 8, 7, 6]);
    expect(s.finished).toBe(true);
    expect(s.loads.Row).toBe('blue');
  });
  it('keeps the earliest badge date, higher commit counts and all plan completions', () => {
    expect(M.rewards.badges).toEqual({ x: '2026-08-01', y: '2026-10-01' });
    expect(M.career.commits).toEqual({ '2026-10-01': 5, '2026-10-02': 1 });
    expect(M.plans[0].doneOn).toHaveLength(2);
  });
  it('gives the same result in either order and when repeated', () => {
    expect(norm(mergeData(B, A))).toBe(norm(M));
    expect(norm(mergeData(M, B))).toBe(norm(M));
    expect(norm(mergeData(M, A))).toBe(norm(M));
  });
  it('keeps deletions in both directions', () => {
    const C = mk('2026-10-09T13:00:00Z', (d) => {
      d.money.txns = [tx('a1')];
      d.gone = ['shared'];
    });
    expect(mergeData(B, C).money.txns.some((t) => t.id === 'shared')).toBe(false);
    expect(mergeData(C, B).money.txns.some((t) => t.id === 'shared')).toBe(false);
    expect(describeGains(B, mergeData(B, C)).join(' ')).toContain('removed here');
  });
  it('never mixes sample and real data', () => {
    const S = buildSampleData();
    expect(mergeData(S, A).sample).toBe(false);
    expect(mergeData(A, S).sample).toBe(false);
  });
  it('reports nothing new for an identical copy', () => expect(describeGains(M, M)).toEqual([]));
});

describe('per-setting recency', () => {
  it('keeps an older customised setting over an untouched newer device', () => {
    const L = mk('2026-10-01T10:00:00Z', (d) => {
      d.money.savePct = 25;
      d.stamps = { savePct: '2026-10-01T10:00:00Z', program: '2026-10-01T10:00:00Z' };
      d.program = [] as never;
    });
    const P = mk('2026-10-09T10:00:00Z');
    for (const m of [mergeData(L, P), mergeData(P, L)]) {
      expect(m.money.savePct).toBe(25);
      expect(m.program).toBeDefined();
    }
  });
  it('lets a newer deliberate reset win', () => {
    const L = mk('2026-10-01T10:00:00Z', (d) => {
      d.stamps = { program: '2026-10-01T10:00:00Z' };
      d.program = [] as never;
    });
    const P = mk('2026-10-09T10:00:00Z', (d) => {
      d.stamps = { program: '2026-10-09T09:00:00Z' };
    });
    expect(mergeData(L, P).program).toBeUndefined();
  });
  it('keeps any category an entry uses', () => {
    const L = mk('2026-10-01T10:00:00Z', (d) => {
      d.money.categories = ['Food', 'Rewards', 'Other'];
      d.stamps = { categories: '2026-10-09T11:00:00Z' };
    });
    const P = mk('2026-10-09T10:00:00Z', (d) => {
      d.money.txns = [{ ...tx('t'), category: 'Tithes' }];
    });
    const cats = mergeData(L, P).money.categories!;
    expect(cats).toContain('Tithes');
    expect(cats[cats.length - 1]).toBe('Other');
  });
});
