import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) } }));

import handler, { SNOOZE_EXPIRY_MINUTES, SNOOZE_MINUTES, SNOOZE_PREFIX, cleanSchedule, dueReminders, inQuiet as serverInQuiet, runTick, snoozeSignature, withSnooze } from '../../api/push';
import type { SubRow } from '../../api/push';
import { DEFAULT_PROGRAM } from '../program';
import { buildPushSchedule } from '../push';
import { WINDOW_MINUTES, daysText, describeDevices, nextFire, nextForRow, readSchedule, zonedParts } from '../pushPreview';
import { DEFAULT_REMINDERS, buildIcs, buildReminderEvents, inQuiet, loadReminders, quietCovers, reminderDays, saveReminders, usualDays } from '../reminders';
import type { ReminderPlan } from '../reminders';

const LAGOS = 'Africa/Lagos';
// Friday 9 Oct 2026, 10:00 in Lagos (UTC+1).
const NOW = new Date('2026-10-09T10:00:00+01:00');
const at = (iso: string) => new Date(iso);
const plan = (over: Partial<ReminderPlan> = {}): ReminderPlan => ({ ...structuredClone(DEFAULT_REMINDERS), ...over });
const quietOn = { on: true, from: '22:00', to: '07:00' };

describe('which days a reminder is on', () => {
  it('follows the usual days until the person chooses their own', () => {
    expect(usualDays('checkin', DEFAULT_PROGRAM)).toEqual([]);
    expect(usualDays('training', DEFAULT_PROGRAM)).toEqual([1, 3, 5]);
    expect(usualDays('review', DEFAULT_PROGRAM)).toEqual([0]);
    expect(reminderDays(plan(), 'training', DEFAULT_PROGRAM)).toEqual([1, 3, 5]);
  });
  it('uses the chosen days, sorted and without repeats, and treats all seven as every day', () => {
    const p = plan({ checkin: { on: true, time: '21:00', days: [5, 1, 1, 3] } });
    expect(reminderDays(p, 'checkin', DEFAULT_PROGRAM)).toEqual([1, 3, 5]);
    expect(reminderDays(plan({ review: { on: true, time: '19:00', days: [0, 1, 2, 3, 4, 5, 6] } }), 'review', DEFAULT_PROGRAM)).toEqual([]);
  });
  it('an empty choice falls back to the usual days rather than meaning "never"', () => {
    expect(reminderDays(plan({ review: { on: true, time: '19:00', days: [] } }), 'review', DEFAULT_PROGRAM)).toEqual([0]);
  });
  it('chosen days reach the server, and the usual ones are unchanged', () => {
    const p = plan({ checkin: { on: true, time: '21:00', days: [1, 2] }, money: { on: true, time: '20:00', days: [6] } });
    const s = buildPushSchedule(p, DEFAULT_PROGRAM);
    expect(s.find((i) => i.id === 'checkin')!.days).toEqual([1, 2]);
    expect(s.find((i) => i.id === 'money')!.days).toEqual([6]);
    expect(s.find((i) => i.id === 'training')!.days).toEqual([1, 3, 5]);
    expect(s.find((i) => i.id === 'review')!.days).toEqual([0]);
  });
  it('training on chosen days replaces the programme’s days', () => {
    const p = plan({ training: { on: true, time: '17:30', days: [2, 4] } });
    expect(buildPushSchedule(p, DEFAULT_PROGRAM).find((i) => i.id === 'training')!.days).toEqual([2, 4]);
  });
});

