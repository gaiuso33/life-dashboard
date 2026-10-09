import type { AppData, PlanItem, PlanKind } from './types';
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
