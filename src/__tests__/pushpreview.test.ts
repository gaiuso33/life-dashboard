import { describe, expect, it } from 'vitest';
import { WINDOW_MINUTES as SERVER_WINDOW, dueReminders } from '../../api/push';
import { DEFAULT_PROGRAM } from '../program';
import { DEFAULT_REMINDERS } from '../reminders';
import { buildPushSchedule } from '../push';
import { FAILING_AFTER_HOURS, WINDOW_MINUTES, agoText, daysText, describeDevices, failingInfo, failingText, fireText, nextFire, nextForRow, readSchedule, serviceName, zonedParts } from '../pushPreview';

// Friday 9 Oct 2026, 10:00 in Lagos (UTC+1).
const NOW = new Date('2026-10-09T10:00:00+01:00');
const at = (iso: string) => new Date(iso);
const item = (over: Record<string, unknown> = {}) => ({ id: 'training', time: '17:30', days: [1, 3, 5], ...over });
const LAGOS = 'Africa/Lagos';

describe('when a reminder fires next', () => {
  it('says today when the time is still ahead on a day it applies', () => {
    expect(nextFire(item(), LAGOS, NOW)).toEqual({ when: 'today', weekday: 5, time: '17:30' });
    expect(fireText(nextFire(item(), LAGOS, NOW))).toBe('today 17:30');
  });
  it('skips ahead to the next gym day once today’s time has passed (the Sunday mix-up)', () => {
    const sunday = at('2026-10-18T12:24:00+01:00');
    expect(fireText(nextFire(item(), LAGOS, sunday))).toBe('tomorrow (Monday) 17:30');
    expect(fireText(nextFire(item({ time: '12:29' }), LAGOS, sunday))).toBe('tomorrow (Monday) 12:29'); // not a gym day today, so five minutes ahead does nothing
  });
  it('says tomorrow, or a weekday name, further out', () => {
    expect(fireText(nextFire(item({ time: '09:00' }), LAGOS, NOW))).toBe('Monday 09:00'); // Friday's has passed, Sat/Sun are rest days
    expect(fireText(nextFire(item({ days: [] , time: '09:00' }), LAGOS, NOW))).toBe('tomorrow (Saturday) 09:00');
    expect(fireText(nextFire(item({ days: [0] }), LAGOS, NOW))).toBe('Sunday 17:30');
  });
  it('a reminder that has already gone out today waits for the next day', () => {
    expect(fireText(nextFire(item({ days: [] }), LAGOS, NOW, { training: '2026-10-09' }))).toBe('tomorrow (Saturday) 17:30');
    expect(fireText(nextFire(item({ days: [] }), LAGOS, NOW, { training: '2026-10-08' }))).toBe('today 17:30');
  });
  it('a reminder just missed still counts as due until the late window closes', () => {
    expect(fireText(nextFire(item({ days: [], time: '09:50' }), LAGOS, NOW))).toBe('due any moment');
    expect(fireText(nextFire(item({ days: [], time: '09:40' }), LAGOS, NOW))).toBe('tomorrow (Saturday) 09:40');
  });
  it('uses the zone it is told, not the browser’s', () => {
    // 10:00 in Lagos is 02:00 in Los Angeles that same Friday, so 17:30 is still ahead there too, but 09:00 is not yet passed.
    expect(fireText(nextFire(item({ days: [], time: '09:00' }), 'America/Los_Angeles', NOW))).toBe('today 09:00');
  });
  it('gives nothing for a broken zone or time', () => {
    expect(nextFire(item(), 'Not/AZone', NOW)).toBeNull();
    expect(nextFire(item({ time: '25:00' }), LAGOS, NOW)).toBeNull();
    expect(fireText(null)).toBe('never');
  });
});

