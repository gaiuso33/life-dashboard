import { DAY_BY_WEEKDAY, dayDef } from './program';
import type { DayKey, ExerciseDef } from './program';
import type { AppData, BodyEntry, Session } from './types';
import { addDays, dayNumber, mondayOf, weekday } from './utils';

export const ITEMS = [
  { key: 'training', label: 'Training', color: 'var(--plate-red)' },
  { key: 'code', label: 'Code', color: 'var(--plate-blue)' },
  { key: 'money', label: 'Money', color: 'var(--plate-yellow)' },
  { key: 'checkin', label: 'Check-in', color: 'var(--plate-green)' },
] as const;
export type ItemKey = (typeof ITEMS)[number]['key'];
export type DayStatus = Record<ItemKey, boolean>;

const GYM_DAYS: DayKey[] = ['push', 'pull', 'legs'];

export function finishedSessionOn(data: AppData, date: string): Session | undefined {
  for (const d of GYM_DAYS) {
    const s = data.sessions[`${date}|${d}`];
    if (s?.finished) return s;
  }
  return undefined;
}

export function dayStatus(data: AppData, date: string): DayStatus {
  const log = data.days[date] ?? {};
  return {
    training: !!finishedSessionOn(data, date) || !!log.mobility,
    code: !!log.code,
    money: !!log.money,
    checkin: log.energy != null,
  };
}

export const dayScore = (data: AppData, date: string) =>
  Object.values(dayStatus(data, date)).filter(Boolean).length;

/** Consecutive days with at least 3 of 4 plates loaded. Today only counts once it gets there. */
export function dayStreak(data: AppData, today: string): number {
  let k = dayScore(data, today) >= 3 ? today : addDays(today, -1);
  let n = 0;
  while (n < 400 && dayScore(data, k) >= 3) {
    n++;
    k = addDays(k, -1);
  }
  return n;
}

export function sessionsInWeek(data: AppData, monday: string): number {
  let n = 0;
  for (let i = 0; i < 7; i++) if (finishedSessionOn(data, addDays(monday, i))) n++;
  return n;
}

/** Consecutive weeks with all 3 sessions done, counting the current week once it is complete. */
export function weekStreak(data: AppData, today: string): number {
  let monday = mondayOf(today);
  let n = 0;
  if (sessionsInWeek(data, monday) >= 3) n++;
  monday = addDays(monday, -7);
  while (n < 200 && sessionsInWeek(data, monday) >= 3) {
    n++;
    monday = addDays(monday, -7);
  }
  return n;
}

export function strongDaysInWeek(data: AppData, monday: string, upTo: string): number {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const k = addDays(monday, i);
    if (k > upTo) break;
    if (dayScore(data, k) >= 3) n++;
  }
  return n;
}

export function lastSession(data: AppData, day: DayKey, before: string): Session | undefined {
  let best: Session | undefined;
  for (const s of Object.values(data.sessions)) {
    if (s.day === day && s.finished && s.date < before && (!best || s.date > best.date)) best = s;
  }
  return best;
}

export function readyForMoreLoad(ex: ExerciseDef, last: Session | undefined): boolean {
  if (!last) return false;
  const reps = last.reps[ex.id];
  if (!reps || reps.length < ex.sets) return false;
  return reps.slice(0, ex.sets).every((r) => r != null && r >= ex.max);
}

export function plannedFor(date: string): DayKey | null {
  return DAY_BY_WEEKDAY[weekday(date)] ?? null;
}

export function nextSession(from: string): { date: string; day: DayKey } {
  for (let i = 0; i < 7; i++) {
    const k = addDays(from, i);
    const d = plannedFor(k);
    if (d) return { date: k, day: d };
  }
  return { date: from, day: 'push' };
}

export function sessionRepTotal(s: Session): number {
  let n = 0;
  for (const arr of Object.values(s.reps)) for (const r of arr) n += r ?? 0;
  return n;
}

export function weeklyRepTotals(data: AppData, today: string, weeks: number) {
  const thisMonday = mondayOf(today);
  const out: { monday: string; reps: number; sessions: number }[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const monday = addDays(thisMonday, -7 * w);
    let reps = 0;
    let sessions = 0;
    for (let i = 0; i < 7; i++) {
      const s = finishedSessionOn(data, addDays(monday, i));
      if (s) {
        sessions++;
        reps += sessionRepTotal(s);
      }
    }
    out.push({ monday, reps, sessions });
  }
  return out;
}

export function sessionProgress(s: Session | undefined, day: DayKey) {
  const def = dayDef(day);
  const total = def.exercises.reduce((n, e) => n + e.sets, 0);
  let done = 0;
  if (s) {
    for (const ex of def.exercises) {
      const reps = s.reps[ex.id] ?? [];
      for (let i = 0; i < ex.sets; i++) if (reps[i] != null) done++;
    }
  }
  return { done, total };
}

/* ---- body ---- */

export interface Trend {
  slope: number; // kg per week
  fitAt: (date: string) => number;
}

export function weightTrend(entries: BodyEntry[], n = 6): Trend | null {
  const e = entries.slice(-n);
  if (e.length < 3) return null;
  const xs = e.map((p) => dayNumber(p.date) / 7);
  const ys = e.map((p) => p.weight);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, fitAt: (date) => my + slope * (dayNumber(date) / 7 - mx) };
}

/** Lean-gain pace guideline: 0.25% to 0.5% of bodyweight per week. */
export function suggestedPace(weight: number) {
  return { low: weight * 0.0025, high: weight * 0.005, mid: weight * 0.00375 };
}

export function suggestedGoal(weight: number, weeks = 12) {
  return Math.round((weight + suggestedPace(weight).mid * weeks) * 2) / 2;
}
