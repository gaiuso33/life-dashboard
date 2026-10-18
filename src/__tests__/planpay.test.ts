import { describe, expect, it } from 'vitest';
import { mergeData } from '../merge';
import { activeFundOf, fundBalance, monthTotals, weekHasSaving } from '../money';
import { savedInRange } from '../rewards';
import { freshLinkBase, isLinkedTxnId, linkBase, linkedTxns, payTxns, recordable } from '../plan';
import { sanitize } from '../sanitize';
import { reducer } from '../store';
import { emptyData } from '../types';
import type { AppData, PlanItem } from '../types';

const RENT: PlanItem = { id: 'rent', date: '2026-10-01', title: 'Rent', kind: 'bill', amount: 3500, repeat: 'monthly', doneOn: [] };
const PAY: PlanItem = { id: 'pay', date: '2026-10-05', title: 'Salary', kind: 'income', amount: 50000, repeat: 'monthly', doneOn: [] };
const TASK: PlanItem = { id: 'task', date: '2026-10-05', title: 'Finish login page', kind: 'task', amount: 0, repeat: 'none', doneOn: [] };

const withPlans = (modified = '2026-10-09T10:00:00Z'): AppData => ({ ...emptyData(), modified, plans: [{ ...RENT }, { ...PAY }, { ...TASK }] });
const choice = { amount: 3500, category: 'Housing', date: '2026-10-01', split: true, fund: 'survival' as const };
const pay = (d: AppData, item: PlanItem, date: string, c = choice) => reducer(d, { t: 'plan-pay', id: item.id, date, txns: payTxns(item, freshLinkBase(d, item.id, date), c, d.money.savePct) });

describe('which Money entries belong to a tick', () => {
  it('recognises the entry, its savings split and a re-tick, for exactly that item and day', () => {
    const base = linkBase('rent', '2026-10-01');
    for (const id of [base, `${base}:save`, `${base}:2`, `${base}:2:save`, `${base}:13`]) expect(isLinkedTxnId(id, 'rent', '2026-10-01'), id).toBe(true);
    for (const id of ['abc123', linkBase('rent', '2026-11-01'), linkBase('rental', '2026-10-01'), linkBase('rent', '2026-10-01') + 'x', `${base}:`, `${base}:save:save`, `${base}:2:3`]) expect(isLinkedTxnId(id, 'rent', '2026-10-01'), id).toBe(false);
  });
  it('only bills and income with an amount can be recorded', () => {
    expect(recordable(RENT)).toBe(true);
    expect(recordable(PAY)).toBe(true);
    expect(recordable({ ...RENT, amount: 0 })).toBe(false);
    expect(recordable(TASK)).toBe(false);
    expect(recordable({ ...TASK, kind: 'event', amount: 500 })).toBe(false);
  });
  it('picks the next free id once an earlier entry has been removed', () => {
    const d = { ...emptyData(), gone: [linkBase('rent', '2026-10-01'), `${linkBase('rent', '2026-10-01')}:2`] };
    expect(freshLinkBase(d, 'rent', '2026-10-01')).toBe(`${linkBase('rent', '2026-10-01')}:3`);
    expect(freshLinkBase(emptyData(), 'rent', '2026-10-01')).toBe(linkBase('rent', '2026-10-01'));
  });
});

describe('what a tick creates', () => {
  it('a bill becomes an expense with the chosen category, date and the bill’s name', () => {
    const [t, ...rest] = payTxns(RENT, 'b', { ...choice, amount: 3000, date: '2026-10-03' }, 20);
    expect(rest).toEqual([]);
    expect(t).toEqual({ id: 'b', date: '2026-10-03', kind: 'expense', amount: 3000, category: 'Housing', note: 'Rent' });
  });
  it('income becomes income, with the usual share moved to savings when asked', () => {
    const out = payTxns(PAY, 'p', { ...choice, amount: 50000, split: true }, 20);
    expect(out.map((t) => [t.id, t.kind, t.amount, t.fund])).toEqual([['p', 'income', 50000, undefined], ['p:save', 'saving', 10000, 'survival']]);
    expect(payTxns(PAY, 'p', { ...choice, amount: 50000, split: false }, 20)).toHaveLength(1);
    expect(payTxns(PAY, 'p', { ...choice, amount: 50000, split: true }, 0)).toHaveLength(1);
    expect(payTxns(PAY, 'p', { ...choice, amount: 1, split: true }, 20)).toHaveLength(1); // rounds to nothing
  });
});

