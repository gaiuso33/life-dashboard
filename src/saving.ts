/**
 * How much the person is likely to put into the survival fund each month, worked out from whole calendar months of income,
 * spending and savings. Plain arithmetic on their own entries; nothing leaves the device.
 *
 * It is built for income that arrives in lumps:
 *  - a big one-off (a bonus, a laptop, a trip) is left out, so one odd month does not become the new normal;
 *  - the range is widened the more uneven the income is;
 *  - what is left after spending is worked out too, so the person can see room to save that they are not using yet.
 */
import { percentile } from './projection';
import type { Confidence } from './projection';
import type { AppData, Txn } from './types';

export const MIN_MONTHS = 3;
export const MAX_MONTHS = 6;
/** A kind of entry needs at least this many in the window before any of them can be called unusual. */
export const MIN_ENTRIES = 5;
/** A one-off is at least this many times the usual (median) entry of its kind... */
export const ONE_OFF_TIMES = 3;
/** ...and at least this share of everything of its kind in the window... */
export const ONE_OFF_SHARE = 0.1;
/** ...with nothing within this much of its size in any other month (rent that comes every month is not a one-off). */
export const SIMILAR = 0.25;
/** How far the range is stretched when income is as uneven as it gets: the slow side shrinks and the fast side grows by this share. */
export const WIDEN = 0.5;
/** Income this uneven (variation as a share of its average) counts as fully lumpy. */
export const LUMPY_AT = 1;

export interface OneOff {
  id: string;
  kind: 'income' | 'expense' | 'saving';
  amount: number;
  date: string;
}

export interface MonthFigures {
  ym: string;
  income: number;
  spent: number;
  saved: number;
}

export interface SavingEstimate {
  /** Whole months the estimate stands on. */
  months: number;
  /** Money put into the survival fund per month: a slow, a typical and a fast month. */
  slow: number;
  typical: number;
  fast: number;
  /** Average income minus average spending per month, or null when income is not logged often enough to say. */
  leftOver: number | null;
  /** 0 when income is steady, 1 when it arrives in big uneven lumps. Zero when income is not logged. */
  lumpy: number;
  /** Entries left out of the figures because they look like one-offs. */
  oneOffs: OneOff[];
  confidence: Confidence;
}

const ym = (date: string) => date.slice(0, 7);
function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split('-').map(Number);
  const i = y * 12 + (m - 1) + by;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/**
 * Whole calendar months logging was on for, oldest first. The month in progress is left out (its income may not have arrived yet),
 * and so is the month logging began in, unless that was in its first five days.
 */
