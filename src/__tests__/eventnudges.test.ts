import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanSchedule, dueReminders, runTick } from '../../api/push';
import type { SubRow } from '../../api/push';
import { DEFAULT_PROGRAM } from '../program';
import { buildPushSchedule } from '../push';
import type { PushItem } from '../push';
import { BILL_DAYS_AHEAD, BILL_TIME, MIN_STREAK, REWARD_TIME, STREAK_TIME, buildEventItems, rewardWaiting } from '../pushEvents';
import { WINDOW_MINUTES, daysText, describeDevices, nextFire, readSchedule, reminderName, zonedParts } from '../pushPreview';
import { DEFAULT_REMINDERS, eventOn, loadReminders, saveReminders } from '../reminders';
import type { ReminderPlan } from '../reminders';
import { emptyData } from '../types';
import type { AppData, PlanItem } from '../types';

const LAGOS = 'Africa/Lagos';
// Wednesday 14 Oct 2026, 10:00 on the device's own clock (built from local parts so the date never depends on the test machine's zone).
const NOW = new Date(2026, 9, 14, 10, 0);
const EVENING = new Date(2026, 9, 14, 19, 0);
const plan = (over: Partial<ReminderPlan> = {}): ReminderPlan => ({ ...structuredClone(DEFAULT_REMINDERS), ...over });
const key = (m: number, d: number) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** A day with three of the four plates loaded. */
const strong = (d: AppData, date: string) => void (d.days[date] = { code: true, money: true, energy: 3 });
const withStreak = (days: number): AppData => {
  const d = emptyData();
  for (let i = 1; i <= days; i++) strong(d, key(10, 14 - i));
  return d;
};
const bill = (over: Partial<PlanItem> = {}): PlanItem => ({ id: 'b1', date: key(10, 15), title: 'Rent', kind: 'bill', amount: 50000, repeat: 'none', doneOn: [], ...over });
const ids = (items: PushItem[]) => items.map((i) => i.id);

describe('streak at risk', () => {
  it('appears for a streak that is worth protecting, on today, at the evening time, with fixed wording', () => {
    const items = buildEventItems(withStreak(MIN_STREAK), plan(), NOW);
    expect(items).toEqual([{ id: 'streak', time: STREAK_TIME, days: [], title: 'Your streak is at risk', body: 'Log a few plates today to keep it going.', date: '2026-10-14' }]);
  });
  it('is not sent for a short streak, or once today is already strong, or when it is switched off', () => {
    expect(buildEventItems(withStreak(MIN_STREAK - 1), plan(), NOW)).toEqual([]);
    const d = withStreak(5);
    strong(d, '2026-10-14');
    expect(buildEventItems(d, plan(), NOW)).toEqual([]);
    expect(buildEventItems(withStreak(5), plan({ events: { streak: false } }), NOW)).toEqual([]);
  });
  it('a streak that ended yesterday is not "at risk": it is already over', () => {
    const d = emptyData();
    for (let i = 2; i <= 6; i++) strong(d, key(10, 14 - i)); // up to the day before yesterday
    expect(buildEventItems(d, plan(), NOW)).toEqual([]);
  });
  it('a day with only two plates still leaves it at risk', () => {
    const d = withStreak(4);
    d.days['2026-10-14'] = { code: true, money: true };
    expect(ids(buildEventItems(d, plan(), NOW))).toEqual(['streak']);
  });
});

describe('a reward waiting to be claimed', () => {
  /** A finished previous week (Mon 5 to Sun 11 Oct): three sessions, five strong days and a savings transfer. */
  const earnedLastWeek = (): AppData => {
    const d = emptyData();
    for (const day of [5, 7, 9]) d.sessions[`${key(10, day)}|push`] = { date: key(10, day), day: 'push', loads: {}, reps: {}, finished: true };
    for (const day of [5, 6, 7, 8, 9, 10]) strong(d, key(10, day));
    d.money.txns.push({ id: 's1', date: key(10, 6), amount: 1000, kind: 'saving', category: 'Savings', note: '' } as never);
    return d;
  };
  it('is detected, and goes away once it is claimed', () => {
    const d = earnedLastWeek();
    expect(rewardWaiting(d, '2026-10-14')).toBe(true);
    d.rewards.claims.push({ id: 'c', tier: 'week', period: '2026-10-05', itemId: 'x', name: 'Treat', cost: 0, date: '2026-10-12', logged: false });
    expect(rewardWaiting(d, '2026-10-14')).toBe(false);
    expect(rewardWaiting(emptyData(), '2026-10-14')).toBe(false);
  });
  it('is nudged at the reward time today, or tomorrow if that time has already passed', () => {
    const d = earnedLastWeek();
    const [h] = REWARD_TIME.split(':').map(Number);
    expect(NOW.getHours()).toBeLessThan(h);
    expect(buildEventItems(d, plan(), NOW).find((i) => i.id === 'reward')).toEqual({ id: 'reward', time: REWARD_TIME, days: [], title: 'A reward is ready', body: 'You earned a reward. Open Rewards to claim it.', date: '2026-10-14' });
    expect(buildEventItems(d, plan(), EVENING).find((i) => i.id === 'reward')!.date).toBe('2026-10-15');
  });
  it('is left out when switched off', () => {
    expect(buildEventItems(earnedLastWeek(), plan({ events: { reward: false } }), NOW).some((i) => i.id === 'reward')).toBe(false);
  });
});

