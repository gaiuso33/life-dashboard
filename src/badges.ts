import { dayScore, finishedSessionOn } from './derive';
import { fundBalance, naira, survivalTarget } from './money';
import type { AppData } from './types';
import { addDays, dayNumber, mondayOf } from './utils';

export type BadgeGroup = 'streak' | 'milestone';
export type BadgeArea = 'train' | 'code' | 'money' | 'body' | 'all';

export const AREA_COLOR: Record<BadgeArea, string> = {
  train: 'var(--plate-red)',
  code: 'var(--plate-blue)',
  money: 'var(--plate-yellow)',
  body: 'var(--plate-green)',
  all: 'var(--plate-green)',
};

type Spec =
  | { kind: 'days-strong'; n: number }
  | { kind: 'weeks-train'; n: number }
  | { kind: 'days-commit'; n: number }
  | { kind: 'days-log'; n: number }
  | { kind: 'weeks-weigh'; n: number }
  | { kind: 'sessions'; n: number }
  | { kind: 'saved'; n: number }
  | { kind: 'fund'; pct: number }
  | { kind: 'shipped'; n: number }
  | { kind: 'learn'; n: number }
  | { kind: 'weigh-first' }
  | { kind: 'goal-weight' };

export interface BadgeDef {
  id: string;
  name: string;
  desc: string;
  group: BadgeGroup;
  area: BadgeArea;
  glyph: string;
  landmark?: boolean;
  spec: Spec;
}

const LM = ' Unlocks a landmark reward.';

