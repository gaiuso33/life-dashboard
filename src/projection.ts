import type { AppData, BodyEntry } from './types';
import { DAYS_PER_MONTH } from './money';
import { addDays, dayNumber, mondayOf } from './utils';

// The statistics behind the forecasts. Everything here is plain arithmetic on the person's own logs: a straight-line fit with an
// honest prediction range, a back-test of how past forecasts held up, and "slow / typical / fast" paces from how steady the history is.

export type Confidence = 'low' | 'medium' | 'high';

/** Two-sided 80% Student-t multipliers by degrees of freedom. Small samples get wide ranges on purpose. */
const T80: [number, number][] = [[1, 3.08], [2, 1.89], [3, 1.64], [4, 1.53], [5, 1.48], [6, 1.44], [8, 1.4], [10, 1.37], [15, 1.34], [30, 1.31]];
export const tMultiplier = (df: number): number => {
  if (df < 1) return 3.08;
  for (const [d, t] of T80) if (df <= d) return t;
  return 1.28;
};

export interface Fit {
  n: number;
  slope: number;
  mx: number;
  my: number;
  sxx: number;
  /** Spread of the points around the line (residual standard deviation). */
  s: number;
}

export function fitLine(xs: number[], ys: number[]): Fit | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (my + slope * (xs[i] - mx))) ** 2;
  return { n, slope, mx, my, sxx, s: Math.sqrt(sse / (n - 2)) };
}

/** Where the line says a new reading will fall at `x`, with an 80% range that widens the further from the data we look. */
export function predictAt(f: Fit, x: number, minHalf = 0) {
  const mid = f.my + f.slope * (x - f.mx);
  const half = Math.max(minHalf, tMultiplier(f.n - 2) * f.s * Math.sqrt(1 + 1 / f.n + (x - f.mx) ** 2 / f.sxx));
  return { mid, low: mid - half, high: mid + half };
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const v = [...values].sort((a, b) => a - b);
  const i = (v.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}

// ---------- bodyweight ----------

export const WEIGHT_WINDOW = 6;
const MIN_WEEKS_AHEAD = 2;

export interface WeightFit {
  fit: Fit;
  last: BodyEntry;
  /** Weeks (as a day-number / 7) of the first and last points used. */
  spanWeeks: number;
}

export function weightFit(entries: BodyEntry[], n = WEIGHT_WINDOW): WeightFit | null {
  const e = entries.slice(-n);
  const fit = fitLine(e.map((p) => dayNumber(p.date) / 7), e.map((p) => p.weight));
  if (!fit) return null;
  return { fit, last: e[e.length - 1], spanWeeks: dayNumber(e[e.length - 1].date) / 7 - dayNumber(e[0].date) / 7 };
}

export interface Backtest {
  /** How many past forecasts could be checked. */
  n: number;
  /** Average miss, in kg. */
  mae: number;
  /** Share of past readings that landed inside the forecast's own 80% range. */
  inside: number;
}

/** Replays history: with only the weigh-ins up to a point, what would the line have said about a later weigh-in, and how far off was it? */
export function backtestWeight(entries: BodyEntry[]): Backtest | null {
  let n = 0;
  let abs = 0;
  let inside = 0;
  for (let k = 3; k < entries.length; k++) {
    const past = entries.slice(0, k);
    const wf = weightFit(past);
    if (!wf) continue;
    const from = dayNumber(past[past.length - 1].date);
    const target = entries.slice(k).find((e) => dayNumber(e.date) - from >= MIN_WEEKS_AHEAD * 7);
    if (!target) continue;
    const p = predictAt(wf.fit, dayNumber(target.date) / 7, 0.4);
    n++;
    abs += Math.abs(target.weight - p.mid);
    if (target.weight >= p.low && target.weight <= p.high) inside++;
  }
  return n >= 3 ? { n, mae: abs / n, inside: inside / n } : null;
}

export function weightConfidence(wf: WeightFit): Confidence {
  if (wf.fit.n < 5 || wf.spanWeeks < 3) return 'low';
  if (wf.fit.n >= WEIGHT_WINDOW && wf.spanWeeks >= 5) return 'high';
  return 'medium';
}

// ---------- savings ----------

export interface SavingPaces {
  /** Money saved per month: a slow, a typical and a fast pace taken from how the last weeks actually went. */
  slow: number;
  typical: number;
  fast: number;
  /** Number of 4-week stretches the range comes from; fewer means less to go on. */
  windows: number;
  confidence: Confidence;
}

const WEEKS_BACK = 12;

export function savingPaces(data: AppData, today: string): SavingPaces {
  const savings = data.money.txns.filter((t) => t.kind === 'saving');
  const monday = mondayOf(today);
  const firstLogged = data.money.txns.reduce<string | null>((m, t) => (m == null || t.date < m ? t.date : m), null);
  // Completed weeks since logging began, oldest first. A week with no saving counts as zero, but only once the person was tracking.
  const weeks: number[] = [];
  for (let w = WEEKS_BACK; w >= 1; w--) {
    const start = addDays(monday, -7 * w);
    if (firstLogged != null && firstLogged > addDays(start, 6)) continue;
    const end = addDays(start, 6);
    weeks.push(savings.filter((t) => t.date >= start && t.date <= end).reduce((n, t) => n + t.amount, 0));
  }
  const perMonth = (sum: number) => (sum / 28) * DAYS_PER_MONTH;
  const windows: number[] = [];
  for (let i = 0; i + 4 <= weeks.length; i++) windows.push(perMonth(weeks.slice(i, i + 4).reduce((a, b) => a + b, 0)));
  const all = weeks.length ? perMonth((weeks.reduce((a, b) => a + b, 0) / weeks.length) * 4) : 0;
  if (windows.length < 3) {
    // Not enough history to know how steady it is: say so with a wide, even range around the average.
    return { slow: all * 0.6, typical: all, fast: all * 1.4, windows: windows.length, confidence: 'low' };
  }
  const typical = percentile(windows, 0.5);
  return { slow: percentile(windows, 0.2), typical, fast: percentile(windows, 0.8), windows: windows.length, confidence: windows.length >= 6 ? 'high' : 'medium' };
}

// ---------- shipping projects ----------

export interface ShipPaces {
  slow: number;
  typical: number;
  fast: number;
  /** Weeks between one shipped project and the next, from the dates they were marked shipped. */
  gaps: number;
  confidence: Confidence;
}

/** Weeks per project: how long the person has actually taken, and how much that varies. Null when no ship dates are known. */
export function shipPaces(data: AppData): ShipPaces | null {
  const c = data.career;
  const dates = c.projects.filter((p) => p.status === 'shipped' && p.shippedOn).map((p) => p.shippedOn as string).sort();
  if (!dates.length) return null;
  const gaps: number[] = [];
  let prev = c.startDate;
  for (const d of dates) {
    gaps.push(Math.max(1, (dayNumber(d) - dayNumber(prev)) / 7));
    prev = d;
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (gaps.length < 3) return { slow: mean * 1.5, typical: mean, fast: mean * 0.7, gaps: gaps.length, confidence: 'low' };
  return { slow: percentile(gaps, 0.8), typical: mean, fast: percentile(gaps, 0.2), gaps: gaps.length, confidence: gaps.length >= 5 ? 'high' : 'medium' };
}