export function completeMonths(data: AppData, today: string): string[] {
  let first: string | null = null;
  for (const t of data.money.txns) if (first == null || t.date < first) first = t.date;
  if (first == null) return [];
  const last = shiftMonth(ym(today), -1);
  const start = first.slice(8, 10) <= '05' ? ym(first) : shiftMonth(ym(first), 1);
  const out: string[] = [];
  for (let m = start; m <= last; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

const median = (xs: number[]) => percentile(xs, 0.5);

/** Entries that are far bigger than the person's usual ones of this kind and happen only once. Needs enough entries to judge. */
function oneOffsOf(entries: Txn[], kind: OneOff['kind']): OneOff[] {
  if (entries.length < MIN_ENTRIES) return [];
  const usual = median(entries.map((t) => t.amount));
  const total = entries.reduce((n, t) => n + t.amount, 0);
  return entries
    .filter(
      (t) =>
        t.amount >= ONE_OFF_TIMES * usual &&
        t.amount >= ONE_OFF_SHARE * total &&
        !entries.some((o) => o.id !== t.id && ym(o.date) !== ym(t.date) && Math.abs(o.amount - t.amount) <= SIMILAR * t.amount),
    )
    .map((t) => ({ id: t.id, kind, amount: t.amount, date: t.date }));
}

const survivalSaving = (t: Txn) => t.kind === 'saving' && (t.fund ?? 'survival') === 'survival';

/** Income, spending and savings for each month, leaving out the entries named in `skip`. */
export function monthFigures(data: AppData, months: string[], skip: Set<string> = new Set()): MonthFigures[] {
  const out = months.map((m) => ({ ym: m, income: 0, spent: 0, saved: 0 }));
  const at = new Map(out.map((f) => [f.ym, f]));
  for (const t of data.money.txns) {
    const f = at.get(ym(t.date));
    if (!f || skip.has(t.id)) continue;
    if (t.kind === 'income') f.income += t.amount;
    else if (t.kind === 'expense') f.spent += t.amount;
    else if (survivalSaving(t)) f.saved += t.amount;
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const spread = (xs: number[]) => {
  const m = mean(xs);
  return m > 0 ? Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m : 0;
};
const step = (c: Confidence, down: boolean): Confidence => (down ? (c === 'high' ? 'medium' : 'low') : c);

/** Null until there are at least three whole months to look at. */
export function savingEstimate(data: AppData, today: string): SavingEstimate | null {
  const all = completeMonths(data, today);
  const months = all.slice(-MAX_MONTHS);
  if (months.length < MIN_MONTHS) return null;

  const window = new Set(months);
  const inWindow = data.money.txns.filter((t) => window.has(ym(t.date)));
  const oneOffs = [
    ...oneOffsOf(inWindow.filter((t) => t.kind === 'income'), 'income'),
    ...oneOffsOf(inWindow.filter((t) => t.kind === 'expense'), 'expense'),
    ...oneOffsOf(inWindow.filter(survivalSaving), 'saving'),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const figures = monthFigures(data, months, new Set(oneOffs.map((o) => o.id)));

  const saved = figures.map((f) => f.saved);
  const incomes = figures.map((f) => f.income);
  const typical = mean(saved);
  const incomeKnown = incomes.filter((i) => i > 0).length >= 2;
  const lumpy = incomeKnown ? Math.min(1, spread(incomes) / LUMPY_AT) : 0;
  const slow = Math.min(percentile(saved, 0.2), typical) * (1 - WIDEN * lumpy);
  const fast = Math.max(percentile(saved, 0.8), typical) * (1 + WIDEN * lumpy);
  const leftOver = incomeKnown ? mean(figures.map((f) => f.income - f.spent)) : null;
  const base: Confidence = months.length >= MAX_MONTHS ? 'high' : months.length > MIN_MONTHS ? 'medium' : 'low';
  return { months: months.length, slow: Math.max(0, slow), typical, fast, leftOver, lumpy, oneOffs, confidence: step(base, lumpy > 0.6) };
}

export interface SavingBacktest {
  /** How many past forecasts could be checked. */
  n: number;
  /** Average miss, in money per month. */
  mae: number;
  /** Share of the time the real pace landed inside the range. */
  inside: number;
}

/** How many months ahead each replayed forecast is checked against. */
export const CHECK_MONTHS = 2;

/**
 * Replays history: standing at the start of each past month with only what was logged before it, what would the estimate have
 * said, and how did the next two months actually go (everything counted, one-offs included)?
 */
export function backtestSaving(data: AppData, today: string): SavingBacktest | null {
  const all = completeMonths(data, today);
  let n = 0;
  let abs = 0;
  let inside = 0;
  for (let i = MIN_MONTHS; i + CHECK_MONTHS - 1 < all.length; i++) {
    const from = `${all[i]}-01`;
    // Standing at `from`, the estimate reads only whole months before it, so nothing logged later can leak into it.
    const est = savingEstimate(data, from);
    if (!est) continue;
    const next = monthFigures(data, all.slice(i, i + CHECK_MONTHS));
    const actual = mean(next.map((f) => f.saved));
    n++;
    abs += Math.abs(actual - est.typical);
    if (actual >= est.slow && actual <= est.fast) inside++;
  }
  return n >= 3 ? { n, mae: abs / n, inside: inside / n } : null;
}

export const ONE_OFF_WORD: Record<OneOff['kind'], string> = { income: 'income', expense: 'spending', saving: 'saving' };
