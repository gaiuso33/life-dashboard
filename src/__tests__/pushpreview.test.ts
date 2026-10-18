import { describe, expect, it } from 'vitest';
import { WINDOW_MINUTES as SERVER_WINDOW, dueReminders } from '../../api/push';
import { DEFAULT_PROGRAM } from '../program';
import { DEFAULT_REMINDERS } from '../reminders';
import { buildPushSchedule } from '../push';
import { WINDOW_MINUTES, agoText, daysText, describeDevices, fireText, nextFire, nextForRow, readSchedule, serviceName, zonedParts } from '../pushPreview';

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