describe('a bill falling due', () => {
  const data = (...plans: PlanItem[]): AppData => ({ ...emptyData(), plans });
  it('gets a nudge on each day it is due within the next days, with no name or amount in it', () => {
    const items = buildEventItems(data(bill({ date: key(10, 14) }), bill({ id: 'b2', date: key(10, 16) })), plan(), NOW);
    expect(items).toEqual([
      { id: 'bill-20261014', time: BILL_TIME, days: [], title: 'A bill is due today', body: 'Open the Month calendar to see what is due.', date: '2026-10-14' },
      { id: 'bill-20261016', time: BILL_TIME, days: [], title: 'A bill is due today', body: 'Open the Month calendar to see what is due.', date: '2026-10-16' },
    ]);
  });
  it('one nudge per day however many bills fall on it', () => {
    expect(buildEventItems(data(bill(), bill({ id: 'b2' })), plan(), NOW)).toHaveLength(1);
  });
  it('skips a ticked bill, other kinds of plan, and bills further ahead than the window', () => {
    expect(buildEventItems(data(bill({ doneOn: [key(10, 15)] })), plan(), NOW)).toEqual([]);
    for (const kind of ['income', 'task', 'event'] as const) expect(buildEventItems(data(bill({ kind })), plan(), NOW)).toEqual([]);
    expect(buildEventItems(data(bill({ date: key(10, 14 + BILL_DAYS_AHEAD + 1) })), plan(), NOW)).toEqual([]);
    expect(buildEventItems(data(bill({ date: key(10, 13) })), plan(), NOW)).toEqual([]);
  });
  it('follows a monthly bill, including a short month', () => {
    expect(ids(buildEventItems(data(bill({ date: '2026-01-15', repeat: 'monthly' })), plan(), NOW))).toEqual(['bill-20261015']);
    const jan31 = bill({ date: '2026-01-31', repeat: 'monthly' });
    expect(ids(buildEventItems(data(jan31), plan(), new Date(2026, 1, 27, 10)))).toEqual(['bill-20260228']);
  });
  it('is left out when switched off', () => {
    expect(buildEventItems(data(bill()), plan({ events: { bills: false } }), NOW)).toEqual([]);
  });
});

describe('what the server is given', () => {
  it('has only fixed wording, a date and a time: nothing the person logged', () => {
    const d = withStreak(5);
    d.plans.push(bill({ title: 'SecretLandlordName', amount: 987654, date: key(10, 15) }));
    d.money.txns.push({ id: 't', date: '2026-10-13', amount: 424242, kind: 'expense', category: 'Food', note: 'private note about lunch' } as never);
    d.career.githubUser = 'my-github-handle';
    const items = buildEventItems(d, plan(), NOW);
    expect(items.length).toBeGreaterThan(1);
    const wire = JSON.stringify(buildPushSchedule(plan({ quiet: { on: true, from: '22:00', to: '07:00' } }), DEFAULT_PROGRAM, items));
    for (const secret of ['SecretLandlordName', '987654', '424242', 'private note', 'my-github-handle', 'Rent', 'b1']) expect(wire).not.toContain(secret);
    for (const i of items) expect(Object.keys(i).sort()).toEqual(['body', 'date', 'days', 'id', 'time', 'title']);
    const fixed = new Set(['Your streak is at risk', 'A reward is ready', 'A bill is due today']);
    expect(items.every((i) => fixed.has(i.title))).toBe(true);
  });
  it('is added to the usual reminders, follows quiet hours, and fits the server’s limits', () => {
    const d = withStreak(5);
    d.plans.push(bill({ date: key(10, 14) }), bill({ id: 'b2', date: key(10, 15) }), bill({ id: 'b3', date: key(10, 16) }));
    const items = buildEventItems(d, plan(), NOW);
    const s = buildPushSchedule(plan({ quiet: { on: true, from: '22:00', to: '07:00' }, money: { on: true, time: '20:00' } }), DEFAULT_PROGRAM, items);
    expect(s.length).toBe(4 + items.length);
    expect(s.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(s).length).toBeLessThan(6000);
    expect(s.filter((i) => i.date).every((i) => i.quiet?.from === '22:00')).toBe(true);
    expect(buildPushSchedule(plan(), DEFAULT_PROGRAM, items).slice(0, 3).map((i) => i.id)).toEqual(['checkin', 'training', 'review']);
  });
  it('the nudges are not counted as one of the four reminders', () => {
    const p = plan({ checkin: { on: false, time: '21:00' }, training: { on: false, time: '17:30' }, review: { on: false, time: '19:00' } });
    expect(buildPushSchedule(p, DEFAULT_PROGRAM, []).map((i) => i.id)).toEqual([]);
  });
});