describe('ticking and unticking', () => {
  it('ticks and records in one step', () => {
    const d = pay(withPlans(), RENT, '2026-10-01');
    expect(d.plans[0].doneOn).toEqual(['2026-10-01']);
    expect(d.money.txns).toHaveLength(1);
    expect(linkedTxns(d, 'rent', '2026-10-01')).toHaveLength(1);
  });
  it('does not record twice if the same tick arrives again', () => {
    const once = pay(withPlans(), RENT, '2026-10-01');
    const twice = reducer(once, { t: 'plan-pay', id: 'rent', date: '2026-10-01', txns: payTxns(RENT, linkBase('rent', '2026-10-01'), choice, 20) });
    expect(twice.money.txns).toHaveLength(1);
    expect(twice.plans[0].doneOn).toEqual(['2026-10-01']);
  });
  it('each month is its own occurrence with its own entry', () => {
    let d = pay(withPlans(), RENT, '2026-10-01');
    d = pay(d, RENT, '2026-11-01', { ...choice, date: '2026-11-01' });
    expect(d.money.txns.map((t) => t.date).sort()).toEqual(['2026-10-01', '2026-11-01']);
    expect(d.plans[0].doneOn).toEqual(['2026-10-01', '2026-11-01']);
    expect(linkedTxns(d, 'rent', '2026-10-01')).toHaveLength(1);
  });
  it('"just tick" records nothing', () => {
    const d = reducer(withPlans(), { t: 'plan-toggle', id: 'rent', date: '2026-10-01' });
    expect(d.plans[0].doneOn).toEqual(['2026-10-01']);
    expect(d.money.txns).toEqual([]);
  });
  it('unticking and removing takes back the entry and its savings split, and they stay removed', () => {
    const ticked = pay(withPlans(), PAY, '2026-10-05', { ...choice, amount: 50000, split: true });
    expect(ticked.money.txns).toHaveLength(2);
    const back = reducer(ticked, { t: 'plan-toggle', id: 'pay', date: '2026-10-05', removeEntries: true });
    expect(back.plans[1].doneOn).toEqual([]);
    expect(back.money.txns).toEqual([]);
    expect(back.gone).toEqual(expect.arrayContaining([linkBase('pay', '2026-10-05'), `${linkBase('pay', '2026-10-05')}:save`]));
  });
  it('unticking but keeping leaves the entries alone', () => {
    const ticked = pay(withPlans(), RENT, '2026-10-01');
    const back = reducer(ticked, { t: 'plan-toggle', id: 'rent', date: '2026-10-01' });
    expect(back.plans[0].doneOn).toEqual([]);
    expect(back.money.txns).toHaveLength(1);
    expect(back.gone).toEqual([]);
  });
  it('ticking again after removing makes a new entry rather than being blocked by the removed one', () => {
    let d = pay(withPlans(), RENT, '2026-10-01');
    d = reducer(d, { t: 'plan-toggle', id: 'rent', date: '2026-10-01', removeEntries: true });
    d = pay(d, RENT, '2026-10-01');
    expect(d.money.txns.map((t) => t.id)).toEqual([`${linkBase('rent', '2026-10-01')}:2`]);
    // and the new entry survives a merge with a copy that still remembers the removed one
    expect(mergeData(d, withPlans()).money.txns.map((t) => t.id)).toEqual([`${linkBase('rent', '2026-10-01')}:2`]);
  });
  it('removeEntries only touches entries made by that tick, never ones logged by hand', () => {
    let d = pay(withPlans(), RENT, '2026-10-01');
    d = reducer(d, { t: 'txn-add', txn: { id: 'manual', date: '2026-10-01', kind: 'expense', amount: 3500, category: 'Housing', note: 'Rent' } });
    d = reducer(d, { t: 'plan-toggle', id: 'rent', date: '2026-10-01', removeEntries: true });
    expect(d.money.txns.map((t) => t.id)).toEqual(['manual']);
  });
  it('tasks tick and untick as before', () => {
    const d = reducer(reducer(withPlans(), { t: 'plan-toggle', id: 'task', date: '2026-10-05' }), { t: 'plan-toggle', id: 'task', date: '2026-10-05' });
    expect(d.plans[2].doneOn).toEqual([]);
  });
});

