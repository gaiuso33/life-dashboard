import { dayScore, dayStreak } from './derive';
import { plansOn } from './plan';
import type { PushItem } from './push';
import { eventOn } from './reminders';
import type { ReminderPlan } from './reminders';
import { landmarksFor, periodsFor } from './rewards';
import type { AppData } from './types';
import { addDays, toKey } from './utils';

// Nudges that depend on what you have logged: a streak about to end, a reward waiting to be claimed, a bill falling due.
//
// The server must never learn what was logged, so it is not asked to look. This device works out, from its own data, which of
// these apply in the next few days, and gives the server only one-off reminders: a date, a time and fixed wording
// ("A bill is due today"). Nothing a person typed, no name, no amount and no count ever goes into them. The server sends them on
// the day like any other reminder, and the device sends a fresh list whenever its data changes, which cancels one that no longer
// applies (you logged today, you claimed the reward, you ticked the bill).

/** The streak nudge only appears once a streak is worth protecting. */
export const MIN_STREAK = 3;
export const STREAK_TIME = '20:30';
export const REWARD_TIME = '18:00';
export const BILL_TIME = '08:00';
/** How many days ahead a due bill is scheduled. The device refreshes the list each time it syncs. */
export const BILL_DAYS_AHEAD = 2;

/** Whether a reward (this or last period, or a landmark) has been earned and not yet claimed. */
export function rewardWaiting(data: AppData, today: string): boolean {
  for (const tier of ['week', 'biweek', 'month'] as const) {
    const { current, previous } = periodsFor(data, tier, today);
    if ([current, previous].some((p) => p.unlocked && !p.claim)) return true;
  }
  return landmarksFor(data, today).ready.length > 0;
}

/** The ids and wording are fixed. Only the date and the on/off decision come from the person's data. */
export function buildEventItems(data: AppData, plan: ReminderPlan, now: Date = new Date()): PushItem[] {
  const today = toKey(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const out: PushItem[] = [];

  if (eventOn(plan, 'streak') && dayScore(data, today) < 3 && dayStreak(data, today) >= MIN_STREAK) {
    out.push({ id: 'streak', time: STREAK_TIME, days: [], title: 'Your streak is at risk', body: 'Log a few plates today to keep it going.', date: today });
  }

  if (eventOn(plan, 'reward') && rewardWaiting(data, today)) {
    const [h, m] = REWARD_TIME.split(':').map(Number);
    // Once today's time has passed it goes out tomorrow, so something earned in the evening is still nudged.
    out.push({ id: 'reward', time: REWARD_TIME, days: [], title: 'A reward is ready', body: 'You earned a reward. Open Rewards to claim it.', date: minutes < h * 60 + m ? today : addDays(today, 1) });
  }

  if (eventOn(plan, 'bills')) {
    for (let i = 0; i <= BILL_DAYS_AHEAD; i++) {
      const date = addDays(today, i);
      if (plansOn(data, date).some((o) => o.item.kind === 'bill' && !o.done)) {
        out.push({ id: `bill-${date.replace(/-/g, '')}`, time: BILL_TIME, days: [], title: 'A bill is due today', body: 'Open the Month calendar to see what is due.', date });
      }
    }
  }
  return out;
}