describe('quiet hours window', () => {
  it('covers the start and not the end, within a day', () => {
    expect(inQuiet(13 * 60, '13:00', '15:00')).toBe(true);
    expect(inQuiet(14 * 60 + 59, '13:00', '15:00')).toBe(true);
    expect(inQuiet(15 * 60, '13:00', '15:00')).toBe(false);
    expect(inQuiet(12 * 60 + 59, '13:00', '15:00')).toBe(false);
  });
  it('wraps past midnight', () => {
    expect(inQuiet(22 * 60, '22:00', '07:00')).toBe(true);
    expect(inQuiet(0, '22:00', '07:00')).toBe(true);
    expect(inQuiet(6 * 60 + 59, '22:00', '07:00')).toBe(true);
    expect(inQuiet(7 * 60, '22:00', '07:00')).toBe(false);
    expect(inQuiet(21 * 60 + 59, '22:00', '07:00')).toBe(false);
  });
  it('an empty or broken window covers nothing', () => {
    expect(inQuiet(600, '08:00', '08:00')).toBe(false);
    expect(inQuiet(600, 'x', '08:00')).toBe(false);
  });
  it('the app and the server agree on every minute for several windows', () => {
    for (const [f, t] of [['22:00', '07:00'], ['13:00', '15:00'], ['00:00', '06:00'], ['23:59', '00:01'], ['09:00', '09:00']]) {
      for (let m = 0; m < 1440; m++) expect(serverInQuiet(m, f, t), `${f}-${t} @ ${m}`).toBe(inQuiet(m, f, t));
    }
  });
  it('is sent to the server only while it is on, and only when it is a real window', () => {
    expect(buildPushSchedule(plan(), DEFAULT_PROGRAM).every((i) => i.quiet === undefined)).toBe(true);
    expect(buildPushSchedule(plan({ quiet: quietOn }), DEFAULT_PROGRAM).every((i) => i.quiet?.from === '22:00' && i.quiet.to === '07:00')).toBe(true);
    expect(buildPushSchedule(plan({ quiet: { on: true, from: '08:00', to: '08:00' } }), DEFAULT_PROGRAM).every((i) => i.quiet === undefined)).toBe(true);
  });
});

describe('the server and quiet hours', () => {
  const item = (over: Record<string, unknown> = {}) => ({ id: 'checkin', time: '21:00', days: [], title: 't', body: 'b', ...over });
  it('keeps a valid quiet window and drops a malformed one', () => {
    expect(cleanSchedule([item({ quiet: { from: '22:00', to: '07:00' } })])[0].quiet).toEqual({ from: '22:00', to: '07:00' });
    expect(cleanSchedule([item({ quiet: { from: '25:00', to: '07:00' } })])[0].quiet).toBeUndefined();
    expect(cleanSchedule([item({ quiet: 'x' })])[0].quiet).toBeUndefined();
    expect(cleanSchedule([item({ quiet: { from: '07:00', to: '07:00' } })])[0].quiet).toBeUndefined();
    expect(cleanSchedule([item()])[0]).toEqual({ id: 'checkin', time: '21:00', days: [], title: 't', body: 'b' });
  });
  it('sends nothing while the device’s clock is inside the window, and sends again after it', () => {
    const quiet = { from: '20:30', to: '21:30' };
    // 21:00 in Lagos is inside 20:30-21:30, so the reminder at 21:00 is skipped.
    expect(dueReminders([item({ quiet })], {}, LAGOS, at('2026-10-09T21:02:00+01:00'))).toHaveLength(0);
    expect(dueReminders([item({ quiet: { from: '22:00', to: '07:00' } })], {}, LAGOS, at('2026-10-09T21:02:00+01:00'))).toHaveLength(1);
  });
  it('a late reminder is held back if quiet hours began while it waited', () => {
    const quiet = { from: '21:05', to: '07:00' };
    expect(dueReminders([item({ quiet })], {}, LAGOS, at('2026-10-09T21:04:00+01:00'))).toHaveLength(1);
    expect(dueReminders([item({ quiet })], {}, LAGOS, at('2026-10-09T21:06:00+01:00'))).toHaveLength(0);
  });
  it('uses the device’s zone for the window, not the server’s', () => {
    const quiet = { from: '22:00', to: '07:00' };
    // 21:02 Lagos is 13:02 in Los Angeles, so a window of 22:00-07:00 there does not cover a 13:00 reminder, but the 21:00 one in Lagos is fine too.
    expect(dueReminders([item({ time: '13:00', quiet })], {}, 'America/Los_Angeles', at('2026-10-09T21:02:00+01:00'))).toHaveLength(1);
    // The same instant is 23:02 in Auckland-ish zones ahead of Lagos: 09:02 next day in Auckland, outside; but 02:02 in Los Angeles is inside.
    expect(dueReminders([item({ time: '02:00', quiet })], {}, 'America/Los_Angeles', at('2026-10-09T10:02:00+02:00'))).toHaveLength(0);
  });
});