describe('it agrees with what the server really does', () => {
  it('uses the same late window as the sender', () => {
    expect(WINDOW_MINUTES).toBe(SERVER_WINDOW);
  });
  // Step through a week the way the clock does, and find the first moment the sender would send. The hint must name that day and time.
  const firstSend = (it: ReturnType<typeof item>, tz: string, from: Date, lastSent: Record<string, string> = {}) => {
    for (let m = 0; m <= 8 * 24 * 60; m += 5) {
      const t = new Date(from.getTime() + m * 60_000);
      if (dueReminders([{ ...it, title: 't', body: 'b' }], lastSent, tz, t).length) return t;
    }
    return null;
  };
  const cases: [string, ReturnType<typeof item>, string, string, Record<string, string>][] = [
    ['every day, later today', item({ days: [], time: '21:00' }), LAGOS, '2026-10-09T10:00:00+01:00', {}],
    ['gym days, from a Sunday', item(), LAGOS, '2026-10-18T12:24:00+01:00', {}],
    ['gym days, from a Friday morning', item(), LAGOS, '2026-10-09T10:00:00+01:00', {}],
    ['gym days, from a Friday evening', item(), LAGOS, '2026-10-09T19:00:00+01:00', {}],
    ['Sundays only', item({ id: 'review', days: [0], time: '19:00' }), LAGOS, '2026-10-12T08:00:00+01:00', {}],
    ['already sent today', item({ days: [], time: '17:30' }), LAGOS, '2026-10-09T10:00:00+01:00', { training: '2026-10-09' }],
    ['another time zone', item({ days: [2, 4], time: '06:45' }), 'America/Los_Angeles', '2026-10-09T10:00:00+01:00', {}],
    ['a zone ahead of UTC', item({ days: [], time: '00:10' }), 'Pacific/Auckland', '2026-10-09T10:00:00+01:00', {}],
  ];
  for (const [name, it, tz, from, sent] of cases) {
    it_(name, () => {
      const start = at(from);
      const fire = nextFire(it, tz, start, sent);
      const hit = firstSend(it, tz, start, sent);
      expect(fire, 'a prediction').not.toBeNull();
      expect(hit, 'the sender sends within a week').not.toBeNull();
      const local = zonedParts(hit!, tz)!;
      const target = Number(it.time.slice(0, 2)) * 60 + Number(it.time.slice(3));
      expect(local.weekday, 'same weekday').toBe(fire!.weekday);
      expect(local.minutes - target, 'within one step of the chosen time').toBeGreaterThanOrEqual(0);
      expect(local.minutes - target).toBeLessThan(5 + (fire!.when === 'now' ? SERVER_WINDOW : 0));
    });
  }
});
function it_(name: string, fn: () => void) {
  it(name, fn);
}

