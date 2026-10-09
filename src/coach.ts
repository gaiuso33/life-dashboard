import { evaluateBadges } from './badges';
import type { BadgeState } from './badges';
import { dayStatus, finishedSessionOn, lastSession, plannedFor, readyForMoreLoad, sessionProgress, sessionRepTotal } from './derive';
import { naira, suggestedSave, survivalTarget } from './money';
import type { Tab, TrainView } from './nav';
import { dayDef } from './program';
import { dueSoon } from './plan';
import type { DayKey } from './program';
import { TIER_LABEL, landmarksFor, periodsFor } from './rewards';
import type { PeriodTier } from './rewards';
import type { AppData } from './types';
import { addDays, dayNumber, fmtShort, mondayOf, weekday, weekdayName } from './utils';

/* ---------- small helpers shared with the advisor summary ---------- */

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Names of exercises whose last finished session hit the top of the rep range on every set. */
export function readyExercises(data: AppData, before: string, days: DayKey[] = ['push', 'pull', 'legs']): string[] {
  const out: string[] = [];
  for (const day of days) {
    const last = lastSession(data, day, before);
    for (const ex of dayDef(day).exercises) if (readyForMoreLoad(ex, last)) out.push(ex.name);
  }
  return out;
}

export function repsInWeek(data: AppData, monday: string): number {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const s = finishedSessionOn(data, addDays(monday, i));
    if (s) n += sessionRepTotal(s);
  }
  return n;
}

export function sumTxns(data: AppData, kind: 'expense' | 'income' | 'saving', from: string, to: string): number {
  let n = 0;
  for (const t of data.money.txns) if (t.kind === kind && t.date >= from && t.date <= to) n += t.amount;
  return n;
}

/** Days in the range on which spending was logged, or marked as "spent nothing". */
export function loggedSpendDays(data: AppData, from: string, to: string): number {
  const days = new Set<string>();
  for (const t of data.money.txns) if (t.kind === 'expense' && t.date >= from && t.date <= to) days.add(t.date);
  for (let d = from; d <= to; d = addDays(d, 1)) if (data.days[d]?.money) days.add(d);
  return days.size;
}

export function commitStats(data: AppData, from: string, to: string) {
  let commits = 0;
  let days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const n = data.career.commits[d] ?? 0;
    commits += n;
    if (n > 0) days++;
  }
  return { commits, days };
}

const pctChange = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;

/* ---------- daily nudges ---------- */

export interface Nudge {
  id: string;
  /** "plate" nudges repeat what Today already shows; "extra" ones add something new. */
  kind: 'plate' | 'extra';
  text: string;
  go?: Tab;
  view?: TrainView;
}

const BADGE_UNITS = /of [\d,]+ (days|weeks|sessions|projects|modules)$/;