describe('snoozing', () => {
  const item = (over: Record<string, unknown> = {}) => ({ id: 'checkin', time: '21:00', days: [], title: 'Time to check in', body: 'b', ...over });
  const snoozed = (iso: string, id = 'checkin') => ({ [SNOOZE_PREFIX + id]: iso });

  it('an hour is what the button promises', () => {
    expect(SNOOZE_MINUTES).toBe(60);
    const out = withSnooze([item()], {}, 'checkin', at('2026-10-09T21:00:30+01:00'))!;
    expect(out[SNOOZE_PREFIX + 'checkin']).toBe('2026-10-09T21:00:30.000+01:00'.length ? new Date('2026-10-09T22:00:30+01:00').toISOString() : '');
  });
  it('only snoozes a reminder the device actually has, and keeps the rest of what was recorded', () => {
    expect(withSnooze([item()], {}, 'money', NOW)).toBeNull();
    expect(withSnooze('junk', {}, 'checkin', NOW)).toBeNull();
    const out = withSnooze([item()], { checkin: '2026-10-09', _fail: 'x' }, 'checkin', NOW)!;
    expect(out.checkin).toBe('2026-10-09');
    expect(out._fail).toBe('x');
  });
  it('comes back at its time, and not before', () => {
    const last = snoozed('2026-10-09T22:00:00+01:00');
    expect(dueReminders([item()], { ...last, checkin: '2026-10-09' }, LAGOS, at('2026-10-09T21:59:00+01:00'))).toHaveLength(0);
    const due = dueReminders([item()], { ...last, checkin: '2026-10-09' }, LAGOS, at('2026-10-09T22:00:00+01:00'));
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ id: 'checkin', snoozed: true });
  });
  it('is not held to the reminder’s days or its usual time', () => {
    const last = snoozed('2026-10-09T15:00:00+01:00'); // Friday afternoon, reminder is Mondays at 21:00
    expect(dueReminders([item({ days: [1] })], last, LAGOS, at('2026-10-09T15:01:00+01:00'))).toHaveLength(1);
  });
  it('waits out quiet hours and then comes back', () => {
    const quiet = { from: '22:00', to: '07:00' };
    const last = snoozed('2026-10-09T23:00:00+01:00');
    expect(dueReminders([item({ quiet })], last, LAGOS, at('2026-10-09T23:30:00+01:00'))).toHaveLength(0);
    expect(dueReminders([item({ quiet })], last, LAGOS, at('2026-10-10T06:59:00+01:00'))).toHaveLength(0);
    expect(dueReminders([item({ quiet })], last, LAGOS, at('2026-10-10T07:00:00+01:00'))).toHaveLength(1);
  });
  it('is dropped if it could not be delivered for twelve hours', () => {
    const last = snoozed('2026-10-09T10:00:00+01:00');
    const t = (m: number) => new Date(at('2026-10-09T10:00:00+01:00').getTime() + m * 60_000);
    expect(dueReminders([item()], last, LAGOS, t(SNOOZE_EXPIRY_MINUTES - 1))).toHaveLength(1);
    expect(dueReminders([item()], last, LAGOS, t(SNOOZE_EXPIRY_MINUTES))).toHaveLength(0);
  });
  it('switching the reminder off cancels its snooze, and a broken snooze is ignored', () => {
    expect(dueReminders([], snoozed('2026-10-09T09:00:00+01:00'), LAGOS, NOW)).toHaveLength(0);
    expect(dueReminders([item()], snoozed('not a date'), LAGOS, NOW)).toHaveLength(0);
    expect(dueReminders([item()], { [SNOOZE_PREFIX + 'checkin']: 5 }, LAGOS, NOW)).toHaveLength(0);
  });
  it('a reminder due at its usual time and snoozed at once is sent once', () => {
    const due = dueReminders([item({ time: '10:00' })], snoozed('2026-10-09T09:30:00+01:00'), LAGOS, NOW);
    expect(due).toHaveLength(1);
    expect(due[0].snoozed).toBeUndefined();
  });

  const row = (last_sent: Record<string, string>, schedule: unknown = [item()]): SubRow => ({ endpoint: 'https://fcm.googleapis.com/send/abc', user_id: 'u', p256dh: 'p', auth: 'a', tz: LAGOS, schedule, last_sent });
  it('a snoozed reminder is sent once, does not count as that day’s send, and ends the snooze', async () => {
    const send = vi.fn().mockResolvedValue('ok');
    const r = await runTick([row({ checkin: '2026-10-08', ...snoozed('2026-10-09T22:00:00+01:00') })], at('2026-10-09T22:00:30+01:00'), send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.updates[0].last_sent).toEqual({ checkin: '2026-10-08' }); // today's usual send is not used up by the snooze
  });
  it('a snooze that fails to send is kept for the next minute', async () => {
    const send = vi.fn().mockResolvedValue('retry');
    const r = await runTick([row({ checkin: '2026-10-09', ...snoozed('2026-10-09T22:00:00+01:00') })], at('2026-10-09T22:00:30+01:00'), send);
    expect(r.updates.every((u) => SNOOZE_PREFIX + 'checkin' in u.last_sent)).toBe(true);
  });
  it('the usual send also clears a waiting snooze, and old snoozes for reminders that are gone are forgotten', async () => {
    const send = vi.fn().mockResolvedValue('ok');
    const r = await runTick([row({ ...snoozed('2026-10-09T08:00:00+01:00'), ...snoozed('2026-10-09T08:00:00+01:00', 'money') }, [item({ time: '10:00' })])], NOW, send);
    expect(r.updates[0].last_sent).toEqual({ checkin: '2026-10-09' });
  });
});

