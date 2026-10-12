import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRAM } from '../program';
import { buildIcs, buildReminderEvents, DEFAULT_REMINDERS } from '../reminders';
import { guideSteps } from '../guide';
import { emptyData } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 12, 9, 0, 0));
const flags = { installed: false, canInstall: true, reminders: false, backedUp: false };

describe('reminder calendar file', () => {
  const ics = buildIcs(DEFAULT_REMINDERS, DEFAULT_PROGRAM, '2026-10-12', NOW);
  it('is a well-formed calendar with CRLF line ends and one alert per event', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('BEGIN:VEVENT').length - 1).toBe(3);
    expect(ics.split('BEGIN:VALARM').length - 1).toBe(3);
    expect(ics).not.toMatch(/[^\r]\n/);
  });
  it('repeats daily, on gym days, and on Sundays at the chosen clock time', () => {
    expect(ics).toContain('DTSTART:20261012T210000');
    expect(ics).toContain('RRULE:FREQ=DAILY');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(ics).toContain('DTSTART:20261018T190000'); // first Sunday on or after Mon 12 Oct
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=SU');
  });
  it('starts a weekly event on its first matching day', () => {
    const only = { ...DEFAULT_REMINDERS, checkin: { on: false, time: '21:00' }, review: { on: false, time: '19:00' } };
    expect(buildIcs(only, DEFAULT_PROGRAM, '2026-10-13', NOW)).toContain('DTSTART:20261014T173000'); // Tue -> Wed
  });
  it('escapes text and folds long lines', () => {
    const p = [{ ...DEFAULT_PROGRAM[0], title: 'A;B,C', focus: 'x'.repeat(200) }];
    const out = buildIcs(DEFAULT_REMINDERS, p, '2026-10-12', NOW);
    expect(out.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(out.replace(/\r\n /g, '')).toContain('A\;B\\,C');
  });
  it('makes nothing for switched-off reminders', () => {
    const off = { checkin: { on: false, time: '21:00' }, training: { on: false, time: '17:30' }, money: { on: false, time: '20:00' }, review: { on: false, time: '19:00' } };
    expect(buildReminderEvents(off, DEFAULT_PROGRAM)).toEqual([]);
  });
});

describe('getting-started checklist', () => {
  it('starts with nothing done and ticks from real data', () => {
    const d = emptyData();
    expect(guideSteps(d, flags).filter((s) => s.done)).toHaveLength(0);
    d.money.txns.push({ id: 'a', date: '2026-10-12', amount: 500, kind: 'expense', category: 'Food', note: '' } as never);
    d.career.githubUser = 'someone';
    const done = guideSteps(d, { ...flags, reminders: true, backedUp: true }).filter((s) => s.done).map((s) => s.key);
    expect(done.sort()).toEqual(['backup', 'career', 'money', 'reminders']);
  });
  it('leaves out the install step where installing is impossible', () => {
    expect(guideSteps(emptyData(), { ...flags, canInstall: false }).some((s) => s.key === 'install')).toBe(false);
  });
});
