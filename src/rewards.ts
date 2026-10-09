import { CATALOG, evaluateBadges } from './badges';
import type { BadgeState } from './badges';
import { sessionsInWeek, strongDaysInWeek } from './derive';
import { weekHasSaving } from './money';
import type { AppData, Claim, RewardItem, Tier } from './types';
import { addDays, dayNumber, fmtShort, mondayOf } from './utils';

/** Periods are counted from a fixed Monday so a biweekly or four-week block never shifts. */
export const ANCHOR = '2026-01-05';

export type PeriodTier = Exclude<Tier, 'landmark'>;
export const TIER_WEEKS: Record<PeriodTier, number> = { week: 1, biweek: 2, month: 4 };
export const TIER_LABEL: Record<Tier, string> = { week: 'Weekly', biweek: 'Biweekly', month: 'Monthly', landmark: 'Landmark' };
export const TIER_BLURB: Record<Tier, string> = {
  week: 'A small treat for a week of showing up.',
  biweek: 'Two strong weeks back to back.',
  month: 'Four strong weeks in a row.',
  landmark: 'Big treats for big moments, like eight perfect training weeks or a finished fund.',
};

export function periodStart(date: string, tier: PeriodTier): string {
  const n = TIER_WEEKS[tier];
  const weeksSince = Math.round((dayNumber(mondayOf(date)) - dayNumber(ANCHOR)) / 7);
  return addDays(ANCHOR, Math.floor(weeksSince / n) * n * 7);
}

export interface Req {
  label: string;
  value: number;
  target: number;
}

export interface Period {
  tier: PeriodTier;
  start: string;
  end: string;
  label: string;
  reqs: Req[];
  unlocked: boolean;
  claim?: Claim;
}

export function savedInRange(data: AppData, from: string, to: string): boolean {
  return data.money.txns.some((t) => t.kind === 'saving' && t.date >= from && t.date <= to);
}

/** A week counts toward the bigger tiers when all 3 sessions are done and at least 5 days are strong. */
export function weekCheck(data: AppData, monday: string, today: string) {
  const sessions = sessionsInWeek(data, monday);
  const strong = strongDaysInWeek(data, monday, today);
  return { sessions, strong, saved: weekHasSaving(data, monday), met: sessions >= 3 && strong >= 5 };
}

export function period(data: AppData, tier: PeriodTier, start: string, today: string): Period {
  const n = TIER_WEEKS[tier];
  const end = addDays(start, n * 7 - 1);
  const checks = Array.from({ length: n }, (_, i) => weekCheck(data, addDays(start, i * 7), today));
  const saved = savedInRange(data, start, end);
  const reqs: Req[] =
    n === 1
      ? [
          { label: 'Sessions', value: Math.min(3, checks[0].sessions), target: 3 },
          { label: 'Strong days', value: Math.min(5, checks[0].strong), target: 5 },
          { label: 'Savings transfer', value: saved ? 1 : 0, target: 1 },
        ]
      : [
          { label: 'Full weeks', value: checks.filter((c) => c.met).length, target: n },
          { label: 'Savings transfer', value: saved ? 1 : 0, target: 1 },
        ];
  return {
    tier,
    start,
    end,
    label: n === 1 ? `Week of ${fmtShort(start)}` : `${fmtShort(start)} to ${fmtShort(end)}`,
    reqs,
    unlocked: reqs.every((r) => r.value >= r.target),
    claim: data.rewards.claims.find((c) => c.tier === tier && c.period === start),
  };
}

export function periodsFor(data: AppData, tier: PeriodTier, today: string) {
  const cur = periodStart(today, tier);
  return {
    current: period(data, tier, cur, today),
    previous: period(data, tier, addDays(cur, -TIER_WEEKS[tier] * 7), today),
  };
}

export const itemsFor = (data: AppData, tier: Tier): RewardItem[] => data.rewards.items.filter((i) => i.tier === tier);

export interface Landmarks {
  ready: BadgeState[]; // earned and not yet claimed
  next: BadgeState | null; // closest locked landmark
  savedRecently: boolean; // a savings transfer in the last 4 weeks
}

export function landmarksFor(data: AppData, today: string, states?: BadgeState[]): Landmarks {
  const all = (states ?? evaluateBadges(data, today)).filter((b) => b.landmark);
  const claimed = new Set(data.rewards.claims.filter((c) => c.tier === 'landmark').map((c) => c.period));
  const ready = all.filter((b) => b.earned && !claimed.has(b.id));
  const locked = all.filter((b) => !b.earned).sort((a, b) => b.ratio - a.ratio);
  return { ready, next: locked[0] ?? null, savedRecently: savedInRange(data, addDays(today, -27), today) };
}

export const LANDMARK_IDS = CATALOG.filter((b) => b.landmark).map((b) => b.id);
