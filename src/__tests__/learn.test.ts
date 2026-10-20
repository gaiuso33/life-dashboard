import { describe, expect, it } from 'vitest';
import { LEARN_MAX, learnedCategory, learnedFromHistory, learnedOf, merchantKey, teach } from '../learn';
import { mergeData } from '../merge';
import { CATEGORIES } from '../money';
import { sanitize } from '../sanitize';
import { buildRows, detectDateOrder, findHeaderRow, guessCategory, guessMapping, parseCsv } from '../statement';
import { reducer } from '../store';
import { buildSummary } from '../advisorData';
import { emptyData } from '../types';
import type { AppData, Txn } from '../types';

const CATS = [...CATEGORIES] as string[];
const TODAY = '2026-10-20';
const exp = (id: string, note: string, category: string, date = '2026-10-01'): Txn => ({ id, date, kind: 'expense', amount: 1000, category, note });
const withTxns = (txns: Txn[], over: Partial<AppData['money']> = {}): AppData => {
  const d = emptyData();
  return { ...d, money: { ...d.money, txns, ...over } };
};

describe('what identifies a place', () => {
  it('ignores case, bank filler and reference numbers', () => {
    expect(merchantKey('POS PURCHASE SHOPRITE LEKKI 0048213')).toBe('shoprite lekki');
    expect(merchantKey('Shoprite  Lekki')).toBe('shoprite lekki');
    expect(merchantKey('TRANSFER TO Chicken Republic FT2231A8F99')).toBe('chicken republic');
  });
  it('keeps short digits that belong to a name', () => {
    expect(merchantKey('9mobile data')).toBe('9mobile data');
    expect(merchantKey('Bet9ja')).toBe('bet9ja');
  });
  it('has nothing to learn from an empty or number-only description', () => {
    for (const s of ['', '   ', '123456', 'POS 99887766', 'to the']) expect(merchantKey(s), s).toBeNull();
  });
  it('uses only the first few words, so a long description stays one place', () => {
    expect(merchantKey('Mama Put Kitchen Surulere Branch Two Extra')).toBe('mama put kitchen surulere');
  });
});

describe('teaching the app', () => {
  it('remembers the latest choice for a place and puts it last', () => {
    let l = teach({}, 'Shoprite', 'Food');
    l = teach(l, 'Uber', 'Transport');
    l = teach(l, 'Shoprite', 'Housing');
    expect(l).toEqual({ uber: 'Transport', shoprite: 'Housing' });
    expect(Object.keys(l)).toEqual(['uber', 'shoprite']);
  });
  it('does not learn Rewards, empty descriptions or empty categories', () => {
    expect(teach({}, 'Cinema night', 'Rewards')).toEqual({});
    expect(teach({}, '', 'Food')).toEqual({});
    expect(teach({}, 'Shoprite', '')).toEqual({});
  });
  it('never keeps more than the limit, dropping the one not used for longest', () => {
    let l = {};
    for (let i = 0; i < LEARN_MAX + 20; i++) l = teach(l, `place${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (Math.floor(i / 26) % 26))}${String.fromCharCode(97 + Math.floor(i / 676))}x`, 'Food');
    expect(Object.keys(l)).toHaveLength(LEARN_MAX);
    expect(Object.keys(l)).not.toContain('placeaaax');
  });
});

describe('what it knows before anything was taught', () => {
  it('reads the latest category for each description from existing spending', () => {
    const d = withTxns([exp('a', 'Shoprite', 'Food'), exp('b', 'Uber', 'Transport'), exp('c', 'shoprite', 'Personal care'), { ...exp('rw-1', 'Cinema', 'Rewards') }]);
    expect(learnedFromHistory(d)).toEqual({ uber: 'Transport', shoprite: 'Personal care' });
    expect(learnedCategory(d, 'SHOPRITE')).toBe('Personal care');
  });
  it('never reads Rewards from history, even when it was typed in by hand', () => {
    expect(learnedFromHistory(withTxns([exp('a', 'Cinema night', 'Rewards')]))).toEqual({});
  });
  it('ignores income and savings', () => {
    const d = withTxns([{ id: 'i', date: '2026-10-01', kind: 'income', amount: 5, category: 'Food', note: 'Shoprite' }]);
    expect(learnedFromHistory(d)).toEqual({});
  });
  it('does not suggest a category that has since been removed', () => {
    const d = withTxns([exp('a', 'Shoprite', 'Groceries')], { categories: ['Food', 'Other'] });
    expect(learnedCategory(d, 'Shoprite')).toBeNull();
  });
});