describe('the sender and one-off nudges', () => {
  const item = (over: Record<string, unknown> = {}) => ({ id: 'bill-20261015', time: '08:00', days: [], title: 'A bill is due today', body: 'b', date: '2026-10-15', ...over });
  const at = (iso: string) => new Date(iso);
  it('keeps a real date and drops a malformed one', () => {
    expect(cleanSchedule([item()])[0].date).toBe('2026-10-15');
    for (const date of ['2026-13-01', '2026-10-32', '15/10/2026', 20261015, null, '']) expect(cleanSchedule([item({ date })])[0].date, String(date)).toBeUndefined();
  });
  it('fires on its own date in the device’s zone, not on any other day', () => {
    expect(dueReminders([item()], {}, LAGOS, at('2026-10-15T08:02:00+01:00'))).toHaveLength(1);
    expect(dueReminders([item()], {}, LAGOS, at('2026-10-14T08:02:00+01:00'))).toHaveLength(0);
    expect(dueReminders([item()], {}, LAGOS, at('2026-10-16T08:02:00+01:00'))).toHaveLength(0);
    expect(dueReminders([item()], {}, LAGOS, at('2026-10-22T08:02:00+01:00'))).toHaveLength(0); // a week later, same weekday

    expect(dueReminders([item()], {}, 'America/Los_Angeles', at('2026-10-15T08:02:00+01:00'))).toHaveLength(0);
  });
  it('ignores the weekday list for a dated item', () => {
    expect(dueReminders([item({ days: [1] })], {}, LAGOS, at('2026-10-15T08:02:00+01:00'))).toHaveLength(1); // a Thursday
  });
  it('goes out once, respects the late window, and obeys quiet hours', () => {
    expect(dueReminders([item()], { 'bill-20261015': '2026-10-15' }, LAGOS, at('2026-10-15T08:02:00+01:00'))).toHaveLength(0);
    expect(dueReminders([item()], {}, LAGOS, at(`2026-10-15T08:${String(WINDOW_MINUTES).padStart(2, '0')}:00+01:00`))).toHaveLength(0);
    expect(dueReminders([item({ quiet: { from: '07:30', to: '09:00' } })], {}, LAGOS, at('2026-10-15T08:02:00+01:00'))).toHaveLength(0);
  });
  it('a sent nudge is recorded, and an old one is forgotten with its reminder', async () => {
    const row: SubRow = { endpoint: 'https://fcm.googleapis.com/x', user_id: 'u', p256dh: 'p', auth: 'a', tz: LAGOS, schedule: [item()], last_sent: { 'bill-20261001': '2026-10-01' } };
    const send = vi.fn().mockResolvedValue('ok');
    const r = await runTick([row], at('2026-10-15T08:01:00+01:00'), send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toMatchObject({ title: 'A bill is due today', tag: 'bill-20261015' });
    expect(r.updates[0].last_sent).toEqual({ 'bill-20261015': '2026-10-15' });
  });
});

describe('the preview agrees with the sender for one-off nudges', () => {
  const base = { title: 't', body: 'b' };
  const firstSend = (it: PushItem, from: Date) => {
    for (let m = 0; m <= 9 * 24 * 60; m++) {
      const t = new Date(from.getTime() + m * 60_000);
      if (dueReminders([{ ...base, ...it }], {}, LAGOS, t).length) return t;
    }
    return null;
  };
  const cases: [string, PushItem, string][] = [
    ['later today', { id: 'streak', time: '20:30', days: [], title: 't', body: 'b', date: '2026-10-14' }, '2026-10-14T10:00:00+01:00'],
    ['tomorrow', { id: 'reward', time: '18:00', days: [], title: 't', body: 'b', date: '2026-10-15' }, '2026-10-14T10:00:00+01:00'],
    ['in three days', { id: 'bill-20261017', time: '08:00', days: [], title: 't', body: 'b', date: '2026-10-17' }, '2026-10-14T10:00:00+01:00'],
    ['across a month end', { id: 'bill-20261101', time: '08:00', days: [], title: 't', body: 'b', date: '2026-11-01' }, '2026-10-30T10:00:00+01:00'],
    ['inside quiet hours', { id: 'bill-20261015', time: '23:00', days: [], title: 't', body: 'b', date: '2026-10-15', quiet: { from: '22:00', to: '07:00' } }, '2026-10-14T10:00:00+01:00'],
    ['a date already gone', { id: 'bill-20261010', time: '08:00', days: [], title: 't', body: 'b', date: '2026-10-10' }, '2026-10-14T10:00:00+01:00'],
  ];
  for (const [name, it, from] of cases) {
    test_(name, () => {
      const start = new Date(from);
      const fire = nextFire(it, LAGOS, start);
      const hit = firstSend(it, start);
      if (!hit) return expect(fire).toBeNull();
      expect(fire).not.toBeNull();
      const local = zonedParts(hit, LAGOS)!;
      expect(local.date).toBe(it.date);
      expect(local.weekday).toBe(fire!.weekday);
    });
  }
  it('says tomorrow for a nudge dated tomorrow', () => {
    expect(nextFire({ id: 'x', time: '08:00', days: [], date: '2026-10-15' }, LAGOS, new Date('2026-10-14T10:00:00+01:00'))).toMatchObject({ when: 'tomorrow', weekday: 4 });
  });
});
function test_(name: string, fn: () => void) {
  it(name, fn);
}

describe('showing nudges on screen', () => {
  const events: PushItem[] = [{ id: 'bill-20261015', time: '08:00', days: [], title: 'A bill is due today', body: 'b', date: '2026-10-15' }, { id: 'streak', time: '20:30', days: [], title: 't', body: 'b', date: '2026-10-14' }];
  it('names them plainly and shows the date instead of weekdays', () => {
    expect(reminderName('bill-20261015')).toBe('Bill due');
    expect(reminderName('streak')).toBe('Streak at risk');
    expect(reminderName('reward')).toBe('Reward ready');
    expect(reminderName('checkin')).toBe('Daily check-in');
    expect(daysText([])).toBe('every day');
    const mine = 'https://fcm.googleapis.com/x';
    const schedule = buildPushSchedule(plan(), DEFAULT_PROGRAM, events);
    const v = describeDevices([{ endpoint: mine, tz: LAGOS, schedule, last_sent: {} }], mine, plan(), DEFAULT_PROGRAM, new Date('2026-10-14T10:00:00+01:00'), LAGOS, events)[0];
    const bill = v.items.find((i) => i.id === 'bill-20261015')!;
    expect(bill).toMatchObject({ name: 'Bill due', daysText: 'on 2026-10-15', next: 'tomorrow (Thursday) 08:00' });
    expect(v.items.find((i) => i.id === 'streak')).toMatchObject({ name: 'Streak at risk', next: 'today 20:30' });
    expect(v.inSync).toBe(true);
  });
  it('reads a stored nudge back, and reports a server that is behind the data', () => {
    const schedule = buildPushSchedule(plan(), DEFAULT_PROGRAM, events);
    expect(readSchedule(schedule)).toEqual(schedule);
    const mine = 'https://fcm.googleapis.com/x';
    const stale = describeDevices([{ endpoint: mine, tz: LAGOS, schedule: buildPushSchedule(plan(), DEFAULT_PROGRAM, []), last_sent: {} }], mine, plan(), DEFAULT_PROGRAM, new Date(), LAGOS, events)[0];
    expect(stale.inSync).toBe(false);
  });
});

describe('the switches', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('everything is on until it is switched off, one at a time', () => {
    expect(eventOn(plan(), 'streak')).toBe(true);
    const p = plan({ events: { reward: false } });
    expect([eventOn(p, 'streak'), eventOn(p, 'reward'), eventOn(p, 'bills')]).toEqual([true, false, true]);
  });
  it('are remembered, and junk in a saved copy is ignored', () => {
    saveReminders(plan({ events: { bills: false } }));
    expect(loadReminders().events).toEqual({ bills: false });
    store.set('life-dashboard:v1:reminders', JSON.stringify({ events: { streak: 'no', reward: false, other: false } }));
    expect(loadReminders().events).toEqual({ reward: false });
    store.set('life-dashboard:v1:reminders', JSON.stringify({ events: 5 }));
    expect(loadReminders().events).toBeUndefined();
    store.set('life-dashboard:v1:reminders', JSON.stringify({ checkin: { on: true, time: '21:00' } }));
    expect(loadReminders().events).toBeUndefined();
  });
});