export const CATALOG: BadgeDef[] = [
  // ---- streaks ----
  { id: 'day-7', name: 'Seven strong days', desc: 'Seven days in a row with at least 3 of 4 plates loaded.', group: 'streak', area: 'all', glyph: '7', spec: { kind: 'days-strong', n: 7 } },
  { id: 'day-14', name: 'Two strong weeks', desc: 'Fourteen strong days in a row.', group: 'streak', area: 'all', glyph: '14', spec: { kind: 'days-strong', n: 14 } },
  { id: 'day-30', name: 'Thirty strong days', desc: 'A whole month of strong days in a row.', group: 'streak', area: 'all', glyph: '30', spec: { kind: 'days-strong', n: 30 } },
  { id: 'wk-2', name: 'Two full weeks', desc: 'Two weeks in a row with all 3 sessions finished.', group: 'streak', area: 'train', glyph: '2w', spec: { kind: 'weeks-train', n: 2 } },
  { id: 'wk-4', name: 'Four full weeks', desc: 'Four weeks in a row with all 3 sessions finished.', group: 'streak', area: 'train', glyph: '4w', spec: { kind: 'weeks-train', n: 4 } },
  { id: 'wk-8', name: 'Eight full weeks', desc: `Eight weeks in a row with all 3 sessions finished.${LM}`, group: 'streak', area: 'train', glyph: '8w', landmark: true, spec: { kind: 'weeks-train', n: 8 } },
  { id: 'wk-12', name: 'Twelve full weeks', desc: 'A full season of training: twelve perfect weeks in a row.', group: 'streak', area: 'train', glyph: '12w', spec: { kind: 'weeks-train', n: 12 } },
  { id: 'code-7', name: 'Seven-day commit streak', desc: 'A commit on seven days in a row.', group: 'streak', area: 'code', glyph: '7', spec: { kind: 'days-commit', n: 7 } },
  { id: 'code-14', name: 'Fourteen-day commit streak', desc: 'A commit on fourteen days in a row.', group: 'streak', area: 'code', glyph: '14', spec: { kind: 'days-commit', n: 14 } },
  { id: 'code-30', name: 'Thirty-day commit streak', desc: 'A commit every day for a month.', group: 'streak', area: 'code', glyph: '30', spec: { kind: 'days-commit', n: 30 } },
  { id: 'log-7', name: 'Seven days logged', desc: 'Spending logged, or marked as none, seven days in a row.', group: 'streak', area: 'money', glyph: '7', spec: { kind: 'days-log', n: 7 } },
  { id: 'log-30', name: 'Thirty days logged', desc: 'Spending logged every day for a month.', group: 'streak', area: 'money', glyph: '30', spec: { kind: 'days-log', n: 30 } },
  { id: 'weigh-4', name: 'Four weigh-ins in a row', desc: 'Weighed in four weeks in a row.', group: 'streak', area: 'body', glyph: '4w', spec: { kind: 'weeks-weigh', n: 4 } },
  { id: 'weigh-8', name: 'Eight weigh-ins in a row', desc: 'Weighed in eight weeks in a row.', group: 'streak', area: 'body', glyph: '8w', spec: { kind: 'weeks-weigh', n: 8 } },
  // ---- milestones ----
  { id: 'sess-1', name: 'First session', desc: 'Finish your first workout session.', group: 'milestone', area: 'train', glyph: '1', spec: { kind: 'sessions', n: 1 } },
  { id: 'sess-10', name: 'Ten sessions', desc: 'Ten workout sessions finished.', group: 'milestone', area: 'train', glyph: '10', spec: { kind: 'sessions', n: 10 } },
  { id: 'sess-25', name: 'Twenty-five sessions', desc: 'Twenty-five workout sessions finished.', group: 'milestone', area: 'train', glyph: '25', spec: { kind: 'sessions', n: 25 } },
  { id: 'sess-50', name: 'Fifty sessions', desc: 'Fifty workout sessions finished.', group: 'milestone', area: 'train', glyph: '50', spec: { kind: 'sessions', n: 50 } },
  { id: 'saved-10k', name: '₦10,000 saved', desc: '₦10,000 moved into savings through logged transfers.', group: 'milestone', area: 'money', glyph: '₦10k', spec: { kind: 'saved', n: 10000 } },
  { id: 'saved-50k', name: '₦50,000 saved', desc: '₦50,000 moved into savings through logged transfers.', group: 'milestone', area: 'money', glyph: '₦50k', spec: { kind: 'saved', n: 50000 } },
  { id: 'saved-100k', name: '₦100,000 saved', desc: '₦100,000 moved into savings through logged transfers.', group: 'milestone', area: 'money', glyph: '₦100k', spec: { kind: 'saved', n: 100000 } },
  { id: 'fund-25', name: 'Survival fund 25%', desc: 'A quarter of your six-month safety net is in place.', group: 'milestone', area: 'money', glyph: '25%', spec: { kind: 'fund', pct: 25 } },
  { id: 'fund-50', name: 'Survival fund 50%', desc: `Three months of expenses covered.${LM}`, group: 'milestone', area: 'money', glyph: '50%', landmark: true, spec: { kind: 'fund', pct: 50 } },
  { id: 'fund-100', name: 'Survival fund complete', desc: `Six months of expenses covered. New savings now go to the investment fund.${LM}`, group: 'milestone', area: 'money', glyph: '100%', landmark: true, spec: { kind: 'fund', pct: 100 } },
  { id: 'ship-1', name: 'First project shipped', desc: 'One portfolio project marked as shipped.', group: 'milestone', area: 'code', glyph: '1', spec: { kind: 'shipped', n: 1 } },
  { id: 'ship-3', name: 'Three projects shipped', desc: `Three portfolio projects shipped.${LM}`, group: 'milestone', area: 'code', glyph: '3', landmark: true, spec: { kind: 'shipped', n: 3 } },
  { id: 'ship-5', name: 'Portfolio complete', desc: `All five portfolio projects shipped.${LM}`, group: 'milestone', area: 'code', glyph: '5', landmark: true, spec: { kind: 'shipped', n: 5 } },
  { id: 'learn-5', name: 'Five modules', desc: 'Five modules or lessons added to the learning log.', group: 'milestone', area: 'code', glyph: '5', spec: { kind: 'learn', n: 5 } },
  { id: 'learn-20', name: 'Twenty modules', desc: 'Twenty modules or lessons added to the learning log.', group: 'milestone', area: 'code', glyph: '20', spec: { kind: 'learn', n: 20 } },
  { id: 'weigh-first', name: 'First weigh-in', desc: 'Your starting point is on record.', group: 'milestone', area: 'body', glyph: 'kg', spec: { kind: 'weigh-first' } },
  { id: 'goal-weight', name: 'Target weight reached', desc: `You hit the weight goal you set.${LM}`, group: 'milestone', area: 'body', glyph: '★', landmark: true, spec: { kind: 'goal-weight' } },
];

export interface BadgeState extends BadgeDef {
  earned: boolean;
  on: string | null; // date first earned, when known
  earnedNow: boolean; // the data meets the condition today (earned may also be true from an earlier save)
  progress: string;
  value: number; // current progress toward the target
  target: number; // what the badge needs
  ratio: number; // 0..1 toward the target, for locked badges
  isNew: boolean;
}