describe('lessons through the store', () => {
  it('saving an expense teaches its category', () => {
    const d = reducer(emptyData(), { t: 'txn-add', txn: exp('a', 'Shoprite Lekki', 'Food') });
    expect(d.money.learned).toEqual({ 'shoprite lekki': 'Food' });
  });
  it('income and savings teach nothing, and neither does an expense with no description', () => {
    let d = reducer(emptyData(), { t: 'txn-add', txn: { id: 'i', date: TODAY, kind: 'income', amount: 5000, note: 'Shoprite' } });
    d = reducer(d, { t: 'txn-add', txn: exp('b', '', 'Food') });
    expect(d.money.learned).toBeUndefined();
  });
  it('changing an entry’s category teaches the new one', () => {
    let d = reducer(emptyData(), { t: 'txn-add', txn: exp('a', 'Shoprite', 'Food') });
    d = reducer(d, { t: 'txn-cat', id: 'a', category: 'Personal care' });
    expect(learnedCategory(d, 'shoprite')).toBe('Personal care');
  });
  it('turns what history showed into the saved list on the first lesson, so older places are kept', () => {
    const old = withTxns([exp('a', 'Uber', 'Transport')]);
    const d = reducer(old, { t: 'txn-add', txn: exp('b', 'Shoprite', 'Food') });
    expect(d.money.learned).toEqual({ uber: 'Transport', shoprite: 'Food' });
  });
  it('an import teaches only what the person changed', () => {
    const d = reducer(emptyData(), { t: 'txn-import', txns: [exp('a', 'Shoprite', 'Food'), exp('b', 'Uber', 'Transport')], taught: [{ note: 'Uber', category: 'Entertainment' }] });
    expect(d.money.learned).toEqual({ uber: 'Entertainment' });
  });
  it('a bill paid under a category teaches it for the bill’s name', () => {
    const rent = { id: 'rent', date: '2026-10-01', title: 'Rent', kind: 'bill' as const, amount: 3500, repeat: 'monthly' as const, doneOn: [] };
    const base = { ...emptyData(), plans: [rent] };
    const d = reducer(base, { t: 'plan-pay', id: 'rent', date: '2026-10-01', txns: [exp('x', 'Rent', 'Housing')] });
    expect(d.money.learned).toEqual({ rent: 'Housing' });
  });
});

describe('seeing and deleting what it learned', () => {
  const taught = () => reducer(reducer(emptyData(), { t: 'txn-add', txn: exp('a', 'Shoprite', 'Food') }), { t: 'txn-add', txn: exp('b', 'Uber', 'Transport') });
  it('forgetting one place removes only it, and it stays forgotten even though the spending is still there', () => {
    const d = reducer(taught(), { t: 'learn-forget', key: 'uber' });
    expect(learnedOf(d)).toEqual({ shoprite: 'Food' });
    expect(learnedCategory(d, 'Uber')).toBeNull();
    expect(d.money.txns).toHaveLength(2);
  });
  it('forgetting a place that was only known from history also sticks', () => {
    const d = reducer(withTxns([exp('a', 'Uber', 'Transport')]), { t: 'learn-forget', key: 'uber' });
    expect(learnedCategory(d, 'Uber')).toBeNull();
  });
  it('forgetting everything leaves an empty list that is not refilled from history', () => {
    const d = reducer(taught(), { t: 'learn-clear' });
    expect(d.money.learned).toEqual({});
    expect(learnedOf(d)).toEqual({});
  });
  it('renaming a category carries the lessons with it and removing one drops them', () => {
    let d = reducer(taught(), { t: 'cat-rename', from: 'Food', to: 'Eating out' });
    expect(learnedCategory(d, 'Shoprite')).toBe('Eating out');
    d = reducer(d, { t: 'cat-del', name: 'Eating out' });
    expect(learnedOf(d)).toEqual({ uber: 'Transport' });
  });
});