describe('two devices', () => {
  it('both ticking the same bill give one entry, not two', () => {
    const laptop = pay(withPlans('2026-10-09T10:00:00Z'), RENT, '2026-10-01');
    const phone = pay(withPlans('2026-10-09T10:05:00Z'), RENT, '2026-10-01');
    const merged = mergeData(laptop, phone);
    expect(merged.money.txns).toHaveLength(1);
    expect(merged.plans[0].doneOn).toEqual(['2026-10-01']);
    expect(mergeData(merged, laptop).money.txns).toHaveLength(1);
  });
  it('a removal on one device is not undone by a device that still has the entry', () => {
    const both = pay(withPlans('2026-10-09T10:00:00Z'), RENT, '2026-10-01');
    const phone = reducer({ ...both, modified: '2026-10-09T11:00:00Z' }, { t: 'plan-toggle', id: 'rent', date: '2026-10-01', removeEntries: true });
    expect(mergeData(both, phone).money.txns).toEqual([]);
    expect(mergeData(phone, both).money.txns).toEqual([]);
  });
  it('linked entries survive loading a saved copy', () => {
    const d = pay(withPlans(), PAY, '2026-10-05', { ...choice, amount: 50000, split: true });
    const loaded = sanitize(JSON.parse(JSON.stringify(d)));
    expect(loaded.money.txns.map((t) => t.id)).toEqual(d.money.txns.map((t) => t.id));
    expect(linkedTxns(loaded, 'pay', '2026-10-05')).toHaveLength(2);
  });
});

describe('what a recorded tick feeds into', () => {
  it('a bill shows in the month’s spending, and taking it back removes it', () => {
    const d = pay(withPlans(), RENT, '2026-10-01');
    expect(monthTotals(d, '2026-10').spent).toBe(3500);
    const back = reducer(d, { t: 'plan-toggle', id: 'rent', date: '2026-10-01', removeEntries: true });
    expect(monthTotals(back, '2026-10').spent).toBe(0);
  });
  it('income and its savings split reach the month totals, the survival fund and the weekly savings check', () => {
    const d = pay(withPlans(), PAY, '2026-10-05', { ...choice, amount: 50000, date: '2026-10-05', split: true });
    const m = monthTotals(d, '2026-10');
    expect(m.income).toBe(50000);
    expect(fundBalance(d, 'survival')).toBe(10000);
    expect(fundBalance(d, 'investment')).toBe(0);
    expect(weekHasSaving(d, '2026-10-05')).toBe(true);
  });
  it('the reward rule that needs a savings transfer is met by a ticked salary with the split, and not without it', () => {
    const withSplit = pay(withPlans(), PAY, '2026-10-05', { ...choice, amount: 50000, date: '2026-10-05', split: true });
    const without = pay(withPlans(), PAY, '2026-10-05', { ...choice, amount: 50000, date: '2026-10-05', split: false });
    expect(savedInRange(withSplit, '2026-10-05', '2026-10-11')).toBe(true);
    expect(savedInRange(without, '2026-10-05', '2026-10-11')).toBe(false);
  });
  it('savings go to the survival fund until its target is reached', () => {
    expect(activeFundOf(withPlans(), '2026-10-09')).toBe('survival');
  });
});