export function dailyNudges(data: AppData, today: string, states: BadgeState[] = evaluateBadges(data, today)): Nudge[] {
  const out: Nudge[] = [];
  const st = dayStatus(data, today);
  const monday = mondayOf(today);
  const planned = plannedFor(today);

  if (!st.training) {
    if (planned) {
      const prog = sessionProgress(data.sessions[`${today}|${planned}`], planned);
      out.push({ id: 'train', kind: 'plate', text: `${dayDef(planned).title} day: ${prog.done} of ${prog.total} sets logged. Your training plate is still open.`, go: 'train', view: planned });
    } else {
      out.push({ id: 'mobility', kind: 'plate', text: 'Rest day: the 12-minute mobility routine loads your training plate.', go: 'train', view: 'mobility' });
    }
  }
  if (!st.money) out.push({ id: 'money', kind: 'plate', text: 'Log today’s spending, or mark that you spent nothing.', go: 'money' });
  if (!st.code) out.push({ id: 'code', kind: 'plate', text: 'No commit yet today. Even a small one fills the code plate.', go: 'career' });
  if (!st.checkin) out.push({ id: 'checkin', kind: 'plate', text: 'The energy check-in is still open.', go: 'today' });

  // Treats waiting: current or previous period, then landmarks.
  for (const tier of ['week', 'biweek', 'month'] as PeriodTier[]) {
    const { current, previous } = periodsFor(data, tier, today);
    const waiting = [previous, current].find((p) => p.unlocked && !p.claim);
    if (waiting) {
      out.push({ id: `reward-${tier}`, kind: 'extra', text: `Your ${TIER_LABEL[tier].toLowerCase()} reward (${waiting.label}) is unlocked. Pick your treat.`, go: 'rewards' });
      break;
    }
  }
  const lm = landmarksFor(data, today, states);
  if (lm.ready.length > 0) {
    out.push({
      id: 'landmark',
      kind: 'extra',
      text: lm.savedRecently ? `Landmark reached: ${lm.ready[0].name}. Claim your big treat.` : `Landmark reached: ${lm.ready[0].name}. Move any amount into savings to unlock the treat.`,
      go: 'rewards',
    });
  }

  // Income without a savings transfer this week.
  const incomeWeek = sumTxns(data, 'income', monday, today);
  if (incomeWeek > 0 && sumTxns(data, 'saving', monday, today) === 0) {
    out.push({
      id: 'split',
      kind: 'extra',
      text: `You logged ${naira(incomeWeek)} this week but no savings transfer yet. Your ${data.money.savePct}% split is ${naira(suggestedSave(incomeWeek, data.money.savePct))}.`,
      go: 'money',
    });
  }

  // Weigh-in.
  const lastWeigh = data.body[data.body.length - 1];
  const weekdayIdx = (weekday(today) + 6) % 7; // Monday = 0
  if (!lastWeigh) {
    out.push({ id: 'weigh', kind: 'extra', text: 'Log your first weigh-in to start the weight trend.', go: 'body' });
  } else if (lastWeigh.date < monday && (weekdayIdx >= 4 || dayNumber(today) - dayNumber(lastWeigh.date) > 8)) {
    out.push({ id: 'weigh', kind: 'extra', text: 'Your weekly weigh-in is due. Same time of day keeps the trend honest.', go: 'body' });
  }

  // Planned items due today or in the next two days.
  for (const o of dueSoon(data, today).slice(0, 2)) {
    const when = o.date === today ? 'Due today' : o.date === addDays(today, 1) ? 'Due tomorrow' : `Due ${weekdayName(o.date)}`;
    out.push({ id: `plan-${o.item.id}-${o.date}`, kind: 'extra', text: `${when}: ${o.item.title}${o.item.amount > 0 ? ` (${naira(o.item.amount)})` : ''}.`, go: 'month' });
  }

  // Progression: today's session if it is still to do, otherwise the next one in the week.
  let nextDay: DayKey | null = planned && !finishedSessionOn(data, today) ? planned : null;
  for (let i = 1; nextDay == null && i <= 7; i++) nextDay = plannedFor(addDays(today, i));
  if (nextDay) {
    const ready = readyExercises(data, today, [nextDay]);
    if (ready.length > 0) out.push({ id: 'load', kind: 'extra', text: `${dayDef(nextDay).title} day: add load on ${ready.slice(0, 3).join(', ').toLowerCase()}. You hit the top of the range last time.`, go: 'train', view: nextDay });
  }

  // A badge within reach.
  const near = states
    .filter((b) => !b.earned && b.value > 0 && BADGE_UNITS.test(b.progress))
    .map((b) => ({ b, left: b.target - b.value, unit: b.progress.match(BADGE_UNITS)![1] }))
    .filter((x) => x.left >= 1 && x.left <= 2)
    .sort((a, b) => a.left - b.left || b.b.ratio - a.b.ratio)[0];
  if (near) {
    const unit = near.left === 1 ? near.unit.replace(/s$/, '') : near.unit;
    out.push({ id: 'badge', kind: 'extra', text: `${near.left} more ${unit} to earn “${near.b.name}”.`, go: 'rewards' });
  }

  if (survivalTarget(data, today).target == null) {
    out.push({ id: 'target', kind: 'extra', text: 'Enter a rough spend per day on the Money screen so your survival fund target can be set.', go: 'money' });
  }
  return out;
}