describe('statement import', () => {
  const CSV = 'Date,Description,Debit,Credit\n2026-10-02,POS PURCHASE SHOPRITE LEKKI 12345,2500,\n2026-10-03,Chicken Republic,1800,\n2026-10-04,MTN data bundle,1000,\n';
  const build = (learned?: Record<string, string>) => {
    const { rows } = parseCsv(CSV);
    const h = findHeaderRow(rows);
    const m = guessMapping(rows[h]);
    const body = rows.slice(h + 1);
    return buildRows(body, m, detectDateOrder(body.map((r) => r[m.date] ?? '')).order, CATS, TODAY, rows[h].length, learned).rows;
  };
  it('uses a learned category before the built-in guess, for the same place written differently', () => {
    const r = build({ 'shoprite lekki': 'Personal care', 'chicken republic': 'Giving' });
    expect(r.map((x) => x.category)).toEqual(['Personal care', 'Giving', 'Data and airtime']);
  });
  it('falls back to the built-in guesses for places not learned, and when nothing is learned at all', () => {
    expect(build().map((x) => x.category)).toEqual(['Food', 'Food', 'Data and airtime']);
    expect(build({}).map((x) => x.category)).toEqual(['Food', 'Food', 'Data and airtime']);
  });
  it('ignores a learned category that no longer exists', () => {
    expect(guessCategory('Shoprite', CATS, { shoprite: 'Gone' })).toBe('Food');
  });
});

describe('saving and syncing it', () => {
  it('survives a save and load, and junk is dropped', () => {
    const d = withTxns([], { learned: { shoprite: 'Food' } });
    expect(sanitize(JSON.parse(JSON.stringify(d))).money.learned).toEqual({ shoprite: 'Food' });
    const dirty = JSON.parse(JSON.stringify(d));
    dirty.money.learned = { ok: 'Food', n: 5, '': 'Food', long: 'x'.repeat(41), ['k'.repeat(61)]: 'Food' };
    expect(sanitize(dirty).money.learned).toEqual({ ok: 'Food' });
    dirty.money.learned = ['a'];
    expect(sanitize(dirty).money.learned).toBeUndefined();
  });
  it('keeps at most 300 places, the newest', () => {
    const many = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`place${i}x`, 'Food']));
    const kept = Object.keys(sanitize(JSON.parse(JSON.stringify(withTxns([], { learned: many })))).money.learned!);
    expect(kept).toHaveLength(300);
    expect(kept[0]).toBe('place100x');
    expect(kept[299]).toBe('place399x');
  });
  it('an empty list stays empty rather than going back to being read from history', () => {
    const d = withTxns([exp('a', 'Uber', 'Transport')], { learned: {} });
    expect(sanitize(JSON.parse(JSON.stringify(d))).money.learned).toEqual({});
  });
  it('the newer device’s list wins, so a deletion is not undone by an older device', () => {
    const older = { ...withTxns([], { learned: { uber: 'Transport', shoprite: 'Food' } }), modified: '2026-10-01T00:00:00Z' };
    const newer = { ...withTxns([], { learned: { shoprite: 'Food' } }), modified: '2026-10-02T00:00:00Z' };
    expect(mergeData(older, newer).money.learned).toEqual({ shoprite: 'Food' });
    expect(mergeData(newer, older).money.learned).toEqual({ shoprite: 'Food' });
  });
  it('takes the other device’s list when this one has none', () => {
    const none = { ...withTxns([]), modified: '2026-10-02T00:00:00Z' };
    const some = { ...withTxns([], { learned: { uber: 'Transport' } }), modified: '2026-10-01T00:00:00Z' };
    expect(mergeData(none, some).money.learned).toEqual({ uber: 'Transport' });
  });
});

describe('privacy', () => {
  it('nothing learned reaches the advisor', () => {
    const d = withTxns([exp('a', 'Zxqvmarket', 'Food')], { learned: { zxqvmarket: 'Food' } });
    const text = JSON.stringify(buildSummary(d, TODAY, { training: true, body: true, money: true, career: true, rewards: true }));
    expect(text.toLowerCase()).not.toContain('zxqvmarket');
    expect(text).not.toContain('learned');
  });
});