describe('the snooze request from the phone', () => {
  const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-secret', VAPID_PRIVATE_KEY: 'vp', VITE_VAPID_PUBLIC_KEY: 'vpub', CRON_SECRET: 'cron-secret-value' };
  const ENDPOINT = 'https://fcm.googleapis.com/send/abc';
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  let fetchMock: ReturnType<typeof vi.fn>;
  const call = async (body: unknown, auth?: string) => {
    const out = { status: 0, body: undefined as unknown };
    const res = {
      status(c: number) {
        out.status = c;
        return res;
      },
      setHeader() {
        return res;
      },
      json(b: unknown) {
        out.body = b;
      },
      end() {},
    };
    await handler({ method: 'POST', headers: auth ? { authorization: auth } : {}, body }, res);
    return out;
  };
  const sig = (endpoint = ENDPOINT, id = 'checkin') => snoozeSignature(ENV.CRON_SECRET, endpoint, id);
  const stored = (schedule: unknown = [{ id: 'checkin', time: '21:00', days: [], title: 't', body: 'b' }]) => ({ endpoint: ENDPOINT, user_id: 'u', p256dh: 'p', auth: 'a', tz: LAGOS, schedule, last_sent: { checkin: '2026-10-09' } });

  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    sendNotification.mockReset().mockResolvedValue({});
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('records the snooze when the signature is right', async () => {
    fetchMock.mockResolvedValueOnce(json([stored()])).mockResolvedValueOnce(json({}));
    const r = await call({ snooze: { endpoint: ENDPOINT, id: 'checkin', sig: sig() } });
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    const patch = fetchMock.mock.calls[1][1] as RequestInit;
    expect(patch.method).toBe('PATCH');
    const saved = JSON.parse(String(patch.body)).last_sent;
    expect(saved.checkin).toBe('2026-10-09');
    const due = Date.parse(saved[SNOOZE_PREFIX + 'checkin']);
    expect(Math.abs(due - (Date.now() + SNOOZE_MINUTES * 60_000))).toBeLessThan(5000);
  });
  it('refuses a wrong, missing or borrowed signature without touching the database', async () => {
    const bad = [
      { endpoint: ENDPOINT, id: 'checkin', sig: 'nope' },
      { endpoint: ENDPOINT, id: 'checkin' },
      { endpoint: ENDPOINT, id: 'money', sig: sig() }, // signature made for another reminder
      { endpoint: 'https://fcm.googleapis.com/send/other', id: 'checkin', sig: sig() }, // made for another device
      { endpoint: 'http://localhost/x', id: 'checkin', sig: sig('http://localhost/x') },
      { endpoint: ENDPOINT, id: '../x', sig: sig(ENDPOINT, '../x') },
    ];
    for (const snooze of bad) expect((await call({ snooze })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('a signature made with a different secret is refused', async () => {
    const forged = snoozeSignature('some-other-secret', ENDPOINT, 'checkin');
    expect((await call({ snooze: { endpoint: ENDPOINT, id: 'checkin', sig: forged } })).status).toBe(401);
  });
  it('says it did nothing for a reminder the device no longer has, or a device the server no longer has', async () => {
    fetchMock.mockResolvedValueOnce(json([stored([])]));
    expect((await call({ snooze: { endpoint: ENDPOINT, id: 'checkin', sig: sig() } })).body).toEqual({ ok: false });
    fetchMock.mockResolvedValueOnce(json([]));
    expect((await call({ snooze: { endpoint: ENDPOINT, id: 'checkin', sig: sig() } })).body).toEqual({ ok: false });
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit | undefined)?.method !== 'PATCH')).toBe(true);
  });
  it('a failed save is an error the phone can show, not a success', async () => {
    fetchMock.mockResolvedValueOnce(json([stored()])).mockResolvedValueOnce(new Response('x', { status: 500 }));
    expect((await call({ snooze: { endpoint: ENDPOINT, id: 'checkin', sig: sig() } })).status).toBe(500);
  });
  it('anything else without a sign-in is still refused', async () => {
    expect((await call({})).status).toBe(401);
    expect((await call(undefined)).status).toBe(401);
    expect((await call({ snooze: 'x' })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not let the snooze route stand in for the clock or a signed-in test', async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    const r = await call({ snooze: { endpoint: ENDPOINT, id: 'checkin', sig: sig() } }, `Bearer ${ENV.CRON_SECRET}`);
    expect(r.body).toMatchObject({ devices: 0 }); // the clock ran as usual
  });
  it('each reminder is sent with its own signature, and the test notification without one', async () => {
    // The tick uses the real clock, so line the reminder up with it.
    const p = zonedParts(new Date(), LAGOS)!;
    const time = `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`;
    const due = [{ id: 'checkin', time, days: [], title: 'Time to check in', body: 'b' }];
    fetchMock.mockResolvedValueOnce(json([{ ...stored(due), last_sent: {} }]));
    await call({}, `Bearer ${ENV.CRON_SECRET}`);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendNotification.mock.calls[0][1] as string);
    expect(sent).toMatchObject({ tag: 'checkin', snooze: { id: 'checkin', sig: sig() } });
    expect(JSON.stringify(sent)).not.toContain(ENV.CRON_SECRET);

    sendNotification.mockClear();
    fetchMock.mockReset().mockResolvedValueOnce(json({ id: 'u1', app_metadata: {} })).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json([stored()]));
    await call({}, 'Bearer good.jwt');
    const test = JSON.parse(sendNotification.mock.calls[0][1] as string);
    expect(test.tag).toBe('test');
    expect(test.snooze).toBeUndefined();
  });
});

describe('the preview agrees with the sender for chosen days and quiet hours', () => {
  const base = { id: 'checkin', title: 't', body: 'b' };
  type It = { id: string; time: string; days: number[]; quiet?: { from: string; to: string } };
  const firstSend = (it: It, tz: string, from: Date, lastSent: Record<string, string> = {}) => {
    for (let m = 0; m <= 8 * 24 * 60; m++) {
      const t = new Date(from.getTime() + m * 60_000);
      if (dueReminders([{ ...base, ...it }], lastSent, tz, t).length) return t;
    }
    return null;
  };
  const cases: [string, It, string, string][] = [
    ['two chosen days', { id: 'checkin', time: '21:00', days: [2, 6] }, LAGOS, '2026-10-09T10:00:00+01:00'],
    ['a time inside quiet hours is never sent', { id: 'checkin', time: '23:00', days: [], quiet: { from: '22:00', to: '07:00' } }, LAGOS, '2026-10-09T10:00:00+01:00'],
    ['a time just outside quiet hours', { id: 'checkin', time: '21:59', days: [], quiet: { from: '22:00', to: '07:00' } }, LAGOS, '2026-10-09T10:00:00+01:00'],
    ['a time at the very start of the window', { id: 'checkin', time: '22:00', days: [], quiet: { from: '22:00', to: '07:00' } }, LAGOS, '2026-10-09T10:00:00+01:00'],
    ['a time at the very end of the window', { id: 'checkin', time: '07:00', days: [], quiet: { from: '22:00', to: '07:00' } }, LAGOS, '2026-10-09T05:00:00+01:00'],
    ['a daytime window in another zone', { id: 'checkin', time: '14:00', days: [1, 5], quiet: { from: '13:00', to: '15:00' } }, 'America/Los_Angeles', '2026-10-09T10:00:00+01:00'],
    ['a quiet window that starts just after the time, while the reminder is late', { id: 'checkin', time: '21:00', days: [], quiet: { from: '21:05', to: '07:00' } }, LAGOS, '2026-10-09T21:06:00+01:00'],
  ];
  for (const [name, it, tz, from] of cases) {
    it_(name, () => {
      const start = at(from);
      const fire = nextFire(it, tz, start);
      const hit = firstSend(it, tz, start);
      if (hit === null) {
        expect(fire, 'the sender never sends, so the preview says never').toBeNull();
        return;
      }
      expect(fire, 'a prediction').not.toBeNull();
      const local = zonedParts(hit, tz)!;
      const target = Number(it.time.slice(0, 2)) * 60 + Number(it.time.slice(3));
      expect(local.weekday).toBe(fire!.weekday);
      expect(local.minutes - target).toBeGreaterThanOrEqual(0);
      expect(local.minutes - target).toBeLessThan(fire!.when === 'now' ? WINDOW_MINUTES : 1);
    });
  }
});
function it_(name: string, fn: () => void) {
  it(name, fn);
}

describe('showing it on screen', () => {
  it('says why a reminder will not arrive when its time is inside quiet hours', () => {
    const p = plan({ checkin: { on: true, time: '23:00' }, quiet: quietOn });
    expect(nextForRow('checkin', p, DEFAULT_PROGRAM, LAGOS, NOW)).toBe('never (inside quiet hours)');
    expect(nextForRow('checkin', plan({ checkin: { on: true, time: '21:00' }, quiet: quietOn }), DEFAULT_PROGRAM, LAGOS, NOW)).toBe('today 21:00');
  });
  it('shows chosen days in the server view', () => {
    const p = plan({ checkin: { on: true, time: '21:00', days: [1, 2] } });
    expect(daysText(buildPushSchedule(p, DEFAULT_PROGRAM)[0].days)).toBe('Mon, Tue');
  });
  it('reads quiet hours and a waiting snooze from what the server holds', () => {
    const p = plan({ quiet: quietOn });
    const schedule = buildPushSchedule(p, DEFAULT_PROGRAM);
    expect(readSchedule(schedule)).toEqual(schedule);
    const v = describeDevices([{ endpoint: 'https://fcm.googleapis.com/x', tz: LAGOS, schedule, last_sent: { [SNOOZE_PREFIX + 'checkin']: '2026-10-09T10:30:00+01:00' } }], 'https://fcm.googleapis.com/x', p, DEFAULT_PROGRAM, NOW, LAGOS)[0];
    expect(v.quiet).toBe('22:00 to 07:00');
    expect(v.inSync).toBe(true);
    expect(v.items.find((i) => i.id === 'checkin')!.snoozedUntil).toBe('10:30');
    expect(v.items.find((i) => i.id === 'review')!.snoozedUntil).toBeNull();
  });
  it('a server holding the old schedule is reported as behind once days or quiet hours change', () => {
    const old = buildPushSchedule(plan(), DEFAULT_PROGRAM);
    const changed = plan({ quiet: quietOn });
    expect(describeDevices([{ endpoint: 'e', tz: LAGOS, schedule: old, last_sent: {} }], 'e', changed, DEFAULT_PROGRAM, NOW, LAGOS)[0].inSync).toBe(false);
  });
});

describe('the calendar file follows the same choices', () => {
  it('uses the chosen days for each event, and every day when all seven are picked', () => {
    const p = plan({ checkin: { on: true, time: '21:00', days: [1, 2] }, training: { on: true, time: '17:30', days: [2, 4] }, review: { on: true, time: '19:00', days: [0, 1, 2, 3, 4, 5, 6] } });
    const ics = buildIcs(p, DEFAULT_PROGRAM, '2026-10-12', new Date(Date.UTC(2026, 9, 12, 9)));
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TU');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,TH');
    expect(ics).not.toContain('BYDAY=MO,WE,FR');
    expect(ics).not.toContain('BYDAY=SU');
    expect(ics).toContain('RRULE:FREQ=DAILY');
    expect(ics).toContain('DTSTART:20261014T173000'.replace('14', '13')); // first Tuesday on or after Mon 12 Oct
  });
  it('leaves out a reminder whose time falls inside quiet hours, as push would', () => {
    const p = plan({ checkin: { on: true, time: '23:00' }, quiet: quietOn });
    expect(buildReminderEvents(p, DEFAULT_PROGRAM).map((e) => e.uid)).toEqual(['training', 'review']);
    expect(quietCovers(p, '23:00')).toBe(true);
    expect(quietCovers(p, '21:00')).toBe(false);
    expect(quietCovers(plan({ quiet: { ...quietOn, on: false } }), '23:00')).toBe(false);
    expect(quietCovers(plan(), '23:00')).toBe(false);
  });
  it('days and quiet hours give the same answer for push and for the file', () => {
    const p = plan({ checkin: { on: true, time: '21:00', days: [3] }, money: { on: true, time: '23:30' }, quiet: quietOn });
    const push = buildPushSchedule(p, DEFAULT_PROGRAM).filter((i) => !quietCovers(p, i.time)).map((i) => [i.id, i.days]);
    const file = buildReminderEvents(p, DEFAULT_PROGRAM).map((e) => [e.uid, e.days]);
    expect(file).toEqual(push);
  });
});