/* ---------- history scanning ---------- */

interface Run {
  stamp: string;
  ok: boolean;
}

export interface Scan {
  best: number;
  cur: number;
  reach: Record<number, string>;
}

/**
 * Walks a chronological list of days or weeks. `reach[n]` is the stamp of the element where a run
 * first got n long. `cur` is the run ending now; a trailing element that hasn't succeeded yet
 * (today, or this week) doesn't break it, because there's still time to earn it.
 */
export function scan(seq: Run[]): Scan {
  let run = 0;
  let best = 0;
  const reach: Record<number, string> = {};
  for (const e of seq) {
    if (e.ok) {
      run++;
      if (run > best) best = run;
      if (!(run in reach)) reach[run] = e.stamp;
    } else run = 0;
  }
  let cur = 0;
  let i = seq.length - 1;
  if (i >= 0 && !seq[i].ok) i--;
  while (i >= 0 && seq[i].ok) {
    cur++;
    i--;
  }
  return { best, cur, reach };
}

const MAX_HISTORY_DAYS = 800;

export function firstDate(data: AppData, today: string): string {
  let first = today;
  const see = (d: string | undefined) => {
    if (d && d < first) first = d;
  };
  Object.keys(data.days).forEach(see);
  Object.values(data.sessions).forEach((s) => see(s.date));
  data.money.txns.forEach((t) => see(t.date));
  Object.keys(data.career.commits).forEach(see);
  data.body.forEach((b) => see(b.date));
  data.career.learning.forEach((l) => see(l.date));
  const floor = addDays(today, -MAX_HISTORY_DAYS);
  return first < floor ? floor : first;
}

function dailyRuns(first: string, today: string, ok: (d: string) => boolean): Run[] {
  const out: Run[] = [];
  const n = dayNumber(today) - dayNumber(first);
  for (let i = 0; i <= n; i++) {
    const d = addDays(first, i);
    out.push({ stamp: d, ok: ok(d) });
  }
  return out;
}

function weeklyRuns(first: string, today: string, check: (monday: string) => { ok: boolean; stamp: string }): Run[] {
  const out: Run[] = [];
  const last = mondayOf(today);
  for (let m = mondayOf(first); m <= last; m = addDays(m, 7)) out.push(check(m));
  return out;
}

const sortedDates = (xs: string[]) => [...xs].sort();

/** Date on which the nth thing happened, or null if it hasn't. */
const nth = (dates: string[], n: number) => (dates.length >= n ? dates[n - 1] : null);

/* ---------- evaluation ---------- */