/* ---------- weekly review ---------- */

export interface Stat {
  label: string;
  value: string;
  note?: string;
}

export interface Review {
  monday: string;
  complete: boolean;
  label: string;
  stats: Stat[];
  wins: string[];
  open: string[]; // missed items for a finished week, still-to-do items for the current one
  focus: string[];
}

export function weeklyReview(data: AppData, monday: string, today: string, states: BadgeState[] = evaluateBadges(data, today)): Review {
  const sunday = addDays(monday, 6);
  const complete = sunday < today;
  const upTo = complete ? sunday : today;
  const prevMonday = addDays(monday, -7);
  const prevSunday = addDays(monday, -1);
  const daysCounted = Math.min(7, dayNumber(upTo) - dayNumber(monday) + 1);
  const daysLeft = 7 - daysCounted;

  let sessions = 0;
  let strong = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (d > upTo) break;
    if (finishedSessionOn(data, d)) sessions++;
    const s = dayStatus(data, d);
    if (Object.values(s).filter(Boolean).length >= 3) strong++;
  }
  const reps = repsInWeek(data, monday);
  const prevReps = repsInWeek(data, prevMonday);
  const repsChange = pctChange(reps, prevReps);
  const cs = commitStats(data, monday, upTo);
  const spent = sumTxns(data, 'expense', monday, upTo);
  const prevSpent = sumTxns(data, 'expense', prevMonday, prevSunday);
  const spentChange = pctChange(spent, prevSpent);
  const income = sumTxns(data, 'income', monday, upTo);
  const saved = sumTxns(data, 'saving', monday, upTo);
  const loggedDays = loggedSpendDays(data, monday, upTo);

  const weighIn = data.body.find((b) => b.date >= monday && b.date <= sunday);
  const before = [...data.body].reverse().find((b) => b.date < monday);
  const weightDelta = weighIn && before ? weighIn.weight - before.weight : null;

  const earnedThisWeek = states.filter((b) => b.earned && b.on != null && b.on >= monday && b.on <= sunday);
  const ready = readyExercises(data, addDays(upTo, 1));

  const stats: Stat[] = [
    { label: 'Sessions', value: `${sessions} of 3` },
    { label: 'Strong days', value: `${strong} of ${daysCounted}` },
    { label: 'Total reps', value: String(reps), note: repsChange == null ? undefined : `${repsChange >= 0 ? '+' : '−'}${Math.abs(repsChange)}% vs the week before` },
    { label: 'Commits', value: String(cs.commits), note: `on ${plural(cs.days, 'day')}` },
    { label: 'Spent', value: naira(spent), note: spentChange == null ? undefined : `${spentChange >= 0 ? '+' : '−'}${Math.abs(spentChange)}% vs the week before` },
    { label: 'Saved', value: naira(saved), note: income > 0 ? `from ${naira(income)} received` : undefined },
    { label: 'Weight', value: weighIn ? `${weighIn.weight} kg` : 'No weigh-in', note: weightDelta == null ? undefined : `${signed(weightDelta)} kg since the last one` },
  ];

  const wins: string[] = [];
  const open: string[] = [];
  const focus: string[] = [];

  // training
  if (sessions >= 3) wins.push('All three sessions are done.');
  else if (complete) open.push(`Only ${sessions} of 3 sessions got done.`);
  else if (3 - sessions > 0) open.push(`${plural(3 - sessions, 'session')} still to do this week.`);
  if (repsChange != null && repsChange >= 5 && sessions > 0) wins.push(`Total reps are up ${repsChange}% on the week before.`);
  if (repsChange != null && repsChange <= -15 && complete) open.push(`Total reps fell ${Math.abs(repsChange)}% on the week before, which usually just reflects missed sessions.`);

  // strong days
  if (strong >= 5) wins.push(`${strong} strong days, enough for the weekly reward.`);
  else if (complete) open.push(`Only ${strong} strong days; the weekly reward needs 5.`);
  else if (strong + daysLeft < 5) open.push('Five strong days is out of reach this week; the next one is a fresh start.');
  else open.push(`${5 - strong} more strong ${5 - strong === 1 ? 'day' : 'days'} for the weekly reward.`);

  // code
  if (cs.days >= 4) wins.push(`Commits on ${cs.days} days (${plural(cs.commits, 'commit')}).`);
  else if (complete) open.push(cs.days === 0 ? 'No commits this week.' : `Commits on only ${plural(cs.days, 'day')}.`);

  // money
  if (saved > 0) wins.push(`Moved ${naira(saved)} into savings.`);
  else open.push(complete ? 'No savings transfer this week, which also blocks the weekly reward.' : 'No savings transfer yet; it is needed for the weekly reward.');
  if (complete && loggedDays >= 6) wins.push(`Spending logged on ${loggedDays} of 7 days, so the numbers are trustworthy.`);
  else if (complete && loggedDays < 5) open.push(`Spending logged on only ${loggedDays} of 7 days, so the picture is partial.`);
  if (complete && spentChange != null && spentChange >= 25 && spent - prevSpent >= 1000) open.push(`Spending is up ${spentChange}% on the week before.`);
  if (complete && spentChange != null && spentChange <= -15 && loggedDays >= 5) wins.push(`Spending is down ${Math.abs(spentChange)}% on the week before.`);

  // body
  if (weighIn) wins.push('Weekly weigh-in logged.');
  else if (complete) open.push('No weigh-in this week.');
  else open.push('Weekly weigh-in still to do.');

  if (earnedThisWeek.length > 0) wins.push(`New ${earnedThisWeek.length === 1 ? 'badge' : 'badges'}: ${earnedThisWeek.map((b) => b.name).join(', ')}.`);

  // focus, at most three, in order of what blocks the most
  if (sessions < 3) focus.push(complete ? 'Protect all three sessions: block Monday, Wednesday and Friday in your calendar.' : 'Finish the remaining session(s) this week.');
  if (saved === 0) focus.push(income > 0 ? `Move your split (${naira(suggestedSave(income, data.money.savePct))}) into savings as soon as money lands.` : 'Move even ₦500 into savings early in the week so the reward stays in reach.');
  if (ready.length > 0) focus.push(`Add load next session on ${ready.slice(0, 3).join(', ').toLowerCase()}.`);
  if (complete && cs.days < 4) focus.push('Aim for commits on at least four days; one small commit is enough to count.');
  if (complete && loggedDays < 5) focus.push('Log spending every day, even "spent nothing", so your survival target uses real numbers.');
  if (!weighIn) focus.push('Weigh in once, same day and time, before eating.');
  if (focus.length === 0) focus.push('Keep the same plan. Consistency is doing the work.');

  return {
    monday,
    complete,
    label: complete ? `Week of ${fmtShort(monday)}` : `This week so far (from ${fmtShort(monday)})`,
    stats,
    wins,
    open,
    focus: focus.slice(0, 3),
  };
}

/** The review as plain sentences, used to anchor the AI's written version. */
export function reviewToText(r: Review): string {
  const lines = [r.label + (r.complete ? ' (finished)' : ' (still in progress)'), 'Numbers: ' + r.stats.map((s) => `${s.label} ${s.value}${s.note ? ` (${s.note})` : ''}`).join('; ')];
  if (r.wins.length) lines.push('Going well: ' + r.wins.join(' '));
  if (r.open.length) lines.push((r.complete ? 'Missed: ' : 'Still open: ') + r.open.join(' '));
  lines.push('Suggested focus: ' + r.focus.join(' '));
  return lines.join('\n');
}

