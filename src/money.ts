import type { AppData, FundKey, Txn } from './types';
import { addDays, dayNumber, mondayOf } from './utils';

export const CATEGORIES = [
  'Food',
  'Transport',
  'Data and airtime',
  'Housing',
  'Personal care',
  'Health and gym',
  'Giving',
  'Entertainment',
  'Rewards',
  'Other',
] as const;

export const PROTECTED_CATEGORIES = ['Rewards', 'Other'];
export const categoriesOf = (data: AppData): string[] => data.money.categories ?? [...CATEGORIES];

export const DAYS_PER_MONTH = 30.4375;
/** Days of spending history needed before the survival target is calculated from real data. */
export const HISTORY_NEEDED = 28;

export const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`;
export const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n)));

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const total = (txns: Txn[]) => txns.reduce((n, t) => n + t.amount, 0);

export const txnsOn = (data: AppData, date: string) => data.money.txns.filter((t) => t.date === date);

export function monthTotals(data: AppData, ym: string) {
  const inMonth = data.money.txns.filter((t) => t.date.startsWith(ym));
  const expenses = inMonth.filter((t) => t.kind === 'expense');
  const byCategory: Record<string, number> = {};
  for (const t of expenses) byCategory[t.category ?? 'Other'] = (byCategory[t.category ?? 'Other'] ?? 0) + t.amount;
  return {
    spent: total(expenses),
    income: total(inMonth.filter((t) => t.kind === 'income')),
    saved: total(inMonth.filter((t) => t.kind === 'saving')),
    byCategory,
  };
}

export function firstExpenseDate(data: AppData): string | null {
  let first: string | null = null;
  for (const t of data.money.txns) if (t.kind === 'expense' && (!first || t.date < first)) first = t.date;
  return first;
}

/** Average monthly spending over the last 90 days (or less), once at least a month of history exists. */
export function avgMonthlySpend(data: AppData, today: string): number | null {
  const first = firstExpenseDate(data);
  if (!first) return null;
  const days = dayNumber(today) - dayNumber(first) + 1;
  if (days < HISTORY_NEEDED) return null;
  const window = Math.min(days, 90);
  const from = addDays(today, -(window - 1));
  const spent = total(data.money.txns.filter((t) => t.kind === 'expense' && t.date >= from && t.date <= today));
  return (spent / window) * DAYS_PER_MONTH;
}

export interface SurvivalTarget {
  target: number | null;
  monthly: number | null;
  basis: 'tracked' | 'estimate' | null;
  daysTracked: number;
}

/** Target = 6 x average monthly spending. Falls back to the rough daily estimate until a month is logged. */
export function survivalTarget(data: AppData, today: string): SurvivalTarget {
  const first = firstExpenseDate(data);
  const daysTracked = first ? dayNumber(today) - dayNumber(first) + 1 : 0;
  const avg = avgMonthlySpend(data, today);
  if (avg != null) return { target: Math.round(avg * 6), monthly: avg, basis: 'tracked', daysTracked };
  const est = data.money.dailyEstimate;
  if (est != null && est > 0) {
    const monthly = est * DAYS_PER_MONTH;
    return { target: Math.round(monthly * 6), monthly, basis: 'estimate', daysTracked };
  }
  return { target: null, monthly: null, basis: null, daysTracked };
}

export function fundBalance(data: AppData, fund: FundKey): number {
  const saved = total(data.money.txns.filter((t) => t.kind === 'saving' && (t.fund ?? 'survival') === fund));
  return saved + (fund === 'survival' ? data.money.survivalOpening : 0);
}

/** Average saved per month over the last 8 weeks. */
export function monthlySavingPace(data: AppData, today: string): number {
  const from = addDays(today, -55);
  const saved = total(data.money.txns.filter((t) => t.kind === 'saving' && t.date >= from && t.date <= today));
  return (saved / 56) * DAYS_PER_MONTH;
}

export function weekHasSaving(data: AppData, monday: string): boolean {
  const end = addDays(monday, 6);
  return data.money.txns.some((t) => t.kind === 'saving' && t.date >= monday && t.date <= end);
}

export const suggestedSave = (income: number, pct: number) => Math.round((income * pct) / 100);

export function spendByWeek(data: AppData, today: string, weeks: number) {
  const thisMonday = mondayOf(today);
  const out: { monday: string; spent: number }[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const monday = addDays(thisMonday, -7 * w);
    const end = addDays(monday, 6);
    out.push({
      monday,
      spent: total(data.money.txns.filter((t) => t.kind === 'expense' && t.date >= monday && t.date <= end)),
    });
  }
  return out;
}

export function lastCategoryForNote(data: AppData, note: string): string | null {
  const key = note.trim().toLowerCase();
  if (!key) return null;
  for (let i = data.money.txns.length - 1; i >= 0; i--) {
    const t = data.money.txns[i];
    if (t.kind === 'expense' && t.category && t.note.trim().toLowerCase() === key) return t.category;
  }
  return null;
}
