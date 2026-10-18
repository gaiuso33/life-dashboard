import { suggestedSave } from './money';
import type { AppData, FundKey, PlanItem, PlanKind, Txn } from './types';
import { addDays, fromKey, mondayOf, pad } from './utils';

export const KIND_LABEL: Record<PlanKind, string> = { bill: 'Bill', income: 'Income', task: 'Task', event: 'Event' };

const lastDayOfMonth = (date: string) => {
  const d = fromKey(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
};

/** Monthly items repeat on the same day number, or on the last day when a month is shorter. */
export function occursOn(item: PlanItem, date: string): boolean {
  if (item.repeat === 'none') return item.date === date;
  if (date < item.date) return false;
  const want = Number(item.date.slice(8, 10));
  return Number(date.slice(8, 10)) === Math.min(want, lastDayOfMonth(date));
}

export interface Occurrence {
  item: PlanItem;
  date: string;
  done: boolean;
}

export function plansOn(data: AppData, date: string): Occurrence[] {
  return data.plans.filter((p) => occursOn(p, date)).map((item) => ({ item, date, done: item.doneOn.includes(date) }));
}

export function plansBetween(data: AppData, from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(...plansOn(data, d));
  return out;
}

export const monthKey = (date: string) => date.slice(0, 7);
export const monthStart = (ym: string) => `${ym}-01`;
export const monthEnd = (ym: string) => `${ym}-${pad(lastDayOfMonth(`${ym}-01`))}`;
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export const monthTitle = (ym: string) => fromKey(monthStart(ym)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/** Whole weeks, Monday first, covering the month. */
export function monthCells(ym: string): string[] {
  const first = mondayOf(monthStart(ym));
  const lastMon = mondayOf(monthEnd(ym));
  const out: string[] = [];
  for (let d = first; d <= addDays(lastMon, 6); d = addDays(d, 1)) out.push(d);
  return out;
}

/** What is due in the next few days and not yet done. */
export function dueSoon(data: AppData, today: string, days = 2): Occurrence[] {
  return plansBetween(data, today, addDays(today, days)).filter((o) => !o.done);
}

// ---- Ticking a bill or income item records it in Money. ----
// The Money entry gets an id made from the planned item and the day it was due, so the link needs no extra stored data and
// two devices that both tick the same bill agree on the same entry (a merge keeps one, not two).

export const linkBase = (itemId: string, date: string) => `plan:${itemId}:${date}`;

/** True for the entry made by ticking one occurrence, its income-split saving (`:save`), and one made by ticking it again after an untick (`:2`). */
export function isLinkedTxnId(id: string, itemId: string, date: string): boolean {
  const base = linkBase(itemId, date);
  return id.startsWith(base) && /^(:\d+)?(:save)?$/.test(id.slice(base.length));
}

export const linkedTxns = (data: AppData, itemId: string, date: string): Txn[] => data.money.txns.filter((t) => isLinkedTxnId(t.id, itemId, date));

/** The id for a new entry. An entry that was removed stays removed everywhere (its id is in `gone`), so ticking again needs the next free id. */
export function freshLinkBase(data: AppData, itemId: string, date: string): string {
  const dead = new Set(data.gone);
  const base = linkBase(itemId, date);
  for (let n = 1; n < 1000; n++) {
    const id = n === 1 ? base : `${base}:${n}`;
    if (!dead.has(id)) return id;
  }
  return `${base}:${Date.now().toString(36)}`;
}

export interface PayChoice {
  amount: number;
  category: string;
  date: string;
  /** Income only: also move the usual share into savings. */
  split: boolean;
  fund: FundKey;
}

/** The Money entries to create when an occurrence is ticked. Bills are expenses; income is income, plus its savings split if asked for. */
export function payTxns(item: PlanItem, base: string, c: PayChoice, savePct: number): Txn[] {
  if (item.kind === 'income') {
    const out: Txn[] = [{ id: base, date: c.date, kind: 'income', amount: c.amount, note: item.title }];
    const save = suggestedSave(c.amount, savePct);
    if (c.split && save > 0) out.push({ id: `${base}:save`, date: c.date, kind: 'saving', amount: save, fund: c.fund, note: 'From income split' });
    return out;
  }
  return [{ id: base, date: c.date, kind: 'expense', amount: c.amount, category: c.category, note: item.title }];
}

/** Only bills and income with an amount can become a Money entry. */
export const recordable = (item: PlanItem): boolean => (item.kind === 'bill' || item.kind === 'income') && item.amount > 0;