describe('saving and loading the choices', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('remembers days and quiet hours', () => {
    saveReminders(plan({ checkin: { on: true, time: '08:15', days: [6, 1] }, quiet: { on: true, from: '23:00', to: '06:30' } }));
    const back = loadReminders();
    expect(back.checkin).toEqual({ on: true, time: '08:15', days: [1, 6] });
    expect(back.quiet).toEqual({ on: true, from: '23:00', to: '06:30' });
  });
  it('an older save without them still loads, with usual days and quiet hours off', () => {
    store.set('life-dashboard:v1:reminders', JSON.stringify({ checkin: { on: false, time: '20:00' } }));
    const back = loadReminders();
    expect(back.checkin).toEqual({ on: false, time: '20:00' });
    expect(back.quiet).toEqual({ on: false, from: '22:00', to: '07:00' });
  });
  it('ignores junk', () => {
    store.set('life-dashboard:v1:reminders', JSON.stringify({ checkin: { on: true, time: '21:00', days: [9, -1, 'x', 2.5, 4, 4] }, review: { on: true, time: '19:00', days: 'all' }, quiet: { on: 'yes', from: '99:00', to: '06:00' } }));
    const back = loadReminders();
    expect(back.checkin.days).toEqual([4]);
    expect(back.review.days).toBeUndefined();
    expect(back.quiet).toEqual({ on: false, from: '22:00', to: '06:00' });
    store.set('life-dashboard:v1:reminders', '{{');
    expect(loadReminders()).toEqual(DEFAULT_REMINDERS);
  });
});