export function evaluateBadges(data: AppData, today: string): BadgeState[] {
  const first = firstDate(data, today);

  const strong = scan(dailyRuns(first, today, (d) => dayScore(data, d) >= 3));
  const commit = scan(dailyRuns(first, today, (d) => (data.career.commits[d] ?? 0) > 0));
  const expenseDays = new Set(data.money.txns.filter((t) => t.kind === 'expense').map((t) => t.date));
  const log = scan(dailyRuns(first, today, (d) => expenseDays.has(d) || !!data.days[d]?.money));

  const train = scan(
    weeklyRuns(first, today, (m) => {
      const dates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(m, i);
        if (finishedSessionOn(data, d)) dates.push(d);
      }
      return dates.length >= 3 ? { ok: true, stamp: dates[2] } : { ok: false, stamp: m };
    }),
  );
  const weigh = scan(
    weeklyRuns(first, today, (m) => {
      const end = addDays(m, 6);
      const hit = data.body.find((b) => b.date >= m && b.date <= end);
      return hit ? { ok: true, stamp: hit.date } : { ok: false, stamp: m };
    }),
  );

  const sessionDates = sortedDates([...new Set(Object.values(data.sessions).filter((s) => s.finished).map((s) => s.date))]);
  const savings = data.money.txns.filter((t) => t.kind === 'saving').sort((a, b) => a.date.localeCompare(b.date));
  const savedTotal = savings.reduce((n, t) => n + t.amount, 0);
  const shipped = sortedDates(data.career.projects.filter((p) => p.status === 'shipped').map((p) => p.shippedOn ?? today));
  const learned = sortedDates(data.career.learning.map((l) => l.date));
  const target = survivalTarget(data, today).target;
  const fundNow = fundBalance(data, 'survival');

  const crossing = (limit: number): string | null => {
    let run = 0;
    for (const t of savings) {
      run += t.amount;
      if (run >= limit) return t.date;
    }
    return null;
  };
  const fundCrossing = (limit: number): string | null => {
    let run = data.money.survivalOpening;
    if (run >= limit) return savings[0]?.date ?? null;
    for (const t of savings) {
      if ((t.fund ?? 'survival') !== 'survival') continue;
      run += t.amount;
      if (run >= limit) return t.date;
    }
    return null;
  };

  let goalOn: string | null = null;
  let goalReached = false;
  const goal = data.goalWeight;
  if (goal != null && data.body.length > 0 && Math.abs(goal - data.body[0].weight) >= 0.5) {
    const up = goal >= data.body[0].weight;
    const hit = data.body.find((b) => (up ? b.weight >= goal : b.weight <= goal));
    if (hit) {
      goalReached = true;
      goalOn = hit.date;
    }
  }

  const persisted = data.rewards.badges;
  const recent = (d: string | null) => d != null && dayNumber(today) - dayNumber(d) <= 3;

  return CATALOG.map((def): BadgeState => {
    const sp = def.spec;
    let earnedNow = false;
    let on: string | null = null;
    let value = 0;
    let goalN = 1;
    let progress = '';

    const streak = (s: Scan, n: number, unit: string) => {
      earnedNow = s.best >= n;
      on = earnedNow ? s.reach[n] ?? null : null;
      value = s.cur;
      goalN = n;
      progress = `${Math.min(s.cur, n)} of ${n} ${unit}`;
    };
    const count = (dates: string[], n: number, unit: string) => {
      earnedNow = dates.length >= n;
      on = nth(dates, n);
      value = dates.length;
      goalN = n;
      progress = `${Math.min(dates.length, n)} of ${n} ${unit}`;
    };

    switch (sp.kind) {
      case 'days-strong':
        streak(strong, sp.n, 'days');
        break;
      case 'days-commit':
        streak(commit, sp.n, 'days');
        break;
      case 'days-log':
        streak(log, sp.n, 'days');
        break;
      case 'weeks-train':
        streak(train, sp.n, 'weeks');
        break;
      case 'weeks-weigh':
        streak(weigh, sp.n, 'weeks');
        break;
      case 'sessions':
        count(sessionDates, sp.n, 'sessions');
        break;
      case 'shipped':
        count(shipped, sp.n, 'projects');
        break;
      case 'learn':
        count(learned, sp.n, 'modules');
        break;
      case 'saved':
        earnedNow = savedTotal >= sp.n;
        on = crossing(sp.n);
        value = savedTotal;
        goalN = sp.n;
        progress = `${naira(Math.min(savedTotal, sp.n))} of ${naira(sp.n)}`;
        break;
      case 'fund': {
        const pct = target ? Math.min(100, Math.floor((fundNow / target) * 100)) : 0;
        earnedNow = target != null && fundNow >= (target * sp.pct) / 100;
        on = earnedNow && target != null ? fundCrossing((target * sp.pct) / 100) : null;
        value = pct;
        goalN = sp.pct;
        progress = target ? `${Math.min(pct, sp.pct)}% of ${sp.pct}%` : 'Needs a spending estimate first';
        break;
      }
      case 'weigh-first':
        earnedNow = data.body.length > 0;
        on = data.body[0]?.date ?? null;
        value = data.body.length > 0 ? 1 : 0;
        progress = earnedNow ? 'Done' : 'Save a weigh-in on the Body screen';
        break;
      case 'goal-weight':
        earnedNow = goalReached;
        on = goalOn;
        value = goalReached ? 1 : 0;
        progress = goal == null ? 'Set a weight goal on the Body screen' : goalReached ? 'Done' : `Goal ${goal} kg`;
        break;
    }

    const saved = persisted[def.id];
    const earned = earnedNow || saved != null;
    const date = saved ?? on;
    return {
      ...def,
      earned,
      on: date,
      earnedNow,
      progress: earned ? '' : progress,
      value,
      target: goalN,
      ratio: earned ? 1 : Math.max(0, Math.min(1, goalN ? value / goalN : 0)),
      isNew: earned && recent(date),
    };
  });
}

/** Badges the data meets today that haven't been saved yet, keyed to the date they were earned. */
export function newlyEarned(data: AppData, today: string, states?: BadgeState[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of states ?? evaluateBadges(data, today)) {
    if (b.earnedNow && data.rewards.badges[b.id] == null) out[b.id] = b.on ?? today;
  }
  return out;
}