describe('reading the screen', () => {
  it('shows days Monday first, and "every day" for none or all', () => {
    expect(daysText([5, 1, 3])).toBe('Mon, Wed, Fri');
    expect(daysText([0, 6])).toBe('Sat, Sun');
    expect(daysText([])).toBe('every day');
    expect(daysText([0, 1, 2, 3, 4, 5, 6])).toBe('every day');
  });
  it('a row hint appears only for reminders that are on and have something to send', () => {
    expect(nextForRow('training', DEFAULT_REMINDERS, DEFAULT_PROGRAM, LAGOS, NOW)).toBe('today 17:30');
    expect(nextForRow('training', { ...DEFAULT_REMINDERS, training: { on: false, time: '17:30' } }, DEFAULT_PROGRAM, LAGOS, NOW)).toBeNull();
    expect(nextForRow('training', DEFAULT_REMINDERS, [], LAGOS, NOW)).toBeNull();
    expect(nextForRow('review', DEFAULT_REMINDERS, DEFAULT_PROGRAM, LAGOS, NOW)).toBe('Sunday 19:00');
  });
  it('names the push service from the address', () => {
    expect(serviceName('https://fcm.googleapis.com/fcm/send/abc')).toBe('Chrome or Android');
    expect(serviceName('https://web.push.apple.com/abc')).toBe('Apple (Safari or iPhone)');
    expect(serviceName('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe('Firefox');
    expect(serviceName('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe('Edge or Windows');
    expect(serviceName('not a url')).toBe('unknown service');
  });
  it('says how long ago in plain words', () => {
    expect(agoText('2026-10-09T09:59:40+01:00', NOW)).toBe('just now');
    expect(agoText('2026-10-09T09:15:00+01:00', NOW)).toBe('45 min ago');
    expect(agoText('2026-10-09T04:00:00+01:00', NOW)).toBe('6 h ago');
    expect(agoText('2026-10-02T10:00:00+01:00', NOW)).toBe('7 days ago');
    expect(agoText(undefined, NOW)).toBe('at an unknown time');
  });
  it('drops malformed stored reminders instead of showing them', () => {
    expect(readSchedule([{ id: 'ok', time: '09:00', days: [1, 1, 9], title: 'a', body: 'b' }, { id: 'BAD ID', time: '09:00', title: 'a', body: 'b' }, null, 'x'])).toEqual([{ id: 'ok', time: '09:00', days: [1], title: 'a', body: 'b' }]);
    expect(readSchedule('junk')).toEqual([]);
  });
});

describe('describing the devices on an account', () => {
  const plan = { ...DEFAULT_REMINDERS };
  const mine = 'https://fcm.googleapis.com/fcm/send/mine';
  const row = (endpoint: string, over: Record<string, unknown> = {}) => ({ endpoint, tz: LAGOS, schedule: buildPushSchedule(plan, DEFAULT_PROGRAM), last_sent: {}, updated_at: '2026-10-09T09:50:00+01:00', ...over });

  it('puts this device first, lists its reminders with next times, and says it is in step', () => {
    const v = describeDevices([row('https://web.push.apple.com/phone'), row(mine)], mine, plan, DEFAULT_PROGRAM, NOW, LAGOS);
    expect(v.map((d) => d.isThis)).toEqual([true, false]);
    expect(v[0].inSync).toBe(true);
    expect(v[0].items.map((i) => [i.name, i.time, i.daysText, i.next])).toEqual([
      ['Daily check-in', '21:00', 'every day', 'today 21:00'],
      ['Training day', '17:30', 'Mon, Wed, Fri', 'today 17:30'],
      ['Weekly review', '19:00', 'Sun', 'Sunday 19:00'],
    ]);
    expect(v[0].updatedAgo).toBe('10 min ago');
  });
  it('spots a server that is behind the screen: different times, or a different time zone', () => {
    const stale = buildPushSchedule({ ...plan, training: { on: true, time: '09:00' } }, DEFAULT_PROGRAM);
    expect(describeDevices([row(mine, { schedule: stale })], mine, plan, DEFAULT_PROGRAM, NOW, LAGOS)[0].inSync).toBe(false);
    expect(describeDevices([row(mine, { tz: 'America/New_York' })], mine, plan, DEFAULT_PROGRAM, NOW, LAGOS)[0].inSync).toBe(false);
  });
  it('another device is never reported as out of step with this screen', () => {
    expect(describeDevices([row('https://web.push.apple.com/phone', { tz: 'Europe/London' })], mine, plan, DEFAULT_PROGRAM, NOW, LAGOS)[0].inSync).toBe(true);
  });
  it('shows what was last sent, and nothing broken', () => {
    const v = describeDevices([row(mine, { last_sent: { checkin: '2026-10-09' }, schedule: 'junk' })], mine, plan, DEFAULT_PROGRAM, NOW, LAGOS);
    expect(v[0].items).toEqual([]);
    const v2 = describeDevices([row(mine, { last_sent: { checkin: '2026-10-09' } })], mine, plan, DEFAULT_PROGRAM, NOW, LAGOS);
    expect(v2[0].items.find((i) => i.id === 'checkin')).toMatchObject({ lastSent: '2026-10-09', next: 'tomorrow (Saturday) 21:00' });
  });
  it('with no device of its own it still lists the account’s devices', () => {
    const v = describeDevices([row('https://web.push.apple.com/phone')], null, plan, DEFAULT_PROGRAM, NOW, LAGOS);
    expect(v).toHaveLength(1);
    expect(v[0].isThis).toBe(false);
  });
});

describe('telling the person a device cannot be reached', () => {
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

  it('says nothing for a short blip, and speaks up once it has lasted a day', () => {
    expect(FAILING_AFTER_HOURS).toBe(24);
    expect(failingInfo({ failing_since: hoursAgo(1), last_error: '500' }, NOW, LAGOS)).toBeNull();
    expect(failingInfo({ failing_since: hoursAgo(23.9), last_error: '500' }, NOW, LAGOS)).toBeNull();
    expect(failingInfo({ failing_since: hoursAgo(24), last_error: '500' }, NOW, LAGOS)).toMatchObject({ hours: 24, code: '500' });
    expect(failingInfo({ failing_since: hoursAgo(75.5), last_error: null }, NOW, LAGOS)).toMatchObject({ hours: 75, code: null });
  });
  it('says nothing when there is no note, or the note is unreadable', () => {
    for (const bad of [null, undefined, '', 'yesterday', '2026-13-45']) expect(failingInfo({ failing_since: bad as string | null, last_error: '403' }, NOW, LAGOS), String(bad)).toBeNull();
    expect(failingInfo({}, NOW, LAGOS)).toBeNull();
  });
  it('names the day it started in the viewer’s own time zone', () => {
    const row = { failing_since: '2026-10-07T23:30:00Z', last_error: '410' }; // 00:30 on the 8th in Lagos, still the 7th in Los Angeles
    expect(failingInfo(row, NOW, LAGOS)?.since).toBe('8 Oct');
    expect(failingInfo(row, NOW, 'America/Los_Angeles')?.since).toBe('7 Oct');
    expect(failingInfo(row, NOW, 'Not/AZone')?.since).toBe('7 Oct'); // a broken zone falls back to UTC rather than failing
  });
  it('keeps the error code short and plain', () => {
    expect(failingInfo({ failing_since: hoursAgo(30), last_error: '  403  ' }, NOW, LAGOS)?.code).toBe('403');
    expect(failingInfo({ failing_since: hoursAgo(30), last_error: 'x'.repeat(100) }, NOW, LAGOS)?.code).toHaveLength(30);
    expect(failingInfo({ failing_since: hoursAgo(30), last_error: '   ' }, NOW, LAGOS)?.code).toBeNull();
    expect(failingInfo({ failing_since: hoursAgo(30), last_error: 42 as unknown as string }, NOW, LAGOS)?.code).toBeNull();
  });
  it('explains in words and says what to do', () => {
    const f = (code: string | null) => ({ since: '17 Oct', hours: 40, code });
    expect(failingText(f('403'), true)).toBe('Couldn’t reach this device since 17 Oct (the push service said 403). Turn push off and on again.');
    expect(failingText(f('network'), true)).toContain('(no connection to the push service)');
    expect(failingText(f('blocked'), true)).toContain('(its address was refused)');
    expect(failingText(f(null), true)).toBe('Couldn’t reach this device since 17 Oct. Turn push off and on again.');
    expect(failingText(f('whatever'), true)).toBe('Couldn’t reach this device since 17 Oct. Turn push off and on again.'); // an unknown code is not shown raw
    expect(failingText(f('500'), false)).toBe('Couldn’t reach it since 17 Oct (the push service said 500). Turn push off and on again on that device.');
  });
  it('is attached to the right devices when describing an account', () => {
    const plan = { ...DEFAULT_REMINDERS };
    const mine = 'https://fcm.googleapis.com/fcm/send/mine';
    const base = { tz: LAGOS, schedule: buildPushSchedule(plan, DEFAULT_PROGRAM), last_sent: {}, updated_at: hoursAgo(1) };
    const rows = [
      { ...base, endpoint: 'https://web.push.apple.com/phone', failing_since: hoursAgo(50), last_error: '403' },
      { ...base, endpoint: mine, failing_since: hoursAgo(2), last_error: 'network' },
    ];
    const v = describeDevices(rows, mine, plan, DEFAULT_PROGRAM, NOW, LAGOS);
    expect(v[0].isThis).toBe(true);
    expect(v[0].failing).toBeNull(); // only two hours: not worth mentioning yet
    expect(v[1].failing).toMatchObject({ code: '403', hours: 50 });
    // and a database that has not been given the newer columns gives rows without them, which must still work
    const old = describeDevices([{ ...base, endpoint: mine }], mine, plan, DEFAULT_PROGRAM, NOW, LAGOS);
    expect(old[0].failing).toBeNull();
    expect(old[0].items.length).toBeGreaterThan(0);
  });
});