describe('the Snooze button in the service worker', () => {
  type Listener = (e: Record<string, unknown>) => void;
  const make = (over: { subscription?: unknown; fetchImpl?: (u: string, i: RequestInit) => Promise<unknown> } = {}) => {
    const listeners: Record<string, Listener> = {};
    const shown: { title: string; options: Record<string, unknown> }[] = [];
    const fetchCalls: { url: string; init: RequestInit }[] = [];
    const registration = {
      scope: 'https://app.example/',
      showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }),
      pushManager: { getSubscription: async () => ('subscription' in over ? over.subscription : { endpoint: 'https://fcm.googleapis.com/send/abc' }) },
    };
    const clients = { opened: [] as string[], matchAll: async () => [], openWindow: async (u: string) => void clients.opened.push(u) };
    const self = { registration, clients, location: { origin: 'https://app.example' }, addEventListener: (n: string, f: Listener) => (listeners[n] = f) };
    const fetchFn = async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return (over.fetchImpl ?? (async () => ({ ok: true, json: async () => ({ ok: true }) })))(url, init);
    };
    const code = readFileSync('public/sw.js', 'utf8');
    new Function('self', 'caches', 'fetch', 'Request', 'URL', code)(self, {}, fetchFn, class {}, URL);
    const run = async (name: string, event: Record<string, unknown>) => {
      const waits: Promise<unknown>[] = [];
      listeners[name]({ ...event, waitUntil: (p: Promise<unknown>) => void waits.push(p) });
      await Promise.all(waits);
    };
    return { run, shown, fetchCalls, clients };
  };
  const pushEvent = (d: unknown) => ({ data: { json: () => d } });
  const click = (action: string, data: unknown) => ({ action, notification: { close: vi.fn(), data } });

  it('adds the button only to a reminder that carries a signed snooze', async () => {
    const w = make();
    await w.run('push', pushEvent({ title: 'Time', body: 'b', tag: 'checkin', snooze: { id: 'checkin', sig: 'abc' } }));
    await w.run('push', pushEvent({ title: 'Life Dashboard', body: 'works', tag: 'test' }));
    expect(w.shown[0].options.actions).toEqual([{ action: 'snooze', title: 'Snooze 1 hour' }]);
    expect(w.shown[0].options.data).toEqual({ snooze: { id: 'checkin', sig: 'abc' } });
    expect(w.shown[1].options.actions).toBeUndefined();
  });
  it('ignores a malformed snooze rather than showing a button that cannot work', async () => {
    const w = make();
    await w.run('push', pushEvent({ title: 'x', tag: 't', snooze: { id: 5, sig: {} } }));
    expect(w.shown[0].options.actions).toBeUndefined();
  });
  it('tapping Snooze asks the server, closes the notification, and does not open the app', async () => {
    const w = make();
    const ev = click('snooze', { snooze: { id: 'checkin', sig: 'abc' } });
    await w.run('notificationclick', ev);
    expect(ev.notification.close).toHaveBeenCalled();
    expect(w.fetchCalls).toHaveLength(1);
    expect(w.fetchCalls[0].url).toBe('./api/push');
    expect(JSON.parse(String(w.fetchCalls[0].init.body))).toEqual({ snooze: { endpoint: 'https://fcm.googleapis.com/send/abc', id: 'checkin', sig: 'abc' } });
    expect(w.clients.opened).toEqual([]);
    expect(w.shown).toEqual([]); // nothing more to say when it worked
  });
  it('says so when the snooze could not be saved', async () => {
    for (const fetchImpl of [async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ ok: false }) }), async () => Promise.reject(new Error('offline'))]) {
      const w = make({ fetchImpl });
      await w.run('notificationclick', click('snooze', { snooze: { id: 'checkin', sig: 'abc' } }));
      expect(w.shown.map((s) => s.title)).toEqual(['Couldn’t snooze']);
    }
    const none = make({ subscription: null });
    await none.run('notificationclick', click('snooze', { snooze: { id: 'checkin', sig: 'abc' } }));
    expect(none.fetchCalls).toHaveLength(0);
    expect(none.shown.map((s) => s.title)).toEqual(['Couldn’t snooze']);
    const nodata = make();
    await nodata.run('notificationclick', click('snooze', null));
    expect(nodata.fetchCalls).toHaveLength(0);
  });
  it('tapping the notification itself still opens the app', async () => {
    const w = make();
    await w.run('notificationclick', click('', { snooze: { id: 'checkin', sig: 'abc' } }));
    expect(w.clients.opened).toEqual(['https://app.example/']);
    expect(w.fetchCalls).toHaveLength(0);
  });
});
